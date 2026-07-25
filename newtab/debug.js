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