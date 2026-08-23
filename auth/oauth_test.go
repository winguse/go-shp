package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/winguse/go-shp/utils"
	"golang.org/x/oauth2"
)

func createTestOAuthConfig(redirectURL, validEmail, tokenInfoURL string) *Config {
	return &Config{
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
			ClientID:     "test-client",
			ClientSecret: "test-secret",
			Endpoint: struct {
				AuthURL   string           `yaml:"auth_url"`
				TokenURL  string           `yaml:"token_url"`
				AuthStyle oauth2.AuthStyle `yaml:"auth_style"`
			}{
				AuthURL:  "https://provider.example.com/auth",
				TokenURL: "https://provider.example.com/token",
			},
			RedirectURL: redirectURL,
			Scopes:      []string{"email"},
		},
		TokenInfoAPI: tokenInfoURL,
		ValidEmail:   validEmail,
		AESSecret:    "test-aes-secret-key-32bytes-long!!",
		RenderJsSrc:  "/render.js",
	}
}

func TestOAuthBackendInit(t *testing.T) {
	cfg := createTestOAuthConfig("https://example.com/oauth/callback", ".*@example\\.com", "https://api.example.com/tokeninfo")

	backend := &OAuthBackend{}
	err := backend.Init(cfg)
	assert.NoError(t, err)
	assert.Equal(t, "/oauth/callback", backend.RedirectBasePath)
	assert.NotNil(t, backend.routeMap)

	// Test invalid regex error
	badCfg := createTestOAuthConfig("https://example.com/oauth/callback", "[invalid", "")
	err = backend.Init(badCfg)
	assert.Error(t, err)

	// Test invalid URL error
	badURLCfg := createTestOAuthConfig(":%invalid", ".*", "")
	err = backend.Init(badURLCfg)
	assert.Error(t, err)
}

func TestMakeTokenResponseAES(t *testing.T) {
	secret := "my-secret-key"
	clientToken := "SR:refresh-token-123"

	encrypted := utils.EncryptToken(clientToken, secret)
	assert.NotEqual(t, clientToken, encrypted)

	raw, ok := utils.DecryptToken(encrypted, secret)
	assert.True(t, ok)
	assert.Equal(t, clientToken, raw)

	rec := httptest.NewRecorder()
	assert.NotNil(t, rec)
}

func TestHandleHealthCheckAndLogout(t *testing.T) {
	backend := &OAuthBackend{}
	cfg := createTestOAuthConfig("https://example.com/auth/", ".*", "")
	assert.NoError(t, backend.Init(cfg))

	// Health check
	req := httptest.NewRequest("GET", "/auth/health", nil)
	rec := httptest.NewRecorder()
	backend.HandleRequest(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Logout
	reqLogout := httptest.NewRequest("GET", "/auth/logout", nil)
	recLogout := httptest.NewRecorder()
	backend.HandleRequest(recLogout, reqLogout)
	assert.Equal(t, http.StatusFound, recLogout.Code)
	assert.Equal(t, "/auth/", recLogout.Header().Get("Location"))
	assert.Contains(t, recLogout.Header().Get("Set-Cookie"), "email=")

	// 404 Not Found
	req404 := httptest.NewRequest("GET", "/auth/unknown-route", nil)
	rec404 := httptest.NewRecorder()
	backend.HandleRequest(rec404, req404)
	assert.Equal(t, http.StatusNotFound, rec404.Code)
}

func TestHandleRootRedirect(t *testing.T) {
	backend := &OAuthBackend{}
	cfg := createTestOAuthConfig("https://example.com/auth/", ".*", "")
	assert.NoError(t, backend.Init(cfg))

	// 1. Initial login redirect to AuthCodeURL
	req := httptest.NewRequest("GET", "/auth/", nil)
	rec := httptest.NewRecorder()
	backend.HandleRequest(rec, req)
	assert.Equal(t, http.StatusFound, rec.Code)
	location := rec.Header().Get("Location")
	assert.Contains(t, location, "https://provider.example.com/auth")
	assert.Contains(t, location, "client_id=test-client")

	// 2. Incoming code query param sets cookie and redirects to clean URL
	reqWithCode := httptest.NewRequest("GET", "/auth/?code=my-auth-code", nil)
	recWithCode := httptest.NewRecorder()
	backend.HandleRequest(recWithCode, reqWithCode)
	assert.Equal(t, http.StatusFound, recWithCode.Code)
	assert.Equal(t, "/auth/", recWithCode.Header().Get("Location"))
	assert.Contains(t, recWithCode.Header().Get("Set-Cookie"), "code=my-auth-code")
}

func TestCheckAccessToken_Validation(t *testing.T) {
	// Mock token info server
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == "valid-token" {
			info := TokenInfo{
				IssuedTo:      "test-client",
				Email:         "user@example.com",
				VerifiedEmail: true,
				ExpiresInSec:  3600,
			}
			makeJSONResponse(w, info)
			return
		}
		if token == "wrong-client" {
			info := TokenInfo{
				IssuedTo:      "other-client",
				Email:         "user@example.com",
				VerifiedEmail: true,
				ExpiresInSec:  3600,
			}
			makeJSONResponse(w, info)
			return
		}
		if token == "unverified" {
			info := TokenInfo{
				IssuedTo:      "test-client",
				Email:         "user@example.com",
				VerifiedEmail: false,
				ExpiresInSec:  3600,
			}
			makeJSONResponse(w, info)
			return
		}
		if token == "expired" {
			info := TokenInfo{
				IssuedTo:      "test-client",
				Email:         "user@example.com",
				VerifiedEmail: true,
				ExpiresInSec:  2,
			}
			makeJSONResponse(w, info)
			return
		}
		if token == "disallowed-domain" {
			info := TokenInfo{
				IssuedTo:      "test-client",
				Email:         "hacker@badsite.com",
				VerifiedEmail: true,
				ExpiresInSec:  3600,
			}
			makeJSONResponse(w, info)
			return
		}
		http.Error(w, "Not found", http.StatusNotFound)
	}))
	defer tokenServer.Close()

	backend := &OAuthBackend{}
	cfg := createTestOAuthConfig("https://example.com/auth/", ".*@example\\.com$", tokenServer.URL)
	assert.NoError(t, backend.Init(cfg))

	// 1. Valid token
	info, err := backend.CheckAccessToken("valid-token")
	assert.NoError(t, err)
	assert.Equal(t, "user@example.com", info.Email)

	// 2. Wrong client
	_, err = backend.CheckAccessToken("wrong-client")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "does not belong to here")

	// 3. Unverified email
	_, err = backend.CheckAccessToken("unverified")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not verified")

	// 4. Expired token
	_, err = backend.CheckAccessToken("expired")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")

	// 5. Disallowed email pattern
	_, err = backend.CheckAccessToken("disallowed-domain")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")

	// 6. Network/HTTP error
	_, err = backend.CheckAccessToken("non-existent")
	assert.Error(t, err)
}

