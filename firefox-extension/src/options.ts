/**
 * options.ts — Controller for options.html
 *
 * Rules (unchanged from previous version):
 *  - All structural HTML already exists in options.html.
 *  - This file queries existing elements, reads from storage, and updates
 *    element properties / attributes / text content only.
 *  - Dynamic rows (proxy group cards, rule items, <option>s) are built with
 *    document.createElement — never innerHTML string interpolation.
 *  - The latency chart is drawn via SVG DOM APIs (createElementNS).
 *  - No JSX, no React, no 3rd-party runtime dependencies.
 */

import { getSettings, saveSettings, getLatencies, exportToYaml, importFromYaml } from './storage';
import type { AppSettings, HostLatency, ProxyGroup, RoutingRule } from './types';

// ── Element references — Proxy Mode ────────────────────────────────────

const radioModeOff       = document.getElementById('radio-mode-off')       as HTMLInputElement;
const radioModeByRule    = document.getElementById('radio-mode-by-rule')   as HTMLInputElement;
const radioModeGlobal    = document.getElementById('radio-mode-global')    as HTMLInputElement;
const selectGlobalProxy  = document.getElementById('select-global-proxy')  as HTMLSelectElement;
const globalPolicyContainer = document.getElementById('global-policy-container') as HTMLDivElement;

// ── Element references — Global Settings ──────────────────────────────

const inputUsername       = document.getElementById('input-username')        as HTMLInputElement;
const inputToken          = document.getElementById('input-token')           as HTMLInputElement;
const inputAuthBase       = document.getElementById('input-auth-base-path')    as HTMLInputElement;
const inputHealthInterval = document.getElementById('input-health-interval')   as HTMLInputElement;

const btnToggleTokenPw    = document.getElementById('btn-toggle-token-pw')   as HTMLButtonElement;
const btnToggleAuthPw     = document.getElementById('btn-toggle-auth-pw')    as HTMLButtonElement;

// ── Element references — Proxy Groups ────────────────────────────────

const proxyGroupList      = document.getElementById('proxy-group-list')      as HTMLDivElement;
const proxyGroupListEmpty = document.getElementById('proxy-group-list-empty') as HTMLParagraphElement;
const inputNewGroupName   = document.getElementById('input-new-group-name')  as HTMLInputElement;
const inputNewGroupHosts  = document.getElementById('input-new-group-hosts') as HTMLTextAreaElement;
const selectNewGroupPolicy = document.getElementById('select-new-group-policy') as HTMLSelectElement;
const btnAddProxyGroup    = document.getElementById('btn-add-proxy-group')   as HTMLButtonElement;
const addProxyPanel       = document.getElementById('add-proxy-panel')       as HTMLDetailsElement;

// ── Element references — Routing Rules ───────────────────────────────

const ruleList      = document.getElementById('rule-list')           as HTMLDivElement;
const ruleListEmpty = document.getElementById('rule-list-empty')     as HTMLParagraphElement;
const selectNewRuleProxy = document.getElementById('select-new-rule-proxy') as HTMLSelectElement;
const textareaNewRuleDomains = document.getElementById('textarea-new-rule-domains') as HTMLTextAreaElement;
const btnAddRule    = document.getElementById('btn-add-rule')        as HTMLButtonElement;
const addRulePanel  = document.getElementById('add-rule-panel')      as HTMLDetailsElement;

// ── Element references — Unmatched Policy ────────────────────────────

const selectUnmatchedProxy = document.getElementById('select-unmatched-proxy') as HTMLSelectElement;

// ── Element references — Import / Export ─────────────────────────────

const btnExport       = document.getElementById('btn-export')        as HTMLButtonElement;
const inputImportFile = document.getElementById('input-import-file') as HTMLInputElement;
const textareaYaml    = document.getElementById('textarea-yaml')     as HTMLTextAreaElement;
const btnImportText   = document.getElementById('btn-import-text')   as HTMLButtonElement;
const ioStatus        = document.getElementById('io-status')         as HTMLSpanElement;

// ── Element references — Latency ──────────────────────────────────────

const btnCheckNow      = document.getElementById('btn-check-now')           as HTMLButtonElement;
const chartContainer   = document.getElementById('latency-chart-container') as HTMLDivElement;
const latencyEmpty     = document.getElementById('latency-empty')           as HTMLParagraphElement;
const latencyLegend    = document.getElementById('latency-legend')          as HTMLDivElement;

