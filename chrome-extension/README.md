# SHP Chrome Extension

Chrome Extension for this secure HTTP proxy.

## Setup

```
npm install
```

## Build

```
npm run build
```

## Load extension to chrome

Load `dist` directory

## Test
`npm test`

## Permissions

go-shp proxies traffic through a server that deliberately looks like a normal website to avoid proxy detection — this is what enables bypassing censorship in regions like mainland China. Because the server does not issue a standard proxy authentication challenge, Chrome's built-in proxy auth dialog cannot handle it. The extension steps in to supply credentials programmatically when needed.

The following permissions are requested for that purpose and **nothing else**. The extension does not read, modify, or log the content of any web request. The full source code is available in this repository for anyone to audit.

| Permission | Why it's needed |
|---|---|
| `webRequestAuthProvider` | Allows the extension to intercept proxy authentication challenges (`chrome.webRequest.onAuthRequired`) and respond with the user's credentials. This is the only way to authenticate with a proxy server that does not issue a standard challenge. See [`src/background/auth.ts`](src/background/auth.ts). |
| `webRequest` | Required to register the `onAuthRequired` listener and receive the request details (e.g. `details.isProxy`, `details.challenger.host`) needed to decide whether credentials should be supplied for a given request. |
| `proxy` | Allows the extension to configure Chrome's proxy settings (`chrome.proxy.settings`) based on the server list the user has set up. |
| `storage` | Persists the user's configuration (server list, username, token) locally via `chrome.storage` so settings survive browser restarts. |
| `alarms` | Schedules a periodic health check (every minute) that pings each configured proxy server to measure latency and keep connectivity status up to date. See [`src/background/health.ts`](src/background/health.ts). |

### Why `host_permissions: ["<all_urls>"]`?

go-shp is self-hostable — different operators deploy it on different domains. The extension cannot know at install time which domain(s) will be used. Without `<all_urls>`, Chrome would silently block the `onAuthRequired` listener from receiving events for any host not explicitly listed. Granting `<all_urls>` ensures credentials can be provided regardless of which domain an operator chose for their proxy server. **The extension does not use this access to read or alter the content of any page.**
