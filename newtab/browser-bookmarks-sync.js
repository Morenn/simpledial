import { state } from "./state.js";
import { loadConfig } from "./config.js";
import { findOrCreateSimpleDialFolder, getBookmarkChildren, createBookmarkNode, removeBookmarkNode } from "./bookmarks-api.js";

let syncQueue = Promise.resolve();

export async function syncBrowserBookmarks({ force = false } = {}) {
  const config = await loadConfig();
  if (!force && !config.browserBookmarksAutoSync) return false;

  const folder = await findOrCreateSimpleDialFolder();
  const existingChildren = await getBookmarkChildren(folder.id);

  for (const child of existingChildren) {
    await removeBookmarkNode(child.id);
  }

  const groupsToExport = state.groups.filter(group => !group.deleted);
  for (const group of groupsToExport) {
    const groupFolder = await createBookmarkNode({
      parentId: folder.id,
      title: group.name || "Group"
    });
    const itemsToExport = (group.items || []).filter(item => !item.deleted && item.url);
    for (const item of itemsToExport) {
      await createBookmarkNode({
        parentId: groupFolder.id,
        title: item.title || item.url,
        url: item.url
      });
    }
  }

  return true;
}

export function queueBrowserBookmarksSync() {
  syncQueue = syncQueue
    .then(() => syncBrowserBookmarks())
    .catch(error => {
      console.error("Automatic browser bookmarks sync failed", error);
    });
  return syncQueue;
}

window.addEventListener("speeddial:state-saved", () => {
  void queueBrowserBookmarksSync();
});