// ── Element references — Misc ─────────────────────────────────────────

const loadingEl = document.getElementById('loading-overlay') as HTMLDivElement;

// ── State ─────────────────────────────────────────────────────────────

let currentSettings: AppSettings | null = null;
let latencies: Record<string, HostLatency> = {};

/** Chart line colours, one per host. */
const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0891b2', '#7c3aed'];

// ── Helpers ───────────────────────────────────────────────────────────

/** Persist a partial update and notify the background script. */
async function applySettings(updates: Partial<AppSettings>): Promise<void> {
  if (!currentSettings) return;
  currentSettings = { ...currentSettings, ...updates };
  await saveSettings(currentSettings);
}

/** Build a trash-can SVG element (no external icon library). */
function makeTrashIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  p.setAttribute('points', '3 6 5 6 21 6');
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6');
  const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l1.setAttribute('x1', '10'); l1.setAttribute('y1', '11');
  l1.setAttribute('x2', '10'); l1.setAttribute('y2', '17');
  const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l2.setAttribute('x1', '14'); l2.setAttribute('y1', '11');
  l2.setAttribute('x2', '14'); l2.setAttribute('y2', '17');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '8'); rect.setAttribute('y', '2');
  rect.setAttribute('width', '8'); rect.setAttribute('height', '4');
  rect.setAttribute('rx', '1');
  [p, path1, l1, l2, rect].forEach(el => svg.appendChild(el));
  return svg;
}

/** Build a drag-handle SVG (≡ lines). */
function makeDragIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  [[4,9],[4,15],[20,9],[20,15]].forEach(([x1,y]) => {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', '4'); l.setAttribute('x2', '20');
    l.setAttribute('y1', String(y)); l.setAttribute('y2', String(y));
    svg.appendChild(l);
  });
  return svg;
}

/** Show a transient status message in the I/O status indicator. */
function showStatus(msg: string, type: 'ok' | 'error'): void {
  ioStatus.textContent = msg;
  ioStatus.className = `io-status io-status--${type}`;
  // Auto-clear after 4 seconds
  setTimeout(() => { ioStatus.textContent = ''; ioStatus.className = 'io-status'; }, 4000);
}

// ── Render: proxy-name selects ────────────────────────────────────────

/**
 * Populate a <select> with proxy group options (preceded by DIRECT).
 * `currentValue` is set as the selected value after populating.
 */
function populateProxySelect(
  sel: HTMLSelectElement,
  currentValue: string,
  includeGroupData = false
): void {
  // Remove all proxy-group options
  const existing = sel.querySelectorAll<HTMLOptionElement>('option[data-group]');
  existing.forEach(o => o.remove());

  // Ensure DIRECT option exists
  let directOpt = sel.querySelector<HTMLOptionElement>('option[value="DIRECT"]');
  if (!directOpt) {
    directOpt = document.createElement('option');
    directOpt.value = 'DIRECT';
    directOpt.textContent = 'DIRECT (bypass proxy)';
    sel.insertBefore(directOpt, sel.firstChild);
  }

  if (!currentSettings) return;

  for (const g of currentSettings.proxies) {
    const opt = document.createElement('option');
    opt.value = g.name; // name is the stable identifier for rules/unmatched
    opt.textContent = g.name;
    if (includeGroupData) opt.dataset['group'] = 'true';
    else opt.dataset['group'] = 'true';
    sel.appendChild(opt);
  }

  sel.value = currentValue;
}

// ── Render: proxy group list ──────────────────────────────────────────

function renderProxyGroups(): void {
  if (!currentSettings) return;

  // Remove existing group cards
  proxyGroupList.querySelectorAll<HTMLDivElement>('.group-card').forEach(el => el.remove());

  const groups = currentSettings.proxies;
  proxyGroupListEmpty.hidden = groups.length > 0;

  for (const group of groups) {
    const card = buildGroupCard(group);
    proxyGroupList.appendChild(card);
  }
}

