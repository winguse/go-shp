package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
)

// deriveKey derives a 32-byte (256-bit) AES key from secret using SHA-256.
func deriveKey(secret string) []byte {
	hash := sha256.Sum256([]byte(secret))
	return hash[:]
}

// EncryptAESGCM encrypts plaintext string using AES-GCM-256 with key derived from secret.
// Returns unpadded URL-safe base64 string containing (nonce + ciphertext + tag).
func EncryptAESGCM(plaintext string, secret string) (string, error) {
	if secret == "" || plaintext == "" {
		return plaintext, nil
	}
	key := deriveKey(secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawURLEncoding.EncodeToString(ciphertext), nil
}

// EncryptToken encrypts token using AES-GCM-256 with key derived from secret.
func EncryptToken(token string, secret string) string {
	encrypted, err := EncryptAESGCM(token, secret)
	if err != nil {
		return token
	}
	return encrypted
}

// DecryptAESGCM decrypts base64-encoded ciphertext string using AES-GCM-256 with key derived from secret.
func DecryptAESGCM(encryptedBase64 string, secret string) (string, error) {
	if secret == "" {
		return encryptedBase64, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(encryptedBase64)
	if err != nil {
		data, err = base64.URLEncoding.DecodeString(encryptedBase64)
		if err != nil {
			data, err = base64.StdEncoding.DecodeString(encryptedBase64)
			if err != nil {
				data, err = hex.DecodeString(encryptedBase64)
				if err != nil {
					return "", err
				}
			}
		}
	}
	key := deriveKey(secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// DecryptToken decrypts token using AES-GCM-256 and returns raw token and success flag.
func DecryptToken(encryptedToken string, secret string) (string, bool) {
	decrypted, err := DecryptAESGCM(encryptedToken, secret)
	if err != nil {
		return "", false
	}
	return decrypted, true
}
