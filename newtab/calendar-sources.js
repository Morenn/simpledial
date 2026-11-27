import { isAllowedThemeUrl } from "./color-utils.js";
import { MAX_ICS_BYTES, parseIcsCalendar } from "./calendar-ics.js";

export const CALENDAR_CACHE_KEY = "myspeeddial-calendar-cache";
export const MAX_CALENDAR_SOURCES = 10;
export const MAX_CALENDAR_URL_LENGTH = 2048;
const WEBCAL_TIMEOUT_MS = 10000;

export function normalizeCalendarSourceUrl(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim().replace(/^webcals?:\/\//i, "https://");
  if (
    !trimmed ||
    trimmed.length > MAX_CALENDAR_URL_LENGTH ||
    !/^https?:\/\//i.test(trimmed) ||
    !isAllowedThemeUrl(trimmed)
  ) {
    return "";
  }
  return trimmed;
}

export function normalizeCalendarColor(color) {
  if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color.trim())) {
    return color.trim().toLowerCase();
  }
  return "#4a6bff";
}

export function normalizeCalendarRefreshMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 60;
  return Math.max(5, Math.min(1440, Math.round(num)));
}

/**
 * Normalize calendar sources array (supports WebCAL now and CalDAV-ready fields).
 * @param {Array<any>} sources
 */
export function normalizeCalendarSources(sources) {
  if (!Array.isArray(sources)) return [];
  const normalized = [];
  const seenIds = new Set();
  let hasNotesSyncTarget = false;

  for (const item of sources) {
    if (normalized.length >= MAX_CALENDAR_SOURCES) break;
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : `cal_${normalized.length + 1}`;
    if (seenIds.has(id)) continue;

    const type = item.type === "caldav" ? "caldav" : "webcal";
    const url = normalizeCalendarSourceUrl(item.url);
    if (!url) continue;

    seenIds.add(id);
    const wantsNotesSync = type === "caldav" && Boolean(item.syncNotesReminders) && !hasNotesSyncTarget;
    if (wantsNotesSync) {
      hasNotesSyncTarget = true;
    }

    normalized.push({
      id,
      type,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 80) : "Calendar",
      url,
      color: normalizeCalendarColor(item.color),
      enabled: item.enabled !== false,
      refreshMinutes: normalizeCalendarRefreshMinutes(item.refreshMinutes),
      syncNotesReminders: wantsNotesSync,
    });
  }

  return normalized;
}

export async function requestCalendarSourcePermission(rawUrl) {
  const url = normalizeCalendarSourceUrl(rawUrl);
  if (!url) return false;
  const { requestRestEndpointPermission } = await import("./widgets/rest-status-widget.js");
  return requestRestEndpointPermission(url);
}

export async function readCalendarCacheMap() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return {};
  const stored = await chrome.storage.local.get(CALENDAR_CACHE_KEY);
  const raw = stored?.[CALENDAR_CACHE_KEY];
  return raw && typeof raw === "object" ? { ...raw } : {};
}

let calendarCacheWriteQueue = Promise.resolve();

export function updateCalendarCacheMap(mutator) {
  const run = calendarCacheWriteQueue.then(async () => {
    const cacheMap = await readCalendarCacheMap();
    const changed = mutator(cacheMap);
    if (changed !== false && typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [CALENDAR_CACHE_KEY]: cacheMap });
    }
  });
  calendarCacheWriteQueue = run.catch(() => {});
  return run;
}

export async function getCalendarSourceCacheStatus(sourceId) {
  const cacheMap = await readCalendarCacheMap();
  return cacheMap?.[sourceId] || null;
}

export async function removeCalendarSourceCache(sourceId) {
  await updateCalendarCacheMap((cacheMap) => {
    if (!Object.prototype.hasOwnProperty.call(cacheMap, sourceId)) return false;
    delete cacheMap[sourceId];
    return true;
  });
}