func TestCheckAccessToken_Github(t *testing.T) {
	// Mock Github emails and application token endpoint
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/applications/") {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{}`))
			return
		}
		if r.URL.Path == "/user/emails" {
			emails := []GithubEmail{
				{Email: "secondary@example.com", Primary: false, Verified: true},
				{Email: "primary@example.com", Primary: true, Verified: true},
			}
			makeJSONResponse(w, emails)
			return
		}
		http.Error(w, "Not found", http.StatusNotFound)
	}))
	defer server.Close()

	backend := &OAuthBackend{}
	// Use github api url pattern
	cfg := createTestOAuthConfig("https://example.com/auth/", ".*@example\\.com$", server.URL+"/user/emails?mock=api.github.com")
	assert.NoError(t, backend.Init(cfg))

	// The Github branch tries to call https://api.github.com/applications/... which won't succeed in unit test,
	// but verify error handling
	_, err := backend.CheckAccessToken("github-token")
	assert.Error(t, err)
}

func TestHandleTokenInfoAndRefresh(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == "tok-123" {
			info := TokenInfo{
				IssuedTo:      "test-client",
				Email:         "user@example.com",
				VerifiedEmail: true,
				ExpiresInSec:  1800,
			}
			makeJSONResponse(w, info)
			return
		}
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	}))
	defer tokenServer.Close()

	backend := &OAuthBackend{}
	cfg := createTestOAuthConfig("https://example.com/auth/", ".*", tokenServer.URL)
	assert.NoError(t, backend.Init(cfg))

	// 1. handleTokenInfo valid
	body, _ := json.Marshal(AccessTokenInfo{AccessToken: "tok-123"})
	req := httptest.NewRequest("POST", "/auth/token-info", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	backend.HandleRequest(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	var resp AccessTokenInfo
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "tok-123", resp.AccessToken)
	assert.Equal(t, 1800, resp.ExpiresInSec)

	// 2. handleTokenInfo invalid JSON
	reqBad := httptest.NewRequest("POST", "/auth/token-info", bytes.NewReader([]byte("{invalid")))
	recBad := httptest.NewRecorder()
	backend.HandleRequest(recBad, reqBad)
	assert.Equal(t, http.StatusBadRequest, recBad.Code)

	// 3. handleTokenInfo token check fail
	bodyFail, _ := json.Marshal(AccessTokenInfo{AccessToken: "bad-token"})
	reqFail := httptest.NewRequest("POST", "/auth/token-info", bytes.NewReader(bodyFail))
	recFail := httptest.NewRecorder()
	backend.HandleRequest(recFail, reqFail)
	assert.Equal(t, http.StatusBadRequest, recFail.Code)

	// 4. handleRefresh invalid JSON
	reqRefBad := httptest.NewRequest("POST", "/auth/refresh", bytes.NewReader([]byte("{invalid")))
	recRefBad := httptest.NewRecorder()
	backend.HandleRequest(recRefBad, reqRefBad)
	assert.Equal(t, http.StatusBadRequest, recRefBad.Code)
}

func TestMakeTokenResponse(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := TokenInfo{
			IssuedTo:      "test-client",
			Email:         "user@example.com",
			VerifiedEmail: true,
			ExpiresInSec:  3600,
		}
		makeJSONResponse(w, info)
	}))
	defer tokenServer.Close()

	backend := &OAuthBackend{}
	cfg := createTestOAuthConfig("https://example.com/auth/", ".*", tokenServer.URL+"?access_token=")
	assert.NoError(t, backend.Init(cfg))

	rec := httptest.NewRecorder()
	token := &oauth2.Token{
		AccessToken:  "valid-access-tok",
		RefreshToken: "valid-refresh-tok",
	}
	backend.makeTokenResponse(token, nil, rec)
	allCookies := strings.Join(rec.Header()["Set-Cookie"], "; ")
	assert.Contains(t, allCookies, "access_token=valid-access-tok")
	assert.Contains(t, allCookies, "refresh_token=valid-refresh-tok")
	assert.Contains(t, allCookies, "email=user@example.com")
	assert.Contains(t, rec.Body.String(), "/render.js")
	assert.Contains(t, rec.Body.String(), "user@example.com")
}

