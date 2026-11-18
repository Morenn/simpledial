import { state, saveState, isStackItem, getAllGroupBookmarks, cleanupStackIfNeeded, SYSTEM_TAG_DEAD_LINK_ID, getBookmarkSystemTagIds, setBookmarkSystemTag, saveSystemTags } from "./state.js";
import { loadConfig, saveConfig, shouldSync, updateLastSyncTime } from "./config.js";
import { importRawKey, decryptWithKey, getSecret } from './crypto.js';
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

export function resolveWebdavFolderBaseUrl(serverUrl, folderPath = "") {
  const base = ensureNoTrailingSlash(normalizeWebdavUrl((serverUrl || "").trim()));
  if (!base) return "";
  const cleanPath = String(folderPath || "").trim().replace(/^\/+|\/+$/g, "");
  return cleanPath ? `${base}/${cleanPath}` : base;
}

function getSyncFetchUrl(url, type, cfg = null) {
  const normalized = ensureNoTrailingSlash((url || "").trim());
  if (type === 'webdav') {
    if (cfg?.webdavMode === 'folder') {
      const folderBase = resolveWebdavFolderBaseUrl(normalized, cfg?.webdavFolderPath || "");
      return folderBase ? `${folderBase}/bookmarks-db.json` : "";
    }
    return normalizeWebdavUrl(normalized);
  }
  return normalized;
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
  const isFolder = config.sync.type === 'webdav' && config.sync.webdavMode === 'folder';
  const currentKey = isFolder
    ? `${config.sync.type}::folder::${config.sync.webdavFolderPath || ''}::${config.sync.serverUrl || ''}`
    : `${config.sync.type || 'direct'}::${config.sync.serverUrl || ''}`;
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

  const url = getSyncFetchUrl(resolvedCfg.url, resolvedCfg.type, resolvedCfg);
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

  const url = getSyncFetchUrl(resolvedCfg.url, resolvedCfg.type, resolvedCfg);
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
    webdavMode: config.sync.webdavMode === 'folder' ? 'folder' : 'file',
    webdavFolderPath: config.sync.webdavFolderPath || '',
    username: config.sync.username || '',
    password: config.sync.password || '',
    authMode: config.sync.authMode || (config.sync.password ? 'basic' : 'none'),
    encryptionMode: config.sync.encryptionMode || 'none',
    enc: config.sync.enc || null,
    localKey: config.sync.localKey || null,
    vaultHeader: config.vaultHeader || null,
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
async function createWebdavFolderRecursive(serverUrl, folderPath, headers) {
  const base = ensureNoTrailingSlash(normalizeWebdavUrl((serverUrl || "").trim()));
  const segments = String(folderPath || "").trim().replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!base || segments.length === 0) {
    return { ok: false, reason: 'folder-create-failed', status: 409 };
  }

  let current = base;
  for (const seg of segments) {
    current = `${current}/${seg}`;
    const mkRes = await fetchWithTimeout(`${current}/`, { method: "MKCOL", headers });
    if (mkRes.status === 401 || mkRes.status === 403) {
      return { ok: false, reason: 'auth', status: mkRes.status };
    }
    // 405 Method Not Allowed usually means the collection already exists on WebDAV
    if (!mkRes.ok && mkRes.status !== 405) {
      return { ok: false, reason: 'folder-create-failed', status: mkRes.status };
    }
  }
  return { ok: true };
}

async function testWebdavFolderPermissions(folderBaseUrl, headers, serverUrl = "", folderPath = "") {
  const folderCheckUrl = `${folderBaseUrl}/`;
  const checkRes = await fetchWithTimeout(folderCheckUrl, {
    method: "PROPFIND",
    headers: { Depth: "0", ...headers }
  });

  const redirectInfo = getAuthRedirectInfo(folderCheckUrl, checkRes);
  if (redirectInfo) {
    await maybeOpenAuthRedirectTab(redirectInfo.redirectUrl);
    return { ok: false, ...redirectInfo };
  }

  if (checkRes.status === 401 || checkRes.status === 403) {
    return { ok: false, reason: 'auth', status: checkRes.status };
  }

  if (checkRes.status === 404) {
    const mkcolRes = await fetchWithTimeout(folderCheckUrl, {
      method: "MKCOL",
      headers
    });
    if (mkcolRes.status === 401 || mkcolRes.status === 403) {
      return { ok: false, reason: 'auth', status: mkcolRes.status };
    }
    if (mkcolRes.status === 409 && folderPath) {
      const recRes = await createWebdavFolderRecursive(serverUrl, folderPath, headers);
      if (!recRes.ok) return recRes;
    } else if (!mkcolRes.ok && mkcolRes.status !== 405) {
      return { ok: false, reason: 'folder-create-failed', status: mkcolRes.status };
    }
  } else if (!checkRes.ok && checkRes.status !== 207 && checkRes.status !== 405) {
    return { ok: false, reason: 'http-error', status: checkRes.status };
  }

  const probeUrl = `${folderBaseUrl}/.simple-dial-permission-test.tmp`;
  const probeBody = JSON.stringify({ probe: true, ts: Date.now() });
  const putRes = await fetchWithTimeout(probeUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: probeBody
  });
  if (putRes.status === 401 || putRes.status === 403) {
    return { ok: false, reason: 'auth', status: putRes.status };
  }
  if (!putRes.ok) {
    return { ok: false, reason: 'folder-not-writable', status: putRes.status };
  }

  const getRes = await fetchWithTimeout(probeUrl, {
    method: "GET",
    cache: "no-cache",
    headers
  });
  if (getRes.status === 401 || getRes.status === 403) {
    return { ok: false, reason: 'auth', status: getRes.status };
  }
  if (!getRes.ok) {
    return { ok: false, reason: 'folder-not-readable', status: getRes.status };
  }

  let deleteSupported = true;
  try {
    const delRes = await fetchWithTimeout(probeUrl, { method: "DELETE", headers });
    deleteSupported = delRes.ok || delRes.status === 404;
  } catch {
    deleteSupported = false;
  }

  return { ok: true, reason: 'folder-ready', folderUrl: folderBaseUrl, deleteSupported };
}

