// ======================================================
// CONFIGURATION MANAGEMENT
// ======================================================

import { getStorageValue } from "./storage-cache.js";

export const DEFAULT_SYNC_INTERVAL = 60000; // 1 minute in milliseconds

export const CONFIG_STORAGE_KEY = "myspeeddial-config";

export const defaultConfig = {
  browserBookmarksAutoSync: false,
  vaultHeader: null,
  vaultAutoLockMinutes: 0,
  vaultMuteSyncLockedWarning: false,
  sync: {
    enabled: false,
    serverUrl: "",
    type: "direct", // "direct", "webdav" or "browser"
    webdavMode: "file", // "file" (single JSON) or "folder" (full folder sync)
    webdavFolderPath: "",
    webdavSyncConfig: true,
    webdavSyncWidgets: true,
    webdavSyncBackups: false,
    webdavSyncBackground: false,
    webdavConfigMode: "auto", // "auto" | "manual"
    webdavWidgetsMode: "auto", // "auto" | "manual"
    webdavBackupsMode: "auto", // "auto" | "manual"
    webdavBackgroundMode: "auto", // "auto" | "manual"
    authMode: "none", // "none" or "basic"
    username: "",
    password: "",
    encryptionMode: "none", // "none", "vault"
    enc: null,
    interval: DEFAULT_SYNC_INTERVAL, // milliseconds
    intervalMode: "immediate", // "immediate" | "manual"
    lastSync: 0,
    lastSyncedLocalHash: "",
    lastSyncedExtraHashes: {},
    lastSeenExtraUpdatedAt: {},
    webdavExtraConflicts: {},
    remoteChangeHeaderType: null, // null=unknown, false=unsupported, or 'sha256'|'etag'|'last-modified'
    lastSeenRemoteMarker: "",
    lastRemoteMarkerCheck: 0,
    lastMarkerCheckUrl: "", // serverUrl the remote marker was last checked against
    pendingPurgedIds: [],
    pausedReason: null,
    consecutiveErrors: 0,
    nextRetryAt: 0
  },
  housekeeper: {
    retentionDays: 30,
    autoCleanupEnabled: false,
    lastCleanup: 0,
    enableLinkCheck: false,
    lastLinkCheck: 0,
    iconAutoRefreshMode: "missing", // "all", "missing", "none"
    iconAutoRefreshHours: 24
  },
  backups: {
    retentionDays: 14,
    remoteRetentionDays: 14,
    frequencyHours: 24,
    lastAutoBackup: 0
  },
  appearance: {
    theme: "default", // "default", "spring", "summer", "autumn", "winter", "custom-file", "custom-url"
    customThemeCss: "",
    customThemeFileName: "",
    customThemeUrl: "",
    backgroundImage: null, // Base64 encoded image or null
    backgroundImageUrl: "",
    backgroundSize: "stretched", // "stretched", "fill", "fit", "tile", "center", "span"
    bgDim: 0, // Background dim overlay: 0 (none) to 0.9 (90% dark scrim)
    tileOpacity: 1, // Bookmark tile opacity: 0 (transparent) to 1 (opaque)
    barOpacity: 1, // Header & footer opacity: 0 (transparent) to 1 (opaque)
    tileSize: 1, // Bookmark tile scale: 0.5 (50%) to 1.5 (150%)
    groupTileSize: 1, // Group tile scale: 0.5 (50%) to 1.5 (150%)
    showDateTime: true,
    dateTimeSpace: "footer", // "disabled", "header", "left", "center", "right", "footer"
    showDeleted: false,
    showGroupBookmarkCount: true,
    showSideSpaces: false,
    highlightSideSpaces: false,
    tallBookmarkTiles: false,
    clickableTags: true,
    lockTiles: false,
    groupsSpace: "header", // "header", "left", "center", "right", "footer"
    searchSpace: "center", // "header", "left", "center", "right", "footer"
    manageSpace: "header", // "header", "left", "center", "right", "footer"
    syncStatusSpace: "footer", // "disabled", "header", "left", "center", "right", "footer"
    shortcutPaletteSpace: "footer", // "disabled", "header", "left", "center", "right", "footer"
    bookmarksCountSpace: "footer", // "disabled", "header", "left", "center", "right", "footer"
    storageUsageSpace: "disabled", // "disabled", "header", "left", "center", "right", "footer"
    headerSingleRow: true, // Force header widgets to stay on a single row
    searchStyle: "full", // "full", "icon", or "hover"
    widgetOrder: ["groups", "manage", "search", "bookmarks", "syncStatus", "dateTime", "bookmarksCount", "shortcutPalette", "storageUsage"],
    widgetAlign: {}, // Per-widget alignment: "auto" | "top" | "bottom" | "left" | "right" | "center"
    widgetNewRow: {}, // Per-widget row break flag: { [widgetKey]: boolean }
    customWidgets: [], // User-defined declarative widgets (e.g. custom search)
    customSearchAutoRouteDefaults: {}, // Per-group auto-route default flag: { [groupKey]: boolean }
    customSearchAutoRouteIcons: {}, // Per-group auto-route custom icon: { [groupKey]: string }
    defaultBookmarkIcon: null // Custom fallback icon data URL (max 128x128, <= 200 KB)
  },
  advanced: {
    faviconDebugLogging: false,
    deadLinkDebugLogging: false,
    syncDebugLogging: false,
    webdavDebugLogging: false,
    startupTimingDebugLogging: false,
    i18nHotReload: false,
    faviconFetchLink: false,
    faviconFetchManifest: false
  }
};

