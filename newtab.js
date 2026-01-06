// API alias (Firefox vs. Chromium)
const api = typeof browser !== "undefined" ? browser : chrome;

const STORAGE_KEY = "myspeeddial-data";
const THEME_KEY = "myspeeddial-theme";

// ---------- STATE (upravený) ----------
let state = {
  groups: [],
  sync: {
    enabled: false,
    folderHandle: null,
    fileHandle: null
  }
};

let activeGroupId = null;

// ---------- DOM referencie ----------
const groupsHeader = document.getElementById("groups-header");
const bookmarksGrid = document.getElementById("bookmarks-grid");
const contextMenu = document.getElementById("context-menu");
const themeToggle = document.getElementById("theme-toggle");
const syncToggleIcon = document.getElementById("sync-toggle-icon");

// Modal
const modal = document.getElementById("bookmark-modal");
const modalTitle = document.getElementById("modal-title");
const bmTitle = document.getElementById("bm-title");
const bmUrl = document.getElementById("bm-url");
const bmIcon = document.getElementById("bm-icon");
const bmSave = document.getElementById("bm-save");
const bmCancel = document.getElementById("bm-cancel");

let editingBookmark = null;
let searchQuery = "";
let showDeletedGroups = false; // UI prepínač pridáme v bloku 7
let showDeletedBookmarks = false; // UI prepínač pridáme v bloku 7
// ---------- Search box ----------
const searchBox = document.getElementById("search-box");

searchBox.addEventListener("input", e => {
  searchQuery = e.target.value.trim().toLowerCase();
  render();
});

// Ctrl+F → fokus vyhľadávania
window.addEventListener(
  "keydown",
  function (e) {
    const isCtrlF = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f";

    if (isCtrlF) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      searchBox.focus();
      searchBox.select();
    }

    if (e.key === "Escape") {
      searchBox.value = "";
      searchQuery = "";
      render();
    }
  },
  true
);

// ---------- Synchronizácia ----------
syncToggleIcon.addEventListener("click", async () => {
  state.sync.enabled = !state.sync.enabled;

  document.getElementById("choose-sync-folder").disabled = !state.sync.enabled;

  updateSyncIcon();
  await saveState();
});

document.getElementById("choose-sync-folder").addEventListener("click", async () => {
  try {
    const folder = await window.showDirectoryPicker();

    state.sync.folderHandle = folder;
    state.sync.enabled = true;

    const fileHandle = await folder.getFileHandle("speeddial.json", { create: true });
    state.sync.fileHandle = fileHandle;

    await saveState();
    alert("Synchronizačný priečinok nastavený.");
  } catch (err) {
    console.error("Výber priečinka zrušený alebo nepodporovaný:", err);
  }
});

function updateSyncIcon() {
  if (state.sync.enabled) {
    syncToggleIcon.src = "icons/sync-on.png";
    syncToggleIcon.title = "Synchronizácia zapnutá";
  } else {
    syncToggleIcon.src = "icons/sync-off.png";
    syncToggleIcon.title = "Synchronizácia vypnutá";
  }
}

// ------------- Zobraz zmazané ------------
document.getElementById("show-deleted-toggle").addEventListener("change", (e) => {
  const show = e.target.checked;
  showDeletedGroups = show;
  showDeletedBookmarks = show;
  render();
});

// ---------- Pomocné funkcie ----------
function generateId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return "https://www.google.com/s2/favicons?domain=" + u.hostname;
  } catch {
    return "";
  }
}

async function saveState() {
  await api.storage.local.set({ [STORAGE_KEY]: state });
}

async function loadState() {
  const res = await api.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY];

  if (stored) {
    state = {
      groups: [],
      sync: {
        enabled: false,
        folderHandle: null,
        fileHandle: null
      },
      ...stored,
      sync: {
        enabled: stored.sync?.enabled ?? false,
        folderHandle: stored.sync?.folderHandle ?? null,
        fileHandle: stored.sync?.fileHandle ?? null
      }
    };
  } else {
    state = {
      groups: [],
      sync: {
        enabled: false,
        folderHandle: null,
        fileHandle: null
      }
    };
  }
}

