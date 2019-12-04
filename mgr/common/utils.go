package common

import (
	"encoding/json"
	"io"
	"io/ioutil"

	"github.com/aws/aws-lambda-go/events"
)

// TokenInfo token info
type TokenInfo struct {
	Email      string
	ExpireTime int64
}

// MakeJSONResponse make json response
func MakeJSONResponse(status int, obj interface{}) events.APIGatewayProxyResponse {
	body := "{\"err\": \"can not create json\"}"
	if asErr, ok := obj.(error); ok {
		obj = map[string]string{
			"err": asErr.Error(),
		}
	}
	jsonBytes, err := json.Marshal(obj)
	if err == nil {
		body = string(jsonBytes)
	}
	return events.APIGatewayProxyResponse{
		StatusCode:      status,
		IsBase64Encoded: false,
		Body:            body,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
	}
}

// ReadJSON from reader
func ReadJSON(reader io.ReadCloser, out interface{}) error {
	defer reader.Close()
	data, _ := ioutil.ReadAll(reader)
	return json.Unmarshal(data, &out)
}
