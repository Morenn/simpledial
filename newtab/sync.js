import { state, saveState, isStackItem, getAllGroupBookmarks, cleanupStackIfNeeded, SYSTEM_TAG_DEAD_LINK_ID, getBookmarkSystemTagIds, setBookmarkSystemTag, saveSystemTags } from "./state.js";
import { loadConfig, saveConfig, defaultConfig, shouldSync, updateLastSyncTime, logDebug, DEFAULT_SYNC_INTERVAL, parseJsonSafely } from "./config.js";
import { importRawKey, decryptWithKey, getSecret } from './crypto.js';
import { withAutoBackupLock } from './backup-lock.js';
import { batchStorageGet } from './storage-cache.js';

const deadLinkDebugLog = (...args) => logDebug("deadLink", ...args);
const syncDebugLog = (...args) => logDebug("sync", ...args);
const webdavDebugLog = (...args) => logDebug("webdav", ...args);

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

function extractRemoteMarkerFromHeaders(headers, preferredType = null) {
  if (!headers || typeof headers.get !== 'function') return null;
  const typesToTry = preferredType
    ? [preferredType, ...REMOTE_MARKER_TYPES.filter(t => t !== preferredType)]
    : REMOTE_MARKER_TYPES;
  for (const type of typesToTry) {
    const raw = headers.get(REMOTE_MARKER_HEADERS[type]);
    if (isValidRemoteMarker(type, raw)) {
      let value = raw.trim();
      if (type === 'etag') {
        value = value.replace(/-gzip("?)$/i, '$1');
      }
      return { type, value };
    }
  }
  return null;
}

function applyRemoteMarkerToConfig(config, marker) {
  if (!config?.sync || !marker?.type || !marker?.value) return false;
  config.sync.remoteChangeHeaderType = marker.type;
  config.sync.lastSeenRemoteMarker = marker.value;
  config.sync.lastRemoteMarkerCheck = Date.now();
  return true;
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
  const credentials = options?.credentials?.ok
    ? options.credentials
    : await resolveSyncCredentials(resolvedCfg, 'syncRead');
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

      const marker = extractRemoteMarkerFromHeaders(res.headers, preferredType);
      if (marker) {
        syncDebugLog(`marker probe ${attempt.method} succeeded`, marker);
        return marker;
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
export async function probeSupportedRemoteMarkers(cfg = null, options = {}) {
  const resolvedCfg = cfg || await loadSyncConfig();
  if (!resolvedCfg || resolvedCfg.type === 'browser') {
    return null;
  }

  const url = getSyncFetchUrl(resolvedCfg.url, resolvedCfg.type, resolvedCfg);
  const credentials = options?.credentials?.ok
    ? options.credentials
    : await resolveSyncCredentials(resolvedCfg, 'syncRead');
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
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("speeddial:sync-status-changed"));
  }
}

const CLOUD_STORAGE_KEY = "myspeeddial-data";

function buildSyncConfigFromConfig(config) {
  if (!config?.sync?.serverUrl && config?.sync?.type !== 'browser') return null;
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
    remoteChangeHeaderType: config.sync.remoteChangeHeaderType ?? null,
    lastSync: config.sync.lastSync || 0
  };
}

export async function loadSyncConfig() {
  const config = await loadConfig();
  return buildSyncConfigFromConfig(config);
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

function isValidHttpSyncUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function testSyncConnection(url, username = '', password = '', type = 'direct', options = {}) {
  const webdavMode = options?.webdavMode === 'folder' ? 'folder' : 'file';
  const webdavFolderPath = options?.webdavFolderPath || '';
  const cfgObj = { type, webdavMode, webdavFolderPath };

  try {
    const endpoint = getSyncFetchUrl(url, type, cfgObj);

    // Validate URL format and restrict to http/https
    if (!isValidHttpSyncUrl(endpoint)) {
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
    if (!isValidHttpSyncUrl(endpoint)) {
      return { ok: false, reason: 'invalid-url' };
    }
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
  const defaultData = { groups: [], dbuid: generateDbUid() };

  let remoteEtag = '';
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
    remoteEtag = res.headers?.get?.('etag') || res.headers?.get?.('ETag') || '';
  } catch (e) {
    console.log("initializeRemote failed", e);
    if (e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network-or-cors' };
  }

  return {
    ok: true,
    reason: 'initialized-remote',
    remoteEtag,
    data: { ...defaultData, tags: [], tombstones: {}, tombstonePrunedBefore: 0 }
  };
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
      const obj = parseJsonSafely(plain);
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
      const obj = parseJsonSafely(res.value);
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

async function syncReadDetailed(cfg = null, options = {}) {
  const allowInitialize = options?.allowInitialize !== false;
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
          tags: Array.isArray(stored?.tags) ? stored.tags : [],
          dbuid: typeof stored?.dbuid === "string" ? stored.dbuid.trim() : "",
          tombstones: sanitizeTombstonesObject(stored?.tombstones),
          tombstonePrunedBefore: Number(stored?.tombstonePrunedBefore) > 0 ? Number(stored.tombstonePrunedBefore) : 0
        }
      };
    } catch (e) {
      console.error('syncRead(browser) failed', e);
      return { ok: false, reason: 'browser-sync-error' };
    }
  }

  const url = resolvedCfg.url;
  const fetchUrl = getSyncFetchUrl(url, resolvedCfg.type, resolvedCfg);

  if (!isValidHttpSyncUrl(fetchUrl)) {
    return { ok: false, reason: 'invalid-url' };
  }

  const credentials = options?.credentials?.ok
    ? options.credentials
    : await resolveSyncCredentials(resolvedCfg, 'syncRead');
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
      cache: resolvedCfg.type === 'webdav' ? "no-store" : "no-cache",
      headers
    });

    const redirectInfo = getAuthRedirectInfo(fetchUrl, res);
    if (redirectInfo) {
      await maybeOpenAuthRedirectTab(redirectInfo.redirectUrl);
      return { ok: false, ...redirectInfo };
    }

    if (res.status === 404) {
      if (!allowInitialize) {
        return { ok: false, reason: 'http-error', status: 404 };
      }
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
      if (!allowInitialize) {
        return { ok: false, reason: 'empty-response', status: res.status };
      }
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

    let parsed;
    try {
      parsed = parseJsonSafely(text);
    } catch (e) {
      console.warn("syncRead: invalid JSON → aborting without overwriting remote", { status: res.status });
      return { ok: false, reason: 'invalid-json', status: res.status };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.groups)) {
      console.warn("syncRead: invalid sync payload structure → aborting without overwriting remote", { status: res.status });
      return { ok: false, reason: 'invalid-json', status: res.status };
    }

    const remoteEtag = res.headers?.get?.('etag') || res.headers?.get?.('ETag') || '';
    if (resolvedCfg.type === 'webdav') {
      webdavDebugLog('bookmarks-db GET', {
        url: fetchUrl,
        status: res.status,
        etag: remoteEtag || null
      });
    }

    return {
      ok: true,
      reason: 'ok',
      remoteEtag,
      remoteMarker: extractRemoteMarkerFromHeaders(res.headers, resolvedCfg?.remoteChangeHeaderType || null),
      data: {
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        dbuid: typeof parsed.dbuid === "string" ? parsed.dbuid.trim() : "",
        tombstones: sanitizeTombstonesObject(parsed.tombstones),
        tombstonePrunedBefore: Number(parsed.tombstonePrunedBefore) > 0 ? Number(parsed.tombstonePrunedBefore) : 0
      }
    };

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

