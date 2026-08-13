import { state, saveState } from "./state.js";
import { loadConfig, saveConfig, shouldSync, updateLastSyncTime } from "./config.js";
import { importRawKey, deriveKeyFromPassword, decryptWithKey } from './crypto.js';
import { deadLinkDebugLog, syncDebugLog } from "./debug.js";

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

const AUTH_REDIRECT_TAB_COOLDOWN_MS = 60 * 1000;
let lastAuthRedirect = { url: '', timestamp: 0 };
let logonCount = 0;

export function resetLogonCount() {
  logonCount = 0;
}

function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/$/, '');
    return `${parsed.origin}${normalizedPath}${parsed.search}`;
  } catch {
    return String(url || '').trim();
  }
}

async function maybeOpenAuthRedirectTab(redirectUrl) {
  if (!redirectUrl) return false;

  if (logonCount >= 1) return false;

  const now = Date.now();
  const normalized = normalizeComparableUrl(redirectUrl);
  if (normalized === lastAuthRedirect.url && (now - lastAuthRedirect.timestamp) < AUTH_REDIRECT_TAB_COOLDOWN_MS) {
    return false;
  }

  lastAuthRedirect = { url: normalized, timestamp: now };
  logonCount++;

  try {
    if (chrome?.tabs?.create) {
      const created = await new Promise(resolve => {
        try {
          chrome.tabs.create({ url: redirectUrl }, () => {
            resolve(!chrome.runtime?.lastError);
          });
        } catch {
          resolve(false);
        }
      });
      if (created) {
        return true;
      }
    }
  } catch (e) {
    console.warn('Unable to open auth redirect in browser tab via chrome.tabs.create', e);
  }

  try {
    const winRef = window.open(redirectUrl, '_blank', 'noopener,noreferrer');
    return !!winRef;
  } catch (e) {
    console.warn('Unable to open auth redirect in browser tab via window.open', e);
    return false;
  }
}

function getAuthRedirectInfo(requestUrl, response) {
  if (!response?.redirected || !response?.url) {
    return null;
  }

  const requestNormalized = normalizeComparableUrl(requestUrl);
  const responseNormalized = normalizeComparableUrl(response.url);
  if (requestNormalized === responseNormalized) {
    return null;
  }

  const contentType = (response.headers?.get('content-type') || '').toLowerCase();
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
  if (!isHtml) {
    return null;
  }

  return {
    reason: 'auth-redirect',
    redirectUrl: response.url,
    status: response.status
  };
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const REMOTE_MARKER_HEADERS = {
  sha256: 'X-JSON-SHA256',
  etag: 'ETag',
  'last-modified': 'Last-Modified'
};
const REMOTE_MARKER_TYPES = ['sha256', 'etag', 'last-modified'];

function isValidRemoteMarker(type, value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const trimmed = value.trim();
  if (type === 'sha256') return /^[a-fA-F0-9]{64}$/.test(trimmed);
  if (type === 'etag') return trimmed.length > 0;
  if (type === 'last-modified') return !Number.isNaN(Date.parse(trimmed));
  return false;
}

// Marker capability is scoped to a specific backend; a new/changed URL
// must be re-probed rather than inheriting a stale supported/unsupported verdict.
function resetRemoteMarkerStateIfUrlChanged(config) {
  const currentKey = `${config.sync.type || 'direct'}::${config.sync.serverUrl || ''}`;
  if (config.sync.lastMarkerCheckUrl === currentKey) {
    return false;
  }

  syncDebugLog('backend URL changed, resetting remote-marker state', {
    previousUrl: config.sync.lastMarkerCheckUrl,
    currentUrl: currentKey
  });

  config.sync.remoteChangeHeaderType = null;
  config.sync.lastSeenRemoteMarker = '';
  config.sync.lastRemoteMarkerCheck = 0;
  config.sync.lastMarkerCheckUrl = currentKey;
  return true;
}

function logRemoteMarkerCapabilityChange(config, nowType) {
  const previous = config.sync.remoteChangeHeaderType;
  if (previous === nowType) return;

  syncDebugLog(
    nowType ? `remote change marker ACTIVATED (${nowType})` : 'remote change marker DEACTIVATED',
    { previous, nowType }
  );
}

// Probes HEAD/GET responses for a usable change-marker header, trying the
// previously-successful type first so steady-state checks stay cheap.
async function getRemoteChangeMarker(cfg, options = {}) {
  const { allowFallback = true, preferredType = null } = options;
  const resolvedCfg = cfg || await loadSyncConfig();
  if (!resolvedCfg || resolvedCfg.type === 'browser') {
    return null;
  }

  const url = getSyncFetchUrl(resolvedCfg.url, resolvedCfg.type);
  const credentials = await resolveSyncCredentials(resolvedCfg, 'syncRead');
  if (!credentials.ok) {
    return null;
  }

  const headers = {};
  applyWebdavCompatibilityHeaders(headers, resolvedCfg);
  const credUser = credentials.username || '';
  const credPass = credentials.password || '';
  if (credPass) {
    headers['Authorization'] = safeBasicAuthHeader(credUser, credPass);
  }

  // Extra request headers (auth, webdav compat) turn this into a preflighted
  // request, which some backends handle differently for Expose-Headers.
  syncDebugLog('marker probe request headers', {
    url,
    sentHeaderNames: Object.keys(headers),
    willPreflight: Object.keys(headers).length > 0
  });

  const typesToTry = preferredType
    ? [preferredType, ...REMOTE_MARKER_TYPES.filter(t => t !== preferredType)]
    : REMOTE_MARKER_TYPES;

  const attempts = [
    { method: 'HEAD', cache: 'no-store' },
    ...(allowFallback ? [{ method: 'GET', cache: 'no-store' }] : [])
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(url, {
        method: attempt.method,
        cache: attempt.cache,
        headers
      }, 5000);

      if (!res.ok) {
        syncDebugLog(`marker probe ${attempt.method} failed`, { status: res.status });
        continue;
      }

      for (const type of typesToTry) {
        const raw = res.headers.get(REMOTE_MARKER_HEADERS[type]);
        if (isValidRemoteMarker(type, raw)) {
          syncDebugLog(`marker probe ${attempt.method} succeeded`, { type, value: raw.trim() });
          return { type, value: raw.trim() };
        }
      }

      // No usable marker header is most often a CORS exposure issue: the
      // server must list the header in Access-Control-Expose-Headers for
      // cross-origin fetch() to read it at all.
      syncDebugLog(`marker probe ${attempt.method} found no usable change marker`, {
        exposedHeaders: [...res.headers.keys()].join(', ') || '(none)',
        requestOrigin: window.location.origin,
        targetUrl: url
      });
    } catch (e) {
      syncDebugLog(`marker probe ${attempt.method} threw`, { name: e.name, message: e.message });
    }
  }

  return null;
}

