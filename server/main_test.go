package main

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/stretchr/testify/assert"
	"github.com/winguse/go-shp/auth"
	"github.com/winguse/go-shp/utils"
	"golang.org/x/net/http2"
	"golang.org/x/oauth2"
)

func Test_ConfigLoad(t *testing.T) {
	config := &Config{}
	utils.LoadConfigFile("./config.sample.yaml", config)
	assert.Equal(t, "http://127.0.0.1:8080", config.UpstreamAddr)
}

func Test_IsAuthenticatedAES(t *testing.T) {
	h := &defaultHandler{
		config: Config{
			Auth: map[string]string{
				"test@example.com": "valid-token",
			},
		},
	}

	// static token no AES
	authHeader := "Basic " + base64.StdEncoding.EncodeToString([]byte("test@example.com:valid-token"))
	authSuccess, user := h.isAuthenticated(authHeader)
	assert.True(t, authSuccess)
	assert.Equal(t, "test@example.com", user)

	// invalid token
	fakeToken := "invalid-token"
	fakeAuthHeader := "Basic " + base64.StdEncoding.EncodeToString([]byte("test@example.com:"+fakeToken))
	authSuccess, user = h.isAuthenticated(fakeAuthHeader)
	assert.False(t, authSuccess)
	assert.Equal(t, "InvalidEmail test@example.com", user)
}

func Test_StripSensitiveCookies(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Cookie", "access_token=123; refresh_token=456; email=user@test.com; code=abc; app_session=keepme")

	stripSensitiveCookies(req)
	assert.Equal(t, "app_session=keepme", req.Header.Get("Cookie"))

	// All sensitive cookies removed
	reqOnlySensitive, _ := http.NewRequest("GET", "http://example.com", nil)
	reqOnlySensitive.Header.Set("Cookie", "access_token=123; email=user@test.com")
	stripSensitiveCookies(reqOnlySensitive)
	assert.Equal(t, "", reqOnlySensitive.Header.Get("Cookie"))
}

func Test_TokenLengthValidation(t *testing.T) {
	h := &defaultHandler{
		config: Config{
			OAuthBackend: &auth.Config{
				MaxTokenLen: 50,
			},
		},
		oAuthBackend: &auth.OAuthBackend{},
	}

	// Token longer than 50 characters
	longToken := "this-is-a-very-long-token-that-exceeds-the-maximum-allowed-length-limit"
	authHeader := "Basic " + base64.StdEncoding.EncodeToString([]byte("user@example.com:"+longToken))
	authSuccess, user := h.isAuthenticated(authHeader)
	assert.False(t, authSuccess)
	assert.Equal(t, "AuthTokenLengthInvalid", user)
}

func Test_ServerHTTP1AndHTTP2(t *testing.T) {
	// Start an upstream test HTTP server
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello from upstream"))
	}))
	defer upstream.Close()

	initMetrics("test")

	config := Config{
		UpstreamAddr: upstream.URL,
		Auth: map[string]string{
			"user@test.com": "pass",
		},
	}

	reverseProxyURL, _ := url.Parse(config.UpstreamAddr)
	reverseProxy := newCamouflageReverseProxy(reverseProxyURL)
	h2s := &http2.Server{}

	dh := &defaultHandler{
		reverseProxy:   reverseProxy,
		config:         config,
		tokenCache:     utils.NewTokenCache(),
		metricsHandler: promhttp.Handler(),
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	assert.NoError(t, err)
	defer ln.Close()

	server := &http.Server{
		Addr:      ln.Addr().String(),
		Handler:   dh,
		Protocols: new(http.Protocols),
	}
	server.Protocols.SetHTTP1(true)
	server.Protocols.SetHTTP2(true)
	server.Protocols.SetUnencryptedHTTP2(true)
	http2.ConfigureServer(server, h2s)

	go server.Serve(ln)
	defer server.Close()

	// 1. Test HTTP/1.1 request unauthenticated (should hit reverse proxy)
	req1, _ := http.NewRequest("GET", "http://"+ln.Addr().String()+"/test", nil)
	client1 := &http.Client{}
	resp1, err := client1.Do(req1)
	if assert.NoError(t, err) {
		body, _ := io.ReadAll(resp1.Body)
		resp1.Body.Close()
		assert.Equal(t, "hello from upstream", string(body))
	}

	// 2. Test HTTP/1.1 request authenticated (proxy request)
	req2, _ := http.NewRequest("GET", upstream.URL, nil)
	req2.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("user@test.com:pass")))
	proxyURL, _ := url.Parse("http://" + ln.Addr().String())
	client2 := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
	}
	resp2, err := client2.Do(req2)
	if assert.NoError(t, err) {
		body, _ := io.ReadAll(resp2.Body)
		resp2.Body.Close()
		assert.Equal(t, "hello from upstream", string(body))
	}

	// 3. Test HTTP/1.1 CONNECT request
	targetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("target reached"))
	}))
	defer targetServer.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	assert.NoError(t, err)
	defer conn.Close()

	targetURL, _ := url.Parse(targetServer.URL)
	connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\nProxy-Authorization: Basic %s\r\n\r\n",
		targetURL.Host, targetURL.Host, base64.StdEncoding.EncodeToString([]byte("user@test.com:pass")))
	_, err = conn.Write([]byte(connectReq))
	assert.NoError(t, err)

	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if assert.NoError(t, err) {
		assert.Contains(t, string(buf[:n]), "HTTP/1.1 200")
	}

	// 4. Test HTTP/2 prior knowledge request
	clientH2 := &http.Client{
		Transport: &http2.Transport{
			AllowHTTP: true,
			DialTLSContext: func(ctx context.Context, network, addr string, cfg *tls.Config) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, network, addr)
			},
		},
	}
	reqH2, _ := http.NewRequest("GET", "http://"+ln.Addr().String()+"/test", nil)
	respH2, err := clientH2.Do(reqH2)
	if assert.NoError(t, err) {
		body, _ := io.ReadAll(respH2.Body)
		respH2.Body.Close()
		assert.Equal(t, "hello from upstream", string(body))
	}
}

