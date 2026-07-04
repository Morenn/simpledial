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

export function getBookmarksTree() {
  const bookmarksApi = ensureBookmarksApi();
  return new Promise((resolve, reject) => {
    try {
      bookmarksApi.getTree((tree) => {
        resolve(tree);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function getBookmarkChildren(parentId) {
  const bookmarksApi = ensureBookmarksApi();
  return new Promise((resolve, reject) => {
    try {
      bookmarksApi.getChildren(parentId, (children) => {
        resolve(children);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function createBookmarkNode(createData) {
  const bookmarksApi = ensureBookmarksApi();
  return new Promise((resolve, reject) => {
    try {
      bookmarksApi.create(createData, (node) => {
        resolve(node);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function removeBookmarkNode(nodeId) {
  const bookmarksApi = ensureBookmarksApi();
  return new Promise((resolve, reject) => {
    try {
      bookmarksApi.removeTree(nodeId, () => {
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
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