export async function testSyncConnection(url, username = '', password = '', type = 'direct', options = {}) {
  const webdavMode = options?.webdavMode === 'folder' ? 'folder' : 'file';
  const webdavFolderPath = options?.webdavFolderPath || '';
  const cfgObj = { type, webdavMode, webdavFolderPath };

  try {
    const endpoint = getSyncFetchUrl(url, type, cfgObj);

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

    if (type === 'webdav' && webdavMode === 'folder') {
      const folderBase = resolveWebdavFolderBaseUrl(url, webdavFolderPath);
      return await testWebdavFolderPermissions(folderBase, headers, url, webdavFolderPath);
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
    const endpoint = getSyncFetchUrl(url, type, cfgObj);
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
      (cfg.encryptionMode === 'vault' && cfg.enc);
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

    if (cfg.encryptionMode === 'vault' && typeof cfg.enc === 'string') {
      const res = await getSecret(cfg.enc, 'sync:credentials', { vaultHeader: cfg.vaultHeader || null });
      if (!res.ok) {
        return { ok: false, reason: res.error === 'DECRYPT_FAILED' ? 'credentials-decrypt-failed' : 'credentials-locked' };
      }
      const obj = JSON.parse(res.value);
      username = obj.username || '';
      password = obj.password || '';
      return {
        ok: true,
        username: username.trim(),
        password: password.replace(/[\r\n]/g, '')
      };
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
          groups: (stored && stored.groups) ? stored.groups : [],
          tags: Array.isArray(stored?.tags) ? stored.tags : []
        }
      };
    } catch (e) {
      console.error('syncRead(browser) failed', e);
      return { ok: false, reason: 'browser-sync-error' };
    }
  }

  const url = resolvedCfg.url;
  const fetchUrl = getSyncFetchUrl(url, resolvedCfg.type, resolvedCfg);

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
          groups: parsed.groups ?? [],
          tags: Array.isArray(parsed?.tags) ? parsed.tags : []
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

async function syncWriteDetailed(cfg = null, sourceGroups = null, sourceTags = null) {
  const resolvedCfg = cfg || await loadSyncConfig();
  if (!resolvedCfg) {
    return { ok: false, reason: 'not-configured' };
  }

  const tagsToWrite = Array.isArray(sourceTags)
    ? sourceTags
    : (Array.isArray(state.tags) ? state.tags : []);

  if (resolvedCfg.type === 'browser') {
    try {
      const groupsToWrite = Array.isArray(sourceGroups) ? sourceGroups : state.groups;
      const syncPayload = tagsToWrite.length > 0
        ? { groups: groupsToWrite, tags: tagsToWrite }
        : { groups: groupsToWrite };
      await chrome.storage.sync.set({ [CLOUD_STORAGE_KEY]: syncPayload });
      const verified = await chrome.storage.sync.get(CLOUD_STORAGE_KEY);
      if (stableSerialize(verified[CLOUD_STORAGE_KEY]?.groups || []) !== stableSerialize(groupsToWrite)) {
        console.warn('syncWrite(browser): stored data changed during write; keeping local changes for retry');
        return { ok: false, reason: 'browser-sync-conflict' };
      }
      return { ok: true, reason: 'ok' };
    } catch (e) {
      console.error('syncWrite(browser) failed', e);
      return { ok: false, reason: 'browser-sync-error' };
    }
  }

  const fetchUrl = getSyncFetchUrl(resolvedCfg.url, resolvedCfg.type, resolvedCfg);

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
  const writePayload = tagsToWrite.length > 0
    ? { groups: groupsToWrite, tags: tagsToWrite }
    : { groups: groupsToWrite };
  const writeBody = JSON.stringify(writePayload);
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

function persistPendingPurgedIdsInConfig(config, purgedIds = []) {
  if (!config?.sync) return false;
  const existing = Array.isArray(config.sync.pendingPurgedIds) ? config.sync.pendingPurgedIds : [];
  const incoming = Array.isArray(purgedIds) ? purgedIds.filter(Boolean) : [];
  if (incoming.length === 0) return false;

  const mergedSet = new Set([...existing, ...incoming]);
  if (mergedSet.size === existing.length) return false;

  config.sync.pendingPurgedIds = Array.from(mergedSet);
  return true;
}

export async function syncWrite(sourceState = state, options = {}) {
  // do no sync if sync is disabled in config
  const config = await loadConfig();
  const extraPurgedIds = Array.isArray(options?.purgedIds) ? options.purgedIds.filter(Boolean) : [];
  if (persistPendingPurgedIdsInConfig(config, extraPurgedIds)) {
    await saveConfig(config);
  }

  if (!config.sync.enabled) {
    return true; // sync disabled — nothing to do, not an error
  }

  const groups = Array.isArray(sourceState?.groups) ? sourceState.groups : state.groups;
  const tags = Array.isArray(sourceState?.tags) ? sourceState.tags : (Array.isArray(state.tags) ? state.tags : []);
  const previousGroups = state.groups;
  const previousTags = state.tags;
  state.groups = groups;
  state.tags = tags;

  const readResult = await syncReadDetailed();
  if (!readResult.ok) {
    state.groups = previousGroups;
    state.tags = previousTags;
    return false;
  }

  const result = await mergeAndWriteAtomically(config, readResult.data.groups, 2, readResult.data.tags, extraPurgedIds);
  if (!result.ok) {
    state.groups = previousGroups;
    state.tags = previousTags;
  }
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
  const localTimestamp = localRecord.deleted ? (localRecord.deletedAt || 0) : (localRecord.updatedAt || 0);
  const cloudTimestamp = cloudRecord.deleted ? (cloudRecord.deletedAt || 0) : (cloudRecord.updatedAt || 0);
  if (localTimestamp !== cloudTimestamp) {
    return localTimestamp > cloudTimestamp ? localRecord : cloudRecord;
  }

  const localSnapshot = stableSerialize(localRecord);
  const cloudSnapshot = stableSerialize(cloudRecord);
  return localSnapshot > cloudSnapshot ? localRecord : cloudRecord;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isBootstrapPlaceholderState(groups) {
  if (!Array.isArray(groups) || groups.length !== 1) {
    return false;
  }

  const [group] = groups;
  const hasGroupCustomization = Boolean(group.iconEmoji || group.customIcon || group.tileColor || group.colorFromIcon);
  return !group.deleted
    && !hasGroupCustomization
    && (group.items?.length || 0) === 0
    && (group.sections?.length || 0) === 0;
}

function hasMeaningfulGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return false;
  }

  if (groups.length > 1) {
    return true;
  }

  return groups.some(group =>
    group.deleted
    || (group.items?.length || 0) > 0
    || (group.sections?.length || 0) > 0
  );
}

