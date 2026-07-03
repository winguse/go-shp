package utils

import (
	"github.com/stretchr/testify/assert"
	"testing"
)

func TestNewLogger(t *testing.T) {
	logger := NewLogger(InfoLevel)
	assert.NotNil(t, logger)
	assert.Equal(t, InfoLevel, logger.level)
}
