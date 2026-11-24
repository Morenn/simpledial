import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("data:text/javascript," + encodeURIComponent(`
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    return { url: new URL(specifier, context.parentURL).href, format: "module", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith("/newtab/render.js")) {
    return { format: "module", source: "export async function render() {}", shortCircuit: true };
  }
  if (url.startsWith("file:") && url.endsWith(".js")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`));

const CONFIG_KEY = "myspeeddial-config";
const DATA_KEY = "myspeeddial-data";
const BACKUPS_BOOKMARKS_KEY = "myspeeddial-backups";
const BACKUPS_CONFIG_KEY = "myspeeddial-backups-config";

const localStorageMap = new Map();

globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: { classList: { toggle() {}, add() {}, remove() {} }, style: { setProperty() {}, getPropertyValue: () => "" } }
};
globalThis.window = {
  dispatchEvent: () => {},
  addEventListener() {},
  removeEventListener() {}
};
globalThis.chrome = {
  runtime: { getURL: p => p },
  storage: {
    local: {
      async get(key) {
        if (Array.isArray(key)) {
          const out = {};
          for (const k of key) out[k] = structuredClone(localStorageMap.get(k));
          return out;
        }
        return { [key]: structuredClone(localStorageMap.get(key)) };
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          localStorageMap.set(key, structuredClone(value));
        }
      }
    }
  }
};

const { state } = await import("../newtab/state.js");
const { loadConfig, saveConfig, defaultConfig } = await import("../newtab/config.js");
const {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  cleanupOldBackups,
  runBackupInitCheck,
  getBackup,
  restoreBackupFromJson
} = await import("../newtab/backup.js");

function resetStore() {
  localStorageMap.clear();
  state.groups = [];
  state.tags = [];
}

test("bookmarks backup creates snapshot and restore disables sync while restoring groups and tags", async () => {
  resetStore();
  state.groups = [
    {
      id: "g1",
      name: "Work",
      items: [
        { id: "b1", title: "Docs", url: "https://docs.example", modified: 100 },
        {
          id: "s1",
          type: "stack",
          title: "Stack",
          children: [
            { id: "b2", title: "Sub1", url: "https://sub1.example", modified: 100 },
            { id: "b3", title: "Sub2", url: "https://sub2.example", modified: 100 }
          ]
        }
      ]
    }
  ];
  state.tags = [{ id: "t1", name: "dev", color: "#3b82f6" }];

  const entry = await createBackup("bookmarks");
  assert.match(entry.filename, /^speeddial-bookmarks-backup-\d{6}-\d{6}\.json$/);
  assert.equal(entry.groupCount, 1);
  assert.equal(entry.bookmarkCount, 3);

  // Mutate state & enable sync
  state.groups = [];
  state.tags = [];
  const cfg = structuredClone(defaultConfig);
  cfg.sync.enabled = true;
  cfg.browserBookmarksAutoSync = true;
  await saveConfig(cfg);

  const result = await restoreBackup(entry.filename, "bookmarks");
  assert.equal(result.ok, true);
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].items.length, 2);
  assert.equal(state.tags.length, 1);

  const afterConfig = await loadConfig();
  assert.equal(afterConfig.sync.enabled, false);
  assert.equal(afterConfig.browserBookmarksAutoSync, false);
});

test("config backup stores appearance (including customWidgets, excluding backgroundImage/sync) and restore preserves backgroundImage and sync", async () => {
  resetStore();
  const cfg = structuredClone(defaultConfig);
  cfg.appearance.theme = "spring";
  cfg.appearance.tileSize = 1.25;
  cfg.appearance.backgroundImage = "data:image/png;base64,OLD_IMAGE_DATA";
  cfg.appearance.customWidgets = [
    { id: "cw-old", type: "custom-search", name: "Old" },
    { id: "cw-rest", type: "rest-status", name: "PVE", endpointUrl: "https://pve.local/api", authHeaderName: "Authorization", authHeaderValue: "enc:v1:iv123:ct456" }
  ];
  cfg.sync.enabled = true;
  cfg.sync.type = "webdav";
  cfg.sync.serverUrl = "https://sync.example/dav/bookmarks.json";
  cfg.sync.password = "top-secret";
  await saveConfig(cfg);

  const entry = await createBackup("config");
  assert.match(entry.filename, /^speeddial-config-backup-\d{6}-\d{6}\.json$/);
  assert.equal(entry.theme, "spring");
  assert.ok(entry.settingCount > 0);

  const parsedPayload = JSON.parse(entry.data);
  assert.ok(parsedPayload.appearance);
  assert.equal(parsedPayload.appearance.theme, "spring");
  assert.equal(parsedPayload.appearance.tileSize, 1.25);
  assert.equal(parsedPayload.appearance.backgroundImage, undefined);
  assert.deepEqual(parsedPayload.appearance.customWidgets, [
    { id: "cw-old", type: "custom-search", name: "Old" },
    { id: "cw-rest", type: "rest-status", name: "PVE", endpointUrl: "https://pve.local/api", authHeaderName: "Authorization", authHeaderValue: "", hadSecret: true }
  ]);
  assert.equal(parsedPayload.vaultHeader, undefined);
  assert.equal(parsedPayload.sync, undefined);
  assert.equal(parsedPayload.backups, undefined);

  // Mutate appearance, backgroundImage, customWidgets, and sync settings
  const mutated = await loadConfig();
  mutated.appearance.theme = "winter";
  mutated.appearance.tileSize = 0.8;
  mutated.appearance.backgroundImage = "data:image/png;base64,CURRENT_IMAGE_DATA";
  mutated.appearance.customWidgets = [{ id: "cw-current", type: "timezone", name: "UTC" }];
  mutated.sync.serverUrl = "https://new-sync.example/dav/bookmarks.json";
  await saveConfig(mutated);

  const result = await restoreBackup(entry.filename, "config");
  assert.equal(result.ok, true);
  assert.equal(result.type, "config");
  assert.equal(result.secretsRemoved, true);

  const restored = await loadConfig();
  assert.equal(restored.appearance.theme, "spring");
  assert.equal(restored.appearance.tileSize, 1.25);
  assert.deepEqual(restored.appearance.customWidgets, [
    { id: "cw-old", type: "custom-search", name: "Old" },
    { id: "cw-rest", type: "rest-status", name: "PVE", endpointUrl: "https://pve.local/api", authHeaderName: "Authorization", authHeaderValue: "" }
  ]);
  // Current backgroundImage and sync settings must remain untouched
  assert.equal(restored.appearance.backgroundImage, "data:image/png;base64,CURRENT_IMAGE_DATA");
  assert.equal(restored.sync.enabled, true);
  assert.equal(restored.sync.type, "webdav");
  assert.equal(restored.sync.serverUrl, "https://new-sync.example/dav/bookmarks.json");
  assert.equal(restored.sync.password, "top-secret");
});

