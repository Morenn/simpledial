import { state, saveState, isStackItem } from "./state.js";
import { loadConfig, saveConfig, defaultConfig, parseJsonSafely, sanitizeParsedJson } from "./config.js";
import { render } from "./render.js";
import { withSyncLock, clearLocalTombstoneState, fetchRemoteWebdavBackupData, deleteRemoteWebdavBackup } from "./sync.js";
import { withAutoBackupLock } from "./backup-lock.js";

export { withAutoBackupLock };

const BACKUP_TYPE_META = {
  bookmarks: {
    storageKey: "myspeeddial-backups",
    filenamePrefix: "speeddial-bookmarks-backup-"
  },
  config: {
    storageKey: "myspeeddial-backups-config",
    filenamePrefix: "speeddial-config-backup-"
  }
};

const ALL_BACKUP_TYPES = Object.keys(BACKUP_TYPE_META);
const MIN_AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // Never more than once per hour
const DEVICE_INFO_STORAGE_KEY = "myspeeddial-device-info";

function getDefaultDeviceName() {
  const ua = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  let os = "";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  if (os && browser) return `${os} · ${browser}`;
  return os || browser || "Unknown device";
}

function generateDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getDeviceInfo() {
  const fallbackName = getDefaultDeviceName();
  if (typeof chrome === "undefined" || !chrome?.storage?.local?.get) {
    return { deviceId: "", deviceName: fallbackName };
  }
  try {
    const res = await chrome.storage.local.get(DEVICE_INFO_STORAGE_KEY);
    const stored = res?.[DEVICE_INFO_STORAGE_KEY];
    const existingId = typeof stored?.deviceId === "string" ? stored.deviceId.trim() : "";
    const existingName = typeof stored?.deviceName === "string" ? stored.deviceName.trim() : "";
    if (existingId && existingName) {
      return { deviceId: existingId, deviceName: existingName };
    }
    const next = {
      deviceId: existingId || generateDeviceId(),
      deviceName: existingName || fallbackName
    };
    if (typeof chrome.storage.local.set === "function") {
      await chrome.storage.local.set({ [DEVICE_INFO_STORAGE_KEY]: next });
    }
    return next;
  } catch {
    return { deviceId: "", deviceName: fallbackName };
  }
}

export async function saveDeviceName(name) {
  const current = await getDeviceInfo();
  const trimmed = typeof name === "string" ? name.trim().slice(0, 64) : "";
  const next = {
    deviceId: current.deviceId || generateDeviceId(),
    deviceName: trimmed || getDefaultDeviceName()
  };
  if (typeof chrome !== "undefined" && chrome?.storage?.local?.set) {
    await chrome.storage.local.set({ [DEVICE_INFO_STORAGE_KEY]: next });
  }
  return next;
}

function normalizeBackupType(type) {
  return BACKUP_TYPE_META[type] ? type : "bookmarks";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function formatBackupTimestamp(timestampMs = Date.now()) {
  const dt = new Date(timestampMs);
  const yy = pad2(dt.getFullYear() % 100);
  const mm = pad2(dt.getMonth() + 1);
  const dd = pad2(dt.getDate());
  const hh = pad2(dt.getHours());
  const mi = pad2(dt.getMinutes());
  const ss = pad2(dt.getSeconds());
  return `${yy}${mm}${dd}-${hh}${mi}${ss}`;
}

function createBackupFilename(timestampMs, type = "bookmarks", existingEntries = []) {
  const { filenamePrefix } = BACKUP_TYPE_META[normalizeBackupType(type)];
  const base = `${filenamePrefix}${formatBackupTimestamp(timestampMs)}`;
  const existingNames = new Set((existingEntries || []).map(e => e?.filename).filter(Boolean));
  let candidate = `${base}.json`;
  let suffix = 2;
  while (existingNames.has(candidate)) {
    candidate = `${base}-${suffix}.json`;
    suffix++;
  }
  return candidate;
}

function isSafeBackupFilename(filename) {
  if (typeof filename !== "string") return false;
  const trimmed = filename.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) return false;
  if (/[\\/\x00-\x1f\x7f%]/.test(trimmed)) return false;
  return true;
}

