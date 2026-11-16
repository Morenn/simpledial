import { generateId, isStackItem, getAllGroupBookmarks } from "./state.js";

export function isBookmarkRootId(id) {
  return id === "0" || id === "root________";
}

function isBookmarkNode(node) {
  if (!node || typeof node.url !== "string") return false;
  const trimmed = node.url.trim();
  if (!trimmed) return false;
  // Skip Firefox internal smart-bookmark queries (e.g. place:sort=8&maxResults=10)
  if (/^place:/i.test(trimmed)) return false;
  return true;
}

function isFolderNode(node) {
  return Boolean(node && !isBookmarkNode(node) && Array.isArray(node.children));
}

function createImportedBookmark(node, sectionId = null, now = Date.now()) {
  const url = node.url.trim();
  return {
    id: generateId("b"),
    title: (node.title || "").trim() || url,
    url,
    customIcon: null,
    notes: null,
    tags: [],
    sectionId,
    tileColor: null,
    colorFromIcon: false,
    customIconCache: null,
    iconRefreshedAt: 0,
    updatedAt: now,
    deleted: false,
    deletedAt: null
  };
}

function createImportedStack(title, children, sectionId = null, now = Date.now()) {
  return {
    id: generateId("s"),
    type: "stack",
    title: (title || "").trim() || "Stack",
    sectionId,
    tileColor: null,
    updatedAt: now,
    deleted: false,
    deletedAt: null,
    children
  };
}

function collectBookmarksFlat(folderNode, sectionId = null, now = Date.now()) {
  const results = [];
  for (const child of folderNode.children || []) {
    if (isBookmarkNode(child)) {
      results.push(createImportedBookmark(child, sectionId, now));
    } else if (isFolderNode(child)) {
      results.push(...collectBookmarksFlat(child, sectionId, now));
    }
  }
  return results;
}

function countBookmarksRecursive(node) {
  if (!node) return 0;
  if (isBookmarkNode(node)) return 1;
  let count = 0;
  for (const child of node.children || []) {
    count += countBookmarksRecursive(child);
  }
  return count;
}

/**
 * Flattens a browser bookmarks tree into selectable folder entries.
 */
export function listBookmarkFolders(tree) {
  const folders = [];
  const roots = Array.isArray(tree) ? tree : [];

  function walk(node, depth) {
    if (!isFolderNode(node)) return;
    const directBookmarks = (node.children || []).filter(isBookmarkNode).length;
    const totalBookmarks = countBookmarksRecursive(node);

    if (isBookmarkRootId(node.id) || depth >= 0) {
      folders.push({
        id: String(node.id),
        title: (node.title || "").trim() || (isBookmarkRootId(node.id) ? "All Bookmarks" : "Folder"),
        depth,
        directBookmarks,
        totalBookmarks
      });
    }

    for (const child of node.children || []) {
      if (isFolderNode(child)) {
        walk(child, depth + 1);
      }
    }
  }

  for (const root of roots) {
    if (isBookmarkRootId(root?.id) && Array.isArray(root.children)) {
      folders.push({
        id: String(root.id),
        title: (root.title || "").trim() || "All Bookmarks",
        depth: 0,
        directBookmarks: (root.children || []).filter(isBookmarkNode).length,
        totalBookmarks: countBookmarksRecursive(root)
      });
      for (const child of root.children) {
        if (isFolderNode(child)) {
          walk(child, 1);
        }
      }
    } else {
      walk(root, 0);
    }
  }

  return folders;
}

/**
 * Finds a node by ID inside a browser bookmarks tree.
 */
