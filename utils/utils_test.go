package utils

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewLogger(t *testing.T) {
	logger := NewLogger(InfoLevel)
	assert.NotNil(t, logger)
	assert.Equal(t, InfoLevel, logger.level)

	// Test all logger levels
	logger.Debug("debug message %d", 1)
	logger.Info("info message %s", "test")
	logger.Warning("warn message")
	logger.Error("error message")

	debugLogger := NewLogger(DebugLevel)
	debugLogger.Debug("debug output")
	debugLogger.Info("info output")
	debugLogger.Warning("warn output")
	debugLogger.Error("error output")
}

func TestCopyAndPrintError(t *testing.T) {
	logger := NewLogger(ErrorLevel)
	src := bytes.NewBufferString("hello world test buffer data")
	dst := &bytes.Buffer{}

	copied := CopyAndPrintError(dst, src, logger)
	assert.Equal(t, int64(len("hello world test buffer data")), copied)
	assert.Equal(t, "hello world test buffer data", dst.String())
}

func TestBuffPool(t *testing.T) {
	buf := BuffPool.Get().(*[]byte)
	assert.NotNil(t, buf)
	assert.Equal(t, 32*1024, len(*buf))
	BuffPool.Put(buf)
}