function parseBackupInput(file) {
  if (!file) return null;
  const candidate = typeof file === "string"
    ? file
    : (typeof file === "object" && file.filename ? file.filename : null);
  return isSafeBackupFilename(candidate) ? { filename: candidate.trim() } : null;
}

async function readBackupEntries(type = "bookmarks") {
  const { storageKey } = BACKUP_TYPE_META[normalizeBackupType(type)];
  const res = await chrome.storage.local.get(storageKey);
  const stored = res[storageKey];
  return Array.isArray(stored) ? stored : [];
}

async function writeBackupEntries(entries, type = "bookmarks") {
  const { storageKey } = BACKUP_TYPE_META[normalizeBackupType(type)];
  await chrome.storage.local.set({ [storageKey]: entries });
}

function normalizeBackupFrequencyHours(config) {
  const raw = Number(config?.backups?.frequencyHours);
  if (!Number.isFinite(raw) || raw <= 0) return 24;
  return raw;
}

function getAddonVersion() {
  try {
    return globalThis.chrome?.runtime?.getManifest?.()?.version || null;
  } catch {
    return null;
  }
}

function isDeepEqualJson(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => isDeepEqualJson(v, b[i]));
  }
  const keysA = Object.keys(a).filter(k => a[k] !== undefined);
  const keysB = Object.keys(b).filter(k => b[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && isDeepEqualJson(a[k], b[k]));
}

function buildConfigBackupAppearance(appearance = {}) {
  const {
    backgroundImage: _omitBackgroundImage,
    ...appearanceToBackup
  } = appearance || {};
  if (Array.isArray(appearanceToBackup.customWidgets)) {
    appearanceToBackup.customWidgets = appearanceToBackup.customWidgets.map(w => {
      if (!w || typeof w !== "object") return w;
      const hasAuthSecret = Boolean(
        (typeof w.authHeaderValue === "string" && w.authHeaderValue !== "") ||
        (typeof w.authHeaderName === "string" && w.authHeaderName.trim() !== "")
      );
      const hasApiKey = typeof w.apiKey === "string" && w.apiKey !== "";
      if (!("authHeaderValue" in w) && !hasAuthSecret && !("apiKey" in w) && !hasApiKey) return w;
      const copy = { ...w };
      if ("authHeaderValue" in w || hasAuthSecret) copy.authHeaderValue = "";
      if ("apiKey" in w || hasApiKey) copy.apiKey = "";
      if (hasAuthSecret || hasApiKey) copy.hadSecret = true;
      return copy;
    });
  }
  return appearanceToBackup;
}

async function buildBackupSnapshot(resolvedType) {
  const addonVersion = getAddonVersion();
  let payload;
  let metadata = {};

  if (resolvedType === "config") {
    const config = await loadConfig();
    const appearanceToBackup = buildConfigBackupAppearance(config.appearance || {});
    const isDefault = isDeepEqualJson(appearanceToBackup, buildConfigBackupAppearance(defaultConfig.appearance));
    payload = { ...(addonVersion ? { addonVersion } : {}), appearance: appearanceToBackup };
    metadata = {
      ...(addonVersion ? { addonVersion } : {}),
      theme: appearanceToBackup.theme || "default",
      settingCount: Object.keys(appearanceToBackup).length,
      customWidgetCount: Array.isArray(appearanceToBackup.customWidgets) ? appearanceToBackup.customWidgets.length : 0,
      isDefault
    };
  } else {
    const groups = Array.isArray(state.groups) ? state.groups : [];
    const tags = Array.isArray(state.tags) ? state.tags : [];
    const groupCount = groups.length;
    const bookmarkCount = groups.reduce((sum, group) => {
      const items = Array.isArray(group?.items)
        ? group.items
        : (Array.isArray(group?.bookmarks) ? group.bookmarks : []);
      return sum + items.reduce((itemSum, item) => {
        if (isStackItem(item)) {
          return itemSum + (Array.isArray(item.children) ? item.children.length : 0);
        }
        return itemSum + 1;
      }, 0);
    }, 0);
    payload = { ...(addonVersion ? { addonVersion } : {}), groups, tags };
    metadata = { ...(addonVersion ? { addonVersion } : {}), groupCount, bookmarkCount };
  }

  const json = JSON.stringify(payload);
  const sizeBytes = new Blob([json], { type: "application/json" }).size;
  return { payload, json, sizeBytes, metadata };
}

