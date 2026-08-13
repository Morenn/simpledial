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

export function isSyncDebugEnabled() {
  return document.getElementById("enable-sync-debug-logging")?.checked ?? false;
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