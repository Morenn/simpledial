import { t } from "../i18n.js";
import { isAllowedThemeUrl } from "../color-utils.js";
import { createCustomWidgetIconElement } from "./shared.js";

export function isValidRestEndpointUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isAllowedThemeUrl(trimmed);
  } catch {
    return false;
  }
}

export function normalizeRestRefreshSeconds(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 60;
  return Math.min(3600, Math.max(10, Math.round(num)));
}

/**
 * Safely extract a value from a parsed JSON object using dot/bracket notation
 * (e.g. "status", "data.active_queries", "services[0].state", "metrics['cpu.load']").
 */
export function extractJsonPath(data, rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) return undefined;
  const path = rawPath.trim();
  const tokens = [];
  const tokenRegex = /[^.[\]]+|\[(?:'([^']*)'|"([^"]*)"|([^\]]+))\]/g;
  let match;
  while ((match = tokenRegex.exec(path)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? match[0];
    if (token !== "") tokens.push(token);
  }
  if (tokens.length === 0) return undefined;

  let cur = data;
  for (const key of tokens) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return undefined;
    }
    if (Array.isArray(cur) && key === "length") {
      cur = cur.length;
      continue;
    }
    if (!(key in cur)) {
      return undefined;
    }
    cur = cur[key];
  }
  return cur;
}

/**
 * Evaluate a comma-separated declarative match rule against a value.
 * Supports numeric comparisons (>=, <=, >, <, !=, =), substring match (~text),
 * and case-insensitive exact string match.
 */
export function evaluateRestStatusRule(value, rawRule) {
  if (typeof rawRule !== "string" || !rawRule.trim()) return false;
  if (value === undefined || value === null) return false;
  const numVal = typeof value === "number" ? value : Number(String(value).trim());
  const hasNum = String(value).trim() !== "" && Number.isFinite(numVal);
  const strVal = String(value).trim().toLowerCase();

  const parts = rawRule.split(",").map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith("~")) {
      const needle = part.slice(1).trim().toLowerCase();
      if (needle && strVal.includes(needle)) return true;
      continue;
    }
    const opMatch = part.match(/^(>=|<=|!=|>|<|=)\s*(.+)$/);
    if (opMatch) {
      const op = opMatch[1];
      const targetStr = opMatch[2].trim();
      const targetNum = Number(targetStr);
      if (hasNum && Number.isFinite(targetNum)) {
        if (op === ">=" && numVal >= targetNum) return true;
        if (op === "<=" && numVal <= targetNum) return true;
        if (op === ">" && numVal > targetNum) return true;
        if (op === "<" && numVal < targetNum) return true;
        if (op === "=" && numVal === targetNum) return true;
        if (op === "!=" && numVal !== targetNum) return true;
        continue;
      }
      if (op === "=" && strVal === targetStr.toLowerCase()) return true;
      if (op === "!=" && strVal !== targetStr.toLowerCase()) return true;
      continue;
    }
    if (strVal === part.toLowerCase()) return true;
  }
  return false;
}

function isNumericStatusRule(rawRule) {
  if (typeof rawRule !== "string" || !rawRule.trim()) return false;
  const parts = rawRule.split(",").map(p => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => /^(>=|<=|!=|>|<|=)?\s*-?\d+(\.\d+)?$/.test(p));
}

export function mapRestDisplayValue(rawValue, rawMap) {
  if (rawValue === undefined || rawValue === null) return "";
  const strVal = String(rawValue);
  if (typeof rawMap !== "string" || !rawMap.trim()) return strVal;
  const lookup = strVal.trim().toLowerCase();
  const pairs = rawMap.split(",").map(p => p.trim()).filter(Boolean);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const fromKey = pair.slice(0, eqIdx).trim().toLowerCase();
    const toVal = pair.slice(eqIdx + 1).trim();
    if (fromKey && lookup === fromKey) {
      return toVal;
    }
  }
  return strVal;
}

