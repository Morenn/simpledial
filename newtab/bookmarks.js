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
  isReservedSystemTagName,
  getNextDefaultTagColor,
  deleteTagFromState,
  updateTagInState
} from "./state.js";
import { render } from "./render.js";
import { syncWrite, validateSingleLink } from "./sync.js";
import { t } from "./i18n.js";
import { loadConfig, logDebug } from "./config.js";
import { normalizeBookmarkUrl } from "./bookmarks-api.js";
import { syncRovingTabIndex } from "./keyboard-nav.js";

const faviconDebugLog = (...args) => logDebug("favicon", ...args);
import {
  extractDominantColorFromImageSource,
  extractDominantColorFromEmoji,
  resolveGroupIcons,
  applyTileColorStyle,
  isValidHexColor,
  blobToDataUrl,
  fetchIconAsDataUrl,
  isUrlHostExcludedFromIconRefresh,
  isIconUrlExcluded,
  isIconUrlFailed,
  isUrlLikeIcon
} from "./color-utils.js";

const DEFAULT_ICON_AUTO_REFRESH_HOURS = 24;
const PLACEHOLDER_ICON_URL = chrome.runtime.getURL("icons/icon-16.png");
export const FALLBACK_GLOBE_ICON_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%239aa0a6' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'/%3E%3C/svg%3E";
export const DEFAULT_FALLBACK_ICON_MAX_BYTES = 200 * 1024;
export const DEFAULT_FALLBACK_ICON_MAX_DIM = 128;
const VALID_FALLBACK_DATA_URL_REGEX = /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);/i;
let customFallbackBookmarkIcon = null;

export function isValidFallbackBookmarkIcon(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("data:")) {
    return trimmed.length <= DEFAULT_FALLBACK_ICON_MAX_BYTES && VALID_FALLBACK_DATA_URL_REGEX.test(trimmed);
  }
  return !isUrlLikeIcon(trimmed) && trimmed.length <= 8;
}

function emojiToSvgDataUrl(emoji) {
  const escaped = String(emoji)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-size='18'>${escaped}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function resolveFallbackIconUrlValue(value) {
  if (!isValidFallbackBookmarkIcon(value)) return null;
  const trimmed = value.trim();
  return trimmed.startsWith("data:") ? trimmed : emojiToSvgDataUrl(trimmed);
}

export function setCustomFallbackBookmarkIcon(value) {
  customFallbackBookmarkIcon = resolveFallbackIconUrlValue(value);
}

export function getFallbackBookmarkIconUrl(config = null) {
  const fromConfig = config?.appearance?.defaultBookmarkIcon;
  const resolved = resolveFallbackIconUrlValue(fromConfig);
  if (resolved) {
    return resolved;
  }
  return customFallbackBookmarkIcon || FALLBACK_GLOBE_ICON_URL;
}
const ICON_HYDRATION_CONCURRENCY = 4;
const iconHydrationQueue = [];
let activeIconHydrations = 0;
let iconHydrationStarted = false;
let iconHydrationScheduled = false;

export function resetIconHydrationQueue() {
  iconHydrationQueue.length = 0;
}

export function startIconHydrationAfterPaint() {
  if (iconHydrationStarted) {
    processIconHydrationQueue();
    return;
  }
  if (iconHydrationScheduled) return;
  iconHydrationScheduled = true;
  const run = () => {
    iconHydrationScheduled = false;
    iconHydrationStarted = true;
    processIconHydrationQueue();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => setTimeout(run, 0));
  } else {
    setTimeout(run, 0);
  }
}

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
    // Call request() directly without awaiting contains() first so user-gesture
    // activation is preserved (especially in Firefox). If already granted, this
    // resolves true immediately without prompting.
    return await chrome.permissions.request({ origins: ["*://*/*"] });
  } catch (err) {
    console.warn("[favicon] permissions.request failed", err);
    return await hasHostPermission();
  }
}

// ---------- Favicon cache (localStorage only, never synced) ----------
const FAVICON_CACHE_PREFIX = "favicon-cache:";

const faviconMemoryCache = new Map();

