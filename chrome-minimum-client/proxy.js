
function removeDomainNote(domain) {
  return domain.split('#')[0];
}

async function setProxyUnhandled() {
  return new Promise(resolve => chrome.proxy.settings.clear({}, () => {
    log.info('proxy cleared')
    resolve();
  }));
}

async function setPacProxy(host, triggerToken, domainsThroughProxy, domainsDirectConnect, notMatchedDomain) {
  const pacData = `
const proxy = new Set(${JSON.stringify(domainsThroughProxy.map(removeDomainNote))});
const direct = new Set(${JSON.stringify(domainsDirectConnect.map(removeDomainNote))});
const PROXY = 'HTTPS ${host}:443';
const DIRECT = 'DIRECT';
function FindProxyForURL(url, host) {
  if (url.endsWith('/robots.txt')) return PROXY;
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
      chrome.browserAction.setIcon({ path: { 128: "./icons/icon.png" } });
      break;
    case 'ruleBased':
      host = ruleProxySelection;
      if (host === 'byLatency') {
        host = serverList[0];
        if (!latencyTestResult[host]) latencyTest();
      }
      await setPacProxy(host, triggerToken, domainsThroughProxy, [...domainsDirectConnect, ...serverList], notMatchedDomain);
      chrome.browserAction.setIcon({ path: { 128: "./icons/icon_auto.png" } });
      break;
    case 'unhandled':
      await setProxyUnhandled();
      chrome.browserAction.setIcon({ path: { 128: "./icons/icon_off.png" } });
      break;
    default:
      console.error('unknown proxy type', proxyType);
  }
}
