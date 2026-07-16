import { state, saveState, generateId } from "./state.js";
import { render } from "./render.js";
import { syncWrite, validateSingleLink } from "./sync.js";
import { t } from "./i18n.js";
import { loadConfig } from "./config.js";

const DEFAULT_ICON_AUTO_REFRESH_HOURS = 24;

// ---------- Host permission helpers ----------
// "*://*/*" is an optional host permission (see manifest.json). contains()
// never prompts; request() does, so it must only be called from a user
// gesture (click handler).
async function hasHostPermission() {
  try {
    return await chrome.permissions.contains({ origins: ["*://*/*"] });
  } catch (err) {
    console.warn("[favicon] permissions.contains failed", err);
    return false;
  }
}

async function ensureHostPermission() {
  try {
    if (await chrome.permissions.contains({ origins: ["*://*/*"] })) return true;
    return await chrome.permissions.request({ origins: ["*://*/*"] });
  } catch (err) {
    console.warn("[favicon] permissions.request failed", err);
    return false;
  }
}

// ---------- Favicon cache (localStorage only, never synced) ----------
const FAVICON_CACHE_PREFIX = "favicon-cache:";

function faviconCacheKey(item) {
  return `${FAVICON_CACHE_PREFIX}${item.id}`;
}

function getFaviconCacheEntry(item) {
  if (!item?.id) return {};
  try {
    const raw = localStorage.getItem(faviconCacheKey(item));
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("[favicon] localStorage read/parse failed", err);
    return {};
  }
}

function setFaviconCacheEntry(item, partial) {
  if (!item?.id) return;
  try {
    const next = { ...getFaviconCacheEntry(item), ...partial };
    localStorage.setItem(faviconCacheKey(item), JSON.stringify(next));
  } catch (err) {
    console.warn("[favicon] localStorage write failed (quota?)", err);
  }
}

function clearFaviconCacheEntry(item) {
  if (!item?.id) return;
  try {
    localStorage.removeItem(faviconCacheKey(item));
  } catch (err) {
    console.warn("[favicon] localStorage remove failed", err);
  }
}

function getCachedFaviconDataUrl(item) {
  return getFaviconCacheEntry(item).dataUrl || null;
}

function setCachedFaviconDataUrl(item, dataUrl) {
  setFaviconCacheEntry(item, { dataUrl });
}

function getIconRefreshedAt(item) {
  return Number(getFaviconCacheEntry(item).refreshedAt || 0);
}

function setIconRefreshedAt(item, timestamp) {
  setFaviconCacheEntry(item, { refreshedAt: timestamp });
}

// Chromium's own favicon cache. Needs only the "favicon" manifest
// permission — no host permission, no network call to the target site.
function buildChromeFaviconUrl(pageUrl, size = 32) {
  try {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", String(size));
    return url.toString();
  } catch (err) {
    console.warn("[favicon] failed to build chrome favicon url", err);
    return null;
  }
}

// Chromium-only endpoint — Firefox has no equivalent
let chromeFaviconApiAvailableCache = null;

function isChromeFaviconApiAvailable() {
  if (chromeFaviconApiAvailableCache === null) {
    chromeFaviconApiAvailableCache = !/Firefox\//.test(navigator.userAgent || "");
  }
  return chromeFaviconApiAvailableCache;
}

