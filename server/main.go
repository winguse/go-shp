package main

import (
	"bufio"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/http2"

	"github.com/pires/go-proxyproto"
	"github.com/winguse/go-shp/auth"
	"github.com/winguse/go-shp/utils"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	configFile                              = flag.String("config-file", "./config.yaml", "Config file")
	connGauge        *prometheus.GaugeVec   = nil
	bandwidthCounter *prometheus.CounterVec = nil
	requestCounter   *prometheus.CounterVec = nil
	authCounter      *prometheus.CounterVec = nil

	logger = utils.NewLogger(utils.InfoLevel)
)

func initMetrics(host string) {
	connGauge = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name:        "active_conn",
			Help:        "The active connection for client<->proxy (client) and proxy<->remote (remote).",
			ConstLabels: prometheus.Labels{"host": host},
		},
		[]string{"dir"},
	)
	bandwidthCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name:        "user_bandwidth",
			Help:        "Collecting TCP / HTTP statics, upload and download, HTTP header is not counted.",
			ConstLabels: prometheus.Labels{"host": host},
		},
		[]string{"user", "dir", "conn"},
	)
	requestCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name:        "user_requests",
			Help:        "The request count per user",
			ConstLabels: prometheus.Labels{"host": host},
		},
		[]string{"user"},
	)
	authCounter = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name:        "auth_backend_request",
			Help:        "The request to request backend",
			ConstLabels: prometheus.Labels{"host": host},
		},
		[]string{},
	)
	prometheus.MustRegister(connGauge)
	prometheus.MustRegister(bandwidthCounter)
	prometheus.MustRegister(requestCounter)
	prometheus.MustRegister(authCounter)
}

// Config of server
type Config struct {
	UpstreamAddr   string            `yaml:"upstream_addr"`
	ListenAddr     string            `yaml:"listen_addr"`
	CertFile       string            `yaml:"cert_file"`
	KeyFile        string            `yaml:"key_file"`
	Auth           map[string]string `yaml:"auth"`
	OAuthBackend   *auth.Config      `yaml:"oauth_backend"`
	MetricsPath    string            `yaml:"metrics_path"`
	Hostname       string            `yaml:"hostname"`
	BehindTcpProxy bool              `yaml:"behind_tcp_proxy"`
}

type defaultHandler struct {
	reverseProxy   *httputil.ReverseProxy
	config         Config
	oAuthBackend   *auth.OAuthBackend
	tokenCache     *utils.TokenCache
	metricsHandler http.Handler
}

type flushWriter struct {
	w io.Writer
}

// ConnType connection type
type ConnType int

const (
	// HTTPConn HTTP connection
	HTTPConn ConnType = 0
	// TCPConn TCP connection (HTTP CONNECT)
	TCPConn ConnType = 1
)

func (c ConnType) str() string {
	if c == HTTPConn {
		return "HTTP"
	}
	return "TCP"
}

// TrafficDirection traffic direction
type TrafficDirection int

const (
	// Upload upload
	Upload TrafficDirection = 0
	// Download download
	Download TrafficDirection = 1
)

func (t TrafficDirection) str() string {
	if t == Download {
		return "D"
	}
	return "U"
}

func statics(username string, connType ConnType, direction TrafficDirection, size int64) {
	bandwidthCounter.With(prometheus.Labels{
		"user": username,
		"dir":  direction.str(),
		"conn": connType.str(),
	}).Add(float64(size))
}

func (f *flushWriter) Write(p []byte) (n int, err error) {
	defer func() {
		if r := recover(); r != nil {
			if s, ok := r.(string); ok {
				err = errors.New(s)
			} else if e, ok := r.(error); ok {
				err = e
			} else {
				err = fmt.Errorf("panic in flushWriter: %v", r)
			}
			logger.Error("Flush writer error in recover: %s\n", err)
		}
	}()

	n, err = f.w.Write(p)
	if err != nil {
		logger.Error("Flush writer error in write response: %s\n", err)
		return
	}
	if f, ok := f.w.(http.Flusher); ok {
		f.Flush()
	}
	return
}

