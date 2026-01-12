import { loadState, saveState, state } from "./state.js";
import { loadTheme } from "./theme.js";
import { render } from "./render.js";
import { syncRead, startSyncLoop } from "./sync.js";

// Aktivácia event listenerov
import "./groups.js";
import "./bookmarks.js";
import "./contextmenu.js";
import "./dragdrop.js";
import "./importexport.js";
import "./sync-ui.js";

window.addEventListener("keydown", e => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const ctrl = isMac ? e.metaKey : e.ctrlKey;

  if (ctrl && e.key.toLowerCase() === "f") {
    e.preventDefault();

    const search = document.getElementById("search-box");
    if (search) {
      search.focus();
      search.select();

      // Pulse efekt
      search.classList.remove("search-pulse"); // reset ak bol efekt nedávno
      void search.offsetWidth;                // force reflow
      search.classList.add("search-pulse");
    }
  }
});


(async function init() {
  // 1) Načítanie uloženého stavu
  await loadState();

  // 2) Načítanie témy
  await loadTheme();

  // 3) Prvotný sync (ak je zapnutý)
  if (state.sync.enabled) {
    const cloud = await syncRead();

    if (cloud && cloud.groups) {
      // 🔥 Syncujeme iba groups, nie celý state
      state.groups = cloud.groups;
      state.sync.lastSync = Date.now();
      await saveState();
    }
  }

  // 4) Spustiť periodický sync
  startSyncLoop();

  // 5) Render UI
  render();
})();
