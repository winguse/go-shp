.PHONY: build clean deploy

build:
	GOOS=linux go build -o bin/login login/main.go
	GOOS=linux go build -o bin/check check/main.go

clean:
	rm -rf ./bin

deploy: clean build
	AWS_SDK_LOAD_CONFIG=1 sls deploy

remove:
	AWS_SDK_LOAD_CONFIG=1 sls remove

