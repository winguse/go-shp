package common

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

// KeyMetadata the metadata of key
type KeyMetadata struct {
	Key          string
	GenerateTime int64
	Salt         []byte
	PreviousSalt []byte
}

var metadataKey = "key-metadata"

func refreshKeyMetadata(previousSalt []byte) (*KeyMetadata, error) {
	generateTime := time.Now().Unix()

	salt := make([]byte, 32)
	_, err := rand.Reader.Read(salt)
	if err != nil {
		return nil, err
	}

	metadata := &KeyMetadata{metadataKey, generateTime, salt, previousSalt}
	err = Set(metadata)
	if err != nil {
		return nil, err
	}
	return metadata, nil
}

func getKeyMetadata() (*KeyMetadata, error) {
	metadata := &KeyMetadata{
		GenerateTime: 0, // incase of not found, the original will be returned
	}
	err := Get(metadataKey, metadata)
	if err != nil {
		return nil, err
	}

	if time.Now().Unix()-metadata.GenerateTime > PublicKeyMaxTTL {
		return refreshKeyMetadata(metadata.PreviousSalt)
	}

	return metadata, nil
}

func hmacSign(input, salt []byte) []byte {
	mac := hmac.New(sha256.New, salt)
	mac.Write(input)
	return mac.Sum(nil)
}

// Sign the input
func Sign(input interface{}) (*string, error) {
	metadata, err := getKeyMetadata()
	if err != nil {
		return nil, err
	}
	bin, err := asn1.Marshal(input)
	if err != nil {
		return nil, err
	}
	signature := hmacSign(bin, metadata.Salt)
	signed := base64.RawURLEncoding.EncodeToString(bin) + ":" + base64.RawURLEncoding.EncodeToString(signature)
	return &signed, nil
}

// Check the signature
func Check(signed string, out interface{}) error {
	arr := strings.Split(signed, ":")
	if len(arr) != 2 {
		return errors.New("expected data has 2 part")
	}
	input, err := base64.RawURLEncoding.DecodeString(arr[0])
	if err != nil {
		return err
	}
	signature, err := base64.RawURLEncoding.DecodeString(arr[1])
	if err != nil {
		return err
	}

	metadata, err := getKeyMetadata()
	if err != nil {
		return err
	}

	signatureExpected := hmacSign(input, metadata.Salt)

	if !hmac.Equal(signature, signatureExpected) {
		signatureExpected = hmacSign(input, metadata.PreviousSalt)
	}
	if !hmac.Equal(signature, signatureExpected) {
		return errors.New("invalid signature")
	}

	_, err = asn1.Unmarshal(input, out)
	return err
}
