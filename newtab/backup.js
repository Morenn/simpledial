import { state, saveState, isStackItem } from "./state.js";
import { loadConfig, saveConfig, defaultConfig, parseJsonSafely, sanitizeParsedJson } from "./config.js";
import { render } from "./render.js";
import { withSyncLock, clearLocalTombstoneState } from "./sync.js";

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

function parseBackupInput(file) {
  if (!file) return null;
  if (typeof file === "string") return { filename: file };
  if (typeof file === "object" && file.filename) return { filename: file.filename };
  return null;
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
  const { json, sizeBytes, metadata } = prebuiltSnapshot || await buildBackupSnapshot(resolvedType);

  const entries = await readBackupEntries(resolvedType);
  entries.push({
    type: resolvedType,
    filename: createBackupFilename(timestamp, resolvedType, entries),
    timestamp,
    sizeBytes,
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

async function deleteBackupLocked(file, type = "bookmarks") {
  const resolvedType = normalizeBackupType(type);
  const parsed = parseBackupInput(file);
  if (!parsed) {
    throw new Error("invalid-backup-file");
  }

  const entries = await readBackupEntries(resolvedType);
  const remaining = entries.filter(entry => entry.filename !== parsed.filename);

  if (remaining.length === entries.length) {
    throw new Error("backup-not-found");
  }

  await writeBackupEntries(remaining, resolvedType);
  return {
    ok: true,
    filename: parsed.filename
  };
}

export async function deleteBackup(file, type = "bookmarks") {
  return await withAutoBackupLock(() => deleteBackupLocked(file, type));
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

export async function restoreBackup(file, type = "bookmarks") {
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

  let parsedData = null;
  try {
    parsedData = parseJsonSafely(target.data);
  } catch (error) {
    throw new Error("invalid-backup-json");
  }

  return restoreParsedBackupData(parsedData, resolvedType, target.filename);
}

async function cleanupOldBackupsLocked(retentionDays, type = null) {
  const days = Math.max(1, Number(retentionDays) || 14);
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const typesToClean = type ? [normalizeBackupType(type)] : ALL_BACKUP_TYPES;
  let totalRemoved = 0;

  for (const backupType of typesToClean) {
    const entries = await readBackupEntries(backupType);
    if (entries.length <= 1) continue;

    // Always preserve at least the single newest backup even if it is older than retentionDays.
    let newestEntry = entries[0];
    for (const entry of entries) {
      if ((entry.timestamp || 0) > (newestEntry.timestamp || 0)) {
        newestEntry = entry;
      }
    }

    const remaining = entries.filter(entry => entry === newestEntry || (entry.timestamp || 0) >= cutoff);
    const removed = entries.length - remaining.length;

    if (removed > 0) {
      await writeBackupEntries(remaining, backupType);
      totalRemoved += removed;
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
    const backups = await listBackups(backupType);
    const newestBackupTimestamp = Number(backups[0]?.timestamp || 0);
    const recordedLastAuto = backupType === "bookmarks"
      ? Number(config.backups.lastAutoBackup || 0)
      : Number(config.backups.lastAutoBackupByType[backupType] || 0);
    const lastAuto = Math.max(newestBackupTimestamp, recordedLastAuto);

    if ((Date.now() - lastAuto) < effectiveIntervalMs) {
      continue;
    }

    const snapshot = await buildBackupSnapshot(backupType);
    if (
      (backupType === "bookmarks" && !(snapshot.metadata?.bookmarkCount > 0)) ||
      (backupType === "config" && snapshot.metadata?.isDefault)
    ) {
      await cleanupOldBackupsLocked(retentionDays, backupType);
      continue;
    }
    if (backups[0]?.data !== snapshot.json) {
      await createBackupLocked(backupType, snapshot);
    }
    await cleanupOldBackupsLocked(retentionDays, backupType);
    updatedTimestamps[backupType] = Date.now();
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

let autoBackupQueue = Promise.resolve();

async function withAutoBackupLock(task) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  if (locks && typeof locks.request === "function") {
    return locks.request("simple-dial-auto-backup", { mode: "exclusive" }, async () => await task());
  }
  const next = autoBackupQueue.then(task, task);
  autoBackupQueue = next.catch(() => {});
  return next;
}

export async function runBackupInitCheck() {
  await withAutoBackupLock(() => maybeCreateAutomaticBackup()).catch(err => {
    console.warn("backup init check failed", err);
  });
}

export async function getBackup(file, type = "bookmarks") {
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

  return target;
}
