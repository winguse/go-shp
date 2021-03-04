package main

import (
	"crypto/tls"
	"encoding/base64"
	"errors"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"time"

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
	UpstreamAddr      string            `yaml:"upstream_addr"`
	ListenAddr        string            `yaml:"listen_addr"`
	CertFile          string            `yaml:"cert_file"`
	KeyFile           string            `yaml:"key_file"`
	Auth              map[string]string `yaml:"auth"`
	OAuthBackend      *auth.Config      `yaml:"oauth_backend"`
	MetricsPath       string            `yaml:"metrics_path"`
	Hostname          string            `yaml:"hostname"`
	AdminUpstreamAddr string            `yaml:"admin_upstream_addr"`
}

type defaultHandler struct {
	reverseProxy      *httputil.ReverseProxy
	adminReverseProxy *httputil.ReverseProxy
	config            Config
	oAuthBackend      *auth.OAuthBackend
	tokenCache        *utils.TokenCache
	metricsHandler    http.Handler
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
				log.Printf("Flush writer error in recover: %s\n", err)
				return
			}
			err = r.(error)
		}
	}()

	n, err = f.w.Write(p)
	if err != nil {
		log.Printf("Flush writer error in write response: %s\n", err)
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

	isAuthTriggerURL := r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, h.oAuthBackend.RedirectBasePath+"407")
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
			log.Printf("[%s] %s %s\n", username, r.Method, r.URL)
			for k := range r.Header {
				if headerBlackList[strings.ToLower(k)] {
					r.Header.Del(k)
				}
			}
			proxy(w, r, username)
		} else {
			if username == "" {
				log.Printf("[normal] %s %s\n", r.Method, r.URL)
			} else {
				log.Printf("{%s} %s %s\n", username, r.Method, r.URL)
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
	if h.config.Auth[email] == token {
		return true, email
	}

	if h.oAuthBackend != nil {
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

func (h *defaultHandler) handleReverseProxy(w http.ResponseWriter, r *http.Request) {
	if h.oAuthBackend != nil && strings.HasPrefix(r.URL.Path, h.oAuthBackend.RedirectBasePath) {
		h.oAuthBackend.HandleRequest(w, r)
	} else if adminCookie, err := r.Cookie("go_shp_admin"); err == nil {
		authoried, username := h.isAuthenticated(adminCookie.Value)
		matched, err := regexp.Match(h.config.OAuthBackend.AdminEmail, []byte(username))
		if authoried && err == nil && matched {
			h.adminReverseProxy.ServeHTTP(w, r)
		} else {
			log.Printf("%s is attempting to access admin.\n", username)
			h.reverseProxy.ServeHTTP(w, r)
		}
	} else {
		h.reverseProxy.ServeHTTP(w, r)
	}
}

func createTCPConn(host string) (*net.TCPConn, error) {
	destConn, err := net.DialTimeout("tcp", host, 10*time.Second)
	if err != nil {
		return nil, err
	}
	if tcpConn, ok := destConn.(*net.TCPConn); ok {
		return tcpConn, nil
	}
	return nil, errors.New("Failed to cast net.Conn to net.TCPConn")
}

func hijack(w http.ResponseWriter) (net.Conn, error) {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("Hijacking not supported")
	}
	clientConn, _, err := hijacker.Hijack()
	return clientConn, err
}

func copy(from, to io.ReadWriter, errCh chan error) {
	buf := utils.BuffPool.Get().([]byte)
	defer utils.BuffPool.Put(buf)
	_, err := io.CopyBuffer(to, from, buf)
	errCh <- err
}

func transport(a, b io.ReadWriter) {
	errCh := make(chan error, 2)

	go copy(a, b, errCh)
	go copy(b, a, errCh)

	for i := 0; i < 2; i++ {
		err := <-errCh
		if err != nil && err != io.EOF {
			log.Printf("Found transport error %s\n", err)
		}
	}
}

func handleTunneling(w http.ResponseWriter, r *http.Request, username string) {
	remoteTCPConn, err := createTCPConn(r.Host)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer remoteTCPConn.Close()
	w.WriteHeader(http.StatusOK)
	if r.ProtoMajor == 2 {
		w.(http.Flusher).Flush() // must flush, or the client won't start the connection
		go func() {
			// client -> remote
			connGauge.With(prometheus.Labels{"dir": "remote"}).Inc()
			defer connGauge.With(prometheus.Labels{"dir": "remote"}).Dec()
			defer remoteTCPConn.CloseWrite()
			size := utils.CopyAndPrintError(remoteTCPConn, r.Body)
			statics(username, TCPConn, Upload, size)
		}()
		// remote -> client
		connGauge.With(prometheus.Labels{"dir": "client"}).Inc()
		defer connGauge.With(prometheus.Labels{"dir": "client"}).Dec()
		defer remoteTCPConn.CloseRead()
		size := utils.CopyAndPrintError(&flushWriter{w}, remoteTCPConn)
		statics(username, TCPConn, Download, size)
	} else {
		clientConn, err := hijack(w)
		if err != nil {
			log.Printf("hijack failed: %s", err)
			return
		}
		defer clientConn.Close()
		go func() {
			// client -> remote
			connGauge.With(prometheus.Labels{"dir": "remote"}).Inc()
			defer connGauge.With(prometheus.Labels{"dir": "remote"}).Dec()
			defer remoteTCPConn.CloseWrite()
			size := utils.CopyAndPrintError(remoteTCPConn, clientConn)
			statics(username, TCPConn, Upload, size)
		}()
		connGauge.With(prometheus.Labels{"dir": "client"}).Inc()
		defer connGauge.With(prometheus.Labels{"dir": "client"}).Dec()
		// remote -> client
		defer remoteTCPConn.CloseRead()
		size := utils.CopyAndPrintError(clientConn, remoteTCPConn)
		statics(username, TCPConn, Download, size)
	}
}

func handleHTTP(w http.ResponseWriter, req *http.Request, username string) {
	if req.ProtoMajor == 2 {
		req.URL.Scheme = "http"
		req.URL.Host = req.Host
	}
	pipeRead, pipeWrite := io.Pipe()
	fromBody := req.Body
	req.Body = pipeRead
	go func() {
		defer pipeWrite.Close()
		defer fromBody.Close()
		size := utils.CopyAndPrintError(pipeWrite, fromBody)
		statics(username, HTTPConn, Upload, size)
	}()
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	copyHeader(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	size := utils.CopyAndPrintError(w, resp.Body)
	statics(username, HTTPConn, Download, size)
}

func copyHeader(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
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
	adminReverseProxyURL, err := url.Parse(config.AdminUpstreamAddr)
	if err != nil {
		log.Fatal("Fail to parse reverse proxy admin url", err)
	}

	reverseProxy := httputil.NewSingleHostReverseProxy(reverseProxyURL)
	adminReverseProxy := httputil.NewSingleHostReverseProxy(adminReverseProxyURL)
	log.Printf("Listening on %s, upstream to %s .\n", config.ListenAddr, config.UpstreamAddr)
	oAuthBackend := &auth.OAuthBackend{}
	if config.OAuthBackend != nil {
		oAuthBackend.Init(config.OAuthBackend)
	} else {
		oAuthBackend = nil
	}
	tokenCache := utils.NewTokenCache()
	server := &http.Server{
		Addr: config.ListenAddr,
		Handler: &defaultHandler{
			reverseProxy,
			adminReverseProxy,
			*config,
			oAuthBackend,
			tokenCache,
			promhttp.Handler(),
		},
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}
	initMetrics(config.Hostname)
	err = server.ListenAndServeTLS(config.CertFile, config.KeyFile)
	if err != nil {
		log.Fatal("Failed to serve: ", err)
	}
}
