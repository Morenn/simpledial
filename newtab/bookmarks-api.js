// Bookmark API helpers for browser bookmarks export/import
function getBookmarksApi() {
  const chromeApi = (typeof chrome !== 'undefined' && chrome.bookmarks) ? chrome.bookmarks : null;
  const browserApi = (typeof browser !== 'undefined' && browser.bookmarks) ? browser.bookmarks : null;
  return chromeApi || browserApi;
}

function ensureBookmarksApi() {
  const bookmarksApi = getBookmarksApi();
  if (!bookmarksApi) {
    const chromeAvailable = typeof chrome !== 'undefined';
    const browserAvailable = typeof browser !== 'undefined';
    console.error('Bookmarks API unavailable', {
      chromeAvailable,
      browserAvailable,
      chromeBookmarks: chrome?.bookmarks,
      browserBookmarks: browser?.bookmarks
    });
    throw new Error('Bookmarks API unavailable');
  }
  return bookmarksApi;
}

function getRuntimeLastError() {
  return (typeof chrome !== "undefined" && chrome?.runtime?.lastError)
    || (typeof browser !== "undefined" && browser?.runtime?.lastError)
    || null;
}

function callBookmarksApi(invoke) {
  const bookmarksApi = ensureBookmarksApi();
  return new Promise((resolve, reject) => {
    try {
      invoke(bookmarksApi, (result) => {
        const err = getRuntimeLastError();
        if (err) {
          reject(new Error(err.message || String(err)));
          return;
        }
        resolve(result);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function getBookmarksTree() {
  return callBookmarksApi((api, cb) => api.getTree(cb));
}

export function getBookmarkChildren(parentId) {
  return callBookmarksApi((api, cb) => api.getChildren(parentId, cb));
}

export function normalizeBookmarkUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function createBookmarkNode(createData) {
  const normalized = { ...createData };
  if (normalized.url) {
    normalized.url = normalizeBookmarkUrl(normalized.url);
  }
  return callBookmarksApi((api, cb) => api.create(normalized, cb));
}

export function removeBookmarkNode(nodeId) {
  return callBookmarksApi((api, cb) => api.removeTree(nodeId, cb));
}

export async function findOrCreateSimpleDialFolder() {
  ensureBookmarksApi();
  const tree = await getBookmarksTree();
  const root = Array.isArray(tree) ? tree[0] : tree;
  const existing = findFolderByTitle(root, 'SimpleDial');
  if (existing) {
    return existing;
  }

  const preferredRoot = findPreferredBookmarksRoot(root) || root;
  return await createBookmarkNode({ parentId: preferredRoot.id, title: 'SimpleDial' });
}

function findFolderByTitle(node, title) {
  if (node.title === title && !node.url) {
    return node;
  }
  if (!node.children) return null;
  for (const child of node.children) {
    const found = findFolderByTitle(child, title);
    if (found) return found;
  }
  return null;
}

function findPreferredBookmarksRoot(node) {
  if (!node.children) return null;
  const preferredTitles = [
    'Other Bookmarks',
    'Bookmarks Toolbar',
    'Bookmarks Menu',
    'Bookmarks Bar',
    'Mobile Bookmarks'
  ];
  for (const child of node.children) {
    if (preferredTitles.includes(child.title)) {
      return child;
    }
  }
  return node.children[0] || node;
}
