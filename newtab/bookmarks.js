import {
  state,
  saveState,
  generateId,
  isStackItem,
  getAllGroupBookmarks,
  findBookmarkLocation,
  cleanupStackIfNeeded,
  SYSTEM_TAGS,
  SYSTEM_TAG_DEAD_LINK_ID,
  getBookmarkSystemTagIds,
  setBookmarkSystemTag,
  saveSystemTags,
  isReservedSystemTagName
} from "./state.js";
import { render } from "./render.js";
import { syncWrite, validateSingleLink } from "./sync.js";
import { t } from "./i18n.js";
import { loadConfig } from "./config.js";
import { faviconDebugLog } from "./debug.js";
import {
  extractDominantColorFromImageSource,
  extractDominantColorFromEmoji,
  resolveGroupIcons,
  applyTileColorStyle,
  isValidHexColor
} from "./color-utils.js";

const DEFAULT_ICON_AUTO_REFRESH_HOURS = 24;
const PLACEHOLDER_ICON_URL = chrome.runtime.getURL("icons/icon-16.png");
const ICON_HYDRATION_CONCURRENCY = 4;
const iconHydrationQueue = [];
let activeIconHydrations = 0;

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

export async function ensureHostPermission() {
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
      faviconDebugLog("chrome favicon API returned default icon, skipping", pageUrl);
      return null;
    }

    return await blobToDataUrl(blob);
  } catch (err) {
    faviconDebugLog("chrome favicon fetch/hash failed", err);
    return null;
  }
}

function findBookmarkInState(bookmarkId) {
  return findBookmarkLocation(bookmarkId)?.item || null;
}

function getActiveTagMap() {
  const map = new Map();
  for (const tag of SYSTEM_TAGS) {
    map.set(tag.id, tag);
  }
  for (const tag of (state.tags || [])) {
    if (tag && !tag.deleted && tag.id) {
      map.set(tag.id, tag);
    }
  }
  return map;
}

function createTagBadgeElements(tagIds, maxVisible = 3) {
  if (!Array.isArray(tagIds) || tagIds.length === 0) return null;

  const tagMap = getActiveTagMap();
  const resolved = tagIds.map(id => tagMap.get(id)).filter(Boolean);
  if (resolved.length === 0) return null;

  const container = document.createElement("div");
  container.className = "bookmark-tags";

  const visible = resolved.slice(0, maxVisible);
  visible.forEach(tag => {
    const badge = document.createElement("span");
    badge.className = "bookmark-tag-badge";
    badge.textContent = tag.name;
    badge.title = tag.name;
    badge.dataset.tagName = tag.name;
    const badgeColor = isValidHexColor(tag.color) ? tag.color : "#4a6bff";
    badge.style.setProperty("--tag-color", badgeColor);
    badge.addEventListener("click", (e) => {
      if (!document.body.classList.contains("clickable-bookmark-tags")) return;
      e.preventDefault();
      e.stopPropagation();
      window.searchByBookmarkTag?.(tag.name);
    });
    container.appendChild(badge);
  });

  if (resolved.length > maxVisible) {
    const more = document.createElement("span");
    more.className = "bookmark-tag-badge bookmark-tag-more";
    more.textContent = `+${resolved.length - maxVisible}`;
    more.title = resolved.slice(maxVisible).map(tag => tag.name).join(", ");
    container.appendChild(more);
  }

  return container;
}

async function syncBookmarkColorFromIcon(item, tile, iconSrc) {
  if (!item?.colorFromIcon || !iconSrc || iconSrc === PLACEHOLDER_ICON_URL) return null;
  if (isGoogleFaviconUrl(iconSrc) && !(await hasHostPermission())) return null;
  const extracted = await extractDominantColorFromImageSource(iconSrc);
  if (!extracted) return null;
  item.tileColor = extracted;
  setFaviconCacheEntry(item, { iconColor: extracted });
  if (tile) applyTileColorStyle(tile, extracted);
  return extracted;
}