function faviconCacheKey(item) {
  return `${FAVICON_CACHE_PREFIX}${item.id}`;
}

function getFaviconCacheEntry(item) {
  if (!item?.id) return {};
  if (faviconMemoryCache.has(item.id)) {
    return faviconMemoryCache.get(item.id);
  }
  try {
    const raw = localStorage.getItem(faviconCacheKey(item));
    const parsed = raw ? JSON.parse(raw) : {};
    faviconMemoryCache.set(item.id, parsed);
    return parsed;
  } catch (err) {
    console.warn("[favicon] localStorage read/parse failed", err);
    return {};
  }
}

function setFaviconCacheEntry(item, partial) {
  if (!item?.id) return;
  const next = { ...getFaviconCacheEntry(item), ...partial };
  faviconMemoryCache.set(item.id, next);
  try {
    localStorage.setItem(faviconCacheKey(item), JSON.stringify(next));
  } catch (err) {
    console.warn("[favicon] localStorage write failed (quota?)", err);
  }
}

function clearFaviconCacheEntry(item) {
  if (!item?.id) return;
  faviconMemoryCache.delete(item.id);
  try {
    localStorage.removeItem(faviconCacheKey(item));
  } catch (err) {
    console.warn("[favicon] localStorage remove failed", err);
  }
}

const ICON_EXCLUDE_BOOKMARKS_KEY = "myspeeddial-local-icon-exclude-bookmarks";
const ICON_FAILED_BOOKMARKS_KEY = "myspeeddial-local-icon-failed-bookmarks";
let excludedBookmarkIdsCache = null;
let failedBookmarkIdsCache = null;
const dismissedFailedIconIds = new Set();

function readLocalIdSet(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === "string" && id) : []);
  } catch {
    return new Set();
  }
}

