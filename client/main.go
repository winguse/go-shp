package main

import (
	"crypto/tls"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/winguse/go-shp/utils"
)

var activeConnCount int32
var activeRemote2Local int32
var activeLocal2Remote int32

var logger = utils.NewLogger(utils.InfoLevel)
var configFilePath = flag.String("config", "./config.yaml", "the config file path.")

// ProxySelectPolicy the policy to select proxy
type ProxySelectPolicy string

const (
	// ProxySelectPolicyRandom random
	ProxySelectPolicyRandom ProxySelectPolicy = "RANDOM"
	// ProxySelectPolicyLatency random
	ProxySelectPolicyLatency ProxySelectPolicy = "LATENCY"
	// ProxySelectPolicyRandomOnSimilarLowestLatency find the lowest latency, if the other is < 150% or < 200ms, then put them into consideration
	ProxySelectPolicyRandomOnSimilarLowestLatency ProxySelectPolicy = "RANDOM_ON_SIMILAR_LOWEST_LATENCY"
	// DirectProxyName direct is reserved proxy name
	DirectProxyName string = "DIRECT"
)

// Rule of proxy
type Rule struct {
	ProxyName string   `yaml:"proxy_name"` // reserved names: DIRECT
	Domains   []string `yaml:"domains"`
	domainSet map[string]bool
}

// Proxy definition
type Proxy struct {
	Name         string            `yaml:"name"`
	Hosts        []string          `yaml:"hosts,omitempty"`
	SelectPolicy ProxySelectPolicy `yaml:"select_policy,omitempty"` // RANDOM / LATENCY
	activeHosts  []string
	latencyMap   map[string]time.Duration
}

// DomainPolicy the policies when a domain is not listed
type DomainPolicy string

const (
	// DomainPolicyDirect connection
	DomainPolicyDirect DomainPolicy = "DIRECT"
	// DomainPolicyProxy connection
	DomainPolicyProxy DomainPolicy = "PROXY"
	// DomainPolicyDetect try both Direct and Proxy to see which one works
	DomainPolicyDetect DomainPolicy = "DETECT"
)

// UnmatchedPolicy policy when the domain is not matching any rules
type UnmatchedPolicy struct {
	ProxyName           string  `yaml:"proxy_name"`
	Detect              bool    `yaml:"detect"`
	DetectDelayMs       int     `yaml:"detect_delay_ms"`
	DetectExpiresSecond float64 `yaml:"detect_expires_second"`
}

// Credential represents authentication and auth endpoint configuration for a host
type Credential struct {
	Username     string `yaml:"username"`
	Token        string `yaml:"token"`
	AuthBasePath string `yaml:"auth_base_path,omitempty"`
}

// Config is the config for the client
type Config struct {
	Credentials     map[string]*Credential `yaml:"credentials"`
	ListenPort      int                    `yaml:"listen_port"`
	Proxies         []*Proxy               `yaml:"proxies"`
	Rules           []*Rule                `yaml:"rules"`
	UnmatchedPolicy UnmatchedPolicy        `yaml:"unmatched_policy"`
}

// ----

type connCreation struct {
	conn remoteConn
	err  error
	via  string
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
	config               *Config
	h2Transport          *http.Transport
	client               *http.Client
	h1Transport          *http.Transport
	proxyMap             map[string]*Proxy
	detectionFailDomains map[string]time.Time
}

func (s *shpClient) getCredential(host string) *Credential {
	if s.config == nil || s.config.Credentials == nil {
		return nil
	}
	// Direct match
	if cred, ok := s.config.Credentials[host]; ok && cred != nil {
		return cred
	}

	hostname := host
	port := ""
	if h, p, err := net.SplitHostPort(host); err == nil {
		hostname = h
		port = p
	}

	if port == "" || port == "443" {
		if cred, ok := s.config.Credentials[hostname]; ok && cred != nil {
			return cred
		}
		if cred, ok := s.config.Credentials[hostname+":443"]; ok && cred != nil {
			return cred
		}
	} else {
		if cred, ok := s.config.Credentials[hostname]; ok && cred != nil {
			return cred
		}
	}

	// Fallback to '_'
	if cred, ok := s.config.Credentials["_"]; ok && cred != nil {
		return cred
	}

	return nil
}

func (s *shpClient) getBasicAuthToken(proxyHost string) string {
	cred := s.getCredential(proxyHost)
	if cred == nil || (cred.Username == "" && cred.Token == "") {
		return ""
	}
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(cred.Username+":"+cred.Token))
}

