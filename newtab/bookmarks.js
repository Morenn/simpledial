import { state, saveState, generateId } from "./state.js";
import { render } from "./render.js";
import { syncWrite } from "./sync.js";
import { t } from "./i18n.js";

// ---------- Vytvorenie bookmark tile ----------
export function createBookmarkTile(item) {
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

  return tile;
}

// ---------- Pomocná funkcia ----------
function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return "https://www.google.com/s2/favicons?domain=" + u.hostname;
  } catch {
    return "";
  }
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

modal.addEventListener("click", e => {
  if (e.target === modal) closeBookmarkModal();
});

// ---------- Uloženie bookmarku ----------
bmSave.addEventListener("click", async () => {
  const title = bmTitle.value.trim();
  const url = bmUrl.value.trim();
  const icon = bmIcon.value.trim();

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
  render();
});

// ---------- Kontextové menu – bookmarky ----------
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
    if (!confirm(`Vymazať záložku "${item.title}"?`)) return;

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
}