var headerBlackList = map[string]bool{}

func (h *defaultHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == h.config.MetricsPath {
		h.metricsHandler.ServeHTTP(w, r)
		return
	}

	isAuthTriggerURL := h.oAuthBackend != nil && r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, h.oAuthBackend.RedirectBasePath+"407")
	authoried, username := h.isAuthenticated(r.Header.Get("Proxy-Authorization"))
	if isAuthTriggerURL {
		if authoried {
			w.WriteHeader(http.StatusOK)
		} else {
			w.Header().Add("Proxy-Authenticate", "Basic realm=\"Hi, please show me your token!\"")
			w.WriteHeader(http.StatusProxyAuthRequired)
		}
		w.Write([]byte(""))
		w.(http.Flusher).Flush()
	} else {
		if authoried {
			requestCounter.With(prometheus.Labels{
				"user": username,
			}).Inc()
			logger.Debug("[%s] %s %s\n", username, r.Method, r.URL)
			for k := range r.Header {
				if headerBlackList[strings.ToLower(k)] {
					r.Header.Del(k)
				}
			}
			// Strip all sensitive proxy authentication cookies before proxying
			stripSensitiveCookies(r)
			proxy(w, r, username)
		} else {
			if username == "" {
				logger.Debug("[normal] %s %s\n", r.Method, r.URL)
			} else {
				logger.Debug("{%s} %s %s\n", username, r.Method, r.URL)
			}
			h.handleReverseProxy(w, r)
		}
	}
}

func (h *defaultHandler) isAuthenticated(authHeader string) (bool, string) {
	s := strings.SplitN(authHeader, " ", 2)
	if len(s) != 2 {
		return false, ""
	}

	b, err := base64.StdEncoding.DecodeString(s[1])
	if err != nil {
		return false, "AuthBase64Invalid"
	}

	pair := strings.SplitN(string(b), ":", 2)
	if len(pair) != 2 {
		return false, "AuthUsernamePasswordInvalid"
	}

	email := pair[0]
	token := pair[1]

	// check if matched static result
	// static result no need to check HMAC, because it's fast, hard to probe
	if expectedToken, ok := h.config.Auth[email]; ok {
		if subtle.ConstantTimeCompare([]byte(expectedToken), []byte(token)) == 1 {
			return true, email
		}
	}

	if h.oAuthBackend != nil {
		maxTokenLen := h.config.OAuthBackend.MaxTokenLen
		if maxTokenLen <= 0 {
			maxTokenLen = 512
		}
		if len(token) == 0 || len(token) > maxTokenLen {
			return false, "AuthTokenLengthInvalid"
		}

		// because checking oauth token can be slow, so
		// AES-GCM verification/decryption first to prevent timing attacks / probing
		rawToken, ok := utils.DecryptToken(token, h.config.OAuthBackend.AESSecret)
		if !ok {
			return false, "AuthTokenAESInvalid"
		}
		token = rawToken
		// check token cache
		cachedEmail := h.tokenCache.Get(token)
		if cachedEmail != "" {
			// cached error
			if cachedEmail == "err" {
				return false, "CheckError(cached) " + email
			}
			if cachedEmail == email {
				return true, email
			}
			return false, "InvalidEmail " + email
		}

		authCounter.With(prometheus.Labels{}).Inc()

		info := (*auth.TokenInfo)(nil)
		err := error(nil)

		if strings.HasPrefix(token, "SR:") { // SR: server refresh
			info, err = h.oAuthBackend.CheckRefreshToken(token[3:])
		} else {
			info, err = h.oAuthBackend.CheckAccessToken(token)
		}

		// if any errors occurs, will not check again in 3 minutes
		if err != nil {
			h.tokenCache.Put(token, "err", 3*time.Minute)
			return false, "CheckError " + email
		}

		// check success, cache for 30 minutes
		h.tokenCache.Put(token, info.Email, 30*time.Minute)
		if info.VerifiedEmail && info.Email == email {
			return true, email
		}
	}

	return false, "InvalidEmail " + email
}

