package main

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"github.com/winguse/go-shp/auth"
	"github.com/winguse/go-shp/utils"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	configFile = flag.String("config-file", "./config.json", "Config file")
	buffPool   = sync.Pool{
		New: func() interface{} {
			return make([]byte, 32*1024)
		},
	}
	activeConnCount     int32
	activeRemote2Client int32
	activeClient2Remote int32
)

type configuration struct {
	UpstreamAddr    string
	ListenAddr      string
	CertFile        string
	KeyFile         string
	Auth            map[string]string
	OAuthBackend    *auth.Config
	Trigger407Token string
}

type defaultHandler struct {
	reverseProxy *httputil.ReverseProxy
	config       configuration
	oAuthBackend *auth.OAuthBackend
	tokenCache   *utils.TokenCache
}

type flushWriter struct {
	w io.Writer
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
	atomic.AddInt32(&activeConnCount, 1)
	defer atomic.AddInt32(&activeConnCount, -1)

	isAuthTriggerURL := r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, h.config.Trigger407Token)
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
			log.Printf("[%s] %s %s\n", username, r.Method, r.URL)
			for k := range r.Header {
				if headerBlackList[strings.ToLower(k)] {
					r.Header.Del(k)
				}
			}
			proxy(w, r)
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

		info, err := h.oAuthBackend.CheckAccessToken(token)
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

func proxy(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		handleTunneling(w, r)
	} else {
		handleHTTP(w, r)
	}
}

func (h *defaultHandler) handleReverseProxy(w http.ResponseWriter, r *http.Request) {
	if h.oAuthBackend != nil && strings.HasPrefix(r.URL.Path, h.oAuthBackend.RedirectBasePath) {
		h.oAuthBackend.HandleRequest(w, r)
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
	buf := buffPool.Get().([]byte)
	defer buffPool.Put(buf)
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

func handleTunneling(w http.ResponseWriter, r *http.Request) {
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
			atomic.AddInt32(&activeClient2Remote, 1)
			defer atomic.AddInt32(&activeClient2Remote, -1)
			defer remoteTCPConn.CloseWrite()
			copyAndPrintError(remoteTCPConn, r.Body)
		}()
		// remote -> client
		atomic.AddInt32(&activeRemote2Client, 1)
		defer atomic.AddInt32(&activeRemote2Client, -1)
		defer remoteTCPConn.CloseRead()
		copyAndPrintError(&flushWriter{w}, remoteTCPConn)
	} else {
		clientConn, err := hijack(w)
		if err != nil {
			log.Printf("hijack failed: %s", err)
			return
		}
		defer clientConn.Close()
		go func() {
			// client -> remote
			atomic.AddInt32(&activeClient2Remote, 1)
			defer atomic.AddInt32(&activeClient2Remote, -1)
			defer remoteTCPConn.CloseWrite()
			copyAndPrintError(remoteTCPConn, clientConn)
		}()
		atomic.AddInt32(&activeRemote2Client, 1)
		defer atomic.AddInt32(&activeRemote2Client, -1)
		// remote -> client
		defer remoteTCPConn.CloseRead()
		copyAndPrintError(clientConn, remoteTCPConn)
	}
}

func copyAndPrintError(dst io.Writer, src io.Reader) {
	buf := buffPool.Get().([]byte)
	defer buffPool.Put(buf)
	_, err := io.CopyBuffer(dst, src, buf)
	if err != nil && err != io.EOF {
		log.Printf("Error while copy %s", err)
	}
}

func handleHTTP(w http.ResponseWriter, req *http.Request) {
	if req.ProtoMajor == 2 {
		req.URL.Scheme = "http"
		req.URL.Host = req.Host
	}
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	copyHeader(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func copyHeader(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

func main() {
	// go func() {
	// 	for range time.Tick(time.Second) {
	// 		log.Printf(">>>>> active %d, client -> remote %d, remote -> client %d\n", activeConnCount, activeClient2Remote, activeRemote2Client)
	// 	}
	// }()

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
	file, err := os.Open(*configFile)
	defer file.Close()
	if err != nil {
		log.Fatal("Fail to read config", err)
	}
	decoder := json.NewDecoder(file)
	config := configuration{}
	err = decoder.Decode(&config)
	if err != nil {
		log.Fatal("Fail to parse config", err)
	}
	reverseProxyURL, err := url.Parse(config.UpstreamAddr)
	if err != nil {
		log.Fatal("Fail to parse reverse proxy url", err)
	}

	reverseProxy := httputil.NewSingleHostReverseProxy(reverseProxyURL)
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
			config,
			oAuthBackend,
			tokenCache,
		},
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}
	err = server.ListenAndServeTLS(config.CertFile, config.KeyFile)
	if err != nil {
		log.Fatal("Failed to serve: ", err)
	}
}