// ---------- Create bookmark tile ----------
export function createBookmarkTile(item, config = null) {
  const tile = document.createElement("div");
  tile.className = "bookmark-tile";
  tile.draggable = true;
  tile.dataset.bookmarkId = item.id;
  tile.title = item.url;

  const cachedEntry = getFaviconCacheEntry(item);
  const effectiveColor = item.tileColor || (item.colorFromIcon ? cachedEntry.iconColor : null);
  applyTileColorStyle(tile, effectiveColor);

  const icon = document.createElement("img");
  icon.className = "bookmark-favicon";
  icon.draggable = false;
  icon.loading = "lazy";
  icon.decoding = "async";

  if (item.colorFromIcon && !effectiveColor) {
    if (cachedEntry.dataUrl) {
      void syncBookmarkColorFromIcon(item, tile, cachedEntry.dataUrl);
    } else {
      icon.addEventListener("load", () => {
        const loadedSrc = icon.currentSrc || icon.src;
        void syncBookmarkColorFromIcon(item, tile, loadedSrc);
      });
    }
  }

  icon.src = getImmediateIconSrc(item);
  scheduleDeferredIconHydration(icon, item);

  const link = document.createElement("a");
  link.className = "bookmark-title";
  link.draggable = false;
  link.href = item.url;
  link.textContent = item.title || item.url;

  link.addEventListener("click", e => {
    e.preventDefault();
    openBookmark(item.url, e);
  });

  tile.addEventListener("click", e => {
    if (e.target.closest("a")) return;
    e.preventDefault();
    openBookmark(item.url, e);
  });

  tile.addEventListener("auxclick", e => {
    if (e.target.closest("a")) return;
    if (e.button === 1) {
      e.preventDefault();
      openBookmark(item.url, e, true);
    }
  });

  const body = document.createElement("div");
  body.className = "bookmark-body";
  body.appendChild(link);

  const combinedTagIds = [
    ...getBookmarkSystemTagIds(item.id),
    ...(Array.isArray(item.tags) ? item.tags : [])
  ];
  const tagsEl = createTagBadgeElements(combinedTagIds);
  if (tagsEl) {
    body.appendChild(tagsEl);
  }

  tile.appendChild(icon);
  tile.appendChild(body);

  return tile;
}

// ---------- Create stack tile ("siblings") ----------
export function createStackTile(stackItem, config = null) {
  const showDeleted = !!document.getElementById("show-deleted-toggle")?.checked;
  const visibleChildren = (stackItem.children || []).filter(c => showDeleted || !c.deleted);
  const stackTitleText = stackItem.title || t("defaultStackName") || "Stack";

  const tile = document.createElement("div");
  tile.className = "bookmark-tile stack-tile";
  tile.draggable = true;
  tile.dataset.bookmarkId = stackItem.id;
  tile.dataset.isStack = "true";
  tile.title = `${stackTitleText} (${visibleChildren.length})`;

  applyTileColorStyle(tile, stackItem.tileColor || null);

  const iconGrid = document.createElement("div");
  iconGrid.className = "stack-icon-grid";

  const previewChildren = visibleChildren.filter(c => !c.deleted).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    const child = previewChildren[i];
    if (child) {
      const mini = document.createElement("img");
      mini.className = "stack-mini-icon";
      mini.draggable = false;
      mini.alt = "";
      mini.loading = "lazy";
      mini.decoding = "async";
      mini.src = getImmediateIconSrc(child);
      scheduleDeferredIconHydration(mini, child);
      iconGrid.appendChild(mini);
    } else {
      const slot = document.createElement("span");
      slot.className = "stack-mini-slot";
      iconGrid.appendChild(slot);
    }
  }

  const label = document.createElement("span");
  label.className = "bookmark-title stack-title";
  label.textContent = stackTitleText;

  const badge = document.createElement("span");
  badge.className = "stack-badge";

  const countSpan = document.createElement("span");
  countSpan.className = "stack-badge-count";
  countSpan.textContent = String(visibleChildren.length);

  const chevronSpan = document.createElement("span");
  chevronSpan.className = "stack-badge-chevron";
  chevronSpan.textContent = "›";

  badge.appendChild(countSpan);
  badge.appendChild(chevronSpan);

  tile.appendChild(iconGrid);
  tile.appendChild(label);
  tile.appendChild(badge);

  tile.addEventListener("click", e => {
    e.preventDefault();
    openStackPopover(stackItem.id);
  });

  tile.addEventListener("auxclick", e => {
    if (e.button === 1) {
      e.preventDefault();
      openStackPopover(stackItem.id);
    }
  });

  return tile;
}

// ---------- Floating Stack Popover ----------
let activeStackPopoverId = null;

export function getActiveStackPopoverId() {
  return activeStackPopoverId;
}

export function closeStackPopover() {
  const backdrop = document.getElementById("stack-popover");
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  backdrop.classList.remove("dragging-outside");
  activeStackPopoverId = null;
}

function populateStackPopover(stackItem, config = null) {
  const titleInput = document.getElementById("stack-popover-title");
  const countBadge = document.getElementById("stack-popover-count");
  const grid = document.getElementById("stack-popover-grid");
  if (!grid || !stackItem) return;

  const showDeleted = !!document.getElementById("show-deleted-toggle")?.checked;
  const visibleChildren = (stackItem.children || []).filter(c => showDeleted || !c.deleted);

  if (titleInput) {
    titleInput.placeholder = t("defaultStackName") || "Stack";
    if (document.activeElement !== titleInput) {
      titleInput.value = stackItem.title || "";
    }
  }
  if (countBadge) {
    countBadge.textContent = String(visibleChildren.length);
  }

  grid.innerHTML = "";
  grid.dataset.stackId = stackItem.id;

  visibleChildren.forEach(child => {
    const childTile = createBookmarkTile(child, config);
    childTile.dataset.parentStackId = stackItem.id;
    if (child.deleted) childTile.classList.add("deleted");
    grid.appendChild(childTile);
  });
}

