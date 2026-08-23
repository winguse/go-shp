package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/winguse/go-shp/utils"
)

func TestLoadConfig(t *testing.T) {
	configContent := `
credentials:
  proxy.example.com:
    username: user1
    token: token1
    auth_base_path: /auth1/
  'proxyx.example.com:443':
    username: user2
    token: token2
    auth_base_path: /auth2/
  _:
    username: defaultuser
    token: defaulttoken
    auth_base_path: /default/
listen_port: 8080
proxies:
  - name: PROXY
    hosts:
      - 127.0.0.1:443
    select_policy: RANDOM
rules:
  - proxy_name: PROXY
    domains:
      - google.com
unmatched_policy:
  proxy_name: DIRECT
  detect: true
  detect_delay_ms: 50
  detect_expires_second: 300
`
	tmpfile, err := os.CreateTemp("", "config.*.yaml")
	assert.NoError(t, err)
	defer os.Remove(tmpfile.Name())

	_, err = tmpfile.Write([]byte(configContent))
	assert.NoError(t, err)
	tmpfile.Close()

	config := &Config{}
	utils.LoadConfigFile(tmpfile.Name(), config)

	assert.Equal(t, 8080, config.ListenPort)
	assert.Len(t, config.Credentials, 3)
	assert.Equal(t, "user1", config.Credentials["proxy.example.com"].Username)
	assert.Equal(t, "token1", config.Credentials["proxy.example.com"].Token)
	assert.Equal(t, "/auth1/", config.Credentials["proxy.example.com"].AuthBasePath)

	assert.Equal(t, "user2", config.Credentials["proxyx.example.com:443"].Username)
	assert.Equal(t, "token2", config.Credentials["proxyx.example.com:443"].Token)

	assert.Equal(t, "defaultuser", config.Credentials["_"].Username)
	assert.Equal(t, "defaulttoken", config.Credentials["_"].Token)

	assert.Len(t, config.Proxies, 1)
	assert.Equal(t, "PROXY", config.Proxies[0].Name)
	assert.Len(t, config.Rules, 1)
	assert.Equal(t, "PROXY", config.Rules[0].ProxyName)
	assert.Contains(t, config.Rules[0].Domains, "google.com")
	assert.True(t, config.UnmatchedPolicy.Detect)
}

func TestGetCredential(t *testing.T) {
	client := &shpClient{
		config: &Config{
			Credentials: map[string]*Credential{
				"proxy.example.com": {
					Username:     "user1",
					Token:        "token1",
					AuthBasePath: "/auth1/",
				},
				"proxy2.example.com:443": {
					Username: "user2",
					Token:    "token2",
				},
				"proxy3.example.com:8443": {
					Username: "user3",
					Token:    "token3",
				},
				"_": {
					Username: "defuser",
					Token:    "deftoken",
				},
			},
		},
	}

	// 1. Exact match
	cred := client.getCredential("proxy.example.com")
	assert.NotNil(t, cred)
	assert.Equal(t, "user1", cred.Username)

	// 2. Exact match when lookup includes :443 but key has no port
	cred = client.getCredential("proxy.example.com:443")
	assert.NotNil(t, cred)
	assert.Equal(t, "user1", cred.Username)

	// 3. Exact match when key has :443 but lookup has no port
	cred = client.getCredential("proxy2.example.com")
	assert.NotNil(t, cred)
	assert.Equal(t, "user2", cred.Username)

	// 4. Exact match with non-443 port
	cred = client.getCredential("proxy3.example.com:8443")
	assert.NotNil(t, cred)
	assert.Equal(t, "user3", cred.Username)

	// 5. Fallback to '_'
	cred = client.getCredential("other.example.com:443")
	assert.NotNil(t, cred)
	assert.Equal(t, "defuser", cred.Username)

	// 6. No fallback when '_' not present
	clientNoDef := &shpClient{
		config: &Config{
			Credentials: map[string]*Credential{
				"proxy.example.com": {Username: "user1", Token: "token1"},
			},
		},
	}
	assert.Nil(t, clientNoDef.getCredential("unknown.com"))
	assert.Nil(t, (&shpClient{}).getCredential("unknown.com"))
}

func TestGetBasicAuthToken(t *testing.T) {
	client := &shpClient{
		config: &Config{
			Credentials: map[string]*Credential{
				"proxy.example.com": {
					Username: "alice",
					Token:    "secret123",
				},
				"_": {
					Username: "bob",
					Token:    "secret456",
				},
			},
		},
	}

	expectedAlice := "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:secret123"))
	expectedBob := "Basic " + base64.StdEncoding.EncodeToString([]byte("bob:secret456"))

	assert.Equal(t, expectedAlice, client.getBasicAuthToken("proxy.example.com"))
	assert.Equal(t, expectedBob, client.getBasicAuthToken("fallback.example.com"))
	assert.Equal(t, "", (&shpClient{}).getBasicAuthToken("anything"))
}