export function evaluateRestResponse({ ok, status, data, error, latencyMs }, widget) {
  if (error || !ok) {
    const codeText = status ? `HTTP ${status}` : "ERR";
    return {
      state: "err",
      text: codeText,
      detail: error ? String(error) : codeText
    };
  }

  const hasPath = typeof widget?.jsonPath === "string" && widget.jsonPath.trim() !== "";
  const extracted = hasPath ? extractJsonPath(data, widget.jsonPath) : undefined;

  if (hasPath && (extracted === undefined || extracted === null)) {
    return {
      state: "warn",
      text: "N/A",
      detail: `HTTP ${status} (missing path: ${widget.jsonPath})`
    };
  }

  const hasTextBody = !hasPath && typeof data === "string" && data.length > 0;
  const warnTarget = hasPath
    ? extracted
    : (hasTextBody && !isNumericStatusRule(widget?.warnMatch) ? data : status);
  const okTarget = hasPath
    ? extracted
    : (hasTextBody && !isNumericStatusRule(widget?.okMatch) ? data : status);

  let state = "ok";
  if (widget?.warnMatch && evaluateRestStatusRule(warnTarget, widget.warnMatch)) {
    state = "warn";
  } else if (widget?.okMatch) {
    state = evaluateRestStatusRule(okTarget, widget.okMatch) ? "ok" : "err";
  }

  let text;
  if (hasPath) {
    const suffix = typeof widget.valueSuffix === "string" ? widget.valueSuffix : "";
    const mapped = mapRestDisplayValue(extracted, widget?.valueMap);
    text = `${mapped}${suffix}`;
  } else if (hasTextBody && data.length <= 32 && !data.includes("<") && !data.includes("\n")) {
    const suffix = typeof widget?.valueSuffix === "string" ? widget.valueSuffix : "";
    text = `${data}${suffix}`;
  } else {
    text = Number.isFinite(latencyMs) ? `${Math.round(latencyMs)}ms` : `HTTP ${status}`;
  }

  const detail = `HTTP ${status}${Number.isFinite(latencyMs) ? ` · ${Math.round(latencyMs)} ms` : ""}`;
  return { state, text, detail };
}

const customRestStatusElementCache = new Map();
const customRestStatusGroupCache = new Map();
const customRestStatusResultCache = new Map();
let activeRestStatusGroups = [];
let restStatusPollingIntervalId = null;

export function groupRestStatusWidgets(customWidgets = []) {
  const validList = Array.isArray(customWidgets)
    ? customWidgets.filter(w => w && w.id && w.type === "rest-status" && isValidRestEndpointUrl(w.endpointUrl))
    : [];

  const groups = [];
  const byGroupKey = new Map();

  for (const w of validList) {
    const groupName = typeof w.groupName === "string" ? w.groupName.trim() : "";
    if (!groupName) {
      groups.push({ groupName: "", members: [w], representative: w });
      continue;
    }
    const key = groupName.toLowerCase();
    let entry = byGroupKey.get(key);
    if (!entry) {
      entry = { groupName, members: [], representative: w };
      byGroupKey.set(key, entry);
      groups.push(entry);
    }
    entry.members.push(w);
  }

  return groups;
}

function getOriginPermissionPattern(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

async function hasHostPermissionForUrl(rawUrl) {
  const pattern = getOriginPermissionPattern(rawUrl);
  if (!pattern) return false;
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) return true;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return true;
  }
}

