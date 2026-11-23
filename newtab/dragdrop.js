import {
  state,
  saveState,
  generateId,
  isStackItem,
  findBookmarkLocation,
  cleanupStackIfNeeded
} from "./state.js";
import { render } from "./render.js";
import { syncWrite } from "./sync.js";
import { moveBookmarkToGroup } from "./bookmarks.js";
import { t } from "./i18n.js";

// ======================================================
// UNIFIED DRAG & DROP FOR BOOKMARKS, SECTIONS & STACKS
// ======================================================

const EMPTY_DRAG_IMAGE = new Image();
let dragListenersInitialized = false;
let dragSession = null;
let autoScrollInterval = null;
let lastAutoScrollClientY = 0;

function toElement(node) {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function getWorkspaceScrollContainer() {
  return document.getElementById("center-space") || document.getElementById("workspace-main") || document.querySelector("main");
}

function startAutoScroll(clientY) {
  lastAutoScrollClientY = clientY;
  if (autoScrollInterval) return;

  const main = getWorkspaceScrollContainer();
  if (!main) return;

  const SCROLL_THRESHOLD = 80;
  const SCROLL_SPEED = 6;

  autoScrollInterval = setInterval(() => {
    const mainRect = main.getBoundingClientRect();
    const distanceFromBottom = mainRect.bottom - lastAutoScrollClientY;
    const distanceFromTop = lastAutoScrollClientY - mainRect.top;

    if (distanceFromBottom < SCROLL_THRESHOLD && main.scrollHeight > main.clientHeight) {
      main.scrollBy(0, SCROLL_SPEED);
    } else if (distanceFromTop < SCROLL_THRESHOLD && main.scrollTop > 0) {
      main.scrollBy(0, -SCROLL_SPEED);
    }
  }, 16);
}

function stopAutoScroll() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
}

function createDragPlaceholder(tile) {
  const placeholder = tile.cloneNode(true);
  placeholder.classList.add("drag-placeholder");
  placeholder.classList.remove("dragging");
  placeholder.draggable = false;
  placeholder.removeAttribute("data-bookmark-id");
  placeholder.style.pointerEvents = "none";
  return placeholder;
}

function clearStackDropTarget() {
  document.querySelectorAll(".stack-drop-target").forEach(el => {
    el.classList.remove("stack-drop-target");
  });
  if (dragSession) {
    dragSession.stackTargetTile = null;
  }
  dragSession?.placeholder?.classList.remove("is-hidden-for-stack");
}

function clearContainerHighlights() {
  document.querySelectorAll(".section-drop-active, .grid-drop-active").forEach(el => {
    el.classList.remove("section-drop-active", "grid-drop-active");
  });
  if (dragSession) {
    dragSession.activeHighlightEl = null;
  }
}

function setContainerHighlight(containerGrid) {
  const nextEl = containerGrid?.classList?.contains("section-grid")
    ? containerGrid.closest(".bookmark-section")
    : (containerGrid?.id === "bookmarks-grid" ? containerGrid : null);
  if (dragSession?.activeHighlightEl === nextEl) return;
  clearContainerHighlights();
  if (!nextEl) return;
  if (nextEl.id === "bookmarks-grid") {
    nextEl.classList.add("grid-drop-active");
  } else {
    nextEl.classList.add("section-drop-active");
  }
  if (dragSession) {
    dragSession.activeHighlightEl = nextEl;
  }
}

function clearHoveredGroupTab() {
  document.querySelectorAll(".group-drop-target").forEach(el => {
    el.classList.remove("group-drop-target");
  });
  if (dragSession) {
    dragSession.hoveredGroupTab = null;
  }
}

function removeDragPlaceholder() {
  if (dragSession?.placeholder?.parentNode) {
    dragSession.placeholder.remove();
  }
  document.querySelectorAll(".bookmark-tile.drag-placeholder").forEach(el => el.remove());
}