func Test_AuthTriggerAndMetrics(t *testing.T) {
	backend := &auth.OAuthBackend{
		RedirectBasePath: "/auth/",
	}

	dh := &defaultHandler{
		config: Config{
			MetricsPath: "/metrics",
			Auth: map[string]string{
				"valid@test.com": "password123",
			},
		},
		oAuthBackend:   backend,
		metricsHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("# METRICS OK"))
		}),
		tokenCache: utils.NewTokenCache(),
	}

	// 1. Metrics request
	reqMetrics := httptest.NewRequest("GET", "/metrics", nil)
	recMetrics := httptest.NewRecorder()
	dh.ServeHTTP(recMetrics, reqMetrics)
	assert.Equal(t, http.StatusOK, recMetrics.Code)
	assert.Contains(t, recMetrics.Body.String(), "# METRICS OK")

	// 2. Auth trigger URL unauthenticated (should return 407)
	req407 := httptest.NewRequest("GET", "/auth/407", nil)
	rec407 := httptest.NewRecorder()
	dh.ServeHTTP(rec407, req407)
	assert.Equal(t, http.StatusProxyAuthRequired, rec407.Code)
	assert.Contains(t, rec407.Header().Get("Proxy-Authenticate"), "Basic realm=")

	// 3. Auth trigger URL authenticated (should return 200)
	req200 := httptest.NewRequest("GET", "/auth/407", nil)
	req200.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("valid@test.com:password123")))
	rec200 := httptest.NewRecorder()
	dh.ServeHTTP(rec200, req200)
	assert.Equal(t, http.StatusOK, rec200.Code)
}

func Test_OAuthBackendCacheIntegration(t *testing.T) {
	tokenCache := utils.NewTokenCache()
	secret := "secret-key-123"

	// Mock token server
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if strings.Contains(authHeader, "valid-oauth-tok") {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"issued_to":"client-id","email":"user@example.com","verified_email":true,"expires_in":3600}`))
			return
		}
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	}))
	defer tokenServer.Close()

	oAuthBackend := &auth.OAuthBackend{}
	oAuthBackend.Init(&auth.Config{
		OAuth: struct {
			ClientID     string   `yaml:"client_id"`
			ClientSecret string   `yaml:"client_secret"`
			Endpoint     struct {
				AuthURL   string           `yaml:"auth_url"`
				TokenURL  string           `yaml:"token_url"`
				AuthStyle oauth2.AuthStyle `yaml:"auth_style"`
			} `yaml:"endpoint"`
			RedirectURL string   `yaml:"redirect_url"`
			Scopes      []string `yaml:"scopes"`
		}{
			ClientID:    "client-id",
			RedirectURL: "https://example.com/auth/",
		},
		TokenInfoAPI: tokenServer.URL,
		ValidEmail:   ".*@example\\.com$",
		AESSecret:    secret,
	})

	dh := &defaultHandler{
		config: Config{
			OAuthBackend: &auth.Config{
				MaxTokenLen: 512,
				AESSecret:   secret,
			},
		},
		oAuthBackend: oAuthBackend,
		tokenCache:   tokenCache,
	}

	encryptedToken := utils.EncryptToken("valid-oauth-tok", secret)
	authHeader := "Basic " + base64.StdEncoding.EncodeToString([]byte("user@example.com:"+encryptedToken))

	// First call: verifies against mock server and caches result
	ok, user := dh.isAuthenticated(authHeader)
	assert.True(t, ok)
	assert.Equal(t, "user@example.com", user)

	// Second call: hits cache
	ok2, user2 := dh.isAuthenticated(authHeader)
	assert.True(t, ok2)
	assert.Equal(t, "user@example.com", user2)

	// Cache error testing
	encryptedBadToken := utils.EncryptToken("bad-oauth-tok", secret)
	badAuthHeader := "Basic " + base64.StdEncoding.EncodeToString([]byte("user@example.com:"+encryptedBadToken))
	okBad, _ := dh.isAuthenticated(badAuthHeader)
	assert.False(t, okBad)

	// Cached error hit
	okBadCached, _ := dh.isAuthenticated(badAuthHeader)
	assert.False(t, okBadCached)
}
