# ARD 0001: Support for CONNECT-UDP (RFC 9298) and Edge-Terminated Architecture in go-shp

- **Status:** TBD (Proposed / Under Review)
- **Author:** Antigravity & Core Team
- **Date:** 2026-08-23
- **Standards Reference:** [RFC 9298 (Proxying UDP in HTTP)](https://datatracker.ietf.org/doc/html/rfc9298), [RFC 9297 (HTTP Datagrams & Capsule Protocol)](https://datatracker.ietf.org/doc/html/rfc9297), [RFC 9000 (QUIC Varint)](https://datatracker.ietf.org/doc/html/rfc9000#section-16), [RFC 1928 (SOCKS Protocol Version 5)](https://datatracker.ietf.org/doc/html/rfc1928), [RFC 9114 (HTTP/3)](https://datatracker.ietf.org/doc/html/rfc9114)

---

## 1. Context and Problem Statement

`go-shp` currently implements a Secure HTTP/2 proxy (SHP) providing:
1. Camouflage reverse-proxy behavior when unauthenticated.
2. Standard HTTP/1.1 and HTTP/2 forwarding.
3. TCP tunneling via standard HTTP `CONNECT`.

Two major architectural questions need to be addressed:
1. **UDP Proxying**: Adding standard support for **UDP traffic** (such as DNS over UDP, QUIC / HTTP/3 traffic, gaming, and VPN flows) via **RFC 9298 (Proxying UDP in HTTP)** and **RFC 9297 (Capsule Protocol)**.
2. **Edge Proxying (Traefik / Ingress Gateways) & Certificate Management**: The legacy server code contains self-managed TLS certificate generation/loading. In modern deployments, tools like **Traefik**, **Caddy**, or **Certbot** handle ACME certificates and edge routing. We must define how `go-shp` interacts with Traefik, specifically regarding **HTTP/3** and **HTTP `CONNECT` / `CONNECT-UDP` forwarding**.

---

## 2. In-Depth Analysis: Can Traefik Forward HTTP/3 `CONNECT` to Upstream `go-shp`?

### 2.1. The Technical Reality of Traefik with HTTP `CONNECT`
**No, standard Traefik Layer 7 (HTTP/HTTPS) routers CANNOT forward downstream `CONNECT` or Extended `CONNECT-UDP` requests to an upstream backend.**

#### Why?
1. **L7 Reverse Proxy vs Forward Proxy Tunneling**: Traefik is built as an L7 reverse proxy (using standard request-response routing). In HTTP specifications (RFC 7230 / RFC 9110), `CONNECT` is a forward-proxy method that establishes a hop-by-hop byte tunnel rather than a routed HTTP request-response exchange.
2. **Rejection at L7**: When Traefik's L7 HTTP router receives `:method = CONNECT` on an HTTP/2 or HTTP/3 entrypoint:
   - Traefik attempts to match the path and host against its router rules.
   - Standard HTTP `CONNECT` requests in authority form (e.g. `CONNECT example.com:443`) lack an HTTP URL path.
   - Extended CONNECT requests (RFC 8441 / RFC 9298) use the `:protocol` pseudo-header, which Traefik's L7 reverse proxy pipeline does not support.
   - As a result, Traefik drops the request or responds with `400 Bad Request`, `404 Not Found`, or `405 Method Not Allowed`.

---

---

## 3. Viable Architectural Deployment Models

Because QUIC (HTTP/3) integrates TLS 1.3 directly into the transport handshake (unlike TCP where TLS sits as a separate layer on top), an intermediary reverse proxy cannot "strip TLS" from QUIC and forward cleartext HTTP/3. Furthermore, Traefik's UDP routing operates purely at raw port-level UDP without QUIC SNI inspection.

Thus, we have two realistic deployment models for HTTP/3 and CONNECT-UDP:

### Option A: Native HTTP/3 on `go-shp` (Direct Edge / External Certs) — *Recommended*

In this model, `go-shp` directly listens on **UDP 443 (HTTP/3 via `quic-go`)** and **TCP 443 (HTTP/2)**.

```
+------------------+                   +-------------------------------------------------+                   +---------------------+
|                  |   HTTP/3 (UDP)    |                 go-shp Server                   |    UDP (Raw)      |                     |
|  go-shp Client   | ================> |  - Native HTTP/3 (quic-go) on UDP 443           | ================> |  Remote UDP Target  |
|  (Local SOCKS5)  |   HTTP/2 (TCP)    |  - Native HTTP/2 (h2) on TCP 443                |  Internet/Remote  |  (8.8.8.8:53, etc.) |
|                  | ================> |  - Reads Certs from disk (dumped by Traefik/Bot)|                   |                     |
+------------------+                   +-------------------------------------------------+                   +---------------------+
```

- **How Certs are Handled**: `go-shp` does NOT implement its own ACME client. Instead, it reads certificate files from disk (`cert_file`, `key_file` generated/renewed by Traefik, Certbot, or `acme.sh`) and reloads them on file modification.
- **Benefits**:
  - 100% native RFC 9298 CONNECT-UDP and standard HTTP/TCP CONNECT without any intermediary protocol drops.
  - Native QUIC packet loss recovery, congestion control, and 0-RTT connection resumption.

---

### Option B: L7 Camouflaged Tunneling (POST / GET Stream Fallback Behind Traefik)

If `go-shp` MUST sit behind Traefik L7 (e.g. sharing port 443 with other web applications via Traefik host routing):

```
+------------------+                   +--------------------------------+                   +--------------------------------+
|                  |   HTTP/3 (POST)   |        Traefik L7              |   HTTP/2 (POST)    |         go-shp Server          |
|  go-shp Client   | ================> |  - Routes POST /tunnel/udp/... | ================> |  - Decapsulates Stream Body    |
|                  |                   |  - Standard L7 Streaming Body  |                   |  - Dials net.DialUDP           |
+------------------+                   +--------------------------------+                   +--------------------------------+
```

- **How it works**: Instead of using `:method = CONNECT`, the client issues a standard `POST` (or `GET` streaming) request targeting `/.well-known/masque/udp/{target_host}/{target_port}/` with `Capsule-Protocol: ?1`.
- **Why this works**: `POST` is a standard L7 request-response method with a streaming body. Traefik routes and forwards it like any standard HTTP stream without rejecting it.
- **Benefits**: Seamlessly traverses any strict L7 reverse proxy (Traefik, Cloudflare, Caddy, AWS ALB).

---

## 4. Proposed Design for `go-shp`

### 4.1. Server Architecture
1. **Certificate Management**:
   - Remove self-signed/managed ACME client complexity.
   - Keep clean filesystem certificate loading (`cert_file`, `key_file`) with auto-reload (or support unencrypted `h2c` when deployed behind L4/L7 proxies).
2. **Protocol Listeners**:
   - **HTTP/2 Listener**: Standard `http2.Server` for TCP tunnels (`CONNECT`) and standard HTTP.
   - **HTTP/3 Listener (QUIC)**: Using `quic-go/http3` on UDP port for native HTTP/3 `CONNECT` and `CONNECT-UDP`.
3. **CONNECT-UDP Handler**:
   - Accepts both `:method = CONNECT` (with `:protocol = connect-udp`) and fallback `POST/GET` with `Capsule-Protocol: ?1`.
   - Validates `Proxy-Authorization`.
   - Bridges RFC 9297 `DATAGRAM` capsules to raw `net.DialUDP` sockets.

### 4.2. Client Architecture
1. **Local SOCKS5 Server**:
   - Listens on `127.0.0.1:8080`.
   - Supports `CMD = 0x01 (CONNECT)` and `CMD = 0x03 (UDP ASSOCIATE)`.
2. **HTTP/2 & HTTP/3 Tunnel Client**:
   - `buildUDPTunnel`: Encapsulates SOCKS5 UDP packets into RFC 9297 `DATAGRAM` capsules and streams over HTTP/2 or HTTP/3 to the proxy server.

---

## 5. Implementation Complexity

| Component | Effort | Estimated LoC | Details |
|---|---|---|---|
| `utils/capsule.go` (Varint + RFC 9297 Capsule Parser) | **Low** | ~150 lines | Pure Go encoding/decoding |
| `server/udp.go` (CONNECT-UDP socket bridge) | **Moderate** | ~250 lines | Bidirectional capsule <-> UDP pump |
| `server/` (HTTP/3 listener via `quic-go`) | **Moderate** | ~150 lines | Native QUIC/HTTP3 endpoint |
| `client/socks5.go` (Local SOCKS5 UDP server) | **Moderate** | ~300 lines | RFC 1928 UDP Associate support |
| `client/udp.go` (Client CONNECT-UDP tunnel) | **Moderate** | ~200 lines | HTTP/2 & HTTP/3 stream builder |
| **Total** | **Moderate** | **~1,050–1,150 lines** | Robust, standards-compliant MASQUE proxy |

---

## 6. Next Steps & Decision Checkpoints
- [ ] Approve ARD with Option A/B (Native H2/H3 + External Certs).
- [ ] Implement `utils/capsule.go` with RFC 9297 unit tests.
- [ ] Implement server-side CONNECT-UDP handler (`server/udp.go`).
- [ ] Implement client-side SOCKS5 UDP Associate server (`client/socks5.go`).
- [ ] Add HTTP/3 (`quic-go/http3`) support to server and client.
- [ ] Integration testing with DNS UDP queries and QUIC traffic.


