

export enum ProxySelectPolicy {
  RANDOM = 'RANDOM',
  LATENCY = 'LATENCY',
  RANDOM_ON_SIMILAR_LOWEST_LATENCY = 'RANDOM_ON_SIMILAR_LOWEST_LATENCY',
}

export interface Proxy {
  name: string
  /**
   * hosts of this proxy
   * @minItems 1
   */
  hosts: Array<string>
  selectPolicy: ProxySelectPolicy
}

export interface Rule { 
  proxyName: string

  /**
   * domains for this rule
   * @minItems 1
   */
  domains: Array<string>
}

export interface UnmatchedPolicy {
  proxyName: string
  detect: boolean
  detectDelayMs: number
  detectExpiresSecond: number
}

/**
 * SHP config
 */
export interface ShpConfig {  
  username: string
  token: string
  authBasePath: string

  /**
   * Proxies
   * @minItems 1
   */
  proxies: Array<Proxy>


  /**
   * Rules
   * @minItems 1
   */
  rules: Array<Rule>
  unmatchedPolicy: UnmatchedPolicy
}
