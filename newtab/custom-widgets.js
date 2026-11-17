import { t } from "./i18n.js";
import { normalizeCustomIconValue, isUrlLikeIcon, applyCachedIconImageSrc, isAllowedThemeUrl } from "./color-utils.js";

export const VALID_WIDGET_SPACES = new Set(["header", "left", "center", "right", "footer"]);
export const DEFAULT_WIDGET_ORDER = ["groups", "search", "manage", "bookmarks", "syncStatus", "dateTime", "shortcutPalette", "bookmarksCount"];
const VALID_WIDGET_KEYS = new Set(DEFAULT_WIDGET_ORDER);

export function isValidCustomSearchUrlTemplate(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const testUrl = new URL(trimmed.replace(/\{[a-zA-Z0-9_-]+\}/g, "test"));
    return testUrl.protocol === "http:" || testUrl.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidCustomSearchJsonTemplate(rawJson) {
  if (typeof rawJson !== "string") return false;
  const trimmed = rawJson.trim();
  if (!trimmed) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

const JSON_OMIT_VALUE = Symbol("JSON_OMIT_VALUE");

function resolveJsonTemplateValue(node, valuesMap) {
  if (typeof node === "string") {
    const exactMatch = node.match(/^\{([a-zA-Z0-9_-]+)\}$/);
    if (exactMatch) {
      const val = valuesMap[exactMatch[1]];
      if (Array.isArray(val)) {
        return val.length > 0 ? val : JSON_OMIT_VALUE;
      }
      if (typeof val === "string") {
        const trimmed = val.trim();
        return trimmed ? trimmed : JSON_OMIT_VALUE;
      }
      return JSON_OMIT_VALUE;
    }

    if (/\{[a-zA-Z0-9_-]+\}/.test(node)) {
      let hasAnyValue = false;
      const interpolated = node.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, key) => {
        const val = valuesMap[key];
        if (Array.isArray(val) && val.length > 0) {
          hasAnyValue = true;
          return val.join(",");
        }
        if (typeof val === "string" && val.trim()) {
          hasAnyValue = true;
          return val.trim();
        }
        return "";
      });
      return hasAnyValue ? interpolated : JSON_OMIT_VALUE;
    }

    return node;
  }

  if (Array.isArray(node)) {
    if (node.length === 0) return [];
    const nextArr = [];
    for (const item of node) {
      const resolved = resolveJsonTemplateValue(item, valuesMap);
      if (resolved !== JSON_OMIT_VALUE) {
        nextArr.push(resolved);
      }
    }
    return nextArr.length > 0 ? nextArr : JSON_OMIT_VALUE;
  }

  if (node && typeof node === "object") {
    const keys = Object.keys(node);
    if (keys.length === 0) return {};
    const nextObj = {};
    let hasKey = false;
    for (const k of keys) {
      const resolved = resolveJsonTemplateValue(node[k], valuesMap);
      if (resolved !== JSON_OMIT_VALUE) {
        nextObj[k] = resolved;
        hasKey = true;
      }
    }
    return hasKey ? nextObj : JSON_OMIT_VALUE;
  }

  return node;
}

export function buildCustomSearchTargetUrl(widget, valuesMap = {}) {
  const template = (widget?.urlTemplate || "").trim();
  const mode = widget?.mode === "json" ? "json" : "simple";

  if (mode === "json") {
    const parsed = JSON.parse((widget?.jsonTemplate || "{}").trim());
    const resolved = resolveJsonTemplateValue(parsed, valuesMap);
    const payload = resolved === JSON_OMIT_VALUE ? {} : resolved;
    const encodedJson = encodeURIComponent(JSON.stringify(payload));
    if (/\{json\}/.test(template)) {
      return template.replace(/\{json\}/g, encodedJson);
    }
    return template + encodedJson;
  }

  if (/\{[a-zA-Z0-9_-]+\}/.test(template)) {
    return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, key) => {
      const val = valuesMap[key];
      if (Array.isArray(val)) return encodeURIComponent(val.join(","));
      return encodeURIComponent(typeof val === "string" ? val.trim() : "");
    });
  }

  const firstVal = Object.values(valuesMap).find(v =>
    (Array.isArray(v) && v.length > 0) || (typeof v === "string" && v.trim())
  );
  const encoded = Array.isArray(firstVal)
    ? encodeURIComponent(firstVal.join(","))
    : encodeURIComponent(typeof firstVal === "string" ? firstVal.trim() : "");
  return template + encoded;
}

export function buildCustomSearchPreview(widget, valuesMap = {}) {
  const urlTemplate = (widget?.urlTemplate || "").trim();
  const mode = widget?.mode === "json" ? "json" : "simple";
  if (!isValidCustomSearchUrlTemplate(urlTemplate)) {
    return { valid: false, url: "", jsonString: "", error: "invalid_url" };
  }
  if (mode === "json") {
    const rawJson = (widget?.jsonTemplate || "").trim();
    if (!isValidCustomSearchJsonTemplate(rawJson)) {
      return { valid: false, url: "", jsonString: "", error: "invalid_json" };
    }
    const parsed = JSON.parse(rawJson);
    const resolved = resolveJsonTemplateValue(parsed, valuesMap);
    const payload = resolved === JSON_OMIT_VALUE ? {} : resolved;
    const jsonString = JSON.stringify(payload, null, 2);
    const encodedJson = encodeURIComponent(JSON.stringify(payload));
    const url = /\{json\}/.test(urlTemplate)
      ? urlTemplate.replace(/\{json\}/g, encodedJson)
      : urlTemplate + encodedJson;
    return { valid: true, url, jsonString, error: null };
  }
  return {
    valid: true,
    url: buildCustomSearchTargetUrl(widget, valuesMap),
    jsonString: "",
    error: null
  };
}

export function normalizeCustomWidgetVariables(widget) {
  const vars = Array.isArray(widget?.variables)
    ? widget.variables
        .filter(v => v && typeof v.key === "string" && v.key.trim())
        .map(v => ({
          key: v.key.trim(),
          label: (v.label || v.key).trim(),
          type: ["text", "list", "select", "multi"].includes(v.type) ? v.type : "text",
          optionsText: typeof v.optionsText === "string" ? v.optionsText : ""
        }))
    : [];
  if (vars.length > 0) return vars;
  return [{
    key: "query",
    label: widget?.name || "Search",
    type: "text",
    optionsText: ""
  }];
}

