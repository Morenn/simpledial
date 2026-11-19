// debug.js
// ─────────────────────────────────────────────────────────────
//  SHARED DEBUG LOGGING
// ─────────────────────────────────────────────────────────────

export function isDeadLinkDebugEnabled() {
  return document.getElementById("enable-dead-link-debug-logging")?.checked ?? false;
}

export function isFaviconDebugEnabled() {
  return document.getElementById("enable-favicon-debug-logging")?.checked ?? false;
}

let cachedSyncDebugEnabled = false;

export function setSyncDebugLoggingEnabled(enabled) {
  cachedSyncDebugEnabled = !!enabled;
}

export function isSyncDebugEnabled() {
  const checkbox = typeof document !== "undefined" ? document.getElementById("enable-sync-debug-logging") : null;
  if (checkbox?.checked) return true;
  return cachedSyncDebugEnabled;
}

export function deadLinkDebugLog(...args) {
  if (isDeadLinkDebugEnabled()) {
    console.log('%c[dead-link]', 'color: #f44336; font-weight: bold', ...args);
  }
}

export function faviconDebugLog(...args) {
  if (isFaviconDebugEnabled()) {
    console.log('%c[favicon]', 'color: #4a6bff; font-weight: bold', ...args);
  }
}

export function syncDebugLog(...args) {
  if (isSyncDebugEnabled()) {
    console.log('%c[sync]', 'color: #4caf50; font-weight: bold', ...args);
  }
}

function stableSerializeForDebug(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeForDebug).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableSerializeForDebug(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function findFirstStateDiff(prevGroups = [], nextGroups = [], prevTags = [], nextTags = []) {
  if (stableSerializeForDebug(prevTags) !== stableSerializeForDebug(nextTags)) {
    return { kind: "tags", prevCount: prevTags.length, nextCount: nextTags.length };
  }
  const maxG = Math.max(prevGroups.length, nextGroups.length);
  for (let gi = 0; gi < maxG; gi++) {
    const pg = prevGroups[gi];
    const ng = nextGroups[gi];
    if (stableSerializeForDebug(pg) === stableSerializeForDebug(ng)) continue;
    if (!pg || !ng || pg.id !== ng.id) {
      return { kind: "group-mismatch", index: gi, prevId: pg?.id, nextId: ng?.id };
    }
    const pItems = pg.items || [];
    const nItems = ng.items || [];
    const maxI = Math.max(pItems.length, nItems.length);
    for (let ii = 0; ii < maxI; ii++) {
      if (stableSerializeForDebug(pItems[ii]) !== stableSerializeForDebug(nItems[ii])) {
        return {
          kind: "item-diff",
          groupId: pg.id,
          itemIndex: ii,
          prev: pItems[ii],
          next: nItems[ii]
        };
      }
    }
    return {
      kind: "group-field-diff",
      groupId: pg.id,
      prevKeys: Object.keys(pg),
      nextKeys: Object.keys(ng)
    };
  }
  return null;
}

export function syncMergeDiffDebugLog(prevGroups, nextGroups, prevTags, nextTags, summary = {}) {
  if (!isSyncDebugEnabled()) return;
  const firstDiff = summary.changed
    ? findFirstStateDiff(prevGroups, nextGroups, prevTags, nextTags)
    : null;
  syncDebugLog("mergeAndWriteAtomically diff", { ...summary, firstDiff });
}