# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM golang:1.26-alpine AS builder

RUN apk add --no-cache git make ca-certificates tzdata

WORKDIR /src

# Cache dependencies separately from source
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build both binaries
COPY . .

RUN CGO_ENABLED=0 go build -ldflags='-w -s' -o /out/go-shp-server ./server/main.go
RUN CGO_ENABLED=0 go build -ldflags='-w -s' -o /out/go-shp-client ./client/main.go

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM scratch

# TLS root certs and timezone data from the builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Both binaries
COPY --from=builder /out/go-shp-server /usr/local/bin/go-shp-server
COPY --from=builder /out/go-shp-client /usr/local/bin/go-shp-client

# Config and data live here; mount a volume or bind-mount at runtime
WORKDIR /data

# Server reads ./config.yaml relative to the working directory by default
EXPOSE 443

ENTRYPOINT ["/usr/local/bin/go-shp-server"]
CMD ["--config-file", "/data/config.yaml"]