function resetDragVisuals() {
  stopAutoScroll();
  clearStackDropTarget();
  clearContainerHighlights();
  clearHoveredGroupTab();
  removeDragPlaceholder();
  document.body?.classList.remove("is-dragging-bookmark");

  const stackPopover = document.getElementById("stack-popover");
  if (stackPopover) {
    stackPopover.classList.remove("dragging-outside");
  }

  if (dragSession?.tile) {
    dragSession.tile.classList.remove("dragging");
  }
}

function findTileAtPoint(container, clientX, clientY) {
  const tiles = container.querySelectorAll(
    ".bookmark-tile:not(.dragging):not(.add-bookmark):not(.drag-placeholder)"
  );
  for (const el of tiles) {
    const box = el.getBoundingClientRect();
    if (
      clientX >= box.left &&
      clientX <= box.right &&
      clientY >= box.top &&
      clientY <= box.bottom
    ) {
      return el;
    }
  }
  return null;
}

function getInsertionPointForEmptySpace(container, clientX, clientY) {
  const tiles = [...container.querySelectorAll(
    ".bookmark-tile:not(.dragging):not(.add-bookmark):not(.drag-placeholder)"
  )];
  if (tiles.length === 0) return null;

  let closest = { distance: Number.POSITIVE_INFINITY, tile: null, insertAfter: false };
  for (const el of tiles) {
    const box = el.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const dx = clientX < box.left ? box.left - clientX : (clientX > box.right ? clientX - box.right : 0);
    const dy = clientY < box.top ? box.top - clientY : (clientY > box.bottom ? clientY - box.bottom : 0);
    const distance = Math.hypot(dx * 2, dy);
    if (distance < closest.distance) {
      const insertAfter = clientY > centerY || (Math.abs(clientY - centerY) <= box.height / 2 && clientX > centerX);
      closest = { distance, tile: el, insertAfter };
    }
  }

  if (!closest.tile) return null;
  return closest.insertAfter ? closest.tile.nextElementSibling : closest.tile;
}

function insertPlaceholderInContainer(container, beforeNode, placeholder) {
  if (!container || !placeholder) return;

  const addTile = container.querySelector(".add-bookmark");
  let targetBefore = beforeNode;
  if (addTile && (!targetBefore || targetBefore === addTile.nextElementSibling)) {
    targetBefore = addTile;
  }

  if (targetBefore && targetBefore.parentNode === container) {
    if (targetBefore.previousElementSibling === placeholder) return;
    if (targetBefore === placeholder) return;
    container.insertBefore(placeholder, targetBefore);
  } else if (addTile && addTile.parentNode === container) {
    if (addTile.previousElementSibling === placeholder) return;
    container.insertBefore(placeholder, addTile);
  } else {
    if (container.lastElementChild === placeholder) return;
    container.appendChild(placeholder);
  }
}

function collectOrderedIdsFromDom(extraReplacedId = null) {
  const orderedIds = [];
  const containers = [
    ...document.querySelectorAll("#sections-container .section-grid"),
    document.getElementById("bookmarks-grid")
  ].filter(Boolean);

  for (const grid of containers) {
    for (const child of Array.from(grid.children)) {
      if (child.classList.contains("drag-placeholder")) {
        if (extraReplacedId) orderedIds.push(extraReplacedId);
        continue;
      }
      if (
        child.classList.contains("bookmark-tile") &&
        !child.classList.contains("dragging") &&
        !child.classList.contains("add-bookmark") &&
        child.dataset.bookmarkId
      ) {
        orderedIds.push(child.dataset.bookmarkId);
      }
    }
  }
  return orderedIds;
}