func TestGenPossibleSearches(t *testing.T) {
	tests := []struct {
		domain   string
		expected []string
	}{
		{"a.b.c", []string{"c", "b.c", "a.b.c"}},
		{"example.com", []string{"com", "example.com"}},
		{"localhost", []string{"localhost"}},
		{"", []string{""}},
	}
	for _, test := range tests {
		actual := genPossibleSearches(test.domain)
		assert.Equal(t, test.expected, actual)
	}
}

func TestFindProxyName(t *testing.T) {
	rule1 := &Rule{
		ProxyName: "PROXY_A",
		Domains:   []string{"google.com", "sub.internal.net"},
		domainSet: map[string]bool{"google.com": true, "sub.internal.net": true},
	}
	rule2 := &Rule{
		ProxyName: "PROXY_B",
		Domains:   []string{"cn"},
		domainSet: map[string]bool{"cn": true},
	}

	client := &shpClient{
		config: &Config{
			Rules: []*Rule{rule1, rule2},
			UnmatchedPolicy: UnmatchedPolicy{
				ProxyName: "DIRECT",
				Detect:    true,
			},
		},
	}

	// Match google.com
	name, detect := client.findProxyName(genPossibleSearches("mail.google.com"))
	assert.Equal(t, "PROXY_A", name)
	assert.False(t, detect)

	// Match cn suffix
	name, detect = client.findProxyName(genPossibleSearches("news.qq.cn"))
	assert.Equal(t, "PROXY_B", name)
	assert.False(t, detect)

	// Unmatched
	name, detect = client.findProxyName(genPossibleSearches("unknown.org"))
	assert.Equal(t, "DIRECT", name)
	assert.True(t, detect)
}

func TestDetectionFailDomain(t *testing.T) {
	client := &shpClient{
		config: &Config{
			UnmatchedPolicy: UnmatchedPolicy{
				DetectExpiresSecond: 10,
			},
		},
		detectionFailDomains: make(map[string]time.Time),
	}

	searches := genPossibleSearches("sub.example.com")
	assert.False(t, client.isDetectionFailDomain(searches))

	client.addDetectionFailDomain("sub.example.com")
	assert.True(t, client.isDetectionFailDomain(searches))

	// Manually expire
	client.detectionFailDomains["example.com"] = time.Now().Add(-20 * time.Second)
	assert.False(t, client.isDetectionFailDomain(searches))

	// Short domain (<= 2 parts)
	client.addDetectionFailDomain("localhost")
	assert.True(t, client.isDetectionFailDomain(genPossibleSearches("localhost")))
}

func TestGetPolicy(t *testing.T) {
	proxyLatency := &Proxy{
		Name:         "PROXY_LATENCY",
		Hosts:        []string{"host-fast:443", "host-slow:443"},
		SelectPolicy: ProxySelectPolicyLatency,
		activeHosts:  []string{"host-fast:443", "host-slow:443"},
		latencyMap: map[string]time.Duration{
			"host-fast:443": 50 * time.Millisecond,
			"host-slow:443": 200 * time.Millisecond,
		},
	}

	proxyRandom := &Proxy{
		Name:         "PROXY_RANDOM",
		Hosts:        []string{"host-a:443", "host-b:443"},
		SelectPolicy: ProxySelectPolicyRandom,
		activeHosts:  []string{"host-a:443", "host-b:443"},
	}

	proxySimilar := &Proxy{
		Name:         "PROXY_SIMILAR",
		Hosts:        []string{"h1:443", "h2:443", "h3:443"},
		SelectPolicy: ProxySelectPolicyRandomOnSimilarLowestLatency,
		activeHosts:  []string{"h1:443", "h2:443", "h3:443"},
		latencyMap: map[string]time.Duration{
			"h1:443": 100 * time.Millisecond,
			"h2:443": 120 * time.Millisecond,
			"h3:443": 500 * time.Millisecond,
		},
	}

	ruleDirect := &Rule{
		ProxyName: DirectProxyName,
		Domains:   []string{"direct.com"},
		domainSet: map[string]bool{"direct.com": true},
	}
	ruleLatency := &Rule{
		ProxyName: "PROXY_LATENCY",
		Domains:   []string{"latency.com"},
		domainSet: map[string]bool{"latency.com": true},
	}
	ruleRandom := &Rule{
		ProxyName: "PROXY_RANDOM",
		Domains:   []string{"random.com"},
		domainSet: map[string]bool{"random.com": true},
	}
	ruleSimilar := &Rule{
		ProxyName: "PROXY_SIMILAR",
		Domains:   []string{"similar.com"},
		domainSet: map[string]bool{"similar.com": true},
	}

	client := &shpClient{
		config: &Config{
			Rules: []*Rule{ruleDirect, ruleLatency, ruleRandom, ruleSimilar},
			UnmatchedPolicy: UnmatchedPolicy{
				ProxyName: "PROXY_LATENCY",
			},
		},
		proxyMap: map[string]*Proxy{
			"PROXY_LATENCY": proxyLatency,
			"PROXY_RANDOM":  proxyRandom,
			"PROXY_SIMILAR": proxySimilar,
		},
		detectionFailDomains: make(map[string]time.Time),
	}

	// DIRECT
	host, detect := client.getPolicy("direct.com")
	assert.Equal(t, "", host)
	assert.False(t, detect)

	// LATENCY
	host, _ = client.getPolicy("latency.com")
	assert.Equal(t, "host-fast:443", host)

	// RANDOM
	host, _ = client.getPolicy("random.com")
	assert.Contains(t, []string{"host-a:443", "host-b:443"}, host)

	// SIMILAR (h1 or h2, not h3)
	for i := 0; i < 10; i++ {
		host, _ = client.getPolicy("similar.com")
		assert.Contains(t, []string{"h1:443", "h2:443"}, host)
	}

	// Empty active hosts fallback to proxy.Hosts
	proxyLatency.activeHosts = []string{}
	host, _ = client.getPolicy("latency.com")
	assert.Contains(t, proxyLatency.Hosts, host)
}

