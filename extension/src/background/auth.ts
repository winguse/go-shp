/**
 * auth.ts — Handles proxy authentication challenges (407 responses) for Chrome.
 *
 * Firefox does not need this: browser.proxy.onRequest returns a full proxy object
 * with credentials embedded preemptively, so the proxy server never issues a 407
 * and onAuthRequired never fires on Firefox.
 */

import { getSettings, getCredentialForHost } from '../storage';
import type { Credential } from '../types';

export function registerAuthListener(): void {
  if (typeof chrome === 'undefined' || !chrome.webRequest || !chrome.webRequest.onAuthRequired) {
    return;
  }

  const listener = (details: any, callbackFn?: any): any => {
    if (details.isProxy) {
      const p = getSettings().then((settings) => {
        const proxyHosts = settings.proxies.flatMap(g =>
          g.hosts.map(h => h.split(':')[0])
        );

        if (details.challenger && proxyHosts.includes(details.challenger.host)) {
          const hostKey = details.challenger.port && details.challenger.port !== 443
            ? `${details.challenger.host}:${details.challenger.port}`
            : details.challenger.host;
          const cred = getCredentialForHost(settings.credentials, hostKey);
          if (cred && (cred.username || cred.token)) {
            const creds = {
              authCredentials: {
                username: cred.username,
                password: cred.token,
              },
            };
            if (callbackFn) callbackFn(creds);
            return creds;
          }
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

  (chrome.webRequest.onAuthRequired.addListener as any)(
    listener,
    { urls: ['<all_urls>'] },
    ['asyncBlocking']
  );
}
