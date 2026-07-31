package utils

import (
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAESGCM(t *testing.T) {
	secret := "my-secret-key"
	token := "SR:some-token-string"

	encrypted := EncryptToken(token, secret)
	assert.NotEqual(t, token, encrypted)

	// Ensure token is base64 encoded and shorter than hex encoding
	_, hexErr := hex.DecodeString(encrypted)
	assert.Error(t, hexErr, "Base64 RawURL output should not be standard hex")

	raw, ok := DecryptToken(encrypted, secret)
	assert.True(t, ok)
	assert.Equal(t, token, raw)

	// Tampered token
	_, ok = DecryptToken(encrypted+"extra", secret)
	assert.False(t, ok)

	// Invalid format
	_, ok = DecryptToken("!!!invalid-base64!!!", secret)
	assert.False(t, ok)

	// Empty secret pass through
	rawEmpty, okEmpty := DecryptToken("anytoken", "")
	assert.True(t, okEmpty)
	assert.Equal(t, "anytoken", rawEmpty)
}
