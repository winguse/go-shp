package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

// Using OAuth as the authentication backend

// Config is the configuration for oauth backend
type Config struct {
	OAuth struct { // the same as oauth2.Config, but we need to attach yaml annotation here
		ClientID     string   `yaml:"client_id"`
		ClientSecret string   `yaml:"client_secret"`
		Endpoint     struct { // the same as oauth2.Endpoint, but we need to attach yaml annotation here
			AuthURL   string           `yaml:"auth_url"`
			TokenURL  string           `yaml:"token_url"`
			AuthStyle oauth2.AuthStyle `yaml:"auth_style"`
		} `yaml:"endpoint"`
		RedirectURL string   `yaml:"redirect_url"`
		Scopes      []string `yaml:"scopes"`
	} `yaml:"oauth"`
	TokenInfoAPI string `yaml:"token_info_api"`
	RenderJsSrc  string `yaml:"render_js_src"`
	ValidEmail   string `yaml:"valid_email"`
}

// OAuthBackend holding the runtime state
type OAuthBackend struct {
	config           *Config
	oauth2Config     *oauth2.Config
	RedirectBasePath string
	routeMap         map[string]func(http.ResponseWriter, *http.Request)
}

// RefreshTokenInfo the datastructure of refresh token
type RefreshTokenInfo struct {
	RefreshToken string `json:"refresh_token"`
}

// AccessTokenInfo the datastructure of access token
type AccessTokenInfo struct {
	AccessToken  string `json:"access_token"`
	ExpiresInSec int    `json:"expires_in"`
}

