package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/winguse/go-shp/utils"
)

func Test_ConfigLoad(t *testing.T) {
	config := &Config{}
	utils.LoadConfigFile("./config.sample.yaml", config)
	assert.Equal(t, "http://127.0.0.1:80", config.UpstreamAddr)
}