function findClosestSectionGrid(clientX, clientY) {
  const sections = document.querySelectorAll("#sections-container .bookmark-section");
  let closestGrid = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    const dx = clientX < rect.left ? rect.left - clientX : (clientX > rect.right ? clientX - rect.right : 0);
    const dy = clientY < rect.top ? rect.top - clientY : (clientY > rect.bottom ? clientY - rect.bottom : 0);
    const distance = Math.hypot(dx, dy);
    if (distance < minDistance) {
      minDistance = distance;
      closestGrid = section.querySelector(".section-grid");
    }
  }

  return closestGrid;
}

function resolveWorkspaceTargetGrid(targetEl, clientX, clientY) {
  const directSectionGrid = targetEl.closest(".section-grid");
  if (directSectionGrid) return directSectionGrid;

  const sectionCard = targetEl.closest(".bookmark-section");
  if (sectionCard) return sectionCard.querySelector(".section-grid");

  if (targetEl.closest("#sections-container")) {
    return findClosestSectionGrid(clientX, clientY);
  }

  const bookmarksGrid = document.getElementById("bookmarks-grid");
  if (targetEl.closest("#bookmarks-grid")) return bookmarksGrid;

  if (targetEl.closest("#center-space") || targetEl.closest("#workspace-main")) {
    const sectionsContainer = document.getElementById("sections-container");
    if (
      sectionsContainer &&
      !sectionsContainer.classList.contains("hidden") &&
      sectionsContainer.querySelector(".bookmark-section")
    ) {
      const sectionsRect = sectionsContainer.getBoundingClientRect();
      if (clientY <= sectionsRect.bottom) {
        return findClosestSectionGrid(clientX, clientY) || bookmarksGrid;
      }
    }
    return bookmarksGrid;
  }

  return null;
}

function isInCenterStackZone(box, clientX, clientY) {
  const relX = (clientX - box.left) / Math.max(1, box.width);
  const relY = (clientY - box.top) / Math.max(1, box.height);
  return relX >= 0.28 && relX <= 0.72 && relY >= 0.22 && relY <= 0.78;
}

function isPointInElement(el, clientX, clientY) {
  if (!el || !el.isConnected) return false;
  const box = el.getBoundingClientRect();
  return (
    box.width > 0 &&
    box.height > 0 &&
    clientX >= box.left &&
    clientX <= box.right &&
    clientY >= box.top &&
    clientY <= box.bottom
  );
}

