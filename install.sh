#!/usr/bin/sudo /bin/bash

version=v0.0.1
domain=example.com
trigger407Token=SOME_SECRET_STRING

curl https://github.com/winguse/go-shp/releases/download/$version/go-shp-linux-amd64-$version.gz -L | gzip -d - > /usr/bin/go-shp
chmod +x /usr/bin/go-shp

mkdir -p /etc/go-shp/

cat > /etc/go-shp/config.json <<-EOF
{
  "UpstreamAddr": "http://127.0.0.1:80",
  "ListenAddr": ":443",
  "CertFile": "/etc/letsencrypt/live/$domain/fullchain.pem",
  "KeyFile": "/etc/letsencrypt/live/$domain/privkey.pem",
  "AuthURL": "https://remote.authentictor.example.com/path/to/check",
  "Auth": {
    "user": "pass"
  },
  "Trigger407Token": "$trigger407Token"
}
EOF

chmod 600 /etc/go-shp/config.json

cat > /etc/systemd/system/go-shp.service <<-EOF
[Unit]
Description=Secure HTTP Proxy
Wants=network-online.target
After=network-online.target

[Service]
WorkingDirectory=/etc/go-shp/
ExecStart=/usr/bin/go-shp
TimeoutStartSec=0
Restart=on-failure
StartLimitIntervalSec=60
StartLimitBurst=3

[Install]
WantedBy=multi-user.target

EOF

systemctl enable go-shp

service go-shp start
