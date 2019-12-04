package main

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/winguse/go-shp/mgr/common"
	"github.com/winguse/go-shp/mgr/domain"
)

func handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	req := &domain.CheckRequest{}
	err := json.Unmarshal([]byte(request.Body), req)
	if err != nil {
		return common.MakeJSONResponse(http.StatusBadRequest, err), nil
	}
	tokenInfo := &common.TokenInfo{}
	err = common.Check(req.Token, tokenInfo)
	if err != nil {
		return common.MakeJSONResponse(http.StatusBadRequest, err), nil
	}
	return common.MakeJSONResponse(http.StatusOK, domain.CheckResponse{
		Email: tokenInfo.Email,
		TTL:   tokenInfo.ExpireTime - time.Now().Unix(),
	}), nil
}

func main() {
	lambda.Start(handler)
}
