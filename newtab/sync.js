import { state, saveState } from "./state.js";
import { loadConfig, saveConfig, shouldSync, updateLastSyncTime } from "./config.js";
import { importRawKey, deriveKeyFromPassword, decryptWithKey } from './crypto.js';

function ensureNoTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function normalizeWebdavUrl(url) {
  if (typeof url !== 'string') {
    return url;
  }

  if (url.startsWith('davs://')) {
    return 'https://' + url.slice(7);
  }

  if (url.startsWith('dav://')) {
    return 'http://' + url.slice(6);
  }

  return url;
}

function getSyncFetchUrl(url, type) {
  const normalized = ensureNoTrailingSlash((url || "").trim());
  return type === 'webdav' ? normalizeWebdavUrl(normalized) : normalized;
}

// ─────────────────────────────────────────────────────────────
//  FETCH WITH TIMEOUT
// ─────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
//  CONFIG STORAGE (DEPRECATED - use config.js)
// ─────────────────────────────────────────────────────────────

export async function saveSyncConfig({ url, type, username, password }) {
  const config = await loadConfig();
  config.sync.serverUrl = ensureNoTrailingSlash((url || "").trim());
  if (type) config.sync.type = type;
  if (typeof username !== 'undefined') config.sync.username = username;
  if (typeof password !== 'undefined') config.sync.password = password;
  await saveConfig(config);
}

const CLOUD_STORAGE_KEY = "myspeeddial-data";

export async function loadSyncConfig() {
  const config = await loadConfig();
  if (!config.sync.serverUrl && config.sync.type !== 'browser') return null;
  return {
    url: config.sync.serverUrl,
    type: config.sync.type || 'direct',
    webdavType: config.sync.webdavType || 'generic',
    username: config.sync.username || '',
    password: config.sync.password || '',
    authMode: config.sync.authMode || (config.sync.password ? 'basic' : 'none'),
    encryptionMode: config.sync.encryptionMode || 'none',
    enc: config.sync.enc || null,
    localKey: config.sync.localKey || null
  };
}

// ─────────────────────────────────────────────────────────────
//  TEST CONNECTION
// ─────────────────────────────────────────────────────────────

export async function testSyncConnection(url, username = '', password = '', type = 'direct') {
  try {
    const endpoint = getSyncFetchUrl(url, type);

    const headers = {};
    if (password) headers['Authorization'] = 'Basic ' + btoa(`${username}:${password}`);

    const res = await fetchWithTimeout(endpoint, {
      method: "GET",
      cache: "no-cache",
      headers
    });

    return res.ok || res.status === 404;
  } catch (e) {
    return false;
  }
}