func proxy(w http.ResponseWriter, r *http.Request, username string) {
	if r.Method == http.MethodConnect {
		handleTunneling(w, r, username)
	} else {
		handleHTTP(w, r, username)
	}
}

var sensitiveProxyCookies = map[string]bool{
	"access_token":  true,
	"refresh_token": true,
	"email":         true,
	"code":          true,
}

func stripSensitiveCookies(r *http.Request) {
	cookieHeader := r.Header.Get("Cookie")
	if cookieHeader == "" {
		return
	}
	cookies := strings.Split(cookieHeader, ";")
	var newCookies []string
	for _, c := range cookies {
		cTrim := strings.TrimSpace(c)
		nameVal := strings.SplitN(cTrim, "=", 2)
		cookieName := strings.TrimSpace(nameVal[0])
		if !sensitiveProxyCookies[cookieName] {
			newCookies = append(newCookies, cTrim)
		}
	}
	if len(newCookies) > 0 {
		r.Header.Set("Cookie", strings.Join(newCookies, "; "))
	} else {
		r.Header.Del("Cookie")
	}
}

func (h *defaultHandler) handleReverseProxy(w http.ResponseWriter, r *http.Request) {
	if h.oAuthBackend != nil && strings.HasPrefix(r.URL.Path, h.oAuthBackend.RedirectBasePath) {
		h.oAuthBackend.HandleRequest(w, r)
		return
	}

	stripSensitiveCookies(r)
	h.reverseProxy.ServeHTTP(w, r)
}

func createTCPConn(host string) (*net.TCPConn, error) {
	destConn, err := net.DialTimeout("tcp", host, 10*time.Second)
	if err != nil {
		return nil, err
	}
	if tcpConn, ok := destConn.(*net.TCPConn); ok {
		return tcpConn, nil
	}
	return nil, errors.New("failed to cast net.Conn to net.TCPConn")
}

func hijack(w http.ResponseWriter) (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijacking not supported")
	}
	clientConn, bufrw, err := hijacker.Hijack()
	return clientConn, bufrw, err
}

func handleTunneling(w http.ResponseWriter, r *http.Request, username string) {
	remoteTCPConn, err := createTCPConn(r.Host)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusBadGateway), http.StatusBadGateway)
		return
	}
	defer remoteTCPConn.Close()
	ctx := r.Context()
	go func() {
		<-ctx.Done()
		remoteTCPConn.Close()
	}()
	w.WriteHeader(http.StatusOK)
	if r.ProtoMajor == 2 {
		w.(http.Flusher).Flush() // must flush, or the client won't start the connection
		go func() {
			// client -> remote
			connGauge.With(prometheus.Labels{"dir": "remote"}).Inc()
			defer connGauge.With(prometheus.Labels{"dir": "remote"}).Dec()
			defer remoteTCPConn.CloseWrite()
			size := utils.CopyAndPrintError(remoteTCPConn, r.Body, logger)
			statics(username, TCPConn, Upload, size)
		}()
		// remote -> client
		connGauge.With(prometheus.Labels{"dir": "client"}).Inc()
		defer connGauge.With(prometheus.Labels{"dir": "client"}).Dec()
		defer remoteTCPConn.CloseRead()
		size := utils.CopyAndPrintError(&flushWriter{w}, remoteTCPConn, logger)
		statics(username, TCPConn, Download, size)
	} else {
		clientConn, bufrw, err := hijack(w)
		if err != nil {
			logger.Error("hijack failed: %s", err)
			return
		}
		defer clientConn.Close()
		if bufrw != nil {
			bufrw.Flush()
		}
		go func() {
			// client -> remote
			connGauge.With(prometheus.Labels{"dir": "remote"}).Inc()
			defer connGauge.With(prometheus.Labels{"dir": "remote"}).Dec()
			defer remoteTCPConn.CloseWrite()
			var reader io.Reader = clientConn
			if bufrw != nil && bufrw.Reader.Buffered() > 0 {
				reader = io.MultiReader(bufrw.Reader, clientConn)
			}
			size := utils.CopyAndPrintError(remoteTCPConn, reader, logger)
			statics(username, TCPConn, Upload, size)
		}()
		connGauge.With(prometheus.Labels{"dir": "client"}).Inc()
		defer connGauge.With(prometheus.Labels{"dir": "client"}).Dec()
		// remote -> client
		defer remoteTCPConn.CloseRead()
		size := utils.CopyAndPrintError(clientConn, remoteTCPConn, logger)
		statics(username, TCPConn, Download, size)
	}
}

