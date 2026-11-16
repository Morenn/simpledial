// ======================================================
// CONFIGURATION MANAGEMENT
// ======================================================

export const DEFAULT_SYNC_INTERVAL = 60000; // 1 minute in milliseconds

const CONFIG_STORAGE_KEY = "myspeeddial-config";

export const defaultConfig = {
  browserBookmarksAutoSync: false,
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
    lastSync: 0,
    lastSyncedLocalHash: "",
    remoteChangeHeaderType: null, // null=unknown, false=unsupported, or 'sha256'|'etag'|'last-modified'
    lastSeenRemoteMarker: "",
    lastRemoteMarkerCheck: 0,
    lastMarkerCheckUrl: "", // serverUrl the remote marker was last checked against
    pendingPurgedIds: []
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
    searchSpace: "header", // "header", "left", "center", "right", "footer"
    manageSpace: "header", // "header", "left", "center", "right", "footer"
    syncStatusSpace: "footer", // "disabled", "header", "left", "center", "right", "footer"
    bookmarksCountSpace: "footer", // "disabled", "header", "left", "center", "right", "footer"
    headerSingleRow: true, // Force header widgets to stay on a single row
    searchStyle: "full", // "full", "icon", or "hover"
    widgetOrder: ["groups", "search", "manage", "bookmarks", "syncStatus", "dateTime", "bookmarksCount"],
    widgetAlign: {}, // Per-widget alignment: "auto" | "top" | "bottom" | "left" | "right" | "center"
    widgetNewRow: {}, // Per-widget row break flag: { [widgetKey]: boolean }
    customWidgets: [], // User-defined declarative widgets (e.g. custom search)
    customSearchAutoRouteDefaults: {}, // Per-group auto-route default flag: { [groupKey]: boolean }
    customSearchAutoRouteIcons: {} // Per-group auto-route custom icon: { [groupKey]: string }
  },
  advanced: {
    faviconDebugLogging: false,
    deadLinkDebugLogging: false,
    syncDebugLogging: false,
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
