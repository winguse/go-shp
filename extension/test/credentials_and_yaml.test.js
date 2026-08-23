import assert from 'node:assert';
import { test } from 'node:test';
import { getCredentialForHost, exportToYaml, importFromYaml } from '../src/storage.ts';

test('getCredentialForHost resolution rules', () => {
  const credentials = {
    'proxy.example.com': {
      username: 'user1',
      token: 'token1',
      authBasePath: '/abc/'
    },
    'proxyx.example.com:443': {
      username: 'user2',
      token: 'token2'
    },
    'proxycustom.example.com:8443': {
      username: 'user3',
      token: 'token3',
      authBasePath: '/custom/'
    },
    '_': {
      username: 'default_user',
      token: 'default_token'
    }
  };

  // 1. Exact match
  assert.deepStrictEqual(getCredentialForHost(credentials, 'proxy.example.com'), credentials['proxy.example.com']);

  // 2. Lookup with :443 when key has no port
  assert.deepStrictEqual(getCredentialForHost(credentials, 'proxy.example.com:443'), credentials['proxy.example.com']);

  // 3. Lookup without port when key has :443
  assert.deepStrictEqual(getCredentialForHost(credentials, 'proxyx.example.com'), credentials['proxyx.example.com:443']);

  // 4. Lookup with :443 when key has :443
  assert.deepStrictEqual(getCredentialForHost(credentials, 'proxyx.example.com:443'), credentials['proxyx.example.com:443']);

  // 5. Custom port match
  assert.deepStrictEqual(getCredentialForHost(credentials, 'proxycustom.example.com:8443'), credentials['proxycustom.example.com:8443']);

  // 6. Unknown host falls back to '_'
  assert.deepStrictEqual(getCredentialForHost(credentials, 'unknown.example.com:443'), credentials['_']);
  assert.deepStrictEqual(getCredentialForHost(credentials, 'unknown.example.com'), credentials['_']);

  // 7. No fallback when '_' not configured
  assert.strictEqual(getCredentialForHost({}, 'unknown.com'), undefined);
  assert.strictEqual(getCredentialForHost(undefined, 'unknown.com'), undefined);
});

test('exportToYaml and importFromYaml roundtrip', () => {
  const originalSettings = {
    mode: 'by_rule',
    enabled: true,
    globalProxyPolicy: 'LATENCY',
    globalProxyTarget: '',
    credentials: {
      'proxy.example.com': {
        username: 'user',
        token: 'abcde',
        authBasePath: '/abc/'
      },
      'proxyx.example.com:443': {
        username: 'user2',
        token: 'abcde3'
      },
      '_': {
        username: 'defuser',
        token: 'deftoken'
      }
    },
    listenPort: 8080,
    proxies: [
      {
        id: 'p1',
        name: 'GRP1',
        hosts: ['proxy.example.com', 'proxyx.example.com:443'],
        selectPolicy: 'LATENCY'
      }
    ],
    rules: [
      {
        id: 'r1',
        proxyName: 'GRP1',
        domains: ['example.com', 'test.org']
      }
    ],
    healthCheckIntervalMinutes: 1,
    unmatchedPolicy: {
      proxyName: 'DIRECT',
      detect: false,
      detectDelayMs: 100,
      detectExpiresSecond: 1800
    }
  };

  const yaml = exportToYaml(originalSettings);
  assert.ok(yaml.includes('credentials:'));
  assert.ok(yaml.includes('proxy.example.com:'));
  assert.ok(yaml.includes("'proxyx.example.com:443':"));
  assert.ok(yaml.includes('_:'));
  assert.ok(yaml.includes('/abc/'));

  const imported = importFromYaml(yaml, originalSettings);
  assert.strictEqual(imported.listenPort, 8080);
  assert.strictEqual(imported.credentials['proxy.example.com'].username, 'user');
  assert.strictEqual(imported.credentials['proxy.example.com'].token, 'abcde');
  assert.strictEqual(imported.credentials['proxy.example.com'].authBasePath, '/abc/');

  assert.strictEqual(imported.credentials['proxyx.example.com:443'].username, 'user2');
  assert.strictEqual(imported.credentials['proxyx.example.com:443'].token, 'abcde3');
  assert.strictEqual(imported.credentials['proxyx.example.com:443'].authBasePath, undefined);

  assert.strictEqual(imported.credentials['_'].username, 'defuser');
  assert.strictEqual(imported.credentials['_'].token, 'deftoken');

  assert.strictEqual(imported.proxies.length, 1);
  assert.strictEqual(imported.proxies[0].name, 'GRP1');
  assert.deepStrictEqual(imported.proxies[0].hosts, ['proxy.example.com', 'proxyx.example.com:443']);

  assert.strictEqual(imported.rules.length, 1);
  assert.deepStrictEqual(imported.rules[0].domains, ['example.com', 'test.org']);
});

test('importFromYaml with quoted keys and single default host _', () => {
  const yaml = `
credentials:
  'proxy.example.com:443':
    username: myuser
    token: mytoken
    auth_base_path: /trigger/
  _:
    username: defaultuser
    token: defaulttoken

listen_port: 9090
proxies:
  - name: GRP_QUOTED
    hosts:
      - 'proxy.example.com:443'
    select_policy: RANDOM
rules:
  - proxy_name: GRP_QUOTED
    domains:
      - example.com
`;

  const imported = importFromYaml(yaml, {
    mode: 'by_rule',
    enabled: true,
    globalProxyPolicy: 'LATENCY',
    globalProxyTarget: '',
    credentials: {},
    listenPort: 8080,
    proxies: [],
    rules: [],
    healthCheckIntervalMinutes: 1,
    unmatchedPolicy: { proxyName: 'DIRECT', detect: false, detectDelayMs: 100, detectExpiresSecond: 1800 }
  });

  assert.strictEqual(imported.listenPort, 9090);
  assert.strictEqual(imported.credentials['proxy.example.com:443'].username, 'myuser');
  assert.strictEqual(imported.credentials['proxy.example.com:443'].token, 'mytoken');
  assert.strictEqual(imported.credentials['proxy.example.com:443'].authBasePath, '/trigger/');
  assert.strictEqual(imported.credentials['_'].username, 'defaultuser');
  assert.strictEqual(imported.credentials['_'].token, 'defaulttoken');
});