async function hashBlob(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// The favicon API always returns 200 + an image, even with nothing cached
// (a generic default icon), so there's no error to detect. Instead, probe
// once per size with a URL that can never be visited/cached, hash that
// response, and treat any later match as "just the default" rather than
// a real favicon.
const chromeFaviconBaselineHashes = new Map();

function getChromeFaviconBaselineHash(size) {
  if (chromeFaviconBaselineHashes.has(size)) return chromeFaviconBaselineHashes.get(size);

  const probeId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const probeUrl = buildChromeFaviconUrl(`https://favicon-baseline-${probeId}.invalid/`, size);

  const promise = (async () => {
    try {
      const res = await fetch(probeUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await hashBlob(blob);
    } catch (err) {
      console.warn("[favicon] baseline probe failed", err);
      return null;
    }
  })();

  chromeFaviconBaselineHashes.set(size, promise);
  return promise;
}

// Returns a data URL only if the favicon API gave back something other
// than its generic default icon; otherwise null so the caller can fall
// through to Google S2.
async function getChromeFaviconIfReal(pageUrl, size = 32) {
  const chromeUrl = buildChromeFaviconUrl(pageUrl, size);
  if (!chromeUrl) return null;

  try {
    const [res, baselineHash] = await Promise.all([
      fetch(chromeUrl),
      getChromeFaviconBaselineHash(size)
    ]);
    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;

    const hash = await hashBlob(blob);
    if (baselineHash && hash === baselineHash) {
      if (document.getElementById("enable-favicon-debug-logging")?.checked) console.log("[favicon] chrome favicon API returned default icon, skipping", pageUrl);
      return null;
    }

    return await blobToDataUrl(blob);
  } catch (err) {
    if (document.getElementById("enable-favicon-debug-logging")?.checked) console.warn("[favicon] chrome favicon fetch/hash failed", err);
    return null;
  }
}

// ---------- Create bookmark tile ----------
export function createBookmarkTile(item, config = null) {
  const tile = document.createElement("div");
  tile.className = "bookmark-tile";
  tile.draggable = true;
  tile.dataset.bookmarkId = item.id;
  tile.title = item.url;

  const icon = document.createElement("img");
  icon.className = "bookmark-favicon";
  icon.src = resolveIconSrc(item);

  const link = document.createElement("a");
  link.className = "bookmark-title";
  link.href = item.url;
  link.textContent = item.title || item.url;
  link.removeAttribute("target");

  link.addEventListener("click", e => {
    e.preventDefault();
    window.location.href = item.url;
  });

  tile.addEventListener("click", e => {
    if (e.target.tagName.toLowerCase() === "a") return;
    if (e.button === 2) return;
    window.location.href = item.url;
  });

  tile.appendChild(icon);
  tile.appendChild(link);

  // Add dead link indicator only if:
  // 1. Link has errors (hasError flag is true)
  // 2. Dead link highlighting is enabled in config
  if (item.hasError && config?.housekeeper?.highlightDeadLinks !== false) {
    const errorIndicator = document.createElement("div");
    errorIndicator.className = "bookmark-error-indicator";
    errorIndicator.textContent = "✗";
    errorIndicator.title = "This link is not responding";
    tile.appendChild(errorIndicator);
  }

  return tile;
}

// ---------- Helper functions ----------
function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return buildGoogleFaviconUrl(u.hostname, 0);
  } catch {
    return "";
  }
}

