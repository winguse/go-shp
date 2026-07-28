/**
 * types.ts — Shared type definitions for the Go SHP Chrome Extension.
 *
 * These types mirror the Go client's config structure (client/config.sample.yaml)
 * so that configs can be exported/imported between the CLI client and the extension.
 */

// ── Proxy group (maps to Go client's `proxies[]`) ─────────────────────

/** Selection policy when a proxy group has multiple hosts. */
export type SelectPolicy =
  | 'RANDOM'
  | 'LATENCY'
  | 'RANDOM_ON_SIMILAR_LOWEST_LATENCY';

/**
 * A named group of one or more proxy hosts.
 * Equivalent to `Proxy` in the Go client config.
 */
export interface ProxyGroup {
  /** Stable unique ID (UUID), used internally by the extension. */
  id: string;
  /** Human-readable name, e.g. "US West". Maps to `proxies[].name`. */
  name: string;
  /** List of `host:port` strings. Maps to `proxies[].hosts[]`. */
  hosts: string[];
  /** Host selection policy. Maps to `proxies[].select_policy`. */
  selectPolicy: SelectPolicy;
}

// ── Routing rule (maps to Go client's `rules[]`) ──────────────────────

/**
 * A routing rule: all listed domains are sent through the named proxy (or DIRECT).
 * Rules are evaluated in order; the first match wins.
 * Equivalent to `Rule` in the Go client config.
 */
export interface RoutingRule {
  /** Stable unique ID (UUID), used internally by the extension. */
  id: string;
  /**
   * Name of a ProxyGroup, or the reserved string "DIRECT".
   * Maps to `rules[].proxy_name`.
   */
  proxyName: string;
  /**
   * Domains covered by this rule (one per entry, suffix-matched).
   * Maps to `rules[].domains[]`.
   */
  domains: string[];
}

// ── Unmatched policy (maps to Go client's `unmatched_policy`) ─────────

/**
 * What to do when a domain doesn't match any rule.
 * Equivalent to `UnmatchedPolicy` in the Go client config.
 */
export interface UnmatchedPolicy {
  /**
   * Name of a ProxyGroup, or "DIRECT".
   * Maps to `unmatched_policy.proxy_name`.
   */
  proxyName: string;
  /**
   * If true, try DIRECT first and fall back to the proxy if direct fails.
   * Ignored when proxyName is "DIRECT".
   * Maps to `unmatched_policy.detect`.
   */
  detect: boolean;
  /**
   * How long (ms) to delay the proxy attempt while waiting for direct.
   * Maps to `unmatched_policy.detect_delay_ms`.
   */
  detectDelayMs: number;
  /**
   * How long (seconds) a detected-fail domain is remembered.
   * Maps to `unmatched_policy.detect_expires_second`.
   */
  detectExpiresSecond: number;
}

/** Mode of operation for the proxy extension. */
export type ProxyMode = 'off' | 'by_rule' | 'global';

/** Selection policy or specific host selection for global mode. */
export type GlobalProxyPolicy =
  | 'LATENCY'
  | 'RANDOM_ON_SIMILAR_LOWEST_LATENCY'
  | 'RANDOM'
  | 'SPECIFIC';

// ── Top-level settings ────────────────────────────────────────────────

/**
 * Full extension settings.  The shape is intentionally close to the Go client
 * config so that import/export is straightforward.
 */
export interface AppSettings {
  /** Mode of operation: 'off', 'by_rule', or 'global'. */
  mode: ProxyMode;
  /** Legacy toggle flag retained for compatibility. */
  enabled: boolean;
  /** Policy for global mode ('LATENCY', 'RANDOM_ON_SIMILAR_LOWEST_LATENCY', 'RANDOM', 'SPECIFIC'). */
  globalProxyPolicy: GlobalProxyPolicy;
  /** Specific host (e.g. "host:port") selected when globalProxyPolicy is 'SPECIFIC'. */
  globalProxyTarget: string;
  /** Basic-auth username. Maps to `username`. */
  username: string;
  /** Basic-auth token/password. Maps to `token`. */
  token: string;
  /**
   * URL path prefix used for the auth/health handshake.
   * Maps to `auth_base_path`.
   */
  authBasePath: string;
  /**
   * Local listen port (used only when exporting to Go client config).
   * Maps to `listen_port`. Default 8080.
   */
  listenPort: number;
  /** Ordered list of proxy groups. Maps to `proxies[]`. */
  proxies: ProxyGroup[];
  /**
   * Ordered routing rules evaluated top-to-bottom.
   * Maps to `rules[]`.
   */
  rules: RoutingRule[];
  /**
   * Health check interval in minutes (default 1).
   */
  healthCheckIntervalMinutes: number;
  /**
   * Fallback behaviour for unmatched domains.
   * Maps to `unmatched_policy`.
   */
  unmatchedPolicy: UnmatchedPolicy;
}

// ── Latency tracking (extension-only, not in Go client config) ────────

export interface LatencyData {
  time: number;
  /** null means the check timed-out or errored. */
  latency: number | null;
}

/** Per-host latency history, keyed by host string (e.g. "proxy.example.com:443"). */
export interface HostLatency {
  host: string;
  history: LatencyData[];
}
