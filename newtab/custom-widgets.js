import { t } from "./i18n.js";
import { isAllowedThemeUrl, normalizeCustomIconValue } from "./color-utils.js";
import {
  VALID_WIDGET_SPACES,
  VALID_WIDGET_ALIGNS,
  DEFAULT_WIDGET_ORDER,
  resolveCustomWidgetIcon,
  createCustomWidgetIconElement,
  createCustomSearchIconContent,
  normalizeWidgetOrder
} from "./widgets/shared.js";
import {
  isValidCustomSearchUrlTemplate,
  isValidCustomSearchJsonTemplate,
  buildCustomSearchTargetUrl,
  buildCustomSearchPreview,
  normalizeCustomWidgetVariables,
  groupCustomSearchWidgets,
  normalizeCustomSearchRoutePrefixes,
  resolveCustomSearchRouteEngine,
  syncCustomSearchWidgetElements
} from "./widgets/search-widget.js";
import {
  isValidTimeZone,
  normalizeCustomTimeZones,
  formatTimeForTimeZone,
  resolveDateForTimeInZone,
  isValidTimeInputValue,
  getTimeZoneDayShift,
  updateCustomTimeZoneWidgets,
  syncCustomTimeZoneWidgetElements
} from "./widgets/timezone-widget.js";
import {
  isValidRestEndpointUrl,
  normalizeRestRefreshSeconds,
  normalizeRestMetrics,
  parseRestMetricsText,
  formatRestMetricsText,
  extractJsonPath,
  evaluateRestStatusRule,
  mapRestDisplayValue,
  evaluateRestResponse,
  requestRestEndpointPermission,
  fetchAndEvaluateRestWidget,
  pollRestStatusWidget,
  pollAllRestStatusWidgets,
  startRestStatusPolling,
  groupRestStatusWidgets,
  syncCustomRestStatusWidgetElements
} from "./widgets/rest-status-widget.js";
import {
  normalizeNotesWidgetData,
  computeReminderTimestamp,
  formatReminderCountdown,
  findDueNoteReminders,
  checkDueNoteReminders,
  startNotesReminderPolling,
  pruneNotesStorageForWidgets,
  openNotesWidgetModal,
  syncCustomNotesWidgetElements
} from "./widgets/notes-widget.js";
import {
  isValidRssFeedUrl,
  normalizeRssRefreshMinutes,
  normalizeRssMaxItems,
  groupRssFeedWidgets,
  parseFeedResponse,
  fetchRssFeedWidget,
  requestRssFeedPermission,
  pollAllRssFeedWidgets,
  startRssFeedPolling,
  pruneRssStorageForWidgets,
  openRssFeedModal,
  syncCustomRssWidgetElements
} from "./widgets/rss-widget.js";
import {
  normalizeWeatherDisplaySize,
  normalizeWeatherProvider,
  normalizeWeatherUnit,
  normalizeWeatherRefreshMinutes,
  formatTemperature,
  mapWmoWeatherCode,
  mapOpenWeatherCondition,
  requestWeatherPermission,
  searchWeatherLocations,
  fetchWeatherWidget,
  pollAllWeatherWidgets,
  startWeatherPolling,
  pruneWeatherStorageForWidgets,
  syncCustomWeatherWidgetElements
} from "./widgets/weather-widget.js";

