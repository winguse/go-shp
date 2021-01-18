

import { MessageType } from "./messages";
import { ShpConfig, ProxySelectPolicy, Proxy } from "./config";
import { sleep, getConfig, storageSet, DomainInfos, DomainCheckExpireTime, DomainCheckInterval, DomainInfoSaveInterval, DomainRemoveTime } from "./utils";
import log from './log';
import { isCN } from './checkRoutes';

export interface HostLatency {
  host: string
  latency?: number
  time: number
}

export interface LatencyTestData {
  history: Array<HostLatency>
  latency: { [key: string]: number }
  variance: { [key: string]: number }
}

export const TIMEOUT_VALUE = 5000; // when timeout or error, will assign this result

let latencyTestTimer: NodeJS.Timeout = undefined;
let latencyTestRunning = false;
const latencyTestInterval = 3 * 60 * 1000;
const latencyTestData: LatencyTestData = {
  history: [],
  latency: {},
  variance: {},
}
const latencyHistoryLength = 3600 * 1000;
const backgroundConfigCache: { config: ShpConfig, enabled: boolean, domainInfos: DomainInfos } = {
  config: undefined,
  enabled: false,
  domainInfos: {},
};
let detectedDomainsSize = 0;
const GOOGLE_DNS = 'dns.google.com';

async function fetch$(input: RequestInfo, init?: RequestInit, timeout = TIMEOUT_VALUE): Promise<Response> {
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
    const { enabled, config, domainInfos } = backgroundConfigCache;
    if (!enabled || !config) return;
    const tests = getAllProxyHosts(config).map(async host => {
      let latency = TIMEOUT_VALUE;
      try {
        await fetch$(`https://${host}${config.authBasePath}health`, { mode: 'no-cors' }); // test twice
        const startTime = Date.now();
        const resp = await fetch$(`https://${host}${config.authBasePath}health`, { mode: 'no-cors' });
        if (resp.ok) {
          latency = Date.now() - startTime;
          log.debug('[latency]', host, latency, 'ms')
        } else {
          log.error('[latency]', host, resp.status);
        }
      } catch (e) {
        delete latencyTestData.latency[host];
        log.error('[latency]', host, e)
      }
      latencyTestData.latency[host] = latency;
      latencyTestData.history.push({ host, latency, time: Date.now() });
    });
    await Promise.all(tests);
    const tooOld = Date.now() - latencyHistoryLength;
    while (latencyTestData.history.length && latencyTestData.history[0].time < tooOld) {
      latencyTestData.history.shift();
    }
    const host2latencies = latencyTestData.history.reduce((acc: { [key: string]: number[] }, { host, latency }) => {
      if (!acc[host]) {
        acc[host] = [];
      }
      if (latency) {
        acc[host].push(latency);
      }
      return acc;
    }, {});
    Object.keys(host2latencies).reduce((acc: { [key: string]: number }, host) => {
      const latencies = host2latencies[host];
      const successLatencies = latencies.filter(v => v !== TIMEOUT_VALUE)
      const avg = successLatencies.reduceRight((pre, cur) => pre + cur) / successLatencies.length;
      acc[host] = Math.sqrt(
        latencies.filter(v => v === TIMEOUT_VALUE).length * TIMEOUT_VALUE * TIMEOUT_VALUE + // timeout Penalty time 
        successLatencies.map(v => (v - avg) * (v - avg)).reduceRight((pre, cur) => pre + cur)
      ) / latencies.length;
      return acc;
    }, latencyTestData.variance);
    setProxy(enabled, config, domainInfos); // skip waiting
  } finally {
    latencyTestRunning = false;
    latencyTestTimer = setTimeout(latencyTest, latencyTestInterval * (1 + Math.random()));
    chrome.runtime.sendMessage({ type: MessageType.LATENCY_TEST_DONE, data: latencyTestData });
  }
}

async function isCNDomain(hostname: string): Promise<boolean> {
  // 101.6.8.193/32 is an ip in beijing
  const res = await fetch(`https://${GOOGLE_DNS}/resolve?name=${hostname}&type=A&edns_client_subnet=101.6.8.193/32`)
  const json = await res.json();
  const { Answer }: { Answer: { type: number, data: string }[] } = json;
  if (Answer) {
    for (const ans of Answer) {
      if (ans.type === 1 && isCN(ans.data)) {
        return true
      }
    }
  }
  return false;
}

