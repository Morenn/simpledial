import { state, saveState, generateId } from "./state.js";
import { render } from "./render.js";
import { syncWrite, validateSingleLink } from "./sync.js";
import { t } from "./i18n.js";

// ---------- Vytvorenie bookmark tile ----------
export function createBookmarkTile(item, config = null) {
  const tile = document.createElement("div");
  tile.className = "bookmark-tile";
  tile.draggable = true;
  tile.dataset.bookmarkId = item.id;
  tile.title = item.url;

  const icon = document.createElement("img");
  icon.className = "bookmark-favicon";
  icon.src = item.customIcon ? item.customIcon : getFaviconUrl(item.url);

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
    return "https://www.google.com/s2/favicons?domain=" + u.hostname;
  } catch {
    return "";
  }
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

// Close modal on Escape key
modal.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeBookmarkModal();
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

  // EDIT
  if (editingBookmark) {
    editingBookmark.title = title || url;
    editingBookmark.url = url;
    editingBookmark.customIcon = icon || null;
    editingBookmark.updatedAt = Date.now();

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
  
  // Check link health asynchronously and update timestamp only on change
  const itemToCheck = editingBookmark || group.items[group.items.length - 1];
  if (itemToCheck && itemToCheck.url) {
    try {
      const isValid = await validateSingleLink(itemToCheck.url);
      const newHasError = !isValid;
      if (itemToCheck.hasError !== newHasError) {
        itemToCheck.hasError = newHasError;
        itemToCheck.updatedAt = Date.now();
        await saveState();
        await syncWrite();
      }
    } catch (e) {
      console.error('Link validation failed:', e);
    }
  }

  render();
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
