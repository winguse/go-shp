

import { MessageType } from "./messages";
import { ShpConfig, ProxySelectPolicy, Rule, Proxy } from "./config";
import { sleep, getConfig } from "./utils";
import log from './log';


let latencyTestTimer: number = 0;
const latencyTestInterval = 3 * 60 * 1000;
const latencyTestResult: { [key: string]: number } = {}
const backgroundConfigCache: {config: ShpConfig, enabled: boolean} = {
  config: undefined,
  enabled: false,
};


async function latencyTest() {
  clearTimeout(latencyTestTimer);
  const { enabled, config } = backgroundConfigCache;
  if (!enabled) return;
  if (!config) return;
  const tests = getAllProxyHosts(config).map(async host => {
    const startTime = Date.now();
    try {
      const resp = await fetch(`https://${host}${config.authBasePath}health`);
      if (resp.ok) {
        const latency = Date.now() - startTime;
        latencyTestResult[host] = latency;
        log.debug('[latency]', host, latency, 'ms')
      } else {
        log.error('[latency]', host, resp.status);
      }
    } catch (e) {
      log.error('[latency]', host, e)
    }
  });
  await Promise.all(tests);
  latencyTestTimer = setTimeout(latencyTest, latencyTestInterval * (1 + Math.random()));
}


/**
 * provide credential for proxy login
 */
chrome.webRequest.onAuthRequired.addListener(
  (details, callbackFn) => {
    const authCredentials = undefined;
    if (details.isProxy) {
      const {config} = backgroundConfigCache;
      const proxies = getAllProxyHosts(config);
      if (proxies.indexOf(details.challenger.host) >= 0) {
        Object.assign(authCredentials, {
          username: config.username,
          password: config.token,
        });
      }
    }
    callbackFn({ authCredentials });
  },
  { urls: ["<all_urls>"] },
  ['asyncBlocking']
);

async function clearProxy() {
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

async function trigger407(url): Promise<any> {
  await fetch(url);
}

async function setProxy(enabled: boolean, config: ShpConfig) {
  if (!enabled) {
    await clearProxy();
    return;
  }
  const allProxyHosts = getAllProxyHosts(config);
  const pac = `
const proxyHosts = new Set(${JSON.stringify(allProxyHosts.map(h => h.split(':')[0]))});
const proxyName2ProxyHost = new Map(
  ${JSON.stringify(config.proxies.map(p => [p.name, proxySelector(p)]))}
);
const domain2ProxyName = new Map([
${config.rules.map(rule =>
    `...${JSON.stringify(rule.domains)}
  .map(d => [d, '${rule.proxyName}'])`
  ).join(',\n')}
]);

const DIRECT = 'DIRECT';

function FindProxyForURL(url, host) {
  if (url.indexOf('${config.authBasePath}'407) >= 0) return 'HTTPS ' + host;
  if (proxyHosts.has(host)) return DIRECT;
  const sub = host.split('.');
  for (let i = 1; i <= sub.length; i++) {
    const target = sub.slice(-i).join('.');
    const proxyName = domain2ProxyName.get(target);
    if (!proxyName) continue;
    if (proxyName === DIRECT) {
      return DIRECT;
    }
    const hosts = proxyName2ProxyHost.get(proxyName);
    return 'HTTPS ' + hosts[Math.floor(Math.random() * 0xffffff) % hosts.length];
  }
}`;
  log.debug(pac);
  const details = {
    value: {
      mode: "pac_script",
      pacScript: {
        data: pac,
      },
    }
  };
  await new Promise(resolve => chrome.proxy.settings.set(details, resolve));
  await sleep(1000); // delay a little bit, it seems the proxy setting is not apply immediately
  try {
    await Promise.all(allProxyHosts.map(h => `https://${h}${config.authBasePath}407`).map(trigger407));
  } catch (e) {
    log.error('error while trigger auth url', e);
    await clearProxy();
    throw e;
  }
}

async function main() {
  Object.assign(backgroundConfigCache, await getConfig());
  latencyTest();
  const { enabled, config } = backgroundConfigCache;
  await setProxy(enabled, config);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MessageType.CONFIG_UPDATED || message.type === MessageType.ON_OFF_UPDATED) {
    main();
  }
});

main();
