package main

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/winguse/go-shp/auth"
	"github.com/winguse/go-shp/utils"
	"golang.org/x/net/http2"
)

var activeConnCount int32
var activeRemote2Local int32
var activeLocal2Remote int32

var configFilePath = flag.String("config", "./config.yaml", "the config file path.")

// DomainPolicy the policies when a domain is not listed
type DomainPolicy int

const (
	// DomainPolicyDirect connection
	DomainPolicyDirect DomainPolicy = 0
	// DomainPolicyProxy connection
	DomainPolicyProxy DomainPolicy = 1
	// DomainPolicyDetect try both Direct and Proxy to see which one works
	DomainPolicyDetect DomainPolicy = 2
)

var errPolicySkip = errors.New("POLICY_SKIP")

// Config is the config for the client
type Config struct {
	Username     string `yaml:"username"`
	Token        string `yaml:"token,omitempty"`
	RefreshToken string `yaml:"refresh_token,omitempty"`
	ProxyHost    string `yaml:"proxy_host"`
	AuthBasePath string `yaml:"auth_base_path"`
	ListenPort   int    `yaml:"listen_port"`

	DirectDomains []string `yaml:"direct_domains"`
	ProxyDomains  []string `yaml:"proxy_domains"`

	UnknownDomainPolicy DomainPolicy `yaml:"unknown_domain_policy"`
}

// ----

type channelCreation struct {
	conn remoteConn
	err  error
	via  DomainPolicy
}

type httpRequestResult struct {
	resp *http.Response
	err  error
	via  DomainPolicy
}

type remoteConn interface {
	io.Reader
	io.Writer
	CloseRead() error
	CloseWrite() error
	Close() error
}

type h2Proxy struct {
	r  io.ReadCloser
	pw *io.PipeWriter
}

func (h *h2Proxy) Read(p []byte) (n int, err error) {
	return h.r.Read(p)
}

func (h *h2Proxy) Write(p []byte) (n int, err error) {
	return h.pw.Write(p)
}

func (h *h2Proxy) CloseRead() error {
	return h.r.Close()
}

func (h *h2Proxy) CloseWrite() error {
	return h.pw.Close()
}

func (h *h2Proxy) Close() error {
	err := h.CloseRead()
	if err != nil {
		return err
	}
	return h.CloseWrite()
}

// ------ main logic starts ------

type shpClient struct {
	config       *Config
	h2Transport  *http2.Transport
	client       *http.Client
	h1Transport  *http.Transport
	domainPolicy map[string]DomainPolicy
}

func (s *shpClient) getPolicy(domain string) DomainPolicy {
	parts := strings.Split(domain, ".")
	length := len(parts)
	search := ""
	for i := length - 1; i >= 0; i-- {
		if i != length-1 {
			search = "." + search
		}
		search = parts[i] + search
		policy, ok := s.domainPolicy[search]
		if ok {
			return policy
		}
	}
	return s.config.UnknownDomainPolicy
}