// Checks all marker header types at once (used by the settings "read test"
// button so the user can see which headers the backend actually exposes).
export async function probeSupportedRemoteMarkers(cfg = null) {
  const resolvedCfg = cfg || await loadSyncConfig();
  if (!resolvedCfg || resolvedCfg.type === 'browser') {
    return null;
  }

  const url = getSyncFetchUrl(resolvedCfg.url, resolvedCfg.type);
  const credentials = await resolveSyncCredentials(resolvedCfg, 'syncRead');
  if (!credentials.ok) {
    return null;
  }

  const headers = {};
  applyWebdavCompatibilityHeaders(headers, resolvedCfg);
  const credUser = credentials.username || '';
  const credPass = credentials.password || '';
  if (credPass) {
    headers['Authorization'] = safeBasicAuthHeader(credUser, credPass);
  }

  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-store', headers }, 5000);
    if (!res.ok) return null;

    const support = {};
    for (const type of REMOTE_MARKER_TYPES) {
      support[type] = isValidRemoteMarker(type, res.headers.get(REMOTE_MARKER_HEADERS[type]));
    }
    return support;
  } catch {
    return null;
  }
}

function xhrPutWithBasicAuth(url, body, username, password, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true, username, password);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('OCS-APIRequest', 'true');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    xhr.onload = () => {
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, statusText: xhr.statusText });
    };

    xhr.onerror = () => {
      reject(new Error('xhr-network-error'));
    };

    xhr.ontimeout = () => {
      const err = new Error('xhr-timeout');
      err.name = 'AbortError';
      reject(err);
    };

    xhr.send(body);
  });
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
    username: config.sync.username || '',
    password: config.sync.password || '',
    authMode: config.sync.authMode || (config.sync.password ? 'basic' : 'none'),
    encryptionMode: config.sync.encryptionMode || 'none',
    enc: config.sync.enc || null,
    localKey: config.sync.localKey || null,
    lastSync: config.sync.lastSync || 0
  };
}

// ─────────────────────────────────────────────────────────────
//  SAFE BASIC AUTH HEADER
// ─────────────────────────────────────────────────────────────

function safeBasicAuthHeader(username, password) {
  const credentials = `${username}:${password}`;

  // Prefer the browser's native Latin1-compatible encoding path first,
  // because that matches how Basic auth prompts are typically encoded.
  try {
    return 'Basic ' + btoa(credentials);
  } catch (latin1Error) {
    // Fall back to explicit UTF-8 encoding only when the credentials
    // contain characters that btoa cannot encode directly.
  }

  try {
    const bytes = new TextEncoder().encode(credentials);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return 'Basic ' + btoa(binary);
  } catch (e) {
    console.error('Failed to create Basic auth header:', e);
    throw new Error('auth-encoding-failed');
  }
}

