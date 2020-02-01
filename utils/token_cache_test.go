package utils

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func Test_TokenCache(t *testing.T) {
	c := NewTokenCache()

	c.Put("token", "user", time.Second)
	c.Put("token2", "user2", time.Second*2)

	assert.Equal(t, 2, c.Len())
	assert.Equal(t, "user", c.Get("token"))
	assert.Equal(t, "user2", c.Get("token2"))
	assert.Equal(t, "", c.Get("token3"))

	time.Sleep(time.Millisecond * 1100)
	assert.Equal(t, 1, c.Len())
	assert.Equal(t, "user2", c.Get("token2"))
	assert.Equal(t, "", c.Get("token3"))

	time.Sleep(time.Second)
	assert.Equal(t, 0, c.Len())
	assert.Equal(t, "", c.Get("token3"))
}
