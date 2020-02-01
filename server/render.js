document.title = "Secure HTTP Proxy";
document.body = `
<h1>${document.title}</h1>
<h2>Basic Usage</h2>
<ol>
  <li>Download the client from <a href="https://github.com/winguse/go-shp/releases">here</a>.</li>
  <li>Create <code>config.yaml</code> with the following content (edit it if you want) and put it in the same folder.<br><pre lang="yaml">
username: YOUR_USERNAME
token: '' # levers this empty if you use refresh token
refresh_token: YOUR_REFRESH_TOKEN
proxy_host: your-domain.com:443 # don't forget the port number
auth_base_path: /some-url/
listen_port: 8080

direct_domains:
- 163.com
- qq.com
- cn

proxy_domains:
- google.com
- twitter.com

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
<pre lang="yaml"></pre>


<h2>Using Shadowrocket <sup><a href="https://apps.apple.com/us/app/shadowrocket/id932747118">*</a></sup></h2>
<p>Here is the proxy server QR code:<p>
TBD
`;