func TestHandleHTTP(t *testing.T) {
	// 1. Direct request
	directServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Direct", "true")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("direct response"))
	}))
	defer directServer.Close()

	directURL, _ := url.Parse(directServer.URL)

	// 2. Proxy request with Proxy-Authorization (TLS)
	proxyServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Proxy-Authorization")
		if auth != "Basic "+base64.StdEncoding.EncodeToString([]byte("u:t")) {
			http.Error(w, "Unauthorized", http.StatusProxyAuthRequired)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("proxy response"))
	}))
	defer proxyServer.Close()
	proxyURL, _ := url.Parse(proxyServer.URL)

	client := &shpClient{
		h1Transport: &http.Transport{},
		h2Transport: proxyServer.Client().Transport.(*http.Transport),
		config: &Config{
			Credentials: map[string]*Credential{
				"_": {Username: "u", Token: "t"},
			},
			UnmatchedPolicy: UnmatchedPolicy{
				DetectDelayMs: 10,
			},
		},
		detectionFailDomains: make(map[string]time.Time),
	}

	req, _ := http.NewRequest("GET", directServer.URL, nil)
	req.Host = directURL.Host
	rec := httptest.NewRecorder()
	client.handleHTTP(rec, req, "", false)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "direct response", rec.Body.String())
	assert.Equal(t, "true", rec.Header().Get("X-Direct"))

	reqProxy, _ := http.NewRequest("GET", "http://example.com/test", nil)
	reqProxy.Host = "example.com"
	recProxy := httptest.NewRecorder()
	client.handleHTTP(recProxy, reqProxy, proxyURL.Host, false)

	assert.Equal(t, http.StatusOK, recProxy.Code)
	assert.Equal(t, "proxy response", recProxy.Body.String())

	// 3. Proxy error returns 502 Bad Gateway
	recErr := httptest.NewRecorder()
	reqErr, _ := http.NewRequest("GET", "http://example.com/test", nil)
	reqErr.Host = "example.com"
	client.handleHTTP(recErr, reqErr, "127.0.0.1:1", false)
	assert.Equal(t, http.StatusBadGateway, recErr.Code)
}

func TestBuildTunnel(t *testing.T) {
	// Mock proxy server handling CONNECT
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodConnect {
			auth := r.Header.Get("Proxy-Authorization")
			if auth != "Basic "+base64.StdEncoding.EncodeToString([]byte("user:pass")) {
				http.Error(w, "Auth failed", http.StatusProxyAuthRequired)
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("tunnel established"))
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}))
	defer server.Close()

	serverURL, _ := url.Parse(server.URL)

	client := &shpClient{
		config: &Config{
			Credentials: map[string]*Credential{
				serverURL.Host: {Username: "user", Token: "pass"},
			},
		},
		client: server.Client(),
	}

	conn, err := client.buildTunnel("destination.com:443", serverURL.Host)
	assert.NoError(t, err)
	assert.NotNil(t, conn)

	buf := make([]byte, 64)
	n, err := conn.Read(buf)
	if err != nil && err != io.EOF {
		assert.NoError(t, err)
	}
	assert.Equal(t, "tunnel established", string(buf[:n]))

	// Test write and close
	_, err = conn.Write([]byte("hello"))
	assert.NoError(t, err)
	assert.NoError(t, conn.Close())

	// Test auth fail
	clientBadAuth := &shpClient{
		config: &Config{
			Credentials: map[string]*Credential{
				serverURL.Host: {Username: "wrong", Token: "wrong"},
			},
		},
		client: server.Client(),
	}
	_, err = clientBadAuth.buildTunnel("destination.com:443", serverURL.Host)
	assert.Error(t, err)
}

