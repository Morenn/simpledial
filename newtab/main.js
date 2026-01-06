import { loadState, saveState, state } from "./state.js";
import { loadTheme } from "./theme.js";
import { render } from "./render.js";
import { webdavRead, startWebdavSync } from "./webdav.js";

// Tieto moduly sa len importujú, aby sa aktivovali ich event listenery
import "./groups.js";
import "./bookmarks.js";
import "./contextmenu.js";
import "./dragdrop.js";
import "./importexport.js";
import "./webdav-ui.js";

(async function init() {
  // 1) Načítanie uloženého stavu
  await loadState();

  // 2) Načítanie témy
  await loadTheme();

  // 3) Prvotný WebDAV sync (ak je zapnutý)
  if (state.sync.enabled) {
    const cloud = await webdavRead();
    if (cloud) {
      Object.assign(state, cloud);
      await saveState();
    }
  }

  // 4) Spustiť periodický WebDAV sync
  startWebdavSync();

  // 5) Render UI
  render();
})();