function applyWebdavCompatibilityHeaders(headers, cfg) {
  if (!cfg || cfg.type !== 'webdav') return;

  headers['OCS-APIRequest'] = 'true';
  headers['X-Requested-With'] = 'XMLHttpRequest';
}

// ─────────────────────────────────────────────────────────────
//  TEST CONNECTION
// ─────────────────────────────────────────────────────────────

/**
 * Test sync server connection with detailed status information.
 * Returns { ok: boolean, reason: string, status?: number }
 *
 * Reasons:
 * - 'ok': Server responded successfully
 * - 'not-found-will-create': Got 404 (server exists, file will be created)
 * - 'auth': Got 401/403 (bad credentials)
 * - 'auth-redirect': Redirected to external authentication page
 * - 'http-error': Got other non-2xx status
 * - 'timeout': Request timed out
 * - 'network-or-cors': Network error or CORS blocked
 * - 'auth-encoding-failed': Failed to encode credentials (non-ASCII issue)
 * - 'invalid-url': URL is invalid
 */
export async function testSyncConnection(url, username = '', password = '', type = 'direct') {
  try {
    const endpoint = getSyncFetchUrl(url, type);

    // Validate URL format
    try {
      new URL(endpoint);
    } catch (e) {
      return { ok: false, reason: 'invalid-url' };
    }

    const headers = {};
    applyWebdavCompatibilityHeaders(headers, { type });
    if (password) {
      try {
        headers['Authorization'] = safeBasicAuthHeader(username, password);
      } catch (e) {
        return { ok: false, reason: 'auth-encoding-failed' };
      }
    }

    const res = await fetchWithTimeout(endpoint, {
      method: "GET",
      cache: "no-cache",
      headers
    });

    const redirectInfo = getAuthRedirectInfo(endpoint, res);
    if (redirectInfo) {
      await maybeOpenAuthRedirectTab(redirectInfo.redirectUrl);
      return { ok: false, ...redirectInfo };
    }

    if (res.ok) return { ok: true, reason: 'ok' };
    if (res.status === 404) return { ok: true, reason: 'not-found-will-create' };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'auth', status: res.status };
    }
    return { ok: false, reason: 'http-error', status: res.status };
  } catch (e) {
    if (e.message === 'auth-encoding-failed') {
      return { ok: false, reason: 'auth-encoding-failed' };
    }
    if (e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }

    // Some external auth proxies complete login via browser redirect flow.
    // If fetch is blocked by CORS before redirect info is exposed, open endpoint
    // directly so the user can authenticate in a regular tab.
    const endpoint = getSyncFetchUrl(url, type);
    const opened = await maybeOpenAuthRedirectTab(endpoint);
    if (opened) {
      return { ok: false, reason: 'auth-redirect', redirectUrl: endpoint };
    }

    // A CORS block and a real DNS/network failure both throw a generic
    // TypeError here — the browser doesn't expose which one happened.
    return { ok: false, reason: 'network-or-cors' };
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
      body: JSON.stringify(defaultData)
    });

    if (!res.ok) {
      console.warn(`initializeRemote failed: ${res.status} ${res.statusText} for ${url}`);
    }
  } catch (e) {
    console.log("initializeRemote failed", e);
  }

  return defaultData;
}

async function initializeRemoteDetailed(url, headers = {}) {
  const defaultData = { groups: [] };

  try {
    const res = await fetchWithTimeout(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(defaultData)
    });

    if (!res.ok) {
      console.warn(`initializeRemote failed: ${res.status} ${res.statusText} for ${url}`);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'auth', status: res.status };
      }
      return { ok: false, reason: 'http-error', status: res.status };
    }
  } catch (e) {
    console.log("initializeRemote failed", e);
    if (e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network-or-cors' };
  }

  return { ok: true, reason: 'initialized-remote', data: defaultData };
}

