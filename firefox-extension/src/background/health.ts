/**
 * health.ts — Periodic & concurrent latency checking for all proxy hosts with Go client parity.
 *
 * Latency Check Logic:
 *  1. Deduplicate unique hosts across all proxy groups.
 *  2. Concurrently test up to MAX_CONCURRENT_HOST_TESTS (3) servers at a time.
 *  3. For each server, probe 3 times sequentially, taking the MINIMUM latency of successful probes.
 *  4. If all 3 probes fail, mark as timed out (latency = null).
 *  5. Persist latencies to storage, re-sort proxy group active hosts by latency, update PAC script & UI.
 *  6. Automatically schedule alarms based on healthCheckIntervalMinutes setting.
 */

import { getSettings, saveSettings, getLatencies, saveLatencies } from '../storage';
import { setProxy } from './pac';
import type { AppSettings, LatencyData, HostLatency } from '../types';

const LATENCY_HISTORY_LENGTH = 50; // keep the most recent 50 measurements
const HEALTH_CHECK_ALARM = 'health-check-alarm';
const MAX_CONCURRENT_HOST_TESTS = 3;

async function fetchWithTimeout(url: string, timeout = 5000): Promise<number | null> {
  const start = Date.now();

  return new Promise<number | null>((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeout);

    const done = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(Date.now() - start);
      }
    };

    // Attempt 1: Standard fetch
    fetch(url, { mode: 'no-cors', cache: 'no-store' })
      .then(done)
      .catch(() => {
        // Even if fetch errors (e.g. 407 status or network rejection),
        // if it responded before timeout, measure RTT time
        done();
      });
  });
}

/** Test host latency 3 times sequentially and return min latency, or null if all 3 fail. */
async function measureHostLatency(url: string): Promise<number | null> {
  let minLatency: number | null = null;
  for (let i = 0; i < 3; i++) {
    const lat = await fetchWithTimeout(url, 5000);
    if (lat !== null) {
      if (minLatency === null || lat < minLatency) {
        minLatency = lat;
      }
    }
  }
  return minLatency;
}

/** Helper to process array of tasks with controlled concurrency concurrencyLimit */
async function mapConcurrent<T, R>(items: T[], concurrencyLimit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrencyLimit, items.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

export async function checkHealth(): Promise<void> {
  const settings = await getSettings();

  // Collect and deduplicate all unique hosts across all proxy groups
  const hostSet = new Set<string>();
  for (const group of settings.proxies) {
    for (const host of group.hosts) {
      if (host && host.trim()) hostSet.add(host.trim());
    }
  }
  const allHosts = Array.from(hostSet);
  if (allHosts.length === 0) return;

  const latencies = await getLatencies();
  const time = Date.now();
  const latestHostLatencyMap = new Map<string, number | null>();

  // Run latency checks concurrently for up to 3 hosts at a time
  await mapConcurrent(allHosts, MAX_CONCURRENT_HOST_TESTS, async (host) => {
    const hostWithProtocol = host.startsWith('http://') || host.startsWith('https://')
      ? host
      : `https://${host}`;
    const url = `${hostWithProtocol}${settings.authBasePath}407`;
    const minLat = await measureHostLatency(url);
    latestHostLatencyMap.set(host, minLat);

    const latencyData: LatencyData = { time, latency: minLat };

    if (!latencies[host]) {
      latencies[host] = { host, history: [] };
    }

    latencies[host].history.push(latencyData);
    if (latencies[host].history.length > LATENCY_HISTORY_LENGTH) {
      latencies[host].history = latencies[host].history.slice(-LATENCY_HISTORY_LENGTH);
    }
  });

  // Persist updated latency history to chrome.storage.local
  await saveLatencies(latencies);

  // ── Update settings & PAC script based on latest latency data ───────
  // Sort proxy group host ordering so PAC script gets exact latency alignment
  let settingsNeedSave = false;
  const updatedProxies = settings.proxies.map(group => {
    const sortedHosts = [...group.hosts].sort((a, b) => {
      const latA = latestHostLatencyMap.get(a) ?? null;
      const latB = latestHostLatencyMap.get(b) ?? null;

      // Active (non-null) hosts come first, ordered by lowest latency
      if (latA !== null && latB !== null) return latA - latB;
      if (latA !== null) return -1;
      if (latB !== null) return 1;
      return 0;
    });

    if (JSON.stringify(sortedHosts) !== JSON.stringify(group.hosts)) {
      settingsNeedSave = true;
      return { ...group, hosts: sortedHosts };
    }
    return group;
  });

  if (settingsNeedSave) {
    const updatedSettings = { ...settings, proxies: updatedProxies };
    await saveSettings(updatedSettings);
    await setProxy(updatedSettings);
  } else {
    // Regenerate PAC script with current settings + latest latencies map
    await setProxy(settings);
  }

  // Broadcast update to open UI options/popup pages
  const extApi: any = typeof browser !== 'undefined' ? browser : chrome;
  extApi.runtime.sendMessage({ type: 'LATENCIES_UPDATED', latencies }).catch(() => {});
}

export async function setupHealthCheckAlarm(): Promise<void> {
  const extApi: any = typeof browser !== 'undefined' ? browser : chrome;
  const settings = await getSettings();
  const interval = Math.max(1, settings.healthCheckIntervalMinutes || 1);

  if (extApi.alarms) {
    extApi.alarms.get(HEALTH_CHECK_ALARM, (alarm: any) => {
      if (!alarm || alarm.periodInMinutes !== interval) {
        extApi.alarms.create(HEALTH_CHECK_ALARM, {
          periodInMinutes: interval,
        });
      }
    });
  }
}

export function registerHealthCheckAlarm(): void {
  const extApi = typeof browser !== 'undefined' ? browser : chrome;
  if (extApi.alarms && extApi.alarms.onAlarm) {
    extApi.alarms.onAlarm.addListener((alarm: any) => {
      if (alarm.name === HEALTH_CHECK_ALARM) {
        checkHealth();
      }
    });
  }

  setupHealthCheckAlarm();
}