function handleDragOverDocument(e) {
  if (!dragSession || dragSession.cancelled) return;
  e.preventDefault();

  const targetEl = toElement(e.target);
  if (!targetEl) return;

  // Allow dragging a child bookmark outside of an open Stack popover
  const stackPopover = document.getElementById("stack-popover");
  const stackCard = document.getElementById("stack-popover-card");
  if (
    dragSession.sourceStackId &&
    stackPopover &&
    !stackPopover.classList.contains("hidden") &&
    stackCard
  ) {
    const rect = stackCard.getBoundingClientRect();
    const isInsideCard =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    stackPopover.classList.toggle("dragging-outside", !isInsideCard);
  }

  // 1) Dropping onto another Group tab in top bar
  const groupTab = targetEl.closest(".group-tab:not(.add-group)");
  if (groupTab && groupTab.dataset.groupId && groupTab.dataset.groupId !== window.activeGroupId) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearStackDropTarget();
    clearContainerHighlights();
    removeDragPlaceholder();
    clearHoveredGroupTab();
    groupTab.classList.add("group-drop-target");
    dragSession.hoveredGroupTab = groupTab;
    return;
  }
  clearHoveredGroupTab();

  // 2) Reordering inside the open Stack popover
  const popoverGrid = document.getElementById("stack-popover-grid");
  if (
    dragSession.sourceStackId &&
    stackPopover &&
    !stackPopover.classList.contains("hidden") &&
    !stackPopover.classList.contains("dragging-outside") &&
    popoverGrid &&
    targetEl.closest("#stack-popover-card")
  ) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearStackDropTarget();
    clearContainerHighlights();

    const hoveredTile = findTileAtPoint(popoverGrid, e.clientX, e.clientY);
    if (hoveredTile) {
      const box = hoveredTile.getBoundingClientRect();
      const beforeNode = e.clientX > box.left + box.width / 2 ? hoveredTile.nextElementSibling : hoveredTile;
      insertPlaceholderInContainer(popoverGrid, beforeNode, dragSession.placeholder);
    } else if (!isPointInElement(dragSession.placeholder, e.clientX, e.clientY) || dragSession.placeholder.parentNode !== popoverGrid) {
      const beforeNode = getInsertionPointForEmptySpace(popoverGrid, e.clientX, e.clientY);
      insertPlaceholderInContainer(popoverGrid, beforeNode, dragSession.placeholder);
    }
    return;
  }

  // 3) Reordering / Stacking / Moving between Sections and Unsectioned Grid
  const containerGrid = resolveWorkspaceTargetGrid(targetEl, e.clientX, e.clientY);
  if (!containerGrid) return;

  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  startAutoScroll(e.clientY);

  const hoveredTile = findTileAtPoint(containerGrid, e.clientX, e.clientY);
  if (hoveredTile) {
    const box = hoveredTile.getBoundingClientRect();
    const canStack = !dragSession.isStack && hoveredTile.dataset.bookmarkId !== dragSession.bookmarkId;

    if (canStack && isInCenterStackZone(box, e.clientX, e.clientY)) {
      clearContainerHighlights();
      if (dragSession.placeholder) {
        dragSession.placeholder.classList.add("is-hidden-for-stack");
      }
      if (dragSession.stackTargetTile !== hoveredTile) {
        if (dragSession.stackTargetTile) {
          dragSession.stackTargetTile.classList.remove("stack-drop-target");
        }
        hoveredTile.classList.add("stack-drop-target");
        dragSession.stackTargetTile = hoveredTile;
      }
      return;
    }

    clearStackDropTarget();
    const relX = (e.clientX - box.left) / Math.max(1, box.width);
    const relY = (e.clientY - box.top) / Math.max(1, box.height);
    const insertAfter = relX > 0.72 || (relY > 0.78 && relX >= 0.28);
    const beforeNode = insertAfter ? hoveredTile.nextElementSibling : hoveredTile;
    insertPlaceholderInContainer(containerGrid, beforeNode, dragSession.placeholder);
  } else {
    clearStackDropTarget();
    if (!isPointInElement(dragSession.placeholder, e.clientX, e.clientY) || dragSession.placeholder.parentNode !== containerGrid) {
      const beforeNode = getInsertionPointForEmptySpace(containerGrid, e.clientX, e.clientY);
      insertPlaceholderInContainer(containerGrid, beforeNode, dragSession.placeholder);
    }
  }

  setContainerHighlight(containerGrid);
}

