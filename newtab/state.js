export const STORAGE_KEY = "myspeeddial-data";
export const THEME_KEY = "myspeeddial-theme";
export const ACTIVE_GROUP_KEY = "myspeeddial-active-group";
export const SYSTEM_TAGS_KEY = "myspeeddial-system-tags";

export const SYSTEM_TAG_HTTP_ID = "sys_http";
export const SYSTEM_TAG_DEAD_LINK_ID = "sys_dead_link";
export const SYSTEM_TAG_DUPLICATE_ID = "sys_duplicate";

export const SYSTEM_TAGS = [
  { id: SYSTEM_TAG_HTTP_ID, name: "⚠️ HTTP", color: "#f59e0b", system: true },
  { id: SYSTEM_TAG_DEAD_LINK_ID, name: "⛔Dead link", color: "#ef4444", system: true },
  { id: SYSTEM_TAG_DUPLICATE_ID, name: "🎭Duplicate", color: "#a855f7", system: true }
];

const SYSTEM_TAG_ID_SET = new Set(SYSTEM_TAGS.map(tag => tag.id));
let systemBookmarkTags = {};

import { t } from "./i18n.js";

export let state = {
  groups: [],
  tags: [],
  sync: {
    enabled: false,
    lastSync: 0
  }
};

export function isStackItem(item) {
  return item?.type === "stack";
}

export function getAllGroupBookmarks(group, { includeDeleted = false } = {}) {
  const results = [];
  if (!group || !Array.isArray(group.items)) return results;

  for (const item of group.items) {
    if (!item) continue;
    if (isStackItem(item)) {
      if (item.deleted && !includeDeleted) continue;
      for (const child of (item.children || [])) {
        if (!child) continue;
        if (!includeDeleted && child.deleted) continue;
        results.push(child);
      }
    } else {
      if (!includeDeleted && item.deleted) continue;
      results.push(item);
    }
  }
  return results;
}

export function findBookmarkLocation(bookmarkId, targetGroup = null) {
  if (!bookmarkId) return null;
  const groups = targetGroup ? [targetGroup] : (state.groups || []);
  for (const group of groups) {
    if (!group || !Array.isArray(group.items)) continue;
    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i];
      if (!item) continue;
      if (item.id === bookmarkId) {
        return { group, item, parentStack: null, list: group.items, index: i };
      }
      if (isStackItem(item) && Array.isArray(item.children)) {
        const childIndex = item.children.findIndex(c => c && c.id === bookmarkId);
        if (childIndex !== -1) {
          return {
            group,
            item: item.children[childIndex],
            parentStack: item,
            list: item.children,
            index: childIndex
          };
        }
      }
    }
  }
  return null;
}

export function cleanupStackIfNeeded(group, stackItem) {
  if (!group || !Array.isArray(group.items) || !isStackItem(stackItem)) {
    return null;
  }

  const stackIndex = group.items.findIndex(i => i && i.id === stackItem.id);
  if (stackIndex === -1) return null;

  const children = Array.isArray(stackItem.children) ? stackItem.children.filter(Boolean) : [];
  stackItem.children = children;
  const activeChildren = children.filter(c => !c.deleted);
  const hasDeletedChildren = children.some(c => c.deleted);

  if (children.length === 0) {
    group.items.splice(stackIndex, 1);
    group.updatedAt = Date.now();
    return "removed";
  }

  if (!stackItem.deleted && children.length === 1 && activeChildren.length === 1 && !hasDeletedChildren) {
    const [soleChild] = children;
    soleChild.sectionId = stackItem.sectionId ?? null;
    soleChild.updatedAt = Date.now();
    group.items.splice(stackIndex, 1, soleChild);
    group.updatedAt = Date.now();
    return "unwrapped";
  }

  return "kept";
}

export function generateId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

export async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  window.dispatchEvent(new Event("speeddial:state-saved"));
}

export async function saveActiveGroupId(groupId) {
  try {
    await chrome.storage.local.set({ [ACTIVE_GROUP_KEY]: groupId });
  } catch (err) {
    console.warn("Failed to save active group id", err);
  }
}

export async function loadActiveGroupId() {
  try {
    const res = await chrome.storage.local.get(ACTIVE_GROUP_KEY);
    return res?.[ACTIVE_GROUP_KEY] || null;
  } catch (err) {
    console.warn("Failed to load active group id", err);
    return null;
  }
}