async function resolveSyncCredentials(cfg, operation) {
  let username = cfg.username || '';
  let password = cfg.password || '';

  try {
    const hasEncryptedCreds =
      (cfg.encryptionMode === 'local' && cfg.localKey && cfg.enc) ||
      (cfg.encryptionMode === 'master' && cfg.enc);
    const hasPlainCreds = !!(cfg.username || cfg.password);
    const effectiveAuthMode = (cfg.authMode === 'basic' || hasEncryptedCreds || hasPlainCreds) ? 'basic' : 'none';

    if (effectiveAuthMode !== 'basic') {
      return { ok: true, username, password };
    }

    if (cfg.encryptionMode === 'local' && cfg.localKey && cfg.enc) {
      const key = await importRawKey(cfg.localKey);
      const plain = await decryptWithKey(key, cfg.enc.ciphertext, cfg.enc.iv);
      const obj = JSON.parse(plain);
      username = obj.username || '';
      password = obj.password || '';
      return {
        ok: true,
        username: username.trim(),
        password: password.replace(/[\r\n]/g, '')
      };
    }

    if (cfg.encryptionMode === 'master' && cfg.enc) {
      if (!window._speeddial_masterKey) {
        console.warn(`${operation}: master-encrypted credentials are locked`);
        return { ok: false, reason: 'credentials-locked' };
      }

      try {
        const plain = await decryptWithKey(window._speeddial_masterKey, cfg.enc.ciphertext, cfg.enc.iv);
        const obj = JSON.parse(plain);
        username = obj.username || '';
        password = obj.password || '';
        return {
          ok: true,
          username: username.trim(),
          password: password.replace(/[\r\n]/g, '')
        };
      } catch (e) {
        console.warn(`${operation}: failed to decrypt master-encrypted credentials`, e);
        return { ok: false, reason: 'credentials-locked' };
      }
    }

    if (!username || !password) {
      console.warn(`${operation}: basic auth is enabled but credentials are missing`);
      return { ok: false, reason: 'credentials-missing' };
    }

    return {
      ok: true,
      username: username.trim(),
      password: password.replace(/[\r\n]/g, '')
    };
  } catch (e) {
    console.warn(`Error while decrypting credentials for ${operation}`, e);
    return { ok: false, reason: 'credentials-decrypt-failed' };
  }
}

async function syncReadDetailed(cfg = null) {
  const resolvedCfg = cfg || await loadSyncConfig();
  if (!resolvedCfg) {
    return { ok: false, reason: 'not-configured' };
  }

  if (resolvedCfg.type === 'browser') {
    try {
      const result = await chrome.storage.sync.get(CLOUD_STORAGE_KEY);
      const stored = result[CLOUD_STORAGE_KEY];
      return {
        ok: true,
        reason: 'ok',
        data: {
          groups: (stored && stored.groups) ? stored.groups : []
        }
      };
    } catch (e) {
      console.error('syncRead(browser) failed', e);
      return { ok: false, reason: 'browser-sync-error' };
    }
  }

  const url = resolvedCfg.url;
  const fetchUrl = getSyncFetchUrl(url, resolvedCfg.type);

  try {
    new URL(fetchUrl);
  } catch (e) {
    return { ok: false, reason: 'invalid-url' };
  }

  const credentials = await resolveSyncCredentials(resolvedCfg, 'syncRead');
  if (!credentials.ok) {
    return credentials;
  }

  try {
    const headers = {};
    applyWebdavCompatibilityHeaders(headers, resolvedCfg);
    const credUser = credentials.username || '';
    const credPass = credentials.password || '';
    if (credPass) {
      headers['Authorization'] = safeBasicAuthHeader(credUser, credPass);
    }

    const res = await fetchWithTimeout(fetchUrl, {
      method: "GET",
      cache: "no-cache",
      headers
    });

    const redirectInfo = getAuthRedirectInfo(fetchUrl, res);
    if (redirectInfo) {
      await maybeOpenAuthRedirectTab(redirectInfo.redirectUrl);
      return { ok: false, ...redirectInfo };
    }

    if (res.status === 404) {
      console.warn("syncRead: 404 → initializing remote file");
      return await initializeRemoteDetailed(fetchUrl, headers);
    }

    if (!res.ok) {
      console.warn("syncRead: server returned", res.status);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'auth', status: res.status };
      }
      return { ok: false, reason: 'http-error', status: res.status };
    }

    const text = await res.text();
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!text.trim()) {
      console.warn("syncRead: empty file → initializing");
      return await initializeRemoteDetailed(fetchUrl, headers);
    }

    if (contentType.includes('text/html') || /^\s*</.test(text)) {
      console.warn("syncRead: received HTML instead of JSON", {
        status: res.status,
        contentType,
        redirected: res.redirected,
        responseUrl: res.url
      });
      return {
        ok: false,
        reason: 'unexpected-html-response',
        status: res.status,
        redirected: !!res.redirected
      };
    }

    try {
      const parsed = JSON.parse(text);
      return {
        ok: true,
        reason: 'ok',
        data: {
          groups: parsed.groups ?? []
        }
      };
    } catch (e) {
      console.warn("syncRead: invalid JSON → initializing");
      return await initializeRemoteDetailed(fetchUrl, headers);
    }

  } catch (e) {
    console.log("fetch failed (syncRead)", e);
    if (e.message === 'auth-encoding-failed') {
      return { ok: false, reason: 'auth-encoding-failed' };
    }
    if (e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network-or-cors' };
  }
}

