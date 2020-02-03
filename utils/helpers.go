package utils

import (
	"io"
	"io/ioutil"
	"log"
	"sync"

	"gopkg.in/yaml.v2"
)

// BuffPool buffer pool
var BuffPool = sync.Pool{
	New: func() interface{} {
		return make([]byte, 32*1024)
	},
}

// LoadConfigFile from yaml file
func LoadConfigFile(configFilePath string, config interface{}) {
	configFile, err := ioutil.ReadFile(configFilePath)
	if err != nil {
		log.Fatal(err)
	}

	err = yaml.UnmarshalStrict(configFile, config)
	if err != nil {
		log.Fatal(err)
	}
}

// CopyAndPrintError ditto
func CopyAndPrintError(dst io.Writer, src io.Reader) int64 {
	buf := BuffPool.Get().([]byte)
	defer BuffPool.Put(buf)
	size, err := io.CopyBuffer(dst, src, buf)
	if err != nil && err != io.EOF {
		log.Printf("Error while copy %s", err)
	}
	return size
}
