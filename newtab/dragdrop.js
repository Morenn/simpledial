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
  let lastTargetIndex = -1;

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
    dragPlaceholder.style.opacity = "0.4";
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
  function updateDropIndicator(targetIndex) {
    if (!dropIndicator || targetIndex === -1) {
      dropIndicator.style.display = "none";
      return;
    }

    const allTiles = [...bookmarksGrid.querySelectorAll(".bookmark-tile:not(.dragging):not(.add-bookmark)")];
    if (targetIndex >= allTiles.length) {
      dropIndicator.style.display = "none";
      return;
    }

    const targetElement = allTiles[targetIndex];
    const gridRect = bookmarksGrid.getBoundingClientRect();
    const rect = targetElement.getBoundingClientRect();

    // Show indicator before the target element
    dropIndicator.style.left = (rect.left - gridRect.left - 2) + "px";
    dropIndicator.style.top = (rect.top - gridRect.top - 4) + "px";
    dropIndicator.style.width = "3px";
    dropIndicator.style.height = rect.height + 8 + "px";
    dropIndicator.style.display = "block";
  }

  // Hide drop indicator
  function hideDropIndicator() {
    if (dropIndicator) {
      dropIndicator.style.display = "none";
    }
  }

  // Move placeholder to target position
  function movePlaceholder(targetIndex) {
    if (!dragPlaceholder) return;

    const allTiles = [...bookmarksGrid.querySelectorAll(".bookmark-tile:not(.dragging):not(.add-bookmark)")];
    const addTile = bookmarksGrid.querySelector(".add-bookmark");

    if (targetIndex === -1 || targetIndex >= allTiles.length) {
      // Move to end (before add-bookmark)
      bookmarksGrid.insertBefore(dragPlaceholder, addTile);
    } else {
      // Move before target element
      bookmarksGrid.insertBefore(dragPlaceholder, allTiles[targetIndex]);
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
      
      // Move dragged item to placeholder's position before removing it
      if (dragPlaceholder && dragPlaceholder.parentNode) {
        bookmarksGrid.insertBefore(dragged, dragPlaceholder);
      }
      
      removeDragPlaceholder();
      lastTargetIndex = -1;
      
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

    // Start auto-scroll
    startAutoScroll(e);

    // Throttle dragover events to reduce DOM operations
    const now = Date.now();
    if (now - lastDragOverTime < 16) return; // ~60fps
    lastDragOverTime = now;

    const targetIndex = getDropIndex(bookmarksGrid, e.clientX, e.clientY);
    
    // Only move placeholder if target changed
    if (targetIndex !== lastTargetIndex) {
      lastTargetIndex = targetIndex;
      movePlaceholder(targetIndex);
      updateDropIndicator(targetIndex);
    }
  });

  // Hide indicator when dragging leaves the grid
  bookmarksGrid.addEventListener("dragleave", e => {
    // Only hide if we're actually leaving the grid (not just moving over children)
    if (!bookmarksGrid.contains(e.relatedTarget)) {
      stopAutoScroll();
      hideDropIndicator();
    }
  });
}

function getDropIndex(container, mouseX, mouseY) {
  const allTiles = [...container.querySelectorAll(".bookmark-tile:not(.dragging):not(.add-bookmark)")];

  if (allTiles.length === 0) return -1;

  // Find which element the mouse is over
  let hoveredElement = null;
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

    // Simple left/right detection
    if (mouseX < centerX) {
      // Insert before this element
      return allTiles.indexOf(hoveredElement);
    } else {
      // Insert after this element
      return allTiles.indexOf(hoveredElement) + 1;
    }
  }

  // Mouse not over any element - find closest
  let closest = { distance: Number.MAX_VALUE, index: -1 };

  allTiles.forEach((el, index) => {
    const box = el.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;

    const distance = Math.sqrt(Math.pow(mouseX - centerX, 2) + Math.pow(mouseY - centerY, 2));

    if (distance < closest.distance) {
      closest = { distance, index };
    }
  });

  return closest.index;
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
