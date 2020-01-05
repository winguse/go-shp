
const PROXY_CONFIG_KEY = "proxy-config";
const BY_LATENCY = "byLatency";
const MSG_CONFIG_UPDATE = 'config-update';
const RANDOM_DOMAIN_FOR_TRIGGER = 'domain.whatever';

// make fetch with timeout
(function () {
  const nativeFetch = window.fetch;
  window.fetch = function (url, options, timeout = 10000) {
    return Promise.race([
      nativeFetch(url, options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`fetch ${url} timeout ${timeout}ms.`)), timeout)
      )
    ]);
  };
})();

let CONFIG_CACHE = undefined;
let DETECTION_ON = false;

function refreshConfigCache(value) {
  CONFIG_CACHE = value;
  DETECTION_ON = value.userInput.proxyType === 'ruleBased' && value.userInput.notMatchedDomain === 'detect';
}

chrome.runtime.onMessage.addListener(({ type, value }) => {
  switch (type) {
    case MSG_CONFIG_UPDATE:
      log.debug('>>>> updated config msg', value);
      refreshConfigCache(value);
      break;
    default:
      log.debug('>>>>> unknown message type', type, value);
  }
});

async function initDefaultDomainList() {
  const responses = await Promise.all(['direct', 'proxy'].map(f => fetch(chrome.runtime.getURL(`domains/${f}.txt`))))
  const texts = await Promise.all(responses.map(r => r.text()));
  const [direct, proxy] = texts.map(t => t.split('\n'));
  updateConfig(config => {
    config.userInput.domainsThroughProxy = proxy;
    config.userInput.domainsDirectConnect = direct;
  });
}

const SHP = {
  get config() {
    if (CONFIG_CACHE) return CONFIG_CACHE;
    const defaultConfig = {
      version: 0,
      login: {
        email: '',
        token: '',
        triggerToken: '',
        expireTime: 0,
        serverList: [],
      },
      latencyTestResult: {
        // 'domain': 123, // latency in ms
      },
      userInput: {
        authType: 'api',
        username: '',
        password: '',
        servers: [],
        triggerToken: '',
        authUrl: '',
        proxyType: 'unhandled',
        ruleProxySelection: BY_LATENCY,
        domainsThroughProxy: [],
        domainsDirectConnect: [],
        notMatchedDomain: 'detect',
        globalProxySelection: BY_LATENCY,
      }
    };
    let config = undefined;
    try {
      config = JSON.parse(window.localStorage.getItem(PROXY_CONFIG_KEY));
    } catch { /* ignore */ }
    if (config && config.version === defaultConfig.version) {
      chrome.runtime.sendMessage({
        type: MSG_CONFIG_UPDATE,
        value: config,
      });
      return config;
    }
    SHP.config = defaultConfig;
    initDefaultDomainList();
    return defaultConfig;
  },
  set config(value) {
    log.debug('updated config', value);
    chrome.runtime.sendMessage({
      type: MSG_CONFIG_UPDATE,
      value,
    });
    refreshConfigCache(value);
    window.localStorage.setItem(PROXY_CONFIG_KEY, JSON.stringify(value));
  },
};

function updateConfig(updateFunc) {
  const { config } = SHP;
  updateFunc(config)
  SHP.config = config;
}

async function setProxyUnhandled() {
  return new Promise(resolve => chrome.proxy.settings.clear({}, () => {
    log.info('proxy cleared')
    resolve();
  }));
}

function removeDomainNote(domain) {
  return domain.split('#')[0];
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setPacProxy(host, triggerToken, domainsThroughProxy, domainsDirectConnect, notMatchedDomain) {
  const pacData = `
const proxy = new Set(${JSON.stringify(domainsThroughProxy.map(removeDomainNote))});
const direct = new Set(${JSON.stringify(domainsDirectConnect.map(removeDomainNote))});
const PROXY = 'HTTPS ${host}:443';
const DIRECT = 'DIRECT';
function FindProxyForURL(url, host) {
  if (url.indexOf('${triggerToken}') >= 0) return PROXY;
  if (host === '${RANDOM_DOMAIN_FOR_TRIGGER}') return PROXY;
  const sub = host.split('.');
  for (let i = 1; i <= sub.length; i++) {
    const target = sub.slice(-i).join('.');
    if (direct.has(target)) {
      return DIRECT;
    }
    if (proxy.has(target)) {
      return PROXY;
    }
  }
  return ${notMatchedDomain === 'proxy' ? 'PROXY' : 'DIRECT'};
}`;
  const details = {
    value: {
      mode: "pac_script",
      pacScript: {
        data: pacData,
      },
    }
  };
  log.debug('pac data', pacData);
  await new Promise(resolve => chrome.proxy.settings.set(details, resolve));
  await sleep(1000); // delay a little bit, it seems the proxy setting is not apply immediately
  log.info('start trigger auth url');
  try {
    await fetch(`http://${RANDOM_DOMAIN_FOR_TRIGGER}/${triggerToken}`);
  } catch (e) {
    await setProxyUnhandled();
    log.error('error while trigger auth url', e);
    throw e;
  }
  log.info('triggered auth url.');
}

async function getProxySetting() {
  return new Promise(resolve =>
    chrome.proxy.settings.get(
      { incognito: false },
      config => resolve(config)
    )
  );
}

async function applyProxySetting() {
  log.info('apply setting');
  const { config } = SHP;
  const {
    login: { serverList, triggerToken }, latencyTestResult,
    userInput: { proxyType, globalProxySelection, ruleProxySelection, domainsThroughProxy, domainsDirectConnect, notMatchedDomain },
  } = config;
  let host = '';
  switch (proxyType) {
    case 'global':
      host = globalProxySelection;
      if (host === 'byLatency') {
        host = serverList[0];
        if (!latencyTestResult[host]) latencyTest();
      }
      await setPacProxy(host, triggerToken, [], serverList, 'proxy');
      break;
    case 'ruleBased':
      host = ruleProxySelection;
      if (host === 'byLatency') {
        host = serverList[0];
        if (!latencyTestResult[host]) latencyTest();
      }
      await setPacProxy(host, triggerToken, domainsThroughProxy, [...domainsDirectConnect, ...serverList], notMatchedDomain);
      break;
    case 'unhandled':
      await setProxyUnhandled();
      break;
    default:
      console.error('unknown proxy type', proxyType);
  }
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
  await fetch(url, {mode: 'no-cors'});
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

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR']
const [LOG_DEBUG, LOG_INFO, LOG_WARN, LOG_ERROR] = LOG_LEVELS;
const LOG_LEVEL = LOG_INFO;

function makeLogFunc(level, func = console.log) {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(LOG_LEVEL) ? (...msg) => {
    const now = new Date().toLocaleString();
    func(...[now, level, ...msg]);
  } : () => { };
}

const log = {
  debug: makeLogFunc(LOG_DEBUG),
  info: makeLogFunc(LOG_INFO),
  warn: makeLogFunc(LOG_WARN),
  error: makeLogFunc(LOG_ERROR, console.error),
};