async function createBackupLocked(type = "bookmarks", prebuiltSnapshot = null) {
  const resolvedType = normalizeBackupType(type);
  const timestamp = Date.now();
  const [{ json, sizeBytes, metadata }, deviceInfo] = await Promise.all([
    prebuiltSnapshot ? Promise.resolve(prebuiltSnapshot) : buildBackupSnapshot(resolvedType),
    getDeviceInfo()
  ]);

  const entries = await readBackupEntries(resolvedType);
  entries.push({
    type: resolvedType,
    filename: createBackupFilename(timestamp, resolvedType, entries),
    timestamp,
    sizeBytes,
    ...(deviceInfo.deviceId ? { deviceId: deviceInfo.deviceId } : {}),
    ...(deviceInfo.deviceName ? { deviceName: deviceInfo.deviceName } : {}),
    ...metadata,
    data: json
  });

  await writeBackupEntries(entries, resolvedType);
  return entries[entries.length - 1];
}

export async function createBackup(type = "bookmarks", prebuiltSnapshot = null) {
  return await withAutoBackupLock(() => createBackupLocked(type, prebuiltSnapshot));
}

export async function listBackups(type = "bookmarks") {
  const resolvedType = normalizeBackupType(type);
  const entries = await readBackupEntries(resolvedType);
  return entries
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

async function deleteBackupLocked(file, type = "bookmarks", options = {}) {
  const resolvedType = normalizeBackupType(type);
  const parsed = parseBackupInput(file);
  if (!parsed) {
    throw new Error("invalid-backup-file");
  }

  const entries = await readBackupEntries(resolvedType);
  const target = entries.find(entry => entry.filename === parsed.filename);
  if (!target) {
    throw new Error("backup-not-found");
  }

  const targetIsRemoteOnly = target.remoteOnly === true || typeof target.data !== "string";
  const deleteRemote = options?.location === "remote" || targetIsRemoteOnly;

  let remoteDeleted = false;
  let notFoundOnRemote = false;
  if (deleteRemote) {
    const remoteRes = await deleteRemoteWebdavBackup(resolvedType, target.filename, {
      skipSyncLock: Boolean(options?.skipSyncLock)
    });
    if (!remoteRes?.ok) {
      throw new Error(remoteRes?.inProgress ? "delete-in-progress" : "remote-delete-failed");
    }
    remoteDeleted = true;
    notFoundOnRemote = !!remoteRes.notFoundOnRemote;
  }

  let remaining;
  if (deleteRemote && !targetIsRemoteOnly) {
    // Keep local copy, clear syncedToRemote flag
    remaining = entries.map(entry => (entry.filename === parsed.filename ? { ...entry, syncedToRemote: false } : entry));
  } else if (!deleteRemote && !targetIsRemoteOnly && target.syncedToRemote) {
    // Convert synced local backup into remote-only index entry
    remaining = entries.map(entry => {
      if (entry.filename !== parsed.filename) return entry;
      const { data: _d, syncedToRemote: _s, ...meta } = entry;
      return { ...meta, remoteOnly: true };
    });
  } else {
    remaining = entries.filter(entry => entry.filename !== parsed.filename);
  }

  await writeBackupEntries(remaining, resolvedType);
  return {
    ok: true,
    filename: parsed.filename,
    remoteDeleted,
    notFoundOnRemote
  };
}

export async function deleteBackup(file, type = "bookmarks", options = {}) {
  return await withSyncLock(() =>
    withAutoBackupLock(() => deleteBackupLocked(file, type, { ...options, skipSyncLock: true }))
  );
}

async function restoreParsedBackupData(parsedData, resolvedType, filename = "backup.json") {
  const safeParsedData = sanitizeParsedJson(parsedData);
  if (resolvedType === "config") {
    if (!safeParsedData || typeof safeParsedData.appearance !== "object" || safeParsedData.appearance === null || Array.isArray(safeParsedData.appearance)) {
      throw new Error("invalid-backup-structure");
    }

    const config = await loadConfig();
    const existingBackgroundImage = config.appearance?.backgroundImage ?? null;
    const {
      backgroundImage: _ignoredBackgroundImage,
      ...restoredAppearance
    } = safeParsedData.appearance;
    let secretsRemoved = false;
    if (Array.isArray(restoredAppearance.customWidgets)) {
      restoredAppearance.customWidgets = restoredAppearance.customWidgets.map(w => {
        if (!w || typeof w !== "object") return w;
        if (w.hadSecret || w.authHeaderValue || w.apiKey || (typeof w.authHeaderName === "string" && w.authHeaderName.trim() !== "")) {
          secretsRemoved = true;
        }
        const { hadSecret: _hs, ...cleanWidget } = w;
        if ("authHeaderValue" in cleanWidget) cleanWidget.authHeaderValue = "";
        if ("apiKey" in cleanWidget) cleanWidget.apiKey = "";
        return cleanWidget;
      });
    }
    config.appearance = {
      ...restoredAppearance,
      backgroundImage: existingBackgroundImage
    };
    await saveConfig(config);

    return {
      ok: true,
      type: "config",
      filename,
      config,
      secretsRemoved
    };
  }

  if (!safeParsedData || !Array.isArray(safeParsedData.groups)) {
    throw new Error("invalid-backup-structure");
  }

  await withSyncLock(async () => {
    const config = await loadConfig();
    config.sync.enabled = false;
    config.sync.pausedReason = null;
    config.sync.consecutiveErrors = 0;
    config.sync.nextRetryAt = 0;
    config.browserBookmarksAutoSync = false;
    await saveConfig(config);
    await clearLocalTombstoneState({ resetDbUid: true });

    state.groups = safeParsedData.groups;
    state.tags = Array.isArray(safeParsedData.tags) ? safeParsedData.tags : [];
    await saveState();
  });
  await render();

  return {
    ok: true,
    type: "bookmarks",
    warning: "Sync has been disabled before restoring a backup.",
    filename
  };
}

export async function restoreBackupFromJson(jsonText, type = "auto", filename = "uploaded-backup.json") {
  let parsedData = null;
  try {
    parsedData = parseJsonSafely(String(jsonText || ""));
  } catch {
    throw new Error("invalid-backup-json");
  }
  let resolvedType;
  if (type === "auto") {
    if (parsedData && typeof parsedData.appearance === "object" && parsedData.appearance !== null && !Array.isArray(parsedData.appearance)) {
      resolvedType = "config";
    } else if (parsedData && Array.isArray(parsedData.groups)) {
      resolvedType = "bookmarks";
    } else {
      throw new Error("invalid-backup-structure");
    }
  } else {
    resolvedType = normalizeBackupType(type);
  }
  return restoreParsedBackupData(parsedData, resolvedType, filename);
}

async function resolveBackupEntryData(entry, resolvedType, options = {}) {
  if (options?.location !== "remote" && typeof entry?.data === "string") {
    return entry.data;
  }
  return await fetchRemoteWebdavBackupData(resolvedType, entry.filename);
}

export async function restoreBackup(file, type = "bookmarks", options = {}) {
  const resolvedType = normalizeBackupType(type);
  const parsed = parseBackupInput(file);
  if (!parsed) {
    throw new Error("invalid-backup-file");
  }

  const entries = await readBackupEntries(resolvedType);
  const target = entries.find(entry => entry.filename === parsed.filename);
  if (!target) {
    throw new Error("backup-not-found");
  }

  const rawJson = await resolveBackupEntryData(target, resolvedType, options);
  let parsedData = null;
  try {
    parsedData = parseJsonSafely(rawJson);
  } catch (error) {
    throw new Error("invalid-backup-json");
  }

  return restoreParsedBackupData(parsedData, resolvedType, target.filename);
}

async function cleanupOldBackupsLocked(retentionDays, type = null) {
  const days = Math.max(1, Number(retentionDays) || 14);
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const config = await loadConfig().catch(() => null);
  const remoteDays = Math.max(1, Number(config?.backups?.remoteRetentionDays ?? days) || days);
  const remoteCutoff = Date.now() - (remoteDays * 24 * 60 * 60 * 1000);
  const typesToClean = type ? [normalizeBackupType(type)] : ALL_BACKUP_TYPES;
  let totalRemoved = 0;

  for (const backupType of typesToClean) {
    const entries = await readBackupEntries(backupType);
    if (entries.length <= 1) continue;

    // Always preserve at least the single newest local backup (with data) even if older than retentionDays,
    // or the newest overall entry if no local backup with data exists.
    let newestEntry = null;
    for (const entry of entries) {
      if (typeof entry.data === "string" && (!newestEntry || (entry.timestamp || 0) > (newestEntry.timestamp || 0))) {
        newestEntry = entry;
      }
    }
    if (!newestEntry) {
      newestEntry = entries.reduce((best, entry) => ((entry.timestamp || 0) > (best.timestamp || 0) ? entry : best), entries[0]);
    }

    let changed = false;
    const remaining = [];
    for (const entry of entries) {
      const ts = entry.timestamp || 0;
      if (entry === newestEntry) {
        remaining.push(entry);
        continue;
      }
      if (typeof entry.data === "string") {
        if (ts >= cutoff) {
          remaining.push(entry);
        } else if (entry.syncedToRemote && ts >= remoteCutoff) {
          const { data: _d, syncedToRemote: _s, ...meta } = entry;
          remaining.push({ ...meta, remoteOnly: true });
          changed = true;
        } else {
          totalRemoved++;
          changed = true;
        }
      } else if (ts >= remoteCutoff) {
        remaining.push(entry);
      } else {
        totalRemoved++;
        changed = true;
      }
    }

    if (changed) {
      await writeBackupEntries(remaining, backupType);
    }
  }

  return totalRemoved;
}

export async function cleanupOldBackups(retentionDays, type = null) {
  return await withAutoBackupLock(() => cleanupOldBackupsLocked(retentionDays, type));
}

async function maybeCreateAutomaticBackup() {
  const config = await loadConfig();
  if (!config.backups) config.backups = {};
  if (!config.backups.lastAutoBackupByType || typeof config.backups.lastAutoBackupByType !== "object") {
    config.backups.lastAutoBackupByType = {};
  }

  const frequencyHours = normalizeBackupFrequencyHours(config);
  const desiredIntervalMs = frequencyHours * 60 * 60 * 1000;
  const effectiveIntervalMs = Math.max(desiredIntervalMs, MIN_AUTO_BACKUP_INTERVAL_MS);
  const retentionDays = config.backups.retentionDays || 14;
  const updatedTimestamps = {};

  for (const backupType of ALL_BACKUP_TYPES) {
    const rawEntries = await readBackupEntries(backupType);
    const sorted = rawEntries.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const newestBackupTimestamp = Number(sorted[0]?.timestamp || 0);
    const recordedLastAuto = backupType === "bookmarks"
      ? Number(config.backups.lastAutoBackup || 0)
      : Number(config.backups.lastAutoBackupByType[backupType] || 0);
    const lastAuto = Math.max(newestBackupTimestamp, recordedLastAuto);

    if ((Date.now() - lastAuto) < effectiveIntervalMs) {
      continue;
    }

    const entries = rawEntries.slice();
    let entriesChanged = false;
    const snapshot = await buildBackupSnapshot(backupType);
    const skipCreate =
      (backupType === "bookmarks" && !(snapshot.metadata?.bookmarkCount > 0)) ||
      (backupType === "config" && snapshot.metadata?.isDefault);

    if (!skipCreate) {
      const latestLocalWithData = sorted.find(b => typeof b?.data === "string");
      if (latestLocalWithData?.data !== snapshot.json) {
        const timestamp = Date.now();
        const deviceInfo = await getDeviceInfo();
        const filename = createBackupFilename(timestamp, backupType, entries);
        entries.push({
          type: backupType,
          filename,
          timestamp,
          sizeBytes: snapshot.sizeBytes,
          ...deviceInfo,
          ...snapshot.metadata,
          data: snapshot.json
        });
        entriesChanged = true;
      }
      updatedTimestamps[backupType] = Date.now();
    }

    if (entries.length > 1) {
      const parsedDays = Number(retentionDays);
      const days = Math.max(1, Number.isFinite(parsedDays) ? parsedDays : 14);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const remoteCutoff = Date.now() - days * 2 * 24 * 60 * 60 * 1000;
      let newestEntry = entries.find(e => typeof e.data === "string");
      if (newestEntry) {
        for (const entry of entries) {
          if (typeof entry.data === "string" && (entry.timestamp || 0) > (newestEntry.timestamp || 0)) {
            newestEntry = entry;
          }
        }
      } else {
        newestEntry = entries.reduce((best, entry) => ((entry.timestamp || 0) > (best.timestamp || 0) ? entry : best), entries[0]);
      }

      const remaining = [];
      for (const entry of entries) {
        const ts = entry.timestamp || 0;
        if (entry === newestEntry) {
          remaining.push(entry);
          continue;
        }
        if (typeof entry.data === "string") {
          if (ts >= cutoff) {
            remaining.push(entry);
          } else if (entry.syncedToRemote && ts >= remoteCutoff) {
            const { data: _d, syncedToRemote: _s, ...meta } = entry;
            remaining.push({ ...meta, remoteOnly: true });
            entriesChanged = true;
          } else {
            entriesChanged = true;
          }
        } else if (ts >= remoteCutoff) {
          remaining.push(entry);
        } else {
          entriesChanged = true;
        }
      }
      if (entriesChanged) {
        await writeBackupEntries(remaining, backupType);
      }
    } else if (entriesChanged) {
      await writeBackupEntries(entries, backupType);
    }
  }

  const updatedTypes = Object.keys(updatedTimestamps);
  if (updatedTypes.length > 0) {
    const latestConfig = await loadConfig();
    if (!latestConfig.backups) latestConfig.backups = {};
    if (!latestConfig.backups.lastAutoBackupByType || typeof latestConfig.backups.lastAutoBackupByType !== "object") {
      latestConfig.backups.lastAutoBackupByType = {};
    }
    for (const backupType of updatedTypes) {
      const ts = updatedTimestamps[backupType];
      if (backupType === "bookmarks") {
        latestConfig.backups.lastAutoBackup = ts;
      }
      latestConfig.backups.lastAutoBackupByType[backupType] = ts;
    }
    await saveConfig(latestConfig);
  }
}

export async function runBackupInitCheck() {
  await withAutoBackupLock(() => maybeCreateAutomaticBackup()).catch(err => {
    console.warn("backup init check failed", err);
  });
}

export async function getBackup(file, type = "bookmarks", options = {}) {
  const resolvedType = normalizeBackupType(type);
  const parsed = parseBackupInput(file);
  if (!parsed) {
    throw new Error("invalid-backup-file");
  }

  const entries = await readBackupEntries(resolvedType);
  const target = entries.find(entry => entry.filename === parsed.filename);
  if (!target) {
    throw new Error("backup-not-found");
  }

  if (options?.location !== "remote" && typeof target.data === "string") {
    return target;
  }
  const data = await resolveBackupEntryData(target, resolvedType, options);
  return { ...target, data };
}
