# Secure HTTP Proxy (SHP)

Simple golang Secure HTTP Proxy implementation, support HTTP2 by default.

To avoid proxy detection, it will act as reverse proxy unless providing correct authentication header. To allow Chrome extension to work well, it will request for authentication if the client is requesting for a special URL.

## Install

0. You should have a domain and a server.
1. Get a certificate from [Let’s Encrypt](https://letsencrypt.org), for example:
   ```
   $ sudo apt install letsencrypt
   $ sudo letsencrypt certonly -d YOUR_DOMAIN -m YOUR_EMAIL --agree-tos --standalone -n
   ```
2. Download [`install.sh`](./install.sh)
3. Make some changes, say the version you want to install, your domain name, your `user`s and `pass`s.
4. `$ chmod +x install.sh && ./install.sh`
5. If you are using Chrome:
  - Change [background.js](./chrome-minimum-client/background.js) accordingly
  - Open `Menu` / `More Tools` / `Extensions`
  - Enable `Developer mode` on the top right and `Load unpacked` from [chrome-minimum-client](./chrome-minimum-client/).
