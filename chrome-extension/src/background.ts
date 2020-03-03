

import { MessageType } from "./messages";
import { ShpConfig, ProxySelectPolicy, Rule, Proxy } from "./config";
import { sleep, getConfig, storageSet } from "./utils";
import log from './log';

export interface LatencyTestResult {
  host: string
  latency?: number
  time: number
}

let latencyTestTimer: number = 0;
let latencyTestRunning = false;
const latencyTestInterval = 3 * 60 * 1000;
const latencyTestResult: { [key: string]: number } = {};
const latencyTestHistory: Array<LatencyTestResult> = [];
const latencyHistoryLength = 3600 * 1000;
const backgroundConfigCache: { config: ShpConfig, enabled: boolean } = {
  config: undefined,
  enabled: false,
};

async function fetch$(input: RequestInfo, init?: RequestInit, timeout = 3000): Promise<Response> {
  return Promise.race([
    fetch(input, init),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error(`fetch ${input} timeout ${timeout}ms.`)), timeout)
    )
  ]);
};

async function latencyTest() {
  try {
    if (latencyTestRunning) return;
    latencyTestRunning = true;
    clearTimeout(latencyTestTimer);
    const { enabled, config } = backgroundConfigCache;
    if (!enabled || !config) return;
    const tests = getAllProxyHosts(config).map(async host => {
      try {
        await fetch$(`https://${host}${config.authBasePath}health`, {mode: 'no-cors'}); // test twice
        const startTime = Date.now();
        const resp = await fetch$(`https://${host}${config.authBasePath}health`, {mode: 'no-cors'});
        if (resp.ok) {
          const latency = Date.now() - startTime;
          latencyTestResult[host] = latency;
          log.debug('[latency]', host, latency, 'ms')
        } else {
          delete latencyTestResult[host];
          log.error('[latency]', host, resp.status);
        }
      } catch (e) {
        delete latencyTestResult[host];
        log.error('[latency]', host, e)
      }
      latencyTestHistory.push({host, latency: latencyTestResult[host], time: Date.now()});
    });
    await Promise.all(tests);
    const tooOld = Date.now() - latencyHistoryLength;
    while(latencyTestHistory.length && latencyTestHistory[0].time < tooOld) {
      latencyTestHistory.shift();
    }
    setProxy(enabled, config); // skip waiting
  } finally {
    latencyTestRunning = false;
    latencyTestTimer = setTimeout(latencyTest, latencyTestInterval * (1 + Math.random()));
    chrome.runtime.sendMessage({type: MessageType.LATENCY_TEST_DONE, data: latencyTestHistory});
  }
}


/**
 * provide credential for proxy login
 */
chrome.webRequest.onAuthRequired.addListener(
  (details, callbackFn) => {
    let authCredentials: chrome.webRequest.AuthCredentials = undefined;
    if (details.isProxy) {
      const { config } = backgroundConfigCache;
      const proxies = getAllProxyHosts(config).map(h => h.split(':')[0]);
      if (proxies.indexOf(details.challenger.host) >= 0) {
        authCredentials = {
          username: config.username,
          password: config.token,
        };
      }
    }
    callbackFn({ authCredentials });
  },
  { urls: ["<all_urls>"] },
  ['asyncBlocking']
);

async function clearProxy() {
  chrome.browserAction.setIcon({ path: { 128: `./icon_off.png` } });
  await storageSet({enabled: false});
  return new Promise(resolve => chrome.proxy.settings.clear({}, () => {
    resolve();
  }));
}

function proxySelector(proxy: Proxy): Array<string> {
  switch (proxy.selectPolicy) {
    // random select
    case ProxySelectPolicy.RANDOM:
      const active = proxy.hosts.filter(h => latencyTestResult[h]);
      if (active.length) {
        return active;
      }
      return proxy.hosts;

    // select lowest latency, if all hosts cannot connect, return the first one
    case ProxySelectPolicy.LATENCY:
      const lowestLatency = proxy.hosts.reduceRight((previous, current) => {
        const previousLatency = latencyTestResult[previous];
        const currentLatency = latencyTestResult[current];
        if (currentLatency && (!previousLatency || currentLatency < previousLatency)) {
          return current;
        }
        return previous;
      });
      return [lowestLatency];

    // select those low latency host, if all hosts cannot connect, return all
    case ProxySelectPolicy.RANDOM_ON_SIMILAR_LOWEST_LATENCY:
      const latencies = proxy.hosts.map(h => latencyTestResult[h]).filter(l => l).sort((a, b) => a - b);
      if (!latencies.length) {
        return proxy.hosts;
      }
      return proxy.hosts.filter(h =>
        latencyTestResult[h] && (latencyTestResult[h] <= latencies[0] * 1.5 || latencyTestResult[h] <= 200)
      );
  }
}

