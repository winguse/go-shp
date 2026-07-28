/**
 * storage.ts — Chrome storage helpers and robust YAML import/export.
 */

import type { AppSettings, HostLatency, ProxyGroup, RoutingRule, UnmatchedPolicy } from './types';

// ── Defaults ──────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'off',
  enabled: false,
  globalProxyPolicy: 'LATENCY',
  globalProxyTarget: '',
  username: '',
  token: '',
  authBasePath: '/auth/',
  listenPort: 8080,
  proxies: [],
  rules: [],
  healthCheckIntervalMinutes: 1,
  unmatchedPolicy: {
    proxyName: 'DIRECT',
    detect: false,
    detectDelayMs: 100,
    detectExpiresSecond: 1800,
  },
};

// ── Settings storage ──────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  const data = await chrome.storage.local.get('settings');
  const stored = (data.settings || {}) as Partial<AppSettings>;
  
  // Migration / back-compat for mode
  let mode = stored.mode;
  if (!mode) {
    mode = stored.enabled ? 'by_rule' : 'off';
  }

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    mode,
    enabled: mode !== 'off',
    unmatchedPolicy: {
      ...DEFAULT_SETTINGS.unmatchedPolicy,
      ...(stored.unmatchedPolicy ?? {}),
    },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => {});
}

// ── Latency storage ───────────────────────────────────────────────────

export async function getLatencies(): Promise<Record<string, HostLatency>> {
  const data = await chrome.storage.local.get('latencies');
  return (data.latencies as Record<string, HostLatency>) || {};
}

export async function saveLatencies(latencies: Record<string, HostLatency>): Promise<void> {
  await chrome.storage.local.set({ latencies });
}

// ── YAML export ───────────────────────────────────────────────────────

export function exportToYaml(s: AppSettings): string {
  const lines: string[] = [];

  lines.push(`username: ${yamlStr(s.username)}`);
  lines.push(`token: ${yamlStr(s.token)}`);
  lines.push(`auth_base_path: ${yamlStr(s.authBasePath)}`);
  lines.push(`listen_port: ${s.listenPort}`);
  lines.push('');

  if (s.proxies.length > 0) {
    lines.push('proxies:');
    for (const p of s.proxies) {
      lines.push(`- name: ${yamlStr(p.name)}`);
      lines.push(`  hosts:`);
      for (const h of p.hosts) {
        lines.push(`  - ${yamlStr(h)}`);
      }
      lines.push(`  select_policy: ${p.selectPolicy}`);
    }
    lines.push('');
  }

  if (s.rules.length > 0) {
    lines.push('rules:');
    for (const r of s.rules) {
      lines.push(`- proxy_name: ${yamlStr(r.proxyName)}`);
      lines.push(`  domains:`);
      for (const d of r.domains) {
        lines.push(`  - ${yamlStr(d)}`);
      }
    }
    lines.push('');
  }

  lines.push('unmatched_policy:');
  lines.push(`  proxy_name: ${yamlStr(s.unmatchedPolicy.proxyName)}`);
  if (s.unmatchedPolicy.proxyName !== 'DIRECT') {
    lines.push(`  detect: ${s.unmatchedPolicy.detect}`);
    lines.push(`  detect_delay_ms: ${s.unmatchedPolicy.detectDelayMs}`);
    lines.push(`  detect_expires_second: ${s.unmatchedPolicy.detectExpiresSecond}`);
  }

  return lines.join('\n') + '\n';
}

