import { handleGroupContext } from "./groups.js";
import { handleBookmarkContext, moveBookmarkToGroup } from "./bookmarks.js";
import { state } from "./state.js";

// ---------- Context menu ----------
const contextMenu = document.getElementById("context-menu");
const moveToItem = document.getElementById("context-move-to");
const moveToSubmenu = document.getElementById("context-move-to-submenu");
let contextTarget = null;

// Move submenu to <body> so it isn't clipped by #context-menu's overflow:auto
if (moveToSubmenu) {
  document.body.appendChild(moveToSubmenu);
}

// Show/position submenu on hover over the "Move to" item
if (moveToItem && moveToSubmenu) {
  let hideTimeout = null;

  function showSubmenu() {
    clearTimeout(hideTimeout);

    const rect = moveToItem.getBoundingClientRect();

    moveToSubmenu.style.visibility = "hidden";
    moveToSubmenu.classList.add("show");
    const submenuHeight = moveToSubmenu.offsetHeight;
    const submenuWidth = moveToSubmenu.offsetWidth;

    let left = rect.right;
    if (left + submenuWidth > window.innerWidth) {
      left = Math.max(0, rect.left - submenuWidth);
    }

    let top = rect.top;
    if (top + submenuHeight > window.innerHeight) {
      top = Math.max(0, window.innerHeight - submenuHeight - 4);
    }

    moveToSubmenu.style.left = `${left}px`;
    moveToSubmenu.style.top = `${top}px`;
    moveToSubmenu.style.visibility = "visible";
  }

  function scheduleHideSubmenu() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      moveToSubmenu.classList.remove("show");
    }, 150);
  }

  moveToItem.addEventListener("mouseenter", showSubmenu);
  moveToItem.addEventListener("mouseleave", scheduleHideSubmenu);

  moveToSubmenu.addEventListener("mouseenter", () => clearTimeout(hideTimeout));
  moveToSubmenu.addEventListener("mouseleave", scheduleHideSubmenu);
}

// Open context menu on right-click
document.addEventListener("contextmenu", e => {
  const groupTab = e.target.closest(".group-tab");
  const bookmarkTile = e.target.closest(".bookmark-tile");

  if (!groupTab && !bookmarkTile) return;
  if (groupTab && groupTab.classList.contains("add-group")) return;
  if (bookmarkTile && bookmarkTile.classList.contains("add-bookmark")) return;

  e.preventDefault();
  contextTarget = groupTab || bookmarkTile;

  // Update menu visibility for bookmarks
  if (bookmarkTile) {
    updateContextMenuForBookmark(bookmarkTile);
  }

  // Update menu visibility for groups
  if (groupTab) {
    updateContextMenuForGroup(groupTab);
  }

  contextMenu.style.left = e.pageX + "px";
  contextMenu.style.top = e.pageY + "px";
  contextMenu.classList.remove("hidden");
});

// Update context menu visibility based on bookmark state
function updateContextMenuForBookmark(bookmarkTile) {
  const bookmarkId = bookmarkTile.dataset.bookmarkId;

  const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
  const item = group?.items.find(i => i.id === bookmarkId);

  const deleteBtn = contextMenu.querySelector('[data-action="delete"]');
  const restoreBtn = contextMenu.querySelector('[data-action="restore"]');
  const deletePermanentBtn = contextMenu.querySelector('[data-action="delete-permanent"]');
  const editBtn = contextMenu.querySelector('[data-action="edit"]');
  const refreshIconBtn = contextMenu.querySelector('[data-action="refresh-icon"]');

  if (!item) return;

  // Show/hide based on deleted status
  if (item.deleted) {
    // Item is deleted: show restore and delete-permanent, hide delete
    if (deleteBtn) deleteBtn.classList.add("hidden");
    if (restoreBtn) restoreBtn.classList.remove("hidden");
    if (deletePermanentBtn) deletePermanentBtn.classList.remove("hidden");
    if (editBtn) editBtn.classList.add("hidden");
    if (refreshIconBtn) refreshIconBtn.classList.add("hidden");
    if (moveToItem) moveToItem.classList.add("hidden");
  } else {
    // Item is not deleted: show delete and edit, hide restore and delete-permanent
    if (deleteBtn) deleteBtn.classList.remove("hidden");
    if (restoreBtn) restoreBtn.classList.add("hidden");
    if (deletePermanentBtn) deletePermanentBtn.classList.add("hidden");
    if (editBtn) editBtn.classList.remove("hidden");
    if (refreshIconBtn) refreshIconBtn.classList.remove("hidden");
    if (moveToItem) moveToItem.classList.remove("hidden");
    populateMoveToSubmenu(bookmarkId);
  }
}

// Populate the "Move to" submenu with all non-deleted groups except the current one
function populateMoveToSubmenu(bookmarkId) {
  if (!moveToSubmenu) return;
  moveToSubmenu.innerHTML = "";

  const availableGroups = state.groups.filter(g => !g.deleted && g.id !== window.activeGroupId);

  if (availableGroups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "disabled";
    empty.textContent = window.t ? window.t("noOtherGroups") : "No other groups";
    moveToSubmenu.appendChild(empty);
    return;
  }

  availableGroups.forEach(group => {
    const option = document.createElement("div");
    option.textContent = group.name;
    option.dataset.targetGroupId = group.id;
    option.addEventListener("click", async (e) => {
      e.stopPropagation();
      await moveBookmarkToGroup(bookmarkId, group.id);
      contextMenu.classList.add("hidden");
      moveToSubmenu.classList.remove("show");
      contextTarget = null;
    });
    moveToSubmenu.appendChild(option);
  });
}

// Update context menu visibility based on group state
function updateContextMenuForGroup(groupTab) {
  const groupId = groupTab.dataset.groupId;

  const group = state.groups.find(g => g.id === groupId);

  const editBtn = contextMenu.querySelector('[data-action="edit"]');
  const deleteBtn = contextMenu.querySelector('[data-action="delete"]');
  const restoreBtn = contextMenu.querySelector('[data-action="restore"]');
  const deletePermanentBtn = contextMenu.querySelector('[data-action="delete-permanent"]');
  const refreshIconBtn = contextMenu.querySelector('[data-action="refresh-icon"]');

  if (!group) return;

  if (moveToItem) moveToItem.classList.add("hidden");

  // Show/hide based on deleted status
  if (group.deleted) {
    // Group is deleted: show restore and delete-permanent, hide edit and delete
    if (editBtn) editBtn.classList.add("hidden");
    if (deleteBtn) deleteBtn.classList.add("hidden");
    if (restoreBtn) restoreBtn.classList.remove("hidden");
    if (deletePermanentBtn) deletePermanentBtn.classList.remove("hidden");
    if (refreshIconBtn) refreshIconBtn.classList.add("hidden");
  } else {
    // Group is not deleted: show edit and delete, hide restore and delete-permanent
    if (editBtn) editBtn.classList.remove("hidden");
    if (deleteBtn) deleteBtn.classList.remove("hidden");
    if (restoreBtn) restoreBtn.classList.add("hidden");
    if (deletePermanentBtn) deletePermanentBtn.classList.add("hidden");
    if (refreshIconBtn) refreshIconBtn.classList.add("hidden");
  }
}

// Click outside to close menu
document.addEventListener("click", e => {
  if (!e.target.closest("#context-menu") && !e.target.closest("#context-move-to-submenu")) {
    contextMenu.classList.add("hidden");
    if (moveToSubmenu) moveToSubmenu.classList.remove("show");
    contextTarget = null;
  }
});

// Click on menu item
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