func handleHTTP(w http.ResponseWriter, req *http.Request, username string) {
	if req.URL.Scheme == "" {
		req.URL.Scheme = "http"
	}
	if req.URL.Host == "" {
		req.URL.Host = req.Host
	}
	req.RequestURI = ""

	pipeRead, pipeWrite := io.Pipe()
	fromBody := req.Body
	req.Body = pipeRead
	go func() {
		defer pipeWrite.Close()
		defer fromBody.Close()
		size := utils.CopyAndPrintError(pipeWrite, fromBody, logger)
		statics(username, HTTPConn, Upload, size)
	}()
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusBadGateway), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	copyHeader(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	size := utils.CopyAndPrintError(w, resp.Body, logger)
	statics(username, HTTPConn, Download, size)
}

func copyHeader(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

func newCamouflageReverseProxy(targetURL *url.URL) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(targetURL)
			r.Out.Header.Del("X-Forwarded-For")
		},
	}
}

func main() {
	flag.Parse()
	hopByHopHeaders := []string{
		"Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Trailer",
		"TE",
		"Transfer-Encoding",
		"Upgrade",
	}
	for _, header := range hopByHopHeaders {
		headerBlackList[strings.ToLower(header)] = true
	}
	config := &Config{}
	utils.LoadConfigFile(*configFile, config)
	reverseProxyURL, err := url.Parse(config.UpstreamAddr)
	if err != nil {
		log.Fatal("Fail to parse reverse proxy url", err)
	}
	reverseProxy := newCamouflageReverseProxy(reverseProxyURL)
	logger.Info("Listening on %s, upstream to %s .\n", config.ListenAddr, config.UpstreamAddr)
	oAuthBackend := &auth.OAuthBackend{}
	if config.OAuthBackend != nil {
		oAuthBackend.Init(config.OAuthBackend)
	} else {
		oAuthBackend = nil
	}
	tokenCache := utils.NewTokenCache()
	h2s := &http2.Server{}
	server := &http.Server{
		Addr: config.ListenAddr,
		Handler: &defaultHandler{
			reverseProxy,
			*config,
			oAuthBackend,
			tokenCache,
			promhttp.Handler(),
		},
		Protocols: new(http.Protocols),
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}
	server.Protocols.SetHTTP1(true)
	server.Protocols.SetHTTP2(true)
	server.Protocols.SetUnencryptedHTTP2(true)
	if err := http2.ConfigureServer(server, h2s); err != nil {
		log.Fatal("Failed to configure http2: ", err)
	}
	initMetrics(config.Hostname)

	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		panic(err)
	}

	if config.BehindTcpProxy {
		proxyListener := &proxyproto.Listener{
			Listener: ln,
		}
		ln = proxyListener
	}
	defer ln.Close()

	if config.CertFile != "" && config.KeyFile != "" {
		err = server.ServeTLS(ln, config.CertFile, config.KeyFile)
	} else {
		err = server.Serve(ln)
	}
	if err != nil {
		log.Fatal("Failed to serve: ", err)
	}
}
