#!/usr/bin/sudo /bin/bash

version=v0.0.1
domain=example.com
trigger407Token=SOME_SECRET_STRING
clientID=SOME_CLIENT_ID
clientSecret=SOME_CLIENT_SECRET
redirectURL=SOME_REDIRECT_URL

curl https://github.com/winguse/go-shp/releases/download/$version/go-shp-linux-amd64-$version.gz -L | gzip -d - > /usr/bin/go-shp
chmod +x /usr/bin/go-shp

mkdir -p /etc/go-shp/

cat > /etc/go-shp/config.json <<-EOF
{
  "UpstreamAddr": "http://127.0.0.1:80",
  "ListenAddr": ":443",
  "CertFile": "/etc/letsencrypt/live/$domain/fullchain.pem",
  "KeyFile": "/etc/letsencrypt/live/$domain/privkey.pem",
  "Auth": {
    "user": "pass"
  },
  "OAuthBackend": {
    "OAuth": {
      "ClientID": "$clientID",
      "ClientSecret": "$clientSecret",
      "Endpoint": {
        "AuthURL": "https://accounts.google.com/o/oauth2/auth",
        "TokenURL": "https://oauth2.googleapis.com/token",
        "AuthStyle": 1
      },
      "RedirectURL": "$redirectURL",
      "Scopes": ["https://www.googleapis.com/auth/userinfo.email"]
    },
    "TokenInfoAPI": "https://www.googleapis.com/oauth2/v1/tokeninfo"
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
