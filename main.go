package main

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"github.com/winguse/go-shp/authenticator"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	configFile = flag.String("config-file", "./config.json", "Config file")
	buffPool   = sync.Pool{
		New: func() interface{} {
			return make([]byte, 32*1024)
		},
	}
)

type configuration struct {
	UpstreamAddr    string
	ListenAddr      string
	CertFile        string
	KeyFile         string
	Auth            map[string]string
	AuthURL         string
	Trigger407Token string
}

type defaultHandler struct {
	reverseProxy *httputil.ReverseProxy
	config       configuration
}

type h2Wrapper struct {
	responseWriter http.ResponseWriter
	body           io.ReadCloser
}

func (h *h2Wrapper) Write(p []byte) (n int, err error) {
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

	n, err = h.responseWriter.Write(p)
	if err != nil {
		log.Printf("Flush writer error in write response: %s\n", err)
		return
	}
	if f, ok := h.responseWriter.(http.Flusher); ok {
		f.Flush()
	}
	return
}

func (h *h2Wrapper) Read(p []byte) (n int, err error) {
	return h.body.Read(p)
}

var headerBlackList = map[string]bool{}

func (h *defaultHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	if h.config.Auth[pair[0]] == pair[1] {
		return true, pair[0]
	}

	if h.config.AuthURL == "" {
		return false, "PasswordIncorrect " + pair[0]
	}

	email, err := authenticator.Check(h.config.AuthURL, pair[1])
	if err == nil && *email == pair[0] {
		return true, pair[0]
	}

	return false, "InvalidToken " + pair[0]
}

func proxy(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		handleTunneling(w, r)
	} else {
		handleHTTP(w, r)
	}
}

func (h *defaultHandler) handleReverseProxy(w http.ResponseWriter, r *http.Request) {
	h.reverseProxy.ServeHTTP(w, r)
}

func handleTunneling(w http.ResponseWriter, r *http.Request) {
	destConn, err := net.DialTimeout("tcp", r.Host, 10*time.Second)
	defer destConn.Close()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
	if r.ProtoMajor == 2 {
		w.(http.Flusher).Flush() // must flush, or the client won't start the connection
		defer r.Body.Close()
		transport(destConn, &h2Wrapper{w, r.Body})
	} else {
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			http.Error(w, "Hijacking not supported", http.StatusInternalServerError)
			return
		}
		clientConn, _, err := hijacker.Hijack()
		defer clientConn.Close()
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
		}
		transport(destConn, clientConn)
	}
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

func handleHTTP(w http.ResponseWriter, req *http.Request) {
	if req.ProtoMajor == 2 {
		req.URL.Scheme = "http"
		req.URL.Host = req.Host
	}
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	defer resp.Body.Close()
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
	server := &http.Server{
		Addr: config.ListenAddr,
		Handler: &defaultHandler{
			reverseProxy,
			config,
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
