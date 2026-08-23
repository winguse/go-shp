# ARD 0001: Support for CONNECT-UDP (RFC 9298) and Edge-Terminated Architecture in go-shp

- **Status:** TBD (Proposed / Under Review)
- **Author:** Antigravity & Core Team
- **Date:** 2026-08-23
- **Standards Reference:** [RFC 9298 (Proxying UDP in HTTP)](https://datatracker.ietf.org/doc/html/rfc9298), [RFC 9297 (HTTP Datagrams & Capsule Protocol)](https://datatracker.ietf.org/doc/html/rfc9297), [RFC 9000 (QUIC Varint)](https://datatracker.ietf.org/doc/html/rfc9000#section-16), [RFC 1928 (SOCKS Protocol Version 5)](https://datatracker.ietf.org/doc/html/rfc1928), [RFC 9114 (HTTP/3)](https://datatracker.ietf.org/doc/html/rfc9114)

---

## 1. Context and Problem Statement

`go-shp` currently implements a Secure HTTP/2 proxy (SHP) that provides:
1. Camouflage reverse-proxy behavior when unauthenticated.
2. Standard HTTP/1.1 and HTTP/2 forwarding.
3. TCP tunneling via standard HTTP `CONNECT`.

However, two architectural areas require evolution:
1. **UDP Proxying**: The proxy lacks support for proxying **UDP traffic** (such as DNS over UDP, QUIC / HTTP/3 traffic, gaming, and VPN flows). The IETF standardized this via **RFC 9298 (Proxying UDP in HTTP)** and **RFC 9297 (Capsule Protocol)** under the MASQUE working group.
2. **TLS and Certificate Management**: The legacy server code contains self-managed TLS certificate settings (`cert_file`, `key_file`). In modern production deployments, edge reverse proxies / ingress gateways (such as **Traefik**, **Caddy**, or **Envoy**) already excel at automatic ACME/Let's Encrypt certificates, TLS 1.3 termination, HTTP/3 (QUIC) frontend listeners, and PROXY protocol forwarding. Re-implementing or maintaining manual certificate management inside `go-shp` adds unnecessary complexity and duplicates established infrastructure tooling.

---

## 2. Architectural Decisions

### 2.1. Decision: Removal of Server-Side Self-Managed Certificate Settings
- **Action**: Deprecate and remove `cert_file` and `key_file` from `server/` configuration.
- **Rationale**: 
  - `go-shp` will operate strictly as a backend application behind an edge gateway/reverse proxy (e.g., Traefik, Caddy).
  - Traefik terminates TLS (for both HTTP/2 and HTTP/3) and forwards unencrypted HTTP/2 (`h2c` / prior knowledge) or HTTP/1.1 with PROXY protocol (`behind_tcp_proxy: true`) to `go-shp`.
  - Simplifies the codebase, decouples certificate renewal from proxy restarts, and aligns with containerized / cloud-native operational standards.

### 2.2. Decision: Stream-Based RFC 9298 (Capsule Protocol) for UDP Proxying
- Implement **RFC 9298 (CONNECT-UDP)** using the **RFC 9297 Capsule Protocol** (`Capsule-Protocol: ?1`).
- Because datagrams are framed as standard HTTP stream data capsules (`DATAGRAM (0x00)`), the protocol operates cleanly over both HTTP/2 and HTTP/3 streams and transparently traverses reverse proxies like Traefik without requiring raw QUIC DATAGRAM passthrough.

### 2.3. Decision: Local SOCKS5 UDP Associate as Client Entrypoint
- In `client/`, add a lightweight SOCKS5 server handling `CMD = 0x03 (UDP ASSOCIATE)`.
- When local applications (browsers, DNS resolvers, games, curl) send UDP packets to the local SOCKS5 listener, `shp-client` opens an HTTP CONNECT-UDP tunnel to the proxy server and relays the datagrams via RFC 9297 capsules.

---

## 3. End-to-End Architecture & HTTP/3 Integration (Traefik <-> go-shp)

### 3.1. Topology Overview

```
+------------------+                    +------------------------------------+                    +------------------------------------+                    +---------------------+
|                  |   HTTP/3 (QUIC)    |                                    |    HTTP/2 (h2c)    |                                    |    UDP (Raw)       |                     |
|  go-shp Client   | =================> |        Edge Ingress (Traefik)      | =================> |            go-shp Server           | =================> |  Remote UDP Target  |
|  (Local SOCKS5)  |   UDP Port 443     |   (ACME TLS, HTTP/3 Listener)      |   Local Network    |  (Capsule <-> UDP Socket Bridge)   |   Internet / Remote |  (8.8.8.8:53, etc.) |
+------------------+                    +------------------------------------+                    +------------------------------------+                    +---------------------+
```

### 3.2. How HTTP/3 Proxying Works with Traefik in Front of go-shp

#### A. TCP Tunneling (`CONNECT host:port`)
1. Client connects to Traefik over **HTTP/3 (UDP 443)** using TLS certificates automatically managed by Traefik.
2. Client opens an HTTP/3 stream: `:method = CONNECT`, `:authority = host:port`, `Proxy-Authorization: Basic ...`.
3. Traefik terminates the QUIC layer, matches routing rules, and forwards the HTTP request over **HTTP/2 (h2c)** to `go-shp`.
4. `go-shp` authenticates the request, establishes a TCP connection to the destination, responds with `200 OK`, and streams bytes bidirectionally.
5. Traefik relays the stream back to the client over the HTTP/3 stream.

#### B. UDP Proxying (`CONNECT-UDP` - RFC 9298)
1. Client sends an HTTP/3 request to Traefik:
   - `:method = CONNECT`
   - `:protocol = connect-udp`
   - `:path = /.well-known/masque/udp/{target_host}/{target_port}/`
   - `Capsule-Protocol: ?1`
   - `Proxy-Authorization: Basic ...`
2. Traefik forwards the HTTP stream to `go-shp` over HTTP/2. Because RFC 9298 datagrams are encapsulated inside standard HTTP stream data frames (**RFC 9297 Capsule Protocol**), Traefik treats it as a standard continuous bidirectional HTTP body stream.
3. `go-shp` reads `DATAGRAM` capsules from the request body stream, extracts raw UDP payloads, and sends them via `net.DialUDP` to the destination `{target_host}:{target_port}`.
4. When the remote UDP destination replies, `go-shp` wraps the received packets into `DATAGRAM` capsules and writes them to the response body stream (calling `Flush()`).
5. Traefik streams the capsules back to the client over the HTTP/3 stream.
6. The client decapsulates the packets and returns them to the local application via the SOCKS5 UDP socket.

---

## 4. Detailed Component Design

### 4.1. Capsule & QUIC Varint Utilities (`utils/capsule.go`)
- Implements RFC 9000 §16 variable-length integer parsing/encoding (1, 2, 4, or 8 bytes).
- Encapsulates and decapsulates RFC 9297 `DATAGRAM` capsules:
  ```
  +--------------------------------+
  | Capsule Type (i) = 0x00        |  (DATAGRAM)
  +--------------------------------+
  | Capsule Length (i)             |  (Length of Value)
  +--------------------------------+
  | Context ID (i) = 0x00          |  (Default UDP Context)
  +--------------------------------+
  | HTTP Datagram Payload (UDP)    |
  +--------------------------------+
  ```
- **Helper API**:
  - `ReadVarint(r io.Reader) (uint64, error)`
  - `AppendVarint(buf []byte, v uint64) []byte`
  - `ReadCapsule(r io.Reader) (*Capsule, error)`
  - `WriteDatagramCapsule(w io.Writer, contextID uint64, payload []byte) error`

### 4.2. Server Implementation (`server/`)
1. **Config Cleanup**: Remove `CertFile` and `KeyFile` fields from `Config`. Server listens via cleartext HTTP/2 (`h2c`) or standard HTTP listener, supporting PROXY protocol (`behind_tcp_proxy`).
2. **CONNECT-UDP Endpoint**:
   - Matches URI template `/.well-known/masque/udp/{target_host}/{target_port}/` or `:protocol = connect-udp` with header `Capsule-Protocol: ?1`.
   - Validates `Proxy-Authorization`. If invalid/missing, delegates to the camouflage reverse proxy.
   - Responds with `200 OK`, `Capsule-Protocol: ?1`, and flushes response headers.
3. **UDP Worker Lifecycle**:
   - Dials target UDP endpoint using `net.DialUDP("udp", nil, targetAddr)`.
   - Goroutine 1 (Stream -> UDP): Reads `DATAGRAM` capsules from `r.Body`, writes raw datagram to UDP connection.
   - Goroutine 2 (UDP -> Stream): Reads from UDP connection, wraps in `DATAGRAM` capsule, writes to `w`, and calls `w.(http.Flusher).Flush()`.
   - Idle timeout (e.g. 30–60s) closes inactive sessions.
   - Updates prometheus metrics (`bandwidthCounter` with `conn="UDP"`).

### 4.3. Client Implementation (`client/`)
1. **Tunnel Establishment (`client/udp.go`)**:
   - `(s *shpClient) buildUDPTunnel(targetHost, targetPort, proxyHost string) (io.ReadWriteCloser, error)`
   - Sends HTTP/2 or HTTP/3 CONNECT-UDP request with `Proxy-Authorization` and `Capsule-Protocol: ?1`.
2. **Local SOCKS5 Server (`client/socks5.go`)**:
   - Listens on configured local port.
   - Handles `CMD = 0x01 (CONNECT)` (TCP) and `CMD = 0x03 (UDP ASSOCIATE)` (UDP).
   - For `UDP ASSOCIATE`:
     - Binds a local UDP socket for client datagram exchange.
     - Decapsulates incoming SOCKS5 UDP packets (extracting target host/port).
     - Relays through the corresponding CONNECT-UDP tunnel stream.
     - Forwards returned capsules back to the SOCKS5 client UDP address.
3. **Optional HTTP/3 Client Transport**:
   - `shpClient` can use standard HTTP/2 transport or optionally a `quic-go/http3` transport when configured with HTTP/3 proxy endpoints.

---

## 5. What Design & Implementation is Required for HTTP/3?

| Layer | Does it need changes? | Description |
|---|---|---|
| **Edge Gateway (Traefik)** | Configuration Only | Enable HTTP/3 on Traefik entrypoints (`experimental.http3 = true` or `entryPoints.websecure.http3 = {}`), attach domain TLS certs via ACME. |
| **go-shp Server** | No Raw QUIC Needed | `go-shp` acts as an HTTP/2 backend behind Traefik. It processes stream-based Capsule Protocol datagrams forwarded by Traefik. |
| **go-shp Client** | Optional HTTP/3 Transport | Client can connect to Traefik via HTTP/2 (default) or HTTP/3 (`quic-go/http3.RoundTripper`). Both use the same Capsule Protocol data plane. |
| **Local App Entrypoint** | SOCKS5 UDP Associate | Provides standard UDP proxy interface to OS apps. |

---

## 6. Implementation Complexity & Effort

| Component | Effort | Estimated LoC |
|---|---|---|
| Remove self-managed TLS config from server | **Trivial** | ~40 lines |
| `utils/capsule.go` (Varint + RFC 9297 Capsule Parser) + tests | **Low** | ~150 lines |
| `server/udp.go` (CONNECT-UDP handler + UDP socket bridge) + tests | **Moderate** | ~250 lines |
| `client/udp.go` (CONNECT-UDP tunnel client) + tests | **Moderate** | ~200 lines |
| `client/socks5.go` (SOCKS5 UDP Associate server) + tests | **Moderate** | ~300 lines |
| **Total** | **Moderate** | **~900–1,000 lines** |

---

## 7. Security and Camouflage Considerations
- **Camouflage Integrity**: Unauthenticated CONNECT-UDP requests are routed directly to the upstream camouflage reverse proxy without leaking proxy presence.
- **No Open Relay**: Server only dials the specific `{target_host}:{target_port}` parsed from the authenticated request URI template.
- **DDoS / Amplification Mitigation**: Per-user UDP rate limiting and session idle timeouts.

---

## 8. Decision & Next Steps
- [ ] Review and approve ARD.
- [ ] Remove legacy `cert_file` / `key_file` from `server/` code.
- [ ] Implement `utils/capsule.go` with RFC 9297 unit tests.
- [ ] Implement server-side CONNECT-UDP bridge.
- [ ] Implement client-side SOCKS5 UDP Associate server and CONNECT-UDP tunnel.
- [ ] End-to-end integration testing with DNS UDP (port 53) and QUIC (port 443).

