#!/usr/bin/sudo /bin/bash

version=v0.0.1
domain=example.com
trigger407Token=SOME_SECRET_STRING
clientID=SOME_CLIENT_ID
clientSecret=SOME_CLIENT_SECRET
redirectURL=SOME_REDIRECT_URL
allowedEmail='^.+@allowed-domain.com$'

curl https://github.com/winguse/go-shp/releases/download/$version/go-shp-server-linux-amd64-$version.gz -L | gzip -d - > /usr/bin/go-shp
chmod +x /usr/bin/go-shp

mkdir -p /etc/go-shp/

cat > /etc/go-shp/config.yaml <<-EOF
upstream_addr: http://127.0.0.1:80
listen_addr: ":443"
cert_file: /etc/letsencrypt/live/$domain/fullchain.pem
key_file: /etc/letsencrypt/live/$domain/privkey.pem
auth: {}
oauth_backend:
  oauth:
    client_id: '$clientID'
    client_secret: '$clientSecret'
    endpoint:
      auth_url: https://accounts.google.com/o/oauth2/auth
      token_url: https://oauth2.googleapis.com/token
      auth_style: 1
    redirect_url: $redirectURL
    scopes:
    - https://www.googleapis.com/auth/userinfo.email
  token_info_api: https://www.googleapis.com/oauth2/v1/tokeninfo
  render_js_src: https://wingu.se/go-shp/server/render.js
  valid_email: '$allowedEmail'
trigger_407_token: $trigger407Token

EOF

chmod 600 /etc/go-shp/config.yaml

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