export async function refreshOpenStackPopover(config = null) {
  if (!activeStackPopoverId) return;
  const backdrop = document.getElementById("stack-popover");
  if (!backdrop || backdrop.classList.contains("hidden")) {
    activeStackPopoverId = null;
    return;
  }

  const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
  const loc = group ? findBookmarkLocation(activeStackPopoverId, group) : null;
  if (!loc || !isStackItem(loc.item)) {
    closeStackPopover();
    return;
  }

  populateStackPopover(loc.item, config);
  import("./dragdrop.js").then(m => m.setupBookmarkDrag()).catch(() => {});
}

export async function openStackPopover(stackId, options = {}) {
  const backdrop = document.getElementById("stack-popover");
  const titleInput = document.getElementById("stack-popover-title");
  if (!backdrop) return;

  const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
  const loc = group ? findBookmarkLocation(stackId, group) : null;
  if (!loc || !isStackItem(loc.item)) return;

  activeStackPopoverId = stackId;
  const config = await loadConfig();
  populateStackPopover(loc.item, config);

  backdrop.classList.remove("hidden");
  backdrop.classList.remove("dragging-outside");

  import("./dragdrop.js").then(m => m.setupBookmarkDrag()).catch(() => {});

  if (options.focusTitle && titleInput) {
    titleInput.focus();
    titleInput.select();
  }
}

(() => {
  const backdrop = document.getElementById("stack-popover");
  const closeBtn = document.getElementById("stack-popover-close");
  const titleInput = document.getElementById("stack-popover-title");

  if (closeBtn) {
    closeBtn.addEventListener("click", closeStackPopover);
  }
  if (backdrop) {
    backdrop.addEventListener("click", e => {
      if (e.target === backdrop) {
        closeStackPopover();
      }
    });
  }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && activeStackPopoverId) {
      closeStackPopover();
    }
  });
  if (titleInput) {
    titleInput.addEventListener("input", () => {
      if (!activeStackPopoverId) return;
      const loc = findBookmarkLocation(activeStackPopoverId);
      if (!loc || !isStackItem(loc.item)) return;
      const nextTitle = titleInput.value.trim() || (t("defaultStackName") || "Stack");
      loc.item.title = titleInput.value;
      loc.item.updatedAt = Date.now();
      const tileLabel = document.querySelector(`.stack-tile[data-bookmark-id="${activeStackPopoverId}"] .stack-title`);
      if (tileLabel) tileLabel.textContent = nextTitle;
    });
    titleInput.addEventListener("change", async () => {
      if (!activeStackPopoverId) return;
      const loc = findBookmarkLocation(activeStackPopoverId);
      if (!loc || !isStackItem(loc.item)) return;
      loc.item.title = titleInput.value.trim() || (t("defaultStackName") || "Stack");
      loc.item.updatedAt = Date.now();
      await saveState();
      await syncWrite();
      render();
    });
    titleInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleInput.blur();
      }
    });
  }
})();

const ALLOWED_BOOKMARK_PROTOCOLS = new Set(["http:", "https:", "ftp:", "file:"]);

export function openBookmark(url, e, forceNewTab = false) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!ALLOWED_BOOKMARK_PROTOCOLS.has(parsed.protocol)) {
    return;
  }
  if (forceNewTab || e?.ctrlKey || e?.metaKey) {
    window.open(parsed.href, "_blank", "noopener,noreferrer");
  } else {
    window.location.href = parsed.href;
  }
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

function getImmediateIconSrc(item) {
  // Keep first paint local and immediate.
  const cached = getCachedFaviconDataUrl(item);
  if (cached) return cached;

  if (item.customIcon) return item.customIcon;

  return PLACEHOLDER_ICON_URL;
}

function getDeferredIconSrc(item) {
  const cached = getCachedFaviconDataUrl(item);
  if (cached) return null;

  if (item.customIcon) return null;

  try {
    const u = new URL(item.url);
    return buildGoogleFaviconUrl(u.hostname, getIconRefreshedAt(item));
  } catch {
    return null;
  }
}

function processIconHydrationQueue() {
  while (activeIconHydrations < ICON_HYDRATION_CONCURRENCY && iconHydrationQueue.length > 0) {
    const task = iconHydrationQueue.shift();
    activeIconHydrations++;

    Promise.resolve()
      .then(task)
      .catch(err => faviconDebugLog("icon hydration task failed", err))
      .finally(() => {
        activeIconHydrations--;
        processIconHydrationQueue();
      });
  }
}

function scheduleDeferredIconHydration(iconElement, item) {
  const deferredSrc = getDeferredIconSrc(item);
  if (!deferredSrc || deferredSrc === iconElement.src) return;

  iconHydrationQueue.push(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
    if (!iconElement.isConnected) return;
    iconElement.src = deferredSrc;
  });

  processIconHydrationQueue();
}

