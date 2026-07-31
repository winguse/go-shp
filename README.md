# Secure HTTP Proxy (SHP)

Simple golang Secure HTTP Proxy implementation, support HTTP2 by default.

To avoid proxy detection, it will act as reverse proxy unless providing correct authentication header. To allow Chrome extension to work well, it will request for authentication only if the client is requesting for a special URL.

For maximum privacy, proxy software ought to be:

- Transparent: Open-source, straightforward, and easily auditable.
- Secure: Built on industry-standard cryptography rather than reinventing the wheels.

By leveraging the Go standard library, this project accomplishes both—implementing the client and server in a single file with a minimal codebase.

## Install

### Server

Quick start:

0. You should have a domain and a linux server with docker (i.e. `sudo apt install docker-compose-v2 -y`).
1. Point your domain to your server.
2. Save this [docker-compose.yaml](./docker-compose.yaml) to a directory you want.
3. Copy and modify your [config.yaml](./server/config.sample.yaml) and [.env](./.env.sample).
4. Run `docker compose up -d`.

Technically, you can run with a lot of other ways, and this project also prebuild binary for multiple platforms, please check the release page.

### Client

#### Basic usage

If you are using OAuth backend, it will [render](./server/render.js) the client usage details for you after login, otherwise try use [this](./server/render.html).

#### Browser Extensions (Chrome & Firefox)

The unified browser extension source code is in the [`extension`](./extension/) directory.

Prebuild packages are published in the extension stores:

- Chrome: https://chrome.google.com/webstore/detail/go-shp-client/pfmmmnmngonlnloejbdhnmknopgejmcn
- Firefox (Desktop / Android): https://addons.mozilla.org/en-US/firefox/addon/go-shp/

To build both Chrome and Firefox extensions simultaneously:
```bash
cd extension
npm install
npm run build
```

This generates:
- **Chrome extension**: `extension/dist/chrome` (load via Chrome `Developer mode` -> `Load unpacked`)
- **Firefox extension**: `extension/dist/firefox` (load via Firefox `about:debugging#/runtime/this-firefox` -> `Load Temporary Add-on...`)