async function syncWriteDetailed(cfg = null, sourceGroups = null) {
  const resolvedCfg = cfg || await loadSyncConfig();
  if (!resolvedCfg) {
    return { ok: false, reason: 'not-configured' };
  }

  if (resolvedCfg.type === 'browser') {
    try {
      const groupsToWrite = Array.isArray(sourceGroups) ? sourceGroups : state.groups;
      await chrome.storage.sync.set({ [CLOUD_STORAGE_KEY]: { groups: groupsToWrite } });
      return { ok: true, reason: 'ok' };
    } catch (e) {
      console.error('syncWrite(browser) failed', e);
      return { ok: false, reason: 'browser-sync-error' };
    }
  }

  const fetchUrl = getSyncFetchUrl(resolvedCfg.url, resolvedCfg.type);

  try {
    new URL(fetchUrl);
  } catch (e) {
    return { ok: false, reason: 'invalid-url' };
  }

  const credentials = await resolveSyncCredentials(resolvedCfg, 'syncWrite');
  if (!credentials.ok) {
    return credentials;
  }

  const credUser = credentials.username || '';
  const credPass = credentials.password || '';
  const groupsToWrite = Array.isArray(sourceGroups) ? sourceGroups : state.groups;
  const writeBody = JSON.stringify({ groups: groupsToWrite });
  const lockRetryDelays = [400, 900, 1500];

  try {
    if (resolvedCfg.lastSync === 0 && isBootstrapPlaceholderState(groupsToWrite)) {
      const remote = await syncReadDetailed(resolvedCfg);
      if (!remote.ok) {
        return remote;
      }
      if (hasMeaningfulGroups(remote.data.groups)) {
        console.warn("syncWrite: refusing to overwrite remote data with bootstrap local state");
        state.groups = mergeGroups(groupsToWrite, remote.data.groups, { preferCloudOnBootstrap: true });
        await saveState();
        return { ok: true, reason: 'protected-remote-data' };
      }
    }

    const headers = { "Content-Type": "application/json" };
    applyWebdavCompatibilityHeaders(headers, resolvedCfg);
    if (credPass) {
      headers['Authorization'] = safeBasicAuthHeader(credUser, credPass);
    }

    let res = null;
    for (let attempt = 0; attempt <= lockRetryDelays.length; attempt++) {
      res = await fetchWithTimeout(fetchUrl, {
        method: "PUT",
        headers,
        body: writeBody
      });

      const redirectInfo = getAuthRedirectInfo(fetchUrl, res);
      if (redirectInfo) {
        await maybeOpenAuthRedirectTab(redirectInfo.redirectUrl);
        return { ok: false, ...redirectInfo };
      }

      if (res.ok) {
        return { ok: true, reason: 'ok' };
      }

      if (res.status === 423 && attempt < lockRetryDelays.length) {
        console.warn(`syncWrite: remote file locked (423), retrying in ${lockRetryDelays[attempt]}ms`);
        await delay(lockRetryDelays[attempt]);
        continue;
      }

      break;
    }

    if (!res.ok) {
      console.warn(`syncWrite failed: ${res.status} ${res.statusText} for ${fetchUrl}`);

      if (res.status === 423) {
        return { ok: false, reason: 'locked', status: res.status };
      }

      // Some WebDAV servers accept browser-native Basic auth challenge flow
      // but reject manually attached Authorization headers from fetch.
      if (resolvedCfg.type === 'webdav' && res.status === 401 && credUser && credPass) {
        try {
          const xhrRes = await xhrPutWithBasicAuth(
            fetchUrl,
            writeBody,
            credUser,
            credPass
          );

          if (xhrRes.ok) {
            console.warn('syncWrite: fetch auth failed, XHR basic-auth fallback succeeded');
            return { ok: true, reason: 'ok-xhr-fallback' };
          }

          if (xhrRes.status === 423) {
            return { ok: false, reason: 'locked', status: xhrRes.status };
          }

          console.warn(`syncWrite XHR fallback failed: ${xhrRes.status} ${xhrRes.statusText} for ${fetchUrl}`);
        } catch (xhrError) {
          console.warn('syncWrite XHR fallback errored', xhrError);
        }
      }

      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'auth', status: res.status };
      }
      return { ok: false, reason: 'http-error', status: res.status };
    }
  } catch (e) {
    console.log("fetch failed (syncWrite)", e);
    if (e.message === 'auth-encoding-failed') {
      return { ok: false, reason: 'auth-encoding-failed' };
    }
    if (e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network-or-cors' };
  }

  return { ok: true, reason: 'ok' };
}