function buildGroupCard(group: ProxyGroup): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'group-card';
  card.dataset['groupId'] = group.id;

  // ── Header row: name + policy badge + remove button ────────────────
  const header = document.createElement('div');
  header.className = 'group-card__header';

  const nameEl = document.createElement('span');
  nameEl.className = 'group-card__name';
  nameEl.textContent = group.name;

  const policyBadge = document.createElement('span');
  policyBadge.className = 'group-card__policy';
  policyBadge.textContent = group.selectPolicy;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn--danger';
  removeBtn.title = `Remove group "${group.name}"`;
  removeBtn.setAttribute('aria-label', `Remove proxy group ${group.name}`);
  removeBtn.appendChild(makeTrashIcon());
  removeBtn.addEventListener('click', () => handleRemoveGroup(group.id));

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;';
  headerLeft.appendChild(nameEl);
  headerLeft.appendChild(policyBadge);

  header.appendChild(headerLeft);
  header.appendChild(removeBtn);
  card.appendChild(header);

  // ── Host list ────────────────────────────────────────────────────
  const hostList = document.createElement('div');
  hostList.className = 'group-card__hosts';

  for (const host of group.hosts) {
    hostList.appendChild(buildHostRow(group.id, host));
  }

  card.appendChild(hostList);

  // ── Add host row ────────────────────────────────────────────────
  const addRow = document.createElement('div');
  addRow.className = 'group-card__add-host';

  const hostInput = document.createElement('input');
  hostInput.type = 'text';
  hostInput.placeholder = 'proxy.example.com:443';
  hostInput.setAttribute('aria-label', `Add host to ${group.name}`);

  const addHostBtn = document.createElement('button');
  addHostBtn.className = 'btn btn--primary';
  addHostBtn.textContent = '+ Add Host';
  addHostBtn.style.fontSize = '12px';
  addHostBtn.style.padding = '5px 10px';

  const doAdd = async () => {
    const h = hostInput.value.trim();
    if (!h || !currentSettings) return;
    const updatedProxies = currentSettings.proxies.map(g =>
      g.id === group.id ? { ...g, hosts: [...g.hosts, h] } : g
    );
    await applySettings({ proxies: updatedProxies });
    hostInput.value = '';
    renderProxyGroups();
    renderLatencyChart(); // host list changed
  };

  addHostBtn.addEventListener('click', doAdd);
  hostInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') doAdd(); });

  addRow.appendChild(hostInput);
  addRow.appendChild(addHostBtn);
  card.appendChild(addRow);

  return card;
}

function buildHostRow(groupId: string, host: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'group-card__host';

  const hostText = document.createElement('span');
  hostText.textContent = host;

  // Latency badge
  const latBadge = document.createElement('span');
  latBadge.className = 'host-latency';
  const latData = latencies[host];
  if (latData && latData.history.length > 0) {
    const last = latData.history[latData.history.length - 1];
    if (last.latency === null) {
      latBadge.textContent = 'down';
      latBadge.classList.add('host-latency--down');
    } else {
      latBadge.textContent = `${last.latency}ms`;
      latBadge.classList.add(last.latency < 300 ? 'host-latency--ok' : 'host-latency--slow');
    }
  }

  // Remove host button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn--danger';
  removeBtn.title = `Remove host ${host}`;
  removeBtn.setAttribute('aria-label', `Remove host ${host}`);
  removeBtn.style.padding = '2px 4px';
  removeBtn.appendChild(makeTrashIcon());
  removeBtn.addEventListener('click', async () => {
    if (!currentSettings) return;
    const updatedProxies = currentSettings.proxies.map(g =>
      g.id === groupId ? { ...g, hosts: g.hosts.filter(h => h !== host) } : g
    );
    await applySettings({ proxies: updatedProxies });
    renderProxyGroups();
    renderLatencyChart();
  });

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;align-items:center;gap:8px;';
  right.appendChild(latBadge);
  right.appendChild(removeBtn);

  row.appendChild(hostText);
  row.appendChild(right);
  return row;
}

// ── Render: routing rules ─────────────────────────────────────────────

function renderRules(): void {
  if (!currentSettings) return;

  ruleList.querySelectorAll<HTMLDivElement>('.rule-item').forEach(el => el.remove());

  const rules = currentSettings.rules;
  ruleListEmpty.hidden = rules.length > 0;

  rules.forEach((rule, idx) => {
    const item = buildRuleItem(rule, idx);
    ruleList.appendChild(item);
  });
}