// TokenInfo the info of access token
type TokenInfo struct {
	RefreshToken  string `json:"refresh_token,omitempty"`
	AccessToken   string `json:"access_token,omitempty"`
	ExpiresInSec  int    `json:"expires_in"`
	IssuedTo      string `json:"issued_to"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
}

// GithubEmail is the email response from Github
type GithubEmail struct {
	Email      string `json:"email"`
	Primary    bool   `json:"primary"`
	Verified   bool   `json:"verified"`
	Visibility string `json:"visibility"`
}

// Init the OAuthBackend
func (o *OAuthBackend) Init(config *Config) error {
	redirectURL, err := url.Parse(config.OAuth.RedirectURL)
	if err != nil {
		return err
	}
	o.config = config
	o.oauth2Config = &oauth2.Config{
		ClientID:     config.OAuth.ClientID,
		ClientSecret: config.OAuth.ClientSecret,
		Endpoint: oauth2.Endpoint{
			AuthURL:   config.OAuth.Endpoint.AuthURL,
			TokenURL:  config.OAuth.Endpoint.TokenURL,
			AuthStyle: config.OAuth.Endpoint.AuthStyle,
		},
		RedirectURL: config.OAuth.RedirectURL,
		Scopes:      config.OAuth.Scopes,
	}
	o.RedirectBasePath = redirectURL.Path
	o.routeMap = map[string]func(http.ResponseWriter, *http.Request){
		"":           o.handleRoot,
		"refresh":    o.handleRefresh,
		"token-info": o.handleTokenInfo,
		"health":     o.handleHealthCheck,
		"logout":     o.handleLogout,
	}
	return nil
}

func getJSON(client *http.Client, url string, v interface{}) error {
	res, err := client.Get(url)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return errors.New(url + " returned " + res.Status + " instead of 2XX.")
	}
	dec := json.NewDecoder(res.Body)
	return dec.Decode(&v)
}

func makeJSONResponse(w http.ResponseWriter, v interface{}) {
	js, err := json.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	} else {
		w.Header().Add("Content-Type", "application/json")
		w.Write(js)
	}
}

// CheckRefreshToken is to do authentication directly by refresh token.
// It can be not the best paractice and slower, but it works. This will allow client don't need to worry about refreshing.
func (o *OAuthBackend) CheckRefreshToken(refreshToken string) (*TokenInfo, error) {
	token, err := o.refreshToken(refreshToken)
	if err != nil {
		return nil, err
	}
	return o.CheckAccessToken(token.AccessToken)
}

// CheckAccessToken if the access token is valid
func (o *OAuthBackend) CheckAccessToken(accessToken string) (*TokenInfo, error) {
	tokenInfo := &TokenInfo{}
	client := o.oauth2Config.Client(oauth2.NoContext, &oauth2.Token{AccessToken: accessToken})

	if strings.Contains(o.config.TokenInfoAPI, "api.github.com") {
		// check the token belongs to this application
		req, err := http.NewRequest(
			http.MethodPost,
			"https://api.github.com/applications/"+o.oauth2Config.ClientID+"/token",
			strings.NewReader("{\"access_token\":\""+accessToken+"\"}"))
		if err != nil {
			return nil, err
		}
		req.Header.Add("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(o.oauth2Config.ClientID+":"+o.oauth2Config.ClientSecret)))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return nil, errors.New("Github token api returned " + res.Status + " instead of 2XX.")
		}
		var githubEmails []GithubEmail
		err = getJSON(client, o.config.TokenInfoAPI, &githubEmails)
		if err != nil {
			return nil, err
		}
		for _, githubEmail := range githubEmails {
			if githubEmail.Primary {
				tokenInfo.Email = githubEmail.Email
				tokenInfo.AccessToken = accessToken
				tokenInfo.ExpiresInSec = 0x7fffffff
				tokenInfo.IssuedTo = o.oauth2Config.ClientID
				tokenInfo.VerifiedEmail = githubEmail.Verified
				break
			}
		}
	} else {
		err := getJSON(client, o.config.TokenInfoAPI, tokenInfo)
		if err != nil {
			return nil, err
		}
	}

	if tokenInfo.IssuedTo != o.oauth2Config.ClientID {
		return nil, errors.New("Access Token is not belongs to here")
	}
	if !tokenInfo.VerifiedEmail {
		return nil, errors.New("Your email is not verified")
	}
	if tokenInfo.ExpiresInSec < 5 {
		return nil, errors.New("Token expired")
	}
	matched, err := regexp.Match(o.config.ValidEmail, []byte(tokenInfo.Email))
	if err != nil {
		return nil, err
	}
	if !matched {
		return nil, errors.New("Your email is not allowed")
	}
	return tokenInfo, nil
}

func (o *OAuthBackend) refreshToken(refreshToken string) (*oauth2.Token, error) {
	oauthToken := &oauth2.Token{RefreshToken: refreshToken}
	tokenSource := o.oauth2Config.TokenSource(oauth2.NoContext, oauthToken)
	return tokenSource.Token()
}

func (o *OAuthBackend) makeTokenResponse(token *oauth2.Token, err error, w http.ResponseWriter) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
	} else {
		info, err := o.CheckAccessToken(token.AccessToken)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.Header().Add("Set-Cookie", "access_token="+token.AccessToken+"; Max-Age="+strconv.Itoa(info.ExpiresInSec)+"; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
		w.Header().Add("Set-Cookie", "refresh_token="+token.RefreshToken+"; Max-Age=31536000; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
		w.Header().Add("Set-Cookie", "email="+info.Email+"; Max-Age=31536000; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
		w.Header().Add("Referrer-Policy", "no-referrer")
		w.Header().Add("Content-Type", "text/html; charset=UTF-8")
		clientToken := token.AccessToken
		if token.RefreshToken != "" {
			clientToken = "SR:" + token.RefreshToken
		}
		w.Write([]byte("<script src='" + o.config.RenderJsSrc + "'></script><script>render('" + info.Email + "', '" + clientToken + "');</script>"))
	}
}

func (o *OAuthBackend) handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func (o *OAuthBackend) handleLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Set-Cookie", "email=; Max-Age=-1; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
	w.Header().Add("Set-Cookie", "access_token=; Max-Age=-1; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
	w.Header().Add("Set-Cookie", "refresh_token=; Max-Age=-1; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
	w.Header().Add("Location", o.RedirectBasePath)
	w.WriteHeader(http.StatusFound)
}

// handle User login
func (o *OAuthBackend) handleRoot(w http.ResponseWriter, r *http.Request) {
	accessTokenCookie, err := r.Cookie("access_token")
	if err == nil {
		o.makeTokenResponse(&oauth2.Token{AccessToken: accessTokenCookie.Value}, nil, w)
		return
	}

	refreshTokenCookie, err := r.Cookie("refresh_token")
	if err == nil {
		newToken, err := o.refreshToken(refreshTokenCookie.Value)
		o.makeTokenResponse(newToken, err, w)
		return
	}

	codeCookie, err := r.Cookie("code")
	if err == nil {
		w.Header().Add("Set-Cookie", "code=; Max-Age=-1; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
		newToken, err := o.oauth2Config.Exchange(oauth2.NoContext, codeCookie.Value)
		o.makeTokenResponse(newToken, err, w)
		return
	}

	code := r.URL.Query().Get("code")
	if code != "" {
		w.Header().Add("Set-Cookie", "code="+code+"; Max-Age=60; Path="+o.RedirectBasePath+"; Secure; HttpOnly")
		w.Header().Add("Location", o.RedirectBasePath)
		w.WriteHeader(http.StatusFound)
		return
	}

	redirectURL := o.oauth2Config.AuthCodeURL("empty-state", oauth2.AccessTypeOffline, oauth2.ApprovalForce)
	w.Header().Add("Location", redirectURL)
	w.WriteHeader(http.StatusFound)
}

// API for client to refresh the access token
func (o *OAuthBackend) handleRefresh(w http.ResponseWriter, r *http.Request) {
	input := &RefreshTokenInfo{}
	dec := json.NewDecoder(r.Body)
	err := dec.Decode(&input)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	newToken, err := o.refreshToken(input.RefreshToken)
	accessTokenTTL := int(newToken.Expiry.Sub(time.Now()).Seconds())
	makeJSONResponse(w, &AccessTokenInfo{newToken.AccessToken, accessTokenTTL})
}

// API for client to check the access token expiration time
func (o *OAuthBackend) handleTokenInfo(w http.ResponseWriter, r *http.Request) {
	input := &AccessTokenInfo{}
	dec := json.NewDecoder(r.Body)
	err := dec.Decode(&input)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	info, err := o.CheckAccessToken(input.AccessToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	makeJSONResponse(w, &AccessTokenInfo{input.AccessToken, info.ExpiresInSec})
}

// HandleRequest the HTTP Request
func (o *OAuthBackend) HandleRequest(w http.ResponseWriter, r *http.Request) {
	path := strings.Replace(r.URL.Path, o.RedirectBasePath, "", 1)
	route, ok := o.routeMap[path]
	if !ok {
		http.Error(w, "404 NOT FOUND", http.StatusNotFound)
		return
	}
	route(w, r)
}