let cachedConfig = null;
let inFlightConfigLoad = null;

const debugFlags = {
  favicon: false,
  deadLink: false,
  sync: false,
  webdav: false,
  startupTiming: false
};
let debugModulePromise = null;

function getDebugModule() {
  if (!debugModulePromise) {
    debugModulePromise = import("./debug.js");
  }
  return debugModulePromise;
}

export function updateDebugLoggingFlags(advanced = {}) {
  debugFlags.favicon = Boolean(advanced?.faviconDebugLogging ?? advanced?.enableDebugLogging);
  debugFlags.deadLink = Boolean(advanced?.deadLinkDebugLogging ?? advanced?.enableDeadLinkDebugLogging);
  debugFlags.sync = Boolean(advanced?.syncDebugLogging);
  debugFlags.webdav = Boolean(advanced?.webdavDebugLogging);
  debugFlags.startupTiming = Boolean(advanced?.startupTimingDebugLogging);
  if (debugFlags.favicon || debugFlags.deadLink || debugFlags.sync || debugFlags.webdav || debugFlags.startupTiming) {
    void getDebugModule().then(mod => mod?.setDebugLoggingFlags?.(debugFlags));
  } else if (debugModulePromise) {
    void debugModulePromise.then(mod => mod?.setDebugLoggingFlags?.(debugFlags));
  }
}

export function logDebug(channel, ...args) {
  const flagKey = channel === "syncMergeDiff" ? "sync" : channel;
  const checkboxId = flagKey === "favicon"
    ? "enable-favicon-debug-logging"
    : flagKey === "deadLink"
      ? "enable-dead-link-debug-logging"
      : flagKey === "startupTiming"
        ? "enable-startup-timing-debug-logging"
        : flagKey === "webdav"
          ? "enable-webdav-debug-logging"
          : "enable-sync-debug-logging";
  const checkboxChecked = typeof document !== "undefined" && !!document.getElementById(checkboxId)?.checked;
  if (!debugFlags[flagKey] && !checkboxChecked) return;
  void getDebugModule().then(mod => {
    if (channel === "favicon") {
      mod.faviconDebugLog(...args);
    } else if (channel === "deadLink") {
      mod.deadLinkDebugLog(...args);
    } else if (channel === "startupTiming") {
      mod.startupTimingDebugLog?.(...args);
    } else if (channel === "webdav") {
      mod.setWebdavDebugLoggingEnabled?.(true);
      mod.webdavDebugLog?.(...args);
    } else if (channel === "syncMergeDiff") {
      mod.setSyncDebugLoggingEnabled?.(true);
      mod.syncMergeDiffDebugLog(...args);
    } else {
      mod.setSyncDebugLoggingEnabled?.(true);
      mod.syncDebugLog(...args);
    }
  });
}

const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function sanitizeParsedJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeParsedJson(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const clean = {};
  for (const key of Object.keys(value)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) continue;
    clean[key] = sanitizeParsedJson(value[key]);
  }
  return clean;
}

export function parseJsonSafely(text) {
  return sanitizeParsedJson(JSON.parse(text));
}

export function normalizeSyncIntervalMode(mode) {
  return mode === "manual" ? "manual" : "immediate";
}