export async function readResponseTextWithLimit(response, maxBytes = MAX_ICS_BYTES) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Calendar feed exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value?.byteLength || 0;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Calendar feed exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  }

  const text = await response.text();
  if (text.length > maxBytes) {
    throw new Error(`Calendar feed exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
  }
  return text;
}

/**
 * Fetch and cache a single WebCAL (.ics) source.
 * @param {object} source
 * @param {{ force?: boolean, rangeStartMs?: number, rangeEndMs?: number, nowMs?: number }} [options]
 */
export async function fetchWebcalSource(
  source,
  { force = false, rangeStartMs = -Infinity, rangeEndMs = Infinity, nowMs = Date.now() } = {},
) {
  const normalizedUrl = normalizeCalendarSourceUrl(source?.url);
  if (!normalizedUrl) {
    return { ok: false, error: "Invalid URL", events: [] };
  }

  const cacheMap = await readCalendarCacheMap();
  const cached = cacheMap[source.id] || null;
  const ttlMs = normalizeCalendarRefreshMinutes(source.refreshMinutes) * 60000;

  if (!force && cached?.icsText && Number.isFinite(cached.fetchedAt) && cached.fetchedAt + ttlMs > nowMs) {
    return {
      ok: true,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
      events: parseIcsCalendar(cached.icsText, { rangeStartMs, rangeEndMs }),
    };
  }

  const { hasHostPermissionForUrl } = await import("./widgets/rest-status-widget.js");
  const hasPerm = await hasHostPermissionForUrl(normalizedUrl);
  if (!hasPerm) {
    return {
      ok: false,
      error: "Host permission required",
      events: cached?.icsText ? parseIcsCalendar(cached.icsText, { rangeStartMs, rangeEndMs }) : [],
    };
  }

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), WEBCAL_TIMEOUT_MS);
  try {
    const headers = {};
    if (!force && cached?.etag) headers["If-None-Match"] = cached.etag;
    if (!force && cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    const response = await fetch(normalizedUrl, { headers, signal: controller.signal });
    if (response.status === 304 && cached?.icsText) {
      const nextEntry = { ...cached, fetchedAt: nowMs, lastError: "" };
      await updateCalendarCacheMap((map) => {
        map[source.id] = nextEntry;
      });
      return {
        ok: true,
        fromCache: true,
        fetchedAt: nowMs,
        events: parseIcsCalendar(cached.icsText, { rangeStartMs, rangeEndMs }),
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const icsText = await readResponseTextWithLimit(response, MAX_ICS_BYTES);
    const nextEntry = {
      icsText,
      etag: response.headers.get("etag") || "",
      lastModified: response.headers.get("last-modified") || "",
      fetchedAt: nowMs,
      lastError: "",
    };
    await updateCalendarCacheMap((map) => {
      map[source.id] = nextEntry;
    });

    return {
      ok: true,
      fromCache: false,
      fetchedAt: nowMs,
      events: parseIcsCalendar(icsText, { rangeStartMs, rangeEndMs }),
    };
  } catch (err) {
    const message = err?.name === "AbortError" ? "Request timed out" : (err?.message || "Fetch failed");
    if (cached) {
      await updateCalendarCacheMap((map) => {
        map[source.id] = { ...(map[source.id] || cached), lastError: message };
      });
    }
    return {
      ok: false,
      error: message,
      events: cached?.icsText ? parseIcsCalendar(cached.icsText, { rangeStartMs, rangeEndMs }) : [],
    };
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Load normalized CalendarEvent items from all enabled external sources (WebCAL now, CalDAV-ready).
 */
export async function loadExternalCalendarEvents({
  sources = [],
  rangeStartMs = -Infinity,
  rangeEndMs = Infinity,
  nowMs = Date.now(),
  force = false,
} = {}) {
  const normalized = normalizeCalendarSources(sources).filter((s) => s.enabled);
  if (normalized.length === 0) return [];

  const results = await Promise.all(
    normalized.map(async (source) => {
      if (source.type === "webcal" || source.type === "caldav") {
        let res;
        if (source.type === "caldav") {
          const { fetchCaldavSource } = await import("./calendar-caldav.js");
          res = await fetchCaldavSource(source, { force, rangeStartMs, rangeEndMs, nowMs });
        } else {
          res = await fetchWebcalSource(source, { force, rangeStartMs, rangeEndMs, nowMs });
        }
        return res.events.map((ev) => ({
          id: `${source.type}:${source.id}:${ev.uid}:${ev.startMs}`,
          source: source.type,
          calendarId: source.id,
          calendarName: source.name,
          color: source.color,
          title: ev.title,
          subtitle: ev.location || source.name,
          startMs: ev.startMs,
          endMs: ev.endMs,
          allDay: ev.allDay,
          done: false,
          status: ev.startMs < nowMs ? "past" : "future",
        }));
      }
      return [];
    }),
  );

  return results.flat();
}