function parseVariableOptions(optionsText = "") {
  return String(optionsText || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) return { label: line, value: line };
      const label = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();
      return { label: label || value, value: value || label };
    });
}

export const VALID_WIDGET_ALIGNS = new Set(["auto", "top", "bottom", "left", "right", "center"]);

export function resolveCustomWidgetIcon(widget) {
  const rawEmoji = typeof widget?.icon === "string" && widget.icon.trim() ? widget.icon.trim() : "🔎";
  const rawCustom = typeof widget?.customIcon === "string" ? widget.customIcon.trim() : "";

  if (rawCustom) {
    const normalized = normalizeCustomIconValue(rawCustom, { allowEmoji: false });
    if (normalized) {
      return { emoji: isUrlLikeIcon(rawEmoji) ? "🔎" : rawEmoji, customIcon: normalized };
    }
  }

  if (isUrlLikeIcon(rawEmoji)) {
    const normalized = normalizeCustomIconValue(rawEmoji, { allowEmoji: false });
    if (normalized) {
      return { emoji: "🔎", customIcon: normalized };
    }
  }

  return { emoji: rawEmoji, customIcon: null };
}

export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

export function normalizeCustomTimeZones(rawZones) {
  if (!Array.isArray(rawZones)) return [];
  const list = [];
  for (const entry of rawZones) {
    if (!entry || typeof entry !== "object") continue;
    const timeZone = typeof entry.timeZone === "string" ? entry.timeZone.trim() : "";
    if (!isValidTimeZone(timeZone)) continue;
    const rawLabel = typeof entry.label === "string" ? entry.label.trim() : "";
    const fallbackLabel = timeZone.split("/").pop()?.replace(/_/g, " ") || timeZone;
    list.push({
      label: rawLabel || fallbackLabel,
      timeZone
    });
  }
  return list;
}

export function formatTimeForTimeZone(date, timeZone, { showSeconds = false, use24Hour = true } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !isValidTimeZone(timeZone)) {
    return "--:--";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      ...(showSeconds ? { second: "2-digit" } : {}),
      hour12: !use24Hour,
      timeZone: timeZone.trim()
    }).format(date);
  } catch {
    return "--:--";
  }
}

function getZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone.trim(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  if (map.hour === 24) map.hour = 0;
  return map;
}

/**
 * Resolves a "HH:MM" or "HH:MM:SS" wall-clock time today in `timeZone` to a UTC Date.
 */
export function resolveDateForTimeInZone(timeString, timeZone, referenceDate = new Date()) {
  if (typeof timeString !== "string" || !isValidTimeZone(timeZone)) return null;
  const match = timeString.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const targetH = Number(match[1]);
  const targetM = Number(match[2]);
  const targetS = match[3] !== undefined ? Number(match[3]) : 0;
  if (targetH < 0 || targetH > 23 || targetM < 0 || targetM > 59 || targetS < 0 || targetS > 59) {
    return null;
  }

  const tz = timeZone.trim();
  const ref = (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime()))
    ? referenceDate
    : new Date();
  const baseDate = getZoneParts(ref, tz);
  const desiredAsUtcMs = Date.UTC(baseDate.year, baseDate.month - 1, baseDate.day, targetH, targetM, targetS);

  // Two-pass offset adjustment handles DST transitions cleanly
  let candidateMs = desiredAsUtcMs;
  for (let i = 0; i < 2; i++) {
    const zp = getZoneParts(new Date(candidateMs), tz);
    const zoneAsUtcMs = Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, zp.minute, zp.second);
    candidateMs += desiredAsUtcMs - zoneAsUtcMs;
  }
  return new Date(candidateMs);
}

/**
 * Returns "+1d", "-1d", or "" when `targetZone`'s calendar date differs from `baseZone` at `date`.
 */
export function getTimeZoneDayShift(date, targetZone, baseZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (!isValidTimeZone(targetZone) || !isValidTimeZone(baseZone)) return "";
  const targetParts = getZoneParts(date, targetZone);
  const baseParts = getZoneParts(date, baseZone);
  const targetDayMs = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
  const baseDayMs = Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day);
  const diffDays = Math.round((targetDayMs - baseDayMs) / 86400000);
  if (diffDays === 0) return "";
  return diffDays > 0 ? `+${diffDays}d` : `${diffDays}d`;
}

export function serializeCustomWidgetsExport(widgets = []) {
  const list = Array.isArray(widgets) ? widgets : [];
  return {
    format: "simple-dial-custom-widgets",
    version: 1,
    exportedAt: new Date().toISOString(),
    widgets: list.map(w => {
      const { emoji, customIcon } = resolveCustomWidgetIcon(w);
      const base = {
        id: typeof w?.id === "string" && w.id.trim() ? w.id.trim() : "",
        name: typeof w?.name === "string" ? w.name.trim() : "",
        icon: emoji.slice(0, 4),
        customIcon: customIcon || null,
        space: VALID_WIDGET_SPACES.has(w?.space) ? w.space : "right",
        align: VALID_WIDGET_ALIGNS.has(w?.align) ? w.align : "auto",
        newRow: !!w?.newRow,
        ...(typeof w?.sourceUrl === "string" && isAllowedThemeUrl(w.sourceUrl) ? { sourceUrl: w.sourceUrl.trim() } : {}),
        ...(typeof w?.sourceUpdatedAt === "string" && w.sourceUpdatedAt ? { sourceUpdatedAt: w.sourceUpdatedAt } : {})
      };
      if (w?.type === "timezone") {
        return {
          ...base,
          type: "timezone",
          timeZones: normalizeCustomTimeZones(w.timeZones),
          showSeconds: !!w.showSeconds,
          use24Hour: w.use24Hour !== false
        };
      }
      return {
        ...base,
        type: "custom-search",
        mode: w?.mode === "json" ? "json" : "simple",
        urlTemplate: typeof w?.urlTemplate === "string" ? w.urlTemplate.trim() : "",
        jsonTemplate: typeof w?.jsonTemplate === "string" ? w.jsonTemplate.trim() : "",
        openInNewTab: !!w?.openInNewTab,
        variables: normalizeCustomWidgetVariables(w),
        groupName: typeof w?.groupName === "string" ? w.groupName.trim() : "",
        isDefault: !!w?.isDefault,
        routePrefixes: normalizeCustomSearchRoutePrefixes(w?.routePrefixes)
      };
    })
  };
}

