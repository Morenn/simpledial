// ======================================================
// CONFIGURATION MANAGEMENT
// ======================================================

export const DEFAULT_SYNC_INTERVAL = 60000; // 1 minute in milliseconds

const CONFIG_STORAGE_KEY = "myspeeddial-config";

export const defaultConfig = {
  sync: {
    enabled: false,
    serverUrl: "",
    type: "direct", // "direct", "webdav" or "browser"
    authMode: "none", // "none" or "basic"
    username: "",
    password: "",
    encryptionMode: "none", // "none","master","local"
    localKey: "",
    enc: null,
    interval: DEFAULT_SYNC_INTERVAL, // milliseconds
    intervalMode: "default", // "immediate", "custom", "manual", "default"
    lastSync: 0
  },
  housekeeper: {
    retentionDays: 30,
    autoCleanupEnabled: false,
    lastCleanup: 0,
    enableLinkCheck: false,
    highlightDeadLinks: true,
    lastLinkCheck: 0,
    iconAutoRefreshMode: "missing", // "all", "missing", "none"
    iconAutoRefreshHours: 24
  },
  backups: {
    retentionDays: 30,
    frequencyHours: 24,
    lastAutoBackup: 0
  },
  appearance: {
    backgroundImage: null, // Base64 encoded image or null
    backgroundSize: "stretched", // "stretched", "fill", "fit", "tile", "center", "span"
    tileOpacity: 1, // Bookmark tile opacity: 0 (transparent) to 1 (opaque)
    showDateTime: true,
    showDeleted: false
  },
  advanced: {
    faviconDebugLogging: false,
    deadLinkDebugLogging: false,
    i18nHotReload: false,
    faviconFetchLink: false,
    faviconFetchManifest: false
  }
};

// Load configuration from storage
export async function loadConfig() {
  const res = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
  const stored = res[CONFIG_STORAGE_KEY];

  if (stored) {
    // Merge with defaults to ensure new fields are present
    return {
      ...defaultConfig,
      ...stored,
      sync: {
        ...defaultConfig.sync,
        ...(stored.sync || {})
      },
      housekeeper: {
        ...defaultConfig.housekeeper,
        ...(stored.housekeeper || {})
      },
      backups: {
        ...defaultConfig.backups,
        ...(stored.backups || {})
      },
      appearance: {
        ...defaultConfig.appearance,
        ...(stored.appearance || {})
      },
      advanced: {
        ...defaultConfig.advanced,
        ...(stored.advanced || {})
      }
    };
  }

  return JSON.parse(JSON.stringify(defaultConfig));
}

// Save configuration to storage
export async function saveConfig(config) {
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });
}

// Get sync interval in milliseconds based on mode
export function getSyncIntervalMs(config) {
  const mode = config.sync.intervalMode || "default";

  if (mode === "immediate") {
    return 0; // Sync immediately after each change
  } else if (mode === "custom") {
    return (config.sync.customIntervalMinutes || 60) * 60000;
  } else if (mode === "manual") {
    return -1; // Never auto-sync
  } else {
    // "default" mode
    return DEFAULT_SYNC_INTERVAL; // 1 minute
  }
}

// Check if enough time has passed since last sync
export function shouldSync(config) {
  const mode = config.sync.intervalMode || "default";

  if (mode === "manual") {
    return false; // Never auto-sync
  }

  if (mode === "immediate") {
    return true; // Always sync
  }

  const interval = getSyncIntervalMs(config);
  const timeSinceLastSync = Date.now() - config.sync.lastSync;

  return timeSinceLastSync >= interval;
}

// Update last sync timestamp
export async function updateLastSyncTime(config) {
  config.sync.lastSync = Date.now();
  await saveConfig(config);
}
