import { state, saveState } from "./state.js";

function ensureNoTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

// ─────────────────────────────────────────────────────────────
//  CONFIG STORAGE
// ─────────────────────────────────────────────────────────────

export async function saveSyncConfig({ url }) {
  const normalized = ensureNoTrailingSlash(url.trim());
  await chrome.storage.local.set({ syncConfig: { url: normalized } });
}

export async function loadSyncConfig() {
  const { syncConfig } = await chrome.storage.local.get("syncConfig");
  if (!syncConfig) return null;
  return { url: ensureNoTrailingSlash(syncConfig.url) };
}

// ─────────────────────────────────────────────────────────────
//  TEST CONNECTION
// ─────────────────────────────────────────────────────────────

export async function testSyncConnection(url) {
  try {
    const endpoint = ensureNoTrailingSlash(url);

    const res = await fetch(endpoint, {
      method: "GET",
      cache: "no-cache"
    });

    // 200 OK → OK
    // 404 → OK (prázdny súbor)
    return res.ok || res.status === 404;
  } catch (e) {
    return false;
  }
}

export async function requestHostPermission(url) {
  const origin = url.replace(/\/+$/, "") + "/*";

  const granted = await chrome.permissions.request({
    origins: [origin]
  });

  return granted;
}

// ─────────────────────────────────────────────────────────────
//  INITIALIZE REMOTE FILE
// ─────────────────────────────────────────────────────────────

async function initializeRemote(url) {
  const defaultData = { groups: [] };

  try {
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(defaultData, null, 2)
    });
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

  const url = cfg.url;

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-cache"
    });

    if (res.status === 404) {
      console.warn("syncRead: 404 → initializing remote file");
      return await initializeRemote(url);
    }

    if (!res.ok) {
      console.warn("syncRead: server returned", res.status);
      return null;
    }

    const text = await res.text();

    if (!text.trim()) {
      console.warn("syncRead: empty file → initializing");
      return await initializeRemote(url);
    }

    try {
      const parsed = JSON.parse(text);
      return {
        groups: parsed.groups ?? []
      };
    } catch (e) {
      console.warn("syncRead: invalid JSON → initializing");
      return await initializeRemote(url);
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

  const url = cfg.url;

  try {
    await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ groups: state.groups }, null, 2)
    });
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
  setInterval(async () => {
    if (!state.sync.enabled) return;

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
    state.sync.lastSync = Date.now();
    await saveState();

    await syncWrite();

  }, 60000);
}
