package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/winguse/go-shp/mgr/common"
	"github.com/winguse/go-shp/mgr/domain"
	"golang.org/x/oauth2"
)

// Response is of type APIGatewayProxyResponse since we're leveraging the
// AWS Lambda Proxy Request functionality (default behavior)
//
// https://serverless.com/framework/docs/providers/aws/events/apigateway/#lambda-proxy-integration
func handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	renderHTML := request.QueryStringParameters["html"] != ""
	state := request.QueryStringParameters["state"]
	oAuth2Config := common.GetOAuth2Config()

	if renderHTML {
		oAuth2Config = common.GetOAuth2Config("?html=1")
	}

	if state == "" {
		signature, err := common.Sign(domain.StateInfo{SignTime: time.Now().Unix()})
		if err != nil {
			return common.MakeJSONResponse(http.StatusInternalServerError, err), nil
		}
		resp := events.APIGatewayProxyResponse{
			StatusCode:      302,
			IsBase64Encoded: false,
			Body:            "",
			Headers: map[string]string{
				"Content-Type": "application/json",
				"Location":     oAuth2Config.AuthCodeURL(*signature),
			},
		}
		return resp, nil
	}

	stateInfo := &domain.StateInfo{}
	err := common.Check(state, stateInfo)
	if err != nil {
		return common.MakeJSONResponse(http.StatusInternalServerError, err), nil
	}

	if time.Now().Unix()-stateInfo.SignTime > common.StateTTL {
		return common.MakeJSONResponse(http.StatusBadRequest, fmt.Errorf("state timeout signed at %d, ttl: %d", stateInfo.SignTime, common.StateTTL)), nil
	}

	oauthToken, err := oAuth2Config.Exchange(oauth2.NoContext, request.QueryStringParameters["code"])
	if err != nil {
		return common.MakeJSONResponse(http.StatusInternalServerError, err), nil
	}

	client := oAuth2Config.Client(oauth2.NoContext, oauthToken)
	emailResponse, err := client.Get("https://www.googleapis.com/oauth2/v3/userinfo")
	if err != nil {
		return common.MakeJSONResponse(http.StatusInternalServerError, err), nil
	}

	user := &domain.UserInfo{}
	err = common.ReadJSON(emailResponse.Body, user)
	if err != nil {
		return common.MakeJSONResponse(http.StatusInternalServerError, err), nil
	}
	if !user.Email_Verified {
		return common.MakeJSONResponse(http.StatusUnauthorized, fmt.Errorf("email is not verified")), nil
	}

	tokenInfo := common.TokenInfo{
		Email:      user.Email,
		ExpireTime: time.Now().Unix() + common.TokenTTL,
	}

	proxyToken, err := common.Sign(tokenInfo)
	if err != nil {
		return common.MakeJSONResponse(http.StatusInternalServerError, err), nil
	}

	httpResponse := common.MakeJSONResponse(http.StatusOK, domain.LoginResponse{
		Token:        *proxyToken,
		Email:        tokenInfo.Email,
		ExpireTime:   tokenInfo.ExpireTime,
		ServerList:   strings.Split(os.Getenv("SERVER_LIST"), ","),
		TriggerToken: os.Getenv("TRIGGER_TOKEN"),
	})

	if renderHTML {
		httpResponse.Headers["Content-Type"] = "text/html"
		httpResponse.Body =
			`<script>
chrome.runtime.sendMessage(
	"` + os.Getenv("EXTENSION_ID") + `",
	` + httpResponse.Body + `,
	function() {
		window.close();
	}
);
</script>`
	}

	return httpResponse, nil
}

func main() {
	lambda.Start(handler)
}