export {
  VALID_WIDGET_SPACES,
  VALID_WIDGET_ALIGNS,
  DEFAULT_WIDGET_ORDER,
  resolveCustomWidgetIcon,
  createCustomWidgetIconElement,
  createCustomSearchIconContent,
  normalizeWidgetOrder,
  isValidCustomSearchUrlTemplate,
  isValidCustomSearchJsonTemplate,
  buildCustomSearchTargetUrl,
  buildCustomSearchPreview,
  normalizeCustomWidgetVariables,
  groupCustomSearchWidgets,
  normalizeCustomSearchRoutePrefixes,
  resolveCustomSearchRouteEngine,
  syncCustomSearchWidgetElements,
  isValidTimeZone,
  normalizeCustomTimeZones,
  formatTimeForTimeZone,
  resolveDateForTimeInZone,
  isValidTimeInputValue,
  getTimeZoneDayShift,
  updateCustomTimeZoneWidgets,
  syncCustomTimeZoneWidgetElements,
  isValidRestEndpointUrl,
  normalizeRestRefreshSeconds,
  normalizeRestMetrics,
  parseRestMetricsText,
  formatRestMetricsText,
  extractJsonPath,
  evaluateRestStatusRule,
  mapRestDisplayValue,
  evaluateRestResponse,
  requestRestEndpointPermission,
  fetchAndEvaluateRestWidget,
  pollRestStatusWidget,
  pollAllRestStatusWidgets,
  startRestStatusPolling,
  groupRestStatusWidgets,
  syncCustomRestStatusWidgetElements,
  normalizeNotesWidgetData,
  computeReminderTimestamp,
  formatReminderCountdown,
  findDueNoteReminders,
  checkDueNoteReminders,
  startNotesReminderPolling,
  pruneNotesStorageForWidgets,
  openNotesWidgetModal,
  syncCustomNotesWidgetElements,
  isValidRssFeedUrl,
  normalizeRssRefreshMinutes,
  normalizeRssMaxItems,
  groupRssFeedWidgets,
  parseFeedResponse,
  fetchRssFeedWidget,
  requestRssFeedPermission,
  pollAllRssFeedWidgets,
  startRssFeedPolling,
  pruneRssStorageForWidgets,
  openRssFeedModal,
  syncCustomRssWidgetElements,
  normalizeWeatherDisplaySize,
  normalizeWeatherProvider,
  normalizeWeatherUnit,
  normalizeWeatherRefreshMinutes,
  formatTemperature,
  mapWmoWeatherCode,
  mapOpenWeatherCondition,
  requestWeatherPermission,
  searchWeatherLocations,
  fetchWeatherWidget,
  pollAllWeatherWidgets,
  startWeatherPolling,
  pruneWeatherStorageForWidgets,
  syncCustomWeatherWidgetElements
};

function getWidgetGroupKeySet(widgets = []) {
  const keys = new Set();
  for (const w of widgets) {
    const g = typeof w?.groupName === "string" ? w.groupName.trim().toLowerCase() : "";
    if (g) keys.add(g);
  }
  return keys;
}

function normalizeAutoRouteIconsMap(rawMap, allowedGroupKeys = null) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return {};
  const out = {};
  for (const [rawKey, rawVal] of Object.entries(rawMap)) {
    const key = String(rawKey || "").trim().toLowerCase();
    if (!key || (allowedGroupKeys && !allowedGroupKeys.has(key))) continue;
    const normalized = normalizeCustomIconValue(rawVal, { allowEmoji: true });
    if (normalized) out[key] = normalized;
  }
  return out;
}

function normalizeAutoRouteDefaultsMap(rawMap, allowedGroupKeys = null) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return {};
  const out = {};
  for (const [rawKey, rawVal] of Object.entries(rawMap)) {
    const key = String(rawKey || "").trim().toLowerCase();
    if (!key || (allowedGroupKeys && !allowedGroupKeys.has(key))) continue;
    if (typeof rawVal === "boolean") out[key] = rawVal;
  }
  return out;
}

