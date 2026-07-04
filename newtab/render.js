import { state } from "./state.js";
import { renderGroups } from "./groups.js";
import { createBookmarkTile, openBookmarkModal } from "./bookmarks.js";
import { setupBookmarkDrag } from "./dragdrop.js";
import { loadConfig } from "./config.js";
import { t } from "./i18n.js";

// ======================================================
// GRID LAYOUT CONSTANTS
// ======================================================
const TILE_HEIGHT = 43; // tile height + row gap (40px + 3px)
const COLUMN_WIDTH = 360; // column width in pixels (20% wider)
const INITIAL_HEIGHT_RATIO = 0.75; // Start with 70% of browser height
const MAX_HEIGHT_RATIO = 0.95; // Extend to 90% if needed

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
    grid.style.gridTemplateRows = `repeat(1, ${TILE_HEIGHT}px)`;
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
  // Prefer filling columns up to INITIAL_HEIGHT_RATIO before adding columns
  const tilesPerColumnFromHeight = Math.max(1, Math.floor((availableHeight * INITIAL_HEIGHT_RATIO) / TILE_HEIGHT));

  let tilesPerColumn;
  // If using the height-limited tiles per column would require no more columns
  // than fit in the available width, prefer that; otherwise fall back to width-driven split.
  const requiredColumnsIfUsingHeight = Math.ceil(tiles / tilesPerColumnFromHeight);
  if (requiredColumnsIfUsingHeight <= maxColumnsForWidth) {
    tilesPerColumn = tilesPerColumnFromHeight;
  } else {
    tilesPerColumn = Math.ceil(tiles / maxColumnsForWidth);
  }
  
  // Adjust if height exceeds viewport, extending height limits gradually
  const requiredHeight = tilesPerColumn * TILE_HEIGHT;
  
  if (requiredHeight > availableHeight) {
    // Try to optimize for viewport: try INITIAL_HEIGHT_RATIO and MAX_HEIGHT_RATIO
    const heightRatioInitial = Math.max(1, Math.floor((availableHeight * INITIAL_HEIGHT_RATIO) / TILE_HEIGHT));
    const heightRatioMax = Math.max(1, Math.floor((availableHeight * MAX_HEIGHT_RATIO) / TILE_HEIGHT));

    if (heightRatioInitial >= tilesPerColumn) {
      tilesPerColumn = heightRatioInitial;
    } else if (heightRatioMax >= tilesPerColumn) {
      tilesPerColumn = heightRatioMax;
    }
    // Otherwise allow scrolling beyond viewport
  }

  // Set grid template rows based on calculated tiles per column
  grid.style.gridTemplateRows = `repeat(${tilesPerColumn}, ${TILE_HEIGHT}px)`;
}

// ======================================================
// MAIN RENDER FUNCTION
// ======================================================

export async function render() {
  renderGroups(true);
  await renderBookmarks();

  // Apply grid layout after rendering
  calculateGridLayout();
}

// ======================================================
// RENDER BOOKMARKS
// ======================================================
async function renderBookmarks() {
  const config = await loadConfig();
  const grid = document.getElementById("bookmarks-grid");
  grid.innerHTML = "";

  const showDeleted = document.getElementById("show-deleted-toggle").checked;
  const searchText = document.getElementById("search-box")?.value.trim().toLowerCase() || "";

  let items = [];

  // ============================================
  // 1) Global search across all groups if there's search text
  // ============================================
  if (searchText) {
    // Collect all items from all groups
    state.groups.forEach(group => {
      group.items.forEach(item => {
        items.push({
          ...item,
          _groupName: group.name   // to display group name in search results
        });
      });
    });

    // Filter based on search text and deleted status
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
    // 2) Display items from active group if no search text
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
  // Render results (either search results or active group items)
  // ============================================

  items.forEach(item => {
    const tile = createBookmarkTile(item, config);
    if (item.deleted) tile.classList.add("deleted");

    // Display group name in search results
    if (searchText) {
      tile.classList.add("search-result");
      tile.setAttribute("data-group", item._groupName);
    }

    grid.appendChild(tile);
  });

  // Button to add new bookmark (only if not searching, to avoid confusion)
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

  // Allow drag-and-drop only when not searching, to avoid confusion
  if (!searchText) {
    setupBookmarkDrag();
  }

}

// ======================================================
// REACTION TO SHOW DELETED TOGGLE CHANGE
// ======================================================

document.getElementById("show-deleted-toggle").addEventListener("change", () => {
  render();
});

// ======================================================
// REACTION TO MANUAL SYNC BUTTON
// ======================================================

const searchInput = document.getElementById("search-box");
if (searchInput) {
  searchInput.addEventListener("input", () => {
    render();
  });
}

// ======================================================
// DELETE SEARCH TEXT ON ESCAPE KEY
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