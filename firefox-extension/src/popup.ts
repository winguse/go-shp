/**
 * popup.ts — Controller for popup.html
 *
 * Rules:
 *  - All HTML elements already exist in popup.html.
 *  - This file only queries, reads, and mutates existing elements.
 *  - No innerHTML string generation, no JSX, no 3rd-party runtime deps.
 *  - Renders a mini SVG latency line chart (without legends, with SVG <title> tooltips).
 */

import { getSettings, saveSettings, getLatencies } from './storage';
import type { AppSettings, HostLatency } from './types';

// ── Element references ────────────────────────────────────────────────

const popupIcon        = document.getElementById('popup-icon')            as HTMLImageElement;
const btnToggle        = document.getElementById('btn-toggle')            as HTMLButtonElement;
const toggleLabel      = document.getElementById('toggle-label')          as HTMLSpanElement;
const statusText       = document.getElementById('status-text')           as HTMLSpanElement;
const btnOptions       = document.getElementById('btn-open-options')     as HTMLButtonElement;
const popupChartContainer = document.getElementById('popup-chart-container') as HTMLDivElement;
const loadingEl        = document.getElementById('loading-overlay')        as HTMLDivElement;

const popupCustomDropdown       = document.getElementById('popup-custom-dropdown')        as HTMLDivElement;
const popupDropdownTrigger       = document.getElementById('popup-dropdown-trigger')       as HTMLButtonElement;
const popupDropdownSelectedText  = document.getElementById('popup-dropdown-selected-text')  as HTMLSpanElement;
const popupDropdownMenu          = document.getElementById('popup-dropdown-menu')          as HTMLDivElement;

// ── State ─────────────────────────────────────────────────────────────

let currentSettings: AppSettings | null = null;
let latencies: Record<string, HostLatency> = {};

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0891b2', '#7c3aed'];

// ── Render Global Target Custom Dropdown ──────────────────────────────

interface DropdownOption {
  value: string;
  label: string;
  isGroupHeader?: boolean;
}

function renderGlobalTargetSelect(settings: AppSettings): void {
  const mode = settings.mode || (settings.enabled ? 'by_rule' : 'off');
  if (mode !== 'global') {
    popupCustomDropdown.style.display = 'none';
    popupDropdownMenu.classList.remove('custom-dropdown__menu--open');
    popupDropdownTrigger.classList.remove('custom-dropdown__trigger--open');
    return;
  }

  popupCustomDropdown.style.display = 'inline-block';
  popupDropdownMenu.innerHTML = '';

  const options: DropdownOption[] = [
    { value: 'LATENCY', label: 'latency' },
    { value: 'RANDOM_ON_SIMILAR_LOWEST_LATENCY', label: 'latency similar' },
    { value: 'RANDOM', label: 'random' },
  ];

  const allHosts: string[] = [];
  for (const g of settings.proxies) {
    for (const h of g.hosts) {
      if (h && !allHosts.includes(h)) allHosts.push(h);
    }
  }

  if (allHosts.length > 0) {
    options.push({ value: '', label: 'Servers', isGroupHeader: true });
    for (const host of allHosts) {
      options.push({ value: `SPECIFIC:${host}`, label: host });
    }
  }

  // Determine current active selection key
  const activeValue = (settings.globalProxyPolicy === 'SPECIFIC' && settings.globalProxyTarget)
    ? `SPECIFIC:${settings.globalProxyTarget}`
    : (settings.globalProxyPolicy || 'LATENCY');

  let activeLabel = 'latency';

  for (const opt of options) {
    if (opt.isGroupHeader) {
      const header = document.createElement('div');
      header.className = 'custom-dropdown__group-label';
      header.textContent = opt.label;
      popupDropdownMenu.appendChild(header);
      continue;
    }

    const isSelected = opt.value === activeValue;
    if (isSelected) activeLabel = opt.label;

    const item = document.createElement('div');
    item.className = `custom-dropdown__item${isSelected ? ' custom-dropdown__item--selected' : ''}`;
    item.textContent = opt.label;
    item.dataset['value'] = opt.value;

    item.addEventListener('click', async () => {
      popupDropdownMenu.classList.remove('custom-dropdown__menu--open');
      popupDropdownTrigger.classList.remove('custom-dropdown__trigger--open');
      popupDropdownTrigger.setAttribute('aria-expanded', 'false');
      await handleSelectGlobalProxyValue(opt.value);
    });

    popupDropdownMenu.appendChild(item);
  }

  popupDropdownSelectedText.textContent = activeLabel;
}

// ── Render Latency Chart ──────────────────────────────────────────────