// ─────────────────────────────────────────────────────────────
//  READ
// ─────────────────────────────────────────────────────────────

export async function syncRead() {
  const result = await syncReadDetailed();
  return result.ok ? result.data : null;
}

// ─────────────────────────────────────────────────────────────
//  WRITE
// ─────────────────────────────────────────────────────────────

export async function syncWrite(sourceState = state) {
  // do no sync if sync is disabled in config
  const config = await loadConfig();
  if (!config.sync.enabled) {
    return true; // sync disabled — nothing to do, not an error
  }

  const groups = Array.isArray(sourceState?.groups) ? sourceState.groups : state.groups;
  const result = await syncWriteDetailed(null, groups);
  return result.ok;
}

export async function syncReadTest() {
  const result = await syncReadDetailed();
  if (result.ok) {
    result.supportedHeaders = await probeSupportedRemoteMarkers();
  }
  return result;
}

export async function syncWriteTest() {
  return await syncWriteDetailed();
}

function pickNewerRecord(localRecord, cloudRecord) {
  if (localRecord.deleted && cloudRecord.deleted) {
    return (localRecord.deletedAt > cloudRecord.deletedAt) ? localRecord : cloudRecord;
  }

  if (cloudRecord.deleted) {
    return (cloudRecord.deletedAt > localRecord.updatedAt) ? cloudRecord : localRecord;
  }

  if (localRecord.deleted) {
    return (localRecord.deletedAt > cloudRecord.updatedAt) ? localRecord : cloudRecord;
  }

  return (localRecord.updatedAt > cloudRecord.updatedAt) ? localRecord : cloudRecord;
}

function isBootstrapPlaceholderState(groups) {
  if (!Array.isArray(groups) || groups.length !== 1) {
    return false;
  }

  const [group] = groups;
  return !group.deleted && (group.items?.length || 0) === 0;
}

function hasMeaningfulGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return false;
  }

  if (groups.length > 1) {
    return true;
  }

  return groups.some(group => group.deleted || (group.items?.length || 0) > 0);
}

function mergeGroups(localGroups, cloudGroups, options = {}) {
  const { preferCloudOnBootstrap = false } = options;

  if (preferCloudOnBootstrap && isBootstrapPlaceholderState(localGroups) && hasMeaningfulGroups(cloudGroups)) {
    return cloudGroups;
  }

  // ---- Merge group-level metadata (name, deleted, etc.) ----
  const localGroupMap = Object.fromEntries((localGroups || []).map(group => [group.id, group]));
  const cloudGroupMap = Object.fromEntries((cloudGroups || []).map(group => [group.id, group]));
  const allGroupIds = new Set([...Object.keys(localGroupMap), ...Object.keys(cloudGroupMap)]);

  const mergedGroupMeta = {};
  for (const id of allGroupIds) {
    const localGroup = localGroupMap[id];
    const cloudGroup = cloudGroupMap[id];

    if (localGroup && !cloudGroup) {
      mergedGroupMeta[id] = { ...localGroup, items: [] };
      continue;
    }
    if (!localGroup && cloudGroup) {
      mergedGroupMeta[id] = { ...cloudGroup, items: [] };
      continue;
    }
    mergedGroupMeta[id] = { ...pickNewerRecord(localGroup, cloudGroup), items: [] };
  }

  // ---- Merge items GLOBALLY by id, tracking which group each belongs to ----
  // This is what makes cross-group moves (moveBookmarkToGroup) sync correctly
  const localItemIndex = {};
  const cloudItemIndex = {};

  for (const group of (localGroups || [])) {
    for (const item of (group.items || [])) {
      localItemIndex[item.id] = { item, groupId: group.id };
    }
  }
  for (const group of (cloudGroups || [])) {
    for (const item of (group.items || [])) {
      cloudItemIndex[item.id] = { item, groupId: group.id };
    }
  }

  const allItemIds = new Set([...Object.keys(localItemIndex), ...Object.keys(cloudItemIndex)]);

  for (const itemId of allItemIds) {
    const localEntry = localItemIndex[itemId];
    const cloudEntry = cloudItemIndex[itemId];

    let winner, winningGroupId;

    if (localEntry && !cloudEntry) {
      winner = localEntry.item;
      winningGroupId = localEntry.groupId;
    } else if (!localEntry && cloudEntry) {
      winner = cloudEntry.item;
      winningGroupId = cloudEntry.groupId;
    } else {
      const localIsNewer = pickNewerRecord(localEntry.item, cloudEntry.item) === localEntry.item;
      winner = localIsNewer ? localEntry.item : cloudEntry.item;
      winningGroupId = localIsNewer ? localEntry.groupId : cloudEntry.groupId;
    }

    // Only place the item if its target group actually exists in the merged
    // result (it always should, but guard against orphaned data).
    if (mergedGroupMeta[winningGroupId]) {
      mergedGroupMeta[winningGroupId].items.push(winner);
    }
  }

  return Object.values(mergedGroupMeta);
}

