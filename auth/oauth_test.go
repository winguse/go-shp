package auth

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/winguse/go-shp/utils"
	"golang.org/x/oauth2"
)

func TestOAuthBackendInit(t *testing.T) {
	cfg := &Config{
		OAuth: struct {
			ClientID     string   `yaml:"client_id"`
			ClientSecret string   `yaml:"client_secret"`
			Endpoint     struct {
				AuthURL   string           `yaml:"auth_url"`
				TokenURL  string           `yaml:"token_url"`
				AuthStyle oauth2.AuthStyle `yaml:"auth_style"`
			} `yaml:"endpoint"`
			RedirectURL string   `yaml:"redirect_url"`
			Scopes      []string `yaml:"scopes"`
		}{
			ClientID:    "test-client",
			RedirectURL: "https://example.com/oauth/callback",
		},
		ValidEmail: ".*",
		AESSecret:  "test-aes-secret-key-32bytes-long!!",
	}

	backend := &OAuthBackend{}
	err := backend.Init(cfg)
	assert.NoError(t, err)
	assert.Equal(t, "/oauth/callback", backend.RedirectBasePath)
}

func TestMakeTokenResponseAES(t *testing.T) {
	secret := "my-secret-key"
	clientToken := "SR:refresh-token-123"

	encrypted := utils.EncryptToken(clientToken, secret)
	assert.NotEqual(t, clientToken, encrypted)

	raw, ok := utils.DecryptToken(encrypted, secret)
	assert.True(t, ok)
	assert.Equal(t, clientToken, raw)

	rec := httptest.NewRecorder()
	assert.NotNil(t, rec)
}
