export const STORAGE_LIMITS = {
  localBytes: 10 * 1024 * 1024, // 10 MB standard MV3 chrome.storage.local quota
  syncBytes: 100 * 1024,        // 100 KB chrome.storage.sync quota
  localStorageBytes: 5 * 1024 * 1024 // ~5 MB per-origin localStorage quota
};

export function formatStorageBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function measureJsonByteSize(value) {
  try {
    const str = JSON.stringify(value);
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(str).length;
    }
    return str.length;
  } catch {
    return 0;
  }
}

function categorizeLocalStorageKey(key) {
  if (key === "myspeeddial-data" || key === "myspeeddial-bookmarks") return "bookmarks";
  if (key === "myspeeddial-config" || key === "myspeeddial-active-group" || key === "myspeeddial-theme") return "config";
  if (key.startsWith("myspeeddial-backups") || key.startsWith("myspeeddial-webdav-backup")) return "backups";
  if (key.includes("background-image") || key.includes("custom-theme")) return "themeCache";
  if (key === "myspeeddial-widget-notes" || key === "myspeeddial-notes") return "notes";
  if (key.startsWith("myspeeddial-rss")) return "rss";
  if (key === "myspeeddial-weather-cache") return "weather";
  if (key === "myspeeddial-system-tags") return "systemTags";
  return "other";
}

async function getAreaBytesInUse(area) {
  if (!area) return null;
  if (typeof area.getBytesInUse === "function") {
    try {
      const bytes = await area.getBytesInUse(null);
      if (Number.isFinite(bytes)) return bytes;
    } catch {
      // Fallback below (e.g. Firefox)
    }
  }
  return null;
}

export async function measureAddonStorageUsage() {
  const categories = {
    bookmarks: 0,
    config: 0,
    backups: 0,
    themeCache: 0,
    notes: 0,
    rss: 0,
    weather: 0,
    systemTags: 0,
    other: 0
  };

  let localTotalBytes = 0;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const allLocal = await chrome.storage.local.get(null);
      for (const [key, val] of Object.entries(allLocal || {})) {
        const size = measureJsonByteSize(key) + measureJsonByteSize(val);
        categories[categorizeLocalStorageKey(key)] += size;
        localTotalBytes += size;
      }
    } catch {
      // ignore
    }
    const exactLocal = await getAreaBytesInUse(chrome.storage.local);
    if (exactLocal !== null) {
      localTotalBytes = exactLocal;
    }
  }

  let webLocalStorageBytes = 0;
  if (typeof localStorage !== "undefined") {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const v = localStorage.getItem(k) || "";
        webLocalStorageBytes += (k.length + v.length) * 2;
      }
    } catch {
      // ignore
    }
  }

  let syncBytes = 0;
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    const exactSync = await getAreaBytesInUse(chrome.storage.sync);
    if (exactSync !== null) {
      syncBytes = exactSync;
    } else {
      try {
        const allSync = await chrome.storage.sync.get(null);
        for (const [key, val] of Object.entries(allSync || {})) {
          syncBytes += measureJsonByteSize(key) + measureJsonByteSize(val);
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    localBytes: localTotalBytes,
    localLimitBytes: STORAGE_LIMITS.localBytes,
    localStorageBytes: webLocalStorageBytes,
    localStorageLimitBytes: STORAGE_LIMITS.localStorageBytes,
    syncBytes,
    syncLimitBytes: STORAGE_LIMITS.syncBytes,
    categories
  };
}

export async function updateStorageUsageWidget(el = null) {
  const target = el || (typeof document !== "undefined" ? document.getElementById("footer-storage-usage") : null);
  if (!target) return;
  const stats = await measureAddonStorageUsage();
  const pct = Math.min(100, Math.round((stats.localBytes / stats.localLimitBytes) * 100));
  target.textContent = `💾 ${formatStorageBytes(stats.localBytes)} (${pct}%)`;
  target.title = `Extension storage: ${formatStorageBytes(stats.localBytes)} / ${formatStorageBytes(stats.localLimitBytes)} • Icon cache: ${formatStorageBytes(stats.localStorageBytes)}`;
}