function buildRuleItem(rule: RoutingRule, idx: number): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'rule-item';
  item.draggable = true;
  item.dataset['ruleId'] = rule.id;
  item.dataset['ruleIdx'] = String(idx);

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'rule-item__drag-handle';
  handle.title = 'Drag to reorder';
  handle.appendChild(makeDragIcon());
  item.appendChild(handle);

  // Body
  const body = document.createElement('div');
  body.className = 'rule-item__body';

  // Proxy badge
  const badge = document.createElement('span');
  badge.className = rule.proxyName === 'DIRECT'
    ? 'rule-item__proxy-badge rule-item__proxy-badge--direct'
    : 'rule-item__proxy-badge rule-item__proxy-badge--proxy';
  badge.textContent = rule.proxyName;
  body.appendChild(badge);

  // Domains
  const domainsEl = document.createElement('div');
  domainsEl.className = 'rule-item__domains';
  for (const d of rule.domains) {
    const tag = document.createElement('span');
    tag.className = 'rule-item__domain-tag';
    tag.textContent = d;
    domainsEl.appendChild(tag);
  }
  body.appendChild(domainsEl);
  item.appendChild(body);

  // Edit form container (hidden by default)
  const editForm = document.createElement('div');
  editForm.className = 'rule-item__edit-form';
  editForm.style.display = 'none';

  const editProxySelect = document.createElement('select');
  populateProxySelect(editProxySelect, rule.proxyName, true);

  const editDomainsTextarea = document.createElement('textarea');
  editDomainsTextarea.className = 'monospace';
  editDomainsTextarea.rows = 4;
  editDomainsTextarea.value = rule.domains.join('\n');

  const editBtnRow = document.createElement('div');
  editBtnRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;';

  const saveEditBtn = document.createElement('button');
  saveEditBtn.className = 'btn btn--primary';
  saveEditBtn.textContent = 'Save';
  saveEditBtn.style.fontSize = '12px';
  saveEditBtn.style.padding = '4px 10px';

  const cancelEditBtn = document.createElement('button');
  cancelEditBtn.className = 'btn btn--secondary';
  cancelEditBtn.textContent = 'Cancel';
  cancelEditBtn.style.fontSize = '12px';
  cancelEditBtn.style.padding = '4px 10px';

  editBtnRow.appendChild(saveEditBtn);
  editBtnRow.appendChild(cancelEditBtn);

  editForm.appendChild(editProxySelect);
  editForm.appendChild(editDomainsTextarea);
  editForm.appendChild(editBtnRow);

  body.appendChild(editForm);

  // Actions: edit & remove buttons
  const actions = document.createElement('div');
  actions.className = 'rule-item__actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn--secondary';
  editBtn.title = 'Edit rule';
  editBtn.style.padding = '4px 8px';
  editBtn.style.fontSize = '12px';
  editBtn.textContent = 'Edit';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn--danger';
  removeBtn.title = 'Remove rule';
  removeBtn.appendChild(makeTrashIcon());
  removeBtn.addEventListener('click', async () => {
    if (!currentSettings) return;
    const rules = currentSettings.rules.filter(r => r.id !== rule.id);
    await applySettings({ rules });
    renderRules();
  });

  editBtn.addEventListener('click', () => {
    const isEditing = editForm.style.display !== 'none';
    if (isEditing) {
      editForm.style.display = 'none';
      badge.style.display = '';
      domainsEl.style.display = '';
    } else {
      editForm.style.display = 'flex';
      editForm.style.flexDirection = 'column';
      editForm.style.gap = '6px';
      editForm.style.marginTop = '6px';
      badge.style.display = 'none';
      domainsEl.style.display = 'none';
    }
  });

  cancelEditBtn.addEventListener('click', () => {
    editForm.style.display = 'none';
    badge.style.display = '';
    domainsEl.style.display = '';
  });

  saveEditBtn.addEventListener('click', async () => {
    if (!currentSettings) return;
    const updatedProxy = editProxySelect.value;
    const updatedDomains = editDomainsTextarea.value
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    const updatedRules = currentSettings.rules.map(r =>
      r.id === rule.id ? { ...r, proxyName: updatedProxy, domains: updatedDomains } : r
    );

    await applySettings({ rules: updatedRules });
    renderRules();
  });

  actions.appendChild(editBtn);
  actions.appendChild(removeBtn);
  item.appendChild(actions);

  // ── Drag-and-drop reordering ───────────────────────────────────────
  item.addEventListener('dragstart', (e: DragEvent) => {
    e.dataTransfer?.setData('text/plain', rule.id);
    item.classList.add('rule-item--dragging');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('rule-item--dragging');
    ruleList.querySelectorAll('.rule-item--drag-over').forEach(el => el.classList.remove('rule-item--drag-over'));
  });
  item.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    item.classList.add('rule-item--drag-over');
  });
  item.addEventListener('dragleave', () => {
    item.classList.remove('rule-item--drag-over');
  });
  item.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    item.classList.remove('rule-item--drag-over');
    if (!currentSettings) return;
    const draggedId = e.dataTransfer?.getData('text/plain');
    if (!draggedId || draggedId === rule.id) return;

    const rules = [...currentSettings.rules];
    const fromIdx = rules.findIndex(r => r.id === draggedId);
    const toIdx   = rules.findIndex(r => r.id === rule.id);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = rules.splice(fromIdx, 1);
    rules.splice(toIdx, 0, moved);

    await applySettings({ rules });
    renderRules();
  });

  return item;
}

