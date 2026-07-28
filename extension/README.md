# SHP Browser Extension (Chrome & Firefox)

Unified codebase for Chrome and Firefox secure HTTP proxy extensions.

## Setup

```bash
npm install
```

## Build

### Build both Chrome & Firefox extensions simultaneously:
```bash
npm run build
```

Output directories:
- `dist/chrome`: Unpacked Chrome extension
- `dist/firefox`: Unpacked Firefox extension

### Target-specific builds:
```bash
npm run build:chrome   # Output to dist/chrome
npm run build:firefox  # Output to dist/firefox
```

## Load Extensions

### Chrome
1. Open `chrome://extensions/`
2. Enable **Developer mode** in top right
3. Click **Load unpacked** and select `extension/dist/chrome`

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `extension/dist/firefox/manifest.json`

## Chrome Extension Permissions

### `proxy`

Used to configure the browser's system-wide proxy settings via `chrome.proxy.settings.set()`. The extension generates a PAC (Proxy Auto-Config) script from the user's routing rules and proxy host list, and installs it so Chrome knows which requests to tunnel through the proxy and which to send direct. Without this permission the extension cannot route any traffic.

### `webRequest`

Used to register a `chrome.webRequest.onAuthRequired` listener. Chrome's proxy API (PAC script) has no mechanism to embed credentials — it only specifies which proxy host to use. When the proxy server responds with HTTP 407 Proxy Authentication Required, Chrome fires this event. The extension intercepts the challenge and supplies the configured username and token so Chrome can retry the request with a `Proxy-Authorization` header automatically.

### `webRequestAuthProvider`

Required in Manifest V3 to use the `asyncBlocking` extra info string when calling `chrome.webRequest.onAuthRequired.addListener()`. This grants the listener the ability to asynchronously return `authCredentials` back to Chrome. Without it, the `onAuthRequired` callback cannot actually provide credentials — it can only observe the event.

### `storage`

Used to persist the user's configuration across browser sessions via `chrome.storage.local`. This includes proxy host lists, routing rules, credentials, and the latency history used to rank proxy hosts by speed. Without this permission settings would be lost every time the browser is closed.

### `alarms`

Used to schedule periodic proxy health checks via `chrome.alarms`. The background service worker probes each configured proxy host at a user-defined interval (default: every minute) to measure latency and update host rankings. Service workers cannot use `setInterval` reliably, so `alarms` is the correct API for recurring background work in MV3.

### Host Permission — `<all_urls>`

This extension is designed for self-hosted SHP (Secure HTTP Proxy) deployments. Users run their own proxy servers at arbitrary hostnames and ports — there is no fixed domain that can be listed. The `<all_urls>` host permission is therefore required for the following reasons:

- The `webRequest.onAuthRequired` listener must cover all URLs so that 407 authentication challenges from any user-configured proxy host are intercepted, regardless of what domain the user has deployed their server on.
- The PAC script routes traffic through proxy hosts that are unknown at extension-build time. The browser needs host permission for the destinations being proxied.
- The background health-check probes send requests to `https://<proxy-host><authBasePath>/407` to measure latency. Since the proxy host is user-configured, no specific hostname can be declared in the manifest.

No page content is ever read or modified. The extension only observes request metadata (URL, host) and proxy authentication events — it never accesses response bodies or injects scripts into web pages.

---

## Firefox Extension Permissions

### `proxy`

Used to intercept every outgoing network request via `browser.proxy.onRequest` and return a proxy routing decision. Unlike Chrome's PAC script approach, Firefox exposes a per-request JavaScript listener that returns a full proxy object — including the proxy host, port, and `Proxy-Authorization` header — for each request. This allows the extension to apply domain-based routing rules and embed credentials preemptively, so the proxy server never needs to issue a 407 challenge. Without this permission the extension cannot route any traffic.

### `storage`

Used to persist the user's configuration across browser sessions via `browser.storage.local`. This includes proxy host lists, routing rules, credentials, and the latency history used to rank proxy hosts by speed. Without this permission settings would be lost every time the browser is closed.

### `alarms`

Used to schedule periodic proxy health checks via `browser.alarms`. The background script probes each configured proxy host at a user-defined interval (default: every minute) to measure latency and keep host rankings up to date. Without this permission the extension cannot run recurring background work reliably.

### Host Permission — `<all_urls>`

This extension is designed for self-hosted SHP (Secure HTTP Proxy) deployments. Users run their own proxy servers at arbitrary hostnames and ports — there is no fixed domain that can be listed. The `<all_urls>` host permission is therefore required for the following reasons:

- The `proxy.onRequest` listener must be registered with `{ urls: ['<all_urls>'] }` so that every outgoing request is evaluated against the user's routing rules. A narrower URL pattern would silently skip requests and cause incorrect routing.
- The background health-check probes send requests to `https://<proxy-host><authBasePath>/407` to measure latency. Since the proxy host is user-configured, no specific hostname can be declared in the manifest.

No page content is ever read or modified. The extension only observes request metadata (URL, host) to make proxy routing decisions — it never accesses response bodies or injects scripts into web pages.

## Test

```bash
npm test
```
