import { MAX_ICS_BYTES, parseIcsCalendar, serializeIcsEvent } from "./calendar-ics.js";
import { extractNotesCalendarEvents, NOTES_STORAGE_KEY } from "./calendar-events.js";
import {
  normalizeCalendarRefreshMinutes,
  normalizeCalendarSourceUrl,
  readCalendarCacheMap,
  readResponseTextWithLimit,
  updateCalendarCacheMap,
} from "./calendar-sources.js";

export const CALDAV_SECRETS_KEY = "myspeeddial-calendar-secrets";
const CALDAV_TIMEOUT_MS = 12000;
const CALDAV_REPORT_BODY = [
  '<?xml version="1.0" encoding="utf-8" ?>',
  '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">',
  "  <D:prop>",
  "    <D:getetag/>",
  "    <C:calendar-data/>",
  "  </D:prop>",
  "  <C:filter>",
  '    <C:comp-filter name="VCALENDAR">',
  '      <C:comp-filter name="VEVENT"/>',
  "    </C:comp-filter>",
  "  </C:filter>",
  "</C:calendar-query>",
].join("\n");

function decodeXmlText(value) {
  if (typeof value !== "string") return "";
  const stripped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return stripped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractXmlTag(block, tagName) {
  const regex = new RegExp(`<(?:[\\w-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`, "i");
  const match = block.match(regex);
  return match ? match[1].trim() : "";
}

/**
 * Parse a CalDAV multistatus XML response into { href, etag, icsText } items.
 * @param {string} xmlText
 * @param {string} baseUrl
 */
export function parseCaldavMultistatusXml(xmlText, baseUrl) {
  if (typeof xmlText !== "string" || !xmlText.trim()) return [];
  const items = [];
  const responseRegex = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let match;
  while ((match = responseRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const rawHref = decodeXmlText(extractXmlTag(block, "href"));
    const etag = decodeXmlText(extractXmlTag(block, "getetag"));
    const icsText = decodeXmlText(extractXmlTag(block, "calendar-data"));
    if (!icsText) continue;

    let href = rawHref;
    if (rawHref && baseUrl) {
      try {
        const resolved = new URL(rawHref, baseUrl);
        const base = new URL(baseUrl);
        if (resolved.origin !== base.origin) continue;
        href = resolved.toString();
      } catch {
        continue;
      }
    }
    items.push({ href, etag, icsText });
  }
  return items;
}

function encodeBasicAuth(username, password) {
  const raw = `${username || ""}:${password || ""}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `Basic ${btoa(binary)}`;
}

export async function saveCaldavCredentials(sourceId, { username = "", password = "" } = {}) {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !sourceId) return;
  const { setSecret } = await import("./crypto.js");
  const stored = await chrome.storage.local.get(CALDAV_SECRETS_KEY);
  const secretsMap = stored?.[CALDAV_SECRETS_KEY] && typeof stored[CALDAV_SECRETS_KEY] === "object"
    ? { ...stored[CALDAV_SECRETS_KEY] }
    : {};
  const existing = secretsMap[sourceId] || {};
  const nextPassword = password !== undefined && password !== ""
    ? await setSecret(String(password), `calendar:${sourceId}:password`)
    : (existing.password || "");
  secretsMap[sourceId] = {
    username: String(username || "").trim().slice(0, 256),
    password: nextPassword,
  };
  await chrome.storage.local.set({ [CALDAV_SECRETS_KEY]: secretsMap });
}

export async function loadCaldavCredentials(sourceId) {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !sourceId) {
    return { ok: true, username: "", password: "" };
  }
  const stored = await chrome.storage.local.get(CALDAV_SECRETS_KEY);
  const entry = stored?.[CALDAV_SECRETS_KEY]?.[sourceId];
  if (!entry) return { ok: true, username: "", password: "" };
  const { getSecret } = await import("./crypto.js");
  const secret = await getSecret(entry.password || "", `calendar:${sourceId}:password`);
  if (!secret.ok) {
    return { ok: false, locked: true, username: entry.username || "", password: "" };
  }
  return { ok: true, username: entry.username || "", password: secret.value || "" };
}

export async function deleteCaldavCredentials(sourceId) {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !sourceId) return;
  const stored = await chrome.storage.local.get(CALDAV_SECRETS_KEY);
  const secretsMap = stored?.[CALDAV_SECRETS_KEY];
  if (!secretsMap || typeof secretsMap !== "object" || !Object.prototype.hasOwnProperty.call(secretsMap, sourceId)) {
    return;
  }
  const next = { ...secretsMap };
  delete next[sourceId];
  await chrome.storage.local.set({ [CALDAV_SECRETS_KEY]: next });
}

function buildCaldavResourceUrl(collectionUrl, uid) {
  const base = collectionUrl.endsWith("/") ? collectionUrl : `${collectionUrl}/`;
  const safeUid = encodeURIComponent(String(uid).replace(/[^a-zA-Z0-9._-]/g, "_"));
  return `${base}${safeUid}.ics`;
}

function parseCombinedCaldavCache(icsChunks, rangeStartMs, rangeEndMs, excludeSimpleDialNotes) {
  const events = [];
  for (const chunk of icsChunks) {
    const parsed = parseIcsCalendar(chunk, { rangeStartMs, rangeEndMs });
    for (const ev of parsed) {
      if (excludeSimpleDialNotes && String(ev.uid || "").startsWith("simpledial-note-")) {
        continue;
      }
      events.push(ev);
    }
  }
  return events;
}

/**
 * Fetch and cache VEVENTs from a CalDAV calendar collection using REPORT calendar-query.
 */
export async function fetchCaldavSource(
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
  const excludeNotes = Boolean(source.syncNotesReminders);

  if (!force && Array.isArray(cached?.icsChunks) && Number.isFinite(cached.fetchedAt) && cached.fetchedAt + ttlMs > nowMs) {
    return {
      ok: true,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
      events: parseCombinedCaldavCache(cached.icsChunks, rangeStartMs, rangeEndMs, excludeNotes),
    };
  }

  const { hasHostPermissionForUrl } = await import("./widgets/rest-status-widget.js");
  const hasPerm = await hasHostPermissionForUrl(normalizedUrl);
  if (!hasPerm) {
    return {
      ok: false,
      error: "Host permission required",
      events: Array.isArray(cached?.icsChunks)
        ? parseCombinedCaldavCache(cached.icsChunks, rangeStartMs, rangeEndMs, excludeNotes)
        : [],
    };
  }

  const creds = await loadCaldavCredentials(source.id);
  if (!creds.ok) {
    return {
      ok: false,
      error: "Vault locked",
      events: Array.isArray(cached?.icsChunks)
        ? parseCombinedCaldavCache(cached.icsChunks, rangeStartMs, rangeEndMs, excludeNotes)
        : [],
    };
  }

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), CALDAV_TIMEOUT_MS);
  try {
    const headers = {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    };
    if (creds.username || creds.password) {
      headers.Authorization = encodeBasicAuth(creds.username, creds.password);
    }

    const response = await fetch(normalizedUrl, {
      method: "REPORT",
      headers,
      body: CALDAV_REPORT_BODY,
      credentials: "omit",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xmlText = await readResponseTextWithLimit(response, MAX_ICS_BYTES * 2);

    const resources = parseCaldavMultistatusXml(xmlText, normalizedUrl);
    const icsChunks = [];
    let totalChunkChars = 0;
    for (const res of resources) {
      if (!res.icsText || res.icsText.length > MAX_ICS_BYTES) continue;
      if (totalChunkChars + res.icsText.length > MAX_ICS_BYTES) break;
      icsChunks.push(res.icsText);
      totalChunkChars += res.icsText.length;
    }

    await updateCalendarCacheMap((map) => {
      const prev = map[source.id] || {};
      map[source.id] = {
        ...prev,
        icsChunks,
        fetchedAt: nowMs,
        lastError: "",
      };
    });

    return {
      ok: true,
      fromCache: false,
      fetchedAt: nowMs,
      events: parseCombinedCaldavCache(icsChunks, rangeStartMs, rangeEndMs, excludeNotes),
    };
  } catch (err) {
    const message = err?.name === "AbortError" ? "Request timed out" : (err?.message || "CalDAV fetch failed");
    await updateCalendarCacheMap((map) => {
      const prev = map[source.id] || {};
      map[source.id] = { ...prev, lastError: message };
    });
    return {
      ok: false,
      error: message,
      events: Array.isArray(cached?.icsChunks)
        ? parseCombinedCaldavCache(cached.icsChunks, rangeStartMs, rangeEndMs, excludeNotes)
        : [],
    };
  } finally {
    clearTimeout(timerId);
  }
}

let caldavPushQueue = Promise.resolve();

/**
 * Push Notepad reminders (create/update/delete) to the configured CalDAV source
 * that has syncNotesReminders enabled. Serialized to prevent concurrent PUT/DELETE races.
 */
export function syncNotesRemindersToCaldav() {
  const run = caldavPushQueue.then(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return { skipped: true };
    const { loadConfig } = await import("./config.js");
    const config = await loadConfig();
    const sources = Array.isArray(config?.appearance?.calendarSources)
      ? config.appearance.calendarSources
      : [];
    const target = sources.find((s) => s?.type === "caldav" && s.enabled !== false && s.syncNotesReminders);
    if (!target) return { skipped: true };

    const normalizedUrl = normalizeCalendarSourceUrl(target.url);
    if (!normalizedUrl) return { skipped: true };

    const { hasHostPermissionForUrl } = await import("./widgets/rest-status-widget.js");
    if (!(await hasHostPermissionForUrl(normalizedUrl))) return { ok: false, error: "Host permission required" };

    const creds = await loadCaldavCredentials(target.id);
    if (!creds.ok) return { ok: false, error: "Vault locked" };

    const notesStored = await chrome.storage.local.get(NOTES_STORAGE_KEY);
    const noteEvents = extractNotesCalendarEvents(notesStored?.[NOTES_STORAGE_KEY], Date.now());
    const desiredByUid = new Map();
    for (const ev of noteEvents) {
      const uid = `simpledial-note-${ev.todoId || ev.startMs}`;
      const hash = `${ev.title}|${ev.startMs}|${ev.done ? 1 : 0}`;
      desiredByUid.set(uid, {
        uid,
        summary: ev.title,
        description: ev.subtitle || "",
        startMs: ev.startMs,
        done: ev.done,
        hash,
      });
    }

    const cacheMap = await readCalendarCacheMap();
    const pushedMap = { ...(cacheMap[target.id]?.pushedNotes || {}) };
    const authHeaders = creds.username || creds.password
      ? { Authorization: encodeBasicAuth(creds.username, creds.password) }
      : {};

    // PUT created or changed reminders
    for (const [uid, item] of desiredByUid.entries()) {
      const prev = pushedMap[uid];
      if (prev && prev.hash === item.hash) continue;

      const href = prev?.href || buildCaldavResourceUrl(normalizedUrl, uid);
      const headers = {
        ...authHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
      };
      if (prev?.etag) {
        headers["If-Match"] = prev.etag;
      } else {
        headers["If-None-Match"] = "*";
      }

      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), CALDAV_TIMEOUT_MS);
      try {
        const res = await fetch(href, {
          method: "PUT",
          headers,
          body: serializeIcsEvent(item),
          credentials: "omit",
          signal: controller.signal,
        });
        if (res.ok || res.status === 201 || res.status === 204) {
          pushedMap[uid] = {
            href,
            etag: res.headers.get("etag") || prev?.etag || "",
            hash: item.hash,
          };
        }
      } catch {
        // Leave item pending so next reminder sync retries.
      } finally {
        clearTimeout(timerId);
      }
    }

    // DELETE removed reminders
    for (const [uid, prev] of Object.entries(pushedMap)) {
      if (desiredByUid.has(uid)) continue;
      if (!prev?.href) {
        delete pushedMap[uid];
        continue;
      }
      const headers = { ...authHeaders };
      if (prev.etag) headers["If-Match"] = prev.etag;
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), CALDAV_TIMEOUT_MS);
      try {
        const res = await fetch(prev.href, {
          method: "DELETE",
          headers,
          credentials: "omit",
          signal: controller.signal,
        });
        if (res.ok || res.status === 404 || res.status === 410) {
          delete pushedMap[uid];
        }
      } catch {
        // Leave pending delete so next sync retries.
      } finally {
        clearTimeout(timerId);
      }
    }

    await updateCalendarCacheMap((map) => {
      const prev = map[target.id] || {};
      map[target.id] = { ...prev, pushedNotes: pushedMap };
    });

    return { ok: true };
  });
  caldavPushQueue = run.catch(() => {});
  return run;
}