function buildGoogleFaviconUrl(hostname, refreshedAt = null) {
  const refreshValue = Number.isFinite(Number(refreshedAt)) ? Number(refreshedAt) : 0;
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64&cb=${refreshValue}`;
}

// Google's S2 endpoint never sends CORS headers, for anyone — fetch() on
// it always fails, and the browser logs that as an error regardless of
// whether we catch it. So skip attempting it entirely instead of
// fetching-and-catching.
function isGoogleFaviconUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "www.google.com" && u.pathname === "/s2/favicons";
  } catch {
    return false;
  }
}

function resolveIconSrc(item) {
  // Cached icon (custom or fetched) wins; Google S2 is the last resort.
  const cached = getCachedFaviconDataUrl(item);
  if (cached) return cached;

  if (item.customIcon) return item.customIcon;

  try {
    const u = new URL(item.url);
    return buildGoogleFaviconUrl(u.hostname, getIconRefreshedAt(item));
  } catch {
    return "";
  }
}

// Fetches a page's HTML once and parses it, shared by the link-icon and
// manifest lookups below.
async function fetchPageDocument(pageUrl) {
  const origin = new URL(pageUrl).origin;
  if (document.getElementById("enable-favicon-debug-logging")?.checked) console.log("[favicon] fetching page HTML", pageUrl);

  const pageResponse = await fetch(pageUrl);
  const html = await pageResponse.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, origin };
}

function pickBestSizedIcon(candidates, srcKey, baseUrl, defaultSize = 0) {
  if (!candidates || !candidates.length) return null;

  const best = candidates
    .map(c => ({
      ...c,
      size: (!c.sizes || c.sizes === "any")
        ? defaultSize
        : Math.max(...c.sizes.split(" ").map(s => parseInt(s, 10) || 0))
    }))
    .sort((a, b) => b.size - a.size)[0];

  if (!best || !best[srcKey]) return null;
  return new URL(best[srcKey], baseUrl).href;
}

// The page's own <link rel="icon"> / shortcut icon / apple-touch-icon.
function getFaviconFromPageLinks(doc, origin) {
  const nodes = Array.from(doc.querySelectorAll(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"]'
  ));
  if (!nodes.length) return null;

  const candidates = nodes
    .map(n => ({ href: n.getAttribute("href"), sizes: n.getAttribute("sizes") }))
    .filter(c => c.href);

  const resolved = pickBestSizedIcon(candidates, "href", origin, 0);
  if (document.getElementById("enable-favicon-debug-logging")?.checked) console.log("[favicon] page link icon candidates", candidates, "resolved", resolved);
  return resolved;
}

// The web app manifest's icons list.
async function getFaviconFromManifest(doc, origin) {
  const link = doc.querySelector('link[rel="manifest"]');
  if (!link) return null;

  const href = link.getAttribute("href");
  if (!href) return null;

  const manifestUrl = new URL(href, origin).href;
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) return null;

  const manifest = await manifestResponse.json();
  const resolved = pickBestSizedIcon(manifest.icons, "src", manifestUrl, 9999);
  if (document.getElementById("enable-favicon-debug-logging")?.checked) console.log("[favicon] manifest icons", manifest.icons, "resolved", resolved);
  return resolved;
}

async function getBestFaviconUrl(item) {
  if (item.customIcon) {
    return item.customIcon;
  }

  // Experimental lookups, only if enabled and permission already granted.
  // Never requests the permission here — that only happens from a click
  // handler (ensureHostPermission), never automatically.
  const needsPageFetch = document.getElementById("enable-experimental-favicon-fetch-link")?.checked || document.getElementById("enable-experimental-favicon-fetch-manifest")?.checked;

  if (needsPageFetch && (await hasHostPermission())) {
    let pageDoc = null;
    let pageOrigin = null;

    try {
      const parsed = await fetchPageDocument(item.url);
      pageDoc = parsed.doc;
      pageOrigin = parsed.origin;
    } catch (err) {
      if (document.getElementById("enable-favicon-debug-logging")?.checked) console.warn("page fetch failed", err);
    }

    if (document.getElementById("enable-experimental-favicon-fetch-link")?.checked && pageDoc) {
      try {
        const linkIcon = getFaviconFromPageLinks(pageDoc, pageOrigin);
        if (linkIcon) return linkIcon;
      } catch (err) {
        if (document.getElementById("enable-favicon-debug-logging")?.checked) console.warn("standard favicon link parse failed", err);
      }
    }

    if (document.getElementById("enable-experimental-favicon-fetch-manifest")?.checked && pageDoc) {
      try {
        const manifestIcon = await getFaviconFromManifest(pageDoc, pageOrigin);
        if (manifestIcon) return manifestIcon;
      } catch (err) {
        if (document.getElementById("enable-favicon-debug-logging")?.checked) console.warn("manifest favicon failed (fetch)", err);
      }
    }
  }

  // Chromium's own favicon cache — default, zero-prompt path. Skipped if
  // it's just the generic default icon (see getChromeFaviconIfReal), or
  // if this browser doesn't support the endpoint at all (e.g. Firefox).
  if (isChromeFaviconApiAvailable()) {
    const chromeIcon = await getChromeFaviconIfReal(item.url, 32);
    if (chromeIcon) return chromeIcon;
  }

  // Last resort: Google's S2 favicon service.
  try {
    const u = new URL(item.url);
    return buildGoogleFaviconUrl(u.hostname, getIconRefreshedAt(item));
  } catch {
    return "";
  }
}

function shouldRefreshIcon(lastRefreshedAt, frequencyHours, force = false) {
  if (force) return true;

  const last = Number(lastRefreshedAt || 0);
  if (!last) return true;

  const intervalHours = Math.max(1, Number(frequencyHours) || DEFAULT_ICON_AUTO_REFRESH_HOURS);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  return (Date.now() - last) >= intervalMs;
}

function isIconMissing(item) {
  if (item.customIcon) {
    return !getCachedFaviconDataUrl(item);
  }

  return !getIconRefreshedAt(item);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("icon-cache-read-failed"));
    reader.readAsDataURL(blob);
  });
}

async function fetchIconAsDataUrl(iconUrl, force = false) {
  const response = await fetch(iconUrl, {
    cache: force ? "reload" : "default"
  });

  if (!response.ok) {
    throw new Error(`icon-fetch-failed:${response.status}`);
  }

  const iconBlob = await response.blob();
  if (!iconBlob || iconBlob.size === 0) {
    throw new Error("icon-blob-empty");
  }

  return await blobToDataUrl(iconBlob);
}

async function refreshBookmarkIcon(item, options = {}) {
  const force = !!options.force;
  const mode = options.mode || "all";
  const frequencyHours = Math.max(1, Number(options.frequencyHours) || DEFAULT_ICON_AUTO_REFRESH_HOURS);

  if (!item || item.deleted) return false;
  if (!force && mode === "missing" && !isIconMissing(item)) return false;
  if (!shouldRefreshIcon(getIconRefreshedAt(item), frequencyHours, force)) return false;

  const refreshTimestamp = Date.now();

  try {
    const faviconUrl = await getBestFaviconUrl(item);

    if (faviconUrl) {
      if (isGoogleFaviconUrl(faviconUrl)) {
        // Known to always be CORS-blocked — don't even attempt the fetch,
        // just use the URL directly as <img src>.
        setCachedFaviconDataUrl(item, faviconUrl);
      } else {
        try {
          // Cache the actual bytes as a data URL when we can.
          const dataUrl = await fetchIconAsDataUrl(faviconUrl, true);
          setCachedFaviconDataUrl(item, dataUrl);
        } catch (fetchErr) {
          // Fetch blocked (CORS/permissions) — <img> can still load the
          // remote URL directly without CORS, so use that instead. This is
          // expected/handled, so only noisy in debug mode.
          if (document.getElementById("enable-favicon-debug-logging")?.checked) console.warn("[favicon] could not download icon bytes, using direct URL", faviconUrl, fetchErr);
          setCachedFaviconDataUrl(item, faviconUrl);
        }
      }
    }
  } catch (err) {
    console.warn("favicon refresh failed", err);
  }

  setIconRefreshedAt(item, refreshTimestamp);
  return true;
}

export async function refreshBookmarkIconsIfNeeded(options = {}) {
  const force = !!options.force;
  const bookmarkId = options.bookmarkId || null;
  const persist = options.persist !== false;
  const sync = !!options.sync;

  let mode = "all";
  let frequencyHours = DEFAULT_ICON_AUTO_REFRESH_HOURS;

  if (!force) {
    const config = await loadConfig();
    mode = config?.housekeeper?.iconAutoRefreshMode || "all";
    frequencyHours = Math.max(1, Number(config?.housekeeper?.iconAutoRefreshHours) || DEFAULT_ICON_AUTO_REFRESH_HOURS);

    if (mode === "none") {
      return false;
    }
  }

  let changed = false;

  for (const group of state.groups) {
    if (group.deleted) continue;

    for (const item of (group.items || [])) {
      if (item.deleted) continue;
      if (bookmarkId && item.id !== bookmarkId) continue;

      const itemChanged = await refreshBookmarkIcon(item, { force, mode, frequencyHours });
      if (itemChanged) {
        changed = true;
      }
    }
  }

  if (changed && persist) {
    await saveState();
    if (sync) {
      await syncWrite();
    }
  }

  return changed;
}

function normalizeBookmarkUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  // Preserve any URL with a valid protocol/scheme like http://, https://, ftp://, mailto:, etc.
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

// ---------- Modal ----------
const modal = document.getElementById("bookmark-modal");
const modalTitle = document.getElementById("modal-title");
const bmTitle = document.getElementById("bm-title");
const bmUrl = document.getElementById("bm-url");
const bmIcon = document.getElementById("bm-icon");
const bmSave = document.getElementById("bm-save");
const bmCancel = document.getElementById("bm-cancel");

let editingBookmark = null;

export function openBookmarkModal(data = null) {
  editingBookmark = data;

  if (data) {
    modalTitle.textContent = t("editBookmark");
    bmTitle.value = data.title;
    bmUrl.value = data.url;
    bmIcon.value = data.customIcon || "";
  } else {
    modalTitle.textContent = t("newBookmark");
    bmTitle.value = "";
    bmUrl.value = "";
    bmIcon.value = "";
  }

  modal.classList.remove("hidden");
  bmTitle.focus();
}

function closeBookmarkModal() {
  modal.classList.add("hidden");
  editingBookmark = null;
}

bmCancel.addEventListener("click", closeBookmarkModal);

// Close modal on Escape or save on Enter key
modal.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeBookmarkModal();
  }

  if (e.key === "Enter" && (e.target === bmTitle || e.target === bmUrl || e.target === bmIcon)) {
    e.preventDefault();
    bmSave.click();
  }
});

// ---------- Save bookmark ----------
bmSave.addEventListener("click", async () => {
  const title = bmTitle.value.trim();
  const rawUrl = bmUrl.value.trim();
  const icon = bmIcon.value.trim();
  const url = normalizeBookmarkUrl(rawUrl);

  if (!url) {
    alert("Musíš zadať URL.");
    return;
  }

  const group = state.groups.find(g => g.id === window.activeGroupId);
  const targetBookmarkId = editingBookmark?.id || null;

  // EDIT
  if (editingBookmark) {
    // 🔥 Look up item by ID instead of using stale reference
    // (sync loop may have replaced state.groups while modal was open)
    const currentItem = group?.items.find(i => i.id === editingBookmark.id);
    if (currentItem) {
      const previousCustomIcon = currentItem.customIcon || null;
      const nextCustomIcon = icon || null;

      currentItem.title = title || url;
      currentItem.url = url;
      currentItem.customIcon = nextCustomIcon;
      if (previousCustomIcon !== nextCustomIcon) {
        clearFaviconCacheEntry(currentItem); // reset cached icon + timestamp
      }
      currentItem.updatedAt = Date.now();
    }

  // CREATE
  } else {
    group.items.push({
      id: generateId("b"),
      title: title || url,
      url,
      customIcon: icon || null,
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    });
  }

  await saveState();
  await syncWrite();
  closeBookmarkModal();

  // Only prompt for the host permission if an experimental lookup needs it.
  if (document.getElementById("enable-experimental-favicon-fetch-link")?.checked || document.getElementById("enable-experimental-favicon-fetch-manifest")?.checked) {
    await ensureHostPermission();
  }

  // Cache/update icon immediately after save.
  await refreshBookmarkIconsIfNeeded({
    force: true,
    bookmarkId: targetBookmarkId || group?.items[group.items.length - 1]?.id,
    persist: true,
    sync: false
  });

  render();
  
  // Check link health asynchronously in background (don't delay UI update)
  const itemToCheck = targetBookmarkId ? group?.items.find(i => i.id === targetBookmarkId) : group?.items[group.items.length - 1];
  if (itemToCheck && itemToCheck.url) {
    try {
      const isValid = await validateSingleLink(itemToCheck.url);
      const newHasError = !isValid;
      if (itemToCheck.hasError !== newHasError) {
        itemToCheck.hasError = newHasError;
        itemToCheck.updatedAt = Date.now();
        await saveState();
        await syncWrite();
        render();
      }
    } catch (e) {
      console.error('Link validation failed:', e);
    }
  }
});

// ---------- Context menu – bookmarks ----------
export async function handleBookmarkContext(action, el) {
  const bookmarkId = el.dataset.bookmarkId;
  const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
  if (!group) return;

  const item = group.items.find(i => i.id === bookmarkId);
  if (!item) return;

  if (action === "edit") {
    openBookmarkModal(item);
  }

  if (action === "delete") {
    item.deleted = true;
    item.deletedAt = Date.now();
    item.updatedAt = Date.now();

    await saveState();
    await syncWrite();
    render();
  }

  if (action === "restore") {
    item.deleted = false;
    item.deletedAt = null;
    item.updatedAt = Date.now();

    await saveState();
    await syncWrite();
    render();
  }

  if (action === "refresh-icon") {
    item.customIcon = null;
    clearFaviconCacheEntry(item);

    // Only prompt for the host permission if an experimental lookup needs it.
    if (document.getElementById("enable-experimental-favicon-fetch-link")?.checked || document.getElementById("enable-experimental-favicon-fetch-manifest")?.checked) {
      await ensureHostPermission();
    }

    await refreshBookmarkIconsIfNeeded({
      force: true,
      bookmarkId: item.id,
      persist: false,
      sync: false
    });
    item.updatedAt = Date.now();

    await saveState();
    await syncWrite();
    render();
  }

  if (action === "delete-permanent") {
    const confirmMsg = t("confirmDeletePermanentBookmark").replace("{0}", item.title);
    if (!confirm(confirmMsg)) return;

    clearFaviconCacheEntry(item); // drop any cached icon for this bookmark

    // Permanently remove from array
    const index = group.items.indexOf(item);
    if (index > -1) {
      group.items.splice(index, 1);
    }
    group.updatedAt = Date.now();

    await saveState();
    await syncWrite();
    render();
  }
}