func genPossibleSearches(domain string) []string {
	dotCount := strings.Count(domain, ".")
	searches := make([]string, dotCount+1)
	searches[dotCount] = domain

	idx := 0
	for i := dotCount - 1; i >= 0; i-- {
		dotIdx := strings.IndexByte(domain[idx:], '.')
		if dotIdx == -1 {
			break
		}
		idx += dotIdx + 1
		searches[i] = domain[idx:]
	}
	return searches
}

func (s *shpClient) findProxyName(searches []string) (string, bool) {
	for _, rule := range s.config.Rules {
		for _, search := range searches {
			_, ok := rule.domainSet[search]
			if ok {
				return rule.ProxyName, false
			}
		}
	}
	return s.config.UnmatchedPolicy.ProxyName, s.config.UnmatchedPolicy.Detect
}

func (s *shpClient) isDetectionFailDomain(searches []string) bool {
	for _, search := range searches {
		expires, ok := s.detectionFailDomains[search]
		if ok {
			return time.Since(expires).Seconds() < s.config.UnmatchedPolicy.DetectExpiresSecond
		}
	}
	return false
}

func (s *shpClient) addDetectionFailDomain(domain string) {
	parts := strings.Split(domain, ".")
	length := len(parts)
	if length > 2 {
		domain = strings.Join(parts[length-2:], ".")
	}
	newMap := make(map[string]time.Time)
	now := time.Now()
	newMap[domain] = now
	for k, v := range s.detectionFailDomains {
		if now.Sub(v).Seconds() < s.config.UnmatchedPolicy.DetectExpiresSecond {
			newMap[k] = v
		}
	}
	s.detectionFailDomains = newMap
}

func (s *shpClient) getPolicy(domain string) (string, bool) {
	searches := genPossibleSearches(domain)
	proxyName, detect := s.findProxyName(searches)

	if detect && s.isDetectionFailDomain(searches) {
		detect = false
	}

	if proxyName == DirectProxyName {
		return "", detect
	}

	proxy := s.proxyMap[proxyName]
	activeHosts := proxy.activeHosts
	if len(activeHosts) == 0 { // if there is no hosts, say all down, select the original list
		activeHosts = proxy.Hosts
	}
	length := len(activeHosts)
	if proxy.SelectPolicy == ProxySelectPolicyRandomOnSimilarLowestLatency && length > 1 && proxy.latencyMap != nil {
		lowestLatency := proxy.latencyMap[activeHosts[0]]
		similarCount := 1
		for i := 1; i < length; i++ {
			if proxy.latencyMap[activeHosts[i]].Milliseconds() < 200 || proxy.latencyMap[activeHosts[i]] < lowestLatency*3/2 {
				similarCount++
			} else {
				break
			}
		}
		selectedHost := activeHosts[rand.Int()%similarCount]
		return selectedHost, detect
	}
	if proxy.SelectPolicy == ProxySelectPolicyLatency {
		return activeHosts[0], detect
	}
	selectedHost := activeHosts[rand.Int()%length]
	return selectedHost, detect
}

func (s *shpClient) handleHTTP(responseWriter http.ResponseWriter, originalReq *http.Request, proxyHost string, detect bool) {
	// to keep HTTP request idempotent, if we need to send two request, direct HTTP is first

	if proxyHost != "" && detect { // will send two request
		detectReq, _ := http.NewRequest("GET", "https://"+originalReq.Host+"/favicon.ico", nil)
		_, err := s.h1Transport.RoundTrip(detectReq)
		if err == nil { // direct conn is OK, then skip using proxy
			proxyHost = ""
		} else {
			s.addDetectionFailDomain(originalReq.Host)
		}
	}

	resp := (*http.Response)(nil)
	respErr := error(nil)

	if proxyHost == "" {
		logger.Info("%s via: DIRECT\n", originalReq.Host)
		resp, respErr = s.h1Transport.RoundTrip(originalReq)
	} else {
		logger.Info("%s via: PROXY %s\n", originalReq.Host, proxyHost)
		originalReq.URL.Scheme = "https"
		originalReq.URL.Host = proxyHost
		originalReq.Close = false
		authToken := s.getBasicAuthToken(proxyHost)
		if authToken != "" {
			originalReq.Header.Set("Proxy-Authorization", authToken)
		}
		resp, respErr = s.h2Transport.RoundTrip(originalReq)
	}

	if respErr != nil {
		logger.Error("http: proxy error: %v", respErr)
		http.Error(responseWriter, respErr.Error(), http.StatusBadGateway)
		return
	}

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
	utils.CopyAndPrintError(responseWriter, resp.Body, logger)
}