export function isReservedSystemTagName(name) {
  if (typeof name !== "string") return false;
  const normalized = name.trim().toLowerCase();
  return SYSTEM_TAGS.some(tag => tag.name.toLowerCase() === normalized);
}

export function getBookmarkSystemTagIds(bookmarkId) {
  if (!bookmarkId) return [];
  const tags = systemBookmarkTags[bookmarkId];
  return Array.isArray(tags) ? tags : [];
}

export function setBookmarkSystemTag(bookmarkId, systemTagId, enabled) {
  if (!bookmarkId || !SYSTEM_TAG_ID_SET.has(systemTagId)) return false;
  const current = Array.isArray(systemBookmarkTags[bookmarkId]) ? systemBookmarkTags[bookmarkId] : [];
  const hasTag = current.includes(systemTagId);

  if (enabled && !hasTag) {
    systemBookmarkTags[bookmarkId] = [...current, systemTagId];
    return true;
  }
  if (!enabled && hasTag) {
    const next = current.filter(id => id !== systemTagId);
    if (next.length > 0) {
      systemBookmarkTags[bookmarkId] = next;
    } else {
      delete systemBookmarkTags[bookmarkId];
    }
    return true;
  }
  return false;
}

export function clearSystemTagFromAllBookmarks(systemTagId) {
  if (!SYSTEM_TAG_ID_SET.has(systemTagId)) return 0;
  let cleared = 0;
  for (const bookmarkId of Object.keys(systemBookmarkTags)) {
    if (setBookmarkSystemTag(bookmarkId, systemTagId, false)) {
      cleared++;
    }
  }
  return cleared;
}

export async function loadSystemTags() {
  try {
    const res = await chrome.storage.local.get(SYSTEM_TAGS_KEY);
    const raw = res?.[SYSTEM_TAGS_KEY];
    const sanitized = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [bookmarkId, tagIds] of Object.entries(raw)) {
        if (!bookmarkId || !Array.isArray(tagIds)) continue;
        const validIds = [...new Set(tagIds.filter(id => SYSTEM_TAG_ID_SET.has(id)))];
        if (validIds.length > 0) {
          sanitized[bookmarkId] = validIds;
        }
      }
    }
    systemBookmarkTags = sanitized;
  } catch (err) {
    console.warn("Failed to load system tags", err);
    systemBookmarkTags = {};
  }
}

export async function saveSystemTags() {
  try {
    await chrome.storage.local.set({ [SYSTEM_TAGS_KEY]: systemBookmarkTags });
  } catch (err) {
    console.warn("Failed to save system tags", err);
  }
}

export async function loadState() {
  await loadSystemTags();
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY];

  if (stored) {
    // 🔥 Preserve reference — don't assign a new state object
    // Mutate the existing object
    state.groups = Array.isArray(stored.groups) ? stored.groups : [];
    state.tags = Array.isArray(stored.tags) ? stored.tags : [];

    state.sync.enabled = stored.sync?.enabled ?? false;
    state.sync.lastSync = stored.sync?.lastSync ?? 0;

    // If additional fields are added later, include them here
    for (const key of Object.keys(stored)) {
      if (key !== "groups" && key !== "tags" && key !== "sync") {
        state[key] = stored[key];
      }
    }
  }

  state.tags = Array.isArray(state.tags) ? state.tags : [];
  state.groups.forEach(group => {
    if (!group) return;
    if (!Array.isArray(group.items)) group.items = [];
    if (!Array.isArray(group.sections)) group.sections = [];
  });

  // 🔥 Initialize activeGroupId
  if (!window.activeGroupId) {
    const savedActiveGroupId = await loadActiveGroupId();
    const savedGroupStillValid = savedActiveGroupId
      && state.groups.some(g => g.id === savedActiveGroupId && !g.deleted);

    if (savedGroupStillValid) {
      window.activeGroupId = savedActiveGroupId;
    } else {
      const first = state.groups.find(g => !g.deleted);
      if (first) {
        window.activeGroupId = first.id;
      }
    }
  }

  // 🔥 If no groups exist → create default
  if (state.groups.length === 0) {
    const defaultGroup = {
      id: generateId("g"),
      name: t("defaultGroupName"),
      sections: [],
      items: [],
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };

    state.groups.push(defaultGroup);
    window.activeGroupId = defaultGroup.id;

    await saveState();
    await saveActiveGroupId(defaultGroup.id);
  }
}