export function findBookmarkNodeById(tree, nodeId) {
  const targetId = String(nodeId ?? "");
  const stack = [...(Array.isArray(tree) ? tree : [])];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (String(current.id) === targetId) return current;
    if (Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return null;
}

function buildGroupFromFolder(folderNode, { maxDepth = "auto", fallbackTitle = "Group" } = {}, now = Date.now()) {
  const sections = [];
  const items = [];
  const children = folderNode?.children || [];

  const directBookmarks = children.filter(isBookmarkNode);
  const directSubfolders = children.filter(isFolderNode);

  for (const bm of directBookmarks) {
    items.push(createImportedBookmark(bm, null, now));
  }

  if (maxDepth === "flat") {
    for (const sub of directSubfolders) {
      items.push(...collectBookmarksFlat(sub, null, now));
    }
  } else if (maxDepth === "stacks") {
    for (const sub of directSubfolders) {
      const stackChildren = collectBookmarksFlat(sub, null, now);
      if (stackChildren.length > 0) {
        items.push(createImportedStack(sub.title, stackChildren, null, now));
      }
    }
  } else {
    // "auto" or "sections": direct subfolders become Sections; deeper subfolders become Stacks (in "auto") or flatten (in "sections").
    for (const sub of directSubfolders) {
      const sectionItems = [];
      const subChildren = sub.children || [];
      const sectionId = generateId("sec");

      for (const node of subChildren) {
        if (isBookmarkNode(node)) {
          sectionItems.push(createImportedBookmark(node, sectionId, now));
        } else if (isFolderNode(node)) {
          const stackBookmarks = collectBookmarksFlat(node, sectionId, now);
          if (stackBookmarks.length === 0) continue;

          if (maxDepth === "auto") {
            sectionItems.push(
              createImportedStack(
                node.title,
                stackBookmarks.map(b => ({ ...b, sectionId: null })),
                sectionId,
                now
              )
            );
          } else {
            sectionItems.push(...stackBookmarks);
          }
        }
      }

      if (sectionItems.length > 0) {
        sections.push({
          id: sectionId,
          name: (sub.title || "").trim() || "Section",
          order: sections.length,
          updatedAt: now,
          deleted: false,
          deletedAt: null
        });
        items.push(...sectionItems);
      }
    }
  }

  return {
    id: generateId("g"),
    name: (folderNode?.title || "").trim() || fallbackTitle,
    iconEmoji: null,
    customIcon: null,
    tileColor: null,
    colorFromIcon: false,
    sections,
    items,
    updatedAt: now,
    deleted: false,
    deletedAt: null
  };
}

/**
 * Maps a selected browser bookmark folder node into SpeedDial groups.
 */
export function buildImportedGroupsFromFolder(rootNode, {
  structureMode = "groups",
  maxDepth = "auto",
  fallbackGroupName = "Imported bookmarks"
} = {}) {
  if (!rootNode) return [];
  const now = Date.now();

  if (structureMode === "single-group") {
    const group = buildGroupFromFolder(rootNode, { maxDepth, fallbackTitle: fallbackGroupName }, now);
    return group.items.length > 0 ? [group] : [];
  }

  // "groups" mode: direct subfolders become Groups; direct bookmarks in rootNode go into a root group.
  const groups = [];
  const directBookmarks = (rootNode.children || []).filter(isBookmarkNode);
  const directSubfolders = (rootNode.children || []).filter(isFolderNode);

  if (directBookmarks.length > 0) {
    groups.push({
      id: generateId("g"),
      name: (!isBookmarkRootId(rootNode.id) && (rootNode.title || "").trim()) ? rootNode.title.trim() : fallbackGroupName,
      iconEmoji: null,
      customIcon: null,
      tileColor: null,
      colorFromIcon: false,
      sections: [],
      items: directBookmarks.map(bm => createImportedBookmark(bm, null, now)),
      updatedAt: now,
      deleted: false,
      deletedAt: null
    });
  }

  for (const sub of directSubfolders) {
    const group = buildGroupFromFolder(sub, { maxDepth, fallbackTitle: "Group" }, now);
    if (group.items.length > 0) {
      groups.push(group);
    }
  }

  return groups;
}

function normalizeUrlKey(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function cloneGroupForMerge(group) {
  return {
    ...group,
    sections: Array.isArray(group.sections) ? group.sections.map(s => ({ ...s })) : [],
    items: Array.isArray(group.items)
      ? group.items.map(item => isStackItem(item)
        ? { ...item, children: (item.children || []).map(c => ({ ...c })) }
        : { ...item })
      : []
  };
}

/**
 * Counts internal/unsupported bookmark nodes (such as Firefox `place:` queries) skipped during import.
 */
export function countSkippedImportNodes(rootNode) {
  if (!rootNode) return 0;
  let skipped = 0;
  const stack = [...(rootNode.children || [])];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (typeof current.url === "string" && current.url.trim()) {
      if (/^place:/i.test(current.url.trim())) {
        skipped++;
      }
    } else if (Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return skipped;
}

/**
 * Merges or replaces SpeedDial groups with imported groups and computes exact stats.
 */
export function mergeImportedGroupsIntoState(existingGroups, importedGroups, { mode = "merge", targetGroupId = null } = {}) {
  const stats = {
    groupsCreated: 0,
    groupsMatched: 0,
    sectionsCreated: 0,
    stacksCreated: 0,
    bookmarksAdded: 0,
    duplicatesSkipped: 0
  };
  const importedBookmarkIds = [];
  const groupDetails = [];

  if (mode === "replace") {
    const nextGroups = (importedGroups || []).map(cloneGroupForMerge);
    for (const g of nextGroups) {
      stats.groupsCreated++;
      const secCount = (g.sections || []).filter(s => !s.deleted).length;
      stats.sectionsCreated += secCount;
      let gStacks = 0;
      let gBookmarks = 0;
      for (const item of g.items || []) {
        if (isStackItem(item)) {
          stats.stacksCreated++;
          gStacks++;
          for (const child of item.children || []) {
            stats.bookmarksAdded++;
            gBookmarks++;
            importedBookmarkIds.push(child.id);
          }
        } else {
          stats.bookmarksAdded++;
          gBookmarks++;
          importedBookmarkIds.push(item.id);
        }
      }
      groupDetails.push({
        name: g.name || "Group",
        action: "replace",
        sectionsCreated: secCount,
        stacksCreated: gStacks,
        bookmarksAdded: gBookmarks,
        duplicatesSkipped: 0
      });
    }
    return { groups: nextGroups, stats, importedBookmarkIds, groupDetails };
  }

  const nextGroups = (existingGroups || []).map(cloneGroupForMerge);

  for (const impGroup of importedGroups || []) {
    const normalizedGroupName = (impGroup.name || "").trim().toLowerCase();
    const targetGroup = targetGroupId
      ? nextGroups.find(g => g && !g.deleted && g.id === targetGroupId)
      : nextGroups.find(
          g => g && !g.deleted && (g.name || "").trim().toLowerCase() === normalizedGroupName
        );

    if (!targetGroup) {
      const cloned = cloneGroupForMerge(impGroup);
      nextGroups.push(cloned);
      stats.groupsCreated++;
      const secCount = (cloned.sections || []).filter(s => !s.deleted).length;
      stats.sectionsCreated += secCount;
      let gStacks = 0;
      let gBookmarks = 0;
      for (const item of cloned.items || []) {
        if (isStackItem(item)) {
          stats.stacksCreated++;
          gStacks++;
          for (const child of item.children || []) {
            stats.bookmarksAdded++;
            gBookmarks++;
            importedBookmarkIds.push(child.id);
          }
        } else {
          stats.bookmarksAdded++;
          gBookmarks++;
          importedBookmarkIds.push(item.id);
        }
      }
      groupDetails.push({
        name: cloned.name || "Group",
        action: "new",
        sectionsCreated: secCount,
        stacksCreated: gStacks,
        bookmarksAdded: gBookmarks,
        duplicatesSkipped: 0
      });
      continue;
    }

    stats.groupsMatched++;
    let gSections = 0;
    let gStacks = 0;
    let gBookmarks = 0;
    let gSkipped = 0;

    const existingUrls = new Set(
      getAllGroupBookmarks(targetGroup).map(b => normalizeUrlKey(b.url)).filter(Boolean)
    );

    // Map imported section IDs to existing or newly created sections in targetGroup
    const sectionIdMap = new Map();
    for (const impSec of impGroup.sections || []) {
      const secNameKey = (impSec.name || impSec.title || "").trim().toLowerCase();
      const existingSec = (targetGroup.sections || []).find(
        s => s && !s.deleted && (s.name || s.title || "").trim().toLowerCase() === secNameKey
      );
      if (existingSec) {
        sectionIdMap.set(impSec.id, existingSec.id);
      } else {
        const newSec = {
          ...impSec,
          order: (targetGroup.sections || []).length
        };
        targetGroup.sections.push(newSec);
        sectionIdMap.set(impSec.id, newSec.id);
        stats.sectionsCreated++;
        gSections++;
      }
    }

    for (const item of impGroup.items || []) {
      const mappedSectionId = item.sectionId ? (sectionIdMap.get(item.sectionId) || null) : null;
      if (isStackItem(item)) {
        const keptChildren = [];
        for (const child of item.children || []) {
          const urlKey = normalizeUrlKey(child.url);
          if (urlKey && existingUrls.has(urlKey)) {
            stats.duplicatesSkipped++;
            gSkipped++;
            continue;
          }
          if (urlKey) existingUrls.add(urlKey);
          keptChildren.push({ ...child });
          stats.bookmarksAdded++;
          gBookmarks++;
          importedBookmarkIds.push(child.id);
        }
        if (keptChildren.length > 0) {
          targetGroup.items.push({
            ...item,
            sectionId: mappedSectionId,
            children: keptChildren
          });
          stats.stacksCreated++;
          gStacks++;
        }
      } else {
        const urlKey = normalizeUrlKey(item.url);
        if (urlKey && existingUrls.has(urlKey)) {
          stats.duplicatesSkipped++;
          gSkipped++;
          continue;
        }
        if (urlKey) existingUrls.add(urlKey);
        targetGroup.items.push({
          ...item,
          sectionId: mappedSectionId
        });
        stats.bookmarksAdded++;
        gBookmarks++;
        importedBookmarkIds.push(item.id);
      }
    }

    groupDetails.push({
      name: targetGroup.name || impGroup.name || "Group",
      action: "merge",
      sectionsCreated: gSections,
      stacksCreated: gStacks,
      bookmarksAdded: gBookmarks,
      duplicatesSkipped: gSkipped
    });
  }

  return { groups: nextGroups, stats, importedBookmarkIds, groupDetails };
}