func (s *shpClient) buildTunnel(host string, proxyHost string) (remoteConn, error) {
	pr, pw := io.Pipe()
	header := make(http.Header)
	authToken := s.getBasicAuthToken(proxyHost)
	if authToken != "" {
		header.Set("Proxy-Authorization", authToken)
	}
	request := http.Request{
		Method: http.MethodConnect,
		URL: &url.URL{
			Scheme: "https",
			Host:   proxyHost,
		},
		Header: header,
		Host:   host,
		Body:   pr,
	}

	response, err := s.client.Do(&request)

	if err != nil {
		logger.Error("error when sending request %s\n", err)
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		errMsg := fmt.Sprintf("Expected status OK, but %d\n", response.StatusCode)
		logger.Error("%s", errMsg)
		return nil, errors.New(errMsg)
	}

	return &h2Proxy{response.Body, pw}, nil
}

func createTCPConn(host string) (*net.TCPConn, error) {
	if !strings.Contains(host, ":") {
		host = net.JoinHostPort(host, "443")
	}
	destConn, err := net.DialTimeout("tcp", host, 10*time.Second)
	if err != nil {
		return nil, err
	}
	if tcpConn, ok := destConn.(*net.TCPConn); ok {
		return tcpConn, nil
	}
	return nil, errors.New("failed to cast net.Conn to net.TCPConn")
}

func (s *shpClient) handleTunneling(responseWriter http.ResponseWriter, req *http.Request, proxyHost string, detect bool) {
	openConnCh := make(chan *connCreation)
	writeConnCh := make(chan *connCreation)
	connOpenAttemptCount := 0
	connOpenAttemptReturnedCount := 0
	connOpenAttemptFailedCount := 0
	connOpenSuccess := (*connCreation)(nil)
	connWriteAttemptCount := 0
	connWriteAttemptReturnedCount := 0

	if proxyHost == "" || detect {
		connOpenAttemptCount++
		// init direct
		go func() {
			conn, err := createTCPConn(req.Host)
			if detect && err != nil {
				s.addDetectionFailDomain(req.Host)
			}
			result := &connCreation{
				conn, err, "DIRECT",
			}
			openConnCh <- result
		}()
	}

	if proxyHost != "" {
		connOpenAttemptCount++
		// init proxy
		go func() {
			if detect {
				time.Sleep(time.Duration(s.config.UnmatchedPolicy.DetectDelayMs) * time.Millisecond) // sleep proxy on detect as we prefer direct
			}
			conn, err := s.buildTunnel(req.Host, proxyHost)
			result := &connCreation{
				conn, err, "PROXY",
			}
			openConnCh <- result
		}()
	}

	for connOpenAttemptReturnedCount < connOpenAttemptCount {
		connCreation := <-openConnCh
		connOpenAttemptReturnedCount++
		if connCreation.err != nil {
			logger.Error("%s connection failed.\n", connCreation.via)
			connOpenAttemptFailedCount++
		} else {
			connOpenSuccess = connCreation
			break
		}
	}

	if connOpenAttemptFailedCount == connOpenAttemptCount {
		http.Error(responseWriter, "Connection fail.", http.StatusBadGateway)
		return
	}

	responseWriter.WriteHeader(http.StatusOK)

	localConn, _, err := responseWriter.(http.Hijacker).Hijack()
	if err != nil {
		log.Fatal("Failed to Hijack") // usually will not go here
	}
	defer localConn.Close()

	readClientBuff := utils.BuffPool.Get().(*[]byte)
	defer utils.BuffPool.Put(readClientBuff)

	size, err := localConn.Read(*readClientBuff)
	if err != nil {
		// local read failed
		connOpenSuccess.conn.Close()
		for connOpenAttemptReturnedCount < connOpenAttemptCount {
			remoteConn := <-openConnCh
			connOpenAttemptReturnedCount++
			if remoteConn.err == nil {
				remoteConn.conn.Close()
			}
		}
		return
	}

	connWriteAttemptCount++
	go func() {
		_, writeErr := connOpenSuccess.conn.Write((*readClientBuff)[:size])
		if writeErr != nil {
			connOpenSuccess.err = writeErr
		}
		writeConnCh <- connOpenSuccess
	}()

	if connOpenAttemptReturnedCount < connOpenAttemptCount {
		connWriteAttemptCount++
		go func() {
			connCreation := <-openConnCh
			connOpenAttemptReturnedCount++
			if connCreation.err == nil {
				_, writeErr := connCreation.conn.Write((*readClientBuff)[:size])
				if writeErr != nil {
					connCreation.err = writeErr
				}
			}
			writeConnCh <- connCreation
		}()
	}

	successCreation := (*connCreation)(nil)

	for connWriteAttemptReturnedCount < connWriteAttemptCount {
		connCreation := <-writeConnCh
		connWriteAttemptReturnedCount++
		if connCreation.err == nil {
			go func() {
				for connWriteAttemptReturnedCount < connWriteAttemptCount {
					connCreation := <-writeConnCh
					connWriteAttemptReturnedCount++
					if connCreation.err == nil {
						connCreation.conn.Close()
					}
				}
			}()
			successCreation = connCreation
			break
		}
		if connCreation.conn != nil {
			connCreation.conn.Close()
		}
	}

	if successCreation == nil {
		return
	}

	logger.Debug("%s via: %s %s\n", req.Host, successCreation.via, proxyHost)
	remoteConn := successCreation.conn
	go func() {
		atomic.AddInt32(&activeLocal2Remote, 1)
		defer atomic.AddInt32(&activeLocal2Remote, -1)
		// local -> remote
		defer remoteConn.CloseWrite()
		utils.CopyAndPrintError(remoteConn, localConn, logger)
	}()
	atomic.AddInt32(&activeRemote2Local, 1)
	defer atomic.AddInt32(&activeRemote2Local, -1)
	// remote -> local
	defer remoteConn.CloseRead()
	utils.CopyAndPrintError(localConn, remoteConn, logger)
}