function renderMiniLatencyChart(): void {
  popupChartContainer.querySelector('svg')?.remove();
  if (!currentSettings) return;

  // Collect all unique hosts
  const allHosts: string[] = [];
  for (const g of currentSettings.proxies) {
    for (const h of g.hosts) {
      if (h && !allHosts.includes(h)) allHosts.push(h);
    }
  }

  const allTimestamps = new Set<number>();
  for (const host of allHosts) {
    latencies[host]?.history.forEach(h => allTimestamps.add(h.time));
  }
  const sortedTimes = Array.from(allTimestamps).sort((a, b) => a - b);
  const activeHosts = allHosts.filter(h => latencies[h]?.history.length > 0);

  if (sortedTimes.length === 0 || activeHosts.length === 0) {
    return;
  }

  const W = 248, H = 68;
  const PAD = { top: 8, right: 6, bottom: 8, left: 38 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const allValues: number[] = [];
  for (const host of activeHosts) {
    latencies[host].history.forEach(h => {
      if (h.latency !== null) allValues.push(h.latency);
    });
  }
  allValues.sort((a, b) => a - b);

  let maxLatency = 0;
  if (allValues.length > 0) {
    const p50Index = Math.min(
      allValues.length - 1,
      Math.floor(allValues.length * 0.5)
    );
    maxLatency = allValues[p50Index] * 2;
  }
  if (maxLatency <= 0) maxLatency = 10;
  maxLatency = Math.ceil(maxLatency / 10) * 10;

  const minTime = sortedTimes[0];
  const maxTime = sortedTimes[sortedTimes.length - 1];
  const timeSpan = maxTime - minTime || 1;

  const xScale = (timestamp: number) => PAD.left + ((timestamp - minTime) / timeSpan) * plotW;
  const yScale = (ms: number) => PAD.top + plotH - (ms / maxLatency) * plotH;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // Y-axis gridlines and labels (3 ticks)
  const Y_TICKS = 2;
  for (let t = 0; t <= Y_TICKS; t++) {
    const msVal = Math.round((t / Y_TICKS) * maxLatency);
    const y = yScale(msVal);

    const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    gridLine.setAttribute('x1', String(PAD.left));
    gridLine.setAttribute('x2', String(PAD.left + plotW));
    gridLine.setAttribute('y1', String(y));
    gridLine.setAttribute('y2', String(y));
    gridLine.setAttribute('stroke', '#f3f4f6');
    gridLine.setAttribute('stroke-width', '1');
    svg.appendChild(gridLine);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(PAD.left - 4));
    label.setAttribute('y', String(y + 3));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('font-size', '9');
    label.setAttribute('fill', '#9ca3af');
    label.textContent = `${msVal}ms`;
    svg.appendChild(label);
  }

  // Instant tooltip element
  let tooltip = popupChartContainer.querySelector('.chart-tooltip') as HTMLDivElement;
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    popupChartContainer.appendChild(tooltip);
  }

  // One line + hover dots per host (instant custom tooltip)
  for (let hi = 0; hi < activeHosts.length; hi++) {
    const host = activeHosts[hi];
    const color = COLORS[hi % COLORS.length];
    const history = latencies[host]?.history ?? [];

    let points = '';
    for (let i = 0; i < history.length; i++) {
      const item = history[i];
      if (item.latency == null) continue;
      points += `${xScale(item.time)},${yScale(item.latency)} `;
    }
    points = points.trim();

    if (points) {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', points);
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', color);
      polyline.setAttribute('stroke-width', '1.5');
      polyline.setAttribute('stroke-linejoin', 'round');
      polyline.setAttribute('stroke-linecap', 'round');
      svg.appendChild(polyline);

      for (let i = 0; i < history.length; i++) {
        const item = history[i];
        if (item.latency == null) continue;

        const cx = xScale(item.time);
        const cy = yScale(item.latency);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '3.5');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '1');
        circle.style.cursor = 'pointer';

        const timeStr = new Date(item.time).toLocaleTimeString();
        const text = `${host}\nLatency: ${item.latency} ms\nTime: ${timeStr}`;

        circle.addEventListener('mouseenter', (e) => {
          tooltip.textContent = text;
          tooltip.classList.add('visible');
          const rect = popupChartContainer.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          tooltip.style.left = `${Math.min(x + 10, rect.width - 120)}px`;
          tooltip.style.top = `${Math.max(y - 45, 0)}px`;
        });

        circle.addEventListener('mouseleave', () => {
          tooltip.classList.remove('visible');
        });

        svg.appendChild(circle);
      }
    }
  }

  popupChartContainer.appendChild(svg);
}