// ── Render: unmatched policy ──────────────────────────────────────────

function renderUnmatchedPolicy(): void {
  if (!currentSettings) return;
  const up = currentSettings.unmatchedPolicy;

  populateProxySelect(selectUnmatchedProxy, up.proxyName, true);
}

// ── Render: proxy selects in add-rule panel ───────────────────────────

function renderAddRuleProxyOptions(): void {
  if (!currentSettings) return;
  populateProxySelect(selectNewRuleProxy, selectNewRuleProxy.value || 'DIRECT', true);
}

// ── Render: latency chart ─────────────────────────────────────────────

function renderLatencyChart(): void {
  if (!currentSettings) return;

  // Remove any previously drawn SVG
  chartContainer.querySelector('svg')?.remove();

  // Clear legend
  while (latencyLegend.firstChild) latencyLegend.removeChild(latencyLegend.firstChild);

  // Collect all unique hosts across all proxy groups
  const allHosts: string[] = [];
  for (const g of currentSettings.proxies) {
    for (const h of g.hosts) {
      if (!allHosts.includes(h)) allHosts.push(h);
    }
  }

  // Collect and sort all timestamps across tracked hosts
  const allTimestamps = new Set<number>();
  for (const host of allHosts) {
    latencies[host]?.history.forEach(h => allTimestamps.add(h.time));
  }
  const sortedTimes = Array.from(allTimestamps).sort((a, b) => a - b);

  const activeHosts = allHosts.filter(h => latencies[h]?.history.length > 0);

  if (sortedTimes.length === 0 || activeHosts.length === 0) {
    latencyEmpty.hidden = false;
    return;
  }
  latencyEmpty.hidden = true;

  // ── Chart geometry ────────────────────────────────────────────────
  const W = 820, H = 220;
  const PAD = { top: 10, right: 20, bottom: 40, left: 60 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top  - PAD.bottom;

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
  svg.setAttribute('aria-hidden', 'true');

  // Grid + Y-axis labels
  const Y_TICKS = 5;
  for (let t = 0; t <= Y_TICKS; t++) {
    const y = yScale((t / Y_TICKS) * maxLatency);

    const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    gridLine.setAttribute('x1', String(PAD.left)); gridLine.setAttribute('x2', String(PAD.left + plotW));
    gridLine.setAttribute('y1', String(y)); gridLine.setAttribute('y2', String(y));
    gridLine.setAttribute('stroke', '#e5e7eb'); gridLine.setAttribute('stroke-width', '1');
    svg.appendChild(gridLine);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(PAD.left - 6)); label.setAttribute('y', String(y + 4));
    label.setAttribute('text-anchor', 'end'); label.setAttribute('font-size', '11');
    label.setAttribute('fill', '#9ca3af');
    label.textContent = `${Math.round((t / Y_TICKS) * maxLatency)}ms`;
    svg.appendChild(label);
  }

  // X-axis linear time ticks (5 ticks)
  const X_TICKS = 5;
  for (let i = 0; i <= X_TICKS; i++) {
    const tVal = minTime + (i / X_TICKS) * timeSpan;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(xScale(tVal)));
    label.setAttribute('y', String(PAD.top + plotH + 18));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', '#9ca3af');
    label.textContent = new Date(tVal).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    svg.appendChild(label);
  }

  // Instant custom tooltip container
  let tooltip = chartContainer.querySelector('.chart-tooltip') as HTMLDivElement;
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    chartContainer.appendChild(tooltip);
  }

  // One polyline + dots per host
  for (let hi = 0; hi < activeHosts.length; hi++) {
    const host  = activeHosts[hi];
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
      polyline.setAttribute('stroke-width', '2');
      polyline.setAttribute('stroke-linejoin', 'round');
      polyline.setAttribute('stroke-linecap', 'round');
      svg.appendChild(polyline);

      for (let i = 0; i < history.length; i++) {
        const item = history[i];
        if (item.latency == null) continue;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(xScale(item.time)));
        circle.setAttribute('cy', String(yScale(item.latency)));
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        circle.style.cursor = 'pointer';

        const timeStr = new Date(item.time).toLocaleTimeString();
        const text = `${host}\nLatency: ${item.latency} ms\nTime: ${timeStr}`;

        circle.addEventListener('mouseenter', (e) => {
          tooltip.textContent = text;
          tooltip.classList.add('visible');
          const rect = chartContainer.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          tooltip.style.left = `${Math.min(x + 12, rect.width - 140)}px`;
          tooltip.style.top = `${Math.max(y - 50, 0)}px`;
        });

        circle.addEventListener('mouseleave', () => {
          tooltip.classList.remove('visible');
        });

        svg.appendChild(circle);
      }
    }

    // Legend entry
    const li = document.createElement('div');
    li.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = color;
    const label = document.createElement('span');
    label.textContent = host;
    li.appendChild(dot);
    li.appendChild(label);
    latencyLegend.appendChild(li);
  }

  chartContainer.appendChild(svg);
}

