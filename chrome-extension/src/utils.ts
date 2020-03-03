import * as yaml from 'js-yaml';

import { ShpConfig } from './config';
import * as configValidator from './config.validator.js';

export const defaultConfigYaml = `
# you can find the following config in go-shp server page after login

username: YOUR_USERNAME
token: YOUR_TOKEN
auth_base_path: /some-url/

proxies:
- name: PROXY_GROUP_NAME
  hosts:
  - YOUR_PROXY_HOST_A:443
  - YOUR_PROXY_HOST_B:443
  select_policy: LATENCY # LATENCY / RANDOM / RANDOM_ON_SIMILAR_LOWEST_LATENCY
- name: PROXY_INTERNAL
  hosts:
  - YOUR_PROXY_HOST_C:443
  - YOUR_PROXY_HOST_D:443
  select_policy: RANDOM

rules:
- proxy_name: DIRECT
  domains:
  - 163.com
  - qq.com
  - cn
- proxy_name: PROXY_GROUP_NAME
  domains:
  - google.com
  - twitter.com
- proxy_name: PROXY_INTERNAL
  domains:
  - YOUR_INTERNAL_WEB.com

unmatched_policy:
  proxy_name: DIRECT
  detect: false # if proxy_name is DIRECT, this is ignored
  detect_delay_ms: 100
  detect_expires_second: 1800
  # or
  # proxy_name: PROXY_GROUP_NAME
  # detect: true # this will try with DIRECT and PROXY_GROUP_NAME

`;


function iterateObject(input: any, changeCase: (key: string) => string): any {
  if (Array.isArray(input)) {
    return input.map(item => iterateObject(item, changeCase));
  }
  if (input && typeof input === 'object') {
    return Object.keys(input).reduce((result, key) => {
      result[changeCase(key)] = iterateObject(input[key], changeCase);
      return result;
    }, {});
  }
  return input;
}

export function snakeCaseToCamelCase(input: any): any {
  return iterateObject(input, (key: string) => {
    return key.split('_').map((part, index) => {
      if (index === 0) return part;
      return part[0].toUpperCase() + part.slice(1);
    }).join('');
  });
}

export function camelCaseToSnakeCase(input: any): any {
  return iterateObject(input, (key: string) => {
    return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  });
}

export function validateConfig(input: any): ShpConfig {
  if (configValidator(input)) {
    return input;
  }
  throw configValidator.errors;
}

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function storageGet(keys: string | string[] | Object | null): Promise<{ [key: string]: any }> {
  return new Promise(resolve => {
    chrome.storage.sync.get(keys, resolve)
  });
}

export async function storageSet(items: { [key: string]: any }): Promise<null> {
  return new Promise(resolve => chrome.storage.sync.set(items, resolve))
}

export async function getConfig(): Promise<{config: ShpConfig, enabled: boolean}> {
  const {enabled, configYaml} = await storageGet({
    configYaml: defaultConfigYaml,
    enabled: false,
  });
  if (!configYaml) return {enabled, config: undefined};
  const config: ShpConfig = snakeCaseToCamelCase(yaml.safeLoad(configYaml));
  return {enabled, config};
}

export const $ = (selector: string) => document.querySelector(selector);