async function commitActiveDragSession() {
  if (!dragSession || dragSession.dropHandled || dragSession.cancelled) return;

  const session = dragSession;
  session.dropHandled = true;

  const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
  if (!group) {
    resetDragVisuals();
    dragSession = null;
    return;
  }

  // Case 1: Dropped onto a different Group tab
  if (session.hoveredGroupTab) {
    const targetGroupId = session.hoveredGroupTab.dataset.groupId;
    resetDragVisuals();
    dragSession = null;
    if (targetGroupId && targetGroupId !== group.id) {
      await moveBookmarkToGroup(session.bookmarkId, targetGroupId);
    }
    return;
  }

  // Case 2: Dropped onto the center of another bookmark/stack -> Create or join a Stack
  if (session.stackTargetTile && !session.isStack) {
    const targetId = session.stackTargetTile.dataset.bookmarkId;
    const draggedLoc = findBookmarkLocation(session.bookmarkId, group);
    const targetLoc = findBookmarkLocation(targetId, group);

    resetDragVisuals();
    dragSession = null;

    if (!draggedLoc || !targetLoc || draggedLoc.item.id === targetLoc.item.id || targetLoc.parentStack) {
      return;
    }

    const [draggedItem] = draggedLoc.list.splice(draggedLoc.index, 1);
    const liveTargetIdx = group.items.findIndex(i => i && i.id === targetId);
    if (liveTargetIdx === -1) {
      draggedLoc.list.splice(draggedLoc.index, 0, draggedItem);
      return;
    }

    const targetItem = group.items[liveTargetIdx];
    const now = Date.now();
    draggedItem.updatedAt = now;

    if (isStackItem(targetItem)) {
      draggedItem.sectionId = targetItem.sectionId ?? null;
      if (!Array.isArray(targetItem.children)) targetItem.children = [];
      targetItem.children.push(draggedItem);
      targetItem.updatedAt = now;
    } else {
      targetItem.updatedAt = now;
      const targetSectionId = targetItem.sectionId ?? null;
      draggedItem.sectionId = targetSectionId;
      const newStack = {
        id: generateId("s"),
        type: "stack",
        title: t("defaultStackName") || "Stack",
        sectionId: targetSectionId,
        tileColor: null,
        children: [targetItem, draggedItem],
        updatedAt: now,
        deleted: false,
        deletedAt: null
      };
      group.items.splice(liveTargetIdx, 1, newStack);
    }

    const purgedIds = [];
    if (draggedLoc.parentStack) {
      draggedLoc.parentStack.updatedAt = now;
      const cleanupOutcome = cleanupStackIfNeeded(group, draggedLoc.parentStack);
      if (cleanupOutcome === "removed" || cleanupOutcome === "unwrapped") {
        purgedIds.push(draggedLoc.parentStack.id);
      }
    }
    group.updatedAt = now;

    await saveState();
    await render();
    syncWrite(state, purgedIds.length > 0 ? { purgedIds } : undefined);
    return;
  }

  // Case 3: Dropped into an insertion placeholder slot
  if (session.placeholder && session.placeholder.parentNode) {
    const targetGrid = session.placeholder.parentNode;
    const draggedLoc = findBookmarkLocation(session.bookmarkId, group);
    if (!draggedLoc) {
      resetDragVisuals();
      dragSession = null;
      return;
    }

    // 3a) Reordering within the open Stack popover
    if (targetGrid.id === "stack-popover-grid" && session.sourceStackId) {
      targetGrid.insertBefore(session.tile, session.placeholder);
      const childOrder = [...targetGrid.querySelectorAll(".bookmark-tile")]
        .filter(el => !el.classList.contains("drag-placeholder") && el.dataset.bookmarkId)
        .map(el => el.dataset.bookmarkId);

      resetDragVisuals();
      dragSession = null;

      if (draggedLoc.parentStack) {
        draggedLoc.parentStack.children.sort((a, b) => {
          const idxA = childOrder.indexOf(a.id);
          const idxB = childOrder.indexOf(b.id);
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
        const now = Date.now();
        draggedLoc.parentStack.updatedAt = now;
        group.updatedAt = now;
        await saveState();
        await render();
        syncWrite();
      }
      return;
    }

    // 3b) Reordering / Moving across sections or dragging OUT of a Stack
    const targetSectionId = targetGrid.classList.contains("section-grid")
      ? (targetGrid.dataset.sectionId || null)
      : null;

    const orderedIds = collectOrderedIdsFromDom(session.bookmarkId);
    resetDragVisuals();
    dragSession = null;

    const now = Date.now();
    let movedItem = draggedLoc.item;
    const purgedIds = [];

    if (draggedLoc.parentStack) {
      const [spliced] = draggedLoc.list.splice(draggedLoc.index, 1);
      if (spliced) movedItem = spliced;
      const sourceStack = draggedLoc.parentStack;
      sourceStack.updatedAt = now;
      group.items.push(movedItem);

      const soleChildCandidate = sourceStack.children.length === 1 ? sourceStack.children[0] : null;
      const cleanupOutcome = cleanupStackIfNeeded(group, sourceStack);
      if (cleanupOutcome === "removed" || cleanupOutcome === "unwrapped") {
        purgedIds.push(sourceStack.id);
      }
      if (cleanupOutcome === "unwrapped" && soleChildCandidate) {
        const oldStackIdx = orderedIds.indexOf(sourceStack.id);
        if (oldStackIdx !== -1) {
          orderedIds[oldStackIdx] = soleChildCandidate.id;
        }
      }
    }

    movedItem.sectionId = targetSectionId;
    movedItem.updatedAt = now;

    group.items.sort((a, b) => {
      const idxA = orderedIds.indexOf(a.id);
      const idxB = orderedIds.indexOf(b.id);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
    group.updatedAt = now;

    await saveState();
    await render();
    syncWrite(state, purgedIds.length > 0 ? { purgedIds } : undefined);
    return;
  }

  resetDragVisuals();
  dragSession = null;
}

async function handleDropDocument(e) {
  if (!dragSession) return;
  if (dragSession.cancelled) {
    resetDragVisuals();
    dragSession = null;
    return;
  }
  e.preventDefault();
  await commitActiveDragSession();
}

function initializeGlobalDragListeners() {
  if (dragListenersInitialized) return;
  dragListenersInitialized = true;

  document.addEventListener("dragstart", e => {
    if (document.body?.classList.contains("tiles-locked")) {
      e.preventDefault();
      return;
    }

    const targetEl = toElement(e.target);
    if (!targetEl) return;

    // Group tab reordering has its own listener in groups.js
    if (targetEl.closest(".group-tab")) return;

    const tile = targetEl.closest(".bookmark-tile");
    if (!tile || tile.classList.contains("add-bookmark") || tile.classList.contains("drag-placeholder")) {
      return;
    }

    const bookmarkId = tile.dataset.bookmarkId;
    if (!bookmarkId) return;

    const popoverGrid = tile.closest("#stack-popover-grid");
    const sourceStackId = popoverGrid
      ? (tile.dataset.parentStackId || popoverGrid.dataset.stackId || null)
      : null;

    dragSession = {
      tile,
      bookmarkId,
      isStack: tile.dataset.isStack === "true",
      sourceStackId,
      placeholder: createDragPlaceholder(tile),
      stackTargetTile: null,
      hoveredGroupTab: null,
      dropHandled: false,
      cancelled: false
    };

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", bookmarkId);
      try {
        e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0);
      } catch {
        // Ignore if synthetic DragEvent in tests
      }
    }

    requestAnimationFrame(() => {
      if (dragSession?.tile === tile) {
        tile.classList.add("dragging");
        document.body?.classList.add("is-dragging-bookmark");
      }
    });
  });

  document.addEventListener("dragover", handleDragOverDocument);
  document.addEventListener("drop", handleDropDocument);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && dragSession) {
      dragSession.cancelled = true;
      resetDragVisuals();
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });

  document.addEventListener("dragend", e => {
    if (!dragSession) return;
    const wasCancelled = dragSession.cancelled || e.dataTransfer?.dropEffect === "none";
    if (
      !wasCancelled &&
      !dragSession.dropHandled &&
      (dragSession.placeholder?.parentNode || dragSession.stackTargetTile || dragSession.hoveredGroupTab)
    ) {
      void commitActiveDragSession();
      return;
    }
    resetDragVisuals();
    dragSession = null;
  });
}

export function setupBookmarkDrag() {
  initializeGlobalDragListeners();

  // Prevent nested <a> links from initiating native URL-link drags instead of tile drags
  document.querySelectorAll(".bookmark-tile .bookmark-title").forEach(link => {
    if (link instanceof HTMLAnchorElement) {
      link.draggable = false;
    }
  });
}
