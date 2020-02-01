
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

