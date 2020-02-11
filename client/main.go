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

var errPolicySkip = errors.New("POLICY_SKIP")

// Config is the config for the client
type Config struct {
	Username        string          `yaml:"username"`
	Token           string          `yaml:"token"`
	AuthBasePath    string          `yaml:"auth_base_path"`
	ListenPort      int             `yaml:"listen_port"`
	Proxies         []*Proxy        `yaml:"proxies"`
	Rules           []*Rule         `yaml:"rules"`
	UnmatchedPolicy UnmatchedPolicy `yaml:"unmatched_policy"`
}

// ----

type connCreation struct {
	conn remoteConn
	err  error
	via  string
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
	config               *Config
	h2Transport          *http.Transport
	client               *http.Client
	h1Transport          *http.Transport
	proxyMap             map[string]*Proxy
	detectionFailDomains map[string]time.Time
}

func genPossibleSearches(domain string) []string {
	parts := strings.Split(domain, ".")
	length := len(parts)
	search := ""
	searches := make([]string, length)
	for i := length - 1; i >= 0; i-- {
		if i != length-1 {
			search = "." + search
		}
		search = parts[i] + search
		searches[length-1-i] = search
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
			return time.Now().Sub(expires).Seconds() < s.config.UnmatchedPolicy.DetectExpiresSecond
		}
	}
	return false
}

func (s *shpClient) addDetectionFailDomain(domain string) {
	parts := strings.Split(domain, ".")
	length := len(parts)
	if length > 2 {
		domain = strings.Join(parts[length-2:2], ".")
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
	if activeHosts == nil || len(activeHosts) == 0 { // if there is no hosts, say all down, select the original list
		activeHosts = proxy.Hosts
	}
	length := len(activeHosts)
	if proxy.SelectPolicy == ProxySelectPolicyRandomOnSimilarLowestLatency && length > 1 && proxy.latencyMap != nil {
		lowestLatency := proxy.latencyMap[activeHosts[0]]
		similarCount := 1
		for i := 1; i < length; i++ {
			if proxy.latencyMap[activeHosts[0]].Milliseconds() < 200 || proxy.latencyMap[activeHosts[0]] < lowestLatency*3/2 {
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
		detectReq, _ := http.NewRequest("GET", "http://"+originalReq.Host+"/favicon.ico", nil)
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
		log.Printf("%s via: DIRECT\n", originalReq.Host)
		resp, respErr = s.h1Transport.RoundTrip(originalReq)
	} else {
		log.Printf("%s via: PROXY %s\n", originalReq.Host, proxyHost)
		originalReq.URL.Scheme = "https"
		originalReq.URL.Host = proxyHost
		originalReq.Close = false
		originalReq.Header.Add("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(s.config.Username+":"+s.config.Token)))
		resp, respErr = s.h2Transport.RoundTrip(originalReq)
	}

	if respErr != nil {
		log.Printf("http: proxy error: %v", respErr)
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
	utils.CopyAndPrintError(responseWriter, resp.Body)
}

func (s *shpClient) buildTunnel(host string, proxyHost string) (remoteConn, error) {
	pr, pw := io.Pipe()
	request := http.Request{
		Method: http.MethodConnect,
		URL: &url.URL{
			Scheme: "https",
			Host:   proxyHost,
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
			log.Printf("%s connection failed.\n", connCreation.via)
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

	readClientBuff := utils.BuffPool.Get().([]byte)
	defer utils.BuffPool.Put(readClientBuff)

	size, err := localConn.Read(readClientBuff)
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
		_, writeErr := connOpenSuccess.conn.Write(readClientBuff[:size])
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
				_, writeErr := connCreation.conn.Write(readClientBuff[:size])
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

	log.Printf("%s via: %s %s\n", req.Host, successCreation.via, proxyHost)
	remoteConn := successCreation.conn
	go func() {
		atomic.AddInt32(&activeLocal2Remote, 1)
		defer atomic.AddInt32(&activeLocal2Remote, -1)
		// local -> remote
		defer remoteConn.CloseWrite()
		utils.CopyAndPrintError(remoteConn, localConn)
	}()
	atomic.AddInt32(&activeRemote2Local, 1)
	defer atomic.AddInt32(&activeRemote2Local, -1)
	// remote -> local
	defer remoteConn.CloseRead()
	utils.CopyAndPrintError(localConn, remoteConn)
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
			startTime := time.Now()
			req, _ := http.NewRequest("GET", "https://"+host+s.config.AuthBasePath+"health", nil)
			resp, err := s.h2Transport.RoundTrip(req)
			if err != nil { // || resp.StatusCode != http.StatusOK {
				hostLatency[host] = time.Hour
				log.Printf("%s time out or non-OK response.\n", host)
			} else {
				hostLatency[host] = time.Now().Sub(startTime)
				log.Printf("%s latency %d ms %d.\n", host, hostLatency[host].Milliseconds(), resp.StatusCode)
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
			log.Printf(">>>>> active %d, local -> remote %d, remote -> local: %d\n", activeConnCount, activeLocal2Remote, activeRemote2Local)
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
			Timeout:   3 * time.Second,
			KeepAlive: 30 * time.Second,
			DualStack: true,
		}).DialContext,
		MaxIdleConns:          64,
		IdleConnTimeout:       90 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   3 * time.Second,
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
		MaxIdleConns:          64,
		IdleConnTimeout:       90 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     false,
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
	log.Printf("Local proxy starts listening %d\n", s.config.ListenPort)
	server.ListenAndServe()
}