export function serializeCustomWidgetsExport(widgets = [], {
  includeSecrets = false,
  autoRouteIcons = null,
  autoRouteDefaults = null
} = {}) {
  const list = Array.isArray(widgets) ? widgets : [];
  const groupKeys = getWidgetGroupKeySet(list);
  const exportedAutoRouteIcons = normalizeAutoRouteIconsMap(autoRouteIcons, groupKeys);
  const exportedAutoRouteDefaults = normalizeAutoRouteDefaultsMap(autoRouteDefaults, groupKeys);
  return {
    format: "simple-dial-custom-widgets",
    version: 1,
    ...(Object.keys(exportedAutoRouteIcons).length > 0 ? { customSearchAutoRouteIcons: exportedAutoRouteIcons } : {}),
    ...(Object.keys(exportedAutoRouteDefaults).length > 0 ? { customSearchAutoRouteDefaults: exportedAutoRouteDefaults } : {}),
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
      if (w?.type === "notes") {
        return {
          ...base,
          type: "notes",
          compactMode: !!w.compactMode
        };
      }
      if (w?.type === "rss-feed") {
        return {
          ...base,
          type: "rss-feed",
          space: VALID_WIDGET_SPACES.has(w?.space) ? w.space : "left",
          feedUrl: isValidRssFeedUrl(w.feedUrl) ? w.feedUrl.trim() : "",
          refreshMinutes: normalizeRssRefreshMinutes(w.refreshMinutes),
          maxItems: normalizeRssMaxItems(w.maxItems),
          groupName: typeof w.groupName === "string" ? w.groupName.trim() : ""
        };
      }
      if (w?.type === "weather") {
        const hasKey = typeof w.apiKey === "string" && w.apiKey !== "";
        return {
          ...base,
          type: "weather",
          space: VALID_WIDGET_SPACES.has(w?.space) ? w.space : "left",
          provider: normalizeWeatherProvider(w.provider),
          locationName: typeof w.locationName === "string" ? w.locationName.trim() : "",
          latitude: Number.isFinite(Number(w.latitude)) ? Number(w.latitude) : null,
          longitude: Number.isFinite(Number(w.longitude)) ? Number(w.longitude) : null,
          displaySize: normalizeWeatherDisplaySize(w.displaySize),
          unit: normalizeWeatherUnit(w.unit),
          refreshMinutes: normalizeWeatherRefreshMinutes(w.refreshMinutes),
          apiKey: includeSecrets && hasKey && !w.apiKey.startsWith("enc:v1:") ? w.apiKey : "",
          ...(hasKey ? { hadSecret: true } : {})
        };
      }
      if (w?.type === "rest-status") {
        return {
          ...base,
          type: "rest-status",
          space: VALID_WIDGET_SPACES.has(w?.space) ? w.space : "left",
          endpointUrl: typeof w.endpointUrl === "string" ? w.endpointUrl.trim() : "",
          method: w.method === "HEAD" ? "HEAD" : "GET",
          jsonPath: typeof w.jsonPath === "string" ? w.jsonPath.trim() : "",
          valueSuffix: typeof w.valueSuffix === "string" ? w.valueSuffix : "",
          valueMap: typeof w.valueMap === "string" ? w.valueMap.trim() : "",
          hideValue: !!w.hideValue,
          metrics: normalizeRestMetrics(w.metrics),
          collapseMetrics: !!w.collapseMetrics,
          refreshSeconds: normalizeRestRefreshSeconds(w.refreshSeconds),
          okMatch: typeof w.okMatch === "string" ? w.okMatch.trim() : "",
          warnMatch: typeof w.warnMatch === "string" ? w.warnMatch.trim() : "",
          linkUrl: isValidRestEndpointUrl(w.linkUrl) ? w.linkUrl.trim() : "",
          groupName: typeof w.groupName === "string" ? w.groupName.trim() : "",
          hideGroupName: !!w.hideGroupName,
          authHeaderName: typeof w.authHeaderName === "string" ? w.authHeaderName.trim() : "",
          authHeaderValue: includeSecrets && typeof w.authHeaderValue === "string" && !w.authHeaderValue.startsWith("enc:v1:")
            ? w.authHeaderValue
            : ""
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
    } else if (
      typeof parsed.urlTemplate === "string" ||
      typeof parsed.endpointUrl === "string" ||
      typeof parsed.name === "string" ||
      Array.isArray(parsed.timeZones)
    ) {
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
    typeof parsed.endpointUrl !== "string" &&
    typeof parsed.feedUrl !== "string" &&
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

    if (raw.type === "notes") {
      const name = typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : (t("notesDefaultName") || "Notes");
      widgets.push({
        id,
        type: "notes",
        name,
        icon: emoji.slice(0, 4),
        customIcon,
        compactMode: !!raw.compactMode,
        space: VALID_WIDGET_SPACES.has(raw.space) ? raw.space : "right",
        align: VALID_WIDGET_ALIGNS.has(raw.align) ? raw.align : "auto",
        newRow: !!raw.newRow,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(typeof raw.sourceUpdatedAt === "string" && raw.sourceUpdatedAt ? { sourceUpdatedAt: raw.sourceUpdatedAt } : {})
      });
      continue;
    }

    if (raw.type === "rss-feed" || (typeof raw.feedUrl === "string" && typeof raw.urlTemplate !== "string")) {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const feedUrl = typeof raw.feedUrl === "string" ? raw.feedUrl.trim() : "";
      if (!name || !isValidRssFeedUrl(feedUrl)) {
        skipped++;
        continue;
      }
      widgets.push({
        id,
        type: "rss-feed",
        name,
        icon: emoji.slice(0, 4),
        customIcon,
        feedUrl,
        refreshMinutes: normalizeRssRefreshMinutes(raw.refreshMinutes),
        maxItems: normalizeRssMaxItems(raw.maxItems),
        groupName: typeof raw.groupName === "string" ? raw.groupName.trim() : "",
        space: VALID_WIDGET_SPACES.has(raw.space) ? raw.space : "left",
        align: VALID_WIDGET_ALIGNS.has(raw.align) ? raw.align : "auto",
        newRow: !!raw.newRow,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(typeof raw.sourceUpdatedAt === "string" && raw.sourceUpdatedAt ? { sourceUpdatedAt: raw.sourceUpdatedAt } : {})
      });
      continue;
    }

    if (raw.type === "weather") {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const lat = Number(raw.latitude);
      const lon = Number(raw.longitude);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        skipped++;
        continue;
      }
      widgets.push({
        id,
        type: "weather",
        name,
        icon: emoji.slice(0, 4),
        customIcon,
        provider: normalizeWeatherProvider(raw.provider),
        locationName: typeof raw.locationName === "string" ? raw.locationName.trim() : name,
        latitude: lat,
        longitude: lon,
        displaySize: normalizeWeatherDisplaySize(raw.displaySize),
        unit: normalizeWeatherUnit(raw.unit),
        refreshMinutes: normalizeWeatherRefreshMinutes(raw.refreshMinutes),
        apiKey: typeof raw.apiKey === "string" && !raw.apiKey.startsWith("enc:v1:") ? raw.apiKey : "",
        space: VALID_WIDGET_SPACES.has(raw.space) ? raw.space : "left",
        align: VALID_WIDGET_ALIGNS.has(raw.align) ? raw.align : "auto",
        newRow: !!raw.newRow,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(typeof raw.sourceUpdatedAt === "string" && raw.sourceUpdatedAt ? { sourceUpdatedAt: raw.sourceUpdatedAt } : {})
      });
      continue;
    }

    if (raw.type === "rest-status" || (typeof raw.endpointUrl === "string" && typeof raw.urlTemplate !== "string")) {
      const endpointUrl = typeof raw.endpointUrl === "string" ? raw.endpointUrl.trim() : "";
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!name || !isValidRestEndpointUrl(endpointUrl)) {
        skipped++;
        continue;
      }
      widgets.push({
        id,
        type: "rest-status",
        name,
        icon: emoji.slice(0, 4),
        customIcon,
        endpointUrl,
        method: raw.method === "HEAD" ? "HEAD" : "GET",
        jsonPath: typeof raw.jsonPath === "string" ? raw.jsonPath.trim() : "",
        valueSuffix: typeof raw.valueSuffix === "string" ? raw.valueSuffix : "",
        valueMap: typeof raw.valueMap === "string" ? raw.valueMap.trim() : "",
        hideValue: !!raw.hideValue,
        metrics: normalizeRestMetrics(raw.metrics),
        collapseMetrics: !!raw.collapseMetrics,
        refreshSeconds: normalizeRestRefreshSeconds(raw.refreshSeconds),
        okMatch: typeof raw.okMatch === "string" ? raw.okMatch.trim() : "",
        warnMatch: typeof raw.warnMatch === "string" ? raw.warnMatch.trim() : "",
        linkUrl: isValidRestEndpointUrl(raw.linkUrl) ? raw.linkUrl.trim() : "",
        groupName: typeof raw.groupName === "string" ? raw.groupName.trim() : "",
        hideGroupName: !!raw.hideGroupName,
        authHeaderName: typeof raw.authHeaderName === "string" ? raw.authHeaderName.trim() : "",
        authHeaderValue: typeof raw.authHeaderValue === "string" && !raw.authHeaderValue.startsWith("enc:v1:")
          ? raw.authHeaderValue
          : "",
        space: VALID_WIDGET_SPACES.has(raw.space) ? raw.space : "left",
        align: VALID_WIDGET_ALIGNS.has(raw.align) ? raw.align : "auto",
        newRow: !!raw.newRow,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(typeof raw.sourceUpdatedAt === "string" && raw.sourceUpdatedAt ? { sourceUpdatedAt: raw.sourceUpdatedAt } : {})
      });
      continue;
    }

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
      jsonTemplate: mode === "json" ? jsonTemplate : "",
      openInNewTab: !!raw.openInNewTab,
      variables: normalizeCustomWidgetVariables(raw),
      groupName: typeof raw.groupName === "string" ? raw.groupName.trim() : "",
      isDefault: !!raw.isDefault,
      routePrefixes: normalizeCustomSearchRoutePrefixes(raw.routePrefixes),
      space: VALID_WIDGET_SPACES.has(raw.space) ? raw.space : "right",
      align: VALID_WIDGET_ALIGNS.has(raw.align) ? raw.align : "auto",
      newRow: !!raw.newRow,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(typeof raw.sourceUpdatedAt === "string" && raw.sourceUpdatedAt ? { sourceUpdatedAt: raw.sourceUpdatedAt } : {})
    });
  }

  const groupKeys = getWidgetGroupKeySet(widgets);
  const autoRouteIcons = normalizeAutoRouteIconsMap(parsed?.customSearchAutoRouteIcons, groupKeys);
  const autoRouteDefaults = normalizeAutoRouteDefaultsMap(parsed?.customSearchAutoRouteDefaults, groupKeys);

  return { widgets, skipped, validFormat: true, autoRouteIcons, autoRouteDefaults };
}

