package utils

import (
	"sync"
	"time"
)

type item struct {
	email   string
	expires time.Time
}

// TokenCache a Map with Time to Life
type TokenCache struct {
	m map[string]*item
	l sync.Mutex
}

// NewTokenCache a TokenCache
func NewTokenCache() (t *TokenCache) {
	t = &TokenCache{m: make(map[string]*item)}
	go func() {
		for now := range time.Tick(time.Second) {
			t.l.Lock()
			for k, v := range t.m {
				if now.After(v.expires) {
					delete(t.m, k)
				}
			}
			t.l.Unlock()
		}
	}()
	return
}

// Len of the cache
func (t *TokenCache) Len() int {
	return len(t.m)
}

// Put an token into cache
func (t *TokenCache) Put(token string, email string, ttl time.Duration) {
	t.l.Lock()
	defer t.l.Unlock()
	it, ok := t.m[token]
	if !ok {
		it = &item{email: email, expires: time.Now().Add(ttl)}
		t.m[token] = it
	}
}

// Get item from cache
func (t *TokenCache) Get(token string) string {
	t.l.Lock()
	defer t.l.Unlock()
	if it, ok := t.m[token]; ok {
		return it.email
	}
	return ""
}