func TestCreateTCPConn(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	assert.NoError(t, err)
	defer ln.Close()

	go func() {
		conn, err := ln.Accept()
		if err == nil {
			conn.Close()
		}
	}()

	// Connect with explicit port
	conn, err := createTCPConn(ln.Addr().String())
	assert.NoError(t, err)
	assert.NotNil(t, conn)
	conn.Close()

	// Connect to non-existent host
	_, err = createTCPConn("127.0.0.1:1")
	assert.Error(t, err)
}

func TestServeHTTP(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("served ok"))
	}))
	defer target.Close()

	targetURL, _ := url.Parse(target.URL)

	client := &shpClient{
		h1Transport: &http.Transport{},
		h2Transport: &http.Transport{},
		config: &Config{
			Credentials: map[string]*Credential{
				"_": {Username: "u", Token: "t"},
			},
			UnmatchedPolicy: UnmatchedPolicy{
				ProxyName: DirectProxyName,
			},
		},
		proxyMap:             make(map[string]*Proxy),
		detectionFailDomains: make(map[string]time.Time),
	}

	// 1. GET request
	req, _ := http.NewRequest("GET", target.URL, nil)
	req.URL.Host = targetURL.Host
	rec := httptest.NewRecorder()

	client.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "served ok", rec.Body.String())

	// 2. CONNECT request over real TCP server
	clientServer := httptest.NewServer(client)
	defer clientServer.Close()

	conn, err := net.Dial("tcp", clientServer.Listener.Addr().String())
	assert.NoError(t, err)
	defer conn.Close()

	connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", targetURL.Host, targetURL.Host)
	_, err = conn.Write([]byte(connectReq))
	assert.NoError(t, err)

	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	assert.NoError(t, err)
	assert.Contains(t, string(buf[:n]), "200 OK")
}

func TestCheckProxiesLogic(t *testing.T) {
	// Server 1: with auth_base_path /custom/
	s1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/custom/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "Not found", http.StatusNotFound)
	}))
	defer s1.Close()
	u1, _ := url.Parse(s1.URL)

	// Server 2: without auth_base_path (HEAD /)
	s2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "HEAD" && r.URL.Path == "/" {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "Not found", http.StatusNotFound)
	}))
	defer s2.Close()
	u2, _ := url.Parse(s2.URL)

	// Transport that routes to httptest servers
	transport := &http.Transport{}

	client := &shpClient{
		h2Transport: transport,
		config: &Config{
			Credentials: map[string]*Credential{
				u1.Host: {
					Username:     "u1",
					Token:        "t1",
					AuthBasePath: "/custom",
				},
				// u2 has no auth_base_path
			},
			Proxies: []*Proxy{
				{
					Name:  "TEST_GRP",
					Hosts: []string{u1.Host, u2.Host},
				},
			},
		},
	}

	// Run single check iteration
	hostLatency := make(map[string]time.Duration)
	for _, proxy := range client.config.Proxies {
		for _, host := range proxy.Hosts {
			hostLatency[host] = time.Hour
		}
	}

	for host := range hostLatency {
		cred := client.getCredential(host)
		authBasePath := ""
		if cred != nil {
			authBasePath = cred.AuthBasePath
		}

		var req *http.Request
		var isHealthCheck bool
		if authBasePath != "" {
			if !strings.HasSuffix(authBasePath, "/") {
				authBasePath += "/"
			}
			isHealthCheck = true
			req, _ = http.NewRequest("GET", "http://"+host+authBasePath+"health", nil)
		} else {
			isHealthCheck = false
			req, _ = http.NewRequest("HEAD", "http://"+host+"/", nil)
		}

		startTime := time.Now()
		resp, err := client.h2Transport.RoundTrip(req)
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		if err != nil || (isHealthCheck && resp.StatusCode != http.StatusOK) {
			hostLatency[host] = time.Hour
		} else {
			hostLatency[host] = time.Since(startTime)
		}
	}

	for _, proxy := range client.config.Proxies {
		activeHosts := make([]string, 0)
		for _, host := range proxy.Hosts {
			if hostLatency[host] != time.Hour {
				activeHosts = append(activeHosts, host)
			}
		}
		proxy.activeHosts = activeHosts
	}

	assert.Contains(t, client.config.Proxies[0].activeHosts, u1.Host)
	assert.Contains(t, client.config.Proxies[0].activeHosts, u2.Host)
}

func BenchmarkGenPossibleSearches(b *testing.B) {
	for i := 0; i < b.N; i++ {
		genPossibleSearches("a.very.long.subdomain.example.com")
	}
}