test("automatic backup creates bookmarks and config on init, skips unchanged within interval, and cleans up expired entries", async () => {
  resetStore();
  const cfg = structuredClone(defaultConfig);
  cfg.backups.frequencyHours = 24;
  cfg.backups.retentionDays = 14;
  await saveConfig(cfg);

  await runBackupInitCheck();

  assert.equal((await listBackups("bookmarks")).length, 1);
  assert.equal((await listBackups("config")).length, 1);

  // Second immediate check should not create duplicates
  await runBackupInitCheck();
  assert.equal((await listBackups("bookmarks")).length, 1);
  assert.equal((await listBackups("config")).length, 1);

  // Even after interval expires, unchanged state should not create new backups
  const expiredLastAuto = Date.now() - (48 * 60 * 60 * 1000);
  const cfgAfterInit = await loadConfig();
  cfgAfterInit.backups.lastAutoBackup = expiredLastAuto;
  cfgAfterInit.backups.lastAutoBackupByType = {
    bookmarks: expiredLastAuto,
    config: expiredLastAuto
  };
  await saveConfig(cfgAfterInit);
  for (const key of [BACKUPS_BOOKMARKS_KEY, BACKUPS_CONFIG_KEY]) {
    const existing = localStorageMap.get(key) || [];
    if (existing[0]) existing[0].timestamp = expiredLastAuto;
    localStorageMap.set(key, existing);
  }
  await runBackupInitCheck();
  assert.equal((await listBackups("bookmarks")).length, 1);
  assert.equal((await listBackups("config")).length, 1);

  // Mutating bookmarks & config after interval should create new backups only for changed types
  state.groups = [{ id: "g-changed", name: "Changed", items: [] }];
  const cfgMutated = await loadConfig();
  cfgMutated.appearance.theme = "summer";
  cfgMutated.backups.lastAutoBackup = expiredLastAuto;
  cfgMutated.backups.lastAutoBackupByType = {
    bookmarks: expiredLastAuto,
    config: expiredLastAuto
  };
  await saveConfig(cfgMutated);
  await runBackupInitCheck();
  assert.equal((await listBackups("bookmarks")).length, 2);
  assert.equal((await listBackups("config")).length, 2);

  // Inject an expired backup (40 days old) into bookmarks and config and run cleanupOldBackups
  const oldTs = Date.now() - (40 * 24 * 60 * 60 * 1000);
  for (const key of [BACKUPS_BOOKMARKS_KEY, BACKUPS_CONFIG_KEY]) {
    const existing = localStorageMap.get(key) || [];
    existing.push({ filename: "old-expired.json", timestamp: oldTs, sizeBytes: 10, data: "{}" });
    localStorageMap.set(key, existing);
  }

  const removed = await cleanupOldBackups(14);
  assert.equal(removed, 2);
  assert.equal((await listBackups("bookmarks")).length, 2);
  assert.equal((await listBackups("config")).length, 2);
});

