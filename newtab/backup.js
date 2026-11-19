import { state, saveState, isStackItem } from "./state.js";
import { loadConfig, saveConfig } from "./config.js";
import { render } from "./render.js";

const BACKUP_TYPE_META = {
  bookmarks: {
    storageKey: "myspeeddial-backups",
    filenamePrefix: "backup-"
  },
  config: {
    storageKey: "myspeeddial-backups-config",
    filenamePrefix: "config-backup-"
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

function createBackupFilename(timestampMs, type = "bookmarks") {
  const { filenamePrefix } = BACKUP_TYPE_META[normalizeBackupType(type)];
  const dt = new Date(timestampMs);
  const yy = pad2(dt.getFullYear() % 100);
  const mm = pad2(dt.getMonth() + 1);
  const dd = pad2(dt.getDate());
  const hh = pad2(dt.getHours());
  const mi = pad2(dt.getMinutes());
  const ss = pad2(dt.getSeconds());
  return `${filenamePrefix}${yy}${mm}${dd}-${hh}${mi}${ss}.json`;
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

async function buildBackupSnapshot(resolvedType) {
  const addonVersion = getAddonVersion();
  let payload;
  let metadata = {};

  if (resolvedType === "config") {
    const config = await loadConfig();
    const {
      backgroundImage: _omitBackgroundImage,
      ...appearanceToBackup
    } = config.appearance || {};
    if (Array.isArray(appearanceToBackup.customWidgets)) {
      appearanceToBackup.customWidgets = appearanceToBackup.customWidgets.map(w => {
        if (!w || typeof w !== "object") return w;
        const hasSecret = Boolean(
          (typeof w.authHeaderValue === "string" && w.authHeaderValue !== "") ||
          (typeof w.authHeaderName === "string" && w.authHeaderName.trim() !== "")
        );
        if (!("authHeaderValue" in w) && !hasSecret) return w;
        const copy = { ...w, authHeaderValue: "" };
        if (hasSecret) copy.hadSecret = true;
        return copy;
      });
    }
    payload = { ...(addonVersion ? { addonVersion } : {}), appearance: appearanceToBackup };
    metadata = {
      ...(addonVersion ? { addonVersion } : {}),
      theme: appearanceToBackup.theme || "default",
      settingCount: Object.keys(appearanceToBackup).length,
      customWidgetCount: Array.isArray(appearanceToBackup.customWidgets) ? appearanceToBackup.customWidgets.length : 0
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

export async function createBackup(type = "bookmarks", prebuiltSnapshot = null) {
  const resolvedType = normalizeBackupType(type);
  const timestamp = Date.now();
  const { json, sizeBytes, metadata } = prebuiltSnapshot || await buildBackupSnapshot(resolvedType);

  const entries = await readBackupEntries(resolvedType);
  entries.push({
    type: resolvedType,
    filename: createBackupFilename(timestamp, resolvedType),
    timestamp,
    sizeBytes,
    ...metadata,
    data: json
  });

  await writeBackupEntries(entries, resolvedType);
  return entries[entries.length - 1];
}

export async function listBackups(type = "bookmarks") {
  const resolvedType = normalizeBackupType(type);
  const entries = await readBackupEntries(resolvedType);
  return entries
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function deleteBackup(file, type = "bookmarks") {
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

async function restoreParsedBackupData(parsedData, resolvedType, filename = "backup.json") {
  if (resolvedType === "config") {
    if (!parsedData || typeof parsedData.appearance !== "object" || parsedData.appearance === null || Array.isArray(parsedData.appearance)) {
      throw new Error("invalid-backup-structure");
    }

    const config = await loadConfig();
    const existingBackgroundImage = config.appearance?.backgroundImage ?? null;
    const {
      backgroundImage: _ignoredBackgroundImage,
      ...restoredAppearance
    } = parsedData.appearance;
    let secretsRemoved = false;
    if (Array.isArray(restoredAppearance.customWidgets)) {
      restoredAppearance.customWidgets = restoredAppearance.customWidgets.map(w => {
        if (!w || typeof w !== "object") return w;
        if (w.hadSecret || w.authHeaderValue || (typeof w.authHeaderName === "string" && w.authHeaderName.trim() !== "")) {
          secretsRemoved = true;
        }
        const { hadSecret: _hs, ...cleanWidget } = w;
        if ("authHeaderValue" in cleanWidget) cleanWidget.authHeaderValue = "";
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

  if (!parsedData || !Array.isArray(parsedData.groups)) {
    throw new Error("invalid-backup-structure");
  }

  const config = await loadConfig();
  config.sync.enabled = false;
  config.browserBookmarksAutoSync = false;
  await saveConfig(config);

  state.groups = parsedData.groups;
  state.tags = Array.isArray(parsedData.tags) ? parsedData.tags : [];
  await saveState();
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
    parsedData = JSON.parse(String(jsonText || ""));
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
    parsedData = JSON.parse(target.data);
  } catch (error) {
    throw new Error("invalid-backup-json");
  }

  return restoreParsedBackupData(parsedData, resolvedType, target.filename);
}

export async function cleanupOldBackups(retentionDays, type = null) {
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
  let configChanged = false;

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
    if (backups[0]?.data !== snapshot.json) {
      await createBackup(backupType, snapshot);
    }
    await cleanupOldBackups(retentionDays, backupType);
    const now = Date.now();
    if (backupType === "bookmarks") {
      config.backups.lastAutoBackup = now;
    }
    config.backups.lastAutoBackupByType[backupType] = now;
    configChanged = true;
  }

  if (configChanged) {
    await saveConfig(config);
  }
}

export async function runBackupInitCheck() {
  await maybeCreateAutomaticBackup().catch(err => {
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