export function parseImportedCustomWidgets(parsed) {
  let candidates = [];
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.widgets)) {
      candidates = parsed.widgets;
    } else if (Array.isArray(parsed.customWidgets)) {
      candidates = parsed.customWidgets;
    } else if (typeof parsed.urlTemplate === "string" || typeof parsed.name === "string" || Array.isArray(parsed.timeZones)) {
      candidates = [parsed];
    }
  } else {
    return { widgets: [], skipped: 0, validFormat: false };
  }

  if (
    !Array.isArray(parsed) &&
    parsed &&
    !Array.isArray(parsed.widgets) &&
    !Array.isArray(parsed.customWidgets) &&
    typeof parsed.urlTemplate !== "string" &&
    typeof parsed.name !== "string" &&
    !Array.isArray(parsed.timeZones)
  ) {
    return { widgets: [], skipped: 0, validFormat: false };
  }

  const widgets = [];
  let skipped = 0;

  for (const raw of candidates) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }
    const id = typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const { emoji, customIcon } = resolveCustomWidgetIcon(raw);
    const sourceUrl = typeof raw.sourceUrl === "string" && /^https?:\/\//i.test(raw.sourceUrl.trim()) && isAllowedThemeUrl(raw.sourceUrl.trim())
      ? raw.sourceUrl.trim()
      : null;

    if (raw.type === "timezone" || (Array.isArray(raw.timeZones) && typeof raw.urlTemplate !== "string")) {
      const timeZones = normalizeCustomTimeZones(raw.timeZones);
      if (timeZones.length === 0) {
        skipped++;
        continue;
      }
      const tzName = typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : (t("customTzDefaultName") || "Time Zones");
      widgets.push({
        id,
        type: "timezone",
        name: tzName,
        icon: emoji.slice(0, 4),
        customIcon,
        timeZones,
        showSeconds: !!raw.showSeconds,
        use24Hour: raw.use24Hour !== false,
        space: VALID_WIDGET_SPACES.has(raw.space) ? raw.space : "right",
        align: VALID_WIDGET_ALIGNS.has(raw.align) ? raw.align : "auto",
        newRow: !!raw.newRow,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(typeof raw.sourceUpdatedAt === "string" && raw.sourceUpdatedAt ? { sourceUpdatedAt: raw.sourceUpdatedAt } : {})
      });
      continue;
    }

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const urlTemplate = typeof raw.urlTemplate === "string" ? raw.urlTemplate.trim() : "";
    const mode = raw.mode === "json" ? "json" : "simple";
    const jsonTemplate = typeof raw.jsonTemplate === "string" ? raw.jsonTemplate.trim() : "";

    if (!name || !isValidCustomSearchUrlTemplate(urlTemplate)) {
      skipped++;
      continue;
    }
    if (mode === "json" && !isValidCustomSearchJsonTemplate(jsonTemplate)) {
      skipped++;
      continue;
    }

    widgets.push({
      id,
      type: "custom-search",
      mode,
      name,
      icon: emoji.slice(0, 4),
      customIcon,
      urlTemplate,
      jsonTemplate,
      openInNewTab: !!raw.openInNewTab,
      variables: normalizeCustomWidgetVariables({ ...raw, name }),
      space: VALID_WIDGET_SPACES.has(raw.space) ? raw.space : "right",
      align: VALID_WIDGET_ALIGNS.has(raw.align) ? raw.align : "auto",
      newRow: !!raw.newRow,
      groupName: typeof raw.groupName === "string" ? raw.groupName.trim() : "",
      isDefault: !!raw.isDefault,
      routePrefixes: normalizeCustomSearchRoutePrefixes(raw.routePrefixes),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(typeof raw.sourceUpdatedAt === "string" && raw.sourceUpdatedAt ? { sourceUpdatedAt: raw.sourceUpdatedAt } : {})
    });
  }

  return { widgets, skipped, validFormat: true };
}

export function createCustomWidgetSnapshot(widget) {
  if (!widget || typeof widget !== "object") return null;
  const { previousVersion: _ignored, ...rest } = widget;
  return {
    ...rest,
    variables: Array.isArray(rest.variables) ? rest.variables.map(v => ({ ...v })) : [],
    ...(Array.isArray(rest.timeZones) ? { timeZones: rest.timeZones.map(z => ({ ...z })) } : {})
  };
}

export function applyCustomWidgetUpdate(existingWidget, incomingWidget, sourceUrl = null) {
  const prevSnapshot = createCustomWidgetSnapshot(existingWidget);
  const resolvedSourceUrl = (typeof sourceUrl === "string" && sourceUrl.trim())
    ? sourceUrl.trim()
    : (existingWidget?.sourceUrl || incomingWidget?.sourceUrl || null);

  const incomingPrefixes = normalizeCustomSearchRoutePrefixes(incomingWidget?.routePrefixes);
  const existingPrefixes = normalizeCustomSearchRoutePrefixes(existingWidget?.routePrefixes);

  return {
    ...incomingWidget,
    id: existingWidget?.id || incomingWidget.id,
    space: VALID_WIDGET_SPACES.has(existingWidget?.space) ? existingWidget.space : incomingWidget.space,
    align: VALID_WIDGET_ALIGNS.has(existingWidget?.align) ? existingWidget.align : incomingWidget.align,
    newRow: typeof existingWidget?.newRow === "boolean" ? existingWidget.newRow : !!incomingWidget.newRow,
    ...(incomingWidget?.type === "custom-search"
      ? { routePrefixes: incomingPrefixes.length > 0 ? incomingPrefixes : existingPrefixes }
      : {}),
    ...(resolvedSourceUrl ? { sourceUrl: resolvedSourceUrl } : {}),
    sourceUpdatedAt: new Date().toISOString(),
    previousVersion: prevSnapshot
  };
}

export function revertCustomWidgetVersion(widget) {
  if (!widget?.previousVersion || typeof widget.previousVersion !== "object") {
    return widget;
  }
  const restored = createCustomWidgetSnapshot(widget.previousVersion);
  return {
    ...restored,
    id: widget.id,
    previousVersion: null
  };
}

export async function fetchCustomWidgetsFromUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error("INVALID_WIDGET_URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("INVALID_WIDGET_URL");
  }

  const originPattern = getOriginPattern(parsedUrl.href);
  if (originPattern && typeof chrome !== "undefined" && chrome.permissions?.request) {
    try {
      await chrome.permissions.request({ origins: [originPattern] });
    } catch {
      // Proceed in case host permission is already granted or unsupported
    }
  }

  const response = await fetch(parsedUrl.href, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  const json = await response.json();
  const result = parseImportedCustomWidgets(json);
  if (!result.validFormat || result.widgets.length === 0) {
    throw new Error("INVALID_WIDGET_PAYLOAD");
  }

  return {
    url: parsedUrl.href,
    widgets: result.widgets,
    skipped: result.skipped
  };
}

export function normalizeWidgetOrder(rawOrder, customWidgets = []) {
  const customIds = Array.isArray(customWidgets)
    ? customWidgets.map(w => w?.id).filter(Boolean)
    : [];
  const allowedKeys = new Set([...VALID_WIDGET_KEYS, ...customIds]);
  const result = [];
  const seen = new Set();
  if (Array.isArray(rawOrder)) {
    for (const key of rawOrder) {
      if (allowedKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
  }
  for (const key of DEFAULT_WIDGET_ORDER) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  for (const id of customIds) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

export function groupCustomSearchWidgets(customWidgets = []) {
  const validList = Array.isArray(customWidgets)
    ? customWidgets.filter(w =>
        w &&
        w.id &&
        w.type === "custom-search" &&
        isValidCustomSearchUrlTemplate(w.urlTemplate) &&
        (w.mode !== "json" || isValidCustomSearchJsonTemplate(w.jsonTemplate))
      )
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

  for (const g of groups) {
    if (g.members.length > 1) {
      g.representative = g.members.find(m => !!m.isDefault) || g.members[0];
    }
  }

  return groups;
}

export function normalizeCustomSearchRoutePrefixes(raw) {
  const source = Array.isArray(raw)
    ? raw
    : (typeof raw === "string" ? raw.split(",") : []);
  const seen = new Set();
  const result = [];
  for (const item of source) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function resolveCustomSearchRouteEngine(members = [], queryText = "", fallbackWidget = null) {
  if (!Array.isArray(members) || members.length === 0) return fallbackWidget;
  const trimmed = typeof queryText === "string" ? queryText.trim() : "";
  if (!trimmed) return fallbackWidget;

  const upperQuery = trimmed.toUpperCase();
  const candidates = [];
  for (const member of members) {
    if (!member) continue;
    const prefixes = normalizeCustomSearchRoutePrefixes(member.routePrefixes);
    for (const prefix of prefixes) {
      candidates.push({ member, prefixUpper: prefix.toUpperCase() });
    }
  }

  candidates.sort((a, b) => b.prefixUpper.length - a.prefixUpper.length);
  for (const candidate of candidates) {
    if (upperQuery.startsWith(candidate.prefixUpper)) {
      return candidate.member;
    }
  }
  return fallbackWidget;
}

function createCustomSearchIconContent(widget, iconEl) {
  const { emoji, customIcon } = resolveCustomWidgetIcon(widget);
  iconEl.innerHTML = "";
  if (customIcon) {
    const iconImg = document.createElement("img");
    iconImg.className = "custom-search-icon-img";
    applyCachedIconImageSrc(iconImg, customIcon);
    iconImg.alt = "";
    iconImg.addEventListener("error", () => {
      iconEl.textContent = emoji;
    }, { once: true });
    iconEl.appendChild(iconImg);
  } else {
    iconEl.textContent = emoji;
  }
}

let customSearchMenuListenersBound = false;

function closeAllCustomSearchEngineMenus(exceptMenu = null) {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".custom-search-engine-menu:not(.hidden)").forEach(menu => {
    if (menu === exceptMenu) return;
    menu.classList.add("hidden");
    const btn = menu.closest(".custom-search-widget")?.querySelector(".custom-search-icon-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function closeAllCustomSearchMultiMenus(exceptMenu = null) {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".custom-search-multi-menu:not(.hidden)").forEach(menu => {
    if (menu === exceptMenu) return;
    menu.classList.add("hidden");
    const btn = menu.closest(".custom-search-multi-dropdown")?.querySelector(".custom-search-multi-toggle");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function ensureCustomSearchMenuListeners() {
  if (customSearchMenuListenersBound || typeof document === "undefined") return;
  customSearchMenuListenersBound = true;
  document.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element) || (!target.closest(".custom-search-engine-menu") && !target.closest(".custom-search-icon-btn"))) {
      closeAllCustomSearchEngineMenus();
    }
    if (!(target instanceof Element) || !target.closest(".custom-search-multi-dropdown")) {
      closeAllCustomSearchMultiMenus();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeAllCustomSearchEngineMenus();
      closeAllCustomSearchMultiMenus();
    }
  });
}

function renderAutoRouteIconContent(iconEl, iconValue = "") {
  const customImageUrl = normalizeCustomIconValue(iconValue, { allowEmoji: false });
  iconEl.innerHTML = "";
  if (customImageUrl) {
    const iconImg = document.createElement("img");
    iconImg.className = "custom-search-icon-img";
    applyCachedIconImageSrc(iconImg, customImageUrl);
    iconImg.alt = "";
    iconImg.addEventListener("error", () => {
      iconEl.textContent = "🔀";
    }, { once: true });
    iconEl.appendChild(iconImg);
    return;
  }
  const emoji = typeof iconValue === "string" ? iconValue.trim() : "";
  iconEl.textContent = emoji || "🔀";
}

export function syncCustomSearchWidgetElements(customWidgets = [], autoRouteDefaults = {}, autoRouteIcons = {}) {
  ensureCustomSearchMenuListeners();
  const groups = groupCustomSearchWidgets(customWidgets);
  const validRepIds = new Set(groups.map(g => g.representative.id));

  document.querySelectorAll(".custom-search-widget[data-custom-widget-id]").forEach(el => {
    if (!validRepIds.has(el.dataset.customWidgetId)) {
      el.remove();
    }
  });

  const elementMap = {};
  for (const group of groups) {
    const rep = group.representative;
    const members = group.members;
    const isGrouped = members.length > 1;
    const hasAutoRouting = isGrouped && members.some(m => normalizeCustomSearchRoutePrefixes(m.routePrefixes).length > 0);
    const groupKey = group.groupName ? group.groupName.trim().toLowerCase() : "";
    const isAutoRouteDefault = hasAutoRouting && autoRouteDefaults[groupKey] !== false;
    const autoRouteIconRaw = typeof autoRouteIcons[groupKey] === "string" ? autoRouteIcons[groupKey].trim() : "";

    const configSig = JSON.stringify({
      groupName: group.groupName,
      repId: rep.id,
      isAutoRouteDefault,
      autoRouteIconRaw,
      members: members.map(w => {
        const { emoji, customIcon } = resolveCustomWidgetIcon(w);
        return {
          id: w.id,
          name: w.name || "",
          icon: emoji,
          customIcon: customIcon || "",
          isDefault: !!w.isDefault,
          mode: w.mode === "json" ? "json" : "simple",
          urlTemplate: w.urlTemplate || "",
          jsonTemplate: w.jsonTemplate || "",
          openInNewTab: !!w.openInNewTab,
          routePrefixes: normalizeCustomSearchRoutePrefixes(w.routePrefixes),
          variables: normalizeCustomWidgetVariables(w)
        };
      })
    });

    let form = document.querySelector(`.custom-search-widget[data-custom-widget-id="${CSS.escape(rep.id)}"]`);
    if (!form) {
      form = document.createElement("form");
      form.className = "custom-search-widget";
      form.dataset.customWidgetId = rep.id;
    }

    const renderEngineForm = (activeWidget, isAutoRouteMode = false) => {
      form.dataset.activeEngineId = activeWidget.id;
      form.dataset.autoRouteActive = isAutoRouteMode ? "true" : "false";
      const prevPrimaryValue = form.querySelector(".custom-search-input")?.value || "";
      const matchedByPrefix = isAutoRouteMode && hasAutoRouting
        ? resolveCustomSearchRouteEngine(members, prevPrimaryValue, null)
        : null;
      form.innerHTML = "";

      const vars = normalizeCustomWidgetVariables(activeWidget);
      const mainRow = document.createElement("div");
      mainRow.className = "custom-search-main-row";

      let engineMenu = null;
      let iconControl;
      if (isGrouped) {
        const iconBtn = document.createElement("button");
        iconBtn.type = "button";
        iconBtn.className = "custom-search-icon-btn";
        iconBtn.title = t("customSearchSwitchEngineTitle") || "Switch search engine";
        iconBtn.setAttribute("aria-expanded", "false");

        const iconGraphic = document.createElement("span");
        iconGraphic.className = "custom-search-icon";
        if (isAutoRouteMode && !matchedByPrefix) {
          renderAutoRouteIconContent(iconGraphic, autoRouteIconRaw);
        } else {
          createCustomSearchIconContent(activeWidget, iconGraphic);
        }

        const caret = document.createElement("span");
        caret.className = "custom-search-icon-caret";
        caret.textContent = "▾";

        iconBtn.append(iconGraphic, caret);
        iconControl = iconBtn;

        engineMenu = document.createElement("div");
        engineMenu.className = "custom-search-engine-menu hidden";

        if (hasAutoRouting) {
          const autoBtn = document.createElement("button");
          autoBtn.type = "button";
          autoBtn.className = "custom-search-engine-option";
          if (isAutoRouteMode) {
            autoBtn.classList.add("active");
          }

          const autoIcon = document.createElement("span");
          autoIcon.className = "custom-search-icon";
          renderAutoRouteIconContent(autoIcon, autoRouteIconRaw);

          const autoName = document.createElement("span");
          autoName.className = "custom-search-engine-name";
          autoName.textContent = t("customSearchAutoRouteOption") || "Auto-route";

          autoBtn.append(autoIcon, autoName);
          if (isAutoRouteDefault) {
            const star = document.createElement("span");
            star.className = "custom-search-engine-default-star";
            star.textContent = "★";
            autoBtn.appendChild(star);
          }

          autoBtn.addEventListener("click", () => {
            const currentVal = form.querySelector(".custom-search-input")?.value || "";
            const matched = resolveCustomSearchRouteEngine(members, currentVal, rep);
            renderEngineForm(matched, true);
            const nextInput = form.querySelector(".custom-search-input");
            if (nextInput) nextInput.focus();
          });
          engineMenu.appendChild(autoBtn);
        }

        for (const member of members) {
          const itemBtn = document.createElement("button");
          itemBtn.type = "button";
          itemBtn.className = "custom-search-engine-option";
          if (!isAutoRouteMode && member.id === activeWidget.id) {
            itemBtn.classList.add("active");
          }

          const optIcon = document.createElement("span");
          optIcon.className = "custom-search-icon";
          createCustomSearchIconContent(member, optIcon);

          const optName = document.createElement("span");
          optName.className = "custom-search-engine-name";
          optName.textContent = member.name || "Search";

          itemBtn.append(optIcon, optName);
          const memberPrefixes = normalizeCustomSearchRoutePrefixes(member.routePrefixes);
          if (memberPrefixes.length > 0) {
            const prefixSpan = document.createElement("span");
            prefixSpan.className = "custom-search-engine-prefixes";
            prefixSpan.textContent = memberPrefixes.join(", ");
            itemBtn.appendChild(prefixSpan);
          }
          if (!isAutoRouteDefault && member.isDefault) {
            const star = document.createElement("span");
            star.className = "custom-search-engine-default-star";
            star.textContent = "★";
            itemBtn.appendChild(star);
          }

          itemBtn.addEventListener("click", () => {
            renderEngineForm(member, false);
            const nextInput = form.querySelector(".custom-search-input");
            if (nextInput) nextInput.focus();
          });
          engineMenu.appendChild(itemBtn);
        }

        iconBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          closeAllCustomSearchEngineMenus(engineMenu);
          const isHidden = engineMenu.classList.toggle("hidden");
          iconBtn.setAttribute("aria-expanded", String(!isHidden));
        });
      } else {
        const iconSpan = document.createElement("span");
        iconSpan.className = "custom-search-icon";
        createCustomSearchIconContent(activeWidget, iconSpan);
        iconControl = iconSpan;
      }

      const primaryVar = vars.find(v => v.type === "text" || v.type === "list") || vars[0];
      const hasFilterPanel = vars.length > 1 || (primaryVar.type !== "text" && primaryVar.type !== "list");
      const extraVars = hasFilterPanel
        ? vars.filter(v => !(v === primaryVar && (v.type === "text" || v.type === "list")))
        : [];

      const valueReaders = {};
      let primaryInput = null;

      if (primaryVar.type === "text" || primaryVar.type === "list") {
        primaryInput = document.createElement("input");
        primaryInput.type = "search";
        primaryInput.name = primaryVar.key || "query";
        primaryInput.className = "custom-search-input";
        primaryInput.value = prevPrimaryValue;
        const autoRouteLabel = t("customSearchAutoRouteOption") || "Auto-route";
        const placeholder = (isAutoRouteMode && !matchedByPrefix)
          ? `${group.groupName || rep.name || "Search"} (${autoRouteLabel})`
          : (vars.length === 1 ? (activeWidget.name || primaryVar.label) : `${activeWidget.name || "Search"}: ${primaryVar.label}`);
        primaryInput.placeholder = placeholder;
        primaryInput.setAttribute("aria-label", placeholder);
        valueReaders[primaryVar.key] = () => {
          const raw = primaryInput.value.trim();
          if (primaryVar.type === "list") {
            return raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
          }
          return raw;
        };

        if (hasAutoRouting) {
          primaryInput.addEventListener("input", () => {
            if (!isAutoRouteMode) return;
            const nextMatched = resolveCustomSearchRouteEngine(members, primaryInput.value, rep);
            const wasMatchedByPrefix = !!matchedByPrefix;
            const isNowMatchedByPrefix = !!resolveCustomSearchRouteEngine(members, primaryInput.value, null);
            if ((nextMatched && nextMatched.id !== activeWidget.id) || wasMatchedByPrefix !== isNowMatchedByPrefix) {
              const selStart = primaryInput.selectionStart;
              const selEnd = primaryInput.selectionEnd;
              renderEngineForm(nextMatched, true);
              const nextInput = form.querySelector(".custom-search-input");
              if (nextInput) {
                nextInput.focus();
                if (typeof selStart === "number" && typeof selEnd === "number") {
                  try { nextInput.setSelectionRange(selStart, selEnd); } catch {}
                }
              }
            }
          });
        }
      } else {
        const titleLabel = document.createElement("span");
        titleLabel.className = "custom-search-title-label";
        titleLabel.textContent = activeWidget.name || "Search";
        mainRow.append(iconControl, titleLabel);
      }

      if (primaryInput) {
        mainRow.append(iconControl, primaryInput);
      }

      let filtersPanel = null;
      if (extraVars.length > 0) {
        const filterBtn = document.createElement("button");
        filterBtn.type = "button";
        filterBtn.className = "custom-search-filter-btn";
        filterBtn.textContent = "⚙";
        filterBtn.title = t("customSearchFiltersBtnTitle") || "Filters";
        filterBtn.setAttribute("aria-expanded", "false");

        const filterBadge = document.createElement("span");
        filterBadge.className = "custom-search-filter-badge hidden";
        filterBtn.appendChild(filterBadge);

        filtersPanel = document.createElement("div");
        filtersPanel.className = "custom-search-filters hidden";

        for (const v of extraVars) {
          const fieldRow = document.createElement("div");
          fieldRow.className = "custom-search-filter-field";
          const fieldId = `custom-search-${activeWidget.id}-${v.key}`;

          const labelEl = document.createElement(v.type === "multi" ? "span" : "label");
          labelEl.className = "custom-search-filter-label";
          labelEl.textContent = v.label;
          fieldRow.appendChild(labelEl);

          if (v.type === "select") {
            const sel = document.createElement("select");
            sel.id = fieldId;
            sel.name = v.key;
            labelEl.htmlFor = fieldId;
            sel.className = "appearance-select custom-search-filter-select";
            const emptyOpt = document.createElement("option");
            emptyOpt.value = "";
            emptyOpt.textContent = "—";
            sel.appendChild(emptyOpt);
            for (const optDef of parseVariableOptions(v.optionsText)) {
              const opt = document.createElement("option");
              opt.value = optDef.value;
              opt.textContent = optDef.label;
              sel.appendChild(opt);
            }
            fieldRow.appendChild(sel);
            valueReaders[v.key] = () => sel.value;
          } else if (v.type === "multi") {
            const multiWrap = document.createElement("div");
            multiWrap.className = "custom-search-multi-dropdown";

            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "appearance-select custom-search-multi-toggle";
            toggleBtn.setAttribute("aria-expanded", "false");

            const toggleText = document.createElement("span");
            toggleText.className = "custom-search-multi-toggle-text";
            toggleText.textContent = "—";

            const toggleCaret = document.createElement("span");
            toggleCaret.className = "custom-search-icon-caret";
            toggleCaret.textContent = "▾";
            toggleBtn.append(toggleText, toggleCaret);

            const listEl = document.createElement("div");
            listEl.className = "custom-search-multi-list custom-search-multi-menu hidden";
            const checkboxes = [];
            const updateToggleLabel = () => {
              const selectedLabels = checkboxes
                .filter(item => item.cb.checked)
                .map(item => item.label);
              if (selectedLabels.length === 0) {
                toggleText.textContent = "—";
              } else if (selectedLabels.length <= 2) {
                toggleText.textContent = selectedLabels.join(", ");
              } else {
                toggleText.textContent = `${selectedLabels.length} (${selectedLabels.slice(0, 2).join(", ")}…)`;
              }
            };

            for (const optDef of parseVariableOptions(v.optionsText)) {
              const cbLabel = document.createElement("label");
              cbLabel.className = "checkbox-row custom-search-multi-option";
              const cb = document.createElement("input");
              cb.type = "checkbox";
              cb.name = v.key;
              cb.value = optDef.value;
              cb.addEventListener("change", updateToggleLabel);
              const txt = document.createElement("span");
              txt.textContent = optDef.label;
              cbLabel.append(cb, txt);
              listEl.appendChild(cbLabel);
              checkboxes.push({ cb, label: optDef.label });
            }

            toggleBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              closeAllCustomSearchMultiMenus(listEl);
              const isHidden = listEl.classList.toggle("hidden");
              toggleBtn.setAttribute("aria-expanded", String(!isHidden));
            });

            multiWrap.append(toggleBtn, listEl);
            fieldRow.appendChild(multiWrap);
            valueReaders[v.key] = () => checkboxes.filter(item => item.cb.checked).map(item => item.cb.value);
          } else {
            const txtInput = document.createElement("input");
            txtInput.type = "text";
            txtInput.id = fieldId;
            txtInput.name = v.key;
            labelEl.htmlFor = fieldId;
            txtInput.className = "sync-compact-input custom-search-filter-input";
            txtInput.placeholder = v.type === "list" ? "A, B" : v.label;
            fieldRow.appendChild(txtInput);
            valueReaders[v.key] = () => {
              const raw = txtInput.value.trim();
              if (v.type === "list") {
                return raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
              }
              return raw;
            };
          }

          filtersPanel.appendChild(fieldRow);
        }

        const syncActiveFilterIndicator = () => {
          let activeCount = 0;
          for (const v of extraVars) {
            const reader = valueReaders[v.key];
            if (!reader) continue;
            const val = reader();
            if (Array.isArray(val) ? val.length > 0 : (typeof val === "string" && val.trim() !== "")) {
              activeCount++;
            }
          }
          filterBtn.classList.toggle("has-active-filters", activeCount > 0);
          filterBadge.textContent = activeCount > 0 ? String(activeCount) : "";
          filterBadge.classList.toggle("hidden", activeCount === 0);
        };

        filtersPanel.addEventListener("input", syncActiveFilterIndicator);
        filtersPanel.addEventListener("change", syncActiveFilterIndicator);

        filterBtn.addEventListener("click", () => {
          const isHidden = filtersPanel.classList.toggle("hidden");
          filterBtn.setAttribute("aria-expanded", String(!isHidden));
          filterBtn.classList.toggle("active", !isHidden);
        });

        mainRow.appendChild(filterBtn);
      }

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "custom-search-submit";
      submitBtn.textContent = "↵";
      submitBtn.title = activeWidget.name || "Search";
      mainRow.appendChild(submitBtn);

      form.appendChild(mainRow);
      if (engineMenu) {
        form.appendChild(engineMenu);
      }
      if (filtersPanel) {
        form.appendChild(filtersPanel);
      }

      form.onsubmit = (e) => {
        e.preventDefault();
        const valuesMap = {};
        let hasAnyValue = false;
        for (const [k, reader] of Object.entries(valueReaders)) {
          const val = reader();
          valuesMap[k] = val;
          if ((Array.isArray(val) && val.length > 0) || (typeof val === "string" && val.trim())) {
            hasAnyValue = true;
          }
        }
        if (!hasAnyValue) {
          if (primaryInput) primaryInput.focus();
          return;
        }
        const rawPrimaryText = primaryInput ? primaryInput.value.trim() : "";
        const targetWidget = (isAutoRouteMode && hasAutoRouting)
          ? resolveCustomSearchRouteEngine(members, rawPrimaryText, rep)
          : activeWidget;

        let targetValuesMap = valuesMap;
        if (targetWidget.id !== activeWidget.id) {
          const targetVars = normalizeCustomWidgetVariables(targetWidget);
          const targetPrimaryVar = targetVars.find(v => v.type === "text" || v.type === "list") || targetVars[0];
          targetValuesMap = { ...valuesMap };
          if (targetPrimaryVar) {
            targetValuesMap[targetPrimaryVar.key] = targetPrimaryVar.type === "list"
              ? (rawPrimaryText ? rawPrimaryText.split(",").map(s => s.trim()).filter(Boolean) : [])
              : rawPrimaryText;
          }
        }

        if (!isValidCustomSearchUrlTemplate(targetWidget.urlTemplate)) return;
        if (targetWidget.mode === "json" && !isValidCustomSearchJsonTemplate(targetWidget.jsonTemplate)) return;
        const targetUrl = buildCustomSearchTargetUrl(targetWidget, targetValuesMap);
        if (targetWidget.openInNewTab) {
          window.open(targetUrl, "_blank", "noopener,noreferrer");
        } else {
          window.location.href = targetUrl;
        }
      };
    };

    if (form.dataset.configSig !== configSig) {
      const hasPrevAutoRoute = form.dataset.autoRouteActive === "true" || form.dataset.autoRouteActive === "false";
      form.dataset.configSig = configSig;
      const nextAutoRoute = hasAutoRouting
        ? (hasPrevAutoRoute && form.dataset.defaultAutoRouteSig === String(isAutoRouteDefault)
            ? form.dataset.autoRouteActive === "true"
            : isAutoRouteDefault)
        : false;
      form.dataset.defaultAutoRouteSig = String(isAutoRouteDefault);
      const currentActive = nextAutoRoute
        ? resolveCustomSearchRouteEngine(members, form.querySelector(".custom-search-input")?.value || "", rep)
        : (members.find(m => m.id === form.dataset.activeEngineId) || rep);
      renderEngineForm(currentActive, nextAutoRoute);
    }

    elementMap[rep.id] = form;
  }

  return elementMap;
}

