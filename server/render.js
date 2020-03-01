const directDomains = ["cn", "126.com","126.net","127.net","163.com","360buyimg.com","36kr.com","acfun.tv","air-matters.com","aixifan.com","akamaized.net","alicdn.com","alipay.com","taobao.com","amap.com","autonavi.com","baidu.com","bdimg.com","bdstatic.com","bilibili.com","caiyunapp.com","clouddn.com","cnbeta.com","cnbetacdn.com","cootekservice.com","csdn.net","ctrip.com","dgtle.com","dianping.com","douban.com","doubanio.com","duokan.com","easou.com","ele.me","feng.com","fir.im","frdic.com","g-cores.com","godic.net","gtimg.com","hockeyapp.net","hongxiu.com","hxcdn.net","iciba.com","ifeng.com","ifengimg.com","ipip.net","iqiyi.com","jd.com","jianshu.com","knewone.com","le.com","lecloud.com","lemicp.com","licdn.com","linkedin.com","luoo.net","meituan.com","meituan.net","mi.com","miaopai.com","microsoft.com","microsoftonline.com","miui.com","miwifi.com","mob.com","netease.com","office.com","office365.com","officecdn.com","oschina.net","ppsimg.com","pstatp.com","qcloud.com","qdaily.com","qdmm.com","qhimg.com","qhres.com","qidian.com","qihucdn.com","qiniu.com","qiniucdn.com","qiyipic.com","qq.com","qqurl.com","rarbg.to","ruguoapp.com","segmentfault.com","sinaapp.com","smzdm.com","sogou.com","sogoucdn.com","sohu.com","soku.com","speedtest.net","sspai.com","suning.com","taobao.com","tencent.com","tenpay.com","tianyancha.com","tmall.com","tudou.com","umetrip.com","upaiyun.com","upyun.com","v2ex.com","veryzhun.com","weather.com","weibo.com","xiami.com","xiami.net","xiaomicp.com","ximalaya.com","xmcdn.com","xunlei.com","yhd.com","yihaodianimg.com","yinxiang.com","ykimg.com","youdao.com","youku.com","zealer.com","zhihu.com","zhimg.com","zimuzu.tv"];
const proxyDomains = ['fbcdn.net','facebook.com','google.com','twitter.com','youtube.com','t.co',"9to5mac.com","abpchina.org","adblockplus.org","adobe.com","alfredapp.com","amplitude.com","ampproject.org","android.com","angularjs.org","aolcdn.com","apkpure.com","appledaily.com","appshopper.com","appspot.com","arcgis.com","archive.org","armorgames.com","aspnetcdn.com","att.com","awsstatic.com","azureedge.net","azurewebsites.net","bing.com","bintray.com","bit.com","bit.ly","bitbucket.org","bjango.com","bkrtx.com","blog.com","blogcdn.com","blogger.com","blogsmithmedia.com","blogspot.com","blogspot.hk","bloomberg.com","box.com","box.net","cachefly.net","chromium.org","cl.ly","cloudflare.com","cloudfront.net","cloudmagic.com","cmail19.com","cnet.com","cocoapods.org","comodoca.com","crashlytics.com","culturedcode.com","d.pr","danilo.to","dayone.me","db.tt","deskconnect.com","disq.us","disqus.com","disquscdn.com","dnsimple.com","docker.com","dribbble.com","droplr.com","duckduckgo.com","dueapp.com","dytt8.net","edgecastcdn.net","edgekey.net","edgesuite.net","engadget.com","entrust.net","eurekavpt.com","evernote.com","fabric.io","fast.com","fastly.net","fc2.com","feedburner.com","feedly.com","feedsportal.com","fiftythree.com","firebaseio.com","flexibits.com","flickr.com","flipboard.com","g.co","gabia.net","geni.us","gfx.ms","ggpht.com","ghostnoteapp.com","git.io","github.com","globalsign.com","gmodules.com","godaddy.com","golang.org","gongm.in","goo.gl","goodreaders.com","goodreads.com","gravatar.com","gstatic.com","gvt0.com","hockeyapp.net","hotmail.com","icons8.com","ift.tt","ifttt.com","iherb.com","imageshack.us","img.ly","imgur.com","imore.com","instapaper.com","ipn.li","is.gd","issuu.com","itgonglun.com","itun.es","ixquick.com","j.mp","js.revsci.net","jshint.com","jtvnw.net","justgetflux.com","kat.cr","klip.me","libsyn.com","linode.com","lithium.com","littlehj.com","live.com","live.net","livefilestore.com","llnwd.net","macid.co","macromedia.com","macrumors.com","mashable.com","mathjax.org","medium.com","mega.co.nz","mega.nz","megaupload.com","microsofttranslator.com","mindnode.com","mobile01.com","modmyi.com","msedge.net","myfontastic.com","name.com","nextmedia.com","nsstatic.net","nssurge.com","nyt.com","nytimes.com","omnigroup.com","onedrive.com","onenote.com","ooyala.com","openvpn.net","openwrt.org","orkut.com","osxdaily.com","outlook.com","ow.ly","paddleapi.com","parallels.com","parse.com","pdfexpert.com","periscope.tv","pinboard.in","pinterest.com","pixelmator.com","pixiv.net","playpcesor.com","playstation.com","playstation.com.hk","playstation.net","playstationnetwork.com","pushwoosh.com","rime.im","servebom.com","sfx.ms","shadowsocks.org","sharethis.com","shazam.com","skype.com","smartdnsProxy.com","smartmailcloud.com","sndcdn.com","sony.com","soundcloud.com","sourceforge.net","spotify.com","squarespace.com","sstatic.net","st.luluku.pw","stackoverflow.com","startpage.com","staticflickr.com","steamcommunity.com","symauth.com","symcb.com","symcd.com","tapbots.com","tapbots.net","tdesktop.com","techcrunch.com","techsmith.com","thepiratebay.org","theverge.com","time.com","timeinc.net","tiny.cc","tinypic.com","tmblr.co","todoist.com","trello.com","trustasiassl.com","tumblr.co","tumblr.com","tweetdeck.com","tweetmarker.net","twitch.tv","txmblr.com","typekit.net","ubertags.com","ublock.org","ubnt.com","ulyssesapp.com","urchin.com","usertrust.com","v.gd","vimeo.com","vimeocdn.com","vine.co","vivaldi.com","vox-cdn.com","vsco.co","vultr.com","w.org","w3schools.com","webtype.com","wikiwand.com","wikileaks.org","wikimedia.org","wikipedia.com","wikipedia.org","windows.com","windows.net","wire.com","wordpress.com","workflowy.com","wp.com","wsj.com","wsj.net","xda-developers.com","xeeno.com","xiti.com","yahoo.com","yimg.com","ying.com","yoyo.org","ytimg.com","telegra.ph","telegram.org"];

