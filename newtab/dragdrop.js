import { state, saveState } from "./state.js";
import { render } from "./render.js";

// ======================================================
// DRAG & DROP PRE BOOKMARKY
// ======================================================

export function setupBookmarkDrag() {
  const bookmarksGrid = document.getElementById("bookmarks-grid");
  let dragged = null;
  let lastDragOverTime = 0;
  let dropIndicator = null;
  let dragPlaceholder = null;
  let autoScrollInterval = null;

  // Create drop indicator element
  function createDropIndicator() {
    if (dropIndicator) return;
    dropIndicator = document.createElement("div");
    dropIndicator.className = "drop-indicator";
    dropIndicator.style.display = "none";
    bookmarksGrid.appendChild(dropIndicator);
  }

  // Create drag placeholder (ghost element)
  function createDragPlaceholder(element) {
    dragPlaceholder = element.cloneNode(true);
    dragPlaceholder.classList.add("drag-placeholder");
    dragPlaceholder.classList.remove("dragging");
    dragPlaceholder.style.pointerEvents = "none";
    bookmarksGrid.insertBefore(dragPlaceholder, element.nextSibling);
  }

  // Remove drag placeholder
  function removeDragPlaceholder() {
    if (dragPlaceholder && dragPlaceholder.parentNode) {
      dragPlaceholder.remove();
      dragPlaceholder = null;
    }
  }

  // Auto-scroll function
  function startAutoScroll(e) {
    stopAutoScroll();
    
    const main = document.querySelector("main");
    if (!main) return;

    const SCROLL_THRESHOLD = 80; // pixels from edge
    const SCROLL_SPEED = 5; // pixels per frame

    autoScrollInterval = setInterval(() => {
      const mainRect = main.getBoundingClientRect();
      const distanceFromBottom = mainRect.bottom - e.clientY;
      const distanceFromTop = e.clientY - mainRect.top;

      if (distanceFromBottom < SCROLL_THRESHOLD && main.scrollHeight > main.clientHeight) {
        main.scrollBy(0, SCROLL_SPEED);
      } else if (distanceFromTop < SCROLL_THRESHOLD && main.scrollTop > 0) {
        main.scrollBy(0, -SCROLL_SPEED);
      }
    }, 16); // ~60fps
  }

  function stopAutoScroll() {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
    }
  }

  // Update drop indicator position
  function updateDropIndicator(afterElement, mouseX, mouseY) {
    if (!dropIndicator) return;

    // Clear previous highlights
    bookmarksGrid.querySelectorAll(".bookmark-tile").forEach(tile => {
      tile.classList.remove("drop-target");
    });

    if (!afterElement) {
      // No valid drop position - hide indicator
      dropIndicator.style.display = "none";
      return;
    }

    const gridRect = bookmarksGrid.getBoundingClientRect();
    const rect = afterElement.getBoundingClientRect();

    // Find which element we're hovering over to determine indicator position
    let hoveredElement = null;
    const allTiles = [...bookmarksGrid.querySelectorAll(".bookmark-tile:not(.dragging):not(.add-bookmark):not(.drag-placeholder)")];
    for (const el of allTiles) {
      const box = el.getBoundingClientRect();
      if (mouseX >= box.left && mouseX <= box.right &&
          mouseY >= box.top && mouseY <= box.bottom) {
        hoveredElement = el;
        break;
      }
    }

    if (hoveredElement) {
      const box = hoveredElement.getBoundingClientRect();
      const centerX = box.left + box.width / 2;

      if (mouseX < centerX) {
        // Show indicator on the left side
        dropIndicator.style.left = (box.left - gridRect.left - 6) + "px";
        dropIndicator.style.top = (box.top - gridRect.top - 4) + "px";
        dropIndicator.style.width = "4px";
        dropIndicator.style.height = box.height + 8 + "px";
      } else {
        // Show indicator on the right side
        dropIndicator.style.left = (box.right - gridRect.left + 2) + "px";
        dropIndicator.style.top = (box.top - gridRect.top - 4) + "px";
        dropIndicator.style.width = "4px";
        dropIndicator.style.height = box.height + 8 + "px";
      }
      dropIndicator.style.display = "block";
    } else {
      // Fallback: show around the target element
      dropIndicator.style.left = (rect.left - gridRect.left - 4) + "px";
      dropIndicator.style.top = (rect.top - gridRect.top - 4) + "px";
      dropIndicator.style.width = rect.width + 8 + "px";
      dropIndicator.style.height = rect.height + 8 + "px";
      dropIndicator.style.display = "block";
    }

    // Highlight the target tile
    afterElement.classList.add("drop-target");
  }

  // Hide drop indicator
  function hideDropIndicator() {
    if (dropIndicator) {
      dropIndicator.style.display = "none";
    }
  }

  bookmarksGrid.querySelectorAll(".bookmark-tile").forEach(tile => {
    if (tile.classList.contains("add-bookmark")) return;

    tile.addEventListener("dragstart", e => {
      createDropIndicator();
      createDragPlaceholder(tile);
      dragged = tile;
      tile.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setDragImage(new Image(), 0, 0); // Hide default ghost image
    });

    tile.addEventListener("dragend", async () => {
      if (!dragged) return;

      stopAutoScroll();
      hideDropIndicator();
      removeDragPlaceholder();
      
      // Clear all highlights
      bookmarksGrid.querySelectorAll(".bookmark-tile").forEach(tile => {
        tile.classList.remove("drop-target");
      });

      tile.classList.remove("dragging");
      dragged = null;

      const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
      if (!group) return;

      const ids = [...bookmarksGrid.querySelectorAll(".bookmark-tile")]
        .filter(el => !el.classList.contains("add-bookmark") && !el.classList.contains("drag-placeholder"))
        .map(el => el.dataset.bookmarkId);

      group.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

      await saveState();
      render();
    });
  });

  bookmarksGrid.addEventListener("dragover", e => {
    e.preventDefault();
    if (!dragged) return;

    // Start auto-scroll
    startAutoScroll(e);

    // Throttle dragover events to reduce DOM operations
    const now = Date.now();
    if (now - lastDragOverTime < 16) return; // ~60fps
    lastDragOverTime = now;

    const after = getAfterElementGrid(bookmarksGrid, e.clientX, e.clientY);
    updateDropIndicator(after, e.clientX, e.clientY);

    const addTile = bookmarksGrid.querySelector(".add-bookmark");

    if (!after) {
      // Move dragged item to before add-bookmark
      if (dragPlaceholder) {
        bookmarksGrid.insertBefore(dragPlaceholder, addTile);
        bookmarksGrid.insertBefore(dragged, dragPlaceholder);
      } else {
        bookmarksGrid.insertBefore(dragged, addTile);
      }
    } else if (after !== dragPlaceholder) {
      // Move dragged item before the target
      if (dragPlaceholder) {
        bookmarksGrid.insertBefore(dragPlaceholder, after);
        bookmarksGrid.insertBefore(dragged, dragPlaceholder);
      } else {
        bookmarksGrid.insertBefore(dragged, after);
      }
    }
  });

  // Hide indicator when dragging leaves the grid
  bookmarksGrid.addEventListener("dragleave", e => {
    // Only hide if we're actually leaving the grid (not just moving over children)
    if (!bookmarksGrid.contains(e.relatedTarget)) {
      stopAutoScroll();
      hideDropIndicator();
      // Clear all highlights
      bookmarksGrid.querySelectorAll(".bookmark-tile").forEach(tile => {
        tile.classList.remove("drop-target");
      });
    }
  });
}

