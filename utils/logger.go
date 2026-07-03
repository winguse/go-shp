package utils

import (
	"fmt"
	"log"
	"os"
)

const (
	// DebugLevel log level
	DebugLevel = 0
	// InfoLevel log level
	InfoLevel = 1
	// WarningLevel log level
	WarningLevel = 2
	// ErrorLevel log level
	ErrorLevel = 3
)

// Logger is a custom logger
type Logger struct {
	level int
}

// NewLogger a new Logger
func NewLogger(level int) *Logger {
	return &Logger{level}
}

var std = log.New(os.Stderr, "", log.LstdFlags)

func (l *Logger) output(level int, format string, v ...interface{}) {
	if l.level > level {
		return
	}
	std.Output(3, fmt.Sprintf(format, v...))
}

// Debug log
func (l *Logger) Debug(format string, v ...interface{}) {
	l.output(DebugLevel, format, v...)
}

// Info log
func (l *Logger) Info(format string, v ...interface{}) {
	l.output(InfoLevel, format, v...)
}

// Warning log
func (l *Logger) Warning(format string, v ...interface{}) {
	l.output(WarningLevel, format, v...)
}

// Error log
func (l *Logger) Error(format string, v ...interface{}) {
	l.output(ErrorLevel, format, v...)
}
