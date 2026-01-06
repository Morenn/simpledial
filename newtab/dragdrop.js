import { state, saveState } from "./state.js";
import { render } from "./render.js";

// ======================================================
// DRAG & DROP PRE BOOKMARKY
// ======================================================

export function setupBookmarkDrag() {
  const bookmarksGrid = document.getElementById("bookmarks-grid");
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

      const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
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

// ======================================================
// DRAG & DROP PRE SKUPINY
// ======================================================

export function setupGroupDrag() {
  const groupsHeader = document.getElementById("groups-header");
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

      tab.classList.remove("dragging");
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