export async function requestHostPermission(url, type = 'direct') {
  const normalizedUrl = getSyncFetchUrl(url, type);

  try {
    const parsed = new URL(normalizedUrl);
    const origin = `${parsed.protocol}//${parsed.host}/*`;
    const granted = await chrome.permissions.request({
      origins: [origin]
    });
    return granted;
  } catch (e) {
    console.warn('requestHostPermission: invalid URL', normalizedUrl, e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
//  INITIALIZE REMOTE FILE
// ─────────────────────────────────────────────────────────────

async function initializeRemote(url, headers = {}) {
  const defaultData = { groups: [] };

  try {
    const res = await fetchWithTimeout(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(defaultData, null, 2)
    });

    if (!res.ok) {
      console.warn(`initializeRemote failed: ${res.status} ${res.statusText} for ${url}`);
    }
  } catch (e) {
    console.log("initializeRemote failed", e);
  }

  return defaultData;
}

// ─────────────────────────────────────────────────────────────
//  READ
// ─────────────────────────────────────────────────────────────

export async function syncRead() {
  const cfg = await loadSyncConfig();
  if (!cfg) return null;

  if (cfg.type === 'browser') {
    try {
      const result = await chrome.storage.sync.get(CLOUD_STORAGE_KEY);
      const stored = result[CLOUD_STORAGE_KEY];
      return {
        groups: (stored && stored.groups) ? stored.groups : []
      };
    } catch (e) {
      console.error('syncRead(browser) failed', e);
      return null;
    }
  }

  const url = cfg.url;
  const fetchUrl = getSyncFetchUrl(url, cfg.type);
  // Attempt to obtain credentials depending on encryption mode
  let username = cfg.username || '';
  let password = cfg.password || '';
  try {
    if (cfg.authMode === 'basic') {
      if (cfg.encryptionMode === 'local' && cfg.localKey && cfg.enc) {
        const key = await importRawKey(cfg.localKey);
        const plain = await decryptWithKey(key, cfg.enc.ciphertext, cfg.enc.iv);
        const obj = JSON.parse(plain);
        username = obj.username || '';
        password = obj.password || '';
      } else if (cfg.encryptionMode === 'master' && cfg.enc) {
        if (window._speeddial_masterKey) {
          try {
            const plain = await decryptWithKey(window._speeddial_masterKey, cfg.enc.ciphertext, cfg.enc.iv);
            const obj = JSON.parse(plain);
            username = obj.username || '';
            password = obj.password || '';
          } catch (e) {
            console.warn('Cannot decrypt master-encrypted credentials without master key');
          }
        }
      }
    }
  } catch (e) {
    console.warn('Error while decrypting credentials for syncRead', e);
  }
  const auth = cfg.password ? { username: cfg.username || '', password: cfg.password } : null;

  try {
    const headers = {};
    const credUser = username || (auth ? auth.username : '');
    const credPass = password || (auth ? auth.password : '');
    if (credPass) headers['Authorization'] = 'Basic ' + btoa(`${credUser}:${credPass}`);


    const res = await fetchWithTimeout(fetchUrl, {
      method: "GET",
      cache: "no-cache",
      headers
    });

    if (res.status === 404) {
      console.warn("syncRead: 404 → initializing remote file");
      return await initializeRemote(fetchUrl, headers);
    }

    if (!res.ok) {
      console.warn("syncRead: server returned", res.status);
      return null;
    }

    const text = await res.text();

    if (!text.trim()) {
      console.warn("syncRead: empty file → initializing");
      return await initializeRemote(fetchUrl, headers);
    }

    try {
      const parsed = JSON.parse(text);
      return {
        groups: parsed.groups ?? []
      };
    } catch (e) {
      console.warn("syncRead: invalid JSON → initializing");
      return await initializeRemote(url, headers);
    }

  } catch (e) {
    console.log("fetch failed (syncRead)", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  WRITE
// ─────────────────────────────────────────────────────────────

export async function syncWrite() {
  const cfg = await loadSyncConfig();
  if (!cfg) return;

  if (cfg.type === 'browser') {
    try {
      await chrome.storage.sync.set({ [CLOUD_STORAGE_KEY]: { groups: state.groups } });
    } catch (e) {
      console.error('syncWrite(browser) failed', e);
    }
    return;
  }

  const url = cfg.url;
  const fetchUrl = getSyncFetchUrl(url, cfg.type);

  // Attempt to obtain credentials depending on encryption mode
  let username = cfg.username || '';
  let password = cfg.password || '';
  try {
    if (cfg.authMode === 'basic') {
      if (cfg.encryptionMode === 'local' && cfg.localKey && cfg.enc) {
        const key = await importRawKey(cfg.localKey);
        const plain = await decryptWithKey(key, cfg.enc.ciphertext, cfg.enc.iv);
        const obj = JSON.parse(plain);
        username = obj.username || '';
        password = obj.password || '';
      } else if (cfg.encryptionMode === 'master' && cfg.enc) {
        if (window._speeddial_masterKey) {
          try {
            const plain = await decryptWithKey(window._speeddial_masterKey, cfg.enc.ciphertext, cfg.enc.iv);
            const obj = JSON.parse(plain);
            username = obj.username || '';
            password = obj.password || '';
          } catch (e) {
            console.warn('Cannot decrypt master-encrypted credentials without master key');
          }
        }
      }
    }
  } catch (e) {
    console.warn('Error while decrypting credentials for syncWrite', e);
  }

  const credUser = username || (cfg.username || '');
  const credPass = password || (cfg.password || '');

  try {
    const headers = { "Content-Type": "application/json" };
    if (credPass) headers['Authorization'] = 'Basic ' + btoa(`${credUser}:${credPass}`);

    const res = await fetchWithTimeout(fetchUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({ groups: state.groups }, null, 2)
    });

    if (!res.ok) {
      console.warn(`syncWrite failed: ${res.status} ${res.statusText} for ${fetchUrl}`);
    }
  } catch (e) {
    console.log("fetch failed (syncWrite)", e);
  }
}

// ─────────────────────────────────────────────────────────────
//  MERGE ITEMS
// ─────────────────────────────────────────────────────────────

function mergeItems(localItems, cloudItems) {
  const result = {};
  const localMap = Object.fromEntries(localItems.map(i => [i.id, i]));
  const cloudMap = Object.fromEntries(cloudItems.map(i => [i.id, i]));

  const allIds = new Set([...Object.keys(localMap), ...Object.keys(cloudMap)]);

  for (const id of allIds) {
    const local = localMap[id];
    const cloud = cloudMap[id];

    if (local && !cloud) {
      result[id] = local;
      continue;
    }

    if (!local && cloud) {
      result[id] = cloud;
      continue;
    }

    if (local && cloud) {
      if (local.deleted && cloud.deleted) {
        result[id] = (local.deletedAt > cloud.deletedAt) ? local : cloud;
        continue;
      }

      if (cloud.deleted) {
        result[id] = (cloud.deletedAt > local.updatedAt) ? cloud : local;
        continue;
      }

      if (local.deleted) {
        result[id] = (local.deletedAt > cloud.updatedAt) ? local : cloud;
        continue;
      }

      result[id] = (local.updatedAt > cloud.updatedAt) ? local : cloud;
    }
  }

  return Object.values(result);
}

// ─────────────────────────────────────────────────────────────
//  PERIODIC SYNC
// ─────────────────────────────────────────────────────────────

export function startSyncLoop() {
  let syncLoopInterval = null;

  const runSyncLoop = async () => {
    const config = await loadConfig();

    if (!config.sync.enabled) {
      // Stop sync loop if disabled
      if (syncLoopInterval) {
        clearInterval(syncLoopInterval);
        syncLoopInterval = null;
      }
      return;
    }

    // Check if we should sync based on interval configuration
    if (!shouldSync(config)) {
      return;
    }

    const cloud = await syncRead();
    if (!cloud) return;

    const mergedGroups = state.groups.map(localGroup => {
      const cloudGroup = cloud.groups.find(g => g.id === localGroup.id);

      if (!cloudGroup) return localGroup;

      return {
        ...localGroup,
        items: mergeItems(localGroup.items, cloudGroup.items)
      };
    });

    state.groups = mergedGroups;
    await saveState();

    // Update last sync time in config
    await updateLastSyncTime(config);

    await syncWrite();
  };

  // Run sync loop every 10 seconds to check if sync is needed
  // This allows for flexible interval configuration without restarting the interval
  syncLoopInterval = setInterval(runSyncLoop, 10000);
  
  // Run once immediately on startup
  runSyncLoop();
}

// ─────────────────────────────────────────────────────────────
//  MANUAL SYNC
// ─────────────────────────────────────────────────────────────

export async function syncNow() {
  const config = await loadConfig();

  if (!config.sync.enabled || (!config.sync.serverUrl && config.sync.type !== 'browser')) {
    console.warn("Sync not configured or disabled");
    return false;
  }

  const cloud = await syncRead();
  if (!cloud) {
    console.warn("Failed to read from sync server");
    return false;
  }

  const mergedGroups = state.groups.map(localGroup => {
    const cloudGroup = cloud.groups.find(g => g.id === localGroup.id);

    if (!cloudGroup) return localGroup;

    return {
      ...localGroup,
      items: mergeItems(localGroup.items, cloudGroup.items)
    };
  });

  state.groups = mergedGroups;
  await saveState();

  // Update last sync time in config
  await updateLastSyncTime(config);

  await syncWrite();

  return true;
}

// ─────────────────────────────────────────────────────────────
//  HOUSEKEEPING - CLEANUP DELETED ITEMS
// ─────────────────────────────────────────────────────────────

export async function cleanupDeletedItems(retentionDays) {
  let deletedCount = 0;
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  for (const group of state.groups) {
    // Filter out permanently deleted items
    const originalLength = group.items.length;
    group.items = group.items.filter(item => {
      if (item.deleted && item.deletedAt && item.deletedAt < cutoffTime) {
        deletedCount++;
        return false; // Remove this item
      }
      return true;
    });

    if (group.items.length < originalLength) {
      group.updatedAt = Date.now();
    }
  }

  if (deletedCount > 0) {
    await saveState();
    await syncWrite();
  }

  return deletedCount;
}

// ─────────────────────────────────────────────────────────────
//  HOUSEKEEPING - LINK VALIDATION
// ─────────────────────────────────────────────────────────────

async function validateLink(url, timeoutMs = 2000) {
  try {
    const response = await fetchWithTimeout(url, {
      method: "HEAD",
      cache: "no-cache"
      // Removed mode: "no-cors" to allow proper status code checking
    }, timeoutMs);

    // Mark as dead if status code is 400-599 (client/server errors)
    // Accept 2xx and 3xx (success and redirects)
    if (response.status >= 400 && response.status < 600) {
      return false; // Dead link
    }

    return true; // Link is working
  } catch (error) {
    // Network error, timeout, or CORS error
    // Only mark as dead if it's a real network error, not CORS
    if (error.name === "AbortError") {
      return false; // Timeout = dead link
    }
    // For other errors (CORS, etc), assume link is working to avoid false positives
    return true;
  }
}

export async function validateSingleLink(url) {
  return await validateLink(url);
}

export async function checkDeadLinks() {
  let newlyDetectedDead = 0;
  let changed = false;
  const urlsToCheck = [];

  // Collect all items with URLs to check
  for (const group of state.groups) {
    for (const item of group.items) {
      if (!item.deleted && item.url) {
        urlsToCheck.push({ item, url: item.url });
      }
    }
  }

  // Check links with reasonable parallelism (max 5 concurrent)
  for (let i = 0; i < urlsToCheck.length; i += 5) {
    const batch = urlsToCheck.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(({ item, url }) => validateLink(url))
    );

    results.forEach((isValid, index) => {
      const itemData = batch[index].item;
      const hasError = !isValid;

      if (itemData.hasError !== hasError) {
        itemData.hasError = hasError;
        itemData.updatedAt = Date.now();
        changed = true;
        if (hasError) newlyDetectedDead++;
      }
    });
  }

  // Compute total dead links now (after applying changes)
  const totalDead = state.groups.reduce((sum, g) => {
    return sum + (g.items ? g.items.filter(i => i.hasError).length : 0);
  }, 0);

  if (changed) {
    // Update groups timestamp
    for (const group of state.groups) {
      if (group.items && group.items.some(item => item.hasError)) {
        group.updatedAt = Date.now();
      }
    }

    await saveState();
    await syncWrite();
  }

  // Return the total number of dead links (consistent with stored state)
  return totalDead;
}