// ---------- Modal ----------

function openBookmarkModal(data = null) {
  editingBookmark = data;

  if (data) {
    modalTitle.textContent = "Upraviť záložku";
    bmTitle.value = data.title;
    bmUrl.value = data.url;
    bmIcon.value = data.customIcon || "";
  } else {
    modalTitle.textContent = "Nová záložka";
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

bmSave.addEventListener("click", async () => {
  const title = bmTitle.value.trim();
  const url = bmUrl.value.trim();
  const icon = bmIcon.value.trim();

  if (!url) {
    alert("Musíš zadať URL.");
    return;
  }

  const group = state.groups.find(g => g.id === activeGroupId);

  // ---------- EDIT ----------
  if (editingBookmark) {
    editingBookmark.title = title || url;
    editingBookmark.url = url;
    editingBookmark.customIcon = icon || null;
    editingBookmark.updatedAt = Date.now();

  // ---------- CREATE ----------
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
  await syncWrite(state);

  closeBookmarkModal();
  render();
});

bmCancel.addEventListener("click", closeBookmarkModal);

modal.addEventListener("click", e => {
  if (e.target === modal) closeBookmarkModal();
});

// ---------- Render skupín ----------

function renderGroups(show = true) {
  if (!show) {
    groupsHeader.style.display = "none";
    return;
  }

  groupsHeader.style.display = "flex";
  groupsHeader.innerHTML = "";

  state.groups.forEach(group => {
    if (group.deleted && !showDeletedGroups) return;

    const tab = document.createElement("div");
    tab.className = "group-tab";
    tab.draggable = true;
    tab.dataset.groupId = group.id;

    if (group.deleted) {
      tab.classList.add("deleted");
    }

    tab.textContent = group.name;

    if (group.id === activeGroupId && !group.deleted) {
      tab.classList.add("active");
    }

    tab.addEventListener("click", () => {
      if (group.deleted) return;
      activeGroupId = group.id;
      render();
    });

    groupsHeader.appendChild(tab);
  });

  const addTab = document.createElement("div");
  addTab.className = "group-tab add-group";
  addTab.textContent = "+";
  addTab.addEventListener("click", async () => {
    const name = prompt("Názov novej skupiny:");
    if (!name) return;

    const g = {
      id: generateId("g"),
      name: name.trim(),
      items: [],
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };

    state.groups.push(g);
    activeGroupId = g.id;
    await saveState();
    await syncWrite(state);
    render();
  });

  groupsHeader.appendChild(addTab);

  setupGroupDrag();
}


// ---------- Drag & drop skupiny ----------

function setupGroupDrag() {
  let dragged = null;

  groupsHeader.querySelectorAll(".group-tab").forEach(tab => {
    if (tab.classList.contains("add-group")) return;

    tab.addEventListener("dragstart", e => {
      dragged = tab;
      tab.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    tab.addEventListener("dragend", async () => {
      if (!dragged) return;
      dragged.classList.remove("dragging");
      dragged = null;

      const ids = [...groupsHeader.querySelectorAll(".group-tab")]
        .filter(el => !el.classList.contains("add-group"))
        .map(el => el.dataset.groupId);

      state.groups.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      await saveState();
      await syncWrite(state);
      render();
    });
  });

  groupsHeader.addEventListener("dragover", e => {
    e.preventDefault();
    if (!dragged) return;

    const after = getAfterElementHorizontal(groupsHeader, e.clientX);
    const addBtn = groupsHeader.querySelector(".add-group");

    if (!after) {
      groupsHeader.insertBefore(dragged, addBtn);
    } else {
      groupsHeader.insertBefore(dragged, after);
    }
  });
}

function getAfterElementHorizontal(container, mouseX) {
  const els = [...container.querySelectorAll(".group-tab:not(.dragging):not(.add-group)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

  els.forEach(el => {
    const box = el.getBoundingClientRect();
    const offset = mouseX - (box.left + box.width / 2);
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: el };
    }
  });

  return closest.element;
}

// ---------- Kontextové menu – skupiny ----------

async function handleGroupContext(action, el) {
  const id = el.dataset.groupId;
  const group = state.groups.find(g => g.id === id);
  if (!group) return;

  if (action === "edit") {
    const newName = prompt("Nový názov skupiny:", group.name);
    if (newName && newName.trim()) {
      group.name = newName.trim();
      group.updatedAt = Date.now();
      await saveState();
      await syncWrite(state);
      render();
    }
  }
  if (action === "delete") {
    if (!confirm(`Vymazať skupinu "${group.name}"?`)) return;
    group.deleted = true;
    group.deletedAt = Date.now();
    group.updatedAt = Date.now();

    if (activeGroupId === id) {
      const firstActive = state.groups.find(g => !g.deleted);
      activeGroupId = firstActive ? firstActive.id : null;
    }

    await saveState();
    await syncWrite(state);
    render();
  }
  if (action === "restore") {
    group.deleted = false;
    group.deletedAt = null;
    group.updatedAt = Date.now();
    await saveState();
    await syncWrite(state);
    render();
  }
}


// ---------- Render bookmarkov ----------

function createBookmarkTile(item) {
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
  link.target = "_blank";

  link.addEventListener("click", e => {
    e.preventDefault();
    window.open(item.url, "_blank");
  });

  tile.addEventListener("click", e => {
    if (e.target.tagName.toLowerCase() === "a") return;
    if (e.button === 2) return;
    window.open(item.url, "_blank");
  });

  tile.appendChild(icon);
  tile.appendChild(link);

  return tile;
}

function renderBookmarks() {
  bookmarksGrid.innerHTML = "";

  const group = state.groups.find(g => g.id === activeGroupId && !g.deleted);
  if (!group) return;

  group.items.forEach(item => {
    if (item.deleted && !showDeletedBookmarks) return;

    const tile = createBookmarkTile(item);

    if (item.deleted) {
      tile.classList.add("deleted");
    }

    bookmarksGrid.appendChild(tile);
  });

  if (!searchQuery) {
    const addTile = document.createElement("div");
    addTile.className = "bookmark-tile add-bookmark";
    addTile.textContent = "+ Pridať";
    addTile.addEventListener("click", () => openBookmarkModal());
    bookmarksGrid.appendChild(addTile);
  }

  setupBookmarkDrag();
}


// ---------- Vyhľadávanie ----------

function renderSearchResults() {
  bookmarksGrid.innerHTML = "";

  const all = state.groups
    .filter(g => !g.deleted)
    .flatMap(g => g.items.filter(i => !i.deleted));

  const filtered = all.filter(item =>
    (item.title || "").toLowerCase().includes(searchQuery) ||
    (item.url || "").toLowerCase().includes(searchQuery)
  );

  filtered.forEach(item => {
    const tile = createBookmarkTile(item);
    bookmarksGrid.appendChild(tile);
  });
}

// ---------- Drag & drop bookmarky ----------

function setupBookmarkDrag() {
  let dragged = null;

  bookmarksGrid.querySelectorAll(".bookmark-tile").forEach(tile => {
    if (tile.classList.contains("add-bookmark")) return;

    tile.addEventListener("dragstart", e => {
      dragged = tile;
      tile.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    tile.addEventListener("dragend", async () => {
      if (!dragged) return;
      tile.classList.remove("dragging");
      dragged = null;

      const group = state.groups.find(g => g.id === activeGroupId && !g.deleted);
      if (!group) return;

      const ids = [...bookmarksGrid.querySelectorAll(".bookmark-tile")]
        .filter(el => !el.classList.contains("add-bookmark"))
        .map(el => el.dataset.bookmarkId);

      group.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      await saveState();
      await syncWrite(state);
      render();
    });
  });

  bookmarksGrid.addEventListener("dragover", e => {
    e.preventDefault();
    if (!dragged) return;

    const after = getAfterElementVertical(bookmarksGrid, e.clientY);
    const addTile = bookmarksGrid.querySelector(".add-bookmark");

    if (!after) {
      bookmarksGrid.insertBefore(dragged, addTile);
    } else {
      bookmarksGrid.insertBefore(dragged, after);
    }
  });
}

function getAfterElementVertical(container, mouseY) {
  const els = [...container.querySelectorAll(".bookmark-tile:not(.dragging):not(.add-bookmark)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

  els.forEach(el => {
    const box = el.getBoundingClientRect();
    const offset = mouseY - (box.top + box.height / 2);
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: el };
    }
  });

  return closest.element;
}

// ---------- Kontextové menu (globálne) ----------

let contextTarget = null;

document.addEventListener("contextmenu", e => {
  const groupTab = e.target.closest(".group-tab");
  const bookmarkTile = e.target.closest(".bookmark-tile");

  if (!groupTab && !bookmarkTile) return;
  if (groupTab && groupTab.classList.contains("add-group")) return;
  if (bookmarkTile && bookmarkTile.classList.contains("add-bookmark")) return;

  e.preventDefault();
  contextTarget = groupTab || bookmarkTile;

  contextMenu.style.left = e.pageX + "px";
  contextMenu.style.top = e.pageY + "px";
  contextMenu.classList.remove("hidden");
});

document.addEventListener("click", e => {
  if (!e.target.closest("#context-menu")) {
    contextMenu.classList.add("hidden");
    contextTarget = null;
  }
});

contextMenu.addEventListener("click", async e => {
  const action = e.target.dataset.action;
  if (!action || !contextTarget) return;

  if (contextTarget.classList.contains("group-tab")) {
    await handleGroupContext(action, contextTarget);
  } else if (contextTarget.classList.contains("bookmark-tile")) {
    await handleBookmarkContext(action, contextTarget);
  }

  contextMenu.classList.add("hidden");
  contextTarget = null;
});

// ---------- Kontextové menu – bookmarky ----------

async function handleBookmarkContext(action, el) {
  const bookmarkId = el.dataset.bookmarkId;
  const group = state.groups.find(g => g.id === activeGroupId && !g.deleted);
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
    await syncWrite(state);
    render();
  }

  if (action === "refresh-icon") {
    item.customIcon = null;
    item.updatedAt = Date.now();
    await saveState();
    await syncWrite(state);
    render();
  }
  if (action === "restore") {
    item.deleted = false;
    item.deletedAt = null;
    item.updatedAt = Date.now();
    await saveState();
    await syncWrite(state);
    render();
  }

}
// ---------- Téma (dark/light) ----------

async function loadTheme() {
  const res = await api.storage.local.get(THEME_KEY);
  const saved = res && res[THEME_KEY];
  if (saved === "theme-light" || saved === "theme-dark") {
    document.body.className = saved;
  }
}

themeToggle.addEventListener("click", async () => {
  const isDark = document.body.classList.contains("theme-dark");
  const next = isDark ? "theme-light" : "theme-dark";
  document.body.className = next;
  await api.storage.local.set({ [THEME_KEY]: next });
});


// -------------- EXPORT / IMPORT ---------------------

function sanitizeFilename(name) {
  return name
    .normalize("NFC")               // opraví Unicode
    .replace(/[<>:"/\\|?*]/g, "_")  // odstráni zakázané znaky
    .trim();
}

document.getElementById("export-btn").addEventListener("click", async () => {
  const zip = new JSZip();

  state.groups
    .filter(g => !g.deleted)
    .forEach(group => {
      const folder = zip.folder(sanitizeFilename(group.name));

      group.items
        .filter(i => !i.deleted)
        .forEach(item => {
          const iconUrl = item.customIcon 
            ? item.customIcon 
            : getFaviconUrl(item.url);

          const safeName = sanitizeFilename(item.title);

          const content =
            `[InternetShortcut]\n` +
            `URL=${item.url}\n` +
            `IconFile=${iconUrl}\n` +
            `IconIndex=0\n`;

          folder.file(safeName + ".url", content);
        });
    });

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    encodeFileName: (name) => new TextEncoder().encode(name)
  });

  const url = URL.createObjectURL(blob);

  api.downloads.download({
    url,
    filename: "SpeedDialExport.zip",
    saveAs: true
  });
});


document.getElementById("import-btn").addEventListener("click", async () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";

  input.onchange = async () => {
    const file = input.files[0];
    const data = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(data);

    // 1) Najprv vytvoríme skupiny
    Object.values(zip.files).forEach(entry => {
      if (entry.dir) {
        const rawName = entry.name.replace(/\/$/, "");
        const groupName = sanitizeFilename(rawName);

        if (!state.groups.some(g => g.name === groupName)) {
          state.groups.push({
            id: generateId("g"),
            name: groupName,
            items: [],
            updatedAt: Date.now(),
            deleted: false,
            deletedAt: null
          });
        }
      }
    });

    // 2) Načítame .url súbory
    for (const path in zip.files) {
      const entry = zip.files[path];

      if (!entry.dir && path.endsWith(".url")) {
        const parts = path.split("/");
        const groupName = sanitizeFilename(parts[0]);
        const fileName = sanitizeFilename(parts[1].replace(".url", ""));

        const group = state.groups.find(g => g.name === groupName);
        if (!group) continue;

        const text = await entry.async("text");

        const urlMatch = text.match(/URL=(.*)/);
        const iconMatch = text.match(/IconFile=(.*)/);

        const url = urlMatch ? urlMatch[1].trim() : "";
        const icon = iconMatch ? iconMatch[1].trim() : null;

        group.items.push({
          id: generateId("b"),
          title: fileName,
          url,
          customIcon: icon || null,
          updatedAt: Date.now(),
          deleted: false,
          deletedAt: null
        });
      }
    }

    await saveState();
    await syncWrite(state);
    render();
  };

  input.click();
});

// ---------- Synchronizácia ----------
async function syncWrite(state) {
  if (!state.sync.enabled || !state.sync.fileHandle) return;

  try {
    const writable = await state.sync.fileHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();
  } catch (err) {
    console.error("syncWrite error:", err);
  }
}
async function syncRead(state) {
  if (!state.sync.enabled || !state.sync.fileHandle) return null;

  try {
    const file = await state.sync.fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    console.error("syncRead error:", err);
    return null;
  }
}


// ---------- Init ----------

function render() {
  // bezpečnostná kontrola activeGroupId
  if (!activeGroupId || !state.groups.some(g => g.id === activeGroupId && !g.deleted)) {
    const firstActive = state.groups.find(g => !g.deleted);
    activeGroupId = firstActive ? firstActive.id : null;
  }

  if (searchQuery) {
    renderGroups(false);
    renderSearchResults();
  } else {
    renderGroups(true);
    renderBookmarks();
  }
}

(async function init() {
  await loadState();
  await loadTheme();
  updateSyncIcon();
  document.getElementById("show-deleted-toggle").checked = showDeletedGroups;
  
  // Ak je sync zapnutý, načítame cloudový stav
  if (state.sync.enabled && state.sync.fileHandle) {
    const cloudState = await syncRead(state);
    if (cloudState) {
      state = cloudState;
      await saveState();

    }
  }
  
  // Automatická synchronizácia každú minútu
  setInterval(async () => {
    if (state.sync.enabled && state.sync.fileHandle) {
      const cloudState = await syncRead(state);
      if (cloudState) {
        state = cloudState;
        await saveState();
        render();
      }
    }
  }, 60000); // 60 000 ms = 1 minúta

  render();
})();

