package common

import (
	"os"
	"sync"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	dynamoDB "github.com/aws/aws-sdk-go/service/dynamodb"
	dynamoDBAttribute "github.com/aws/aws-sdk-go/service/dynamodb/dynamodbattribute"
)

// MetaTableName is the metadata table name in dyomodb
var MetaTableName = os.Getenv("META_TABLE_NAME")

var dySessionMutex sync.Mutex
var awsSession *session.Session = nil
var dynamoSvc *dynamoDB.DynamoDB = nil

func initialDynamoSession() {
	if dynamoSvc == nil && awsSession == nil {
		dySessionMutex.Lock()
		defer dySessionMutex.Unlock()
		if dynamoSvc == nil && awsSession == nil {
			awsSession = session.Must(session.NewSession(&aws.Config{}))
			dynamoSvc = dynamoDB.New(awsSession)
		}
	}
}

// Get read data
func Get(key string, out interface{}) error {
	initialDynamoSession()
	consistentRead := true
	input := &dynamoDB.GetItemInput{
		TableName: aws.String(MetaTableName),
		Key: map[string]*dynamoDB.AttributeValue{
			"Key": {
				S: aws.String(key),
			},
		},
		ConsistentRead: &consistentRead,
	}
	output, err := dynamoSvc.GetItem(input)
	if err != nil {
		return err
	}

	if len(output.Item) == 0 {
		return nil
	}

	return dynamoDBAttribute.UnmarshalMap(output.Item, out)
}

// Set write data
func Set(obj interface{}) error {
	initialDynamoSession()
	m, err := dynamoDBAttribute.MarshalMap(obj)
	if err != nil {
		return err
	}
	input := &dynamoDB.PutItemInput{
		TableName: aws.String(MetaTableName),
		Item:      m,
	}
	_, err = dynamoSvc.PutItem(input)
	return err
}