async function syncWriteDetailed(cfg = null, sourceGroups = null, sourceTags = null, options = {}) {
  const skipBootstrapGuard = !!options?.skipBootstrapGuard;
  const resolvedCfg = cfg || await loadSyncConfig();
  if (!resolvedCfg) {
    return { ok: false, reason: 'not-configured' };
  }

  const tagsToWrite = Array.isArray(sourceTags)
    ? sourceTags
    : (Array.isArray(state.tags) ? state.tags : []);
  const tombstonesToWrite = sanitizeTombstonesObject(options?.tombstones);
  const hasTombstones = Object.keys(tombstonesToWrite).length > 0;
  const prunedBeforeToWrite = Number(options?.tombstonePrunedBefore) > 0 ? Number(options.tombstonePrunedBefore) : 0;
  const dbuidToWrite = typeof options?.dbuid === "string" ? options.dbuid.trim() : "";

  if (resolvedCfg.type === 'browser') {
    try {
      const groupsToWrite = Array.isArray(sourceGroups) ? sourceGroups : state.groups;
      const syncPayload = { groups: groupsToWrite };
      if (tagsToWrite.length > 0) syncPayload.tags = tagsToWrite;
      if (dbuidToWrite) syncPayload.dbuid = dbuidToWrite;
      if (hasTombstones) syncPayload.tombstones = tombstonesToWrite;
      if (prunedBeforeToWrite > 0) syncPayload.tombstonePrunedBefore = prunedBeforeToWrite;
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

  if (!isValidHttpSyncUrl(fetchUrl)) {
    return { ok: false, reason: 'invalid-url' };
  }

  const credentials = options?.credentials?.ok
    ? options.credentials
    : await resolveSyncCredentials(resolvedCfg, 'syncWrite');
  if (!credentials.ok) {
    return credentials;
  }

  const credUser = credentials.username || '';
  const credPass = credentials.password || '';
  const groupsToWrite = Array.isArray(sourceGroups) ? sourceGroups : state.groups;
  const writePayload = { groups: groupsToWrite };
  if (tagsToWrite.length > 0) writePayload.tags = tagsToWrite;
  if (dbuidToWrite) writePayload.dbuid = dbuidToWrite;
  if (hasTombstones) writePayload.tombstones = tombstonesToWrite;
  if (prunedBeforeToWrite > 0) writePayload.tombstonePrunedBefore = prunedBeforeToWrite;
  const writeBody = JSON.stringify(writePayload);
  const lockRetryDelays = [400, 900, 1500];

  try {
    if (!skipBootstrapGuard && resolvedCfg.lastSync === 0 && isBootstrapPlaceholderState(groupsToWrite)) {
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
    const normalizedIfMatch = (resolvedCfg.type === 'webdav' && !options?.skipIfMatch)
      ? normalizeWebdavEtagForIfMatch(options?.expectedRemoteEtag)
      : '';
    if (normalizedIfMatch) {
      headers['If-Match'] = normalizedIfMatch;
    }

    let res = null;
    for (let attempt = 0; attempt <= lockRetryDelays.length; attempt++) {
      res = await fetchWithTimeout(fetchUrl, {
        method: "PUT",
        headers,
        body: writeBody
      });

      if (resolvedCfg.type === 'webdav') {
        webdavDebugLog('bookmarks-db PUT', {
          url: fetchUrl,
          status: res.status,
          ifMatch: normalizedIfMatch || null,
          etag: res.headers?.get?.('etag') || res.headers?.get?.('ETag') || null
        });
      }

      const redirectInfo = getAuthRedirectInfo(fetchUrl, res);
      if (redirectInfo) {
        await maybeOpenAuthRedirectTab(redirectInfo.redirectUrl);
        return { ok: false, ...redirectInfo };
      }

      if (res.ok) {
        return {
          ok: true,
          reason: 'ok',
          remoteMarker: extractRemoteMarkerFromHeaders(res.headers, resolvedCfg?.remoteChangeHeaderType || null)
        };
      }

      if (res.status === 412) {
        return { ok: false, reason: 'webdav-precondition-failed', status: 412 };
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

const TOMBSTONE_STORAGE_KEY = "myspeeddial-sync-tombstones";
const DANGEROUS_TOMBSTONE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_TOMBSTONES_HTTP = 500;
const MAX_TOMBSTONES_BROWSER = 100;
const CLOCK_SKEW_BUFFER_MS = 60 * 60 * 1000;
const FATAL_SYNC_PAUSE_THRESHOLD = 3;
const FATAL_SYNC_REASONS = new Set([
  "auth",
  "credentials-decrypt-failed",
  "invalid-url",
  "auth-redirect",
  "unexpected-html-response"
]);
const TRANSIENT_BACKOFF_STEPS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

function getTombstoneRetentionDays(config) {
  const baseDays = Math.max(1, Number(config?.housekeeper?.retentionDays) || 30);
  return Math.max(1, Math.round(baseDays * 1.5));
}

function getMaxTombstonesForSyncType(syncType) {
  return syncType === "browser" ? MAX_TOMBSTONES_BROWSER : MAX_TOMBSTONES_HTTP;
}

function sanitizeTombstonesMap(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  const entries = raw instanceof Map ? raw.entries() : Object.entries(raw);
  for (const [id, ts] of entries) {
    if (typeof id !== "string" || !id || DANGEROUS_TOMBSTONE_KEYS.has(id)) continue;
    const num = Number(ts);
    if (Number.isFinite(num) && num > 0) {
      map.set(id, num);
    }
  }
  return map;
}

function sanitizeTombstonesObject(raw) {
  return Object.fromEntries(sanitizeTombstonesMap(raw));
}

function generateDbUid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `db_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

async function loadLocalTombstoneState() {
  if (typeof chrome === "undefined" || !chrome?.storage?.local?.get) {
    return { dbuid: "", tombstones: new Map(), tombstonePrunedBefore: 0 };
  }
  try {
    const res = await chrome.storage.local.get(TOMBSTONE_STORAGE_KEY);
    const stored = res?.[TOMBSTONE_STORAGE_KEY];
    return {
      dbuid: typeof stored?.dbuid === "string" ? stored.dbuid.trim() : "",
      tombstones: sanitizeTombstonesMap(stored?.tombstones),
      tombstonePrunedBefore: Number(stored?.tombstonePrunedBefore) > 0 ? Number(stored.tombstonePrunedBefore) : 0
    };
  } catch {
    return { dbuid: "", tombstones: new Map(), tombstonePrunedBefore: 0 };
  }
}

async function saveLocalTombstoneState({ dbuid = "", tombstones, tombstonePrunedBefore }) {
  if (typeof chrome === "undefined" || !chrome?.storage?.local?.set) return;
  const payload = {
    dbuid: typeof dbuid === "string" ? dbuid.trim() : "",
    tombstones: sanitizeTombstonesObject(tombstones),
    tombstonePrunedBefore: Number(tombstonePrunedBefore) > 0 ? Number(tombstonePrunedBefore) : 0
  };
  await chrome.storage.local.set({ [TOMBSTONE_STORAGE_KEY]: payload });
}

export async function clearLocalTombstoneState({ resetDbUid = false } = {}) {
  const existing = resetDbUid ? null : await loadLocalTombstoneState();
  await saveLocalTombstoneState({
    dbuid: resetDbUid ? generateDbUid() : (existing?.dbuid || ""),
    tombstones: new Map(),
    tombstonePrunedBefore: 0
  });
}

export async function getLocalDbUid() {
  const localState = await loadLocalTombstoneState();
  return localState.dbuid || "";
}

function mergeTombstoneMaps(localMap, remoteMap) {
  const merged = new Map();
  for (const [id, ts] of sanitizeTombstonesMap(localMap)) {
    merged.set(id, ts);
  }
  for (const [id, ts] of sanitizeTombstonesMap(remoteMap)) {
    const prev = merged.get(id) || 0;
    if (ts > prev) merged.set(id, ts);
  }
  return merged;
}

function pruneTombstoneMap(tombstonesMap, currentPrunedBefore, { retentionDays, maxEntries, now = Date.now() }) {
  const cutoffMs = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  let maxPrunedTs = 0;
  const kept = [];

  for (const [id, ts] of sanitizeTombstonesMap(tombstonesMap)) {
    if (ts < cutoffMs) {
      if (ts > maxPrunedTs) maxPrunedTs = ts;
    } else {
      kept.push([id, ts]);
    }
  }

  if (maxEntries > 0 && kept.length > maxEntries) {
    kept.sort((a, b) => a[1] - b[1]);
    const excess = kept.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      if (kept[i][1] > maxPrunedTs) maxPrunedTs = kept[i][1];
    }
    kept.splice(0, excess);
  }

  return {
    tombstones: new Map(kept),
    tombstonePrunedBefore: Math.max(Number(currentPrunedBefore) || 0, maxPrunedTs)
  };
}

function getRecordActivityTimestamp(rec) {
  if (!rec || typeof rec !== "object") return 0;
  return rec.deleted ? (rec.deletedAt || rec.updatedAt || 0) : (rec.updatedAt || rec.createdAt || 0);
}

function applyTombstonesToData(groups = [], tags = [], tombstonesMap = new Map()) {
  if (!tombstonesMap || tombstonesMap.size === 0) {
    return {
      groups: Array.isArray(groups) ? groups : [],
      tags: Array.isArray(tags) ? tags : [],
      resurrectedIds: new Set()
    };
  }

  const resurrectedIds = new Set();
  const shouldKeepRecord = (rec) => {
    if (!rec?.id) return true;
    const purgedAt = tombstonesMap.get(rec.id);
    if (!purgedAt) return true;
    const recTs = getRecordActivityTimestamp(rec);
    if (recTs > purgedAt) {
      resurrectedIds.add(rec.id);
      return true;
    }
    return false;
  };

  const nextGroups = [];
  for (const group of (groups || [])) {
    if (!group || !shouldKeepRecord(group)) continue;
    const nextSections = Array.isArray(group.sections)
      ? group.sections.filter(sec => sec && shouldKeepRecord(sec))
      : undefined;

    const nextItems = [];
    for (const item of (group.items || [])) {
      if (!item || !shouldKeepRecord(item)) continue;
      if (isStackItem(item)) {
        const nextChildren = (item.children || []).filter(child => child && shouldKeepRecord(child));
        if (nextChildren.length === 0 && !item.deleted) continue;
        nextItems.push({ ...item, children: nextChildren });
      } else {
        nextItems.push(item);
      }
    }

    const nextGroup = { ...group, items: nextItems };
    if (nextSections !== undefined) nextGroup.sections = nextSections;
    nextGroups.push(nextGroup);
  }

  const nextTags = (tags || []).filter(tag => tag && shouldKeepRecord(tag));
  return { groups: nextGroups, tags: nextTags, resurrectedIds };
}

function findAmbiguousLocalOnlyRecords(localGroups = [], localTags = [], cloudGroups = [], cloudTags = [], tombstonePrunedBefore = 0) {
  if (!(tombstonePrunedBefore > 0)) return [];
  const cloudIds = collectLocalRecordIds(cloudGroups, cloudTags);
  const ambiguous = [];

  for (const group of (localGroups || [])) {
    if (!group?.id) continue;
    if (!cloudIds.has(group.id) && getRecordActivityTimestamp(group) <= tombstonePrunedBefore) {
      ambiguous.push({
        kind: "group",
        id: group.id,
        groupId: group.id,
        groupName: group.name || "",
        title: group.name || group.id,
        url: "",
        updatedAt: getRecordActivityTimestamp(group)
      });
    }
    for (const sec of (group.sections || [])) {
      if (sec?.id && !cloudIds.has(sec.id) && getRecordActivityTimestamp(sec) <= tombstonePrunedBefore) {
        ambiguous.push({
          kind: "section",
          id: sec.id,
          groupId: group.id,
          groupName: group.name || "",
          title: sec.name || sec.title || sec.id,
          url: "",
          updatedAt: getRecordActivityTimestamp(sec)
        });
      }
    }
    for (const item of (group.items || [])) {
      if (!item?.id) continue;
      if (!cloudIds.has(item.id) && getRecordActivityTimestamp(item) <= tombstonePrunedBefore) {
        ambiguous.push({
          kind: isStackItem(item) ? "stack" : "bookmark",
          id: item.id,
          groupId: group.id,
          groupName: group.name || "",
          title: item.title || item.url || item.id,
          url: item.url || "",
          updatedAt: getRecordActivityTimestamp(item)
        });
      }
      if (isStackItem(item)) {
        for (const child of (item.children || [])) {
          if (child?.id && !cloudIds.has(child.id) && getRecordActivityTimestamp(child) <= tombstonePrunedBefore) {
            ambiguous.push({
              kind: "bookmark",
              id: child.id,
              groupId: group.id,
              stackId: item.id,
              groupName: group.name || "",
              title: child.title || child.url || child.id,
              url: child.url || "",
              updatedAt: getRecordActivityTimestamp(child)
            });
          }
        }
      }
    }
  }

  for (const tag of (localTags || [])) {
    if (tag?.id && !cloudIds.has(tag.id) && getRecordActivityTimestamp(tag) <= tombstonePrunedBefore) {
      ambiguous.push({
        kind: "tag",
        id: tag.id,
        groupId: "",
        groupName: "",
        title: tag.name || tag.id,
        url: "",
        updatedAt: getRecordActivityTimestamp(tag)
      });
    }
  }

  return ambiguous;
}

function shouldTriggerStaleDeviceConflict(config, remotePrunedBefore, localGroups, localTags, cloudGroups, cloudTags) {
  if (!(config?.sync?.lastSync > 0) || !(remotePrunedBefore > 0)) {
    return { stale: false, ambiguousItems: [] };
  }
  if (config.sync.lastSync + CLOCK_SKEW_BUFFER_MS >= remotePrunedBefore) {
    return { stale: false, ambiguousItems: [] };
  }
  const ambiguousItems = findAmbiguousLocalOnlyRecords(localGroups, localTags, cloudGroups, cloudTags, remotePrunedBefore);
  return { stale: ambiguousItems.length > 0, ambiguousItems };
}

function applyStaleResolutionToLocalData(groups = [], tags = [], ambiguousIds = new Set(), { mode, keepIdSet = new Set(), now = Date.now() }) {
  const isKeptInSelective = (id) => mode === "selective" && !!id && keepIdSet.has(id);
  const dropUnselected = (rec, forceKeep = false) => {
    if (!rec?.id || !ambiguousIds.has(rec.id)) return { keep: true, rec };
    if (mode === "selective" && (forceKeep || keepIdSet.has(rec.id))) {
      return { keep: true, rec: { ...rec, updatedAt: Math.max(Number(rec.updatedAt) || 0, now) } };
    }
    return { keep: false, rec };
  };

  const nextGroups = [];
  for (const group of (groups || [])) {
    const hasSelectedDescendant = mode === "selective" && (
      (group.sections || []).some(s => isKeptInSelective(s?.id)) ||
      (group.items || []).some(item =>
        isKeptInSelective(item?.id) ||
        (isStackItem(item) && (item.children || []).some(c => isKeptInSelective(c?.id)))
      )
    );
    const gRes = dropUnselected(group, hasSelectedDescendant);
    if (!gRes.keep) continue;
    const nextSections = Array.isArray(gRes.rec.sections)
      ? gRes.rec.sections.map(s => dropUnselected(s)).filter(r => r.keep).map(r => r.rec)
      : undefined;
    const nextItems = [];
    for (const item of (gRes.rec.items || [])) {
      const hasSelectedChild = mode === "selective" && isStackItem(item) && (item.children || []).some(c => isKeptInSelective(c?.id));
      const iRes = dropUnselected(item, hasSelectedChild);
      if (!iRes.keep) continue;
      if (isStackItem(iRes.rec)) {
        const nextChildren = (iRes.rec.children || []).map(c => dropUnselected(c)).filter(r => r.keep).map(r => r.rec);
        if (nextChildren.length === 0 && !iRes.rec.deleted) continue;
        nextItems.push({ ...iRes.rec, children: nextChildren });
      } else {
        nextItems.push(iRes.rec);
      }
    }
    const nextGroup = { ...gRes.rec, items: nextItems };
    if (nextSections !== undefined) nextGroup.sections = nextSections;
    nextGroups.push(nextGroup);
  }
  const nextTags = (tags || []).map(t => dropUnselected(t)).filter(r => r.keep).map(r => r.rec);
  return { groups: nextGroups, tags: nextTags };
}

async function migratePendingPurgedIdsToTombstones(config, extraPurgedIds = [], now = Date.now()) {
  const legacyPending = Array.isArray(config?.sync?.pendingPurgedIds) ? config.sync.pendingPurgedIds : [];
  const incoming = Array.isArray(extraPurgedIds) ? extraPurgedIds : [];
  const ids = [...legacyPending, ...incoming].filter(id => typeof id === "string" && id && !DANGEROUS_TOMBSTONE_KEYS.has(id));
  const localState = await loadLocalTombstoneState();
  let changed = false;
  for (const id of ids) {
    if (!localState.tombstones.has(id)) {
      localState.tombstones.set(id, now);
      changed = true;
    }
  }
  if (changed) {
    await saveLocalTombstoneState(localState);
  }
  if (legacyPending.length > 0 && config?.sync) {
    config.sync.pendingPurgedIds = [];
  }
  return localState;
}

export async function clearSyncPauseState(config = null) {
  const cfg = config || await loadConfig();
  if (!cfg?.sync) return cfg;
  const hadPause = !!(cfg.sync.pausedReason || cfg.sync.consecutiveErrors || cfg.sync.nextRetryAt);
  cfg.sync.pausedReason = null;
  cfg.sync.consecutiveErrors = 0;
  cfg.sync.nextRetryAt = 0;
  if (!config && hadPause) {
    await saveConfig(cfg);
  }
  return cfg;
}

async function recordSyncResultForPause(config, result) {
  if (!config?.sync) return;
  if (result?.ok) {
    const hadState = !!(config.sync.pausedReason || config.sync.consecutiveErrors || config.sync.nextRetryAt);
    config.sync.pausedReason = null;
    config.sync.consecutiveErrors = 0;
    config.sync.nextRetryAt = 0;
    if (hadState) {
      await saveConfig(config);
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("speeddial:sync-status-changed"));
      }
    }
    return;
  }
  const reason = result?.reason || "sync-failed";
  if (reason === "not-configured" || reason === "sync-locked" || reason === "credentials-locked") {
    return;
  }
  config.sync.consecutiveErrors = (Number(config.sync.consecutiveErrors) || 0) + 1;
  if (reason === "stale-device-conflict" || reason === "dbuid-mismatch") {
    config.sync.pausedReason = reason;
    config.sync.nextRetryAt = 0;
  } else if (FATAL_SYNC_REASONS.has(reason)) {
    if (config.sync.consecutiveErrors >= FATAL_SYNC_PAUSE_THRESHOLD) {
      config.sync.pausedReason = reason;
    }
    config.sync.nextRetryAt = 0;
  } else {
    const stepIdx = Math.min(config.sync.consecutiveErrors - 1, TRANSIENT_BACKOFF_STEPS_MS.length - 1);
    config.sync.nextRetryAt = Date.now() + TRANSIENT_BACKOFF_STEPS_MS[stepIdx];
  }
  await saveConfig(config);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("speeddial:sync-status-changed"));
  }
}

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

const SYNC_LOCK_NAME = "simple-dial-sync";
let inTabSyncQueue = Promise.resolve();
let inTabSyncActive = false;

/**
 * Serializes sync operations within the tab and across extension tabs via Web Locks.
 */
export async function withSyncLock(task, { ifAvailable = false } = {}) {
  if (ifAvailable && inTabSyncActive) {
    return { skipped: true };
  }

  const runInTab = () => {
    const execute = async () => {
      inTabSyncActive = true;
      try {
        return await task();
      } finally {
        inTabSyncActive = false;
      }
    };
    const next = inTabSyncQueue.then(execute, execute);
    inTabSyncQueue = next.catch(() => {});
    return next;
  };

  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  if (locks && typeof locks.request === "function") {
    return locks.request(
      SYNC_LOCK_NAME,
      ifAvailable ? { mode: "exclusive", ifAvailable: true } : { mode: "exclusive" },
      async lock => {
        if (!lock) {
          return { skipped: true };
        }
        return await runInTab();
      }
    );
  }

  return await runInTab();
}

async function syncWriteLocked(sourceState = state, options = {}) {
  // do no sync if sync is disabled in config
  const config = await loadConfig();
  if (!config.sync.enabled) {
    return true; // sync disabled — nothing to do, not an error
  }

  const extraPurgedIds = Array.isArray(options?.purgedIds) ? options.purgedIds.filter(Boolean) : [];
  await migratePendingPurgedIdsToTombstones(config, extraPurgedIds);

  if ((!shouldSync(config) || config.sync.pausedReason) && !options?.force) {
    return true; // manual or paused mode — tombstones persisted locally, skip network sync until user triggers it
  }

  const groups = Array.isArray(sourceState?.groups) ? sourceState.groups : state.groups;
  const tags = Array.isArray(sourceState?.tags) ? sourceState.tags : (Array.isArray(state.tags) ? state.tags : []);
  const previousGroups = state.groups;
  const previousTags = state.tags;
  const forceSaveLocal = (groups !== previousGroups) || (tags !== previousTags);
  state.groups = groups;
  state.tags = tags;

  const readResult = await syncReadDetailed(buildSyncConfigFromConfig(config));
  if (!readResult.ok) {
    state.groups = previousGroups;
    state.tags = previousTags;
    await recordSyncResultForPause(config, readResult);
    return false;
  }

  const result = await mergeAndWriteAtomically(
    config,
    readResult.data.groups,
    2,
    readResult.data.tags,
    extraPurgedIds,
    {
      forceSaveLocal,
      initializedRemote: readResult.reason === "initialized-remote",
      cloudDbuid: readResult.data.dbuid,
      cloudTombstones: readResult.data.tombstones,
      cloudTombstonePrunedBefore: readResult.data.tombstonePrunedBefore
    }
  );
  if (!result.ok) {
    state.groups = previousGroups;
    state.tags = previousTags;
  }
  await recordSyncResultForPause(config, result);
  return result.ok;
}

export async function syncWrite(sourceState = state, options = {}) {
  return await withSyncLock(() => syncWriteLocked(sourceState, options));
}

export async function syncReadTest() {
  const result = await syncReadDetailed();
  if (result.ok) {
    result.supportedHeaders = await probeSupportedRemoteMarkers();
  }
  return result;
}

export async function syncWriteTest() {
  return await withSyncLock(async () => {
    const config = await loadConfig();
    const syncConfig = buildSyncConfigFromConfig(config);
    const tombstoneState = await loadLocalTombstoneState();
    return await syncWriteDetailed(syncConfig, state.groups, state.tags, {
      dbuid: tombstoneState.dbuid,
      tombstones: tombstoneState.tombstones,
      tombstonePrunedBefore: tombstoneState.tombstonePrunedBefore
    });
  });
}

function pickNewerGroupMeta(localGroup, cloudGroup) {
  const localTimestamp = localGroup.deleted ? (localGroup.deletedAt || 0) : (localGroup.updatedAt || 0);
  const cloudTimestamp = cloudGroup.deleted ? (cloudGroup.deletedAt || 0) : (cloudGroup.updatedAt || 0);
  if (localTimestamp !== cloudTimestamp) {
    return localTimestamp > cloudTimestamp ? localGroup : cloudGroup;
  }
  const { items: _li, sections: _ls, ...localMeta } = localGroup;
  const { items: _ci, sections: _cs, ...cloudMeta } = cloudGroup;
  return stableSerialize(localMeta) > stableSerialize(cloudMeta) ? localGroup : cloudGroup;
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
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

/**
 * Compares two JSON-compatible values ignoring object key order and undefined properties.
 */
function jsonValuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonValuesEqual(a[i] === undefined ? null : a[i], b[i] === undefined ? null : b[i])) {
        return false;
      }
    }
    return true;
  }

  let aDefinedCount = 0;
  for (const key of Object.keys(a)) {
    const val = a[key];
    if (val === undefined) continue;
    aDefinedCount++;
    if (b[key] === undefined || !jsonValuesEqual(val, b[key])) {
      return false;
    }
  }

  let bDefinedCount = 0;
  for (const key of Object.keys(b)) {
    if (b[key] !== undefined) bDefinedCount++;
  }
  return aDefinedCount === bDefinedCount;
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

function mergeRecordArrays(localRecords = [], cloudRecords = [], { preferCloudOrder = false } = {}) {
  const localMap = new Map((localRecords || []).filter(Boolean).map(r => [r.id, r]));
  const cloudMap = new Map((cloudRecords || []).filter(Boolean).map(r => [r.id, r]));
  const allIds = preferCloudOrder
    ? new Set([...cloudMap.keys(), ...localMap.keys()])
    : new Set([...localMap.keys(), ...cloudMap.keys()]);
  const merged = [];

  for (const id of allIds) {
    const localRec = localMap.get(id);
    const cloudRec = cloudMap.get(id);
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

function getRecordsFreshness(records = []) {
  let maxTs = 0;
  for (const rec of (records || [])) {
    if (!rec) continue;
    const ts = rec.deleted ? (rec.deletedAt || 0) : (rec.updatedAt || 0);
    if (ts > maxTs) maxTs = ts;
  }
  return maxTs;
}

function mergeTags(localTags = [], cloudTags = []) {
  const localFreshness = getRecordsFreshness(localTags);
  const cloudFreshness = getRecordsFreshness(cloudTags);
  const preferCloudOrder = cloudFreshness !== localFreshness
    ? cloudFreshness > localFreshness
    : stableSerialize(cloudTags || []) > stableSerialize(localTags || []);
  return mergeRecordArrays(localTags, cloudTags, { preferCloudOrder });
}

function mergeStackItems(localStack, cloudStack) {
  const baseStack = pickNewerRecord(localStack, cloudStack);
  const mergedChildren = mergeRecordArrays(localStack.children || [], cloudStack.children || [], {
    preferCloudOrder: baseStack === cloudStack
  });
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
  const localGroupMap = new Map((localGroups || []).map(group => [group.id, group]));
  const cloudGroupMap = new Map((cloudGroups || []).map(group => [group.id, group]));
  const localGroupFreshness = getGroupsFreshness(localGroups);
  const cloudGroupFreshness = getGroupsFreshness(cloudGroups);
  const preferCloudGroupOrder = cloudGroupFreshness !== localGroupFreshness
    ? cloudGroupFreshness > localGroupFreshness
    : stableSerialize(cloudGroups || []) > stableSerialize(localGroups || []);
  const allGroupIds = preferCloudGroupOrder
    ? new Set([...cloudGroupMap.keys(), ...localGroupMap.keys()])
    : new Set([...localGroupMap.keys(), ...cloudGroupMap.keys()]);

  const mergedGroupMeta = new Map();
  const preferCloudItemOrderByGroupId = new Map();
  for (const id of allGroupIds) {
    const localGroup = localGroupMap.get(id);
    const cloudGroup = cloudGroupMap.get(id);

    if (localGroup && !cloudGroup) {
      mergedGroupMeta.set(id, { ...localGroup, items: [] });
      preferCloudItemOrderByGroupId.set(id, false);
      continue;
    }
    if (!localGroup && cloudGroup) {
      mergedGroupMeta.set(id, { ...cloudGroup, items: [] });
      preferCloudItemOrderByGroupId.set(id, true);
      continue;
    }

    const winningMeta = pickNewerGroupMeta(localGroup, cloudGroup);
    const preferCloud = winningMeta === cloudGroup;
    preferCloudItemOrderByGroupId.set(id, preferCloud);
    const nextGroup = { ...winningMeta, items: [] };
    if (Array.isArray(localGroup.sections) || Array.isArray(cloudGroup.sections)) {
      nextGroup.sections = mergeRecordArrays(localGroup.sections || [], cloudGroup.sections || [], {
        preferCloudOrder: preferCloud
      });
    }
    mergedGroupMeta.set(id, nextGroup);
  }

  // ---- Merge items GLOBALLY by id, tracking stack membership & cross-group moves ----
  const localItemIndex = new Map();
  const cloudItemIndex = new Map();
  const localChildIndex = new Map();
  const cloudChildIndex = new Map();

  for (const group of (localGroups || [])) {
    for (const item of (group.items || [])) {
      localItemIndex.set(item.id, { item, groupId: group.id });
      if (isStackItem(item)) {
        for (const child of (item.children || [])) {
          if (child?.id) {
            localChildIndex.set(child.id, { child, stackId: item.id, groupId: group.id });
          }
        }
      }
    }
  }
  for (const group of (cloudGroups || [])) {
    for (const item of (group.items || [])) {
      cloudItemIndex.set(item.id, { item, groupId: group.id });
      if (isStackItem(item)) {
        for (const child of (item.children || [])) {
          if (child?.id) {
            cloudChildIndex.set(child.id, { child, stackId: item.id, groupId: group.id });
          }
        }
      }
    }
  }

  const allItemIds = new Set([...localItemIndex.keys(), ...cloudItemIndex.keys()]);
  const promotedTopLevelBookmarkIds = new Set();

  for (const itemId of allItemIds) {
    const localEntry = localItemIndex.get(itemId);
    const cloudEntry = cloudItemIndex.get(itemId);

    let winner, winningGroupId;

    if (localEntry && !cloudEntry) {
      winner = localEntry.item;
      winningGroupId = localEntry.groupId;

      if (!isStackItem(winner) && cloudChildIndex.has(itemId)) {
        const stackedVersion = cloudChildIndex.get(itemId).child;
        if (pickNewerRecord(winner, stackedVersion) === stackedVersion) {
          continue; // Stale top-level bookmark was moved into a stack remotely
        }
        promotedTopLevelBookmarkIds.add(itemId);
      }
    } else if (!localEntry && cloudEntry) {
      winner = cloudEntry.item;
      winningGroupId = cloudEntry.groupId;

      if (!isStackItem(winner) && localChildIndex.has(itemId)) {
        const stackedVersion = localChildIndex.get(itemId).child;
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

    const targetGroup = mergedGroupMeta.get(winningGroupId);
    if (targetGroup) {
      targetGroup.items.push(winner);
    }
  }

  const supersededStackChildren = new Map();
  for (const [childId, localChildEntry] of localChildIndex.entries()) {
    const cloudChildEntry = cloudChildIndex.get(childId);
    if (!cloudChildEntry || localChildEntry.stackId === cloudChildEntry.stackId) continue;
    const losingStackId = pickNewerRecord(localChildEntry.child, cloudChildEntry.child) === localChildEntry.child
      ? cloudChildEntry.stackId
      : localChildEntry.stackId;
    if (!supersededStackChildren.has(losingStackId)) {
      supersededStackChildren.set(losingStackId, new Set());
    }
    supersededStackChildren.get(losingStackId).add(childId);
  }

  // Strip bookmarks that moved back to top-level or to another stack from any stale stack snapshot,
  // and remove dissolved empty non-deleted stacks.
  if (promotedTopLevelBookmarkIds.size > 0 || supersededStackChildren.size > 0) {
    for (const group of mergedGroupMeta.values()) {
      const nextItems = [];
      for (const item of group.items) {
        if (!isStackItem(item)) {
          nextItems.push(item);
          continue;
        }
        const movedFromThisStack = supersededStackChildren.get(item.id);
        const nextChildren = (item.children || []).filter(
          c => !promotedTopLevelBookmarkIds.has(c.id) && !(movedFromThisStack && movedFromThisStack.has(c.id))
        );
        if (nextChildren.length === 0 && !item.deleted) {
          continue;
        }
        nextItems.push({ ...item, children: nextChildren });
      }
      group.items = nextItems;
    }
  }

  // Re-order each group's items according to the newer group snapshot's item order
  // (appending any newly added or cross-group-moved items in their relative order).
  for (const [groupId, mergedGroup] of mergedGroupMeta.entries()) {
    const primarySource = preferCloudItemOrderByGroupId.get(groupId)
      ? cloudGroupMap.get(groupId)
      : localGroupMap.get(groupId);
    const primaryOrder = (primarySource?.items || []).map(i => i?.id).filter(Boolean);
    if (primaryOrder.length > 0 && mergedGroup.items.length > 1) {
      const rank = new Map(primaryOrder.map((id, idx) => [id, idx]));
      mergedGroup.items.sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
        return ra - rb;
      });
    }
  }

  return Array.from(mergedGroupMeta.values());
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

async function getGroupsHash(groups, tags = [], tombstoneState = null) {
  const hasTombstones = tombstoneState?.tombstones && (
    tombstoneState.tombstones instanceof Map
      ? tombstoneState.tombstones.size > 0
      : Object.keys(tombstoneState.tombstones).length > 0
  );
  const prunedBefore = Number(tombstoneState?.tombstonePrunedBefore) > 0 ? Number(tombstoneState.tombstonePrunedBefore) : 0;
  const dbuid = typeof tombstoneState?.dbuid === "string" ? tombstoneState.dbuid.trim() : "";
  let payload;
  if (hasTombstones || prunedBefore > 0 || dbuid) {
    payload = { groups: groups || [], tags: Array.isArray(tags) ? tags : [] };
    if (dbuid) payload.dbuid = dbuid;
    if (hasTombstones) payload.tombstones = sanitizeTombstonesObject(tombstoneState.tombstones);
    if (prunedBefore > 0) payload.tombstonePrunedBefore = prunedBefore;
  } else {
    payload = Array.isArray(tags) && tags.length > 0 ? { groups: groups || [], tags } : (groups || []);
  }
  const data = new TextEncoder().encode(stableSerialize(payload));
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

async function mergeAndWriteAtomically(config, cloudGroups, browserConflictRetries = 2, cloudTags = [], extraPurgedIds = [], options = {}) {
  const forceSaveLocal = !!options?.forceSaveLocal;
  const staleResolution = options?.staleResolution || null;
  const staleKeepIdSet = new Set(Array.isArray(options?.keepIds) ? options.keepIds.filter(Boolean) : []);
  const previousGroups = state.groups;
  const previousTags = Array.isArray(state.tags) ? state.tags : [];
  const resolvedCloudTags = Array.isArray(cloudTags) ? cloudTags : [];

  const localTombstoneState = await migratePendingPurgedIdsToTombstones(config, extraPurgedIds);
  const cloudTombstonesMap = sanitizeTombstonesMap(options?.cloudTombstones);
  const cloudPrunedBefore = Number(options?.cloudTombstonePrunedBefore) > 0 ? Number(options.cloudTombstonePrunedBefore) : 0;
  const localDbuid = localTombstoneState.dbuid || "";
  const remoteDbuid = typeof options?.cloudDbuid === "string" ? options.cloudDbuid.trim() : "";
  const isBootstrap = !config.sync?.lastSync && !config.sync?.lastSyncedLocalHash && isBootstrapPlaceholderState(previousGroups);

  let workingLocalGroups = previousGroups;
  let workingLocalTags = previousTags;

  if (!staleResolution) {
    const hasDbuidMismatch = !options?.initializedRemote && (
      (!!localDbuid && !!remoteDbuid && localDbuid !== remoteDbuid)
      || (!localDbuid && !!remoteDbuid && !config.sync?.lastSync && !isBootstrap && hasMeaningfulGroups(previousGroups))
    );
    if (hasDbuidMismatch) {
      return {
        ok: false,
        reason: "dbuid-mismatch",
        localDbuid,
        remoteDbuid
      };
    }

    const staleCheck = shouldTriggerStaleDeviceConflict(
      config,
      cloudPrunedBefore,
      workingLocalGroups,
      workingLocalTags,
      cloudGroups || [],
      resolvedCloudTags
    );
    if (staleCheck.stale) {
      return {
        ok: false,
        reason: "stale-device-conflict",
        lastSync: config.sync?.lastSync || 0,
        tombstonePrunedBefore: cloudPrunedBefore,
        ambiguousCount: staleCheck.ambiguousItems.length
      };
    }
  } else if (staleResolution === "smart" || staleResolution === "selective") {
    const cutoffForReview = cloudPrunedBefore > 0 ? cloudPrunedBefore : Number.MAX_SAFE_INTEGER;
    const ambiguous = findAmbiguousLocalOnlyRecords(
      workingLocalGroups,
      workingLocalTags,
      cloudGroups || [],
      resolvedCloudTags,
      cutoffForReview
    );
    const ambiguousIds = new Set(ambiguous.map(item => item.id));
    if (staleResolution === "selective" || cloudPrunedBefore > 0) {
      const resolvedLocal = applyStaleResolutionToLocalData(workingLocalGroups, workingLocalTags, ambiguousIds, {
        mode: staleResolution,
        keepIdSet: staleKeepIdSet
      });
      workingLocalGroups = resolvedLocal.groups;
      workingLocalTags = resolvedLocal.tags;
    }
  }

  let nextDbuid = localDbuid;
  if (staleResolution) {
    nextDbuid = remoteDbuid || localDbuid || generateDbUid();
  } else if (remoteDbuid && (!localDbuid || isBootstrap)) {
    nextDbuid = remoteDbuid;
  } else if (!nextDbuid && options?.force) {
    nextDbuid = generateDbUid();
  }

  let mergedTombstonesMap = mergeTombstoneMaps(localTombstoneState.tombstones, cloudTombstonesMap);
  const combinedPrunedBefore = Math.max(localTombstoneState.tombstonePrunedBefore || 0, cloudPrunedBefore);

  // Backward-compatible fallback for explicit purgedIds if not yet in tombstones
  const combinedPurgedIds = new Set([
    ...(Array.isArray(config.sync?.pendingPurgedIds) ? config.sync.pendingPurgedIds : []),
    ...(Array.isArray(extraPurgedIds) ? extraPurgedIds : [])
  ]);
  const localIds = collectLocalRecordIds(workingLocalGroups, workingLocalTags);
  const purgedIdsToStrip = new Set(Array.from(combinedPurgedIds).filter(id => id && !localIds.has(id)));
  const strippedCloudFallback = stripPurgedIdsFromCloudData(cloudGroups || [], resolvedCloudTags, purgedIdsToStrip);

  const localAfterTombstones = applyTombstonesToData(workingLocalGroups, workingLocalTags, mergedTombstonesMap);
  const cloudAfterTombstones = applyTombstonesToData(
    strippedCloudFallback.groups,
    strippedCloudFallback.tags,
    mergedTombstonesMap
  );

  for (const id of [...localAfterTombstones.resurrectedIds, ...cloudAfterTombstones.resurrectedIds]) {
    mergedTombstonesMap.delete(id);
  }

  const prunedState = pruneTombstoneMap(mergedTombstonesMap, combinedPrunedBefore, {
    retentionDays: getTombstoneRetentionDays(config),
    maxEntries: getMaxTombstonesForSyncType(config.sync?.type)
  });
  mergedTombstonesMap = prunedState.tombstones;
  const nextPrunedBefore = prunedState.tombstonePrunedBefore;
  const nextTombstonesObj = sanitizeTombstonesObject(mergedTombstonesMap);

  const effectiveLocalGroups = localAfterTombstones.groups;
  const effectiveLocalTags = localAfterTombstones.tags;
  const effectiveCloudGroups = cloudAfterTombstones.groups;
  const effectiveCloudTags = cloudAfterTombstones.tags;

  const localFreshness = getGroupsFreshness(effectiveLocalGroups);
  const cloudFreshness = getGroupsFreshness(effectiveCloudGroups);
  const localIsMoreRecent = localFreshness > cloudFreshness;

  const isInitialUnseededSync = !config.sync?.lastSync && !config.sync?.lastSyncedLocalHash && purgedIdsToStrip.size === 0 && mergedTombstonesMap.size === 0;
  const mergedGroups = mergeGroups(effectiveLocalGroups, effectiveCloudGroups, { preferCloudOnBootstrap: isInitialUnseededSync });
  const mergedTags = mergeTags(effectiveLocalTags, effectiveCloudTags);

  const groupsChanged = !jsonValuesEqual(previousGroups, mergedGroups);
  const tagsChanged = !jsonValuesEqual(previousTags, mergedTags);
  const changed = groupsChanged || tagsChanged;

  const tombstonesChangedLocally = !jsonValuesEqual(sanitizeTombstonesObject(localTombstoneState.tombstones), nextTombstonesObj)
    || (localTombstoneState.tombstonePrunedBefore || 0) !== nextPrunedBefore
    || (localDbuid || "") !== (nextDbuid || "");

  const remoteGroupsNeedUpdate = !jsonValuesEqual(cloudGroups || [], mergedGroups);
  const remoteTagsNeedUpdate = !jsonValuesEqual(resolvedCloudTags, mergedTags);
  const remoteTombstonesNeedUpdate = !jsonValuesEqual(sanitizeTombstonesObject(cloudTombstonesMap), nextTombstonesObj)
    || cloudPrunedBefore !== nextPrunedBefore
    || (!!nextDbuid && remoteDbuid !== nextDbuid);
  const remoteNeedsUpdate = remoteGroupsNeedUpdate || remoteTagsNeedUpdate || remoteTombstonesNeedUpdate;

  if (changed || remoteNeedsUpdate) {
    logDebug("syncMergeDiff", previousGroups, mergedGroups, previousTags, mergedTags, {
      changed,
      groupsChanged,
      tagsChanged,
      remoteNeedsUpdate,
      remoteTombstonesNeedUpdate
    });
  }

  if (!changed && !remoteNeedsUpdate) {
    if (forceSaveLocal) {
      await saveState();
    }
    if (tombstonesChangedLocally) {
      await saveLocalTombstoneState({ dbuid: nextDbuid, tombstones: mergedTombstonesMap, tombstonePrunedBefore: nextPrunedBefore });
    }
    if (config.sync) config.sync.pendingPurgedIds = [];
    config.sync.lastSyncedLocalHash = (!changed && !tombstonesChangedLocally && options?.precomputedLocalHash)
      ? options.precomputedLocalHash
      : await getGroupsHash(state.groups, state.tags, {
        dbuid: nextDbuid,
        tombstones: mergedTombstonesMap,
        tombstonePrunedBefore: nextPrunedBefore
      });
    await updateLastSyncTime(config);
    return { ok: true, reason: 'no-changes', changed: forceSaveLocal };
  }

  if (groupsChanged) {
    state.groups = mergedGroups;
  }
  if (tagsChanged) {
    state.tags = mergedTags;
  }

  let writeResult = null;
  if (remoteNeedsUpdate) {
    if (!nextDbuid) {
      nextDbuid = generateDbUid();
    }
    const syncCfg = buildSyncConfigFromConfig(config);
    writeResult = await syncWriteDetailed(
      { ...syncCfg, lastSync: Date.now() },
      state.groups,
      state.tags,
      {
        dbuid: nextDbuid,
        tombstones: nextTombstonesObj,
        tombstonePrunedBefore: nextPrunedBefore,
        expectedRemoteEtag: options?.remoteEtag || '',
        skipIfMatch: !!options?.force,
        credentials: options?.credentials
      }
    );

    if (!writeResult.ok) {
      // Never keep a merged local state that failed to persist remotely.
      state.groups = previousGroups;
      state.tags = previousTags;

      if ((writeResult.reason === 'browser-sync-conflict' || writeResult.reason === 'webdav-precondition-failed') && browserConflictRetries > 0) {
        if (writeResult.reason === 'webdav-precondition-failed') {
          webdavDebugLog('bookmarks-db 412 precondition failed; re-reading and re-merging', {
            retriesLeft: browserConflictRetries - 1
          });
        }
        const latestRemote = await syncReadDetailed(null, { credentials: options?.credentials });
        if (!latestRemote.ok) {
          return latestRemote;
        }
        applyRemoteMarkerToConfig(config, latestRemote.remoteMarker);
        return await mergeAndWriteAtomically(
          config,
          latestRemote.data.groups,
          browserConflictRetries - 1,
          latestRemote.data.tags,
          extraPurgedIds,
          {
            ...options,
            remoteEtag: latestRemote.remoteEtag || '',
            cloudDbuid: latestRemote.data.dbuid,
            cloudTombstones: latestRemote.data.tombstones,
            cloudTombstonePrunedBefore: latestRemote.data.tombstonePrunedBefore
          }
        );
      }

      if (localIsMoreRecent) {
        console.warn('sync: preserving newer local state because remote write failed');
      }

      return writeResult;
    }

    if (writeResult.remoteMarker) {
      applyRemoteMarkerToConfig(config, writeResult.remoteMarker);
    } else if (config.sync?.type && config.sync.type !== 'browser' && config.sync.remoteChangeHeaderType) {
      const postWriteMarker = await getRemoteChangeMarker(syncCfg, {
        allowFallback: false,
        preferredType: config.sync.remoteChangeHeaderType
      });
      if (!applyRemoteMarkerToConfig(config, postWriteMarker)) {
        config.sync.lastSeenRemoteMarker = '';
      }
    }
  }

  if (changed || forceSaveLocal) {
    await saveState();
  }
  if (tombstonesChangedLocally || remoteNeedsUpdate) {
    await saveLocalTombstoneState({ dbuid: nextDbuid, tombstones: mergedTombstonesMap, tombstonePrunedBefore: nextPrunedBefore });
  }
  if (config.sync) config.sync.pendingPurgedIds = [];
  config.sync.lastSyncedLocalHash = await getGroupsHash(state.groups, state.tags, {
    dbuid: nextDbuid,
    tombstones: mergedTombstonesMap,
    tombstonePrunedBefore: nextPrunedBefore
  });
  await updateLastSyncTime(config);
  return { ok: true, reason: writeResult?.reason || 'no-changes', changed };
}

// ─────────────────────────────────────────────────────────────
//  PERIODIC SYNC
// ─────────────────────────────────────────────────────────────
let activeSyncLoopResetter = null;

function resetSyncLoopTimer() {
  if (typeof activeSyncLoopResetter === "function") {
    activeSyncLoopResetter();
  }
}

export function startSyncLoop(options = {}) {
  const shouldSkip = (typeof options.shouldSkip === "function") ? options.shouldSkip : null;
  const initialDelayMs = Math.max(0, Number(options.initialDelayMs) || 0);
  let isSyncing = false;

  const runSyncLoop = async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (shouldSkip && shouldSkip()) return;
    if (isSyncing) return;
    isSyncing = true;

    try {
      const config = await loadConfig();
      if (!config.sync.enabled) return;
      if (!shouldSync(config)) return;
      if (config.sync.pausedReason) return;
      if (config.sync.nextRetryAt && Date.now() < config.sync.nextRetryAt) return;
      if (config.sync.lastSync && (Date.now() - config.sync.lastSync) < DEFAULT_SYNC_INTERVAL) {
        return;
      }

      const result = await syncNow({ ifAvailable: true });
      if (result.ok && result.reason === 'sync-locked') {
        return;
      }
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

  // Run periodic sync check every 60 seconds (skipped when any tab synced within the last 60s)
  let syncLoopTimerId = setInterval(runSyncLoop, DEFAULT_SYNC_INTERVAL);
  activeSyncLoopResetter = () => {
    clearInterval(syncLoopTimerId);
    syncLoopTimerId = setInterval(runSyncLoop, DEFAULT_SYNC_INTERVAL);
  };
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
export async function checkRemoteMarkerUnchanged(config, options = {}) {
  if (!config || config.sync.type === 'browser') return false;

  resetRemoteMarkerStateIfUrlChanged(config);
  const preferredType = config.sync.remoteChangeHeaderType || null;
  const resolvedSyncCfg = options?.syncCfg || buildSyncConfigFromConfig(config);
  const marker = await getRemoteChangeMarker(resolvedSyncCfg, {
    allowFallback: true,
    preferredType,
    credentials: options?.credentials
  });

  if (!marker) {
    logRemoteMarkerCapabilityChange(config, false);
    syncDebugLog('marker check result', { type: null, skipped: false, reason: 'no usable change marker from backend' });
    config.sync.remoteChangeHeaderType = false;
    config.sync.lastSeenRemoteMarker = '';
    config.sync.lastRemoteMarkerCheck = Date.now();
    if (!options?.deferSave) {
      await saveConfig(config);
    }
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
  applyRemoteMarkerToConfig(config, marker);
  return false;
}

const WEBDAV_BACKUP_STORAGE_KEYS = {
  bookmarks: "myspeeddial-backups",
  config: "myspeeddial-backups-config"
};

async function webdavGetJsonFile(fileUrl, headers) {
  try {
    const res = await fetchWithTimeout(fileUrl, {
      method: "GET",
      cache: "no-store",
      headers
    });
    const etag = res.headers?.get?.("etag") || res.headers?.get?.("ETag") || "";
    if (res.status === 404) {
      webdavDebugLog("GET", { url: fileUrl, status: 404, notFound: true });
      return { ok: true, notFound: true, data: null, etag: "" };
    }
    if (!res.ok) {
      webdavDebugLog("GET failed", { url: fileUrl, status: res.status });
      return { ok: false, status: res.status, etag };
    }
    const text = await res.text();
    const data = text.trim() ? parseJsonSafely(text) : null;
    webdavDebugLog("GET", { url: fileUrl, status: res.status, etag: etag || null, updatedAt: data?.updatedAt ?? null });
    return { ok: true, notFound: false, data, etag };
  } catch (err) {
    webdavDebugLog("GET error", { url: fileUrl, error: err?.message || String(err) });
    return { ok: false, error: err };
  }
}

function normalizeWebdavEtagForIfMatch(etag) {
  if (typeof etag !== "string") return "";
  const trimmed = etag.trim();
  if (!trimmed) return "";
  // Strip weak ETag prefix and Apache/Nginx mod_deflate "-gzip" suffix inside quotes
  return trimmed.replace(/^W\//i, "").replace(/-gzip("?)$/i, "$1");
}

async function webdavPutJsonFile(fileUrl, headers, payload, options = {}) {
  try {
    const putHeaders = { "Content-Type": "application/json", ...headers };
    const normalizedIfMatch = normalizeWebdavEtagForIfMatch(options.ifMatch);
    if (normalizedIfMatch) {
      putHeaders["If-Match"] = normalizedIfMatch;
    } else if (options.ifNoneMatch) {
      putHeaders["If-None-Match"] = options.ifNoneMatch;
    }
    const res = await fetchWithTimeout(fileUrl, {
      method: "PUT",
      headers: putHeaders,
      body: JSON.stringify(payload)
    });
    const etag = res.headers?.get?.("etag") || res.headers?.get?.("ETag") || "";
    webdavDebugLog("PUT", {
      url: fileUrl,
      status: res.status,
      ifMatch: normalizedIfMatch || null,
      ifNoneMatch: options.ifNoneMatch || null,
      etag: etag || null,
      updatedAt: payload?.updatedAt ?? null
    });
    return { ok: res.ok, status: res.status, preconditionFailed: res.status === 412, etag };
  } catch (err) {
    webdavDebugLog("PUT error", { url: fileUrl, error: err?.message || String(err) });
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
      ? a.customWidgets.map(w => {
          if (!w || typeof w !== "object") return w;
          if (!("authHeaderValue" in w) && !("apiKey" in w) && !("disabled" in w)) return w;
          const sanitized = { ...w };
          if ("authHeaderValue" in sanitized) sanitized.authHeaderValue = "";
          if ("apiKey" in sanitized) sanitized.apiKey = "";
          if ("disabled" in sanitized) delete sanitized.disabled;
          return sanitized;
        })
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

function isSafeBackupFilename(filename) {
  if (typeof filename !== "string") return false;
  const trimmed = filename.trim();
  if (!trimmed || trimmed.length > 255) return false;
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) return false;
  if (/[\\/\x00-\x1f\x7f%]/.test(trimmed)) return false;
  return true;
}

function mergeBackupArrays(localList = [], remoteList = [], retentionDays = 14, now = Date.now()) {
  const byFilename = new Map();
  for (const entry of [...(Array.isArray(localList) ? localList : []), ...(Array.isArray(remoteList) ? remoteList : [])]) {
    if (!entry || !isSafeBackupFilename(entry.filename)) continue;
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

const WEBDAV_EXTRA_SECTION_SPECS = {
  config: {
    filename: "config.json",
    syncFlag: "webdavSyncConfig",
    modeField: "webdavConfigMode",
    buildPayload: (cfg) => buildConfigExtraPayload(cfg),
    applyRemote: (cfg, remoteData) => {
      if (remoteData?.appearance) {
        const { showDeleted: _sd, lockTiles: _lt, ...remoteAppearance } = remoteData.appearance;
        cfg.appearance = { ...cfg.appearance, ...remoteAppearance };
      }
      if (remoteData?.housekeeper) {
        const { lastCleanup: _lc, lastLinkCheck: _llc, ...remoteHk } = remoteData.housekeeper;
        cfg.housekeeper = { ...cfg.housekeeper, ...remoteHk };
      }
      if (remoteData?.backups) {
        const { lastAutoBackup: _lab, ...remoteBackups } = remoteData.backups;
        cfg.backups = { ...cfg.backups, ...remoteBackups };
      }
    }
  },
  widgets: {
    filename: "widgets.json",
    syncFlag: "webdavSyncWidgets",
    modeField: "webdavWidgetsMode",
    buildPayload: (cfg) => buildWidgetsExtraPayload(cfg),
    applyRemote: (cfg, remoteData) => {
      if (remoteData && typeof remoteData === "object") {
        const localById = new Map(
          (cfg.appearance?.customWidgets || [])
            .filter(w => w?.id && w?.authHeaderValue)
            .map(w => [w.id, w.authHeaderValue])
        );
        const localApiKeyById = new Map(
          (cfg.appearance?.customWidgets || [])
            .filter(w => w?.id && w?.apiKey)
            .map(w => [w.id, w.apiKey])
        );
        const localDisabledIds = new Set(
          (cfg.appearance?.customWidgets || [])
            .filter(w => w?.id && w?.disabled)
            .map(w => w.id)
        );
        const nextRemote = { ...remoteData };
        if (Array.isArray(nextRemote.customWidgets)) {
          nextRemote.customWidgets = nextRemote.customWidgets.map(w => {
            if (!w || typeof w !== "object") return w;
            const { disabled: _remoteDisabled, ...restWidget } = w;
            const nextWidget = { ...restWidget };
            if ("authHeaderValue" in w || (w.id && localById.has(w.id))) {
              nextWidget.authHeaderValue = w.id && localById.has(w.id) ? localById.get(w.id) : "";
            }
            if ("apiKey" in w || (w.id && localApiKeyById.has(w.id))) {
              nextWidget.apiKey = w.id && localApiKeyById.has(w.id) ? localApiKeyById.get(w.id) : "";
            }
            if (w.id && localDisabledIds.has(w.id)) {
              nextWidget.disabled = true;
            }
            return nextWidget;
          });
        }
        cfg.appearance = { ...cfg.appearance, ...nextRemote };
      }
    }
  },
  background: {
    filename: "background.json",
    syncFlag: "webdavSyncBackground",
    modeField: "webdavBackgroundMode",
    buildPayload: (cfg) => buildBackgroundExtraPayload(cfg),
    applyRemote: (cfg, remoteData) => {
      if (remoteData && typeof remoteData === "object") {
        cfg.appearance = { ...cfg.appearance, ...remoteData };
      }
    }
  }
};

function isDefaultExtraPayload(key, localPayload) {
  const defaultPayload = WEBDAV_EXTRA_SECTION_SPECS[key]?.buildPayload(defaultConfig);
  return stableSerialize(localPayload) === stableSerialize(defaultPayload);
}

async function syncExtraJsonSection({ key, fileUrl, headers, buildPayload, lastHashes, lastUpdatedAts = {}, applyRemote, remoteRes: preloadedRemoteRes = null }) {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const localPayload = buildPayload();
    const localHash = await hashExtraPayload(localPayload);
    const remoteRes = (attempt === 0 && preloadedRemoteRes) ? preloadedRemoteRes : await webdavGetJsonFile(fileUrl, headers);
    if (!remoteRes.ok) return { changed: false, conflict: false };

    const prevUpdatedAt = Number(lastUpdatedAts[key] || 0) || 0;

    if (remoteRes.notFound) {
      const now = Date.now();
      const putRes = await webdavPutJsonFile(fileUrl, headers, {
        updatedAt: now,
        data: localPayload
      }, { ifNoneMatch: "*" });
      if (putRes.preconditionFailed && attempt + 1 < maxAttempts) {
        webdavDebugLog("412 precondition failed on create; retrying", { key, attempt: attempt + 1 });
        continue;
      }
      if (putRes.ok) {
        lastHashes[key] = localHash;
        lastUpdatedAts[key] = Math.max(prevUpdatedAt, now);
      }
      return { changed: false, conflict: false };
    }

    const r = remoteRes.data;
    const remoteHash = r && r.data !== undefined ? await hashExtraPayload(r.data) : "";
    const remoteUpdatedAt = Number(r?.updatedAt || 0) || 0;

    if (remoteHash === localHash) {
      lastHashes[key] = localHash;
      if (remoteUpdatedAt > prevUpdatedAt) {
        lastUpdatedAts[key] = remoteUpdatedAt;
      }
      return { changed: false, conflict: false };
    }

    if (prevUpdatedAt > 0 && remoteUpdatedAt > 0 && remoteUpdatedAt < prevUpdatedAt) {
      webdavDebugLog("stale/rolled-back remote version detected", {
        key,
        remoteUpdatedAt,
        prevUpdatedAt,
        remoteHash,
        localHash
      });
      return {
        changed: false,
        conflict: true,
        remoteUpdatedAt,
        localHash,
        remoteHash,
        reason: "stale-remote-version"
      };
    }

    const lastHash = lastHashes[key] || "";
    const remoteChanged = !!r && r.data !== undefined && remoteHash !== lastHash;
    const localChanged = localHash !== lastHash;

    webdavDebugLog("extra section check", {
      key,
      attempt: attempt + 1,
      localHash,
      remoteHash,
      lastHash,
      localChanged,
      remoteChanged,
      remoteUpdatedAt,
      prevUpdatedAt,
      etag: remoteRes.etag || null
    });

    if (!lastHash && r && r.data !== undefined && !isDefaultExtraPayload(key, localPayload)) {
      return {
        changed: false,
        conflict: true,
        remoteUpdatedAt: remoteUpdatedAt || null,
        localHash,
        remoteHash
      };
    }

    if (lastHash && remoteChanged && localChanged) {
      return {
        changed: false,
        conflict: true,
        remoteUpdatedAt: remoteUpdatedAt || null,
        localHash,
        remoteHash
      };
    }

    if (remoteChanged && (!localChanged || !lastHash)) {
      applyRemote(r.data);
      lastHashes[key] = await hashExtraPayload(buildPayload());
      if (remoteUpdatedAt > 0) {
        lastUpdatedAts[key] = Math.max(prevUpdatedAt, remoteUpdatedAt);
      }
      return { changed: true, conflict: false };
    }

    if (localChanged || localHash !== remoteHash) {
      const now = Math.max(Date.now(), prevUpdatedAt + 1);
      const putRes = await webdavPutJsonFile(fileUrl, headers, {
        updatedAt: now,
        data: localPayload
      }, { ifMatch: remoteRes.etag || "" });
      if (putRes.preconditionFailed && attempt + 1 < maxAttempts) {
        webdavDebugLog("412 precondition failed on update; retrying", { key, attempt: attempt + 1 });
        continue;
      }
      if (putRes.ok) {
        lastHashes[key] = localHash;
        lastUpdatedAts[key] = Math.max(prevUpdatedAt, now);
      }
    } else {
      lastHashes[key] = localHash;
    }
    return { changed: false, conflict: false };
  }
  return { changed: false, conflict: false };
}

function shouldSyncExtraPart(enabled, mode, { includeManual = false, manualOnly = false } = {}) {
  if (!enabled) return false;
  const isManual = mode === "manual";
  if (manualOnly) return isManual;
  return isManual ? includeManual : true;
}

const ensuredWebdavDirs = new Set();

async function runWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const workerCount = Math.min(Math.max(1, limit), list.length);
  let nextIndex = 0;
  const results = new Array(list.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < list.length) {
        const idx = nextIndex++;
        results[idx] = await worker(list[idx], idx);
      }
    })
  );
  return results;
}

async function ensureWebdavBackupDirs(backupsRootUrl, backupTypes, headers, { forceCheck = false } = {}) {
  const ensureSingleDir = async (dirUrl) => {
    try {
      const checkRes = await fetchWithTimeout(dirUrl, {
        method: "PROPFIND",
        headers: { Depth: "0", ...headers }
      });
      if (checkRes.status === 404 || checkRes.status === 405 || checkRes.status === 501) {
        const mkRes = await fetchWithTimeout(dirUrl, { method: "MKCOL", headers });
        if (mkRes.ok || mkRes.status === 405) {
          ensuredWebdavDirs.add(dirUrl);
        }
      } else if (checkRes.ok || checkRes.status === 207) {
        ensuredWebdavDirs.add(dirUrl);
      }
    } catch {}
  };

  const parentUrl = `${backupsRootUrl}/`;
  if (forceCheck || !ensuredWebdavDirs.has(parentUrl)) {
    await ensureSingleDir(parentUrl);
  }

  const childUrls = backupTypes.map(t => `${backupsRootUrl}/${t}/`);
  const pendingChildren = forceCheck
    ? childUrls
    : childUrls.filter(dirUrl => !ensuredWebdavDirs.has(dirUrl));
  if (pendingChildren.length === 0) return;

  await runWithConcurrency(pendingChildren, 3, ensureSingleDir);
}

function emitSyncStatusChanged() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("speeddial:sync-status-changed"));
  }
}

async function syncWebdavFolderExtrasLocked(config = null, options = {}) {
  const currentConfig = config || await loadConfig();
  if (!currentConfig || currentConfig.sync?.type !== "webdav" || currentConfig.sync?.webdavMode !== "folder") {
    return { ok: true, skipped: true };
  }

  const folderBase = resolveWebdavFolderBaseUrl(currentConfig.sync.serverUrl, currentConfig.sync.webdavFolderPath);
  if (!folderBase) return { ok: false, reason: "invalid-url" };

  const backupsOnly = !!options?.backupsOnly;
  const syncConfigEnabled = backupsOnly ? false : shouldSyncExtraPart(currentConfig.sync.webdavSyncConfig !== false, currentConfig.sync.webdavConfigMode, options);
  const syncWidgetsEnabled = backupsOnly ? false : shouldSyncExtraPart(currentConfig.sync.webdavSyncWidgets !== false, currentConfig.sync.webdavWidgetsMode, options);
  const syncBackgroundEnabled = backupsOnly ? false : shouldSyncExtraPart(!!currentConfig.sync.webdavSyncBackground, currentConfig.sync.webdavBackgroundMode, options);
  const syncBackupsEnabled = backupsOnly ? true : shouldSyncExtraPart(!!currentConfig.sync.webdavSyncBackups, currentConfig.sync.webdavBackupsMode, options);

  if (!syncConfigEnabled && !syncWidgetsEnabled && !syncBackgroundEnabled && !syncBackupsEnabled) {
    return { ok: true, skipped: true, configChanged: false };
  }

  const resolvedCfg = buildSyncConfigFromConfig(currentConfig);
  const credentials = options?.credentials?.ok
    ? options.credentials
    : await resolveSyncCredentials(resolvedCfg, "syncWebdavFolderExtras");
  if (!credentials.ok) return credentials;

  const headers = {};
  applyWebdavCompatibilityHeaders(headers, resolvedCfg);
  if (credentials.password) {
    headers["Authorization"] = safeBasicAuthHeader(credentials.username || "", credentials.password);
  }

  let configChanged = false;
  let conflictsChanged = false;
  if (!currentConfig.sync.lastSyncedExtraHashes || typeof currentConfig.sync.lastSyncedExtraHashes !== "object") {
    currentConfig.sync.lastSyncedExtraHashes = {};
  }
  if (!currentConfig.sync.lastSeenExtraUpdatedAt || typeof currentConfig.sync.lastSeenExtraUpdatedAt !== "object") {
    currentConfig.sync.lastSeenExtraUpdatedAt = {};
  }
  if (!currentConfig.sync.webdavExtraConflicts || typeof currentConfig.sync.webdavExtraConflicts !== "object") {
    currentConfig.sync.webdavExtraConflicts = {};
  }
  const lastHashes = currentConfig.sync.lastSyncedExtraHashes;
  const lastUpdatedAts = currentConfig.sync.lastSeenExtraUpdatedAt;
  const extraEnabledMap = {
    config: syncConfigEnabled,
    widgets: syncWidgetsEnabled,
    background: syncBackgroundEnabled
  };

  const enabledSpecs = Object.entries(WEBDAV_EXTRA_SECTION_SPECS).filter(([key]) => extraEnabledMap[key]);
  const prefetchedSections = await Promise.all(
    enabledSpecs.map(async ([key, spec]) => {
      const fileUrl = `${folderBase}/${spec.filename}`;
      const remoteRes = await webdavGetJsonFile(fileUrl, headers);
      return [key, { spec, fileUrl, remoteRes }];
    })
  );

  for (const [key, { spec, fileUrl, remoteRes }] of prefetchedSections) {
    const res = await syncExtraJsonSection({
      key,
      fileUrl,
      headers,
      remoteRes,
      buildPayload: () => spec.buildPayload(currentConfig),
      lastHashes,
      lastUpdatedAts,
      applyRemote: (remoteData) => spec.applyRemote(currentConfig, remoteData)
    });
    if (res.changed) configChanged = true;
    if (res.conflict) {
      currentConfig.sync[spec.syncFlag] = false;
      currentConfig.sync.webdavExtraConflicts[key] = {
        detectedAt: Date.now(),
        remoteUpdatedAt: res.remoteUpdatedAt,
        localHash: res.localHash,
        remoteHash: res.remoteHash
      };
      conflictsChanged = true;
    }
  }

  // 4. backups/ (<folder>/backups/<type>/<filename> + <folder>/backups/index.json)
  if (syncBackupsEnabled) {
    try {
      await withAutoBackupLock(async () => {
        const retentionDays = Math.max(1, Number(currentConfig.backups?.remoteRetentionDays ?? currentConfig.backups?.retentionDays) || 14);
        const backupsRootUrl = `${folderBase}/backups`;
        const backupTypes = Object.keys(WEBDAV_BACKUP_STORAGE_KEYS);

        const backupStorage = await batchStorageGet([
          WEBDAV_BACKUP_STORAGE_KEYS.bookmarks,
          WEBDAV_BACKUP_STORAGE_KEYS.config
        ]);
        const localBackups = {
          bookmarks: Array.isArray(backupStorage[WEBDAV_BACKUP_STORAGE_KEYS.bookmarks]) ? backupStorage[WEBDAV_BACKUP_STORAGE_KEYS.bookmarks] : [],
          config: Array.isArray(backupStorage[WEBDAV_BACKUP_STORAGE_KEYS.config]) ? backupStorage[WEBDAV_BACKUP_STORAGE_KEYS.config] : []
        };

        const indexUrl = `${backupsRootUrl}/index.json`;
        const remoteIndexRes = await webdavGetJsonFile(indexUrl, headers);
        if (remoteIndexRes.ok && remoteIndexRes.notFound) {
          await ensureWebdavBackupDirs(backupsRootUrl, backupTypes, headers);
        }
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
            const filteredLocalList = localList.filter(e => typeof e.data === "string" || remoteMetaList.some(r => r.filename === e.filename));
            const localByName = new Map(filteredLocalList.map(e => [e.filename, e]));
            const remoteByName = new Map(remoteMetaList.map(e => [e.filename, e]));

            const mergedMeta = mergeBackupArrays(
              filteredLocalList.map(stripData),
              remoteMetaList,
              retentionDays
            );
            const keptNames = new Set(mergedMeta.map(e => e.filename));

            // Upload new local backups not yet on remote (bounded concurrency)
            const failedUploadNames = new Set();
            const uploadTargets = mergedMeta
              .map(meta => ({ meta, localEntry: localByName.get(meta.filename) }))
              .filter(({ meta, localEntry }) => !remoteByName.has(meta.filename) && localEntry && typeof localEntry.data === "string");

            await runWithConcurrency(uploadTargets, 4, async ({ meta, localEntry: entry }) => {
              const fileUrl = `${backupsRootUrl}/${type}/${encodeURIComponent(entry.filename)}`;
              try {
                const putOptions = {
                  method: "PUT",
                  headers: { "Content-Type": "application/json", ...headers },
                  body: typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data || {})
                };
                let putRes = await fetchWithTimeout(fileUrl, putOptions);
                if (putRes.status === 404 || putRes.status === 409) {
                  ensuredWebdavDirs.delete(`${backupsRootUrl}/${type}/`);
                  await ensureWebdavBackupDirs(backupsRootUrl, [type], headers, { forceCheck: true });
                  putRes = await fetchWithTimeout(fileUrl, putOptions);
                }
                if (!putRes.ok) {
                  console.warn(`syncWebdavFolderExtras: backup upload failed (${putRes.status}) for ${entry.filename}`);
                  failedUploadNames.add(meta.filename);
                }
              } catch (err) {
                console.warn(`syncWebdavFolderExtras: backup upload failed for ${entry.filename}`, err);
                failedUploadNames.add(meta.filename);
              }
            });

            // Delete expired remote backups that were pruned by retentionDays (bounded concurrency)
            const deleteTargets = remoteMetaList.filter(rMeta => !keptNames.has(rMeta.filename) && isSafeBackupFilename(rMeta.filename));
            await runWithConcurrency(deleteTargets, 4, async (rMeta) => {
              const fileUrl = `${backupsRootUrl}/${type}/${encodeURIComponent(rMeta.filename)}`;
              try {
                await fetchWithTimeout(fileUrl, { method: "DELETE", headers });
              } catch {}
            });

            // Reconstruct local list: keep local backups with data (marking syncedToRemote) and index remote-only entries
            const finalLocalList = [];
            for (const meta of mergedMeta) {
              if (localByName.has(meta.filename)) {
                const localEntry = localByName.get(meta.filename);
                if (typeof localEntry.data === "string") {
                  const isOnRemote = !failedUploadNames.has(meta.filename);
                  finalLocalList.push({ ...localEntry, syncedToRemote: isOnRemote });
                } else {
                  finalLocalList.push(localEntry);
                }
              } else {
                finalLocalList.push({ ...meta, remoteOnly: true });
              }
            }

            if (stableSerialize(finalLocalList.map(stripData)) !== stableSerialize(localList.map(stripData))) {
              localChanged = true;
            }
            nextLocalBackups[type] = finalLocalList;
            nextIndex[type] = mergedMeta.filter(meta => !failedUploadNames.has(meta.filename));
          }

          if (localChanged) {
            await chrome.storage.local.set({
              [WEBDAV_BACKUP_STORAGE_KEYS.bookmarks]: nextLocalBackups.bookmarks,
              [WEBDAV_BACKUP_STORAGE_KEYS.config]: nextLocalBackups.config
            });
          }

          if (remoteIndexRes.notFound || stableSerialize(nextIndex) !== stableSerialize(remoteIndex)) {
            const putIndexOpts = remoteIndexRes.notFound
              ? { ifNoneMatch: "*" }
              : { ifMatch: remoteIndexRes.etag || "" };
            const indexNow = Math.max(Date.now(), Number(lastUpdatedAts.backupsIndex || 0) + 1);
            let putIndexRes = await webdavPutJsonFile(indexUrl, headers, {
              updatedAt: indexNow,
              data: nextIndex
            }, putIndexOpts);
            if (putIndexRes.preconditionFailed) {
              webdavDebugLog("backups/index.json 412 precondition failed; re-fetching and re-merging");
              const retryRemoteRes = await webdavGetJsonFile(indexUrl, headers);
              if (retryRemoteRes.ok) {
                const retryRemoteIndex = retryRemoteRes.data?.data || {};
                const retryIndex = {};
                for (const type of backupTypes) {
                  const localMeta = nextLocalBackups[type].filter(e => typeof e.data === "string").map(stripData);
                  const retryRemoteMeta = Array.isArray(retryRemoteIndex[type]) ? retryRemoteIndex[type] : [];
                  retryIndex[type] = mergeBackupArrays(localMeta, retryRemoteMeta, retentionDays);
                }
                const retryNow = Math.max(Date.now(), Number(retryRemoteRes.data?.updatedAt || 0) + 1);
                putIndexRes = await webdavPutJsonFile(indexUrl, headers, {
                  updatedAt: retryNow,
                  data: retryIndex
                }, retryRemoteRes.notFound ? { ifNoneMatch: "*" } : { ifMatch: retryRemoteRes.etag || "" });
                if (putIndexRes.ok) {
                  lastUpdatedAts.backupsIndex = retryNow;
                }
              }
            } else if (putIndexRes.ok) {
              lastUpdatedAts.backupsIndex = indexNow;
            }
          }
        }
      });
    } catch (err) {
      console.warn("syncWebdavFolderExtras: backups sync failed", err);
    }
  }

  currentConfig.sync.lastFolderExtrasSync = Date.now();
  await saveConfig(currentConfig);

  if (configChanged && typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("simpledial:config-synced", { detail: { config: currentConfig } }));
  }
  if (conflictsChanged) {
    emitSyncStatusChanged(currentConfig);
  }

  return { ok: true, configChanged, conflictsChanged };
}

export async function resolveWebdavExtraConflict(key, resolution) {
  const spec = WEBDAV_EXTRA_SECTION_SPECS[key];
  if (!spec) {
    return { ok: false, reason: "invalid-extra-key" };
  }

  return await withSyncLock(async () => {
    const config = await loadConfig();
    if (!config || config.sync?.type !== "webdav" || config.sync?.webdavMode !== "folder") {
      return { ok: false, reason: "webdav-folder-not-active" };
    }
    if (!config.sync.lastSyncedExtraHashes || typeof config.sync.lastSyncedExtraHashes !== "object") {
      config.sync.lastSyncedExtraHashes = {};
    }
    if (!config.sync.lastSeenExtraUpdatedAt || typeof config.sync.lastSeenExtraUpdatedAt !== "object") {
      config.sync.lastSeenExtraUpdatedAt = {};
    }
    if (!config.sync.webdavExtraConflicts || typeof config.sync.webdavExtraConflicts !== "object") {
      config.sync.webdavExtraConflicts = {};
    }

    if (resolution === "keep-disabled") {
      config.sync[spec.syncFlag] = false;
      delete config.sync.webdavExtraConflicts[key];
      await saveConfig(config);
      emitSyncStatusChanged(config);
      return { ok: true, resolution };
    }

    const { folderBase, headers } = await buildWebdavFolderRequestContext("resolveWebdavExtraConflict");
    const fileUrl = `${folderBase}/${spec.filename}`;

    if (resolution === "remote") {
      const remoteRes = await webdavGetJsonFile(fileUrl, headers);
      if (!remoteRes.ok || remoteRes.notFound || remoteRes.data?.data === undefined) {
        return { ok: false, reason: remoteRes.notFound ? "not-found" : "http-error", status: remoteRes.status };
      }
      spec.applyRemote(config, remoteRes.data.data);
      config.sync.lastSyncedExtraHashes[key] = await hashExtraPayload(spec.buildPayload(config));
      config.sync.lastSeenExtraUpdatedAt[key] = Number(remoteRes.data.updatedAt || 0) || 0;
      config.sync[spec.syncFlag] = true;
      delete config.sync.webdavExtraConflicts[key];
      config.sync.lastFolderExtrasSync = Date.now();
      await saveConfig(config);
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("simpledial:config-synced", { detail: { config } }));
      }
      emitSyncStatusChanged(config);
      return { ok: true, resolution, configChanged: true };
    }

    if (resolution === "local") {
      const localPayload = spec.buildPayload(config);
      const prevUpdatedAt = Number(config.sync.lastSeenExtraUpdatedAt[key] || 0) || 0;
      const now = Math.max(Date.now(), prevUpdatedAt + 1);
      const putRes = await webdavPutJsonFile(fileUrl, headers, {
        updatedAt: now,
        data: localPayload
      });
      if (!putRes.ok) {
        return { ok: false, reason: "http-error", status: putRes.status };
      }
      config.sync.lastSyncedExtraHashes[key] = await hashExtraPayload(localPayload);
      config.sync.lastSeenExtraUpdatedAt[key] = now;
      config.sync[spec.syncFlag] = true;
      delete config.sync.webdavExtraConflicts[key];
      config.sync.lastFolderExtrasSync = Date.now();
      await saveConfig(config);
      emitSyncStatusChanged(config);
      return { ok: true, resolution };
    }

    return { ok: false, reason: "invalid-resolution" };
  });
}

async function buildWebdavFolderRequestContext(operationName) {
  const config = await loadConfig();
  if (!config || config.sync?.type !== "webdav" || config.sync?.webdavMode !== "folder") {
    throw new Error("webdav-folder-not-active");
  }
  const folderBase = resolveWebdavFolderBaseUrl(config.sync.serverUrl, config.sync.webdavFolderPath);
  if (!folderBase) throw new Error("invalid-url");

  const resolvedCfg = buildSyncConfigFromConfig(config);
  const credentials = await resolveSyncCredentials(resolvedCfg, operationName);
  if (!credentials.ok) {
    throw new Error(credentials.reason || "credentials-error");
  }

  const headers = {};
  applyWebdavCompatibilityHeaders(headers, resolvedCfg);
  if (credentials.password) {
    headers["Authorization"] = safeBasicAuthHeader(credentials.username || "", credentials.password);
  }
  return { folderBase, headers };
}

export async function fetchRemoteWebdavBackupData(type, filename) {
  if (!isSafeBackupFilename(filename)) {
    throw new Error("Invalid backup filename");
  }
  const { folderBase, headers } = await buildWebdavFolderRequestContext("fetchRemoteWebdavBackupData");
  const safeType = encodeURIComponent(String(type || "bookmarks"));
  const safeFilename = encodeURIComponent(String(filename || ""));
  const fileUrl = `${folderBase}/backups/${safeType}/${safeFilename}`;
  const res = await fetchWithTimeout(fileUrl, { method: "GET", cache: "no-cache", headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.text();
}

let remoteBackupDeleteInFlight = false;

export async function deleteRemoteWebdavBackup(type, filename, options = {}) {
  if (!isSafeBackupFilename(filename)) {
    return { ok: false, filename, reason: "invalid-filename" };
  }
  if (remoteBackupDeleteInFlight) {
    return { ok: false, filename, inProgress: true };
  }
  remoteBackupDeleteInFlight = true;
  try {
    const run = async () => {
      const resolvedType = String(type || "bookmarks");
      const { folderBase, headers } = await buildWebdavFolderRequestContext("deleteRemoteWebdavBackup");
      const safeType = encodeURIComponent(resolvedType);
      const safeFilename = encodeURIComponent(String(filename || ""));
      const fileUrl = `${folderBase}/backups/${safeType}/${safeFilename}`;

      const delRes = await fetchWithTimeout(fileUrl, { method: "DELETE", headers });
      const notFoundOnRemote = delRes.status === 404;
      if (!delRes.ok && !notFoundOnRemote) {
        throw new Error(`HTTP ${delRes.status}`);
      }

      const indexUrl = `${folderBase}/backups/index.json`;
      const remoteIndexRes = await webdavGetJsonFile(indexUrl, headers);
      if (remoteIndexRes.ok && !remoteIndexRes.notFound && remoteIndexRes.data?.data && typeof remoteIndexRes.data.data === "object") {
        const nextData = { ...remoteIndexRes.data.data };
        if (Array.isArray(nextData[resolvedType])) {
          nextData[resolvedType] = nextData[resolvedType].filter(entry => entry?.filename !== filename);
        }
        const putRes = await webdavPutJsonFile(indexUrl, headers, {
          updatedAt: Date.now(),
          data: nextData
        });
        if (!putRes.ok) {
          throw new Error(`HTTP ${putRes.status ?? "?"}`);
        }
      }

      return { ok: true, filename, notFoundOnRemote };
    };
    return options?.skipSyncLock ? await run() : await withSyncLock(run);
  } finally {
    remoteBackupDeleteInFlight = false;
  }
}

let remoteBackupsFetchInFlight = false;

export async function syncWebdavFolderExtras(config = null, options = {}) {
  const isManual = !!(options?.backupsOnly || options?.manualOnly);
  if (isManual && remoteBackupsFetchInFlight) {
    return { ok: false, inProgress: true };
  }
  if (isManual) {
    remoteBackupsFetchInFlight = true;
  }
  try {
    const res = await withSyncLock(
      () => syncWebdavFolderExtrasLocked(config, options),
      isManual ? { ifAvailable: true } : {}
    );
    if (res?.skipped) {
      return { ok: false, inProgress: true };
    }
    return res;
  } finally {
    if (isManual) {
      remoteBackupsFetchInFlight = false;
      resetSyncLoopTimer();
    }
  }
}

let lastSyncErrorReason = null;

export function getLastSyncErrorReason() {
  return lastSyncErrorReason;
}

export function clearLastSyncErrorReason() {
  lastSyncErrorReason = null;
}

export async function syncNow(options = {}) {
  const lockResult = await withSyncLock(async () => {
    const config = await loadConfig();
    const includeManual = !!options?.includeManualExtras;

    if (!config.sync.enabled || (!config.sync.serverUrl && config.sync.type !== 'browser')) {
      console.warn("Sync not configured or disabled");
      lastSyncErrorReason = null;
      return { ok: false, reason: 'not-configured' };
    }

    if (config.sync.pausedReason && !options?.force && !options?.staleResolution) {
      lastSyncErrorReason = config.sync.pausedReason;
      return { ok: false, reason: config.sync.pausedReason, paused: true };
    }

    const localTombstoneState = await migratePendingPurgedIdsToTombstones(config);
    const localHash = await getGroupsHash(state.groups, state.tags, localTombstoneState);
    const lastSyncedLocalHash = config.sync.lastSyncedLocalHash || "";
    const hasPendingPurges = Array.isArray(config.sync.pendingPurgedIds) && config.sync.pendingPurgedIds.length > 0;
    const hasPendingLocalChanges = !lastSyncedLocalHash
      || lastSyncedLocalHash !== localHash
      || hasPendingPurges;
    const syncCfg = buildSyncConfigFromConfig(config);
    const credentials = config.sync.type === 'browser'
      ? { ok: true, username: '', password: '' }
      : await resolveSyncCredentials(syncCfg, 'syncNow');
    if (!credentials.ok) {
      lastSyncErrorReason = credentials.reason || 'sync-failed';
      await recordSyncResultForPause(config, credentials);
      return credentials;
    }

    const previousRemoteMarker = config.sync.lastSeenRemoteMarker || "";
    const previousMarkerType = config.sync.remoteChangeHeaderType ?? null;
    const remoteMarkerUnchanged = await checkRemoteMarkerUnchanged(config, {
      syncCfg,
      credentials,
      deferSave: true
    });
    const currentRemoteMarker = config.sync.lastSeenRemoteMarker || "";
    const markerIsReliableForSkip = config.sync.remoteChangeHeaderType === 'sha256'
      || (config.sync.remoteChangeHeaderType === 'etag'
        && !currentRemoteMarker.startsWith('W/'));
    const willSkipGet = !hasPendingLocalChanges && remoteMarkerUnchanged && markerIsReliableForSkip && !options?.staleResolution && !(options?.force && !localTombstoneState.dbuid);

    syncDebugLog('syncNow pre-check', {
      localHash,
      lastSyncedLocalHash,
      localHashMatches: !!lastSyncedLocalHash && lastSyncedLocalHash === localHash,
      hasPendingPurges,
      hasPendingLocalChanges,
      previousRemoteMarker,
      currentRemoteMarker,
      remoteChangeHeaderType: config.sync.remoteChangeHeaderType,
      remoteMarkerUnchanged,
      markerIsReliableForSkip,
      willSkipGet
    });

    if (willSkipGet) {
      lastSyncErrorReason = null;
      if (config.sync.type === 'webdav' && config.sync.webdavMode === 'folder') {
        await syncWebdavFolderExtrasLocked(config, { includeManual, credentials });
      }
      await recordSyncResultForPause(config, { ok: true });
      await updateLastSyncTime(config);
      return { ok: true, reason: 'remote-marker-unchanged', changed: false };
    }

    const readResult = await syncReadDetailed(syncCfg, { credentials });
    if (!readResult.ok) {
      console.warn("Failed to read from sync server");
      lastSyncErrorReason = readResult.reason || 'sync-failed';
      config.sync.lastSeenRemoteMarker = previousRemoteMarker;
      config.sync.remoteChangeHeaderType = previousMarkerType;
      await recordSyncResultForPause(config, readResult);
      return readResult;
    }

    applyRemoteMarkerToConfig(config, readResult.remoteMarker);
    const mergeResult = await mergeAndWriteAtomically(config, readResult.data.groups, 2, readResult.data.tags, [], {
      force: !!options?.force,
      initializedRemote: readResult.reason === "initialized-remote",
      remoteEtag: readResult.remoteEtag || '',
      cloudDbuid: readResult.data.dbuid,
      cloudTombstones: readResult.data.tombstones,
      cloudTombstonePrunedBefore: readResult.data.tombstonePrunedBefore,
      staleResolution: options?.staleResolution || null,
      keepIds: options?.keepIds || [],
      credentials,
      precomputedLocalHash: !hasPendingPurges ? localHash : ""
    });
    if (!mergeResult.ok) {
      config.sync.lastSeenRemoteMarker = previousRemoteMarker;
      config.sync.remoteChangeHeaderType = previousMarkerType;
    }
    lastSyncErrorReason = mergeResult.ok ? null : (mergeResult.reason || 'sync-failed');
    await recordSyncResultForPause(config, mergeResult);
    if (mergeResult.ok && config.sync.type === 'webdav' && config.sync.webdavMode === 'folder') {
      await syncWebdavFolderExtrasLocked(config, { includeManual, credentials });
    }
    return mergeResult;
  }, { ifAvailable: !!options?.ifAvailable });

  if (lockResult?.skipped) {
    return { ok: true, reason: 'sync-locked', changed: false };
  }
  return lockResult;
}

export async function syncForceUpload(sourceState = state) {
  return await withSyncLock(async () => {
    const config = await loadConfig();
    resetRemoteMarkerStateIfUrlChanged(config);
    const syncCfg = await loadSyncConfig();
    if (!syncCfg) {
      return { ok: false, reason: 'not-configured' };
    }

    const groups = Array.isArray(sourceState?.groups) ? sourceState.groups : state.groups;
    const tags = Array.isArray(sourceState?.tags) ? sourceState.tags : (Array.isArray(state.tags) ? state.tags : []);
    const epochNow = Date.now();
    const nextDbuid = generateDbUid();
    const writeResult = await syncWriteDetailed(
      { ...syncCfg, lastSync: epochNow },
      groups,
      tags,
      {
        skipBootstrapGuard: true,
        dbuid: nextDbuid,
        tombstones: {},
        tombstonePrunedBefore: epochNow
      }
    );
    if (!writeResult.ok) {
      lastSyncErrorReason = writeResult.reason || 'sync-failed';
      return writeResult;
    }

    lastSyncErrorReason = null;
    if (writeResult.remoteMarker) {
      applyRemoteMarkerToConfig(config, writeResult.remoteMarker);
    } else if (config.sync?.type && config.sync.type !== 'browser' && config.sync.remoteChangeHeaderType) {
      const postWriteMarker = await getRemoteChangeMarker(syncCfg, {
        allowFallback: false,
        preferredType: config.sync.remoteChangeHeaderType
      });
      if (!applyRemoteMarkerToConfig(config, postWriteMarker)) {
        config.sync.lastSeenRemoteMarker = '';
      }
    }
    const nextTombstoneState = { dbuid: nextDbuid, tombstones: new Map(), tombstonePrunedBefore: epochNow };
    await saveLocalTombstoneState(nextTombstoneState);
    if (config.sync) {
      config.sync.pendingPurgedIds = [];
      config.sync.pausedReason = null;
      config.sync.consecutiveErrors = 0;
      config.sync.nextRetryAt = 0;
    }
    config.sync.lastSyncedLocalHash = await getGroupsHash(groups, tags, nextTombstoneState);
    await updateLastSyncTime(config);
    return { ok: true, reason: writeResult.reason || 'ok' };
  });
}

export async function syncForceDownload() {
  return await withSyncLock(async () => {
    const config = await loadConfig();
    resetRemoteMarkerStateIfUrlChanged(config);
    const syncCfg = await loadSyncConfig();
    if (!syncCfg) {
      return { ok: false, reason: 'not-configured' };
    }

    const readResult = await syncReadDetailed(syncCfg, { allowInitialize: false });
    if (!readResult.ok) {
      lastSyncErrorReason = readResult.reason || 'sync-failed';
      return readResult;
    }

    state.groups = Array.isArray(readResult.data?.groups) ? readResult.data.groups : [];
    state.tags = Array.isArray(readResult.data?.tags) ? readResult.data.tags : [];
    await saveState();

    const nextTombstoneState = {
      dbuid: (typeof readResult.data?.dbuid === "string" && readResult.data.dbuid.trim()) ? readResult.data.dbuid.trim() : generateDbUid(),
      tombstones: sanitizeTombstonesMap(readResult.data?.tombstones),
      tombstonePrunedBefore: Number(readResult.data?.tombstonePrunedBefore) > 0 ? Number(readResult.data.tombstonePrunedBefore) : 0
    };
    await saveLocalTombstoneState(nextTombstoneState);

    lastSyncErrorReason = null;
    if (!applyRemoteMarkerToConfig(config, readResult.remoteMarker)) {
      config.sync.lastSeenRemoteMarker = '';
    }
    if (config.sync) {
      config.sync.pendingPurgedIds = [];
      config.sync.pausedReason = null;
      config.sync.consecutiveErrors = 0;
      config.sync.nextRetryAt = 0;
    }
    config.sync.lastSyncedLocalHash = await getGroupsHash(state.groups, state.tags, nextTombstoneState);
    await updateLastSyncTime(config);
    return { ok: true, reason: 'ok', data: readResult.data };
  });
}

export async function getStaleDeviceConflictDetails() {
  return await withSyncLock(async () => {
    const config = await loadConfig();
    const syncCfg = buildSyncConfigFromConfig(config);
    const readResult = await syncReadDetailed(syncCfg, { allowInitialize: false });
    if (!readResult.ok) return readResult;

    const localTombstoneState = await loadLocalTombstoneState();
    const localDbuid = localTombstoneState.dbuid || "";
    const remoteDbuid = typeof readResult.data?.dbuid === "string" ? readResult.data.dbuid.trim() : "";
    const remotePrunedBefore = Number(readResult.data?.tombstonePrunedBefore) > 0
      ? Number(readResult.data.tombstonePrunedBefore)
      : 0;
    const cutoffForReview = remotePrunedBefore > 0 ? remotePrunedBefore : Number.MAX_SAFE_INTEGER;
    const ambiguousItems = findAmbiguousLocalOnlyRecords(
      state.groups,
      Array.isArray(state.tags) ? state.tags : [],
      readResult.data?.groups || [],
      readResult.data?.tags || [],
      cutoffForReview
    );
    return {
      ok: true,
      localDbuid,
      remoteDbuid,
      dbuidMismatch: !!remoteDbuid && localDbuid !== remoteDbuid,
      lastSync: config.sync?.lastSync || 0,
      tombstonePrunedBefore: remotePrunedBefore,
      ambiguousItems
    };
  });
}

export async function resolveStaleDeviceConflict({ mode = "smart", keepIds = [] } = {}) {
  if (mode === "force-download") {
    return await syncForceDownload();
  }
  if (mode === "force-upload") {
    return await syncForceUpload();
  }
  return await syncNow({
    force: true,
    staleResolution: mode === "selective" ? "selective" : "smart",
    keepIds
  });
}

// ─────────────────────────────────────────────────────────────
//  HOUSEKEEPING - CLEANUP DELETED ITEMS
// ─────────────────────────────────────────────────────────────

export async function cleanupDeletedItems(retentionDays) {
  return await withSyncLock(async () => {
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

      let stackCleanupChanged = false;
      for (const item of [...group.items]) {
        if (isStackItem(item)) {
          const res = cleanupStackIfNeeded(group, item);
          if (res === "removed" || res === "unwrapped") {
            if (item.id) purgedIds.push(item.id);
            groupChanged = true;
            stackCleanupChanged = true;
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

    if (deletedCount > 0 || purgedIds.length > 0) {
      const config = await loadConfig();
      if (config.sync?.enabled && persistPendingPurgedIdsInConfig(config, purgedIds)) {
        await saveConfig(config);
      }
      await saveState();
      await syncWriteLocked(state, { purgedIds });
    }

    return deletedCount;
  });
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
