// One-shot startup storage prefetch cache to coalesce initial chrome.storage.local.get calls.
const startupPrefetchValues = new Map();

export async function batchStorageGet(keys) {
  const uniqueKeys = Array.from(new Set((keys || []).filter(Boolean)));
  if (uniqueKeys.length === 0) return {};
  if (typeof chrome === "undefined" || !chrome?.storage?.local?.get) return {};

  try {
    const res = await chrome.storage.local.get(uniqueKeys);
    if (res && typeof res === "object") {
      const hasUnexpectedKey = Object.keys(res).some(key => !uniqueKeys.includes(key));
      if (!hasUnexpectedKey) {
        return res;
      }
    }
  } catch {
    // Fall back to per-key reads for mocks that only accept a single string key.
  }

  const entries = await Promise.all(
    uniqueKeys.map(async key => {
      try {
        const single = await chrome.storage.local.get(key);
        return [key, single?.[key]];
      } catch {
        return [key, undefined];
      }
    })
  );
  const merged = {};
  for (const [key, value] of entries) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

export async function prefetchStartupStorage(keys) {
  const uniqueKeys = Array.from(new Set((keys || []).filter(Boolean)));
  const data = await batchStorageGet(uniqueKeys);
  for (const key of uniqueKeys) {
    startupPrefetchValues.set(key, data[key]);
  }
  return data;
}

export function clearStartupStorageCache() {
  startupPrefetchValues.clear();
}

export async function getStorageValue(key) {
  if (startupPrefetchValues.has(key)) {
    const value = startupPrefetchValues.get(key);
    startupPrefetchValues.delete(key);
    return value;
  }
  const res = await chrome.storage.local.get(key);
  return res?.[key];
}
