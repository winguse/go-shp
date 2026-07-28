/**
 * auth.ts — Handles proxy authentication challenges (407 responses).
 *
 * When Chrome encounters a proxy that requires authentication, it fires the
 * onAuthRequired event. We supply the stored username/token credentials for
 * any host that belongs to one of our configured proxy groups.
 */

import { getSettings } from '../storage';

export function registerAuthListener(): void {
  chrome.webRequest.onAuthRequired.addListener(
    (details, callbackFn) => {
      if (callbackFn && details.isProxy) {
        getSettings().then((settings) => {
          // Collect all hosts across all proxy groups (strip port, compare hostname only)
          const proxyHosts = settings.proxies.flatMap(g =>
            g.hosts.map(h => h.split(':')[0])
          );

          if (proxyHosts.includes(details.challenger.host)) {
            callbackFn({
              authCredentials: {
                username: settings.username,
                password: settings.token,
              },
            });
          } else {
            callbackFn({});
          }
        });
      } else if (callbackFn) {
        callbackFn({});
      }
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking']
  );
}