function yamlStr(value: string): string {
  if (value === '') return "''";
  if (/[:#\[\]{}&*!|>'"%@`]/.test(value[0]) || /: /.test(value) || value.includes('\n')) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return value;
}

// ── YAML import ───────────────────────────────────────────────────────

export function importFromYaml(yaml: string, existingSettings: AppSettings): AppSettings {
  const doc = parseSimpleYaml(yaml);

  const username     = getString(doc, 'username', '');
  const token        = getString(doc, 'token', '');
  const authBasePath = getString(doc, 'auth_base_path', '/auth/');
  const listenPort   = getNumber(doc, 'listen_port', 8080);

  // ── proxies[] ──────────────────────────────────────────────────────
  const rawProxies = getSequence(doc, 'proxies');
  const proxies: ProxyGroup[] = [];
  for (let i = 0; i < rawProxies.length; i++) {
    const p = rawProxies[i];
    if (p.name || p.hosts) {
      const name = getString(p, 'name', `Proxy ${i + 1}`);
      const hosts = getStringArray(p, 'hosts');
      const selectPolicy = getString(p, 'select_policy', 'RANDOM') as ProxyGroup['selectPolicy'];
      const existingGroup = existingSettings.proxies.find(g => g.name === name);
      proxies.push({
        id: existingGroup?.id ?? crypto.randomUUID(),
        name,
        hosts,
        selectPolicy,
      });
    }
  }

  // ── rules[] ────────────────────────────────────────────────────────
  const rawRules = getSequence(doc, 'rules');
  const rules: RoutingRule[] = [];
  for (let i = 0; i < rawRules.length; i++) {
    const r = rawRules[i];
    if (r.proxy_name || r.domains) {
      const proxyName = getString(r, 'proxy_name', 'DIRECT');
      const domains   = getStringArray(r, 'domains');
      rules.push({
        id: crypto.randomUUID(),
        proxyName,
        domains,
      });
    }
  }

  // ── unmatched_policy ───────────────────────────────────────────────
  const rawUnmatched = getMapping(doc, 'unmatched_policy');
  const unmatchedPolicy: UnmatchedPolicy = {
    proxyName:           getString(rawUnmatched, 'proxy_name', 'DIRECT'),
    detect:              getBoolean(rawUnmatched, 'detect', false),
    detectDelayMs:       getNumber(rawUnmatched, 'detect_delay_ms', 100),
    detectExpiresSecond: getNumber(rawUnmatched, 'detect_expires_second', 1800),
  };

  return {
    mode: existingSettings.mode,
    enabled: existingSettings.mode !== 'off',
    globalProxyPolicy: existingSettings.globalProxyPolicy ?? 'LATENCY',
    globalProxyTarget: existingSettings.globalProxyTarget ?? '',
    username,
    token,
    authBasePath,
    listenPort,
    proxies,
    rules,
    healthCheckIntervalMinutes: existingSettings.healthCheckIntervalMinutes ?? 1,
    unmatchedPolicy,
  };
}

// ── Robust YAML parser ───────────────────────────────────────────────

type YamlPrimitive = string | number | boolean | null;
interface YamlMapping { [key: string]: YamlValue }
type YamlValue = YamlPrimitive | YamlMapping | YamlValueArray;
interface YamlValueArray extends Array<YamlValue> {}

interface Line {
  indent: number;
  content: string;
}

function parseSimpleYaml(text: string): YamlMapping {
  const rawLines = text.split('\n');
  const lines: Line[] = [];

  for (const raw of rawLines) {
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    let indent = 0;
    while (indent < stripped.length && stripped[indent] === ' ') indent++;
    lines.push({ indent, content: stripped.trim() });
  }

  const root: YamlMapping = {};
  parseMapping(lines, 0, lines.length, root);
  return root;
}

function parseMapping(lines: Line[], start: number, end: number, target: YamlMapping): void {
  let i = start;
  while (i < end) {
    const line = lines[i];
    const colonIdx = line.content.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.content.slice(0, colonIdx).trim();
    const rest = line.content.slice(colonIdx + 1).trim();

    if (rest !== '') {
      target[key] = parseScalar(rest);
      i++;
    } else {
      const blockStart = i + 1;
      if (blockStart >= end) {
        target[key] = null;
        i++;
        continue;
      }

      // Root level keys might be followed by lines with indent 0 (like top-level sequences starting with `-`)
      const blockIndent = lines[blockStart].indent;
      let blockEnd = blockStart;
      while (blockEnd < end) {
        if (lines[blockEnd].indent < blockIndent) break;
        // If we hit another key at root level (indent === line.indent), stop the block
        if (lines[blockEnd].indent === line.indent && lines[blockEnd].content.includes(':') && !lines[blockEnd].content.startsWith('-')) {
          break;
        }
        blockEnd++;
      }

      if (lines[blockStart].content.startsWith('-')) {
        const seq: YamlValue[] = [];
        parseSequence(lines, blockStart, blockEnd, seq);
        target[key] = seq;
      } else {
        const map: YamlMapping = {};
        parseMapping(lines, blockStart, blockEnd, map);
        target[key] = map;
      }

      i = blockEnd;
    }
  }
}

function parseSequence(lines: Line[], start: number, end: number, target: YamlValue[]): void {
  let i = start;
  const seqIndent = lines[start].indent;

  while (i < end) {
    const line = lines[i];
    if (line.indent !== seqIndent || !line.content.startsWith('-')) {
      i++;
      continue;
    }

    const afterDash = line.content.slice(1).trim();

    let itemEnd = i + 1;
    while (itemEnd < end) {
      if (lines[itemEnd].indent < seqIndent) break;
      if (lines[itemEnd].indent === seqIndent && lines[itemEnd].content.startsWith('-')) break;
      itemEnd++;
    }

    if (afterDash === '') {
      const itemStart = i + 1;
      if (itemStart >= itemEnd) {
        target.push(null);
      } else if (lines[itemStart].content.startsWith('-')) {
        const subSeq: YamlValue[] = [];
        parseSequence(lines, itemStart, itemEnd, subSeq);
        target.push(subSeq);
      } else {
        const map: YamlMapping = {};
        parseMapping(lines, itemStart, itemEnd, map);
        target.push(map);
      }
    } else {
      const colonSpaceIdx = afterDash.indexOf(': ');
      const isObjectKey = colonSpaceIdx !== -1 || (afterDash.endsWith(':') && !afterDash.startsWith("'") && !afterDash.startsWith('"'));

      if (isObjectKey) {
        const map: YamlMapping = {};
        const cIdx = colonSpaceIdx !== -1 ? colonSpaceIdx : afterDash.indexOf(':');
        const k = afterDash.slice(0, cIdx).trim();
        const v = afterDash.slice(cIdx + 1).trim();

        if (v !== '') {
          map[k] = parseScalar(v);
        }

        if (i + 1 < itemEnd) {
          parseMapping(lines, i + 1, itemEnd, map);
        }
        target.push(map);
      } else {
        target.push(parseScalar(afterDash));
      }
    }

    i = itemEnd;
  }
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(s: string): string | number | boolean | null {
  if (s === 'null' || s === '~') return null;
  if (s === 'true')  return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (!isNaN(n) && s !== '') return n;
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return s;
}

function getString(m: YamlMapping, key: string, fallback: string): string {
  const v = m[key];
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function getNumber(m: YamlMapping, key: string, fallback: number): number {
  const v = m[key];
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function getBoolean(m: YamlMapping, key: string, fallback: boolean): boolean {
  const v = m[key];
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  return v === 'true';
}

function getSequence(m: YamlMapping, key: string): YamlMapping[] {
  const v = m[key];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is YamlMapping => typeof item === 'object' && item !== null && !Array.isArray(item));
}

function getMapping(m: YamlMapping, key: string): YamlMapping {
  const v = m[key];
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as YamlMapping;
  return {};
}

function getStringArray(m: YamlMapping, key: string): string[] {
  const v = m[key];
  if (!Array.isArray(v)) return [];
  const res: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' || typeof item === 'number') {
      res.push(String(item));
    }
  }
  return res;
}