export async function requestRestEndpointPermission(rawUrl) {
  const pattern = getOriginPermissionPattern(rawUrl);
  if (!pattern) return false;
  if (typeof chrome === "undefined" || !chrome.permissions?.request) return true;
  try {
    if (await hasHostPermissionForUrl(rawUrl)) return true;
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

const REST_REQUEST_TIMEOUT_MS = 8000;

export async function fetchAndEvaluateRestWidget(widget) {
  if (!widget || !isValidRestEndpointUrl(widget.endpointUrl)) {
    return { state: "err", text: "ERR", detail: "Invalid endpoint URL" };
  }
  const method = widget.method === "HEAD" ? "HEAD" : "GET";
  const headers = {};
  if (widget.authHeaderName && widget.authHeaderValue) {
    headers[widget.authHeaderName] = widget.authHeaderValue;
  }
  const start = Date.now();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), REST_REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetch(widget.endpointUrl, {
      method,
      headers,
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {})
    });
    const latencyMs = Date.now() - start;
    let data = null;
    if (method === "GET" && res.ok) {
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text.trim();
        }
      }
    }
    return evaluateRestResponse({ ok: res.ok, status: res.status, data, latencyMs }, widget);
  } catch (err) {
    if (err?.name === "AbortError") {
      return { state: "err", text: "TIMEOUT", detail: `Timed out after ${REST_REQUEST_TIMEOUT_MS / 1000}s` };
    }
    return evaluateRestResponse({ ok: false, status: 0, error: err?.message || "Network error" }, widget);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function applyRestStatusToElement(el, widget, result) {
  if (!el || !result) return;
  const dot = el.querySelector(".rest-status-dot");
  const valueEl = el.querySelector(".rest-status-value");
  if (dot) {
    dot.className = `rest-status-dot ${result.state || "loading"}`;
  }
  if (valueEl) {
    valueEl.textContent = result.text || "...";
  }
  el.title = `${widget.name}${result.detail ? ` — ${result.detail}` : ""}`;
}

export async function pollRestStatusWidget(widget, { force = false } = {}) {
  if (!widget?.id || !isValidRestEndpointUrl(widget.endpointUrl)) return null;
  const el = customRestStatusElementCache.get(widget.id);
  const cached = customRestStatusResultCache.get(widget.id);
  const refreshMs = normalizeRestRefreshSeconds(widget.refreshSeconds) * 1000;
  if (!force && cached && (Date.now() - cached.timestamp) < refreshMs) {
    if (el) applyRestStatusToElement(el, widget, cached.result);
    return cached.result;
  }

  const permitted = await hasHostPermissionForUrl(widget.endpointUrl);
  if (!permitted) {
    const permResult = { state: "warn", text: "🔒", detail: t("hostPermissionRequired") || "Click to grant host permission" };
    if (el) applyRestStatusToElement(el, widget, permResult);
    return permResult;
  }

  const result = await fetchAndEvaluateRestWidget(widget);
  customRestStatusResultCache.set(widget.id, { timestamp: Date.now(), result });
  if (el) applyRestStatusToElement(el, widget, result);
  return result;
}

export async function pollAllRestStatusWidgets({ force = false } = {}) {
  const visibleMembers = [];
  for (const grp of activeRestStatusGroups) {
    if (grp.representative?.space === "disabled") continue;
    visibleMembers.push(...grp.members);
  }
  await Promise.all(visibleMembers.map(w => pollRestStatusWidget(w, { force })));
}

let restStatusVisibilityBound = false;

export function startRestStatusPolling() {
  if (restStatusPollingIntervalId || typeof setInterval === "undefined") return;
  restStatusPollingIntervalId = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void pollAllRestStatusWidgets({ force: false });
  }, 10000);
  if (!restStatusVisibilityBound && typeof document !== "undefined") {
    restStatusVisibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void pollAllRestStatusWidgets({ force: false });
      }
    });
  }
}

function createRestStatusItemElement(w, { isGroupedItem = false } = {}) {
  const expectedTag = isGroupedItem ? "BUTTON" : "DIV";
  let itemEl = customRestStatusElementCache.get(w.id);
  if (itemEl && itemEl.tagName !== expectedTag) {
    itemEl.remove();
    itemEl = null;
  }
  if (!itemEl) {
    itemEl = document.createElement(isGroupedItem ? "button" : "div");
    customRestStatusElementCache.set(w.id, itemEl);
  }
  if (isGroupedItem) {
    itemEl.type = "button";
    itemEl.className = "rest-status-badge-item";
  } else {
    itemEl.className = "custom-rest-status-widget";
  }
  itemEl.dataset.widgetId = w.id;
  itemEl.innerHTML = "";

  const dot = document.createElement("span");
  dot.className = "rest-status-dot loading";

  const iconEl = createCustomWidgetIconElement(w, "custom-search-icon-img", "custom-search-icon-emoji", "📡");

  const nameEl = document.createElement("span");
  nameEl.className = "rest-status-name";
  nameEl.textContent = w.name || "Status";

  const valueEl = document.createElement("span");
  valueEl.className = "rest-status-value";
  valueEl.textContent = "...";
  if (w.hideValue) {
    valueEl.classList.add("hidden");
  }

  itemEl.append(dot, iconEl, nameEl, valueEl);

  itemEl.onclick = async (e) => {
    if (isGroupedItem) e.stopPropagation();
    const permitted = await hasHostPermissionForUrl(w.endpointUrl);
    if (!permitted) {
      const granted = await requestRestEndpointPermission(w.endpointUrl);
      if (granted) {
        await pollRestStatusWidget(w, { force: true });
      }
      return;
    }
    if (isValidRestEndpointUrl(w.linkUrl)) {
      window.open(w.linkUrl, "_blank", "noopener,noreferrer");
    } else {
      await pollRestStatusWidget(w, { force: true });
    }
  };

  const cached = customRestStatusResultCache.get(w.id);
  if (cached?.result) {
    applyRestStatusToElement(itemEl, w, cached.result);
  }
  return itemEl;
}