func (s *shpClient) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	atomic.AddInt32(&activeConnCount, 1)
	defer atomic.AddInt32(&activeConnCount, -1)

	host, detect := s.getPolicy(req.URL.Hostname())

	if req.Method == http.MethodConnect {
		s.handleTunneling(rw, req, host, detect)
	} else {
		s.handleHTTP(rw, req, host, detect)
	}
}

func (s *shpClient) checkProxies() {
	latencyTest := func() {
		hostLatency := make(map[string]time.Duration)
		for _, proxy := range s.config.Proxies {
			for _, host := range proxy.Hosts {
				hostLatency[host] = time.Hour
			}
		}

		for host := range hostLatency {
			cred := s.getCredential(host)
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
				req, _ = http.NewRequest("GET", "https://"+host+authBasePath+"health", nil)
			} else {
				isHealthCheck = false
				req, _ = http.NewRequest("HEAD", "https://"+host+"/", nil)
			}

			startTime := time.Now()
			resp, err := s.h2Transport.RoundTrip(req)
			if resp != nil && resp.Body != nil {
				resp.Body.Close()
			}
			if err != nil || (isHealthCheck && resp.StatusCode != http.StatusOK) {
				hostLatency[host] = time.Hour
				logger.Debug("%s time out or non-OK response.\n", host)
			} else {
				hostLatency[host] = time.Since(startTime)
				logger.Debug("%s latency %d ms.\n", host, hostLatency[host].Milliseconds())
			}
		}

		for _, proxy := range s.config.Proxies {
			activeHosts := make([]string, 0)
			latencyMap := make(map[string]time.Duration)
			for _, host := range proxy.Hosts {
				latencyMap[host] = hostLatency[host]
				if hostLatency[host] == time.Hour {
					continue
				}
				activeHosts = append(activeHosts, host)
			}
			sort.SliceStable(activeHosts, func(i, j int) bool {
				return hostLatency[activeHosts[i]] < hostLatency[activeHosts[j]]
			})
			proxy.activeHosts = activeHosts
			proxy.latencyMap = latencyMap
		}
	}
	latencyTest()
	for range time.Tick(time.Second * 60) {
		latencyTest()
	}
}

func main() {
	go func() {
		for range time.Tick(time.Second) {
			logger.Debug(">>>>> active %d, local -> remote %d, remote -> local: %d\n", activeConnCount, activeLocal2Remote, activeRemote2Local)
		}
	}()

	flag.Parse()

	config := &Config{}
	utils.LoadConfigFile(*configFilePath, config)

	s := &shpClient{
		config:               config,
		proxyMap:             make(map[string]*Proxy),
		detectionFailDomains: make(map[string]time.Time),
	}
	s.h2Transport = &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
		DialContext: (&net.Dialer{
			DualStack: true,
		}).DialContext,
		MaxIdleConns:      64,
		ForceAttemptHTTP2: true,
	}
	s.client = &http.Client{
		Transport: s.h2Transport,
	}
	s.h1Transport = &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			DualStack: true,
		}).DialContext,
		MaxIdleConns:      64,
		ForceAttemptHTTP2: false,
	}
	for _, rule := range config.Rules {
		rule.domainSet = make(map[string]bool)
		for _, domain := range rule.Domains {
			rule.domainSet[domain] = true
		}
	}
	for _, proxy := range config.Proxies {
		s.proxyMap[proxy.Name] = proxy
	}

	server := &http.Server{
		Addr:    "127.0.0.1:" + strconv.Itoa(s.config.ListenPort),
		Handler: s,
	}

	go s.checkProxies()
	logger.Info("Local proxy starts listening %d\n", s.config.ListenPort)
	server.ListenAndServe()
}
