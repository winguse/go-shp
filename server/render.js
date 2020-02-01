const directDomains = ['cn', '163.com', 'qq.com'];
const proxyDomains = ['google.com', 'twitter.com'];

function render(email, refreshToken) {
  document.title = "Secure HTTP Proxy";
  const body = `
<style>
a {text-decoration: none; color: #3ba3ff;}
a:hover {text-decoration: underline;}
pre {background: #c4deff; padding: 1em; border-radius: 1em; user-select: all; max-height: 15em; overflow: scroll;}
code {background: #c4deff; border-radius: 0.2em; padding: 0.2em 0.5em;}
</style>
<h1>${document.title}</h1>
<h2>Basic Usage</h2>
<ol>
  <li>Download the client from <a href="https://github.com/winguse/go-shp/releases">here</a>.</li>
  <li>Create <code>config.yaml</code> with the following content (edit it if you want) and put it in the same folder.<br><pre>
username: ${email}
token: 'SR:${refreshToken}'
proxy_host: ${location.hostname}:443 # don't forget the port number
auth_base_path: ${location.pathname}
listen_port: 8080

direct_domains:
${directDomains.map(d => `- ${d}`).join('\n')}

proxy_domains:
${proxyDomains.map(d => `- ${d}`).join('\n')}

# DomainPolicy:
#   Direct 0
#   Proxy  1
#   Detect 2
unknown_domain_policy: 2
</pre></li>
  <li>Run the client and set your system proxy to <code>127.0.0.1:8080</code>. If you're using MacOS, you can use the following script:<br><pre>#!/bin/sh

NETWORK=Wi-Fi

function on_exit() {
  echo remove proxy setting
  networksetup -setwebproxy $NETWORK '' ''
  networksetup -setwebproxystate $NETWORK off
  networksetup -setsecurewebproxy $NETWORK '' ''
  networksetup -setsecurewebproxystate $NETWORK off
  echo clean up done.
}

trap on_exit EXIT

networksetup -setwebproxy $NETWORK 127.0.0.1 8080
networksetup -setwebproxystate $NETWORK on
networksetup -setsecurewebproxy $NETWORK 127.0.0.1 8080
networksetup -setsecurewebproxystate $NETWORK on

path/to/your/downloaded/client

</pre></li>
</ol>

<h2>Using ClashX <sup><a href="https://github.com/yichengchen/clashX/releases">*</a></sup></h2>
<p>Here is the proxy config:<p>
<pre>
# HTTP
port: 7890

# SOCKS5
socks-port: 7891

# Linux / macOS redir
# redir-port: 7892

allow-lan: false

# Rule / Global / Direct
mode: Rule

# info / warning / error / debug
log-level: info


Proxy:
- name: ${location.hostname}
  type: http
  server: ${location.hostname}
  port: 443
  username: ${email}
  password: 'SR:${refreshToken}'
  tls: true

Proxy Group:
- name: Proxy
  proxies:
  - ${location.hostname}
  - DIRECT
  type: select
- name: Finally
  proxies:
  - DIRECT
  - Proxy
  type: select


Rule:

${directDomains.map(d => `- DOMAIN-SUFFIX,${d},DIRECT`).join('\n')}

${proxyDomains.map(d => `- DOMAIN-SUFFIX,${d},PROXY`).join('\n')}


# LAN
- DOMAIN-SUFFIX,local,DIRECT
- IP-CIDR,127.0.0.0/8,DIRECT
- IP-CIDR,172.16.0.0/12,DIRECT
- IP-CIDR,192.168.0.0/16,DIRECT
- IP-CIDR,10.0.0.0/8,DIRECT
- IP-CIDR,17.0.0.0/8,DIRECT
- IP-CIDR,100.64.0.0/10,DIRECT

# finnaly
- GEOIP,CN,DIRECT
- MATCH,Finally

</pre>

<h2>Using Shadowrocket <sup><a href="https://apps.apple.com/us/app/shadowrocket/id932747118">*</a></sup></h2>
<p>Here is the proxy server QR code:<p>
<!-- TODO to cache this script automatically -->
<script src="https://wingu.se/go-shp/server/qrcode.min.js"></script>
<div id="qrcode"></div>
<script type="text/javascript">
new QRCode(document.getElementById("qrcode"), {
  text: "https://${btoa(`${email}:SR:${refreshToken}@${location.hostname}:443`)}?cert=&peer=",
  width: 256,
  height: 256,
  colorDark : "#000000",
  colorLight : "#ffffff",
  correctLevel : QRCode.CorrectLevel.L
});
</script>`;
  document.write(body);
}