function writeLocalIdSet(storageKey, set) {
  try {
    if (set.size > 0) {
      localStorage.setItem(storageKey, JSON.stringify([...set]));
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage errors.
  }
}

function getExcludedBookmarkIdSet() {
  if (!(excludedBookmarkIdsCache instanceof Set)) {
    excludedBookmarkIdsCache = readLocalIdSet(ICON_EXCLUDE_BOOKMARKS_KEY);
  }
  return excludedBookmarkIdsCache;
}

export function isBookmarkIconExcludedById(bookmarkId) {
  if (!bookmarkId) return false;
  return getExcludedBookmarkIdSet().has(bookmarkId);
}

export function setBookmarkIconExcludedById(bookmarkId, excluded) {
  if (!bookmarkId) return false;
  const set = getExcludedBookmarkIdSet();
  if (excluded) {
    set.add(bookmarkId);
  } else {
    set.delete(bookmarkId);
  }
  writeLocalIdSet(ICON_EXCLUDE_BOOKMARKS_KEY, set);
  return excluded;
}

export function toggleBookmarkIconExcludedById(bookmarkId) {
  if (!bookmarkId) return false;
  return setBookmarkIconExcludedById(bookmarkId, !isBookmarkIconExcludedById(bookmarkId));
}

function getFailedBookmarkIdSet() {
  if (!(failedBookmarkIdsCache instanceof Set)) {
    failedBookmarkIdsCache = readLocalIdSet(ICON_FAILED_BOOKMARKS_KEY);
  }
  return failedBookmarkIdsCache;
}

function saveFailedBookmarkIdSet(set) {
  writeLocalIdSet(ICON_FAILED_BOOKMARKS_KEY, set);
}

export function recordFailedIconRefresh(bookmarkId) {
  if (!bookmarkId) return;
  dismissedFailedIconIds.delete(bookmarkId);
  const set = getFailedBookmarkIdSet();
  if (set.has(bookmarkId)) return;
  set.add(bookmarkId);
  saveFailedBookmarkIdSet(set);
}

export function clearFailedIconRefresh(bookmarkId) {
  if (!bookmarkId) return;
  dismissedFailedIconIds.add(bookmarkId);
  const set = getFailedBookmarkIdSet();
  if (!set.delete(bookmarkId)) return;
  saveFailedBookmarkIdSet(set);
}

export function clearAllFailedIconRefreshes() {
  const excludedSet = getExcludedBookmarkIdSet();
  const set = getFailedBookmarkIdSet();
  for (const id of [...set]) {
    if (!excludedSet.has(id)) {
      dismissedFailedIconIds.add(id);
      set.delete(id);
    }
  }
  if (typeof document !== "undefined") {
    document.querySelectorAll(".bookmark-tile[data-bookmark-id]").forEach(tile => {
      const id = tile.dataset.bookmarkId;
      if (id && !excludedSet.has(id)) {
        dismissedFailedIconIds.add(id);
      }
    });
  }
  saveFailedBookmarkIdSet(set);
}

export function getFailedIconRefreshBookmarks() {
  const seenIds = new Set([
    ...getFailedBookmarkIdSet(),
    ...getExcludedBookmarkIdSet()
  ]);
  if (typeof document !== "undefined") {
    document.querySelectorAll(".bookmark-tile[data-bookmark-id]").forEach(tile => {
      const id = tile.dataset.bookmarkId;
      if (!id || seenIds.has(id) || dismissedFailedIconIds.has(id)) return;
      const img = tile.querySelector("img.bookmark-favicon");
      if (!img || !img.complete) return;
      const src = img.currentSrc || img.src || "";
      if (!src || src === PLACEHOLDER_ICON_URL) return;
      const isGoogleFallbackGlobe = isGoogleFaviconUrl(src) && img.naturalWidth > 0 && img.naturalWidth <= 16 && img.naturalHeight <= 16;
      const isBroken = img.naturalWidth === 0;
      if (isGoogleFallbackGlobe || isBroken) {
        seenIds.add(id);
      }
    });
  }

  const results = [];
  for (const id of seenIds) {
    const loc = findBookmarkLocation(id);
    const item = loc?.item;
    if (!item || item.deleted || loc?.group?.deleted || loc?.parentStack?.deleted) continue;
    results.push({
      id: item.id,
      category: "bookmark",
      title: item.title || item.url || item.id,
      url: item.url || "",
      excluded: isBookmarkIconExcludedById(item.id)
    });
  }
  return results;
}

function isRemoteCustomIconFailedOrExcluded(iconUrl, selector = null) {
  if (typeof iconUrl !== "string" || !/^https?:\/\//i.test(iconUrl.trim())) return false;
  const trimmed = iconUrl.trim();
  if (isIconUrlExcluded(trimmed) || isUrlHostExcludedFromIconRefresh(trimmed) || isIconUrlFailed(trimmed)) {
    return true;
  }
  if (selector && typeof document !== "undefined") {
    const img = document.querySelector(selector);
    if (img && img.complete && img.naturalWidth === 0) {
      return true;
    }
  }
  return false;
}

export function getFailedIconRefreshItems(config = null) {
  const results = [...getFailedIconRefreshBookmarks()];

  for (const group of (state.groups || [])) {
    if (!group || group.deleted || !group.customIcon) continue;
    const selector = typeof CSS !== "undefined" && group.id
      ? `.group-tab[data-group-id="${CSS.escape(group.id)}"] img`
      : null;
    if (!isRemoteCustomIconFailedOrExcluded(group.customIcon, selector)) continue;
    const iconUrl = group.customIcon.trim();
    results.push({
      id: `group:${group.id}`,
      category: "group",
      title: group.name || group.id,
      url: iconUrl,
      excluded: isIconUrlExcluded(iconUrl) || isUrlHostExcludedFromIconRefresh(iconUrl)
    });
  }

  const widgets = Array.isArray(config?.appearance?.customWidgets) ? config.appearance.customWidgets : [];
  for (const w of widgets) {
    if (!w || !w.id || !w.customIcon) continue;
    if (!isRemoteCustomIconFailedOrExcluded(w.customIcon)) continue;
    const iconUrl = w.customIcon.trim();
    results.push({
      id: `widget:${w.id}`,
      category: "widget",
      title: w.name || w.type || w.id,
      url: iconUrl,
      excluded: isIconUrlExcluded(iconUrl) || isUrlHostExcludedFromIconRefresh(iconUrl)
    });
  }

  const autoRouteIcons = config?.appearance?.customSearchAutoRouteIcons;
  if (autoRouteIcons && typeof autoRouteIcons === "object") {
    for (const [groupName, iconUrl] of Object.entries(autoRouteIcons)) {
      if (!isRemoteCustomIconFailedOrExcluded(iconUrl)) continue;
      const trimmed = iconUrl.trim();
      results.push({
        id: `widget-route:${groupName}`,
        category: "widget",
        title: groupName,
        url: trimmed,
        excluded: isIconUrlExcluded(trimmed) || isUrlHostExcludedFromIconRefresh(trimmed)
      });
    }
  }

  return results;
}

function isBookmarkIconLocallyExcluded(item) {
  if (!item) return false;
  if (item.id && isBookmarkIconExcludedById(item.id)) return true;
  if (item.url && isUrlHostExcludedFromIconRefresh(item.url)) return true;
  if (item.customIcon && isUrlHostExcludedFromIconRefresh(item.customIcon)) return true;
  return false;
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
  setFaviconCacheEntry(item, { iconColor: extracted });
  if (tile) applyTileColorStyle(tile, extracted);
  return extracted;
}

// ---------- Create bookmark tile ----------
export function createBookmarkTile(item, config = null) {
  const tile = document.createElement("div");
  tile.className = "bookmark-tile";
  tile.tabIndex = 0;
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

  if (config?.appearance && "defaultBookmarkIcon" in config.appearance) {
    setCustomFallbackBookmarkIcon(config.appearance.defaultBookmarkIcon);
  }
  const fallbackIconUrl = getFallbackBookmarkIconUrl(config);

  if (item.colorFromIcon && !effectiveColor) {
    if (cachedEntry.dataUrl) {
      void syncBookmarkColorFromIcon(item, tile, cachedEntry.dataUrl);
    } else {
      icon.addEventListener("load", () => {
        const loadedSrc = icon.currentSrc || icon.src;
        if (!loadedSrc || loadedSrc === PLACEHOLDER_ICON_URL || loadedSrc === fallbackIconUrl) return;
        void syncBookmarkColorFromIcon(item, tile, loadedSrc);
      });
    }
  }

  icon.addEventListener("error", () => {
    if (icon.src !== PLACEHOLDER_ICON_URL && icon.src !== fallbackIconUrl) {
      if (!isBookmarkIconLocallyExcluded(item)) {
        recordFailedIconRefresh(item.id);
        if (!getIconRefreshedAt(item)) {
          setIconRefreshedAt(item, Date.now());
        }
      }
      icon.src = fallbackIconUrl;
    }
  });

  icon.addEventListener("load", () => {
    const loadedSrc = icon.currentSrc || icon.src;
    if (!loadedSrc || loadedSrc === PLACEHOLDER_ICON_URL || loadedSrc === fallbackIconUrl) return;
    if (isGoogleFaviconUrl(loadedSrc) && icon.naturalWidth > 0 && icon.naturalWidth <= 16 && icon.naturalHeight <= 16) {
      if (!isBookmarkIconLocallyExcluded(item)) {
        recordFailedIconRefresh(item.id);
        if (!getIconRefreshedAt(item)) {
          setIconRefreshedAt(item, Date.now());
        }
      }
      return;
    }
    clearFailedIconRefresh(item.id);
  });

  icon.src = getImmediateIconSrc(item, config);
  scheduleDeferredIconHydration(icon, item);

  const link = document.createElement("a");
  link.className = "bookmark-title";
  link.tabIndex = -1;
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
  tile.tabIndex = 0;
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
    openStackPopover(stackItem.id, { focusFirstTile: e.detail === 0 });
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
let stackTitleDirty = false;

export function getActiveStackPopoverId() {
  return activeStackPopoverId;
}

async function commitStackTitleChange(stackId) {
  if (!stackId) return;
  const titleInput = document.getElementById("stack-popover-title");
  if (!titleInput) return;
  const loc = findBookmarkLocation(stackId);
  if (!loc || !isStackItem(loc.item)) return;
  const nextTitle = titleInput.value.trim() || (t("defaultStackName") || "Stack");
  const wasDirty = stackTitleDirty;
  stackTitleDirty = false;
  if (!wasDirty && loc.item.title === nextTitle) return;
  loc.item.title = nextTitle;
  loc.item.updatedAt = Date.now();
  await saveState();
  await syncWrite();
  render();
}

export function closeStackPopover() {
  const backdrop = document.getElementById("stack-popover");
  if (!backdrop) return;
  const previousStackId = activeStackPopoverId;
  const shouldCommitTitle = stackTitleDirty && previousStackId;
  const shouldRestoreFocus = !!(document.activeElement && backdrop.contains(document.activeElement));
  backdrop.classList.add("hidden");
  backdrop.classList.remove("dragging-outside");
  activeStackPopoverId = null;
  if (shouldCommitTitle) {
    void commitStackTitleChange(previousStackId);
  }
  if (shouldRestoreFocus && previousStackId) {
    const stackTile = document.querySelector(`.stack-tile[data-bookmark-id="${CSS.escape(previousStackId)}"]`);
    stackTile?.focus({ preventScroll: true });
  }
}

function populateStackPopover(stackItem, config = null) {
  stackTitleDirty = false;
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
  syncRovingTabIndex();
  if (!document.body?.classList?.contains("tiles-locked")) {
    import("./dragdrop.js").then(m => m.setupBookmarkDrag()).catch(() => {});
  }
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
  syncRovingTabIndex();

  if (!document.body?.classList?.contains("tiles-locked")) {
    import("./dragdrop.js").then(m => m.setupBookmarkDrag()).catch(() => {});
  }

  if (options.focusTitle && titleInput) {
    titleInput.focus();
    titleInput.select();
  } else if (options.focusFirstTile) {
    const firstTile = backdrop.querySelector(".stack-popover-grid .bookmark-tile");
    if (firstTile) {
      firstTile.focus({ preventScroll: true });
      syncRovingTabIndex();
    }
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
      stackTitleDirty = true;
      const nextTitle = titleInput.value.trim() || (t("defaultStackName") || "Stack");
      loc.item.title = titleInput.value;
      loc.item.updatedAt = Date.now();
      const tileLabel = document.querySelector(`.stack-tile[data-bookmark-id="${activeStackPopoverId}"] .stack-title`);
      if (tileLabel) tileLabel.textContent = nextTitle;
    });
    titleInput.addEventListener("change", async () => {
      if (!activeStackPopoverId) return;
      await commitStackTitleChange(activeStackPopoverId);
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

function isLocalIconUrl(src) {
  return typeof src === "string" && !/^(?:https?:)?\/\//i.test(src.trim());
}

function getImmediateIconSrc(item, config = null) {
  // Keep first paint strictly local and immediate.
  const isLocallyBlocked = isBookmarkIconLocallyExcluded(item) || (item?.id && getFailedBookmarkIdSet().has(item.id));
  const fallbackIconUrl = getFallbackBookmarkIconUrl(config);
  const cached = getCachedFaviconDataUrl(item);
  if (cached) {
    if (isLocalIconUrl(cached)) {
      return cached;
    }
    return isLocallyBlocked ? fallbackIconUrl : PLACEHOLDER_ICON_URL;
  }

  if (item.customIcon) {
    if (isLocalIconUrl(item.customIcon)) {
      return item.customIcon;
    }
    return isLocallyBlocked ? fallbackIconUrl : PLACEHOLDER_ICON_URL;
  }

  return isLocallyBlocked ? fallbackIconUrl : PLACEHOLDER_ICON_URL;
}

function getDeferredIconSrc(item) {
  if (isBookmarkIconLocallyExcluded(item) || (item?.id && getFailedBookmarkIdSet().has(item.id))) return null;

  const cached = getCachedFaviconDataUrl(item);
  if (cached) {
    return isLocalIconUrl(cached) ? null : cached;
  }

  if (item.customIcon) {
    return isLocalIconUrl(item.customIcon) ? null : item.customIcon;
  }

  try {
    const u = new URL(item.url);
    return buildGoogleFaviconUrl(u.hostname, getIconRefreshedAt(item));
  } catch {
    return null;
  }
}

function waitForIconLoadOrTimeout(imgEl, timeoutMs = 4000) {
  if (!imgEl) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      imgEl.removeEventListener("load", finish);
      imgEl.removeEventListener("error", finish);
      resolve();
    };
    const timerId = setTimeout(finish, timeoutMs);
    imgEl.addEventListener("load", finish, { once: true });
    imgEl.addEventListener("error", finish, { once: true });
  });
}

function processIconHydrationQueue() {
  if (!iconHydrationStarted) return;
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
    if (!iconElement.isConnected) return;
    const loadPromise = waitForIconLoadOrTimeout(iconElement);
    iconElement.src = deferredSrc;
    await loadPromise;
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
  if (item?.id && getFailedBookmarkIdSet().has(item.id)) {
    return true;
  }
  if (item.customIcon) {
    return !getCachedFaviconDataUrl(item);
  }

  return !getIconRefreshedAt(item);
}

async function refreshBookmarkIcon(item, options = {}) {
  const force = !!options.force;
  const mode = options.mode || "all";
  const frequencyHours = Math.max(1, Number(options.frequencyHours) || DEFAULT_ICON_AUTO_REFRESH_HOURS);

  if (!item || item.deleted) return false;
  if (!force && isBookmarkIconLocallyExcluded(item)) return false;

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
        // Cache Google S2 bytes as a data URL when host permission is granted
        // so subsequent startups load locally without hitting the network.
        if (await hasHostPermission()) {
          try {
            const dataUrl = await fetchIconAsDataUrl(faviconUrl, true);
            resolvedIconSrc = dataUrl;
            setCachedFaviconDataUrl(item, dataUrl);
            clearFailedIconRefresh(item.id);
          } catch (fetchErr) {
            faviconDebugLog("could not download Google S2 icon bytes, using direct URL", faviconUrl, fetchErr);
            setCachedFaviconDataUrl(item, faviconUrl);
          }
        } else {
          setCachedFaviconDataUrl(item, faviconUrl);
        }
      } else {
        try {
          // Cache the actual bytes as a data URL when we can.
          const dataUrl = await fetchIconAsDataUrl(faviconUrl, true);
          resolvedIconSrc = dataUrl;
          setCachedFaviconDataUrl(item, dataUrl);
          clearFailedIconRefresh(item.id);
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
    } else {
      recordFailedIconRefresh(item.id);
    }
  } catch (err) {
    recordFailedIconRefresh(item.id);
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
const bmCancelEditTagBtn = document.getElementById("bm-cancel-edit-tag-btn");
const bmSave = document.getElementById("bm-save");
const bmCancel = document.getElementById("bm-cancel");

let editingBookmark = null;
let editingTagId = null;
let selectedTagIds = new Set();
let selectedSystemTagIds = new Set();
let pendingSectionIdForNewBookmark = null;

function resetModalTagEditState() {
  editingTagId = null;
  if (bmNewTagName) bmNewTagName.value = "";
  if (bmAddTagBtn) bmAddTagBtn.textContent = t("addTag") || "+ Tag";
  if (bmCancelEditTagBtn) bmCancelEditTagBtn.classList.add("hidden");
  if (bmNewTagColor) bmNewTagColor.value = getNextDefaultTagColor();
}

function startEditingModalTag(tag) {
  if (!tag) return;
  editingTagId = tag.id;
  if (bmNewTagName) bmNewTagName.value = tag.name || "";
  if (bmNewTagColor) bmNewTagColor.value = isValidHexColor(tag.color) ? tag.color : "#10b981";
  if (bmAddTagBtn) bmAddTagBtn.textContent = t("save") || "Save";
  if (bmCancelEditTagBtn) bmCancelEditTagBtn.classList.remove("hidden");
  renderModalTagsList();
  bmNewTagName?.focus();
  bmNewTagName?.select();
}

function renderModalTagsList() {
  if (!bmTagsList) return;
  bmTagsList.innerHTML = "";

  const activeTags = (state.tags || []).filter(tag => tag && !tag.deleted);
  activeTags.forEach(tag => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bm-tag-chip"
      + (selectedTagIds.has(tag.id) ? " active" : "")
      + (editingTagId === tag.id ? " editing" : "");
    chip.style.setProperty("--tag-color", isValidHexColor(tag.color) ? tag.color : "#4a6bff");

    const dotSpan = document.createElement("span");
    dotSpan.className = "bm-tag-chip-dot";

    const nameSpan = document.createElement("span");
    nameSpan.className = "bm-tag-chip-name";
    nameSpan.textContent = tag.name;

    const editSpan = document.createElement("span");
    editSpan.className = "bm-tag-edit";
    editSpan.textContent = "✎";
    editSpan.title = t("edit") || "Edit";

    editSpan.addEventListener("click", e => {
      e.stopPropagation();
      if (editingTagId === tag.id) {
        resetModalTagEditState();
        renderModalTagsList();
      } else {
        startEditingModalTag(tag);
      }
    });

    const deleteSpan = document.createElement("span");
    deleteSpan.className = "bm-tag-delete";
    deleteSpan.textContent = "×";
    deleteSpan.title = t("delete") || "Delete";

    deleteSpan.addEventListener("click", async e => {
      e.stopPropagation();
      if (!deleteTagFromState(tag.id)) return;
      selectedTagIds.delete(tag.id);
      if (editingTagId === tag.id) {
        resetModalTagEditState();
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

    chip.append(dotSpan, nameSpan, editSpan, deleteSpan);
    bmTagsList.appendChild(chip);
  });

  SYSTEM_TAGS.forEach(tag => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bm-tag-chip is-system" + (selectedSystemTagIds.has(tag.id) ? " active" : "");
    chip.style.setProperty("--tag-color", isValidHexColor(tag.color) ? tag.color : "#4a6bff");
    chip.title = t("hkSystemTagReadOnly") || "System tag (local to this browser)";

    const dotSpan = document.createElement("span");
    dotSpan.className = "bm-tag-chip-dot";

    const nameSpan = document.createElement("span");
    nameSpan.className = "bm-tag-chip-name";
    nameSpan.textContent = tag.name;

    chip.addEventListener("click", () => {
      if (selectedSystemTagIds.has(tag.id)) {
        selectedSystemTagIds.delete(tag.id);
      } else {
        selectedSystemTagIds.add(tag.id);
      }
      renderModalTagsList();
    });

    chip.append(dotSpan, nameSpan);
    bmTagsList.appendChild(chip);
  });
}

function createOrSelectTagFromInput({ persist = true } = {}) {
  if (!bmNewTagName) return;
  const rawName = bmNewTagName.value.trim();
  const color = isValidHexColor(bmNewTagColor?.value) ? bmNewTagColor.value : "#10b981";

  if (editingTagId) {
    if (isReservedSystemTagName(rawName)) {
      alert(t("hkSystemTagNameReserved") || "This tag name is reserved for a system tag.");
      const currentTag = (state.tags || []).find(tag => tag && !tag.deleted && tag.id === editingTagId);
      bmNewTagName.value = currentTag?.name || "";
      bmNewTagName.focus();
      bmNewTagName.select();
      return;
    }
    if (!rawName) {
      const currentTag = (state.tags || []).find(tag => tag && !tag.deleted && tag.id === editingTagId);
      bmNewTagName.value = currentTag?.name || "";
      bmNewTagName.focus();
      bmNewTagName.select();
      return;
    }

    const prevEditingId = editingTagId;
    const result = updateTagInState(prevEditingId, { name: rawName, color });
    if (result) {
      if (result.mergedIntoId && selectedTagIds.has(prevEditingId)) {
        selectedTagIds.delete(prevEditingId);
        selectedTagIds.add(result.mergedIntoId);
      }
      resetModalTagEditState();
      renderModalTagsList();
      if (persist) {
        void saveState().then(() => {
          void syncWrite();
          render();
        });
      }
    }
    return;
  }

  if (!rawName) {
    bmNewTagName.value = "";
    return;
  }
  if (isReservedSystemTagName(rawName)) {
    alert(t("hkSystemTagNameReserved") || "This tag name is reserved for a system tag.");
    bmNewTagName.focus();
    bmNewTagName.select();
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
      bmNewTagColor.value = getNextDefaultTagColor();
    }
  }

  bmNewTagName.value = "";
  renderModalTagsList();
}

if (bmAddTagBtn) {
  bmAddTagBtn.addEventListener("click", () => createOrSelectTagFromInput());
}
if (bmCancelEditTagBtn) {
  bmCancelEditTagBtn.addEventListener("click", () => {
    resetModalTagEditState();
    renderModalTagsList();
  });
}
if (bmNewTagName) {
  bmNewTagName.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      createOrSelectTagFromInput();
    } else if (e.key === "Escape" && editingTagId !== null) {
      e.preventDefault();
      e.stopPropagation();
      resetModalTagEditState();
      renderModalTagsList();
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
    selectedSystemTagIds = new Set(getBookmarkSystemTagIds(data.id));
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
    selectedSystemTagIds = new Set();
    if (bmColor) bmColor.value = fallbackHex;
    if (bmColorFromIcon) bmColorFromIcon.checked = false;
    if (bmColorCustom) bmColorCustom.checked = false;
  }

  resetModalTagEditState();
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
  selectedSystemTagIds = new Set();
  resetModalTagEditState();
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

  const initialGroupId = window.activeGroupId;
  if (!state.groups.some(g => g.id === initialGroupId)) return;

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

  // Re-resolve group after await in case background sync replaced state.groups.
  const group = state.groups.find(g => g.id === (window.activeGroupId || initialGroupId));
  if (!group) return;

  let targetBookmark = null;
  let iconChanged = false;
  let isNewBookmark = false;

  // Commit any pending tag edit or typed tag name if the user clicked Save
  if (editingTagId || (bmNewTagName && bmNewTagName.value.trim())) {
    createOrSelectTagFromInput({ persist: false });
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

  if (targetBookmarkId) {
    let systemTagsChanged = false;
    for (const sysTag of SYSTEM_TAGS) {
      if (setBookmarkSystemTag(targetBookmarkId, sysTag.id, selectedSystemTagIds.has(sysTag.id))) {
        systemTagsChanged = true;
      }
    }
    if (systemTagsChanged) {
      await saveSystemTags();
    }
  }

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

  // Check link health asynchronously in background only when enabled in HouseKeeper
  const itemToCheck = findBookmarkInState(targetBookmarkId);
  if (itemToCheck && itemToCheck.url) {
    try {
      const cfg = await loadConfig();
      if (cfg?.housekeeper?.enableLinkCheck) {
        const isValid = await validateSingleLink(itemToCheck.url);
        const liveItem = findBookmarkInState(targetBookmarkId);
        if (liveItem && setBookmarkSystemTag(liveItem.id, SYSTEM_TAG_DEAD_LINK_ID, !isValid)) {
          await saveSystemTags();
          render();
        }
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

  if (action === "toggle-exclude-icon" && !stackItem) {
    toggleBookmarkIconExcludedById(item.id);
    render();
    return;
  }

  if (action === "refresh-icon" && !stackItem) {
    const targetId = item.id;
    item.customIcon = null;
    clearFaviconCacheEntry(item);

    // Only prompt for the host permission if an experimental lookup needs it (must stay in user gesture).
    if (document.getElementById("enable-experimental-favicon-fetch-link")?.checked || document.getElementById("enable-experimental-favicon-fetch-manifest")?.checked) {
      await ensureHostPermission();
    }

    void (async () => {
      try {
        await refreshBookmarkIconsIfNeeded({
          force: true,
          bookmarkId: targetId,
          persist: false,
          sync: false
        });
        const liveLoc = findBookmarkLocation(targetId);
        if (liveLoc?.item) {
          liveLoc.item.updatedAt = Date.now();
          if (liveLoc.parentStack) liveLoc.parentStack.updatedAt = liveLoc.item.updatedAt;
        }
        await saveState();
        void syncWrite();
        render();
      } catch (err) {
        console.warn("Background icon refresh failed", err);
      }
    })();
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