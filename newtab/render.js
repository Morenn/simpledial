import { state } from "./state.js";
import { renderGroups } from "./groups.js";
import { createBookmarkTile, openBookmarkModal } from "./bookmarks.js";
import { setupBookmarkDrag } from "./dragdrop.js";

// ======================================================
// HLAVNÁ RENDER FUNKCIA
// ======================================================

export function render() {
  renderGroups(true);
  renderBookmarks();
}

// ======================================================
// RENDER BOOKMARKOV
// ======================================================
function renderBookmarks() {
  const grid = document.getElementById("bookmarks-grid");
  grid.innerHTML = "";

  const showDeleted = document.getElementById("show-deleted-toggle").checked;
  const searchText = document.getElementById("search-box")?.value.trim().toLowerCase() || "";

  let items = [];

  // ============================================
  // 1) Globálne vyhľadávanie
  // ============================================
  if (searchText) {
    // Zoberieme všetky položky zo všetkých skupín
    state.groups.forEach(group => {
      group.items.forEach(item => {
        items.push({
          ...item,
          _groupName: group.name   // aby sme vedeli, odkiaľ pochádza
        });
      });
    });

    // Filtrovanie podľa textu
    items = items.filter(i => {
      if (i.deleted && !showDeleted) return false;

      const title = i.title.toLowerCase();
      const url = i.url.toLowerCase();
      const groupName = i._groupName.toLowerCase();

      return (
        title.includes(searchText) ||
        url.includes(searchText) ||
        groupName.includes(searchText)
      );
    });

  } else {
    // ============================================
    // 2) Normálne zobrazenie aktívnej skupiny
    // ============================================
    const group = state.groups.find(g => g.id === window.activeGroupId);

    if (!group) {
      grid.innerHTML = `<div class="empty-info">Žiadna skupina nie je aktívna.</div>`;
      return;
    }

    items = group.items.filter(i => {
      if (i.deleted && !showDeleted) return false;
      return true;
    });
  }

  // ============================================
  // Renderovanie výsledkov
  // ============================================

  items.forEach(item => {
    const tile = createBookmarkTile(item);
    if (item.deleted) tile.classList.add("deleted");

    // Pri globálnom vyhľadávaní zobrazíme názov skupiny
    if (searchText) {
      tile.classList.add("search-result");
      tile.setAttribute("data-group", item._groupName);
    }

    grid.appendChild(tile);
  });

  // Tlačidlo + len keď nie je aktívne vyhľadávanie
  if (!searchText) {
    const addTile = document.createElement("div");
    addTile.className = "bookmark-tile add-bookmark";
    addTile.textContent = "+";
    addTile.title = "Pridať záložku";

    addTile.addEventListener("click", () => {
      openBookmarkModal(null);
    });

    grid.appendChild(addTile);
  }

  // umožni presúvať len ak nie je definovaný search text
  if (!searchText) {
    setupBookmarkDrag();
  }

}

// ======================================================
// REAKCIA NA ZOBRAZENIE ZMAZANÝCH
// ======================================================

document.getElementById("show-deleted-toggle").addEventListener("change", () => {
  render();
});

// ======================================================
// REAKCIA NA VYHĽADÁVANIE
// ======================================================

const searchInput = document.getElementById("search-box");
if (searchInput) {
  searchInput.addEventListener("input", () => {
    render();
  });
}

// ======================================================
// VYMAZANIE SEARCH BOXU PO STLAČENÍ ESC
// ======================================================

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const search = document.getElementById("search-box");
    if (search && search.value.trim() !== "") {
      search.value = "";
      render();
    }
  }
});
