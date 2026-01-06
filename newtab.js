// API alias (Firefox vs. Chromium)
const api = typeof browser !== "undefined" ? browser : chrome;

const STORAGE_KEY = "myspeeddial-data";
const THEME_KEY = "myspeeddial-theme";

let state = { groups: [] };
let activeGroupId = null;

// DOM referencie
const groupsHeader = document.getElementById("groups-header");
const bookmarksGrid = document.getElementById("bookmarks-grid");
const contextMenu = document.getElementById("context-menu");
const themeToggle = document.getElementById("theme-toggle");

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

// Search box
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
  state = res[STORAGE_KEY] || { groups: [] };
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

  if (editingBookmark) {
    editingBookmark.title = title || url;
    editingBookmark.url = url;
    editingBookmark.customIcon = icon || null;
  } else {
    group.items.push({
      id: generateId("b"),
      title: title || url,
      url,
      customIcon: icon || null
    });
  }

  await saveState();
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
    const tab = document.createElement("div");
    tab.className = "group-tab";
    tab.draggable = true;
    tab.textContent = group.name;
    tab.dataset.groupId = group.id;

    if (group.id === activeGroupId) {
      tab.classList.add("active");
    }

    tab.addEventListener("click", () => {
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
      items: []
    };

    state.groups.push(g);
    activeGroupId = g.id;
    await saveState();
    render();
  });

  groupsHeader.appendChild(addTab);

  setupGroupDrag();
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

  const group = state.groups.find(g => g.id === activeGroupId);
  if (!group) return;

  group.items.forEach(item => {
    const tile = createBookmarkTile(item);
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

  const all = state.groups.flatMap(g => g.items);

  const filtered = all.filter(item =>
    item.title.toLowerCase().includes(searchQuery) ||
    item.url.toLowerCase().includes(searchQuery)
  );

  filtered.forEach(item => {
    const tile = createBookmarkTile(item);
    bookmarksGrid.appendChild(tile);
  });
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

      const group = state.groups.find(g => g.id === activeGroupId);
      if (!group) return;

      const ids = [...bookmarksGrid.querySelectorAll(".bookmark-tile")]
        .filter(el => !el.classList.contains("add-bookmark"))
        .map(el => el.dataset.bookmarkId);

      group.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      await saveState();
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

// ---------- Kontextové menu ----------

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

// ---------- Kontextové menu – skupiny ----------

async function handleGroupContext(action, el) {
  const id = el.dataset.groupId;
  const group = state.groups.find(g => g.id === id);
  if (!group) return;

  if (action === "edit") {
    const newName = prompt("Nový názov skupiny:", group.name);
    if (newName && newName.trim()) {
      group.name = newName.trim();
      await saveState();
      render();
    }
  }

  if (action === "delete") {
    if (!confirm(`Vymazať skupinu "${group.name}"?`)) return;
    state.groups = state.groups.filter(g => g.id !== id);
    if (activeGroupId === id) {
      activeGroupId = state.groups[0] ? state.groups[0].id : null;
    }
    await saveState();
    render();
  }
}

// ---------- Kontextové menu – bookmarky ----------

async function handleBookmarkContext(action, el) {
  const bookmarkId = el.dataset.bookmarkId;
  const group = state.groups.find(g => g.id === activeGroupId);
  if (!group) return;

  const item = group.items.find(i => i.id === bookmarkId);
  if (!item) return;

  if (action === "edit") {
    openBookmarkModal(item);
  }

  if (action === "delete") {
    if (!confirm(`Vymazať záložku "${item.title}"?`)) return;
    group.items = group.items.filter(i => i.id !== bookmarkId);
    await saveState();
    render();
  }

  if (action === "refresh-icon") {
    item.customIcon = null;
    await saveState();
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
// ---------- Init ----------

function render() {
  if (searchQuery) {
    // Režim globálneho vyhľadávania
    renderGroups(false);      // skryjeme skupiny
    renderSearchResults();    // zobrazíme všetky záložky
  } else {
    // Normálny režim
    if (!activeGroupId && state.groups.length > 0) {
      activeGroupId = state.groups[0].id;
    }
    renderGroups(true);
    renderBookmarks();
  }
}


// -------------- EXPORT / IMPORT ---------------------
function sanitizeFilename(name) {
  return name
    .normalize("NFC")               // opraví Unicode
    .replace(/[<>:"/\\|?*]/g, "_")  // odstráni zakázané znaky
    .trim();
}

document.getElementById("export-btn").addEventListener("click", async () => {
  const zip = new JSZip();

  state.groups.forEach(group => {
    const folder = zip.folder(sanitizeFilename(group.name));

    group.items.forEach(item => {
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


function sanitizeFilename(name) {
  return name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
}

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
        const rawName = entry.name.replace(/\/$/, ""); // odstráni trailing slash
        const groupName = sanitizeFilename(rawName);

        if (!state.groups.some(g => g.name === groupName)) {
          state.groups.push({
            id: generateId("g"),
            name: groupName,
            items: []
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
          customIcon: icon || null
        });
      }
    }

    await saveState();
    render();
  };

  input.click();
});

(async function init() {
  await loadState();
  await loadTheme();
  render();
})();