// ── Render ────────────────────────────────────────────────────────────

/** Update all UI elements to reflect the current settings state. */
function render(settings: AppSettings): void {
  const mode = settings.mode || (settings.enabled ? 'by_rule' : 'off');
  const on = mode !== 'off';

  // Icon
  popupIcon.src = on ? '/icon_on.png' : '/icon_off.png';

  // Power button appearance
  btnToggle.classList.toggle('power-btn--on',  on);
  btnToggle.classList.toggle('power-btn--off', !on);
  btnToggle.setAttribute('aria-pressed', String(on));

  // Status text & link
  const statusRuleLink = document.getElementById('status-rule-link') as HTMLAnchorElement;

  if (mode === 'off') {
    toggleLabel.textContent = 'OFF';
    statusText.textContent = 'Proxy is disabled';
    if (statusRuleLink) statusRuleLink.style.display = 'none';
  } else if (mode === 'by_rule') {
    toggleLabel.textContent = 'BY RULE';
    statusText.textContent = 'Proxy active ';
    if (statusRuleLink) statusRuleLink.style.display = 'inline';
  } else {
    toggleLabel.textContent = 'GLOBAL';
    statusText.textContent = 'Proxy active';
    if (statusRuleLink) statusRuleLink.style.display = 'none';
  }

  renderGlobalTargetSelect(settings);

  // Render mini chart
  renderMiniLatencyChart();
}

// ── Event handlers ────────────────────────────────────────────────────

async function toggleProxy(): Promise<void> {
  if (!currentSettings) return;
  const currentMode = currentSettings.mode || (currentSettings.enabled ? 'by_rule' : 'off');
  let nextMode: AppSettings['mode'] = 'off';
  if (currentMode === 'off') nextMode = 'by_rule';
  else if (currentMode === 'by_rule') nextMode = 'global';
  else if (currentMode === 'global') nextMode = 'off';

  currentSettings = {
    ...currentSettings,
    mode: nextMode,
    enabled: nextMode !== 'off',
  };
  render(currentSettings);
  await saveSettings(currentSettings);
}

async function handleSelectGlobalProxyValue(val: string): Promise<void> {
  if (!currentSettings) return;
  if (val.startsWith('SPECIFIC:')) {
    const targetHost = val.substring('SPECIFIC:'.length);
    currentSettings = {
      ...currentSettings,
      globalProxyPolicy: 'SPECIFIC',
      globalProxyTarget: targetHost,
    };
  } else {
    currentSettings = {
      ...currentSettings,
      globalProxyPolicy: val as AppSettings['globalProxyPolicy'],
      globalProxyTarget: '',
    };
  }
  render(currentSettings);
  await saveSettings(currentSettings);
}

const extApi = typeof browser !== 'undefined' ? browser : chrome;

function openOptions(): void {
  extApi.tabs.create({ url: extApi.runtime.getURL('options.html') });
}

// ── Runtime messages ──────────────────────────────────────────────────

extApi.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    currentSettings = msg.settings as AppSettings;
    render(currentSettings);
  } else if (msg.type === 'LATENCIES_UPDATED') {
    latencies = msg.latencies as Record<string, HostLatency>;
    renderMiniLatencyChart();
  }
});

// ── Initialisation ────────────────────────────────────────────────────

async function init(): Promise<void> {
  [currentSettings, latencies] = await Promise.all([getSettings(), getLatencies()]);
  render(currentSettings);

  // Hide the loading overlay now that we have data
  loadingEl.classList.add('hidden');

  // Custom dropdown toggle
  popupDropdownTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = popupDropdownMenu.classList.contains('custom-dropdown__menu--open');
    popupDropdownMenu.classList.toggle('custom-dropdown__menu--open', !isOpen);
    popupDropdownTrigger.classList.toggle('custom-dropdown__trigger--open', !isOpen);
    popupDropdownTrigger.setAttribute('aria-expanded', String(!isOpen));
  });

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!popupCustomDropdown.contains(e.target as Node)) {
      popupDropdownMenu.classList.remove('custom-dropdown__menu--open');
      popupDropdownTrigger.classList.remove('custom-dropdown__trigger--open');
      popupDropdownTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  // Attach events
  btnToggle.addEventListener('click', toggleProxy);
  btnOptions.addEventListener('click', openOptions);

  const statusRuleLink = document.getElementById('status-rule-link');
  statusRuleLink?.addEventListener('click', (e) => {
    e.preventDefault();
    openOptions();
  });
}

init();