function createRefreshButton(onClick) {
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "rest-status-refresh-btn";
  refreshBtn.textContent = "↻";
  refreshBtn.title = t("refresh") || "Refresh";
  refreshBtn.setAttribute("aria-label", t("refresh") || "Refresh");
  refreshBtn.addEventListener("click", onClick);
  return refreshBtn;
}

export function syncCustomRestStatusWidgetElements(customWidgets = []) {
  const groups = groupRestStatusWidgets(customWidgets);
  activeRestStatusGroups = groups;

  const activeMemberIds = new Set();
  const activeRepIds = new Set();
  for (const grp of groups) {
    activeRepIds.add(grp.representative.id);
    for (const m of grp.members) activeMemberIds.add(m.id);
  }

  for (const [id, el] of customRestStatusElementCache.entries()) {
    if (!activeMemberIds.has(id)) {
      el.remove();
      customRestStatusElementCache.delete(id);
      customRestStatusResultCache.delete(id);
    }
  }
  for (const [repId, el] of customRestStatusGroupCache.entries()) {
    if (!activeRepIds.has(repId)) {
      el.remove();
      customRestStatusGroupCache.delete(repId);
    }
  }

  const elementMap = {};
  for (const grp of groups) {
    const rep = grp.representative;

    if (grp.members.length === 1) {
      const existingGroupEl = customRestStatusGroupCache.get(rep.id);
      if (existingGroupEl) {
        existingGroupEl.remove();
        customRestStatusGroupCache.delete(rep.id);
      }
      const prevEl = customRestStatusElementCache.get(rep.id);
      if (prevEl && prevEl.classList.contains("rest-status-badge-item")) {
        prevEl.remove();
        customRestStatusElementCache.delete(rep.id);
      }
      const singleEl = createRestStatusItemElement(rep, { isGroupedItem: false });
      singleEl.appendChild(createRefreshButton(async (e) => {
        e.stopPropagation();
        const ok = await requestRestEndpointPermission(rep.endpointUrl);
        if (ok) await pollRestStatusWidget(rep, { force: true });
      }));
      elementMap[rep.id] = singleEl;
      continue;
    }

    let container = customRestStatusGroupCache.get(rep.id);
    if (!container) {
      container = document.createElement("div");
      container.className = "custom-rest-status-widget is-grouped";
      container.dataset.widgetId = rep.id;
      customRestStatusGroupCache.set(rep.id, container);
    }
    container.innerHTML = "";

    const hideGroupName = grp.members.some(m => !!m.hideGroupName);
    if (grp.groupName && !hideGroupName) {
      const groupLabel = document.createElement("span");
      groupLabel.className = "rest-status-group-label";
      groupLabel.textContent = grp.groupName;
      container.appendChild(groupLabel);
    }

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "rest-status-group-items";
    for (const member of grp.members) {
      itemsWrap.appendChild(createRestStatusItemElement(member, { isGroupedItem: true }));
    }
    container.appendChild(itemsWrap);
    container.appendChild(createRefreshButton(async (e) => {
      e.stopPropagation();
      for (const member of grp.members) {
        const ok = await requestRestEndpointPermission(member.endpointUrl);
        if (ok) void pollRestStatusWidget(member, { force: true });
      }
    }));

    elementMap[rep.id] = container;
  }

  return elementMap;
}