function formatTimeInput24h(date, timeZone, showSeconds = false) {
  const parts = getZoneParts(date, timeZone);
  const pad = n => String(n).padStart(2, "0");
  return showSeconds
    ? `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
    : `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function updateCustomTimeZoneWidgets(now = new Date()) {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".custom-timezone-widget[data-custom-widget-id]").forEach(container => {
    const pinnedMs = container.dataset.pinnedTimeMs ? Number(container.dataset.pinnedTimeMs) : NaN;
    const isPinned = Number.isFinite(pinnedMs);
    const effectiveNow = isPinned ? new Date(pinnedMs) : now;
    const baseTz = isPinned ? (container.dataset.pinnedBaseTz || "") : "";

    container.classList.toggle("is-calculator", isPinned);
    const headerEl = container.querySelector(".custom-timezone-header");
    if (headerEl) {
      headerEl.classList.toggle("hidden", !isPinned && headerEl.dataset.hasTitleOrIcon !== "true");
    }
    const resetBtn = container.querySelector(".custom-timezone-reset-btn");
    if (resetBtn) {
      resetBtn.classList.toggle("hidden", !isPinned);
    }

    container.querySelectorAll(".custom-timezone-time[data-tz]").forEach(el => {
      if (el.dataset.editing === "true") return;
      const tz = el.dataset.tz;
      const showSeconds = el.dataset.showSeconds === "true";
      const use24Hour = el.dataset.use24h !== "false";
      const formatted = formatTimeForTimeZone(effectiveNow, tz, { showSeconds, use24Hour });
      const dayShift = isPinned && baseTz ? getTimeZoneDayShift(effectiveNow, tz, baseTz) : "";

      if (dayShift) {
        el.textContent = "";
        el.append(document.createTextNode(formatted));
        const shiftSpan = document.createElement("span");
        shiftSpan.className = "custom-timezone-day-shift";
        shiftSpan.textContent = dayShift;
        el.appendChild(shiftSpan);
      } else {
        el.textContent = formatted;
      }
    });
  });
}