const checkFired = new Set<string>();
async function checkIfCNDomain(hostname: string) {
  const { config, domainInfos } = backgroundConfigCache
  if (checkFired.size === 0) {
    checkFired.add(GOOGLE_DNS);
    getAllProxyHosts(config).forEach(h =>
      checkFired.add(h.split(':')[0])
    );
  }
  if (hostname.indexOf(':') >= 0) return;
  const parts = hostname.split('.').map(i => i.trim()).filter(i => i.length);
  if (parts.length < 2) return;
  if (parts.pop().match(/\d+/)) return;
  if (checkFired.has(hostname)) return;
  const domainInfo = domainInfos[hostname]
  const now = Date.now();
  if (domainInfo) {
    if (now - domainInfo.lastCheckTs < DomainCheckExpireTime) {
      return
    }
  }
  checkFired.add(hostname);
  try {
    domainInfos[hostname] = {
      lastCheckTs: now,
      isCN: await isCNDomain(hostname),
    };
  } finally {
    checkFired.delete(hostname);
  }
}

// every 10s, refresh detected domains
setInterval(refreshDetectedDomains, DomainCheckInterval);
async function refreshDetectedDomains() {
  const { enabled, config, domainInfos } = backgroundConfigCache;
  if (!config.nonCNDomainProxyName || !enabled) {
    return;
  }
  const currentDetectedDomainsSize = Object.keys(domainInfos).length;
  if (currentDetectedDomainsSize === detectedDomainsSize) return;
  detectedDomainsSize = currentDetectedDomainsSize;
  await setProxy(enabled, config, domainInfos);
}

setInterval(saveDomainInfos, DomainInfoSaveInterval);
async function saveDomainInfos() {
  const { domainInfos, config, enabled } = backgroundConfigCache;
  if (!config.nonCNDomainProxyName || !enabled) return;
  const allDomains = Object.keys(domainInfos);
  const now = Date.now();
  const next: DomainInfos = {};
  allDomains.filter(d => now - domainInfos[d].lastCheckTs < DomainRemoveTime)
    .forEach(d => {
      next[d] = domainInfos[d];
    });
  storageSet({ domainInfos: next });
}

/**
 * provide credential for proxy login
 */
