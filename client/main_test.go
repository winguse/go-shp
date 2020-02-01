package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/winguse/go-shp/utils"
)

func Test_ConfigLoad(t *testing.T) {
	config := &Config{}
	utils.LoadConfigFile("./config.sample.yaml", config)
	assert.Equal(t, "YOUR_USERNAME", config.Username)
}
