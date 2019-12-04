package authenticator

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/winguse/go-shp/mgr/common"
	"github.com/winguse/go-shp/mgr/domain"
)

type cacheItem struct {
	Email      *string
	ExpireTime int64
}

var cache = map[string]*cacheItem{}

func cleanUp() {
	now := time.Now().Unix()
	keys := []string{}
	for k, v := range cache {
		if v.ExpireTime > now {
			keys = append(keys, k)
		}
	}
	for _, k := range keys {
		delete(cache, k)
	}
}

// Check with authenticator
func Check(authURL, token string) (*string, error) {
	cleanUp()

	if c, ok := cache[token]; ok {
		if c.Email == nil {
			return nil, errors.New("bad request (cached)")
		}
		return c.Email, nil
	}

	checkRequest := &domain.CheckRequest{
		Token: token,
	}

	jsonBytes, err := json.Marshal(checkRequest)
	if err != nil {
		return nil, err
	}
	resp, err := http.Post(authURL, "application/json", bytes.NewBuffer(jsonBytes))
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusBadRequest {
		cache[token] = &cacheItem{
			Email:      nil,
			ExpireTime: time.Now().Unix() + common.TokenTTL,
		}
		return nil, errors.New("bad request")
	}

	checkResponse := &domain.CheckResponse{}
	err = common.ReadJSON(resp.Body, checkResponse)
	if err != nil {
		return nil, err
	}

	if checkResponse.TTL <= 0 {
		return nil, errors.New("token expired")
	}

	cache[token] = &cacheItem{
		Email:      &checkResponse.Email,
		ExpireTime: time.Now().Unix() + checkResponse.TTL,
	}

	return &checkResponse.Email, nil
}