function getAfterElementVertical(container, mouseY) {
  const els = [...container.querySelectorAll(".bookmark-tile:not(.dragging):not(.add-bookmark):not(.drag-placeholder)")];
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

function getAfterElementGrid(container, mouseX, mouseY) {
  const els = [...container.querySelectorAll(".bookmark-tile:not(.dragging):not(.add-bookmark):not(.drag-placeholder)")];

  if (els.length === 0) return null;

  // Find which element the mouse is over (if any)
  let hoveredElement = null;
  for (const el of els) {
    const box = el.getBoundingClientRect();
    if (mouseX >= box.left && mouseX <= box.right &&
        mouseY >= box.top && mouseY <= box.bottom) {
      hoveredElement = el;
      break;
    }
  }

  if (hoveredElement) {
    // Mouse is over an element - determine left/right half for precise positioning
    const box = hoveredElement.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;

    // Use a smaller region in the center to avoid accidental drops
    const deadZone = 20; // pixels from center where no drop is allowed

    if (Math.abs(mouseX - centerX) < deadZone && Math.abs(mouseY - centerY) < deadZone) {
      // Mouse is in the center dead zone - no drop allowed
      return null;
    }

    // Determine drop position based on quadrants
    const inLeftHalf = mouseX < centerX;
    const inTopHalf = mouseY < centerY;

    if (inLeftHalf) {
      // Left side - insert before this element
      return hoveredElement;
    } else {
      // Right side - insert after this element
      const nextSibling = hoveredElement.nextElementSibling;
      return nextSibling && !nextSibling.classList.contains('add-bookmark') ? nextSibling : null;
    }
  }

  // Mouse is not over any element - find closest element for drop
  let closest = { distance: Number.MAX_VALUE, element: null };

  els.forEach(el => {
    const box = el.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;

    const distance = Math.sqrt(Math.pow(mouseX - centerX, 2) + Math.pow(mouseY - centerY, 2));

    if (distance < closest.distance) {
      closest = { distance, element: el };
    }
  });

  if (!closest.element) return null;

  // For elements not directly hovered, default to inserting before
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