function mergeRecordArrays(localRecords = [], cloudRecords = []) {
  const localMap = Object.fromEntries((localRecords || []).filter(Boolean).map(r => [r.id, r]));
  const cloudMap = Object.fromEntries((cloudRecords || []).filter(Boolean).map(r => [r.id, r]));
  const allIds = new Set([...Object.keys(localMap), ...Object.keys(cloudMap)]);
  const merged = [];

  for (const id of allIds) {
    const localRec = localMap[id];
    const cloudRec = cloudMap[id];
    if (localRec && !cloudRec) {
      merged.push(localRec);
    } else if (!localRec && cloudRec) {
      merged.push(cloudRec);
    } else {
      merged.push(pickNewerRecord(localRec, cloudRec));
    }
  }

  return merged;
}

function mergeTags(localTags = [], cloudTags = []) {
  return mergeRecordArrays(localTags, cloudTags);
}

function mergeStackItems(localStack, cloudStack) {
  const baseStack = pickNewerRecord(localStack, cloudStack);
  const mergedChildren = mergeRecordArrays(localStack.children || [], cloudStack.children || []);
  return {
    ...baseStack,
    children: mergedChildren
  };
}

function mergeGroups(localGroups, cloudGroups, options = {}) {
  const { preferCloudOnBootstrap = false } = options;

  if (preferCloudOnBootstrap && isBootstrapPlaceholderState(localGroups) && hasMeaningfulGroups(cloudGroups)) {
    return cloudGroups;
  }

  // ---- Merge group-level metadata (name, sections, deleted, etc.) ----
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

    const winningMeta = pickNewerRecord(localGroup, cloudGroup);
    const nextGroup = { ...winningMeta, items: [] };
    if (Array.isArray(localGroup.sections) || Array.isArray(cloudGroup.sections)) {
      nextGroup.sections = mergeRecordArrays(localGroup.sections || [], cloudGroup.sections || []);
    }
    mergedGroupMeta[id] = nextGroup;
  }

  // ---- Merge items GLOBALLY by id, tracking stack membership & cross-group moves ----
  const localItemIndex = {};
  const cloudItemIndex = {};
  const localChildIndex = {};
  const cloudChildIndex = {};

  for (const group of (localGroups || [])) {
    for (const item of (group.items || [])) {
      localItemIndex[item.id] = { item, groupId: group.id };
      if (isStackItem(item)) {
        for (const child of (item.children || [])) {
          if (child?.id) {
            localChildIndex[child.id] = { child, stackId: item.id, groupId: group.id };
          }
        }
      }
    }
  }
  for (const group of (cloudGroups || [])) {
    for (const item of (group.items || [])) {
      cloudItemIndex[item.id] = { item, groupId: group.id };
      if (isStackItem(item)) {
        for (const child of (item.children || [])) {
          if (child?.id) {
            cloudChildIndex[child.id] = { child, stackId: item.id, groupId: group.id };
          }
        }
      }
    }
  }

  const allItemIds = new Set([...Object.keys(localItemIndex), ...Object.keys(cloudItemIndex)]);
  const promotedTopLevelBookmarkIds = new Set();

  for (const itemId of allItemIds) {
    const localEntry = localItemIndex[itemId];
    const cloudEntry = cloudItemIndex[itemId];

    let winner, winningGroupId;

    if (localEntry && !cloudEntry) {
      winner = localEntry.item;
      winningGroupId = localEntry.groupId;

      if (!isStackItem(winner) && cloudChildIndex[itemId]) {
        const stackedVersion = cloudChildIndex[itemId].child;
        if (pickNewerRecord(winner, stackedVersion) === stackedVersion) {
          continue; // Stale top-level bookmark was moved into a stack remotely
        }
        promotedTopLevelBookmarkIds.add(itemId);
      }
    } else if (!localEntry && cloudEntry) {
      winner = cloudEntry.item;
      winningGroupId = cloudEntry.groupId;

      if (!isStackItem(winner) && localChildIndex[itemId]) {
        const stackedVersion = localChildIndex[itemId].child;
        if (pickNewerRecord(stackedVersion, winner) === stackedVersion) {
          continue; // Stale top-level bookmark on remote was moved into a stack locally
        }
        promotedTopLevelBookmarkIds.add(itemId);
      }
    } else {
      const localIsNewer = pickNewerRecord(localEntry.item, cloudEntry.item) === localEntry.item;
      if (isStackItem(localEntry.item) && isStackItem(cloudEntry.item)) {
        winner = mergeStackItems(localEntry.item, cloudEntry.item);
        winningGroupId = localIsNewer ? localEntry.groupId : cloudEntry.groupId;
      } else {
        winner = localIsNewer ? localEntry.item : cloudEntry.item;
        winningGroupId = localIsNewer ? localEntry.groupId : cloudEntry.groupId;
      }
    }

    if (mergedGroupMeta[winningGroupId]) {
      mergedGroupMeta[winningGroupId].items.push(winner);
    }
  }

  // Strip bookmarks that moved back to top-level from any stale stack snapshot,
  // and remove dissolved empty non-deleted stacks.
  if (promotedTopLevelBookmarkIds.size > 0) {
    for (const group of Object.values(mergedGroupMeta)) {
      group.items = group.items.filter(item => {
        if (!isStackItem(item)) return true;
        item.children = (item.children || []).filter(c => !promotedTopLevelBookmarkIds.has(c.id));
        if (item.children.length === 0 && !item.deleted) {
          return false;
        }
        return true;
      });
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

    for (const section of (group?.sections || [])) {
      const secUpdated = section?.updatedAt || 0;
      const secDeleted = section?.deletedAt || 0;
      if (secUpdated > maxTs) maxTs = secUpdated;
      if (secDeleted > maxTs) maxTs = secDeleted;
    }

    for (const item of (group?.items || [])) {
      const itemUpdated = item?.updatedAt || 0;
      const itemDeleted = item?.deletedAt || 0;
      if (itemUpdated > maxTs) maxTs = itemUpdated;
      if (itemDeleted > maxTs) maxTs = itemDeleted;

      if (isStackItem(item)) {
        for (const child of (item.children || [])) {
          const childUpdated = child?.updatedAt || 0;
          const childDeleted = child?.deletedAt || 0;
          if (childUpdated > maxTs) maxTs = childUpdated;
          if (childDeleted > maxTs) maxTs = childDeleted;
        }
      }
    }
  }

  return maxTs;
}

