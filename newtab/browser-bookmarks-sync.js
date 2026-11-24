import { state, isStackItem } from "./state.js";
import { loadConfig } from "./config.js";
import { findOrCreateSimpleDialFolder, getBookmarkChildren, createBookmarkNode, removeBookmarkNode } from "./bookmarks-api.js";
import { formatGroupFolderTitle } from "./color-utils.js";

const BROWSER_BOOKMARKS_LOCK_NAME = "simple-dial-browser-bookmarks-sync";
let syncQueue = Promise.resolve();

async function withBrowserBookmarksLock(task) {
  const runInTab = () => {
    const next = syncQueue.then(task, task);
    syncQueue = next.catch(() => {});
    return next;
  };

  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  if (locks && typeof locks.request === "function") {
    return locks.request(BROWSER_BOOKMARKS_LOCK_NAME, { mode: "exclusive" }, async () => await runInTab());
  }

  return await runInTab();
}

async function syncBrowserBookmarksUnlocked({ force = false } = {}) {
  const config = await loadConfig();
  if (!force && !config.browserBookmarksAutoSync) return false;

  const folder = await findOrCreateSimpleDialFolder();
  const existingChildren = await getBookmarkChildren(folder.id);

  // Build new group folders before removing previous children so a mid-sync failure
  // never leaves the browser bookmarks folder empty or truncated.
  const createdGroupFolderIds = [];
  try {
    const groupsToExport = state.groups.filter(group => !group.deleted);
    for (const group of groupsToExport) {
      const groupFolder = await createBookmarkNode({
        parentId: folder.id,
        title: formatGroupFolderTitle(group)
      });
      createdGroupFolderIds.push(groupFolder.id);
      const itemsToExport = (group.items || []).filter(item => !item.deleted);
      for (const item of itemsToExport) {
        if (isStackItem(item)) {
          const activeChildren = (item.children || []).filter(child => !child.deleted && child.url);
          if (activeChildren.length === 0) continue;
          const stackFolder = await createBookmarkNode({
            parentId: groupFolder.id,
            title: item.title || "Stack"
          });
          for (const child of activeChildren) {
            await createBookmarkNode({
              parentId: stackFolder.id,
              title: child.title || child.url,
              url: child.url
            });
          }
        } else if (item.url) {
          await createBookmarkNode({
            parentId: groupFolder.id,
            title: item.title || item.url,
            url: item.url
          });
        }
      }
    }
  } catch (err) {
    for (const createdId of createdGroupFolderIds) {
      try {
        await removeBookmarkNode(createdId);
      } catch {
        // Best-effort rollback of partially created folders
      }
    }
    throw err;
  }

  for (const child of existingChildren) {
    await removeBookmarkNode(child.id);
  }

  return true;
}

export async function syncBrowserBookmarks(options = {}) {
  return await withBrowserBookmarksLock(() => syncBrowserBookmarksUnlocked(options));
}

export function queueBrowserBookmarksSync() {
  return syncBrowserBookmarks().catch(error => {
    console.error("Automatic browser bookmarks sync failed", error);
  });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("speeddial:state-saved", () => {
    void queueBrowserBookmarksSync();
  });
}