function getGroupsFreshness(groups) {
  let maxTs = 0;

  for (const group of (groups || [])) {
    const groupUpdated = group?.updatedAt || 0;
    const groupDeleted = group?.deletedAt || 0;
    if (groupUpdated > maxTs) maxTs = groupUpdated;
    if (groupDeleted > maxTs) maxTs = groupDeleted;

    for (const item of (group?.items || [])) {
      const itemUpdated = item?.updatedAt || 0;
      const itemDeleted = item?.deletedAt || 0;
      if (itemUpdated > maxTs) maxTs = itemUpdated;
      if (itemDeleted > maxTs) maxTs = itemDeleted;
    }
  }

  return maxTs;
}

async function mergeAndWriteAtomically(config, cloudGroups) {
  const previousGroups = state.groups;
  const localFreshness = getGroupsFreshness(previousGroups);
  const cloudFreshness = getGroupsFreshness(cloudGroups || []);
  const localIsMoreRecent = localFreshness > cloudFreshness;

  const mergedGroups = mergeGroups(previousGroups, cloudGroups || [], { preferCloudOnBootstrap: true });
  const changed = JSON.stringify(previousGroups) !== JSON.stringify(mergedGroups);

  if (!changed) {
    await updateLastSyncTime(config);
    return { ok: true, reason: 'no-changes', changed: false };
  }

  state.groups = mergedGroups;

  const writeResult = await syncWriteDetailed({ ...(await loadSyncConfig()), lastSync: Date.now() });

  if (writeResult.ok) {
    await saveState();
    await updateLastSyncTime(config);
    return { ok: true, reason: writeResult.reason || 'ok', changed };
  }

  // Never keep a merged local state that failed to persist remotely.
  state.groups = previousGroups;

  if (localIsMoreRecent) {
    console.warn('sync: preserving newer local state because remote write failed');
  }

  return writeResult;
}

// ─────────────────────────────────────────────────────────────
//  PERIODIC SYNC
// ─────────────────────────────────────────────────────────────
export function startSyncLoop(options = {}) {
  const shouldSkip = (typeof options.shouldSkip === "function") ? options.shouldSkip : null;
  const initialDelayMs = Math.max(0, Number(options.initialDelayMs) || 0);
  let isSyncing = false;

  const runSyncLoop = async () => {
    if (shouldSkip && shouldSkip()) return;
    if (isSyncing) return;
    isSyncing = true;

    try {
      const config = await loadConfig();
      if (!config.sync.enabled) return;
      if (!shouldSync(config)) return;

      const result = await syncNow();
      if (result.ok && result.reason === 'remote-marker-unchanged') {
        console.info('sync loop skipped: remote change marker unchanged');
        return;
      }
      if (!result.ok && result.reason !== 'not-configured') {
        console.warn('sync loop failed:', result.reason, result.status || '');
      }
      if (result.ok && result.changed) {
        window.dispatchEvent(new CustomEvent('speeddial:data-changed'));
      }
    } finally {
      isSyncing = false;
    }
  };

  // Run sync loop every 20 seconds to check if sync is needed
  // This allows for flexible interval configuration without restarting the interval
  setInterval(runSyncLoop, 20000);
  if (initialDelayMs > 0) {
    setTimeout(runSyncLoop, initialDelayMs);
  } else {
    runSyncLoop();
  }
}

// ─────────────────────────────────────────────────────────────
//  MANUAL SYNC
// ─────────────────────────────────────────────────────────────

