export interface ProxyGroup {
  id: string;
  name: string;
  hosts: string[];
  selectPolicy: 'LATENCY' | 'RANDOM_ON_SIMILAR_LOWEST_LATENCY' | 'RANDOM';
}

export interface RoutingRule {
  id: string;
  proxyName: string; // matches ProxyGroup.name or 'DIRECT'
  domains: string[];
}

export interface UnmatchedPolicy {
  proxyName: string;
  detect: boolean;
  detectDelayMs: number;
  detectExpiresSecond: number;
}

export interface AppSettings {
  mode: 'off' | 'by_rule' | 'global';
  enabled: boolean;
  globalProxyPolicy: 'LATENCY' | 'RANDOM_ON_SIMILAR_LOWEST_LATENCY' | 'RANDOM' | 'SPECIFIC';
  globalProxyTarget: string;
  username: string;
  token: string;
  authBasePath: string;
  listenPort: number;
  proxies: ProxyGroup[];
  rules: RoutingRule[];
  healthCheckIntervalMinutes: number;
  unmatchedPolicy: UnmatchedPolicy;
}

export interface LatencyData {
  time: number;
  latency: number | null; // null means check failed / timed out
}

export interface HostLatency {
  host: string;
  history: LatencyData[];
}
