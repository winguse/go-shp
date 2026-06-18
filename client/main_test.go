package main

import (
	"os"
	"testing"
	"github.com/stretchr/testify/assert"
	"github.com/winguse/go-shp/utils"
)

func TestLoadConfig(t *testing.T) {
	configContent := `
username: testuser
token: testtoken
auth_base_path: /auth/
listen_port: 8080
proxies:
  - name: PROXY
    hosts:
      - 127.0.0.1:443
    select_policy: RANDOM
rules:
  - proxy_name: PROXY
    domains:
      - google.com
`
	tmpfile, err := os.CreateTemp("", "config.*.yaml")
	assert.NoError(t, err)
	defer os.Remove(tmpfile.Name())

	_, err = tmpfile.Write([]byte(configContent))
	assert.NoError(t, err)
	tmpfile.Close()

	config := &Config{}
	utils.LoadConfigFile(tmpfile.Name(), config)

	assert.Equal(t, "testuser", config.Username)
	assert.Equal(t, "testtoken", config.Token)
	assert.Equal(t, "/auth/", config.AuthBasePath)
	assert.Equal(t, 8080, config.ListenPort)
	assert.Len(t, config.Proxies, 1)
	assert.Equal(t, "PROXY", config.Proxies[0].Name)
	assert.Len(t, config.Rules, 1)
	assert.Equal(t, "PROXY", config.Rules[0].ProxyName)
	assert.Contains(t, config.Rules[0].Domains, "google.com")
}
