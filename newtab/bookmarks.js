import { state, saveState, generateId } from "./state.js";
import { render } from "./render.js";
import { syncWrite, validateSingleLink } from "./sync.js";
import { t } from "./i18n.js";
import { loadConfig } from "./config.js";

const DEFAULT_ICON_AUTO_REFRESH_HOURS = 24;

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

function resolveIconSrc(item) {
  if (item.customIcon) {
    return item.customIconCache || item.customIcon;
  }

  const refreshedAt = Number.isFinite(Number(item?.iconRefreshedAt))
    ? Number(item.iconRefreshedAt)
    : 0;

  try {
    const u = new URL(item.url);
    return buildGoogleFaviconUrl(u.hostname, refreshedAt);
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
    return !item.customIconCache;
  }

  return !Number(item.iconRefreshedAt || 0);
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
  if (!shouldRefreshIcon(item.iconRefreshedAt, frequencyHours, force)) return false;

  const refreshTimestamp = Date.now();

  if (item.customIcon) {
    try {
      const refreshedCache = await fetchIconAsDataUrl(item.customIcon, true);
      item.customIconCache = refreshedCache;
    } catch (err) {
      // Keep previous cache/url when fetching fails, but mark attempt time.
      console.warn("custom icon refresh failed", err);
    }
  }

  item.iconRefreshedAt = refreshTimestamp;
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
        currentItem.customIconCache = null;
        currentItem.iconRefreshedAt = 0;
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
      customIconCache: null,
      iconRefreshedAt: 0,
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    });
  }

  await saveState();
  await syncWrite();
  closeBookmarkModal();

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
    item.customIconCache = null;
    item.iconRefreshedAt = 0;
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
