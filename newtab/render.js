import { state } from "./state.js";
import { renderGroups } from "./groups.js";
import { createBookmarkTile, openBookmarkModal } from "./bookmarks.js";
import { setupBookmarkDrag } from "./dragdrop.js";
import { t } from "./i18n.js";

// ======================================================
// GRID LAYOUT CONSTANTS
// ======================================================
const TILE_HEIGHT = 50; // tile height + row gap (40px + 10px)
const COLUMN_WIDTH = 300; // column width in pixels
const INITIAL_HEIGHT_RATIO = 0.5; // Start with 50% of browser height
const MAX_HEIGHT_RATIO = 0.9; // Extend to 90% if needed

// ======================================================
// CALCULATE AND APPLY DYNAMIC GRID LAYOUT
// ======================================================
function calculateGridLayout() {
  const main = document.querySelector("main");
  if (!main) return;

  const grid = document.getElementById("bookmarks-grid");
  const availableWidth = grid.clientWidth || main.clientWidth - 48; // Account for padding
  const availableHeight = main.clientHeight - 40; // Subtract some padding
  
  // Get total number of tiles (including the add button if present)
  const tiles = grid.querySelectorAll(".bookmark-tile").length;
  
  if (tiles === 0) {
    grid.style.gridTemplateRows = `repeat(1, 50px)`;
    return;
  }
  
  // Calculate max columns that can fit within window width
  // Each column is 300px + 16px gap (except last column)
  // Be conservative: if not enough space for 2 full columns, use 1
  let maxColumnsForWidth;
  
  if (availableWidth < 450) {
    // Mobile/narrow: force single column
    maxColumnsForWidth = 1;
  } else if (availableWidth < 750) {
    // Tablet: allow up to 2 columns
    maxColumnsForWidth = Math.max(1, Math.floor(availableWidth / (COLUMN_WIDTH + 16)));
  } else {
    // Desktop: calculate based on standard 300px columns
    maxColumnsForWidth = Math.max(1, Math.floor(availableWidth / (COLUMN_WIDTH + 16)));
  }
  
  // Calculate tiles per column to fit within max columns
  let tilesPerColumn = Math.ceil(tiles / maxColumnsForWidth);
  
  // Adjust if height exceeds viewport, extending height limits gradually
  const requiredHeight = tilesPerColumn * TILE_HEIGHT;
  
  if (requiredHeight > availableHeight) {
    // Try to optimize for viewport: try 70% and 90% height ratios
    const heightRatio70 = Math.max(1, Math.floor((availableHeight * 0.7) / TILE_HEIGHT));
    const heightRatio90 = Math.max(1, Math.floor((availableHeight * 0.9) / TILE_HEIGHT));
    
    if (heightRatio70 >= tilesPerColumn) {
      // Can fit within 70% height
      tilesPerColumn = heightRatio70;
    } else if (heightRatio90 >= tilesPerColumn) {
      // Can fit within 90% height
      tilesPerColumn = heightRatio90;
    }
    // Otherwise allow scrolling beyond viewport
  }

  // Set grid template rows based on calculated tiles per column
  grid.style.gridTemplateRows = `repeat(${tilesPerColumn}, 50px)`;
}

// ======================================================
// HLAVNÁ RENDER FUNKCIA
// ======================================================

export function render() {
  renderGroups(true);
  renderBookmarks();
  
  // Apply grid layout after rendering
  calculateGridLayout();
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
      grid.innerHTML = `<div class="empty-info">${t("noActiveGroup")}</div>`;
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
// ======================================================
// RESPONSIVE GRID LAYOUT ON WINDOW RESIZE
// ======================================================

let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // Re-render groups to check if dropdown is needed
    renderGroups(true);
    // Recalculate grid layout
    calculateGridLayout();
  }, 250); // Debounce to avoid excessive recalculations
});