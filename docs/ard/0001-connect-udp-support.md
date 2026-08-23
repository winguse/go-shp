# ARD 0001: Support for CONNECT-UDP (RFC 9298) in go-shp

- **Status:** TBD (Proposed / Under Review)
- **Author:** Antigravity & Core Team
- **Date:** 2026-08-23
- **Standards Reference:** [RFC 9298 (Proxying UDP in HTTP)](https://datatracker.ietf.org/doc/html/rfc9298), [RFC 9297 (HTTP Datagrams & Capsule Protocol)](https://datatracker.ietf.org/doc/html/rfc9297), [RFC 9000 (QUIC Varint)](https://datatracker.ietf.org/doc/html/rfc9000#section-16), [RFC 1928 (SOCKS Protocol Version 5)](https://datatracker.ietf.org/doc/html/rfc1928)

---

## 1. Context and Problem Statement

`go-shp` currently implements a Secure HTTP/2 proxy (SHP) that provides:
1. Camouflage reverse-proxy behavior when unauthenticated.
2. Standard HTTP/1.1 and HTTP/2 forwarding.
3. TCP tunneling via standard HTTP `CONNECT`.

However, the proxy lacks support for proxying **UDP traffic** (such as DNS over UDP, QUIC / HTTP/3 traffic, gaming, voice, and VPN flows). 

With the standardization of the MASQUE protocol family by the IETF—specifically **RFC 9298 (Proxying UDP in HTTP)** and **RFC 9297 (Capsule Protocol)**—there is now an official, standard mechanism to multiplex UDP datagrams over HTTP/2 and HTTP/3 connections.

This document reviews the architectural requirements, design decisions, component impacts, and implementation complexity for adding RFC 9298 CONNECT-UDP support to both the Go server (`server/`) and client (`client/`).

---

## 2. Goals and Non-Goals

### Goals
- **RFC 9298 & RFC 9297 Compliance**: Support standard CONNECT-UDP requests, URI templates, and capsule protocol datagram exchange over HTTP/2.
- **Camouflage & Security Preservation**: CONNECT-UDP requests must remain protected under the existing `Proxy-Authorization` scheme and continue to camouflage as normal HTTP traffic when unauthenticated.
- **Bi-directional UDP Proxying**: Proxy server must be able to forward UDP datagrams to any destination host/port and stream replies back to the client.
- **Standard Local Client Interface**: Provide a standard local mechanism (e.g. SOCKS5 UDP Associate) so operating systems and applications (browsers, DNS resolvers, etc.) can route UDP traffic through `shp-client`.
- **Zero Heavy Dependencies**: Implement entirely in pure Go using standard libraries (`net`, `net/http`) and `golang.org/x/net/http2`.

### Non-Goals
- WebExtension Direct UDP: Browser extensions cannot directly open raw UDP sockets due to browser sandbox restrictions; browser UDP routing relies on local SOCKS5 proxying or browser native HTTP/3 support.
- Kernel-level TUN/TAP virtual network adapters (out of scope for initial implementation; can be built as a separate layer on top of SOCKS5).

---

## 3. Architecture & Data Flow

```
+----------------------------------------------------------------------------------------------------+
|                                           CLIENT SIDE                                              |
|                                                                                                    |
|  [ Local Application ]                                                                             |
|  (e.g., DNS 53, QUIC 443, WireGuard, Game)                                                         |
|         |                                                                                          |
|         | SOCKS5 UDP Packets (RFC 1928)                                                            |
|         v                                                                                          |
|  [ SOCKS5 UDP Associate Listener ]                                                                 |
|         |                                                                                          |
|         | Decapsulates SOCKS5 header -> extracts (TargetHost, TargetPort, Payload)                 |
|         v                                                                                          |
|  [ UDP Tunnel Session Manager ]                                                                    |
|         | (Maps Target to active HTTP/2 CONNECT-UDP stream, or opens new one)                      |
|         v                                                                                          |
|  [ HTTP/2 CONNECT-UDP Client ] -------------------------------------------------+                 |
|    - Encapsulates into RFC 9297 DATAGRAM Capsule (Type: 0x00)                    |                 |
|    - Streams over HTTP/2 request body                                           |                 |
+---------------------------------------------------------------------------------+------------------+
                                                                                    |
                                                                                    | HTTPS (TLS) / H2
                                                                                    | Capsule Protocol
                                                                                    v
+----------------------------------------------------------------------------------------------------+
|                                           SERVER SIDE                                              |
|                                                                                                    |
|  [ HTTP/2 Server (defaultHandler) ]                                                                |
|    - Checks Proxy-Authorization                                                                    |
|    - Validates CONNECT-UDP URI template: /.well-known/masque/udp/{target_host}/{target_port}/      |
|    - Returns 200 OK with Capsule-Protocol: ?1                                                      |
|         |                                                                                          |
|         v                                                                                          |
|  [ Capsule <-> UDP Bridge Worker ]                                                                 |
|    - Reads DATAGRAM capsules from client HTTP stream                                               |
|    - Writes raw payload to UDP Socket (net.DialUDP)                                                |
|    - Reads incoming UDP packets from remote target                                                 |
|    - Encapsulates into RFC 9297 DATAGRAM capsules -> writes to response body stream + Flush        |
|         |                                                                                          |
|         +----------------------------------------+                                                 |
|                                                  |                                                 |
|                                                  v                                                 |
|                                      [ Remote UDP Target ]                                         |
|                                      (e.g., 8.8.8.8:53, 1.1.1.1:443)                               |
+----------------------------------------------------------------------------------------------------+
```

---

## 4. Detailed Component Design

### 4.1. Capsule & Variable-Length Integer Utilities (`utils/capsule.go`)
RFC 9297 and RFC 9298 rely on QUIC variable-length integer (varint) encoding (RFC 9000 §16):
- **Varint Encoding**: 2-bit prefix determining length (1, 2, 4, or 8 bytes).
- **Capsule Structure**:
  ```
  +-------------------------------+
  | Capsule Type (i) = 0x00       |  (DATAGRAM)
  +-------------------------------+
  | Capsule Length (i)            |  (Length of Value)
  +-------------------------------+
  | Context ID (i) = 0x00         |  (Default UDP Context)
  +-------------------------------+
  | HTTP Datagram Payload (UDP)   |
  +-------------------------------+
  ```
- **Helper Functions**:
  - `ReadVarint(r io.Reader) (uint64, error)`
  - `AppendVarint(buf []byte, v uint64) []byte`
  - `ReadCapsule(r io.Reader) (*Capsule, error)`
  - `WriteDatagramCapsule(w io.Writer, contextID uint64, payload []byte) error`

### 4.2. Server Implementation (`server/udp.go` & `server/main.go`)
1. **Route Handling**:
   - Matches request path: `/.well-known/masque/udp/{target_host}/{target_port}/` or `:protocol = connect-udp` with header `Capsule-Protocol: ?1`.
   - If unauthenticated, fallback to camouflage reverse proxy.
   - If authenticated, acknowledge with HTTP `200 OK`, `Capsule-Protocol: ?1`, and flushes headers.
2. **UDP Worker Lifecycle**:
   - Resolves target IP and establishes `net.DialUDP("udp", nil, targetAddr)`.
   - **Stream-to-UDP**: Reads `DATAGRAM` capsules from `r.Body`, decapsulates payload, and writes to UDP connection.
   - **UDP-to-Stream**: Reads from UDP connection, wraps in `DATAGRAM` capsule, writes to `w`, and calls `w.(http.Flusher).Flush()`.
   - **Inactivity Timeout**: Session terminates after 30–60 seconds of idle traffic.
   - **Metrics**: Updates prometheus bandwidth (`conn="UDP"`) and active connections.

### 4.3. Client Implementation (`client/udp.go` & `client/socks5.go`)
1. **Tunnel Establishment**:
   - `(s *shpClient) buildUDPTunnel(targetHost, targetPort, proxyHost string) (io.ReadWriteCloser, error)`
   - Sends HTTP/2 CONNECT-UDP request with `Proxy-Authorization` and `Capsule-Protocol: ?1`.
2. **Local SOCKS5 Server (`client/socks5.go`)**:
   - Listens on configured local port (or separate SOCKS5 port).
   - Handles `CMD = 0x01 (CONNECT)` for TCP and `CMD = 0x03 (UDP ASSOCIATE)` for UDP.
   - For `UDP ASSOCIATE`:
     - Allocates a local UDP relay socket.
     - Intercepts SOCKS5 UDP request packets, extracts target address and payload.
     - Routes packet through corresponding CONNECT-UDP tunnel stream.
     - Relays response capsules back to the local SOCKS5 client.

---

## 5. Alternatives Considered

| Alternative | Description | Pros | Cons |
|---|---|---|---|
| **A. Full RFC 9298 + SOCKS5 UDP (Recommended)** | Standard CONNECT-UDP + local SOCKS5 server | Standard-compliant, compatible with MASQUE ecosystems and all OS apps via SOCKS5 | Requires SOCKS5 listener in client |
| **B. Custom WebSocket UDP encapsulation** | Tunnel UDP over custom WS frames | Easy to implement in WebExtensions | Proprietary, non-standard, no MASQUE interoperability |
| **C. TUN/TAP Virtual Adapter** | Intercept all OS packets at network layer | Completely transparent for all apps without proxy settings | Requires root/admin permissions, OS kernel drivers, platform-dependent |

---

## 6. Implementation Complexity & Effort

| Area | Effort | Estimated LoC | Key Considerations |
|---|---|---|---|
| `utils/capsule.go` + tests | **Low** | ~150 lines | Pure encoding/decoding, RFC 9297 compliant |
| `server/udp.go` + tests | **Moderate** | ~250 lines | UDP socket lifecycle, idle timeout, metrics |
| `client/udp.go` (HTTP2 Tunnel) | **Moderate** | ~200 lines | HTTP/2 streaming body, pipe management |
| `client/socks5.go` (UDP Associate) | **Moderate** | ~300 lines | SOCKS5 UDP relay and session multiplexing |
| **Total Estimated Effort** | **Moderate** | **~900–1,100 lines** | Zero external dependencies, pure Go |

---

## 7. Security and Camouflage Considerations
- **No Open UDP Relay**: Target validation ensures the server only dials the specific host and port requested in the authenticated URL template.
- **Camouflage Preservation**: Unauthenticated requests targeting `/masque/udp/...` are routed directly to the camouflage upstream reverse proxy without revealing the existence of the proxy service.
- **Amplification Attack Protection**: UDP rate-limiting and connection tracking per authenticated user.

---

## 8. Decision & Next Steps
- [ ] Review and approve ARD.
- [ ] Implement `utils/capsule.go` with RFC 9297 varint and capsule parser tests.
- [ ] Implement server-side CONNECT-UDP handler and UDP bridge.
- [ ] Implement client-side `buildUDPTunnel` and SOCKS5 UDP Associate listener.
- [ ] End-to-end testing with DNS UDP (port 53) and QUIC (port 443).
