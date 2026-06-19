package utils

import (
	"testing"
	"github.com/stretchr/testify/assert"
)

func TestNewLogger(t *testing.T) {
	logger := NewLogger(InfoLevel)
	assert.NotNil(t, logger)
	assert.Equal(t, InfoLevel, logger.level)
}
