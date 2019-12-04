package common

import (
	"os"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// EmailScope the Google email scope
var EmailScope = "https://www.googleapis.com/auth/userinfo.email"

// PublicKeyMaxTTL second of the public key TTL
var PublicKeyMaxTTL int64 = 3600 * 24

// TokenTTL seconds of token expire
var TokenTTL int64 = 3600

// StateTTL seconds of state expire
var StateTTL int64 = 300

// GetOAuth2Config of login
func GetOAuth2Config(extraURLParam ...string) *oauth2.Config {
	login := "/login"
	if len(extraURLParam) > 0 {
		login = login + extraURLParam[0]
	}
	return &oauth2.Config{
		ClientID:     os.Getenv("OAUTH_CLIENT_ID"),
		ClientSecret: os.Getenv("OAUTH_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("BASE_URL") + login,
		Scopes:       []string{EmailScope},
		Endpoint:     google.Endpoint,
	}
}
