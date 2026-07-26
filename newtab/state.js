export const STORAGE_KEY = "myspeeddial-data";
export const THEME_KEY = "myspeeddial-theme";
export const ACTIVE_GROUP_KEY = "myspeeddial-active-group";

import { t } from "./i18n.js";

export let state = {
  groups: [],
  sync: {
    enabled: false,
    lastSync: 0
  }
};

export function generateId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

export async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
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

export async function loadState() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY];

  if (stored) {
    // 🔥 Preserve reference — don't assign a new state object
    // Mutate the existing object
    state.groups = stored.groups ?? [];

    state.sync.enabled = stored.sync?.enabled ?? false;
    state.sync.lastSync = stored.sync?.lastSync ?? 0;

    // If additional fields are added later, include them here
    for (const key of Object.keys(stored)) {
      if (key !== "groups" && key !== "sync") {
        state[key] = stored[key];
      }
    }
  }

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