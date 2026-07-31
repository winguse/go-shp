const directDomains = ["cn", "baidu.com", "bdimg.com", "bdstatic.com", "qq.com", "gtimg.com", "tencent.com", "alipay.com", "taobao.com", "tmall.com", "alicdn.com", "jd.com", "360buyimg.com", "bilibili.com", "hdslb.com", "weibo.com", "weibocdn.com", "zhihu.com", "zhimg.com", "netease.com", "163.com", "126.net", "meituan.com", "meituan.net", "bytedance.com", "pstatp.com", "douyin.com", "xiaomi.com", "mi.com", "csdn.net", "sohu.com", "sogou.com"];
const proxyDomains = ["google.com", "gstatic.com", "ggpht.com", "googleapis.com", "youtube.com", "googlevideo.com", "ytimg.com", "facebook.com", "fbcdn.net", "instagram.com", "cdninstagram.com", "twitter.com", "x.com", "twimg.com", "t.co", "wikipedia.org", "wikimedia.org", "github.com", "githubusercontent.com", "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com", "telegram.org", "t.me", "reddit.com", "redditmedia.com", "discord.com", "discordapp.com", "medium.com", "duckduckgo.com"];

function render(email, token, basePath = location.pathname, servers = [location.hostname]) {
  document.title = "Secure HTTP Proxy";
  const body = `
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; line-height: 1.5; }
a { text-decoration: none; color: #2563eb; transition: color 0.2s ease-in-out; }
a:hover { text-decoration: underline; color: #1d4ed8; }
.container { width: 100%; padding: 1.5rem; }
.card { background: #ffffff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06); margin-bottom: 2rem; border: 1px solid #e2e8f0; }
.title { font-size: 2.25rem; font-weight: 800; color: #2563eb; margin-top: 0; margin-bottom: 1.5rem; }
.section-title { font-size: 1.875rem; font-weight: 700; margin-top: 0; margin-bottom: 1rem; }
.btn { display: inline-flex; align-items: center; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 600; border-radius: 0.375rem; cursor: pointer; border: 1px solid #cbd5e1; background-color: #ffffff; color: #0f172a; transition: background-color 0.15s ease-in-out; }
.btn:hover { background-color: #f1f5f9; }
.btn-primary { background-color: #2563eb; color: #ffffff; border: 1px solid #2563eb; }
.btn-primary:hover { background-color: #1d4ed8; }
.btn-danger { background-color: #ef4444; color: #ffffff; border: 1px solid #ef4444; }
.btn-danger:hover { background-color: #dc2626; }
.btn-group { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
pre { background: #f1f5f9; padding: 1em; border-radius: 0.5em; max-height: 20em; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 0; font-size: 0.875rem; border: 1px solid #e2e8f0; }
code { background: #f1f5f9; border-radius: 0.2em; padding: 0.2em 0.4em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; color: #0f172a; font-size: 0.875rem; }
.hidden { display: none !important; }
.dl-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.75rem 1rem; align-items: center; background: #f8fafc; padding: 1rem; border-radius: 0.375rem; border: 1px solid #e2e8f0; }
.dl-dt { font-weight: 700; color: #475569; }
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
.qr-card { background: #f8fafc; padding: 1rem; border-radius: 0.375rem; border: 1px solid #e2e8f0; display: flex; flex-direction: column; align-items: center; }
.alert-warning { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 1rem; margin-bottom: 1rem; border-radius: 0.25rem; color: #92400e; }
.alert-danger { background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 1rem; margin-bottom: 1.5rem; border-radius: 0.25rem; }
</style>

<div class="container">
<h1 class="title">${document.title}</h1>

<div class="alert-danger note-to-leak">
<h2 style="font-size: 1.25rem; font-weight: 700; color: #991b1b; margin: 0 0 0.5rem 0;">Security Note</h2>
<p style="color: #7f1d1d; margin: 0 0 0.5rem 0;">If your credential is leaked, you must remove the access to this application. Or, your credential(s) will never expire.</p>

<ul style="margin: 0; padding-left: 1.25rem; color: #7f1d1d;">
<li>For Google Account: go to your <a href="https://myaccount.google.com/permissions">Google Account</a> to revoke the application access to <code>go-shp</code> in <code>Signing in with Google</code>.</li>
<li>For Github Account: go to your <a href="https://github.com/settings/applications">Authorized OAuth Apps</a> to revoke the application access to <code>go-shp</code>.</li>
</ul>
</div>

<div class="card">
<h2 class="section-title">Go-lang Client</h2>
<p style="margin-bottom: 1rem;">The project has provided a CLI client for the server. You can download or copy the configuration below.</p>

<div class="btn-group">
  <button class="btn btn-primary" onclick="toggleConfig()">Show / Hide Config</button>
  <button class="btn" onclick="copyConfig()">Copy Config</button>
  <button class="btn" onclick="downloadConfig()">Download Config</button>
</div>

<div id="config-container" class="hidden" style="margin-bottom: 1.5rem;">
<pre id="config">username: ${email}
token: '${token}'
auth_base_path: ${basePath}

##
# If you're using chrome-extension,
# comment or remove the 'listen_port:' line below.
##
listen_port: 8080

proxies:
- name: PROXY
  select_policy: LATENCY
  hosts:
${servers.map(s => `  - ${s}:443`).join('\n')}

rules:
- proxy_name: DIRECT
  domains:
${directDomains.map(d => `  - ${d}`).join('\n')}

- proxy_name: PROXY
  domains:
${proxyDomains.map(d => `  - ${d}`).join('\n')}

unmatched_policy:
  proxy_name: PROXY
  detect: true
  detect_delay_ms: 200
  detect_expires_second: 1800
</pre>
</div>

<ol style="padding-left: 1.25rem; margin: 0;">
  <li style="margin-bottom: 0.5rem;">Download the client from <a href="https://github.com/winguse/go-shp/releases">here</a>.</li>
  <li style="margin-bottom: 0.5rem;">Create <code>config.yaml</code> with the configuration above and put it in the same folder.</li>
  <li style="margin-bottom: 0.5rem;">Run the client and set your system proxy to <code>127.0.0.1:8080</code>. If you're using MacOS, you can use the following script (<a href="#" onclick="createDownload('run-shp.sh', 'run-shp')">download script</a>):<br>
  <div style="margin-top: 0.5rem;">
  <pre id="run-shp">#!/bin/sh

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

/path/to/go-shp-client -config=/path/to/config.yaml
</pre>
  </div>
  </li>
</ol>
</div>

<div class="card">
<h2 class="section-title">Chrome / Firefox Extension</h2>
<p style="margin-bottom: 1rem;">If your primary use case is in the browser, the Chrome extension is the best option for you.</p>
<p style="margin-bottom: 1rem;">
Download links:
<a href="https://chrome.google.com/webstore/detail/go-shp-client/pfmmmnmngonlnloejbdhnmknopgejmcn">Chrome Extension Store</a>, or
<a href="https://wingu.se/static/go-shp.crx">this site</a>;
<a href="https://addons.mozilla.org/en-US/firefox/addon/go-shp/">Firefox Extension Store</a>, or
<a href="https://wingu.se/static/go-shp.xpi">this site</a> (also works with Firefox Android).
</p>
<ol style="padding-left: 1.25rem; margin: 0; line-height: 1.75;">
  <li>Install the extension from the link above.</li>
  <li>Click the extension icon on the menu bar and select <code>Options</code>.</li>
  <li>The Chrome extension supports direct configuration import: click <strong>"Copy Config"</strong> above and paste it directly into the Options page in the extension.</li>
  <li>Save and turn on the proxy.</li>
</ol>
</div>

<div class="card">
<h2 class="section-title">Using Shadowrocket <sup><a href="https://apps.apple.com/us/app/shadowrocket/id932747118" style="font-size: 1.25rem;">*</a></sup></h2>
<p style="margin-bottom: 1rem;">Shadowrocket is an iOS rule-based proxy client.</p>

<div id="qr-warning" class="alert-warning">
  <p style="font-weight: 700; margin: 0 0 0.5rem 0;">⚠️ Security Notice</p>
  <p style="margin: 0 0 1rem 0;">DO NOT use WeChat to scan this QR code! WeChat may inspect external proxy links.</p>
  <button class="btn btn-danger" onclick="confirmNoWechat()">I confirm I will NOT scan with WeChat</button>
</div>

<div id="qr-container" class="hidden">
  <p style="margin-bottom: 1rem;">Proxy server QR code (for best performance, switch the protocol type to HTTP2 in Shadowrocket):</p>
  <div class="grid-2">
  ${servers.map(s => `
  <div class="qr-card">
    <h3 style="font-size: 1.25rem; font-weight: 700; margin: 0 0 0.5rem 0;">${s}</h3>
    <div id="qrcode-${s}" style="background: #ffffff; padding: 0.5rem; border-radius: 0.25rem; border: 1px solid #cbd5e1;"></div>
  </div>
  `).join('')}
  </div>
</div>
</div>

<div class="card">
<h2 class="section-title">Other Clients</h2>
<p style="margin-bottom: 1rem;">You can use other clients if they support secure HTTP proxy.</p>
<div class="dl-grid">
  <div class="dl-dt">Protocol:</div><div><code>HTTPS</code> (or <code>HTTP2</code> if supported)</div>
  <div class="dl-dt">Host:</div><div>${servers.map(s =>`<code>${s}</code>`).join(' / ')}</div>
  <div class="dl-dt">Username:</div><div><code>${email}</code></div>
  <div class="dl-dt">Password:</div>
  <div>
    <button class="btn" id="btn-show-pass" onclick="togglePassword()">Show Password</button>
    <button class="btn" onclick="copyPassword()">Copy Password</button>
    <code id="password-val" class="hidden" style="margin-left: 0.5rem;">${token}</code>
  </div>
</div>
</div>

</div>

<script src="https://wingu.se/static/qrcode.min.js"></script>
<script type="text/javascript">
function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.top = '-9999px';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    alert('Failed to copy text: ' + err);
  }
  document.body.removeChild(textArea);
}

function getConfigText() {
  return document.getElementById('config').innerText;
}

function toggleConfig() {
  const el = document.getElementById('config-container');
  el.classList.toggle('hidden');
}

function copyConfig() {
  copyTextToClipboard(getConfigText());
}

function downloadConfig() {
  createDownload('config.yaml', 'config');
}

function togglePassword() {
  const el = document.getElementById('password-val');
  const btn = document.getElementById('btn-show-pass');
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    btn.innerText = 'Hide Password';
  } else {
    el.classList.add('hidden');
    btn.innerText = 'Show Password';
  }
}

function copyPassword() {
  copyTextToClipboard("${token}");
}

function confirmNoWechat() {
  document.getElementById('qr-warning').classList.add('hidden');
  document.getElementById('qr-container').classList.remove('hidden');
}

function createDownload(filename, preId) {
  const data = document.getElementById(preId).innerText;
  const blob = new Blob([data], {type: 'text/plain'});
  const elem = window.document.createElement('a');
  elem.href = window.URL.createObjectURL(blob);
  elem.download = filename;
  document.body.appendChild(elem);
  elem.click();
  document.body.removeChild(elem);
}

${servers.map(s => `
new QRCode(document.getElementById("qrcode-${s}"), {
  text: "https://${btoa(`${email}:${token}@${s}:443`)}?cert=&peer=",
  width: 256,
  height: 256,
  colorDark : "#000000",
  colorLight : "#ffffff",
  correctLevel : QRCode.CorrectLevel.L
});
`).join('')}
</script>
`;
  document.write(body);
}