export function createCustomWidgetSnapshot(widget) {
  if (!widget || typeof widget !== "object") return null;
  const { previousVersion: _ignored, ...rest } = widget;
  try {
    return structuredClone(rest);
  } catch {
    return JSON.parse(JSON.stringify(rest));
  }
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
    id: widget.id || restored.id,
    previousVersion: null
  };
}

export function stringifyAsciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function buildSingleByteReverseMap(encoding) {
  const map = new Map();
  try {
    const decoder = new TextDecoder(encoding);
    const buf = new Uint8Array(128);
    for (let i = 0; i < 128; i++) buf[i] = 0x80 + i;
    const chars = decoder.decode(buf);
    for (let i = 0; i < 128 && i < chars.length; i++) {
      const cp = chars.codePointAt(i);
      if (cp >= 0x80) {
        map.set(cp, 0x80 + i);
      }
    }
  } catch {
    // Ignore unsupported single-byte encodings
  }
  return map;
}

const WIN1252_REVERSE = buildSingleByteReverseMap("windows-1252");
const WIN1250_REVERSE = buildSingleByteReverseMap("windows-1250");

function repairWithSingleByteMap(str, reverseMap) {
  if (typeof str !== "string" || !str || reverseMap.size === 0) return str;
  const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
  let out = "";
  let i = 0;
  while (i < str.length) {
    const firstByte = reverseMap.get(str.codePointAt(i)) ?? -1;
    if (firstByte === -1) {
      const cp = str.codePointAt(i);
      const ch = cp > 0xFFFF ? str.slice(i, i + 2) : str[i];
      out += ch;
      i += ch.length;
      continue;
    }
    const start = i;
    const bytes = [firstByte];
    i++;
    while (i < str.length) {
      const b = reverseMap.get(str.codePointAt(i)) ?? -1;
      if (b === -1) break;
      bytes.push(b);
      i++;
    }
    try {
      out += fatalUtf8.decode(new Uint8Array(bytes));
    } catch {
      out += str.slice(start, i);
    }
  }
  return out;
}

export function repairUtf8Mojibake(str) {
  if (typeof str !== "string" || !str) return str;
  return repairWithSingleByteMap(repairWithSingleByteMap(str, WIN1252_REVERSE), WIN1250_REVERSE);
}

export async function fetchCustomWidgetsFromUrl(rawUrl) {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!/^https?:\/\//i.test(trimmed) || !isAllowedThemeUrl(trimmed)) {
    throw new Error("INVALID_WIDGET_URL");
  }
  const res = await fetch(trimmed, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 512 * 1024) {
    throw new Error("Widget JSON too large (max 512 KB)");
  }
  const rawText = new TextDecoder("utf-8").decode(buf).replace(/^\uFEFF/, "");
  const text = repairUtf8Mojibake(rawText);
  const parsed = JSON.parse(text);
  const { widgets, validFormat, autoRouteIcons, autoRouteDefaults } = parseImportedCustomWidgets(parsed);
  if (!validFormat || widgets.length === 0) {
    throw new Error("INVALID_WIDGET_PAYLOAD");
  }
  return { url: trimmed, widgets, autoRouteIcons, autoRouteDefaults };
}
