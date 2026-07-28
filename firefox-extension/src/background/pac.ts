/**
 * pac.ts — Generates and installs a PAC (Proxy Auto-Config) script.
 *
 * Proxy Selection Logic (Go client parity):
 *   - Fetches latest latency data for each host from storage.
 *   - Active candidates: Hosts that have non-null (successful) latest latency checks.
 *   - If ALL hosts in a group timed out / failed, fall back to selecting randomly from ALL group hosts.
 *   - LATENCY policy: Select host with minimum latency.
 *   - RANDOM_ON_SIMILAR_LOWEST_LATENCY policy (exact Go client formula):
 *       Find lowest latency L. Candidate set includes hosts with latency < 200ms OR < L * 1.5 (3/2).
 *       Randomly select one host from this candidate set.
 *   - RANDOM policy: Randomly select from active hosts (or all hosts if all failed).
 */

import { getLatencies } from '../storage';
import type { AppSettings, HostLatency } from '../types';

const extApi = typeof browser !== 'undefined' ? browser : chrome;

let currentProxyListener: ((details: any) => any) | null = null;

export async function setProxy(settings: AppSettings): Promise<void> {
  const mode = settings.mode || (settings.enabled ? 'by_rule' : 'off');
  if (mode === 'off' || settings.proxies.every(p => p.hosts.length === 0)) {
    await clearProxy();
    return;
  }

  const latencies = await getLatencies();

  // Firefox webextension proxy.onRequest listener API
  if (typeof browser !== 'undefined' && browser.proxy && browser.proxy.onRequest) {
    const proxyApi: any = browser.proxy;
    if (currentProxyListener) {
      try {
        proxyApi.onRequest.removeListener(currentProxyListener);
      } catch {}
      currentProxyListener = null;
    }

    currentProxyListener = (details: any) => {
      return handleProxyOnRequest(details, settings, latencies);
    };

    try {
      proxyApi.onRequest.addListener(currentProxyListener, { urls: ['<all_urls>'] });
      const actionApi = (browser as any).action || (browser as any).browserAction;
      if (actionApi && actionApi.setIcon) {
        actionApi.setIcon({ path: 'icon_on.png' }).catch(() => {});
      }
      return;
    } catch (err) {
      console.warn('browser.proxy.onRequest.addListener failed:', err);
    }
  }

  // Chrome fallback
  const pacScript = generatePacScript(settings, latencies);
  const config: chrome.proxy.ProxyConfig = {
    mode: 'pac_script',
    pacScript: { data: pacScript },
  };

  return new Promise<void>((resolve) => {
    (extApi.proxy.settings.set as any)({ value: config, scope: 'regular' }, () => {
      const actionApi = (extApi as any).action || (extApi as any).browserAction;
      if (actionApi && actionApi.setIcon) {
        actionApi.setIcon({ path: 'icon_on.png' }).catch(() => {});
      }
      resolve();
    });
  });
}