chrome.webRequest.onAuthRequired.addListener(
  (details, callbackFn) => {
    if (callbackFn) {
      if (details.isProxy) {
        const { config } = backgroundConfigCache;
        const proxies = getAllProxyHosts(config).map(h => h.split(':')[0]);
        if (proxies.indexOf(details.challenger.host) >= 0) {
          callbackFn({
            authCredentials: {
              username: config.username,
              password: config.token,
            }
          });
        }
      } else {
        callbackFn({});
      }
    }
  },
  { urls: ["<all_urls>"] },
  ['asyncBlocking']
);

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    const { config } = backgroundConfigCache;
    if (config.nonCNDomainProxyName) {
      const hostname = new URL(details.url).hostname;
      checkIfCNDomain(hostname);
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

function selectBest(hosts: string[], scores: { [key: string]: number }): string {
  return hosts.reduceRight((previous, current) => {
    const previousLatency = scores[previous];
    const currentLatency = scores[current];
    if (currentLatency && (!previousLatency || currentLatency < previousLatency)) {
      return current;
    }
    return previous;
  });
}

async function clearProxy() {
  await storageSet({ enabled: false });
  return new Promise(resolve => chrome.proxy.settings.clear({}, () => {
    chrome.browserAction.setIcon({ path: { 128: `./icon_off.png` } });
    resolve();
  }));
}

function proxySelector(proxy: Proxy): Array<string> {
  const active = proxy.hosts.filter(h => latencyTestData.latency[h] !== TIMEOUT_VALUE);
  switch (proxy.selectPolicy) {
    // select lowest variance from last active host, if no, random
    case ProxySelectPolicy.VARIANCE:
      if (active.length) {
        return [selectBest(active, latencyTestData.variance)];
      }
      return proxy.hosts;

    // random select
    case ProxySelectPolicy.RANDOM:
      if (active.length) {
        return active;
      }
      return proxy.hosts;

    // select lowest latency, if all hosts cannot connect, return the first one
    case ProxySelectPolicy.LATENCY:
      return [selectBest(proxy.hosts, latencyTestData.latency)];

    // select those low latency host, if all hosts cannot connect, return all
    case ProxySelectPolicy.RANDOM_ON_SIMILAR_LOWEST_LATENCY:
      const latencies = proxy.hosts.map(h => latencyTestData.latency[h]).filter(l => l).sort((a, b) => a - b);
      if (!latencies.length) {
        return proxy.hosts;
      }
      return proxy.hosts.filter(h =>
        latencyTestData.latency[h] && (latencyTestData.latency[h] <= latencies[0] * 1.5 || latencyTestData.latency[h] <= 200)
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

function setErrorMessage(errorMessage: string) {
  chrome.browserAction.setBadgeText({ text: errorMessage ? 'error' : '' });
  chrome.browserAction.setTitle({ title: errorMessage || '' });
  chrome.browserAction.setBadgeBackgroundColor({ color: '#F00' });
}

async function setProxy(enabled: boolean, config: ShpConfig, domainInfos: DomainInfos) {
  if (!enabled || !config) {
    setErrorMessage('');
    await clearProxy();
    return;
  }
  const allProxyHosts = getAllProxyHosts(config);
  const allDomains = Object.keys(domainInfos);
  const cnDomains = allDomains.filter(d => domainInfos[d].isCN)
  const nonCNDomains = allDomains.filter(d => !domainInfos[d].isCN)
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

${config.nonCNDomainProxyName ? `

const cnDomains = new Set(${JSON.stringify(cnDomains)});
const nonCNDomains = new Set(${JSON.stringify(nonCNDomains)});

` : ''}

function FindProxyForURL(url, host) {
  if (url.indexOf('${config.authBasePath}407') >= 0) {
    const hostBegin = url.indexOf('//') + 2;
    const hostEnd = url.indexOf('/', hostBegin);
    const hostWithPort = url.slice(hostBegin, hostEnd)
    return 'HTTPS ' + hostWithPort;
  }
  if (proxyHosts.has(host)) return DIRECT;
  const sub = host.split('.');
  let proxyName = undefined;
  for (let i = 1; !proxyName && i <= sub.length; i++) {
    const target = sub.slice(-i).join('.');
    proxyName = domain2ProxyName.get(target);
  }
${
    config.nonCNDomainProxyName ? `
  if (cnDomains.has(host)) {
    proxyName = DIRECT;
  }
  if (nonCNDomains.has(host)) {
    proxyName = '${config.nonCNDomainProxyName}';
  }
  `: ``
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
      await fetch$(url, { mode: 'no-cors' })
    } catch {
      newTrigger407Failed.add(host);
      log.error('[trigger]', 'failed  to trigger 407 authentication', host);
    }
  }));
  if (newTrigger407Failed.size === allProxyHosts.length) {
    const errMsg = 'All proxy is failed to trigger authentication.\nThe proxy has disabled.\nCheck if the token is valid or if you are offline.';
    setErrorMessage(errMsg);
    log.error('[proxy]', errMsg);
    chrome.runtime.sendMessage({ type: MessageType.ERROR, data: errMsg });
    await clearProxy();
  } else {
    setErrorMessage('');
  }
}

async function main() {
  Object.assign(backgroundConfigCache, await getConfig());
  latencyTest();
  const { enabled, config, domainInfos } = backgroundConfigCache;
  await setProxy(enabled, config, domainInfos);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.debug('[message]', message);
  if (message.type === MessageType.CONFIG_UPDATED || message.type === MessageType.ON_OFF_UPDATED) {
    main();
  } else if (message.type === MessageType.GET_LATENCY_DATA) {
    sendResponse(latencyTestData);
  } else if (message.type === MessageType.TRIGGER_LATENCY_TEST) {
    latencyTest();
  }
});

main();