function mergeConfigWithDefaults(stored) {
  if (!stored || typeof stored !== "object") {
    return structuredClone(defaultConfig);
  }
  const safeStored = sanitizeParsedJson(stored);
  const mergedSync = {
    ...defaultConfig.sync,
    ...(safeStored.sync || {})
  };
  mergedSync.intervalMode = normalizeSyncIntervalMode(mergedSync.intervalMode);
  return {
    ...defaultConfig,
    ...safeStored,
    sync: mergedSync,
    housekeeper: {
      ...defaultConfig.housekeeper,
      ...(safeStored.housekeeper || {})
    },
    backups: {
      ...defaultConfig.backups,
      ...(safeStored.backups || {})
    },
    appearance: {
      ...defaultConfig.appearance,
      ...(safeStored.appearance || {})
    },
    advanced: {
      ...defaultConfig.advanced,
      ...(safeStored.advanced || {})
    }
  };
}

export function invalidateConfigCache() {
  cachedConfig = null;
}

if (typeof chrome !== "undefined" && chrome?.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, CONFIG_STORAGE_KEY)) {
      const nextVal = changes[CONFIG_STORAGE_KEY]?.newValue;
      cachedConfig = nextVal ? mergeConfigWithDefaults(nextVal) : null;
    }
  });
}

function cloneConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  const bgImage = cfg.appearance?.backgroundImage;
  const customCss = cfg.appearance?.customThemeCss;
  const defaultIcon = cfg.appearance?.defaultBookmarkIcon;
  if (cfg.appearance) {
    cfg.appearance.backgroundImage = null;
    cfg.appearance.customThemeCss = "";
    cfg.appearance.defaultBookmarkIcon = null;
  }
  let cloned;
  try {
    cloned = structuredClone(cfg);
  } finally {
    if (cfg.appearance) {
      cfg.appearance.backgroundImage = bgImage;
      cfg.appearance.customThemeCss = customCss;
      cfg.appearance.defaultBookmarkIcon = defaultIcon;
    }
  }
  if (cloned.appearance) {
    cloned.appearance.backgroundImage = bgImage;
    cloned.appearance.customThemeCss = customCss;
    cloned.appearance.defaultBookmarkIcon = defaultIcon;
  }
  return cloned;
}

let configSaveGeneration = 0;

// Load configuration from storage
export async function loadConfig() {
  const canUseLongLivedCache = typeof chrome !== "undefined" && typeof chrome?.storage?.onChanged?.addListener === "function";
  if (canUseLongLivedCache && cachedConfig) {
    return cloneConfig(cachedConfig);
  }
  if (inFlightConfigLoad) {
    const resolved = await inFlightConfigLoad;
    return cloneConfig(resolved);
  }

  const loadGeneration = configSaveGeneration;
  inFlightConfigLoad = (async () => {
    const rawConfig = await getStorageValue(CONFIG_STORAGE_KEY);
    const merged = mergeConfigWithDefaults(rawConfig);
    updateDebugLoggingFlags(merged.advanced);
    if (canUseLongLivedCache && loadGeneration === configSaveGeneration) {
      cachedConfig = merged;
    }
    return cachedConfig && loadGeneration !== configSaveGeneration ? cloneConfig(cachedConfig) : merged;
  })();

  try {
    const resolved = await inFlightConfigLoad;
    return cloneConfig(resolved);
  } finally {
    inFlightConfigLoad = null;
  }
}

let configSaveQueue = Promise.resolve();

// Save configuration to storage
export function saveConfig(config) {
  const run = configSaveQueue.then(async () => {
    const normalized = mergeConfigWithDefaults(config);
    configSaveGeneration++;
    updateDebugLoggingFlags(normalized.advanced);
    const canUseCache = typeof chrome !== "undefined" && typeof chrome?.storage?.onChanged?.addListener === "function";
    const previousCachedConfig = cachedConfig;
    if (canUseCache) {
      cachedConfig = cloneConfig(normalized);
    }
    try {
      await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });
    } catch (err) {
      if (canUseCache) {
        cachedConfig = previousCachedConfig;
      }
      throw err;
    }
  });
  configSaveQueue = run.catch(() => {});
  return run;
}

// Get sync interval in milliseconds based on mode
export function getSyncIntervalMs(config) {
  const mode = normalizeSyncIntervalMode(config?.sync?.intervalMode);
  return mode === "manual" ? -1 : 0;
}

// Check if automatic sync should run
export function shouldSync(config) {
  return normalizeSyncIntervalMode(config?.sync?.intervalMode) === "immediate";
}

// Update last sync timestamp
export async function updateLastSyncTime(config) {
  config.sync.lastSync = Date.now();
  await saveConfig(config);
}