const servers = [location.hostname];


function render(email, token) {
  document.title = "Secure HTTP Proxy";
  const body = `
<style>
a {text-decoration: none; color: #3ba3ff;}
a:hover {text-decoration: underline;}
pre {background: #c4deff; padding: 1em; border-radius: 1em; user-select: all; max-height: 15em; overflow: scroll;}
code {background: #c4deff; border-radius: 0.2em; padding: 0.2em 0.5em; user-select: all;}
</style>
<h1>${document.title}</h1>

<h2>Security Note</h2>

<p>If your credential is leaked, you must remove the access to this application. Or, your credential(s) will never expire</p>

<ul>
<li>For Google Account: go to your <a href="https://myaccount.google.com/permissions">Google Account</a> to revoke the application access to <code>go-shp</code> in <code>Signing in with Google</code>.</li>
<li>For Github Account: go to your <a href="https://github.com/settings/applications">Authorized OAuth Apps</a> to revoke the application access to <code>go-shp</code>.</li>
</ul>
 

<h2>Intended empty to avoid crendential leak</h2>
<p>Scroll down to view your config if you are sure nobody sitting at your back and you are not screening sharing.</p>
<hr />
<div style="height: 200%">
</div>
<hr />

<h2>Basic Usage</h2>
<ol>
  <li>Download the client from <a href="https://github.com/winguse/go-shp/releases">here</a>.</li>
  <li>Create <code>config.yaml</code> with the following content (edit it if you want) and put it in the same folder.  (<a href="#" onclick="createDownload('config.yaml', 'config')">download</a>)<br><pre id="config">
username: ${email}
token: '${token}'
auth_base_path: ${location.pathname}
listen_port: 8080

proxies:
- name: PROXY
  #select_policy: RANDOM_ON_SIMILAR_LOWEST_LATENCY
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

</pre></li>
  <li>Run the client and set your system proxy to <code>127.0.0.1:8080</code>. If you're using MacOS, you can use the following script (<a href="#" onclick="createDownload('run-shp.sh', 'run-shp')">download</a>):<br><pre id="run-shp">#!/bin/sh

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

</pre></li>
</ol>

<h2>Using ClashX <sup><a href="https://github.com/yichengchen/clashX/releases">*</a></sup></h2>
<p>Here is the proxy config (<a href="#" onclick="createDownload('clash-config.yaml', 'clash')">download</a>):<p>
<pre id="clash">
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

${servers.map(s => `
- name: ${s}
  type: http
  server: ${s}
  port: 443
  username: ${email}
  password: '${token}'
  tls: true
`).join('\n')}


Proxy Group:
- interval: 300
  name: By Google
  proxies:
${servers.map(s => `  - ${s}`).join('\n')}
  type: url-test
  url: http://www.gstatic.com/generate_204
- name: Proxy
  proxies:
  - By Google
${servers.map(s => `  - ${s}`).join('\n')}
  type: select
- name: Finally
  proxies:
  - DIRECT
  - Proxy
  type: select

Rule:

${directDomains.map(d => `- DOMAIN-SUFFIX,${d},DIRECT`).join('\n')}

${proxyDomains.map(d => `- DOMAIN-SUFFIX,${d},Proxy`).join('\n')}


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
<p>Here is the proxy server QR code (if you want to have to have best performance, switch the type to HTTP2)<p>
<script src="https://wingu.se/static/qrcode.min.js"></script>
${servers.map(s => `
<h3>${s}</h3>
<p style="color:red">DO NOT USE WECHAT TO SCAN THIS!!!</p>
<div id="qrcode-${s}"></div>
`).join('')}

<script type="text/javascript">
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

<h2>Other clients</h2>
<p>You can use other clients if they support secure HTTP proxy, for example: Surge.</p>
<dl>
  <dt>Protocol: </dt><dd><code>HTTPS</code>, or <code>HTTP2</code> if supported.</dd>
  <dt>Host: </dt><dd>${servers.map(s =>`<code>${s}</code>`).join(' / ')}</dd>
  <dt>Username: </dt><dd><code>${email}</code></dd>
  <dt>Password: </dt><dd><code>${token}</code></dd>
</dl>

`;
  document.write(body);
}