test("cleanupOldBackups keeps at least the newest backup even when all backups exceed retentionDays", async () => {
  resetStore();
  const olderTs = Date.now() - (40 * 24 * 60 * 60 * 1000);
  const newestExpiredTs = Date.now() - (20 * 24 * 60 * 60 * 1000);
  localStorageMap.set(BACKUPS_BOOKMARKS_KEY, [
    { filename: "backup-oldest.json", timestamp: olderTs, sizeBytes: 10, data: "{}" },
    { filename: "backup-newest-expired.json", timestamp: newestExpiredTs, sizeBytes: 10, data: "{}" }
  ]);

  const removed = await cleanupOldBackups(14, "bookmarks");
  assert.equal(removed, 1);
  const remaining = await listBackups("bookmarks");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].filename, "backup-newest-expired.json");
});

test("deleteBackup and getBackup operate per type and throw on missing entries", async () => {
  resetStore();
  const entry = await createBackup("config");
  const fetched = await getBackup(entry.filename, "config");
  assert.equal(fetched.filename, entry.filename);

  // Should not exist in bookmarks store
  await assert.rejects(() => getBackup(entry.filename, "bookmarks"), /backup-not-found/);
  await assert.rejects(() => deleteBackup(entry.filename, "bookmarks"), /backup-not-found/);

  const deleted = await deleteBackup(entry.filename, "config");
  assert.equal(deleted.ok, true);
  assert.equal((await listBackups("config")).length, 0);
});

test("restoreBackupFromJson auto-detects and restores uploaded bookmarks and config backups", async () => {
  resetStore();
  const bmJson = JSON.stringify({
    groups: [{ id: "g-up", name: "Uploaded", items: [{ id: "b-up", title: "Site", url: "https://site.example" }] }],
    tags: [{ id: "t-up", name: "Tag" }]
  });
  const bmRes = await restoreBackupFromJson(bmJson, "auto", "uploaded-bm.json");
  assert.equal(bmRes.ok, true);
  assert.equal(bmRes.type, "bookmarks");
  assert.equal(state.groups[0].name, "Uploaded");
  assert.equal(state.tags[0].name, "Tag");

  const cfgJson = JSON.stringify({
    appearance: {
      theme: "autumn",
      tileOpacity: 0.7,
      customWidgets: []
    }
  });
  const cfgRes = await restoreBackupFromJson(cfgJson, "auto", "uploaded-cfg.json");
  assert.equal(cfgRes.ok, true);
  assert.equal(cfgRes.type, "config");
  assert.equal(cfgRes.config.appearance.theme, "autumn");

  await assert.rejects(() => restoreBackupFromJson("{bad", "auto"), /invalid-backup-json/);
  await assert.rejects(() => restoreBackupFromJson("{}", "auto"), /invalid-backup-structure/);
});

test("restoreBackupFromJson serializes with in-flight syncNow so restored data and disabled sync are not clobbered", async () => {
  const { syncNow } = await import("../newtab/sync.js");
  localStorageMap.clear();

  const cfg = structuredClone(defaultConfig);
  cfg.sync.enabled = true;
  cfg.sync.type = "direct";
  cfg.sync.serverUrl = "https://sync.example/bookmarks.json";
  cfg.sync.intervalMode = "immediate";
  cfg.sync.lastSync = 100;
  await saveConfig(cfg);

  state.groups = [
    {
      id: "g1",
      name: "Local",
      sections: [],
      items: [{ id: "b_local", title: "Local", url: "https://local.example", updatedAt: 100, deleted: false, deletedAt: null }],
      updatedAt: 100,
      deleted: false,
      deletedAt: null
    }
  ];
  state.tags = [];

  const originalFetch = globalThis.fetch;
  let releaseGet;
  let pausedOnce = false;
  const getStarted = new Promise(resolve => {
    globalThis.fetch = async (_url, init = {}) => {
      const method = (init.method || "GET").toUpperCase();
      if (method === "GET" && !pausedOnce) {
        pausedOnce = true;
        resolve();
        await new Promise(r => { releaseGet = r; });
      }
      if (method === "GET") {
        return new Response(JSON.stringify({
          groups: [
            {
              id: "g1",
              name: "Cloud",
              sections: [],
              items: [{ id: "b_cloud", title: "Cloud", url: "https://cloud.example", updatedAt: 200, deleted: false, deletedAt: null }],
              updatedAt: 200,
              deleted: false,
              deletedAt: null
            }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("", { status: 200 });
    };
  });

  try {
    const syncPromise = syncNow();
    await getStarted;

    const restorePromise = restoreBackupFromJson(
      JSON.stringify({
        groups: [
          {
            id: "g_restored",
            name: "Restored",
            sections: [],
            items: [{ id: "b_restored", title: "Restored", url: "https://restored.example", updatedAt: 50, deleted: false, deletedAt: null }],
            updatedAt: 50,
            deleted: false,
            deletedAt: null
          }
        ],
        tags: []
      }),
      "bookmarks",
      "restore-race.json"
    );

    releaseGet();
    const [syncRes, restoreRes] = await Promise.all([syncPromise, restorePromise]);

    assert.equal(syncRes.ok, true);
    assert.equal(restoreRes.ok, true);
    const afterConfig = await loadConfig();
    assert.equal(afterConfig.sync.enabled, false);
    assert.deepEqual(state.groups.map(g => g.id), ["g_restored"]);
    assert.deepEqual(state.groups[0].items.map(i => i.id), ["b_restored"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
