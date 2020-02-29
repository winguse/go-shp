# Secure HTTP Proxy (SHP)

Simple golang Secure HTTP Proxy implementation, support HTTP2 by default.

To avoid proxy detection, it will act as reverse proxy unless providing correct authentication header. To allow Chrome extension to work well, it will request for authentication only if the client is requesting for a special URL.

## Install

### Server

0. You should have a domain and a server.
1. Get a certificate from [Let’s Encrypt](https://letsencrypt.org), for example:
   ```
   $ sudo apt install letsencrypt
   $ sudo letsencrypt certonly -d YOUR_DOMAIN -m YOUR_EMAIL --agree-tos --standalone -n
   ```
2. Download [`install.sh`](./install.sh)
3. Make some changes, say the version you want to install, your domain name, your `user`s and `password`s. If you are not using OAuth backend, remove that section, or please add the OAuth config (This project assumes you are using [Google OAuth](https://console.cloud.google.com/apis/credentials), but it should works with other platform).
4. `$ chmod +x install.sh && ./install.sh`

### Client

#### Basic usage

If you are using OAuth backend, it will [render](./server/render.js) the client usage details for you after login.

#### Chrome

There is a plugin in the [`chrome-client`](./chrome-client/) directory.
  - Follow the instruction in [README.md](./chrome-client/README.md)
  - Open `Menu` / `More Tools` / `Extensions`
  - Enable `Developer mode` on the top right and `Load unpacked` from [chrome-client](./chrome-client/).