// ── Render: proxy mode ────────────────────────────────────────────────

function renderProxyMode(): void {
  if (!currentSettings) return;
  const mode = currentSettings.mode || (currentSettings.enabled ? 'by_rule' : 'off');

  radioModeOff.checked    = mode === 'off';
  radioModeByRule.checked = mode === 'by_rule';
  radioModeGlobal.checked = mode === 'global';

  // Populate global mode proxy selection dropdown
  // 1. Static policy options
  selectGlobalProxy.innerHTML = '';
  
  const optLatency = document.createElement('option');
  optLatency.value = 'LATENCY';
  optLatency.textContent = 'latency (lowest latency server)';

  const optSimilar = document.createElement('option');
  optSimilar.value = 'RANDOM_ON_SIMILAR_LOWEST_LATENCY';
  optSimilar.textContent = 'latency similar (RANDOM_ON_SIMILAR_LOWEST_LATENCY)';

  const optRandom = document.createElement('option');
  optRandom.value = 'RANDOM';
  optRandom.textContent = 'random (random selection)';

  selectGlobalProxy.appendChild(optLatency);
  selectGlobalProxy.appendChild(optSimilar);
  selectGlobalProxy.appendChild(optRandom);

  // 2. Distinct server options
  const allHosts: string[] = [];
  for (const g of currentSettings.proxies) {
    for (const h of g.hosts) {
      if (h && !allHosts.includes(h)) allHosts.push(h);
    }
  }

  if (allHosts.length > 0) {
    const optGroup = document.createElement('optgroup');
    optGroup.label = 'Specific Servers';
    for (const host of allHosts) {
      const opt = document.createElement('option');
      opt.value = `SPECIFIC:${host}`;
      opt.textContent = `server: ${host}`;
      optGroup.appendChild(opt);
    }
    selectGlobalProxy.appendChild(optGroup);
  }

  // Set current selected value
  if (currentSettings.globalProxyPolicy === 'SPECIFIC' && currentSettings.globalProxyTarget) {
    selectGlobalProxy.value = `SPECIFIC:${currentSettings.globalProxyTarget}`;
  } else {
    selectGlobalProxy.value = currentSettings.globalProxyPolicy || 'LATENCY';
  }

  // Show/hide global policy container based on mode
  globalPolicyContainer.style.display = mode === 'global' ? 'block' : 'none';
}

// ── Full render ───────────────────────────────────────────────────────