function getAllProxyHosts(config: ShpConfig): Array<string> {
  const hosts = config.proxies.map(p => p.hosts)
    .reduce((acc, hosts) => {
      hosts.forEach(h => acc.add(h))
      return acc;
    }, new Set<string>());
  return [...hosts];
}

async function setProxy(enabled: boolean, config: ShpConfig) {
  if (!enabled || !config) {
    await clearProxy();
    return;
  }
  const allProxyHosts = getAllProxyHosts(config);
  // TODO config.unmatchedPolicy.detect is not implemented
  const pac = `
const proxyHosts = new Set(${JSON.stringify(allProxyHosts.map(h => h.split(':')[0]))});
const proxyName2ProxyHost = new Map(
  ${JSON.stringify(config.proxies.map(p => [p.name, proxySelector(p)]))}
);
const domain2ProxyName = new Map();
${[...config.rules].reverse().map(rule =>
  `${JSON.stringify(rule.domains)}\n.forEach(d => domain2ProxyName.set(d, '${rule.proxyName}'));`
).join('\n')}

const DIRECT = 'DIRECT';

function FindProxyForURL(url, host) {
  if (url.indexOf('${config.authBasePath}407') >= 0) return 'HTTPS ' + host;
  if (proxyHosts.has(host)) return DIRECT;
  const sub = host.split('.');
  let proxyName = undefined;
  for (let i = 1; !proxyName && i <= sub.length; i++) {
    const target = sub.slice(-i).join('.');
    proxyName = domain2ProxyName.get(target);
  }
  if (!proxyName) {
    proxyName = '${config.unmatchedPolicy.proxyName}';
  }
  if (proxyName === DIRECT) {
    return DIRECT;
  }
  const hosts = proxyName2ProxyHost.get(proxyName);
  return 'HTTPS ' + hosts[Math.floor(Math.random() * 0xffffff) % hosts.length];
}`;
  log.debug('[debug]', pac);
  const details = {
    value: {
      mode: "pac_script",
      pacScript: {
        data: pac,
      },
    }
  };
  await new Promise(resolve => chrome.proxy.settings.set(details, resolve));
  chrome.browserAction.setIcon({ path: { 128: `./icon_on.png` } });
  await sleep(1000); // delay a little bit, it seems the proxy setting is not apply immediately
  const newTrigger407Failed = new Set<string>();
  await Promise.all(allProxyHosts.map(async host => {
    const url = `http://${host}${config.authBasePath}407`;
    try {
      await fetch$(url, {mode: 'no-cors'})
    } catch {
      newTrigger407Failed.add(host);
      log.error('[trigger]', 'failed  to trigger 407 authentication', host);
    }
  }));
  if (newTrigger407Failed.size === allProxyHosts.length) {
    const errMsg = 'all proxy is failed to trigger authentication, proxy is removed. check if the token is valid.';
    log.error('[proxy]', errMsg);
    chrome.runtime.sendMessage({type: MessageType.ERROR, data: errMsg});
    await clearProxy();
  }
}

async function main() {
  Object.assign(backgroundConfigCache, await getConfig());
  latencyTest();
  const { enabled, config } = backgroundConfigCache;
  await setProxy(enabled, config);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.debug('[message]', message);
  if (message.type === MessageType.CONFIG_UPDATED || message.type === MessageType.ON_OFF_UPDATED) {
    main();
  } else if (message.type === MessageType.GET_LATENCY_HISTORY) {
    sendResponse(latencyTestHistory);
  } else if (message.type === MessageType.TRIGGER_LATENCY_TEST) {
    latencyTest();
  }
});

main();