export async function clearProxy(): Promise<void> {
  if (typeof browser !== 'undefined' && browser.proxy) {
    if (currentProxyListener && browser.proxy.onRequest) {
      try {
        browser.proxy.onRequest.removeListener(currentProxyListener);
      } catch {}
      currentProxyListener = null;
    }
    if (browser.proxy.settings) {
      try {
        await browser.proxy.settings.clear({ scope: 'regular' });
      } catch {}
    }
    const actionApi = (browser as any).action || (browser as any).browserAction;
    if (actionApi && actionApi.setIcon) {
      actionApi.setIcon({ path: 'icon_off.png' }).catch(() => {});
    }
    return;
  }

  return new Promise<void>((resolve) => {
    if (extApi.proxy && extApi.proxy.settings) {
      (extApi.proxy.settings.clear as any)({ scope: 'regular' }, () => {
        const actionApi = (extApi as any).action || (extApi as any).browserAction;
        if (actionApi && actionApi.setIcon) {
          actionApi.setIcon({ path: 'icon_off.png' }).catch(() => {});
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/** Firefox browser.proxy.onRequest listener handler */
function handleProxyOnRequest(details: any, settings: AppSettings, latencies: Record<string, HostLatency>): any {
  const mode = settings.mode || (settings.enabled ? 'by_rule' : 'off');
  if (mode === 'off') {
    return [{ type: 'direct' }];
  }

  const url = details.url || '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = details.host || '';
  }

  // Auth-handshake probe URL direct routing
  const authPath = settings.authBasePath || '/auth/';
  if (url.includes(authPath + '407')) {
    try {
      const targetHost = new URL(url).host;
      const [h, p] = targetHost.split(':');
      return [{
        type: 'https',
        host: h,
        port: parseInt(p || '443', 10),
        username: settings.username || undefined,
        password: settings.token || undefined,
        proxyAuthorizationHeader: (settings.username && settings.token)
          ? `Basic ${btoa(`${settings.username}:${settings.token}`)}`
          : undefined,
      }];
    } catch {}
  }

  // Avoid routing proxy server hosts through proxy
  const allProxyHosts = new Set<string>();
  for (const group of settings.proxies) {
    for (const h of group.hosts) {
      allProxyHosts.add(h.split(':')[0]);
    }
  }

  if (allProxyHosts.has(host)) {
    return [{ type: 'direct' }];
  }

  const globalPolicy = settings.globalProxyPolicy || 'LATENCY';
  const globalTarget = settings.globalProxyTarget || '';

  const buildProxyObject = (hostPortStr: string) => {
    if (!hostPortStr || hostPortStr === 'DIRECT') return [{ type: 'direct' }];
    const [h, p] = hostPortStr.split(':');
    return [{
      type: 'https',
      host: h,
      port: parseInt(p || '443', 10),
      username: settings.username || undefined,
      password: settings.token || undefined,
      proxyAuthorizationHeader: (settings.username && settings.token)
        ? `Basic ${btoa(`${settings.username}:${settings.token}`)}`
        : undefined,
    }];
  };

  const resolveHostsByPolicy = (hosts: string[], policy: string, specificTarget: string): string => {
    if (!hosts || hosts.length === 0) return 'DIRECT';
    if (policy === 'SPECIFIC') {
      if (specificTarget && hosts.includes(specificTarget)) return specificTarget;
      if (specificTarget) return specificTarget;
    }

    const hostLatencyMap: Record<string, number | null> = {};
    for (const h of Object.keys(latencies)) {
      const history = latencies[h]?.history;
      hostLatencyMap[h] = (history && history.length > 0) ? history[history.length - 1].latency : null;
    }

    const activeHosts = hosts.filter(h => hostLatencyMap[h] !== null && hostLatencyMap[h] !== undefined);
    const candidates = activeHosts.length > 0 ? activeHosts : hosts;

    if (candidates.length === 1) return candidates[0];

    if (policy === 'RANDOM') {
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx];
    }

    const sorted = [...candidates].sort((a, b) => {
      const latA = hostLatencyMap[a] ?? 999999;
      const latB = hostLatencyMap[b] ?? 999999;
      return latA - latB;
    });

    if (policy === 'LATENCY') return sorted[0];

    if (policy === 'RANDOM_ON_SIMILAR_LOWEST_LATENCY') {
      const lowest = hostLatencyMap[sorted[0]] ?? 999999;
      let count = 1;
      for (let i = 1; i < sorted.length; i++) {
        const lat = hostLatencyMap[sorted[i]] ?? 999999;
        if (lat < 200 || lat < (lowest * 3 / 2)) {
          count++;
        } else {
          break;
        }
      }
      const idx = Math.floor(Math.random() * count);
      return sorted[idx];
    }

    return sorted[0];
  };

  const resolveProxy = (proxyName: string): string => {
    if (proxyName === 'DIRECT') return 'DIRECT';
    const group = settings.proxies.find(g => g.name === proxyName);
    if (!group) return 'DIRECT';
    return resolveHostsByPolicy(group.hosts, group.selectPolicy, '');
  };

  const isDomainMatch = (reqHost: string, domainSet: string[]): boolean => {
    const parts = reqHost.split('.');
    for (let i = 0; i < parts.length; i++) {
      const candidate = parts.slice(i).join('.');
      if (domainSet.includes(candidate)) return true;
    }
    return false;
  };

  if (mode === 'global') {
    const allHosts: string[] = [];
    for (const g of settings.proxies) allHosts.push(...g.hosts);
    const chosenHost = resolveHostsByPolicy(allHosts, globalPolicy, globalTarget);
    return buildProxyObject(chosenHost);
  }

  for (const rule of settings.rules) {
    if (isDomainMatch(host, rule.domains)) {
      const chosenHost = resolveProxy(rule.proxyName);
      return buildProxyObject(chosenHost);
    }
  }

  const unmatchedHost = resolveProxy(settings.unmatchedPolicy.proxyName);
  return buildProxyObject(unmatchedHost);
}

/** Build the PAC script text from the current settings and latest latency data. */
function generatePacScript(settings: AppSettings, latencies: Record<string, HostLatency>): string {
  const authPath = settings.authBasePath || '/auth/';

  // Compute latest latency map for every host (host -> latest latency ms | null)
  const hostLatencyMap: Record<string, number | null> = {};
  for (const host of Object.keys(latencies)) {
    const history = latencies[host]?.history;
    if (history && history.length > 0) {
      hostLatencyMap[host] = history[history.length - 1].latency;
    } else {
      hostLatencyMap[host] = null;
    }
  }

  // Build per-proxy group data with latest latencies embedded
  const proxyGroups = settings.proxies.map(p => ({
    name: p.name,
    hosts: p.hosts,
    policy: p.selectPolicy,
  }));

  // Rules: [{proxyName, domains[]}]
  const rules = settings.rules.map(r => ({
    proxyName: r.proxyName,
    domains: r.domains,
  }));

  // Unmatched policy
  const unmatched = settings.unmatchedPolicy;

  // Flat set of all proxy hosts to avoid routing loops
  const allHosts: string[] = [];
  for (const p of settings.proxies) allHosts.push(...p.hosts);

  const mode = settings.mode || (settings.enabled ? 'by_rule' : 'off');
  const globalPolicy = settings.globalProxyPolicy || 'LATENCY';
  const globalTarget = settings.globalProxyTarget || '';

  return `
    // Generated by Go SHP Chrome Extension
    var mode = ${JSON.stringify(mode)};
    var globalPolicy = ${JSON.stringify(globalPolicy)};
    var globalTarget = ${JSON.stringify(globalTarget)};
    var authPath = ${JSON.stringify(authPath)};
    var allProxyHosts = new Set(${JSON.stringify(allHosts)});
    var hostLatencyMap = ${JSON.stringify(hostLatencyMap)};

    // Proxy groups: [{name, hosts[], policy}]
    var proxyGroups = ${JSON.stringify(proxyGroups)};

    // Routing rules in priority order: [{proxyName, domains[]}]
    var rules = ${JSON.stringify(rules.map(r => ({
      proxyName: r.proxyName,
      domainSet: r.domains,
    })))};

    // Fallback when no rule matches
    var unmatchedProxyName = ${JSON.stringify(unmatched.proxyName)};

    // Resolve a list of hosts according to a selection policy
    function resolveHostsByPolicy(hosts, policy, specificTarget) {
      if (!hosts || hosts.length === 0) return 'DIRECT';
      if (policy === 'SPECIFIC') {
        if (specificTarget && hosts.indexOf(specificTarget) >= 0) {
          return 'HTTPS ' + specificTarget;
        }
        if (specificTarget) {
          return 'HTTPS ' + specificTarget;
        }
      }

      var activeHosts = [];
      for (var hi = 0; hi < hosts.length; hi++) {
        var h = hosts[hi];
        if (hostLatencyMap[h] !== null && hostLatencyMap[h] !== undefined) {
          activeHosts.push(h);
        }
      }

      var candidates = activeHosts.length > 0 ? activeHosts : hosts;
      if (candidates.length === 1) {
        return 'HTTPS ' + candidates[0];
      }

      if (policy === 'RANDOM') {
        var idx = Math.floor(Math.random() * candidates.length);
        return 'HTTPS ' + candidates[idx];
      }

      candidates.sort(function(a, b) {
        var latA = hostLatencyMap[a] !== null && hostLatencyMap[a] !== undefined ? hostLatencyMap[a] : 999999;
        var latB = hostLatencyMap[b] !== null && hostLatencyMap[b] !== undefined ? hostLatencyMap[b] : 999999;
        return latA - latB;
      });

      if (policy === 'LATENCY') {
        return 'HTTPS ' + candidates[0];
      }

      if (policy === 'RANDOM_ON_SIMILAR_LOWEST_LATENCY') {
        var lowest = hostLatencyMap[candidates[0]] !== null && hostLatencyMap[candidates[0]] !== undefined
          ? hostLatencyMap[candidates[0]]
          : 999999;

        var similarCount = 1;
        for (var cIdx = 1; cIdx < candidates.length; cIdx++) {
          var lat = hostLatencyMap[candidates[cIdx]] !== null && hostLatencyMap[candidates[cIdx]] !== undefined
            ? hostLatencyMap[candidates[cIdx]]
            : 999999;

          if (lat < 200 || lat < (lowest * 3 / 2)) {
            similarCount++;
          } else {
            break;
          }
        }

        var selIdx = Math.floor(Math.random() * similarCount);
        return 'HTTPS ' + candidates[selIdx];
      }

      return 'HTTPS ' + candidates[0];
    }

    // Resolve a proxy group name to a PAC proxy string (e.g. "HTTPS host:443")
    function resolveProxy(proxyName) {
      if (proxyName === 'DIRECT') return 'DIRECT';

      for (var gi = 0; gi < proxyGroups.length; gi++) {
        var g = proxyGroups[gi];
        if (g.name !== proxyName) continue;
        return resolveHostsByPolicy(g.hosts, g.policy, '');
      }

      return 'DIRECT';
    }

    // True if 'host' is a suffix of or equal to 'domain'
    function isDomainMatch(host, domainSet) {
      var parts = host.split('.');
      for (var i = 0; i <= parts.length - 1; i++) {
        var candidate = parts.slice(i).join('.');
        for (var j = 0; j < domainSet.length; j++) {
          if (domainSet[j] === candidate) return true;
        }
      }
      return false;
    }

    function FindProxyForURL(url, host) {
      // Auth-handshake URLs must go directly to the target proxy host
      if (url.indexOf(authPath + '407') >= 0) {
        var hostBegin = url.indexOf('//') + 2;
        var hostEnd   = url.indexOf('/', hostBegin);
        var proxyHost = url.slice(hostBegin, hostEnd < 0 ? undefined : hostEnd);
        return 'HTTPS ' + proxyHost;
      }

      // Avoid routing requests to the proxy servers themselves through the proxy
      if (allProxyHosts.has(host)) return 'DIRECT';

      // Mode "global": all traffic through proxy, ignore all rules
      if (mode === 'global') {
        var hostsArray = Array.from(allProxyHosts);
        return resolveHostsByPolicy(hostsArray, globalPolicy, globalTarget);
      }

      // Evaluate rules in order (mode "by_rule")
      for (var ri = 0; ri < rules.length; ri++) {
        if (isDomainMatch(host, rules[ri].domainSet)) {
          return resolveProxy(rules[ri].proxyName);
        }
      }

      // Fallback
      return resolveProxy(unmatchedProxyName);
    }
  `;
}