async function getGroupsHash(groups, tags = []) {
  const payload = Array.isArray(tags) && tags.length > 0 ? { groups: groups || [], tags } : (groups || []);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function collectLocalRecordIds(groups = [], tags = []) {
  const ids = new Set();
  for (const tag of (tags || [])) {
    if (tag?.id) ids.add(tag.id);
  }
  for (const group of (groups || [])) {
    if (!group) continue;
    if (group.id) ids.add(group.id);
    for (const sec of (group.sections || [])) {
      if (sec?.id) ids.add(sec.id);
    }
    for (const item of (group.items || [])) {
      if (!item) continue;
      if (item.id) ids.add(item.id);
      if (Array.isArray(item.children)) {
        for (const child of item.children) {
          if (child?.id) ids.add(child.id);
        }
      }
    }
  }
  return ids;
}

function stripPurgedIdsFromCloudData(cloudGroups = [], cloudTags = [], purgedIdSet = new Set()) {
  if (!purgedIdSet || purgedIdSet.size === 0) {
    return {
      groups: Array.isArray(cloudGroups) ? cloudGroups : [],
      tags: Array.isArray(cloudTags) ? cloudTags : []
    };
  }

  const filteredGroups = [];
  for (const group of (cloudGroups || [])) {
    if (!group || purgedIdSet.has(group.id)) continue;

    const nextSections = Array.isArray(group.sections)
      ? group.sections.filter(sec => sec && !purgedIdSet.has(sec.id))
      : undefined;

    const nextItems = [];
    for (const item of (group.items || [])) {
      if (!item || purgedIdSet.has(item.id)) continue;
      if (isStackItem(item)) {
        const nextChildren = (item.children || []).filter(child => child && !purgedIdSet.has(child.id));
        if (nextChildren.length === 0 && !item.deleted) {
          continue;
        }
        nextItems.push({ ...item, children: nextChildren });
      } else {
        nextItems.push(item);
      }
    }

    const nextGroup = { ...group, items: nextItems };
    if (nextSections !== undefined) {
      nextGroup.sections = nextSections;
    }
    filteredGroups.push(nextGroup);
  }

  const filteredTags = (cloudTags || []).filter(tag => tag && !purgedIdSet.has(tag.id));
  return { groups: filteredGroups, tags: filteredTags };
}

async function mergeAndWriteAtomically(config, cloudGroups, browserConflictRetries = 2, cloudTags = [], extraPurgedIds = []) {
  const previousGroups = state.groups;
  const previousTags = Array.isArray(state.tags) ? state.tags : [];
  const resolvedCloudTags = Array.isArray(cloudTags) ? cloudTags : [];

  const combinedPurgedIds = new Set([
    ...(Array.isArray(config.sync?.pendingPurgedIds) ? config.sync.pendingPurgedIds : []),
    ...(Array.isArray(extraPurgedIds) ? extraPurgedIds : [])
  ]);
  const localIds = collectLocalRecordIds(previousGroups, previousTags);
  const purgedIdsToStrip = new Set(Array.from(combinedPurgedIds).filter(id => id && !localIds.has(id)));

  const strippedCloud = stripPurgedIdsFromCloudData(cloudGroups || [], resolvedCloudTags, purgedIdsToStrip);
  const effectiveCloudGroups = strippedCloud.groups;
  const effectiveCloudTags = strippedCloud.tags;

  const localFreshness = getGroupsFreshness(previousGroups);
  const cloudFreshness = getGroupsFreshness(effectiveCloudGroups);
  const localIsMoreRecent = localFreshness > cloudFreshness;

  const isInitialUnseededSync = !config.sync?.lastSync && !config.sync?.lastSyncedLocalHash && purgedIdsToStrip.size === 0;
  const mergedGroups = mergeGroups(previousGroups, effectiveCloudGroups, { preferCloudOnBootstrap: isInitialUnseededSync });
  const mergedTags = mergeTags(previousTags, effectiveCloudTags);

  const groupsChanged = JSON.stringify(previousGroups) !== JSON.stringify(mergedGroups);
  const tagsChanged = JSON.stringify(previousTags) !== JSON.stringify(mergedTags);
  const changed = groupsChanged || tagsChanged;

  const remoteGroupsNeedUpdate = JSON.stringify(cloudGroups || []) !== JSON.stringify(mergedGroups);
  const remoteTagsNeedUpdate = JSON.stringify(resolvedCloudTags) !== JSON.stringify(mergedTags);
  const remoteNeedsUpdate = remoteGroupsNeedUpdate || remoteTagsNeedUpdate;

  if (!changed && !remoteNeedsUpdate) {
    if (config.sync) config.sync.pendingPurgedIds = [];
    config.sync.lastSyncedLocalHash = await getGroupsHash(state.groups, state.tags);
    await updateLastSyncTime(config);
    return { ok: true, reason: 'no-changes', changed: false };
  }

  if (groupsChanged) {
    state.groups = mergedGroups;
  }
  if (tagsChanged) {
    state.tags = mergedTags;
  }

  let writeResult = null;
  if (remoteNeedsUpdate) {
    writeResult = await syncWriteDetailed({ ...(await loadSyncConfig()), lastSync: Date.now() });

    if (!writeResult.ok) {
      // Never keep a merged local state that failed to persist remotely.
      state.groups = previousGroups;
      state.tags = previousTags;

      if (writeResult.reason === 'browser-sync-conflict' && browserConflictRetries > 0) {
        const latestRemote = await syncReadDetailed();
        if (!latestRemote.ok) {
          return latestRemote;
        }
        return await mergeAndWriteAtomically(
          config,
          latestRemote.data.groups,
          browserConflictRetries - 1,
          latestRemote.data.tags,
          extraPurgedIds
        );
      }

      if (localIsMoreRecent) {
        console.warn('sync: preserving newer local state because remote write failed');
      }

      return writeResult;
    }
  }

  if (changed) {
    await saveState();
  }
  if (config.sync) config.sync.pendingPurgedIds = [];
  config.sync.lastSyncedLocalHash = await getGroupsHash(state.groups, state.tags);
  await updateLastSyncTime(config);
  return { ok: true, reason: writeResult?.reason || 'no-changes', changed };
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
  return false;
}

const WEBDAV_BACKUP_STORAGE_KEYS = {
  bookmarks: "myspeeddial-backups",
  config: "myspeeddial-backups-config",
  widgets: "myspeeddial-backups-widgets"
};

async function webdavGetJsonFile(fileUrl, headers) {
  try {
    const res = await fetchWithTimeout(fileUrl, {
      method: "GET",
      cache: "no-cache",
      headers
    });
    if (res.status === 404) {
      return { ok: true, notFound: true, data: null };
    }
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const text = await res.text();
    const data = text.trim() ? JSON.parse(text) : null;
    return { ok: true, notFound: false, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function webdavPutJsonFile(fileUrl, headers, payload) {
  try {
    const res = await fetchWithTimeout(fileUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function buildConfigExtraPayload(config) {
  const appearance = { ...(config.appearance || {}) };
  delete appearance.backgroundImage;
  delete appearance.backgroundImageUrl;
  delete appearance.backgroundSize;
  delete appearance.bgDim;
  delete appearance.showDeleted;
  delete appearance.lockTiles;
  delete appearance.customWidgets;
  delete appearance.customSearchAutoRouteDefaults;
  delete appearance.customSearchAutoRouteIcons;
  delete appearance.widgetOrder;
  delete appearance.widgetAlign;
  delete appearance.widgetNewRow;

  const housekeeper = { ...(config.housekeeper || {}) };
  delete housekeeper.lastCleanup;
  delete housekeeper.lastLinkCheck;

  const backups = { ...(config.backups || {}) };
  delete backups.lastAutoBackup;

  return {
    appearance,
    housekeeper,
    backups
  };
}

function buildWidgetsExtraPayload(config) {
  const a = config.appearance || {};
  return {
    customWidgets: Array.isArray(a.customWidgets)
      ? a.customWidgets.map(w => (w && typeof w === "object" && "authHeaderValue" in w ? { ...w, authHeaderValue: "" } : w))
      : [],
    customSearchAutoRouteDefaults: a.customSearchAutoRouteDefaults || {},
    customSearchAutoRouteIcons: a.customSearchAutoRouteIcons || {},
    widgetOrder: Array.isArray(a.widgetOrder) ? a.widgetOrder : [],
    widgetAlign: a.widgetAlign || {},
    widgetNewRow: a.widgetNewRow || {}
  };
}

function buildBackgroundExtraPayload(config) {
  const a = config.appearance || {};
  return {
    backgroundImage: a.backgroundImage ?? null,
    backgroundImageUrl: a.backgroundImageUrl || "",
    backgroundSize: a.backgroundSize || "stretched",
    bgDim: a.bgDim ?? 0
  };
}

function mergeBackupArrays(localList = [], remoteList = [], retentionDays = 14, now = Date.now()) {
  const byFilename = new Map();
  for (const entry of [...(Array.isArray(localList) ? localList : []), ...(Array.isArray(remoteList) ? remoteList : [])]) {
    if (!entry || typeof entry.filename !== "string") continue;
    const prev = byFilename.get(entry.filename);
    if (!prev || Number(entry.timestamp || 0) >= Number(prev.timestamp || 0)) {
      byFilename.set(entry.filename, entry);
    }
  }
  const sorted = [...byFilename.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  if (sorted.length <= 1) return sorted;

  const retentionMs = Math.max(1, Number(retentionDays) || 14) * 24 * 60 * 60 * 1000;
  const cutoff = now - retentionMs;
  const kept = sorted.filter(entry => Number(entry.timestamp || 0) >= cutoff);
  return kept.length > 0 ? kept : [sorted[0]];
}

async function hashExtraPayload(payload) {
  const bytes = new TextEncoder().encode(stableSerialize(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

async function syncExtraJsonSection({ key, fileUrl, headers, localPayload, lastHashes, lastExtrasSync, applyRemote }) {
  const localHash = await hashExtraPayload(localPayload);
  const remoteRes = await webdavGetJsonFile(fileUrl, headers);
  if (!remoteRes.ok) return false;

  const r = remoteRes.data;
  const remoteHash = r && r.data !== undefined ? await hashExtraPayload(r.data) : "";
  const lastHash = lastHashes[key] || "";

  const remoteChanged = !!r && r.data !== undefined && remoteHash !== lastHash;
  const localChanged = localHash !== lastHash;

  if (remoteChanged && (!localChanged || !lastHash || Number(r.updatedAt || 0) > lastExtrasSync)) {
    if (remoteHash !== localHash) {
      applyRemote(r.data);
      lastHashes[key] = remoteHash;
      return true;
    }
    lastHashes[key] = localHash;
    return false;
  }

  if (remoteRes.notFound || localHash !== remoteHash) {
    const putRes = await webdavPutJsonFile(fileUrl, headers, {
      updatedAt: Date.now(),
      data: localPayload
    });
    if (putRes.ok) {
      lastHashes[key] = localHash;
    }
  } else {
    lastHashes[key] = localHash;
  }
  return false;
}

function shouldSyncExtraPart(enabled, mode, { includeManual = false, manualOnly = false } = {}) {
  if (!enabled) return false;
  const isManual = mode === "manual";
  if (manualOnly) return isManual;
  return isManual ? includeManual : true;
}

export async function syncWebdavFolderExtras(config = null, options = {}) {
  const currentConfig = config || await loadConfig();
  if (!currentConfig || currentConfig.sync?.type !== "webdav" || currentConfig.sync?.webdavMode !== "folder") {
    return { ok: true, skipped: true };
  }

  const folderBase = resolveWebdavFolderBaseUrl(currentConfig.sync.serverUrl, currentConfig.sync.webdavFolderPath);
  if (!folderBase) return { ok: false, reason: "invalid-url" };

  const syncConfigEnabled = shouldSyncExtraPart(currentConfig.sync.webdavSyncConfig !== false, currentConfig.sync.webdavConfigMode, options);
  const syncWidgetsEnabled = shouldSyncExtraPart(currentConfig.sync.webdavSyncWidgets !== false, currentConfig.sync.webdavWidgetsMode, options);
  const syncBackgroundEnabled = shouldSyncExtraPart(!!currentConfig.sync.webdavSyncBackground, currentConfig.sync.webdavBackgroundMode, options);
  const syncBackupsEnabled = shouldSyncExtraPart(!!currentConfig.sync.webdavSyncBackups, currentConfig.sync.webdavBackupsMode, options);

  if (!syncConfigEnabled && !syncWidgetsEnabled && !syncBackgroundEnabled && !syncBackupsEnabled) {
    return { ok: true, skipped: true, configChanged: false };
  }

  const resolvedCfg = await loadSyncConfig();
  const credentials = await resolveSyncCredentials(resolvedCfg, "syncWebdavFolderExtras");
  if (!credentials.ok) return credentials;

  const headers = {};
  applyWebdavCompatibilityHeaders(headers, resolvedCfg);
  if (credentials.password) {
    headers["Authorization"] = safeBasicAuthHeader(credentials.username || "", credentials.password);
  }

  let configChanged = false;
  const lastExtrasSync = Number(currentConfig.sync.lastFolderExtrasSync || 0);
  if (!currentConfig.sync.lastSyncedExtraHashes || typeof currentConfig.sync.lastSyncedExtraHashes !== "object") {
    currentConfig.sync.lastSyncedExtraHashes = {};
  }
  const lastHashes = currentConfig.sync.lastSyncedExtraHashes;

  // 1. config.json
  if (syncConfigEnabled) {
    const changed = await syncExtraJsonSection({
      key: "config",
      fileUrl: `${folderBase}/config.json`,
      headers,
      localPayload: buildConfigExtraPayload(currentConfig),
      lastHashes,
      lastExtrasSync,
      applyRemote: (remoteData) => {
        if (remoteData?.appearance) {
          const { showDeleted: _sd, lockTiles: _lt, ...remoteAppearance } = remoteData.appearance;
          currentConfig.appearance = { ...currentConfig.appearance, ...remoteAppearance };
        }
        if (remoteData?.housekeeper) {
          const { lastCleanup: _lc, lastLinkCheck: _llc, ...remoteHk } = remoteData.housekeeper;
          currentConfig.housekeeper = { ...currentConfig.housekeeper, ...remoteHk };
        }
        if (remoteData?.backups) {
          const { lastAutoBackup: _lab, ...remoteBackups } = remoteData.backups;
          currentConfig.backups = { ...currentConfig.backups, ...remoteBackups };
        }
      }
    });
    if (changed) configChanged = true;
  }

  // 2. widgets.json
  if (syncWidgetsEnabled) {
    const changed = await syncExtraJsonSection({
      key: "widgets",
      fileUrl: `${folderBase}/widgets.json`,
      headers,
      localPayload: buildWidgetsExtraPayload(currentConfig),
      lastHashes,
      lastExtrasSync,
      applyRemote: (remoteData) => {
        if (remoteData && typeof remoteData === "object") {
          const localById = new Map(
            (currentConfig.appearance?.customWidgets || [])
              .filter(w => w?.id && w?.authHeaderValue)
              .map(w => [w.id, w.authHeaderValue])
          );
          const nextRemote = { ...remoteData };
          if (Array.isArray(nextRemote.customWidgets)) {
            nextRemote.customWidgets = nextRemote.customWidgets.map(w =>
              w?.id && localById.has(w.id) ? { ...w, authHeaderValue: localById.get(w.id) } : { ...w, authHeaderValue: "" }
            );
          }
          currentConfig.appearance = { ...currentConfig.appearance, ...nextRemote };
        }
      }
    });
    if (changed) configChanged = true;
  }

  // 3. background.json
  if (syncBackgroundEnabled) {
    const changed = await syncExtraJsonSection({
      key: "background",
      fileUrl: `${folderBase}/background.json`,
      headers,
      localPayload: buildBackgroundExtraPayload(currentConfig),
      lastHashes,
      lastExtrasSync,
      applyRemote: (remoteData) => {
        if (remoteData && typeof remoteData === "object") {
          currentConfig.appearance = { ...currentConfig.appearance, ...remoteData };
        }
      }
    });
    if (changed) configChanged = true;
  }

  // 4. backups/ (<folder>/backups/<type>/<filename> + <folder>/backups/index.json)
  if (syncBackupsEnabled) {
    try {
      const retentionDays = Math.max(1, Number(currentConfig.backups?.retentionDays) || 14);
      const backupsRootUrl = `${folderBase}/backups`;
      const backupTypes = Object.keys(WEBDAV_BACKUP_STORAGE_KEYS);

      // Ensure backups/ and backups/<type>/ directories exist
      for (const dirUrl of [`${backupsRootUrl}/`, ...backupTypes.map(t => `${backupsRootUrl}/${t}/`)]) {
        try {
          await fetchWithTimeout(dirUrl, { method: "MKCOL", headers });
        } catch {}
      }

      const [bmStored, cfgStored, wgtStored] = await Promise.all([
        chrome.storage.local.get(WEBDAV_BACKUP_STORAGE_KEYS.bookmarks),
        chrome.storage.local.get(WEBDAV_BACKUP_STORAGE_KEYS.config),
        chrome.storage.local.get(WEBDAV_BACKUP_STORAGE_KEYS.widgets)
      ]);
      const localBackups = {
        bookmarks: Array.isArray(bmStored[WEBDAV_BACKUP_STORAGE_KEYS.bookmarks]) ? bmStored[WEBDAV_BACKUP_STORAGE_KEYS.bookmarks] : [],
        config: Array.isArray(cfgStored[WEBDAV_BACKUP_STORAGE_KEYS.config]) ? cfgStored[WEBDAV_BACKUP_STORAGE_KEYS.config] : [],
        widgets: Array.isArray(wgtStored[WEBDAV_BACKUP_STORAGE_KEYS.widgets]) ? wgtStored[WEBDAV_BACKUP_STORAGE_KEYS.widgets] : []
      };

      const indexUrl = `${backupsRootUrl}/index.json`;
      const remoteIndexRes = await webdavGetJsonFile(indexUrl, headers);
      if (remoteIndexRes.ok) {
        const remoteIndex = remoteIndexRes.data?.data || {};
        const nextLocalBackups = {};
        const nextIndex = {};
        let localChanged = false;

        const stripData = (entry) => {
          const { data: _d, ...meta } = entry;
          return meta;
        };

        for (const type of backupTypes) {
          const localList = localBackups[type];
          const remoteMetaList = Array.isArray(remoteIndex[type]) ? remoteIndex[type] : [];
          const localByName = new Map(localList.map(e => [e.filename, e]));
          const remoteByName = new Map(remoteMetaList.map(e => [e.filename, e]));

          const mergedMeta = mergeBackupArrays(
            localList.map(stripData),
            remoteMetaList,
            retentionDays
          );
          const keptNames = new Set(mergedMeta.map(e => e.filename));

          // Upload new local backups not yet on remote
          for (const meta of mergedMeta) {
            if (!remoteByName.has(meta.filename) && localByName.has(meta.filename)) {
              const entry = localByName.get(meta.filename);
              const fileUrl = `${backupsRootUrl}/${type}/${encodeURIComponent(entry.filename)}`;
              await fetchWithTimeout(fileUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...headers },
                body: typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data || {})
              });
            }
          }

          // Delete expired remote backups that were pruned by retentionDays
          for (const rMeta of remoteMetaList) {
            if (!keptNames.has(rMeta.filename)) {
              const fileUrl = `${backupsRootUrl}/${type}/${encodeURIComponent(rMeta.filename)}`;
              try {
                await fetchWithTimeout(fileUrl, { method: "DELETE", headers });
              } catch {}
            }
          }

          // Reconstruct local list: download remote entries missing locally
          const finalLocalList = [];
          for (const meta of mergedMeta) {
            if (localByName.has(meta.filename)) {
              finalLocalList.push(localByName.get(meta.filename));
            } else {
              const fileUrl = `${backupsRootUrl}/${type}/${encodeURIComponent(meta.filename)}`;
              try {
                const fileRes = await fetchWithTimeout(fileUrl, { method: "GET", cache: "no-cache", headers });
                if (fileRes.ok) {
                  const dataText = await fileRes.text();
                  finalLocalList.push({ ...meta, data: dataText, sizeBytes: meta.sizeBytes ?? dataText.length });
                  localChanged = true;
                }
              } catch {}
            }
          }

          if (stableSerialize(finalLocalList.map(stripData)) !== stableSerialize(localList.map(stripData))) {
            localChanged = true;
          }
          nextLocalBackups[type] = finalLocalList;
          nextIndex[type] = mergedMeta;
        }

        if (localChanged) {
          await chrome.storage.local.set({
            [WEBDAV_BACKUP_STORAGE_KEYS.bookmarks]: nextLocalBackups.bookmarks,
            [WEBDAV_BACKUP_STORAGE_KEYS.config]: nextLocalBackups.config,
            [WEBDAV_BACKUP_STORAGE_KEYS.widgets]: nextLocalBackups.widgets
          });
        }

        if (remoteIndexRes.notFound || stableSerialize(nextIndex) !== stableSerialize(remoteIndex)) {
          await webdavPutJsonFile(indexUrl, headers, {
            updatedAt: Date.now(),
            data: nextIndex
          });
        }
      }
    } catch (err) {
      console.warn("syncWebdavFolderExtras: backups sync failed", err);
    }
  }

  currentConfig.sync.lastFolderExtrasSync = Date.now();
  await saveConfig(currentConfig);

  if (configChanged && typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("simpledial:config-synced", { detail: { config: currentConfig } }));
  }

  return { ok: true, configChanged };
}

let lastSyncErrorReason = null;

export function getLastSyncErrorReason() {
  return lastSyncErrorReason;
}

export function clearLastSyncErrorReason() {
  lastSyncErrorReason = null;
}

export async function syncNow(options = {}) {
  const config = await loadConfig();
  const includeManual = !!options?.includeManualExtras;

  if (!config.sync.enabled || (!config.sync.serverUrl && config.sync.type !== 'browser')) {
    console.warn("Sync not configured or disabled");
    lastSyncErrorReason = null;
    return { ok: false, reason: 'not-configured' };
  }

  const localHash = await getGroupsHash(state.groups, state.tags);
  const hasPendingPurges = Array.isArray(config.sync.pendingPurgedIds) && config.sync.pendingPurgedIds.length > 0;
  const hasPendingLocalChanges = !config.sync.lastSyncedLocalHash
    || config.sync.lastSyncedLocalHash !== localHash
    || hasPendingPurges;
  const remoteMarkerUnchanged = await checkRemoteMarkerUnchanged(config);
  const markerIsReliableForSkip = config.sync.remoteChangeHeaderType === 'sha256'
    || (config.sync.remoteChangeHeaderType === 'etag'
      && !(config.sync.lastSeenRemoteMarker || '').startsWith('W/'));
  if (!hasPendingLocalChanges && remoteMarkerUnchanged && markerIsReliableForSkip) {
    lastSyncErrorReason = null;
    if (config.sync.type === 'webdav' && config.sync.webdavMode === 'folder') {
      await syncWebdavFolderExtras(config, { includeManual });
    }
    return { ok: true, reason: 'remote-marker-unchanged', changed: false };
  }

  const readResult = await syncReadDetailed();
  if (!readResult.ok) {
    console.warn("Failed to read from sync server");
    lastSyncErrorReason = readResult.reason || 'sync-failed';
    return readResult;
  }

  const mergeResult = await mergeAndWriteAtomically(config, readResult.data.groups, 2, readResult.data.tags);
  lastSyncErrorReason = mergeResult.ok ? null : (mergeResult.reason || 'sync-failed');
  if (mergeResult.ok && config.sync.type === 'webdav' && config.sync.webdavMode === 'folder') {
    await syncWebdavFolderExtras(config, { includeManual });
  }
  return mergeResult;
}

// ─────────────────────────────────────────────────────────────
//  HOUSEKEEPING - CLEANUP DELETED ITEMS
// ─────────────────────────────────────────────────────────────

export async function cleanupDeletedItems(retentionDays) {
  let deletedCount = 0;
  const purgedIds = [];
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  for (const group of state.groups) {
    let groupChanged = false;
    // Filter out permanently deleted items
    const originalLength = group.items.length;
    group.items = group.items.filter(item => {
      if (item.deleted && item.deletedAt && item.deletedAt < cutoffTime) {
        deletedCount++;
        if (item.id) purgedIds.push(item.id);
        if (isStackItem(item) && Array.isArray(item.children)) {
          for (const child of item.children) {
            if (child?.id) purgedIds.push(child.id);
          }
        }
        return false; // Remove this item
      }
      if (isStackItem(item) && Array.isArray(item.children)) {
        const beforeChildren = item.children.length;
        item.children = item.children.filter(child => {
          if (child.deleted && child.deletedAt && child.deletedAt < cutoffTime) {
            deletedCount++;
            if (child.id) purgedIds.push(child.id);
            return false;
          }
          return true;
        });
        if (item.children.length < beforeChildren) {
          item.updatedAt = Date.now();
          groupChanged = true;
        }
      }
      return true;
    });

    for (const item of [...group.items]) {
      if (isStackItem(item)) {
        const res = cleanupStackIfNeeded(group, item);
        if (res === "removed" || res === "unwrapped") {
          if (item.id) purgedIds.push(item.id);
          groupChanged = true;
        }
      }
    }

    if (Array.isArray(group.sections)) {
      const beforeSections = group.sections.length;
      group.sections = group.sections.filter(sec => {
        if (sec.deleted && sec.deletedAt && sec.deletedAt < cutoffTime) {
          deletedCount++;
          if (sec.id) purgedIds.push(sec.id);
          return false;
        }
        return true;
      });
      if (group.sections.length < beforeSections) {
        groupChanged = true;
      }
    }

    if (group.items.length < originalLength || groupChanged) {
      group.updatedAt = Date.now();
    }
  }

  if (Array.isArray(state.tags)) {
    state.tags = state.tags.filter(tag => {
      if (tag?.deleted && tag.deletedAt && tag.deletedAt < cutoffTime) {
        deletedCount++;
        if (tag.id) purgedIds.push(tag.id);
        return false;
      }
      return true;
    });
  }

  if (deletedCount > 0) {
    await saveState();
    await syncWrite(state, { purgedIds });
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
  let changed = false;
  const urlsToCheck = [];

  // Collect all items with URLs to check
  for (const group of (state.groups || [])) {
    if (!group || group.deleted) continue;
    for (const item of getAllGroupBookmarks(group, { includeDeleted: false })) {
      if (item.url) {
        urlsToCheck.push({ item, url: item.url });
      }
    }
  }

  // Check links with reasonable parallelism (max 5 concurrent)
  for (let i = 0; i < urlsToCheck.length; i += 5) {
    const batch = urlsToCheck.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(({ url }) => validateLink(url))
    );

    results.forEach((isValid, index) => {
      const itemData = batch[index].item;
      if (setBookmarkSystemTag(itemData.id, SYSTEM_TAG_DEAD_LINK_ID, !isValid)) {
        changed = true;
      }
    });
  }

  const totalDead = (state.groups || []).reduce((sum, g) => {
    if (!g || g.deleted) return sum;
    return sum + getAllGroupBookmarks(g, { includeDeleted: false })
      .filter(i => getBookmarkSystemTagIds(i.id).includes(SYSTEM_TAG_DEAD_LINK_ID)).length;
  }, 0);

  if (changed) {
    await saveSystemTags();
  }

  return totalDead;
}