func (s *shpClient) handleHTTP(responseWriter http.ResponseWriter, originalReq *http.Request, policy DomainPolicy) {
	respCh := make(chan *httpRequestResult, 2)
	proxiedReq := originalReq.Clone(originalReq.Context())
	directReq := originalReq.Clone(originalReq.Context())

	// TODO we will try direct first, if any error try proxy
	// TODO req.Body cannot be sent to two upstream
	var directErr error
	var wg sync.WaitGroup
	wg.Add(1)

	go func() {
		defer wg.Done()
		if policy == DomainPolicyProxy {
			directErr = errPolicySkip
			respCh <- &httpRequestResult{nil, errPolicySkip, DomainPolicyDirect}
			return
		}
		if directReq.ProtoMajor == 2 {
			directReq.URL.Scheme = "http"
			directReq.URL.Host = directReq.Host
		}
		resp, err := s.h1Transport.RoundTrip(directReq)
		directErr = err
		respCh <- &httpRequestResult{resp, err, DomainPolicyDirect}
	}()

	go func() {
		wg.Wait()
		if policy == DomainPolicyDirect {
			respCh <- &httpRequestResult{nil, errPolicySkip, DomainPolicyProxy}
			return
		}
		if directErr == nil {
			respCh <- &httpRequestResult{nil, errors.New("skip because direct is ok"), DomainPolicyProxy}
			return
		}
		proxiedReq.URL.Scheme = "https"
		proxiedReq.URL.Host = s.config.ProxyHost
		proxiedReq.Close = false
		proxiedReq.Header.Add("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(s.config.Username+":"+s.config.Token)))

		res, err := s.h2Transport.RoundTrip(proxiedReq)
		respCh <- &httpRequestResult{res, err, DomainPolicyProxy}
	}()

	checkErrors := func() *httpRequestResult {
		conn := <-respCh
		if conn.err != nil && conn.err != io.EOF {
			log.Printf("Found HTTP Proxy Error %s %d\n", conn.err, conn.via)
		}
		return conn
	}

	var respResult *httpRequestResult

	for i := 0; i < 2; i++ {
		respResult = checkErrors()
		if respResult.err == nil || respResult.err == io.EOF {
			go func() {
				for ; i < 2; i++ {
					checkErrors()
				}
			}()
			break
		}
	}

	if respResult.err != nil {
		log.Printf("http: proxy error: %v", respResult.err)
		responseWriter.WriteHeader(http.StatusBadGateway)
		return
	}

	log.Printf("Using %d for %s\n", respResult.via, originalReq.URL.String())

	resp := respResult.resp

	defer resp.Body.Close()
	for k, vv := range resp.Header {
		for _, v := range vv {
			responseWriter.Header().Add(k, v)
		}
	}
	responseWriter.WriteHeader(resp.StatusCode)
	if fl, ok := responseWriter.(http.Flusher); ok {
		fl.Flush()
	}
	utils.CopyAndPrintError(responseWriter, resp.Body)
}

func (s *shpClient) buildTunnel(host string) (remoteConn, error) {
	pr, pw := io.Pipe()
	request := http.Request{
		Method: http.MethodConnect,
		URL: &url.URL{
			Scheme: "https",
			Host:   s.config.ProxyHost,
		},
		Header: map[string][]string{
			"Proxy-Authorization": []string{"Basic " + base64.StdEncoding.EncodeToString([]byte(s.config.Username+":"+s.config.Token))},
		},
		Host: host,
		Body: pr,
	}

	response, err := s.client.Do(&request)

	if err != nil {
		log.Printf("error when sending request %s\n", err)
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		errMsg := fmt.Sprintf("Expected status OK, but %d\n", response.StatusCode)
		log.Printf(errMsg)
		return nil, errors.New(errMsg)
	}

	return &h2Proxy{response.Body, pw}, nil
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

func (s *shpClient) handleTunneling(responseWriter http.ResponseWriter, req *http.Request, policy DomainPolicy) {

	httpOKSent := false
	var httpOKMu sync.Mutex

	var firstReadWg sync.WaitGroup
	firstReadWg.Add(1)
	local2remoteBuf := utils.BuffPool.Get().([]byte)
	defer utils.BuffPool.Put(local2remoteBuf)
	var local2remoteSize int
	var local2remoteError error

	remoteConnCh := make(chan *channelCreation, 2)

	go func() {
		local2remoteSize, local2remoteError = req.Body.Read(local2remoteBuf)
		firstReadWg.Done()
	}()

	createConn := func(via DomainPolicy, host string, build func(string) (remoteConn, error)) {
		if policy != DomainPolicyDetect && policy != via {
			remoteConnCh <- &channelCreation{nil, errPolicySkip, via}
			return
		}

		conn, err := build(host)

		if err == nil && !httpOKSent {
			httpOKMu.Lock()
			if !httpOKSent {
				httpOKSent = true
				responseWriter.WriteHeader(http.StatusOK)
			}
			httpOKMu.Unlock()
		}

		result := &channelCreation{
			conn, err, via,
		}
		if result.err == nil {
			firstReadWg.Wait()
			if local2remoteError == nil || local2remoteError == io.EOF {
				_, err = conn.Write(local2remoteBuf[:local2remoteSize])
				result.err = err
			} else {
				result.err = errors.New("first read failed")
			}
		}
		remoteConnCh <- result
	}

	go createConn(DomainPolicyProxy, req.Host, s.buildTunnel)
	go createConn(DomainPolicyDirect, req.Host, func(host string) (remoteConn, error) {
		return createTCPConn(host)
	})

	checkErrors := func() *channelCreation {
		conn := <-remoteConnCh
		if conn.err != nil && conn.err != io.EOF {
			log.Printf("Found connection error %s %d\n", conn.err, conn.via)
		}
		return conn
	}

	var remoteConnCreation *channelCreation

	for i := 0; i < 2; i++ {
		remoteConnCreation = checkErrors()
		if remoteConnCreation.err == nil || remoteConnCreation.err == io.EOF {
			go func() {
				for ; i < 2; i++ {
					createdConn := checkErrors()
					if (createdConn.err == nil || createdConn.err == io.EOF) && createdConn.conn != nil {
						createdConn.conn.Close()
					}
				}
			}()
			break
		}
	}

	log.Printf("Selected %d connection for %s\n", remoteConnCreation.via, req.Host)

	if remoteConnCreation.err != nil {
		log.Printf("error for %s\n", remoteConnCreation.err)
		http.Error(responseWriter, remoteConnCreation.err.Error(), http.StatusServiceUnavailable)
		return
	}

	remoteConn := remoteConnCreation.conn
	defer remoteConn.Close()

	hijacker, ok := responseWriter.(http.Hijacker)
	if !ok {
		http.Error(responseWriter, "Hijacking not supported", http.StatusInternalServerError)
		return
	}
	conn, _, err := hijacker.Hijack()
	if err != nil {
		log.Printf("Failed to Hijack")
		return
	}

	defer conn.Close()

	go func() {
		atomic.AddInt32(&activeLocal2Remote, 1)
		defer atomic.AddInt32(&activeLocal2Remote, -1)
		// local -> remote
		defer remoteConn.CloseWrite()
		utils.CopyAndPrintError(remoteConn, conn)
	}()

	atomic.AddInt32(&activeRemote2Local, 1)
	defer atomic.AddInt32(&activeRemote2Local, -1)
	// remote -> local
	defer remoteConn.CloseRead()
	utils.CopyAndPrintError(conn, remoteConn)
}

func (s *shpClient) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	atomic.AddInt32(&activeConnCount, 1)
	defer atomic.AddInt32(&activeConnCount, -1)

	log.Printf("Started %s %s %s\n", req.Method, req.URL.Scheme, req.URL.String())
	defer log.Printf("Closed  %s %s %s\n", req.Method, req.URL.Scheme, req.URL.String())

	policy := s.getPolicy(req.URL.Hostname())

	if req.Method == http.MethodConnect {
		s.handleTunneling(rw, req, policy)
	} else {
		s.handleHTTP(rw, req, policy)
	}
}

func (s *shpClient) StartRefreshToken() {
	if s.config.RefreshToken == "" {
		return
	}

	expires := time.Now()

	refresh := func() {
		if time.Now().Add(time.Minute * 5).Before(expires) {
			return
		}
		log.Println("Refreshing token...")
		url := "https://" + s.config.ProxyHost + s.config.AuthBasePath + "refresh"
		requestBody := new(bytes.Buffer)
		err := json.NewEncoder(requestBody).Encode(&auth.RefreshTokenInfo{RefreshToken: s.config.RefreshToken})
		if err != nil {
			log.Fatal(err)
		}
		resp, err := http.DefaultClient.Post(url, "application/json", requestBody)
		if err != nil {
			log.Printf("Failed to call token refresh API: %s\n", err)
			return
		}
		if resp.StatusCode != http.StatusOK {
			log.Printf("Failed to call token refresh API, returnted %d\n", resp.StatusCode)
			return
		}
		accessTokenInfo := &auth.AccessTokenInfo{}
		err = json.NewDecoder(resp.Body).Decode(accessTokenInfo)
		if err != nil {
			log.Printf("Failed to decode token refresh API response: %s\n", err)
			return
		}
		s.config.Token = accessTokenInfo.AccessToken
		expires = time.Now().Add(time.Duration(int64(accessTokenInfo.ExpiresInSec)) * time.Second)
		log.Println("Token refreshed.")
	}

	go func() {
		refresh()
		for range time.Tick(time.Second * 15) {
			refresh()
		}
	}()

}

func main() {
	// go func() {
	// 	for range time.Tick(time.Second) {
	// 		log.Printf(">>>>> active %d, local -> remote %d, remote -> local: %d\n", activeConnCount, activeLocal2Remote, activeRemote2Local)
	// 	}
	// }()

	flag.Parse()

	config := &Config{}
	utils.LoadConfigFile(*configFilePath, config)

	s := &shpClient{
		config: config,
	}
	s.h2Transport = &http2.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}
	s.client = &http.Client{
		Transport: s.h2Transport,
	}
	s.h1Transport = &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   3 * time.Second,
			KeepAlive: 30 * time.Second,
			DualStack: true,
		}).DialContext,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	s.domainPolicy = map[string]DomainPolicy{}
	for _, domain := range s.config.DirectDomains {
		s.domainPolicy[domain] = DomainPolicyDirect
	}
	for _, domain := range s.config.ProxyDomains {
		s.domainPolicy[domain] = DomainPolicyProxy
	}

	server := &http.Server{
		Addr:    "127.0.0.1:" + strconv.Itoa(s.config.ListenPort),
		Handler: s,
	}

	s.StartRefreshToken()

	for s.config.Token == "" {
		log.Println("Token is empty, waiting for refresh..")
		time.Sleep(time.Second)
	}

	log.Printf("Local proxy starts listening %d\n", s.config.ListenPort)
	server.ListenAndServe()
}