function renderAll(): void {
  if (!currentSettings) return;

  // Proxy mode
  renderProxyMode();

  // Global settings
  inputUsername.value       = currentSettings.username;
  inputToken.value          = currentSettings.token;
  inputAuthBase.value       = currentSettings.authBasePath;
  inputHealthInterval.value = String(currentSettings.healthCheckIntervalMinutes || 1);

  // Proxy groups
  renderProxyGroups();

  // Rules (and the "add rule" proxy select)
  renderRules();
  renderAddRuleProxyOptions();

  // Unmatched policy
  renderUnmatchedPolicy();

  // Latency chart
  renderLatencyChart();
}

// ── Event handlers — Global Settings ─────────────────────────────────

function handleUsernameChange():       void { applySettings({ username: inputUsername.value }); }
function handleTokenChange():          void { applySettings({ token: inputToken.value }); }
function handleAuthBaseChange():       void { applySettings({ authBasePath: inputAuthBase.value }); }
function handleHealthIntervalChange(): void {
  const val = parseInt(inputHealthInterval.value, 10);
  if (!isNaN(val) && val >= 1) {
    applySettings({ healthCheckIntervalMinutes: val });
  }
}

// ── Event handlers — Proxy Groups ─────────────────────────────────────

async function handleAddProxyGroup(): Promise<void> {
  if (!currentSettings) return;
  const name = inputNewGroupName.value.trim();
  const hosts = inputNewGroupHosts.value
    .split('\n').map(h => h.trim()).filter(h => h.length > 0);
  const selectPolicy = selectNewGroupPolicy.value as ProxyGroup['selectPolicy'];

  if (!name) return;

  const newGroup: ProxyGroup = {
    id: crypto.randomUUID(),
    name,
    hosts,
    selectPolicy,
  };
  await applySettings({ proxies: [...currentSettings.proxies, newGroup] });

  inputNewGroupName.value = '';
  inputNewGroupHosts.value = '';
  addProxyPanel.open = false;

  renderProxyGroups();
  renderRules(); // update proxy name options in rule list
  renderAddRuleProxyOptions();
  populateProxySelect(selectUnmatchedProxy, currentSettings.unmatchedPolicy.proxyName, true);
}

async function handleRemoveGroup(id: string): Promise<void> {
  if (!currentSettings) return;
  const removedName = currentSettings.proxies.find(g => g.id === id)?.name ?? '';
  const proxies = currentSettings.proxies.filter(g => g.id !== id);
  // Fix any rules that referenced this group
  const rules = currentSettings.rules.map(r =>
    r.proxyName === removedName ? { ...r, proxyName: 'DIRECT' } : r
  );
  // Fix unmatched policy if it referenced this group
  const unmatchedPolicy = currentSettings.unmatchedPolicy.proxyName === removedName
    ? { ...currentSettings.unmatchedPolicy, proxyName: 'DIRECT' }
    : currentSettings.unmatchedPolicy;

  await applySettings({ proxies, rules, unmatchedPolicy });
  renderProxyGroups();
  renderRules();
  renderAddRuleProxyOptions();
  renderUnmatchedPolicy();
}

// ── Event handlers — Routing Rules ────────────────────────────────────

async function handleAddRule(): Promise<void> {
  if (!currentSettings) return;
  const proxyName = selectNewRuleProxy.value;
  const domains = textareaNewRuleDomains.value
    .split('\n').map(d => d.trim()).filter(d => d.length > 0);

  if (domains.length === 0) return;

  const newRule: RoutingRule = {
    id: crypto.randomUUID(),
    proxyName,
    domains,
  };
  await applySettings({ rules: [...currentSettings.rules, newRule] });
  textareaNewRuleDomains.value = '';
  addRulePanel.open = false;
  renderRules();
}

// ── Event handlers — Unmatched Policy ────────────────────────────────

function handleUnmatchedProxyChange(): void {
  const proxyName = selectUnmatchedProxy.value;
  applySettings({
    unmatchedPolicy: {
      ...currentSettings!.unmatchedPolicy,
      proxyName,
    },
  });
}



// ── Event handlers — Import / Export ─────────────────────────────────

function handleExport(): void {
  if (!currentSettings) return;
  const yaml = exportToYaml(currentSettings);
  textareaYaml.value = yaml;

  // Also trigger a file download
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'config.yaml';
  a.click();
  URL.revokeObjectURL(url);
  showStatus('Exported successfully', 'ok');
}

