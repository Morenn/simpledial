import { handleGroupContext } from "./groups.js";
import { handleBookmarkContext } from "./bookmarks.js";

// ---------- Context menu ----------
const contextMenu = document.getElementById("context-menu");
let contextTarget = null;

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
async function updateContextMenuForBookmark(bookmarkTile) {
  const bookmarkId = bookmarkTile.dataset.bookmarkId;
  const { state } = await import("./state.js");
  
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
  } else {
    // Item is not deleted: show delete and edit, hide restore and delete-permanent
    if (deleteBtn) deleteBtn.classList.remove("hidden");
    if (restoreBtn) restoreBtn.classList.add("hidden");
    if (deletePermanentBtn) deletePermanentBtn.classList.add("hidden");
    if (editBtn) editBtn.classList.remove("hidden");
    if (refreshIconBtn) refreshIconBtn.classList.remove("hidden");
  }
}

// Update context menu visibility based on group state
async function updateContextMenuForGroup(groupTab) {
  const groupId = groupTab.dataset.groupId;
  const { state } = await import("./state.js");
  
  const group = state.groups.find(g => g.id === groupId);
  
  const editBtn = contextMenu.querySelector('[data-action="edit"]');
  const deleteBtn = contextMenu.querySelector('[data-action="delete"]');
  const restoreBtn = contextMenu.querySelector('[data-action="restore"]');
  const deletePermanentBtn = contextMenu.querySelector('[data-action="delete-permanent"]');
  const refreshIconBtn = contextMenu.querySelector('[data-action="refresh-icon"]');
  
  if (!group) return;
  
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

// Clik outside to close menu
document.addEventListener("click", e => {
  if (!e.target.closest("#context-menu")) {
    contextMenu.classList.add("hidden");
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