export function syncCustomTimeZoneWidgetElements(customWidgets = []) {
  const tzWidgets = Array.isArray(customWidgets)
    ? customWidgets.filter(w => w && w.id && w.type === "timezone" && normalizeCustomTimeZones(w.timeZones).length > 0)
    : [];
  const validIds = new Set(tzWidgets.map(w => w.id));

  document.querySelectorAll(".custom-timezone-widget[data-custom-widget-id]").forEach(el => {
    if (!validIds.has(el.dataset.customWidgetId)) {
      el.remove();
    }
  });

  const elementMap = {};
  for (const w of tzWidgets) {
    const zones = normalizeCustomTimeZones(w.timeZones);
    const { emoji, customIcon } = resolveCustomWidgetIcon(w);
    const showSeconds = !!w.showSeconds;
    const use24Hour = w.use24Hour !== false;
    const configSig = JSON.stringify({
      name: w.name || "",
      icon: emoji,
      customIcon: customIcon || "",
      timeZones: zones,
      showSeconds,
      use24Hour
    });

    let container = document.querySelector(`.custom-timezone-widget[data-custom-widget-id="${CSS.escape(w.id)}"]`);
    if (!container) {
      container = document.createElement("div");
      container.className = "custom-timezone-widget";
      container.dataset.customWidgetId = w.id;
    }

    if (container.dataset.configSig !== configSig) {
      container.dataset.configSig = configSig;
      delete container.dataset.pinnedTimeMs;
      delete container.dataset.pinnedBaseTz;
      container.classList.remove("is-calculator");
      container.innerHTML = "";

      const hasTitleOrIcon = Boolean(w.name || emoji || customIcon);
      const header = document.createElement("div");
      header.className = `custom-timezone-header${hasTitleOrIcon ? "" : " hidden"}`;
      header.dataset.hasTitleOrIcon = String(hasTitleOrIcon);
      if (hasTitleOrIcon) {
        const iconSpan = document.createElement("span");
        iconSpan.className = "custom-search-icon";
        createCustomSearchIconContent(w, iconSpan);
        header.appendChild(iconSpan);
        if (w.name) {
          const titleSpan = document.createElement("span");
          titleSpan.className = "custom-timezone-title";
          titleSpan.textContent = w.name;
          header.appendChild(titleSpan);
        }
      }

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "custom-timezone-reset-btn hidden";
      resetBtn.textContent = "✕";
      resetBtn.title = t("customTzResetLive") || "Reset to live time";
      resetBtn.setAttribute("aria-label", t("customTzResetLive") || "Reset to live time");
      resetBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        delete container.dataset.pinnedTimeMs;
        delete container.dataset.pinnedBaseTz;
        container.querySelectorAll(".custom-timezone-item.is-pinned").forEach(row => row.classList.remove("is-pinned"));
        updateCustomTimeZoneWidgets();
      });
      header.appendChild(resetBtn);
      container.appendChild(header);

      const listEl = document.createElement("div");
      listEl.className = "custom-timezone-list";
      for (const z of zones) {
        const itemEl = document.createElement("div");
        itemEl.className = "custom-timezone-item";
        itemEl.title = z.timeZone;

        const labelEl = document.createElement("span");
        labelEl.className = "custom-timezone-label";
        labelEl.textContent = z.label;

        const timeEl = document.createElement("span");
        timeEl.className = "custom-timezone-time";
        timeEl.dataset.tz = z.timeZone;
        timeEl.dataset.showSeconds = String(showSeconds);
        timeEl.dataset.use24h = String(use24Hour);
        timeEl.tabIndex = 0;
        timeEl.setAttribute("role", "button");
        timeEl.title = t("customTzClickToCalculate") || "Click to calculate time in other zones";

        const openTimeEditor = () => {
          if (timeEl.dataset.editing === "true") return;
          timeEl.dataset.editing = "true";

          const currentPinnedMs = container.dataset.pinnedTimeMs ? Number(container.dataset.pinnedTimeMs) : NaN;
          const baseDate = Number.isFinite(currentPinnedMs) ? new Date(currentPinnedMs) : new Date();

          const input = document.createElement("input");
          input.type = "time";
          input.name = "tz-calc-time";
          input.className = "custom-timezone-time-input";
          input.step = showSeconds ? "1" : "60";
          input.value = formatTimeInput24h(baseDate, z.timeZone, showSeconds);

          const applyCalculatedTime = () => {
            const resolved = resolveDateForTimeInZone(input.value, z.timeZone, baseDate);
            if (!resolved) return;
            container.dataset.pinnedTimeMs = String(resolved.getTime());
            container.dataset.pinnedBaseTz = z.timeZone;
            listEl.querySelectorAll(".custom-timezone-item.is-pinned").forEach(row => row.classList.remove("is-pinned"));
            itemEl.classList.add("is-pinned");
            updateCustomTimeZoneWidgets();
          };

          const closeTimeEditor = () => {
            if (timeEl.dataset.editing !== "true") return;
            delete timeEl.dataset.editing;
            updateCustomTimeZoneWidgets();
          };

          input.addEventListener("input", applyCalculatedTime);
          input.addEventListener("change", applyCalculatedTime);
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              applyCalculatedTime();
              closeTimeEditor();
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              ev.stopPropagation();
              closeTimeEditor();
            }
          });
          input.addEventListener("blur", closeTimeEditor);

          timeEl.textContent = "";
          timeEl.appendChild(input);
          input.focus();
        };

        timeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          openTimeEditor();
        });
        timeEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openTimeEditor();
          }
        });

        itemEl.append(labelEl, timeEl);
        listEl.appendChild(itemEl);
      }
      container.appendChild(listEl);
    }

    elementMap[w.id] = container;
  }

  updateCustomTimeZoneWidgets();
  return elementMap;
}
