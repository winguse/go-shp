/**
 * auth.ts — Handles proxy authentication challenges (407 responses).
 *
 * When Chrome encounters a proxy that requires authentication, it fires the
 * onAuthRequired event. We supply the stored username/token credentials for
 * any host that belongs to one of our configured proxy groups.
 */

import { getSettings } from '../storage';

const extApi = typeof browser !== 'undefined' ? browser : chrome;

export function registerAuthListener(): void {
  const listener = (details: any, callbackFn?: any): any => {
    if (details.isProxy) {
      const p = getSettings().then((settings) => {
        const proxyHosts = settings.proxies.flatMap(g =>
          g.hosts.map(h => h.split(':')[0])
        );

        if (details.challenger && proxyHosts.includes(details.challenger.host)) {
          const creds = {
            authCredentials: {
              username: settings.username,
              password: settings.token,
            },
          };
          if (callbackFn) callbackFn(creds);
          return creds;
        }
        if (callbackFn) callbackFn({});
        return {};
      });
      if (!callbackFn) return p;
    } else if (callbackFn) {
      callbackFn({});
    }
    return Promise.resolve({});
  };

  if (typeof browser !== 'undefined' && browser.webRequest && browser.webRequest.onAuthRequired) {
    browser.webRequest.onAuthRequired.addListener(
      listener,
      { urls: ['<all_urls>'] },
      ['blocking']
    );
  } else if (typeof chrome !== 'undefined' && chrome.webRequest && chrome.webRequest.onAuthRequired) {
    (chrome.webRequest.onAuthRequired.addListener as any)(
      listener,
      { urls: ['<all_urls>'] },
      ['asyncBlocking']
    );
  }
}
