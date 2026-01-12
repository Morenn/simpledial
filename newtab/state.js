export const STORAGE_KEY = "myspeeddial-data";
export const THEME_KEY = "myspeeddial-theme";

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

export async function loadState() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY];

  if (stored) {
    // 🔥 Zachovať referenciu — žiadne state = {...}
    // Mutujeme existujúci objekt
    state.groups = stored.groups ?? [];

    state.sync.enabled = stored.sync?.enabled ?? false;
    state.sync.lastSync = stored.sync?.lastSync ?? 0;

    // Ak v budúcnosti pribudnú ďalšie polia, doplníme ich sem
    for (const key of Object.keys(stored)) {
      if (key !== "groups" && key !== "sync") {
        state[key] = stored[key];
      }
    }
  }

  // 🔥 Inicializácia activeGroupId
  if (!window.activeGroupId) {
    const first = state.groups.find(g => !g.deleted);
    if (first) {
      window.activeGroupId = first.id;
    }
  }

  // 🔥 Ak nemáš žiadne skupiny → vytvor default
  if (state.groups.length === 0) {
    const defaultGroup = {
      id: generateId("g"),
      name: "Moje záložky",
      items: [],
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };

    state.groups.push(defaultGroup);
    window.activeGroupId = defaultGroup.id;

    await saveState();
  }
}
