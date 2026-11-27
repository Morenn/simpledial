import { isAllowedThemeUrl } from "./color-utils.js";
import { MAX_ICS_BYTES, parseIcsCalendar } from "./calendar-ics.js";

export const CALENDAR_CACHE_KEY = "myspeeddial-calendar-cache";
export const CALENDAR_SECRETS_KEY = "myspeeddial-calendar-secrets";
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
    const encryptCache = Boolean(item.encryptCache);
    const privateUrl = Boolean(item.privateUrl) || encryptCache;
    const url = privateUrl ? "" : normalizeCalendarSourceUrl(item.url);
    if (!privateUrl && !url) continue;

    seenIds.add(id);
    const wantsNotesSync = type === "caldav" && Boolean(item.syncNotesReminders) && !hasNotesSyncTarget;
    if (wantsNotesSync) {
      hasNotesSyncTarget = true;
    }
    const enableReminders =
      item.enableReminders !== undefined ? Boolean(item.enableReminders) : type === "caldav";

    normalized.push({
      id,
      type,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 80) : "Calendar",
      url,
      privateUrl,
      color: normalizeCalendarColor(item.color),
      enabled: item.enabled !== false,
      refreshMinutes: normalizeCalendarRefreshMinutes(item.refreshMinutes),
      enableReminders,
      hideName: Boolean(item.hideName),
      encryptCache,
      syncNotesReminders: wantsNotesSync,
    });
  }

  return normalized;
}

export async function saveWebcalSecretUrl(sourceId, url) {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !sourceId) return;
  const [{ setSecret }, { loadConfig }] = await Promise.all([
    import("./crypto.js"),
    import("./config.js"),
  ]);
  const vaultHeader = (await loadConfig())?.vaultHeader || null;
  const encryptedUrl = await setSecret(String(url || ""), `calendar:${sourceId}:url`, {
    vaultHeader,
    requireVault: true,
  });
  const stored = await chrome.storage.local.get(CALENDAR_SECRETS_KEY);
  const secretsMap = stored?.[CALENDAR_SECRETS_KEY] && typeof stored[CALENDAR_SECRETS_KEY] === "object"
    ? { ...stored[CALENDAR_SECRETS_KEY] }
    : {};
  const existing = secretsMap[sourceId] && typeof secretsMap[sourceId] === "object" ? secretsMap[sourceId] : {};
  secretsMap[sourceId] = {
    ...existing,
    url: encryptedUrl,
  };
  await chrome.storage.local.set({ [CALENDAR_SECRETS_KEY]: secretsMap });
}

export async function loadWebcalSecretUrl(sourceId) {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !sourceId) {
    return { ok: true, value: "" };
  }
  const stored = await chrome.storage.local.get(CALENDAR_SECRETS_KEY);
  const entry = stored?.[CALENDAR_SECRETS_KEY]?.[sourceId];
  if (!entry?.url) return { ok: true, value: "" };
  const [{ getSecret }, { loadConfig }] = await Promise.all([
    import("./crypto.js"),
    import("./config.js"),
  ]);
  const vaultHeader = (await loadConfig())?.vaultHeader || null;
  const secret = await getSecret(entry.url, `calendar:${sourceId}:url`, { vaultHeader });
  if (!secret.ok) {
    return { ok: false, locked: true, value: "" };
  }
  return { ok: true, value: normalizeCalendarSourceUrl(secret.value || "") };
}

export async function deleteWebcalSecretUrl(sourceId) {
  if (typeof chrome === "undefined" || !chrome.storage?.local || !sourceId) return;
  const stored = await chrome.storage.local.get(CALENDAR_SECRETS_KEY);
  const secretsMap = stored?.[CALENDAR_SECRETS_KEY];
  if (!secretsMap || typeof secretsMap !== "object" || !Object.prototype.hasOwnProperty.call(secretsMap, sourceId)) {
    return;
  }
  const next = { ...secretsMap };
  const entry = next[sourceId];
  if (entry && typeof entry === "object" && (entry.username || entry.password)) {
    const updatedEntry = { ...entry };
    delete updatedEntry.url;
    next[sourceId] = updatedEntry;
  } else {
    delete next[sourceId];
  }
  await chrome.storage.local.set({ [CALENDAR_SECRETS_KEY]: next });
}

export async function resolveCalendarSourceUrl(source) {
  if (source?.privateUrl) {
    const secretRes = await loadWebcalSecretUrl(source.id);
    if (!secretRes.ok) {
      return { ok: false, error: "Vault locked", url: "" };
    }
    if (!secretRes.value) {
      return { ok: false, error: "Private URL not set", url: "" };
    }
    return { ok: true, url: secretRes.value };
  }
  const normalizedUrl = normalizeCalendarSourceUrl(source?.url);
  if (!normalizedUrl) {
    return { ok: false, error: "Invalid URL", url: "" };
  }
  return { ok: true, url: normalizedUrl };
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
  if (!raw || typeof raw !== "object") return {};

  const out = {};
  let cryptoMod = null;
  let vaultHeader = null;
  for (const [id, entry] of Object.entries(raw)) {
    if (typeof entry === "string") {
      if (!cryptoMod) {
        const [{ getSecret, isEncryptedSecret }, { loadConfig }] = await Promise.all([
          import("./crypto.js"),
          import("./config.js"),
        ]);
        cryptoMod = { getSecret, isEncryptedSecret };
        vaultHeader = (await loadConfig())?.vaultHeader || null;
      }
      if (cryptoMod.isEncryptedSecret(entry)) {
        const res = await cryptoMod.getSecret(entry, `calendar:cache:${id}`, { vaultHeader });
        if (res.ok && res.value) {
          try {
            const parsed = JSON.parse(res.value);
            if (parsed && typeof parsed === "object") out[id] = parsed;
          } catch {
            // ignore corrupted cache entry
          }
        }
      }
    } else if (entry && typeof entry === "object") {
      out[id] = entry;
    }
  }
  return out;
}

