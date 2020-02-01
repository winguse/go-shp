const REGULAR_INTERVAL = 60 * 1000 * 5;

async function regular() {
  try {
    const { config } = SHP;
    if (config.login.expireTime > 0) {
      const nowTs = Date.now() / 1000;
      if (config.login.expireTime < nowTs) {
        log.info('token expired, remove proxy');
        await setProxyUnhandled();
      }
      if (config.login.expireTime < nowTs + REGULAR_INTERVAL * 2 / 1000) {
        await refreshToken();
      }
      await latencyTest();
      await applyProxySetting();
    }
  } catch (e) {
    log.error('Error when doing regular job', e);
  }
  setTimeout(regular, REGULAR_INTERVAL);
}

/**
 * provide credential for proxy login
 */
chrome.webRequest.onAuthRequired.addListener(
  function (details, callbackFn) {
    const authCredentials = {};
    if (details.isProxy) {
      const { config: { login: { email, token, serverList } } } = SHP;
      if (serverList.filter(host => host === details.challenger.host).length) {
        Object.assign(authCredentials, {
          username: email,
          password: token,
        });
      }
    }
    callbackFn({ authCredentials });
  },
  { urls: ["<all_urls>"] },
  ['asyncBlocking']
);

/**
 * get domain from URL
 * @param {string} url 
 */
function getDomain(url) {
  const domain = new URL(url).hostname;
  if (!domain.match(/\.[a-z]{2,}$/)) return "";
  return domain;
}

function buildConnectionChecker(domain) {
  return () => {
    if (DOMAIN_DETECT.connected.has(domain)) return;
    log.debug('domain timeout', domain);
    processErrorDomain(domain);
  };
}

function processErrorDomain(domain) {
  if (!DOMAIN_DETECT.error.has(domain)) {
    DOMAIN_DETECT.error.add(domain);
    DOMAIN_DETECT.toBeAdded.push(domain);
  }
  if (DOMAIN_DETECT.added.has(domain) && !DOMAIN_DETECT.notHelp.has(domain)) {
    DOMAIN_DETECT.notHelp.add(domain);
    DOMAIN_DETECT.toBeRemoved.push(domain)
  }
  delayedAddFailedDomainToProxy(DETECTION_PROXY_SETTING_FREQUENCY_CAP);
}

chrome.webRequest.onBeforeRequest.addListener(details => {
  if (!DETECTION_ON) return;
  const domain = getDomain(details.url);
  if (!domain) return;
  log.debug('domain init', domain);
  if (DOMAIN_DETECT.connected.has(domain)) return;
  DOMAIN_DETECT.requested.add(domain);
  setTimeout(buildConnectionChecker(domain), DETECTION_CONNECT_TIMEOUT);
}, { urls: ["<all_urls>"] });

chrome.webRequest.onHeadersReceived.addListener(details => {
  if (!DETECTION_ON) return;
  const domain = getDomain(details.url);
  if (!domain) return;
  log.debug('domain connected', domain);
  DOMAIN_DETECT.connected.add(domain);
}, { urls: ["<all_urls>"] });

chrome.webRequest.onErrorOccurred.addListener(details => {
  if (!DETECTION_ON) return;
  const domain = getDomain(details.url);
  if (!domain) return;
  log.debug('domain error', domain);
  const { error } = details;
  if (!error.startsWith('net::ERR_CONNECTION')) return;
  processErrorDomain(domain);
}, { urls: ["<all_urls>"] });

let delayedAddFailedDomainToProxyHandle = 0;
let lastAddFailedDomainToProxyTime = 0;
function delayedAddFailedDomainToProxy(timeout) {
  const dt = Date.now() - lastAddFailedDomainToProxyTime;
  clearTimeout(delayedAddFailedDomainToProxyHandle);
  if (dt > timeout) {
    addFailedDomainToProxy();
  } else {
    delayedAddFailedDomainToProxyHandle = setTimeout(addFailedDomainToProxy, dt);
  }
}

function normalizeDomain(domain) {
  const len = domain.match(/\.[a-z]{3}\.[a-z]{2}$/) ? 3 : 2;
  return domain.split('.').slice(-len).join('.') + '#auto-detect';
}

async function addFailedDomainToProxy() {
  lastAddFailedDomainToProxyTime = Date.now();
  if (!DOMAIN_DETECT.toBeAdded.length && !DOMAIN_DETECT.toBeRemoved.length) return;
  updateConfig(config => {
    const domains = new Set(config.userInput.domainsThroughProxy);
    DOMAIN_DETECT.toBeAdded.map(normalizeDomain).forEach(d => domains.add(d));
    DOMAIN_DETECT.toBeRemoved.map(normalizeDomain).forEach(d => domains.delete(d));
    config.userInput.domainsThroughProxy = [...domains].sort();
  });
  DOMAIN_DETECT.toBeAdded = [];
  DOMAIN_DETECT.toBeRemoved = [];
  await applyProxySetting();
}

function assignLogin(config, login) {
  config.login.email = login.Email;
  config.login.token = login.Token;
  config.login.triggerToken = login.TriggerToken;
  config.login.expireTime = login.ExpireTime;
  config.login.serverList = login.ServerList;
}

async function refreshToken() {
  log.info('refresh token')
  const { config } = SHP;
  const resp = await fetch(config.userInput.authUrl);
  const json = await resp.json();
  assignLogin(config, json);
  log.info('refresh done')
  SHP.config = config;
  latencyTest();
}

async function getLatency(url) {
  const startTime = Date.now();
  await fetch(url, { mode: 'no-cors' });
  return Date.now() - startTime;
}

async function latencyTest() {
  const { login: { serverList } } = SHP.config;
  const latencies = await Promise.all(serverList.map(host => getLatency(`http://${host}/favicon.ico`)));
  latencyTestResult = {};
  latencies.forEach((latency, idx) => {
    latencyTestResult[serverList[idx]] = latency;
  });
  serverList.sort((a, b) => latencyTestResult[a] - latencyTestResult[b]);
  updateConfig(config => {
    config.latencyTestResult = latencyTestResult;
    config.login.serverList = serverList;
  });
}


regular();
