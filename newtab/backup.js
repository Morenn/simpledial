import { state, saveState } from "./state.js";
import { loadConfig, saveConfig } from "./config.js";
import { render } from "./render.js";

const BACKUPS_STORAGE_KEY = "myspeeddial-backups";
const MIN_AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // Never more than once per hour

function pad2(value) {
  return String(value).padStart(2, "0");
}

function createBackupFilename(timestampMs) {
  const dt = new Date(timestampMs);
  const yy = pad2(dt.getFullYear() % 100);
  const mm = pad2(dt.getMonth() + 1);
  const dd = pad2(dt.getDate());
  const hh = pad2(dt.getHours());
  const mi = pad2(dt.getMinutes());
  const ss = pad2(dt.getSeconds());
  return `backup-${yy}${mm}${dd}-${hh}${mi}${ss}.json`;
}

function parseBackupInput(file) {
  if (!file) return null;
  if (typeof file === "string") return { filename: file };
  if (typeof file === "object" && file.filename) return { filename: file.filename };
  return null;
}

async function readBackupEntries() {
  const res = await chrome.storage.local.get(BACKUPS_STORAGE_KEY);
  const stored = res[BACKUPS_STORAGE_KEY];
  return Array.isArray(stored) ? stored : [];
}

async function writeBackupEntries(entries) {
  await chrome.storage.local.set({ [BACKUPS_STORAGE_KEY]: entries });
}

function normalizeBackupFrequencyHours(config) {
  const raw = Number(config?.backups?.frequencyHours);
  if (!Number.isFinite(raw) || raw <= 0) return 24;
  return raw;
}

export async function createBackup() {
  const timestamp = Date.now();
  const groups = Array.isArray(state.groups) ? state.groups : [];
  const groupCount = groups.length;
  const bookmarkCount = groups.reduce((sum, group) => {
    const items = Array.isArray(group?.items)
      ? group.items
      : (Array.isArray(group?.bookmarks) ? group.bookmarks : []);
    return sum + items.length;
  }, 0);
  const payload = {
    groups
  };
  const json = JSON.stringify(payload, null, 2);
  const sizeBytes = new Blob([json], { type: "application/json" }).size;

  const entries = await readBackupEntries();
  entries.push({
    filename: createBackupFilename(timestamp),
    timestamp,
    sizeBytes,
    groupCount,
    bookmarkCount,
    data: json
  });

  await writeBackupEntries(entries);
  return entries[entries.length - 1];
}

export async function listBackups() {
  const entries = await readBackupEntries();
  return entries
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function deleteBackup(file) {
  const parsed = parseBackupInput(file);
  if (!parsed) {
    throw new Error("invalid-backup-file");
  }

  const entries = await readBackupEntries();
  const remaining = entries.filter(entry => entry.filename !== parsed.filename);

  if (remaining.length === entries.length) {
    throw new Error("backup-not-found");
  }

  await writeBackupEntries(remaining);
  return {
    ok: true,
    filename: parsed.filename
  };
}

export async function restoreBackup(file) {
  const parsed = parseBackupInput(file);
  if (!parsed) {
    throw new Error("invalid-backup-file");
  }

  const entries = await readBackupEntries();
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

  if (!parsedData || !Array.isArray(parsedData.groups)) {
    throw new Error("invalid-backup-structure");
  }

  const config = await loadConfig();
  config.sync.enabled = false;
  await saveConfig(config);

  state.groups = parsedData.groups;
  await saveState();
  await render();

  return {
    ok: true,
    warning: "Sync has been disabled before restoring a backup.",
    filename: target.filename
  };
}

export async function cleanupOldBackups(retentionDays) {
  const days = Math.max(1, Number(retentionDays) || 30);
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const entries = await readBackupEntries();
  const remaining = entries.filter(entry => (entry.timestamp || 0) >= cutoff);
  const removed = entries.length - remaining.length;

  if (removed > 0) {
    await writeBackupEntries(remaining);
  }

  return removed;
}

async function maybeCreateAutomaticBackup() {
  const config = await loadConfig();
  const frequencyHours = normalizeBackupFrequencyHours(config);
  const desiredIntervalMs = frequencyHours * 60 * 60 * 1000;
  const effectiveIntervalMs = Math.max(desiredIntervalMs, MIN_AUTO_BACKUP_INTERVAL_MS);
  const backups = await listBackups();
  const newestBackupTimestamp = Number(backups[0]?.timestamp || 0);
  const lastAuto = Math.max(newestBackupTimestamp, Number(config?.backups?.lastAutoBackup || 0));

  if ((Date.now() - lastAuto) < effectiveIntervalMs) {
    return;
  }

  await createBackup();
  await cleanupOldBackups(config?.backups?.retentionDays || 30);
  config.backups.lastAutoBackup = Date.now();
  await saveConfig(config);
}

export async function runBackupInitCheck() {
  await maybeCreateAutomaticBackup().catch(err => {
    console.warn("backup init check failed", err);
  });
}

export async function getBackup(file) {
  const parsed = parseBackupInput(file);
  if (!parsed) {
    throw new Error("invalid-backup-file");
  }

  const entries = await readBackupEntries();
  const target = entries.find(entry => entry.filename === parsed.filename);
  if (!target) {
    throw new Error("backup-not-found");
  }

  return target;
}