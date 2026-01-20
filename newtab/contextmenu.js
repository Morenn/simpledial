import { handleGroupContext } from "./groups.js";
import { handleBookmarkContext } from "./bookmarks.js";

// ---------- Kontextové menu ----------
const contextMenu = document.getElementById("context-menu");
let contextTarget = null;

// Otvorenie kontextového menu
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

// Klik mimo menu → zatvoriť
document.addEventListener("click", e => {
  if (!e.target.closest("#context-menu")) {
    contextMenu.classList.add("hidden");
    contextTarget = null;
  }
});

// Kliknutie na položku menu
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
