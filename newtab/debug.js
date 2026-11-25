// debug.js
// ─────────────────────────────────────────────────────────────
//  SHARED DEBUG LOGGING
// ─────────────────────────────────────────────────────────────

let cachedDeadLinkDebugEnabled = false;
let cachedFaviconDebugEnabled = false;
let cachedSyncDebugEnabled = false;
let cachedWebdavDebugEnabled = false;

export function setDebugLoggingFlags(flags = {}) {
  if ("favicon" in flags) cachedFaviconDebugEnabled = !!flags.favicon;
  if ("deadLink" in flags) cachedDeadLinkDebugEnabled = !!flags.deadLink;
  if ("sync" in flags) cachedSyncDebugEnabled = !!flags.sync;
  if ("webdav" in flags) cachedWebdavDebugEnabled = !!flags.webdav;
}

export function isDeadLinkDebugEnabled() {
  const checkbox = typeof document !== "undefined" ? document.getElementById("enable-dead-link-debug-logging") : null;
  if (checkbox?.checked) return true;
  return cachedDeadLinkDebugEnabled;
}

export function isFaviconDebugEnabled() {
  const checkbox = typeof document !== "undefined" ? document.getElementById("enable-favicon-debug-logging") : null;
  if (checkbox?.checked) return true;
  return cachedFaviconDebugEnabled;
}

export function setSyncDebugLoggingEnabled(enabled) {
  cachedSyncDebugEnabled = !!enabled;
}

export function isSyncDebugEnabled() {
  const checkbox = typeof document !== "undefined" ? document.getElementById("enable-sync-debug-logging") : null;
  if (checkbox?.checked) return true;
  return cachedSyncDebugEnabled;
}

export function setWebdavDebugLoggingEnabled(enabled) {
  cachedWebdavDebugEnabled = !!enabled;
}

export function isWebdavDebugEnabled() {
  const checkbox = typeof document !== "undefined" ? document.getElementById("enable-webdav-debug-logging") : null;
  if (checkbox?.checked) return true;
  return cachedWebdavDebugEnabled;
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

export function webdavDebugLog(...args) {
  if (isWebdavDebugEnabled()) {
    console.log('%c[webdav]', 'color: #00bcd4; font-weight: bold', ...args);
  }
}

export function startupTimingDebugLog(metrics) {
  console.info('%c[startup-timing]', 'color: #ff9800; font-weight: bold', metrics);
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