function resolveIconSrc(item) {
  const immediateSrc = getImmediateIconSrc(item);
  if (immediateSrc && immediateSrc !== PLACEHOLDER_ICON_URL) {
    return immediateSrc;
  }

  return getDeferredIconSrc(item) || immediateSrc;
}

// Fetches a page's HTML once and parses it, shared by the link-icon and
// manifest lookups below.
async function fetchPageDocument(pageUrl) {
  const origin = new URL(pageUrl).origin;
  faviconDebugLog("fetching page HTML", pageUrl);

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
  faviconDebugLog("page link icon candidates", candidates, "resolved", resolved);
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
  faviconDebugLog("manifest icons", manifest.icons, "resolved", resolved);
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
      faviconDebugLog("page fetch failed", err);
    }

    if (document.getElementById("enable-experimental-favicon-fetch-link")?.checked && pageDoc) {
      try {
        const linkIcon = getFaviconFromPageLinks(pageDoc, pageOrigin);
        if (linkIcon) return linkIcon;
      } catch (err) {
        faviconDebugLog("standard favicon link parse failed", err);
      }
    }

    if (document.getElementById("enable-experimental-favicon-fetch-manifest")?.checked && pageDoc) {
      try {
        const manifestIcon = await getFaviconFromManifest(pageDoc, pageOrigin);
        if (manifestIcon) return manifestIcon;
      } catch (err) {
        faviconDebugLog("manifest favicon failed (fetch)", err);
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

  // "none" mode only blocks automatic/background refreshes. Explicit
  // force:true calls (triggered by saving/creating a bookmark, or by the
  // manual "refresh icon" context menu action) always bypass this,
  // regardless of mode.
  if (!force && mode === "none") return false;

  if (!force && mode === "missing" && !isIconMissing(item)) return false;
  if (!shouldRefreshIcon(getIconRefreshedAt(item), frequencyHours, force)) return false;

  const refreshTimestamp = Date.now();

  try {
    const faviconUrl = await getBestFaviconUrl(item);

    if (faviconUrl) {
      let resolvedIconSrc = faviconUrl;
      if (isGoogleFaviconUrl(faviconUrl)) {
        // Known to always be CORS-blocked unless host permission was granted —
        // skip fetch() here and use the URL directly as <img src>.
        setCachedFaviconDataUrl(item, faviconUrl);
      } else {
        try {
          // Cache the actual bytes as a data URL when we can.
          const dataUrl = await fetchIconAsDataUrl(faviconUrl, true);
          resolvedIconSrc = dataUrl;
          setCachedFaviconDataUrl(item, dataUrl);
        } catch (fetchErr) {
          // Fetch blocked (CORS/permissions) — <img> can still load the
          // remote URL directly without CORS, so use that instead. This is
          // expected/handled, so only noisy in debug mode.
          faviconDebugLog("could not download icon bytes, using direct URL", faviconUrl, fetchErr);
          setCachedFaviconDataUrl(item, faviconUrl);
        }
      }

      if (item.colorFromIcon && (!isGoogleFaviconUrl(resolvedIconSrc) || await hasHostPermission())) {
        const iconColor = await extractDominantColorFromImageSource(resolvedIconSrc);
        if (iconColor) {
          setFaviconCacheEntry(item, { iconColor });
          if (item.tileColor !== iconColor) {
            item.tileColor = iconColor;
            item.updatedAt = Date.now();
          }
        }
      }
    }
  } catch (err) {
    console.warn("favicon refresh failed", err);
  }

  setIconRefreshedAt(item, refreshTimestamp);
  return true;
}

const ICON_REFRESH_BATCH_SIZE = 5;

export async function refreshBookmarkIconsIfNeeded(options = {}) {
  const force = !!options.force;
  const bookmarkId = options.bookmarkId || null;
  const persist = options.persist !== false;
  const sync = !!options.sync;

  let mode = "missing";
  let frequencyHours = DEFAULT_ICON_AUTO_REFRESH_HOURS;

  if (!force) {
    const config = await loadConfig();
    mode = config?.housekeeper?.iconAutoRefreshMode || "missing";
    frequencyHours = Math.max(1, Number(config?.housekeeper?.iconAutoRefreshHours) || DEFAULT_ICON_AUTO_REFRESH_HOURS);

    if (mode === "none") {
      return false;
    }
  }

  const tasks = [];

  for (const group of state.groups) {
    if (group.deleted) continue;

    for (const item of getAllGroupBookmarks(group, { includeDeleted: false })) {
      if (bookmarkId && item.id !== bookmarkId) continue;

      tasks.push(() => refreshBookmarkIcon(item, { force, mode, frequencyHours }));
    }
  }

  let changed = false;

  for (let i = 0; i < tasks.length; i += ICON_REFRESH_BATCH_SIZE) {
    const batch = tasks.slice(i, i + ICON_REFRESH_BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(fn => fn()));

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value === true) {
        changed = true;
      } else if (result.status === "rejected") {
        console.warn("refreshBookmarkIcon failed", result.reason);
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

export async function applyMassTileColorFromIcon(enable) {
  const shouldEnable = !!enable;
  let groupsUpdated = 0;
  let bookmarksUpdated = 0;

  if (!shouldEnable) {
    const now = Date.now();
    for (const group of state.groups) {
      if (group.deleted) continue;

      let groupBookmarksChanged = false;
      if (group.colorFromIcon) {
        group.colorFromIcon = false;
        group.tileColor = null;
        group.updatedAt = now;
        groupsUpdated++;
      }

      for (const item of getAllGroupBookmarks(group, { includeDeleted: false })) {
        if (item.colorFromIcon) {
          item.colorFromIcon = false;
          item.tileColor = null;
          item.updatedAt = now;
          bookmarksUpdated++;
          groupBookmarksChanged = true;
        }
      }

      if (groupBookmarksChanged) {
        group.updatedAt = now;
      }
    }

    if (groupsUpdated > 0 || bookmarksUpdated > 0) {
      await saveState();
      await syncWrite();
      render();
    }

    return { groupsUpdated, bookmarksUpdated };
  }

  await ensureHostPermission();
  const hostAllowed = await hasHostPermission();
  const tasks = [];

  for (const group of state.groups) {
    if (group.deleted) continue;

    const { iconEmoji, customIcon } = resolveGroupIcons(group);
    if (customIcon || iconEmoji) {
      tasks.push(async () => {
        let extracted = null;
        if (customIcon) {
          extracted = await extractDominantColorFromImageSource(customIcon);
        }
        if (!extracted && iconEmoji) {
          extracted = extractDominantColorFromEmoji(iconEmoji);
        }
        group.colorFromIcon = true;
        group.tileColor = extracted || null;
        group.updatedAt = Date.now();
        groupsUpdated++;
      });
    }

    for (const item of getAllGroupBookmarks(group, { includeDeleted: false })) {
      if (!item.url) continue;

      tasks.push(async () => {
        item.colorFromIcon = true;
        const cachedEntry = getFaviconCacheEntry(item);
        let extractedColor = isValidHexColor(cachedEntry.iconColor) ? cachedEntry.iconColor : null;

        if (!extractedColor) {
          const iconSrc = resolveIconSrc(item);
          if (iconSrc && iconSrc !== PLACEHOLDER_ICON_URL && (!isGoogleFaviconUrl(iconSrc) || hostAllowed)) {
            extractedColor = await extractDominantColorFromImageSource(iconSrc);
            if (extractedColor) {
              setFaviconCacheEntry(item, { iconColor: extractedColor });
            }
          }
        }

        item.tileColor = extractedColor || null;
        const updatedAt = Date.now();
        item.updatedAt = updatedAt;
        group.updatedAt = updatedAt;
        bookmarksUpdated++;
      });
    }
  }

  for (let i = 0; i < tasks.length; i += ICON_REFRESH_BATCH_SIZE) {
    const batch = tasks.slice(i, i + ICON_REFRESH_BATCH_SIZE);
    await Promise.allSettled(batch.map(fn => fn()));
  }

  if (groupsUpdated > 0 || bookmarksUpdated > 0) {
    await saveState();
    await syncWrite();
    render();
  }

  return { groupsUpdated, bookmarksUpdated };
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
const bmNotes = document.getElementById("bm-notes");
const bmNotesCounter = document.getElementById("bm-notes-counter");
const bmColor = document.getElementById("bm-color");
const bmColorCustom = document.getElementById("bm-color-custom");
const bmColorFromIcon = document.getElementById("bm-color-from-icon");
const bmTagsList = document.getElementById("bm-tags-list");
const bmNewTagName = document.getElementById("bm-new-tag-name");
const bmNewTagColor = document.getElementById("bm-new-tag-color");
const bmAddTagBtn = document.getElementById("bm-add-tag-btn");
const bmSave = document.getElementById("bm-save");
const bmCancel = document.getElementById("bm-cancel");

const DEFAULT_TAG_PALETTE = ["#10b981", "#4a6bff", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444"];
let editingBookmark = null;
let selectedTagIds = new Set();
let pendingSectionIdForNewBookmark = null;

function renderModalTagsList() {
  if (!bmTagsList) return;
  bmTagsList.innerHTML = "";

  const activeTags = (state.tags || []).filter(tag => tag && !tag.deleted);
  activeTags.forEach(tag => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bm-tag-chip" + (selectedTagIds.has(tag.id) ? " active" : "");
    chip.style.setProperty("--tag-color", isValidHexColor(tag.color) ? tag.color : "#4a6bff");

    const nameSpan = document.createElement("span");
    nameSpan.className = "bm-tag-chip-name";
    nameSpan.textContent = tag.name;

    const deleteSpan = document.createElement("span");
    deleteSpan.className = "bm-tag-delete";
    deleteSpan.textContent = "×";
    deleteSpan.title = t("delete") || "Delete";

    deleteSpan.addEventListener("click", async e => {
      e.stopPropagation();
      const now = Date.now();
      tag.deleted = true;
      tag.deletedAt = now;
      tag.updatedAt = now;
      selectedTagIds.delete(tag.id);

      for (const group of (state.groups || [])) {
        for (const item of getAllGroupBookmarks(group, { includeDeleted: true })) {
          if (Array.isArray(item.tags) && item.tags.includes(tag.id)) {
            item.tags = item.tags.filter(id => id !== tag.id);
            item.updatedAt = now;
          }
        }
      }

      renderModalTagsList();
      await saveState();
      void syncWrite();
      render();
    });

    chip.addEventListener("click", () => {
      if (selectedTagIds.has(tag.id)) {
        selectedTagIds.delete(tag.id);
      } else {
        selectedTagIds.add(tag.id);
      }
      renderModalTagsList();
    });

    chip.appendChild(nameSpan);
    chip.appendChild(deleteSpan);
    bmTagsList.appendChild(chip);
  });
}

function createOrSelectTagFromInput() {
  if (!bmNewTagName) return;
  const rawName = bmNewTagName.value.trim();
  if (!rawName || isReservedSystemTagName(rawName)) {
    bmNewTagName.value = "";
    return;
  }

  if (!Array.isArray(state.tags)) {
    state.tags = [];
  }

  const existing = state.tags.find(
    tag => tag && !tag.deleted && tag.name.toLowerCase() === rawName.toLowerCase()
  );

  if (existing) {
    selectedTagIds.add(existing.id);
  } else {
    const color = isValidHexColor(bmNewTagColor?.value) ? bmNewTagColor.value : "#10b981";
    const newTag = {
      id: generateId("t"),
      name: rawName,
      color,
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };
    state.tags.push(newTag);
    selectedTagIds.add(newTag.id);

    if (bmNewTagColor) {
      const nextColor = DEFAULT_TAG_PALETTE[state.tags.filter(t => !t.deleted).length % DEFAULT_TAG_PALETTE.length];
      bmNewTagColor.value = nextColor;
    }
  }

  bmNewTagName.value = "";
  renderModalTagsList();
}

if (bmAddTagBtn) {
  bmAddTagBtn.addEventListener("click", createOrSelectTagFromInput);
}
if (bmNewTagName) {
  bmNewTagName.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      createOrSelectTagFromInput();
    }
  });
}

if (bmColor && bmColorCustom && bmColorFromIcon) {
  bmColor.addEventListener("input", () => {
    bmColorCustom.checked = true;
    bmColorFromIcon.checked = false;
  });
  bmColorCustom.addEventListener("change", () => {
    if (bmColorCustom.checked) {
      bmColorFromIcon.checked = false;
    }
  });
  bmColorFromIcon.addEventListener("change", () => {
    if (bmColorFromIcon.checked) {
      bmColorCustom.checked = false;
    }
  });
}

function updateNotesCounter() {
  if (bmNotesCounter) {
    bmNotesCounter.textContent = `${bmNotes.value.length}/100`;
  }
}

bmNotes.addEventListener("input", updateNotesCounter);

export function openBookmarkModal(data = null, options = {}) {
  editingBookmark = data;
  pendingSectionIdForNewBookmark = options?.sectionId ?? null;
  const fallbackHex = "#4a6bff";

  if (data) {
    modalTitle.textContent = t("editBookmark");
    bmTitle.value = data.title;
    bmUrl.value = data.url;
    bmIcon.value = data.customIcon || "";
    bmNotes.value = data.notes || "";
    selectedTagIds = new Set(Array.isArray(data.tags) ? data.tags : []);
    if (bmColor) {
      bmColor.value = isValidHexColor(data.tileColor) ? data.tileColor : fallbackHex;
    }
    if (bmColorFromIcon) bmColorFromIcon.checked = !!data.colorFromIcon;
    if (bmColorCustom) bmColorCustom.checked = !!(data.tileColor && !data.colorFromIcon);
  } else {
    modalTitle.textContent = t("newBookmark");
    bmTitle.value = "";
    bmUrl.value = "";
    bmIcon.value = "";
    bmNotes.value = "";
    selectedTagIds = new Set();
    if (bmColor) bmColor.value = fallbackHex;
    if (bmColorFromIcon) bmColorFromIcon.checked = false;
    if (bmColorCustom) bmColorCustom.checked = false;
  }

  if (bmNewTagName) bmNewTagName.value = "";
  renderModalTagsList();
  updateNotesCounter();

  modal.classList.remove("hidden");
  bmTitle.focus();
}

function closeBookmarkModal() {
  modal.classList.add("hidden");
  editingBookmark = null;
  pendingSectionIdForNewBookmark = null;
  selectedTagIds = new Set();
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
  const notes = bmNotes.value.trim();
  const url = normalizeBookmarkUrl(rawUrl);

  if (!url) {
    alert("Musíš zadať URL.");
    return;
  }

  const group = state.groups.find(g => g.id === window.activeGroupId);
  if (!group) return;

  const wantColorFromIcon = !!bmColorFromIcon?.checked;
  const wantCustomColor = !!bmColorCustom?.checked;
  const pickedColor = bmColor?.value || "#4a6bff";
  const needsExperimental =
    document.getElementById("enable-experimental-favicon-fetch-link")?.checked ||
    document.getElementById("enable-experimental-favicon-fetch-manifest")?.checked;

  // Request optional host permission upfront while user gesture is still active.
  if (wantColorFromIcon || icon || needsExperimental) {
    await ensureHostPermission();
  }

  let targetBookmark = null;
  let iconChanged = false;
  let isNewBookmark = false;

  // Commit any typed tag name if the user clicked Save without pressing "+ Tag"
  if (bmNewTagName && bmNewTagName.value.trim()) {
    createOrSelectTagFromInput();
  }

  // EDIT
  if (editingBookmark) {
    // 🔥 Look up item by ID (including items nested inside stacks) instead of using stale reference
    const loc = findBookmarkLocation(editingBookmark.id, group) || findBookmarkLocation(editingBookmark.id);
    const currentItem = loc?.item;
    if (currentItem) {
      const previousCustomIcon = currentItem.customIcon || null;
      const nextCustomIcon = icon || null;
      iconChanged = previousCustomIcon !== nextCustomIcon;

      currentItem.title = title || url;
      currentItem.url = url;
      currentItem.customIcon = nextCustomIcon;
      currentItem.notes = notes || null;
      currentItem.tags = Array.from(selectedTagIds);
      currentItem.colorFromIcon = wantColorFromIcon;
      if (wantColorFromIcon) {
        if (iconChanged) {
          currentItem.tileColor = null;
        }
      } else if (wantCustomColor) {
        currentItem.tileColor = pickedColor;
      } else {
        currentItem.tileColor = null;
      }

      if (iconChanged) {
        clearFaviconCacheEntry(currentItem); // reset cached icon + timestamp
      }
      currentItem.updatedAt = Date.now();
      if (loc.parentStack) {
        loc.parentStack.updatedAt = currentItem.updatedAt;
      }
      targetBookmark = currentItem;
    }

  // CREATE
  } else {
    isNewBookmark = true;
    targetBookmark = {
      id: generateId("b"),
      title: title || url,
      url,
      customIcon: icon || null,
      notes: notes || null,
      tags: Array.from(selectedTagIds),
      sectionId: pendingSectionIdForNewBookmark || null,
      tileColor: wantCustomColor ? pickedColor : null,
      colorFromIcon: wantColorFromIcon,
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };
    group.items.push(targetBookmark);
  }

  const targetBookmarkId = targetBookmark?.id || null;

  await saveState();
  closeBookmarkModal();
  render();

  if (targetBookmarkId) {
    // Cache/update icon immediately after save.
    await refreshBookmarkIconsIfNeeded({
      force: iconChanged || isNewBookmark || wantColorFromIcon || isIconMissing(targetBookmark),
      bookmarkId: targetBookmarkId,
      persist: true,
      sync: false
    });

    const latestItem = findBookmarkInState(targetBookmarkId);
    if (latestItem && wantColorFromIcon) {
      const iconSrc = getCachedFaviconDataUrl(latestItem) || latestItem.customIcon || getFaviconUrl(latestItem.url);
      if (iconSrc && (!isGoogleFaviconUrl(iconSrc) || await hasHostPermission())) {
        const autoColor = await extractDominantColorFromImageSource(iconSrc);
        if (autoColor) {
          setFaviconCacheEntry(latestItem, { iconColor: autoColor });
          if (latestItem.tileColor !== autoColor) {
            latestItem.tileColor = autoColor;
            latestItem.updatedAt = Date.now();
            await saveState();
          }
          render();
        }
      }
    }
  }

  await syncWrite();

  // Check link health asynchronously in background (don't delay UI update)
  const itemToCheck = findBookmarkInState(targetBookmarkId);
  if (itemToCheck && itemToCheck.url) {
    try {
      const isValid = await validateSingleLink(itemToCheck.url);
      const liveItem = findBookmarkInState(targetBookmarkId);
      if (liveItem && setBookmarkSystemTag(liveItem.id, SYSTEM_TAG_DEAD_LINK_ID, !isValid)) {
        await saveSystemTags();
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
  const activeGroup = state.groups.find(g => g.id === window.activeGroupId);
  const loc = (activeGroup && findBookmarkLocation(bookmarkId, activeGroup)) || findBookmarkLocation(bookmarkId);
  if (!loc) return;
  const { group, item, parentStack, list, index } = loc;
  const stackItem = isStackItem(item);

  if (action === "edit") {
    if (stackItem) {
      openStackPopover(item.id, { focusTitle: true });
    } else {
      openBookmarkModal(item);
    }
    return;
  }

  if (action === "open-new-tab") {
    if (stackItem) {
      for (const child of (item.children || [])) {
        if (!child.deleted && child.url) {
          openBookmark(child.url, null, true);
        }
      }
    } else {
      openBookmark(item.url, null, true);
    }
    return;
  }

  if (action === "remove-from-stack" && parentStack) {
    list.splice(index, 1);
    const now = Date.now();
    item.sectionId = parentStack.sectionId ?? null;
    item.updatedAt = now;
    parentStack.updatedAt = now;

    const stackIndex = group.items.findIndex(i => i && i.id === parentStack.id);
    if (stackIndex !== -1) {
      group.items.splice(stackIndex + 1, 0, item);
    } else {
      group.items.push(item);
    }

    const cleanupOutcome = cleanupStackIfNeeded(group, parentStack);
    const purgedIds = (cleanupOutcome === "removed" || cleanupOutcome === "unwrapped") ? [parentStack.id] : [];
    group.updatedAt = now;

    await saveState();
    await syncWrite(state, purgedIds.length > 0 ? { purgedIds } : undefined);
    render();
    return;
  }

  if (action === "unstack" && stackItem) {
    const now = Date.now();
    const unwrapped = (item.children || []).filter(Boolean).map(child => ({
      ...child,
      sectionId: item.sectionId ?? null,
      updatedAt: now
    }));
    group.items.splice(index, 1, ...unwrapped);
    group.updatedAt = now;

    if (activeStackPopoverId === item.id) {
      closeStackPopover();
    }

    await saveState();
    await syncWrite(state, { purgedIds: [item.id] });
    render();
    return;
  }

  if (action === "delete") {
    const now = Date.now();
    item.deleted = true;
    item.deletedAt = now;
    item.updatedAt = now;
    if (parentStack) parentStack.updatedAt = now;

    await saveState();
    await syncWrite();
    render();
    return;
  }

  if (action === "restore") {
    const now = Date.now();
    item.deleted = false;
    item.deletedAt = null;
    item.updatedAt = now;
    if (parentStack) {
      parentStack.updatedAt = now;
      if (parentStack.deleted) {
        parentStack.deleted = false;
        parentStack.deletedAt = null;
      }
    }

    await saveState();
    await syncWrite();
    render();
    return;
  }

  if (action === "refresh-icon" && !stackItem) {
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
    if (parentStack) parentStack.updatedAt = item.updatedAt;

    await saveState();
    await syncWrite();
    render();
    return;
  }

  if (action === "delete-permanent") {
    const itemLabel = item.title || (stackItem ? (t("defaultStackName") || "Stack") : item.url);
    const confirmMsg = t("confirmDeletePermanentBookmark").replace("{0}", itemLabel);
    if (!confirm(confirmMsg)) return;

    const purgedIds = [item.id];
    if (stackItem) {
      for (const child of (item.children || [])) {
        if (child?.id) purgedIds.push(child.id);
        clearFaviconCacheEntry(child);
      }
      if (activeStackPopoverId === item.id) {
        closeStackPopover();
      }
    } else {
      clearFaviconCacheEntry(item); // drop any cached icon for this bookmark
    }

    if (index > -1) {
      list.splice(index, 1);
    }
    if (parentStack) {
      parentStack.updatedAt = Date.now();
      const cleanupOutcome = cleanupStackIfNeeded(group, parentStack);
      if (cleanupOutcome === "removed" || cleanupOutcome === "unwrapped") {
        purgedIds.push(parentStack.id);
      }
    }
    group.updatedAt = Date.now();

    await saveState();
    await syncWrite(state, { purgedIds });
    render();
  }
}

// ---------- Move bookmark to another group ----------
export async function moveBookmarkToGroup(bookmarkId, targetGroupId) {
  const activeGroup = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
  const loc = (activeGroup && findBookmarkLocation(bookmarkId, activeGroup)) || findBookmarkLocation(bookmarkId);
  const sourceGroup = loc?.group;
  const targetGroup = state.groups.find(g => g.id === targetGroupId && !g.deleted);

  if (!sourceGroup || !targetGroup || sourceGroup.id === targetGroup.id) return;

  const { list, index, parentStack } = loc;
  const [item] = list.splice(index, 1);
  const now = Date.now();
  item.sectionId = null;
  item.updatedAt = now;
  if (isStackItem(item)) {
    for (const child of (item.children || [])) {
      child.sectionId = null;
      child.updatedAt = now;
    }
    if (activeStackPopoverId === item.id) {
      closeStackPopover();
    }
  }
  const purgedIds = [];
  if (parentStack) {
    parentStack.updatedAt = now;
    const cleanupOutcome = cleanupStackIfNeeded(sourceGroup, parentStack);
    if (cleanupOutcome === "removed" || cleanupOutcome === "unwrapped") {
      purgedIds.push(parentStack.id);
    }
  }
  targetGroup.items.push(item);

  sourceGroup.updatedAt = now;
  targetGroup.updatedAt = now;

  await saveState();
  await syncWrite(state, purgedIds.length > 0 ? { purgedIds } : undefined);
  render();
}