// Shared by syncNow() and the initial startup sync so both paths skip work
// when the backend proves nothing changed, not just the periodic loop.
export async function checkRemoteMarkerUnchanged(config) {
  if (!config || config.sync.type === 'browser') return false;

  resetRemoteMarkerStateIfUrlChanged(config);
  const preferredType = config.sync.remoteChangeHeaderType || null;
  const resolvedSyncCfg = await loadSyncConfig();
  const marker = await getRemoteChangeMarker(resolvedSyncCfg, { allowFallback: true, preferredType });

  if (!marker) {
    logRemoteMarkerCapabilityChange(config, false);
    syncDebugLog('marker check result', { type: null, skipped: false, reason: 'no usable change marker from backend' });
    config.sync.remoteChangeHeaderType = false;
    config.sync.lastSeenRemoteMarker = '';
    config.sync.lastRemoteMarkerCheck = Date.now();
    await saveConfig(config);
    return false;
  }

  const unchanged = config.sync.remoteChangeHeaderType === marker.type
    && !!config.sync.lastSeenRemoteMarker
    && config.sync.lastSeenRemoteMarker === marker.value;

  logRemoteMarkerCapabilityChange(config, marker.type);

  if (unchanged) {
    syncDebugLog('marker check result', { type: marker.type, value: marker.value, skipped: true, reason: 'unchanged since last sync' });
    return true;
  }

  syncDebugLog('marker check result', { type: marker.type, value: marker.value, skipped: false, previous: config.sync.lastSeenRemoteMarker });
  config.sync.remoteChangeHeaderType = marker.type;
  config.sync.lastSeenRemoteMarker = marker.value;
  config.sync.lastRemoteMarkerCheck = Date.now();
  await saveConfig(config);
  return false;
}

export async function syncNow() {
  const config = await loadConfig();

  if (!config.sync.enabled || (!config.sync.serverUrl && config.sync.type !== 'browser')) {
    console.warn("Sync not configured or disabled");
    return { ok: false, reason: 'not-configured' };
  }

  if (await checkRemoteMarkerUnchanged(config)) {
    return { ok: true, reason: 'remote-marker-unchanged', changed: false };
  }

  const readResult = await syncReadDetailed();
  if (!readResult.ok) {
    console.warn("Failed to read from sync server");
    return readResult;
  }

  return await mergeAndWriteAtomically(config, readResult.data.groups);
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
const inFlightValidations = new Map();

async function validateLinkWithGet(url, timeoutMs) {
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      cache: "no-cache",
      headers: { "Range": "bytes=0-0" }
    }, timeoutMs);

    deadLinkDebugLog(`GET fallback response: ${url} → status ${response.status}`);

    const isDead = response.status >= 400 && response.status < 600;
    deadLinkDebugLog(isDead ? `[linkcheck] DEAD (GET fallback http error): ${url}` : `[linkcheck] OK (GET fallback): ${url}`);
    return !isDead;
  } catch (error) {
    deadLinkDebugLog(`GET fallback error: ${url} → name=${error.name} message=${error.message}`);
    deadLinkDebugLog(`OK (GET fallback failed, assuming alive): ${url}`);
    return true;
  }
}

async function validateLinkOnce(url, timeoutMs) {
  deadLinkDebugLog(`start: ${url} (timeout=${timeoutMs}ms)`);
  try {
    const response = await fetchWithTimeout(url, {
      method: "HEAD",
      cache: "no-cache"
    }, timeoutMs);

    deadLinkDebugLog(`response: ${url} → status ${response.status}`);

    if (response.status === 405 || response.status === 403) {
      deadLinkDebugLog(`HEAD rejected (${response.status}), retrying with GET: ${url}`);
      return await validateLinkWithGet(url, timeoutMs);
    }

    if (response.status >= 400 && response.status < 600) {
      deadLinkDebugLog(`DEAD (http error): ${url}`);
      return false;
    }
    deadLinkDebugLog(`OK: ${url}`);
    return true;
  } catch (error) {
    deadLinkDebugLog(`error on first attempt: ${url} → name=${error.name} message=${error.message}`);

    if (error.name === "AbortError") {
      deadLinkDebugLog(`retrying with longer timeout: ${url}`);
      try {
        const retryResponse = await fetchWithTimeout(url, {
          method: "HEAD",
          cache: "no-cache"
        }, timeoutMs * 2);

        deadLinkDebugLog(`retry response: ${url} → status ${retryResponse.status}`);

        const isDead = retryResponse.status >= 400 && retryResponse.status < 600;
        deadLinkDebugLog(isDead ? `[linkcheck] DEAD (retry http error): ${url}` : `[linkcheck] OK (retry): ${url}`);
        return !isDead;
      } catch (retryError) {
        deadLinkDebugLog(`retry FAILED: ${url} → name=${retryError.name} message=${retryError.message}`);
        deadLinkDebugLog(`DEAD (retry failed): ${url}`);
        return false;
      }
    }

    deadLinkDebugLog(`OK (non-abort error, assuming alive): ${url}`);
    return true;
  }
}

async function validateLink(url, timeoutMs = 6000) {
  if (inFlightValidations.has(url)) {
    deadLinkDebugLog(`dedup: reusing in-flight validation for ${url}`);
    return inFlightValidations.get(url);
  }

  const promise = validateLinkOnce(url, timeoutMs).finally(() => {
    inFlightValidations.delete(url);
  });

  inFlightValidations.set(url, promise);
  return promise;
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