async function handleImportText(): Promise<void> {
  if (!currentSettings) return;
  const yaml = textareaYaml.value.trim();
  if (!yaml) { showStatus('Nothing to import', 'error'); return; }
  try {
    const imported = importFromYaml(yaml, currentSettings);
    currentSettings = imported;
    await saveSettings(imported);
    renderAll();
    showStatus('Imported successfully', 'ok');
  } catch (err) {
    showStatus(`Import error: ${(err as Error).message}`, 'error');
  }
}

function handleImportFile(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const text = ev.target?.result as string;
    textareaYaml.value = text;
    await handleImportText();
  };
  reader.readAsText(file);
  // Reset so the same file can be re-selected
  (e.target as HTMLInputElement).value = '';
}

// ── Event handlers — Proxy Mode ───────────────────────────────────────

async function handleModeChange(newMode: 'off' | 'by_rule' | 'global'): Promise<void> {
  if (!currentSettings) return;
  await applySettings({
    mode: newMode,
    enabled: newMode !== 'off',
  });
  renderProxyMode();
}

async function handleGlobalProxyChange(): Promise<void> {
  if (!currentSettings) return;
  const val = selectGlobalProxy.value;
  if (val.startsWith('SPECIFIC:')) {
    const targetHost = val.substring('SPECIFIC:'.length);
    await applySettings({
      globalProxyPolicy: 'SPECIFIC',
      globalProxyTarget: targetHost,
    });
  } else {
    await applySettings({
      globalProxyPolicy: val as AppSettings['globalProxyPolicy'],
      globalProxyTarget: '',
    });
  }
}

// ── Event handlers — Latency ──────────────────────────────────────────

const extApi: any = typeof browser !== 'undefined' ? browser : chrome;

function handleCheckNow(): void {
  extApi.runtime.sendMessage({ type: 'TRIGGER_HEALTH_CHECK' }).catch(() => {});
}

// ── Runtime messages ──────────────────────────────────────────────────

extApi.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    currentSettings = msg.settings as AppSettings;
    renderAll();
  } else if (msg.type === 'LATENCIES_UPDATED') {
    latencies = msg.latencies as Record<string, HostLatency>;
    // Refresh host rows (latency badges) and chart
    renderProxyGroups();
    renderProxyMode();
    renderLatencyChart();
  }
});

// ── Initialisation ────────────────────────────────────────────────────

async function init(): Promise<void> {
  [currentSettings, latencies] = await Promise.all([getSettings(), getLatencies()]);

  renderAll();
  loadingEl.classList.add('hidden');

  // Proxy mode
  radioModeOff.addEventListener('change', () => handleModeChange('off'));
  radioModeByRule.addEventListener('change', () => handleModeChange('by_rule'));
  radioModeGlobal.addEventListener('change', () => handleModeChange('global'));
  selectGlobalProxy.addEventListener('change', handleGlobalProxyChange);

  // Global settings — save on 'change' (fires on blur for text inputs)
  inputUsername.addEventListener('change', handleUsernameChange);
  inputToken.addEventListener('change', handleTokenChange);
  inputAuthBase.addEventListener('change', handleAuthBaseChange);
  inputHealthInterval.addEventListener('change', handleHealthIntervalChange);

  // Password visibility toggles
  const togglePasswordVisibility = (input: HTMLInputElement, btn: HTMLButtonElement) => {
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    btn.title = isPw ? 'Hide password' : 'Show password';
  };
  btnToggleTokenPw?.addEventListener('click', () => togglePasswordVisibility(inputToken, btnToggleTokenPw));
  btnToggleAuthPw?.addEventListener('click', () => togglePasswordVisibility(inputAuthBase, btnToggleAuthPw));

  // Proxy groups
  btnAddProxyGroup.addEventListener('click', handleAddProxyGroup);

  // Routing rules
  btnAddRule.addEventListener('click', handleAddRule);

  // Unmatched policy
  selectUnmatchedProxy.addEventListener('change', handleUnmatchedProxyChange);

  // Import / Export
  btnExport.addEventListener('click', handleExport);
  btnImportText.addEventListener('click', handleImportText);
  inputImportFile.addEventListener('change', handleImportFile);

  // Latency
  btnCheckNow.addEventListener('click', handleCheckNow);
}

init();