let calendarCacheWriteQueue = Promise.resolve();

export function updateCalendarCacheMap(mutator, { encryptSourceIds = null } = {}) {
  const run = calendarCacheWriteQueue.then(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      const cacheMap = {};
      mutator(cacheMap);
      return;
    }
    const [{ loadConfig }, { isEncryptedSecret, isVaultUnlocked, setSecret, tryAutoUnlockVault }] = await Promise.all([
      import("./config.js"),
      import("./crypto.js"),
    ]);
    const config = await loadConfig();
    const encryptIds = new Set(
      normalizeCalendarSources(config?.appearance?.calendarSources)
        .filter((s) => s.encryptCache)
        .map((s) => s.id),
    );
    if (Array.isArray(encryptSourceIds)) {
      for (const id of encryptSourceIds) {
        if (id) encryptIds.add(id);
      }
    }
    if (encryptIds.size > 0 && !isVaultUnlocked() && config?.vaultHeader?.check) {
      await tryAutoUnlockVault(config.vaultHeader);
    }

    const stored = await chrome.storage.local.get(CALENDAR_CACHE_KEY);
    const raw = stored?.[CALENDAR_CACHE_KEY];
    const cacheMap = await readCalendarCacheMap();
    const changed = mutator(cacheMap);
    if (changed === false) return;

    const nextMap = {};
    for (const [id, entry] of Object.entries(cacheMap)) {
      if (!entry || typeof entry !== "object") continue;
      if (encryptIds.has(id)) {
        if (isVaultUnlocked()) {
          try {
            nextMap[id] = await setSecret(JSON.stringify(entry), `calendar:cache:${id}`, {
              vaultHeader: config?.vaultHeader || null,
              requireVault: true,
            });
            continue;
          } catch {
            // Fall through to preserve existing encrypted entry if Vault locked mid-write.
          }
        }
        if (raw && typeof raw[id] === "string" && isEncryptedSecret(raw[id])) {
          nextMap[id] = raw[id];
        }
      } else {
        nextMap[id] = entry;
      }
    }
    if (raw && typeof raw === "object") {
      for (const [id, rawVal] of Object.entries(raw)) {
        if (
          !Object.prototype.hasOwnProperty.call(nextMap, id) &&
          typeof rawVal === "string" &&
          isEncryptedSecret(rawVal) &&
          !isVaultUnlocked()
        ) {
          nextMap[id] = rawVal;
        }
      }
    }
    await chrome.storage.local.set({ [CALENDAR_CACHE_KEY]: nextMap });
  });
  calendarCacheWriteQueue = run.catch(() => {});
  return run;
}

export async function getCalendarSourceCacheStatus(sourceId) {
  const cacheMap = await readCalendarCacheMap();
  return cacheMap?.[sourceId] || null;
}

export function removeCalendarSourceCache(sourceId) {
  if (!sourceId) return Promise.resolve();
  const run = calendarCacheWriteQueue.then(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const stored = await chrome.storage.local.get(CALENDAR_CACHE_KEY);
    const raw = stored?.[CALENDAR_CACHE_KEY];
    if (!raw || typeof raw !== "object" || !Object.prototype.hasOwnProperty.call(raw, sourceId)) return;
    const next = { ...raw };
    delete next[sourceId];
    await chrome.storage.local.set({ [CALENDAR_CACHE_KEY]: next });
  });
  calendarCacheWriteQueue = run.catch(() => {});
  return run;
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
  const cacheMap = await readCalendarCacheMap();
  const cached = cacheMap[source.id] || null;
  const ttlMs = normalizeCalendarRefreshMinutes(source.refreshMinutes) * 60000;

  const urlRes = await resolveCalendarSourceUrl(source);
  if (!urlRes.ok) {
    return {
      ok: false,
      error: urlRes.error,
      events: cached?.icsText ? parseIcsCalendar(cached.icsText, { rangeStartMs, rangeEndMs }) : [],
    };
  }
  const normalizedUrl = urlRes.url;

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
    const cacheOpts = source?.encryptCache ? { encryptSourceIds: [source.id] } : {};
    if (response.status === 304 && cached?.icsText) {
      const nextEntry = { ...cached, fetchedAt: nowMs, lastError: "" };
      await updateCalendarCacheMap((map) => {
        map[source.id] = nextEntry;
      }, cacheOpts);
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
    }, cacheOpts);

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
          uid: ev.uid,
          source: source.type,
          calendarId: source.id,
          calendarName: source.name,
          color: source.color,
          title: ev.title,
          subtitle: ev.location || (source.hideName ? "" : source.name),
          startMs: ev.startMs,
          endMs: ev.endMs,
          allDay: ev.allDay,
          alarmOffsetsMs: Array.isArray(ev.alarmOffsetsMs) ? ev.alarmOffsetsMs : [],
          done: false,
          status: ev.startMs < nowMs ? "past" : "future",
        }));
      }
      return [];
    }),
  );

  return results.flat();
}
