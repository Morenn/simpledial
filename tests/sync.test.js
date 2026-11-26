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
  if (url.startsWith("file:") && url.endsWith(".js")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`));

const CONFIG_KEY = "myspeeddial-config";
const DATA_KEY = "myspeeddial-data";
const localStorage = new Map();
let remoteGroups = [];
let remoteTags = [];
let afterNextWrite = null;
let failNextWrite = false;
let httpServer = null;
let httpRequests = [];
let fetchRemote = null;

globalThis.document = { getElementById: () => null };
globalThis.window = { dispatchEvent: () => {} };
globalThis.fetch = (...args) => {
  if (!fetchRemote) {
    throw new Error("Unexpected HTTP request in test");
  }
  return fetchRemote(...args);
};
globalThis.chrome = {
  runtime: { getURL: path => path },
  storage: {
    local: {
      async get(key) {
        return { [key]: localStorage.get(key) };
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          localStorage.set(key, structuredClone(value));
        }
      }
    },
    sync: {
      async get(key) {
        const payload = remoteTags.length > 0
          ? { groups: structuredClone(remoteGroups), tags: structuredClone(remoteTags) }
          : { groups: structuredClone(remoteGroups) };
        return { [key]: payload };
      },
      async set(values) {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("storage quota exceeded");
        }

        remoteGroups = structuredClone(values[DATA_KEY].groups);
        remoteTags = Array.isArray(values[DATA_KEY].tags)
          ? structuredClone(values[DATA_KEY].tags)
          : [];
        if (afterNextWrite) {
          const mutate = afterNextWrite;
          afterNextWrite = null;
          remoteGroups = mutate(structuredClone(remoteGroups));
        }
      }
    }
  }
};

const [{
  state,
  SYSTEM_TAG_HTTP_ID,
  SYSTEM_TAG_DEAD_LINK_ID,
  getBookmarkSystemTagIds,
  setBookmarkSystemTag,
  clearSystemTagFromAllBookmarks,
  saveSystemTags,
  pruneOrphanedSystemTags,
  applySystemTagsFromStorageChange,
  isReservedSystemTagName,
  getTagUsageCounts,
  updateTagInState,
  deleteTagFromState,
  removeUnusedTagsFromState
}, { syncNow, syncWrite, syncForceUpload, syncForceDownload, syncWebdavFolderExtras }, { shouldSync, getSyncIntervalMs }] = await Promise.all([
  import("../newtab/state.js"),
  import("../newtab/sync.js"),
  import("../newtab/config.js")
]);

function item(id, title, updatedAt = 100) {
  return { id, title, url: `https://${id}.example`, updatedAt, deleted: false, deletedAt: null };
}

function group(items, id = "g_main") {
  return {
    id,
    name: "Main",
    items,
    updatedAt: 1,
    deleted: false,
    deletedAt: null
  };
}

function browserConfig(lastSyncedLocalHash = "") {
  return {
    sync: {
      enabled: true,
      type: "browser",
      serverUrl: "",
      intervalMode: "immediate",
      lastSync: 0,
      lastSyncedLocalHash,
      remoteChangeHeaderType: null,
      lastSeenRemoteMarker: "",
      lastRemoteMarkerCheck: 0,
      lastMarkerCheckUrl: ""
    }
  };
}

function httpConfig(type, overrides = {}) {
  return {
    sync: {
      ...browserConfig().sync,
      type,
      serverUrl: type === "webdav"
        ? "davs://sync.example/remote.php/dav/bookmarks.json"
        : "https://sync.example/bookmarks.json",
      ...overrides
    }
  };
}

function markerHeaders() {
  if (!httpServer.markerType) return {};
  const header = {
    sha256: "X-JSON-SHA256",
    etag: "ETag",
    "last-modified": "Last-Modified"
  }[httpServer.markerType];
  return { [header]: httpServer.markerValue };
}

function installHttpServer({ groups = [], tags = undefined, dbuid = undefined, tombstones = undefined, tombstonePrunedBefore = undefined, markerType = null, markerValue = "", failReads = 0, failWrites = 0 } = {}) {
  httpServer = {
    groups: structuredClone(groups),
    tags: tags !== undefined ? structuredClone(tags) : undefined,
    dbuid,
    tombstones: tombstones !== undefined ? structuredClone(tombstones) : undefined,
    tombstonePrunedBefore,
    markerType,
    markerValue,
    failReads,
    failWrites
  };
  httpRequests = [];
  fetchRemote = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    httpRequests.push({ url, method, headers: init.headers || {} });

    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: markerHeaders() });
    }

    if (method === "GET") {
      if (httpServer.failReads > 0) {
        httpServer.failReads--;
        return new Response("Unavailable", { status: 503 });
      }
      const payload = { groups: httpServer.groups };
      if (httpServer.tags !== undefined) payload.tags = httpServer.tags;
      if (httpServer.dbuid !== undefined) payload.dbuid = httpServer.dbuid;
      if (httpServer.tombstones !== undefined) payload.tombstones = httpServer.tombstones;
      if (httpServer.tombstonePrunedBefore !== undefined) payload.tombstonePrunedBefore = httpServer.tombstonePrunedBefore;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json", ...markerHeaders() }
      });
    }

    if (method === "PUT") {
      if (httpServer.failWrites > 0) {
        httpServer.failWrites--;
        return new Response("Unavailable", { status: 503 });
      }
      const parsed = JSON.parse(init.body);
      httpServer.groups = parsed.groups;
      if (parsed.tags !== undefined) {
        httpServer.tags = parsed.tags;
      }
      httpServer.dbuid = parsed.dbuid;
      httpServer.tombstones = parsed.tombstones;
      httpServer.tombstonePrunedBefore = parsed.tombstonePrunedBefore;
      if (httpServer.markerType === "etag") {
        httpServer.markerValue = `"v${Number.parseInt(httpServer.markerValue.match(/\d+/)?.[0] || "0", 10) + 1}"`;
      } else if (httpServer.markerType === "sha256") {
        httpServer.markerValue = String(Number.parseInt(httpServer.markerValue || "0", 16) + 1).padStart(64, "0");
      }
      return new Response(null, { status: 200 });
    }

    return new Response("Method not allowed", { status: 405 });
  };
}

function stableSerializeForTest(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeForTest).join(",")}]`;
  }
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerializeForTest(value[key])}`).join(",")}}`;
}

async function hashGroups(groups) {
  const bytes = new TextEncoder().encode(stableSerializeForTest(groups));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function setClient(groups, config = browserConfig(), tags = []) {
  state.groups = structuredClone(groups);
  state.tags = structuredClone(tags);
  localStorage.set(CONFIG_KEY, structuredClone(config));
}

function readStoredConfig() {
  return localStorage.get(CONFIG_KEY);
}

test.beforeEach(() => {
  localStorage.clear();
  remoteGroups = [];
  remoteTags = [];
  afterNextWrite = null;
  failNextWrite = false;
  httpServer = null;
  httpRequests = [];
  fetchRemote = null;
  state.groups = [];
  state.tags = [];
});

test("sync merges a local-only edit with data already stored remotely", async () => {
  const existing = item("remote", "Remote");
  const localEdit = item("local", "Local");
  remoteGroups = [group([existing])];
  setClient([group([existing, localEdit])]);

  const result = await syncNow();

  assert.equal(result.ok, true);
  assert.deepEqual(remoteGroups[0].items.map(entry => entry.id).sort(), ["local", "remote"]);
  assert.ok(readStoredConfig().sync.lastSyncedLocalHash);
});

test("sequential clients preserve distinct edits in shared browser sync storage", async () => {
  const baseline = item("base", "Base");
  remoteGroups = [group([baseline])];

  setClient([group([baseline, item("client-a", "A")])]);
  assert.equal((await syncNow()).ok, true);

  setClient([group([baseline, item("client-b", "B")])]);
  assert.equal((await syncNow()).ok, true);

  assert.deepEqual(
    remoteGroups[0].items.map(entry => entry.id).sort(),
    ["base", "client-a", "client-b"]
  );
});

test("native sync retries merge after a concurrent client overwrites its snapshot", async () => {
  const base = item("base", "Base");
  const concurrentEdit = item("other-client", "Concurrent");
  const localEdit = item("this-client", "Local");
  remoteGroups = [group([base])];
  setClient([group([base, localEdit])]);
  afterNextWrite = () => [group([base, concurrentEdit])];

  const result = await syncNow();

  assert.equal(result.ok, true);
  assert.deepEqual(
    remoteGroups[0].items.map(entry => entry.id).sort(),
    ["base", "other-client", "this-client"]
  );
});

test("same-timestamp conflicts resolve identically regardless of client role", async () => {
  const alpha = item("shared", "Alpha", 500);
  const beta = item("shared", "Beta", 500);

  remoteGroups = [group([beta])];
  setClient([group([alpha])]);
  assert.equal((await syncNow()).ok, true);
  const firstResult = remoteGroups[0].items[0];

  remoteGroups = [group([alpha])];
  setClient([group([beta])]);
  assert.equal((await syncNow()).ok, true);
  const secondResult = remoteGroups[0].items[0];

  assert.equal(firstResult.title, secondResult.title);
});

test("storage failure reports sync failure and does not advance local sync fingerprint", async () => {
  const existing = item("remote", "Remote");
  const localEdit = item("local", "Local");
  remoteGroups = [group([existing])];
  setClient([group([existing, localEdit])]);
  failNextWrite = true;

  const result = await syncNow();

  assert.equal(result.ok, false);
  assert.equal(readStoredConfig().sync.lastSyncedLocalHash, "");
  assert.equal(remoteGroups[0].items.some(entry => entry.id === "local"), false);
});

for (const provider of ["direct", "webdav"]) {
  test(`${provider} provider merges local changes and writes to the configured endpoint`, async () => {
    const remoteItem = item("remote", "Remote");
    const localItem = item("local", "Local");
    installHttpServer({ groups: [group([remoteItem])] });
    setClient([group([remoteItem, localItem])], httpConfig(provider));

    const result = await syncNow();

    assert.equal(result.ok, true);
    assert.deepEqual(httpServer.groups[0].items.map(entry => entry.id).sort(), ["local", "remote"]);
    assert.equal(httpRequests.some(request => request.method === "PUT"), true);
    assert.ok(httpRequests.every(request => request.url.startsWith(
      provider === "webdav" ? "https://sync.example/" : "https://sync.example/"
    )));
    if (provider === "webdav") {
      assert.ok(httpRequests.every(request => request.headers["OCS-APIRequest"] === "true"));
      assert.ok(httpRequests.every(request => request.headers["X-Requested-With"] === "XMLHttpRequest"));
    }
  });
}

for (const provider of ["direct", "webdav"]) {
  for (const [markerType, markerValue] of [
    ["sha256", "a".repeat(64)],
    ["etag", '"version-1"']
  ]) {
    test(`${provider} skips unchanged ${markerType} when local state matches the last sync`, async () => {
      const groups = [group([item("same", "Same")])];
      installHttpServer({ groups, markerType, markerValue });
      const config = httpConfig(provider, {
        lastSyncedLocalHash: await hashGroups(groups),
        remoteChangeHeaderType: markerType,
        lastSeenRemoteMarker: markerValue,
        lastMarkerCheckUrl: `${provider}::${provider === "webdav" ? "davs://sync.example/remote.php/dav/bookmarks.json" : "https://sync.example/bookmarks.json"}`
      });
      setClient(groups, config);

      const result = await syncNow();

      assert.deepEqual(result, { ok: true, reason: "remote-marker-unchanged", changed: false });
      assert.deepEqual(httpRequests.map(request => request.method), ["HEAD"]);
    });
  }
}

for (const provider of ["direct", "webdav"]) {
  for (const [markerType, markerValue] of [
    ["etag", 'W/"version-1"'],
    ["last-modified", "Wed, 21 Oct 2015 07:28:00 GMT"],
    [null, ""]
  ]) {
    test(`${provider} performs a full read with ${markerType || "no marker"}`, async () => {
      const groups = [group([item("same", "Same")])];
      installHttpServer({ groups, markerType, markerValue });
      const config = httpConfig(provider, {
        lastSyncedLocalHash: await hashGroups(groups),
        remoteChangeHeaderType: markerType,
        lastSeenRemoteMarker: markerValue,
        lastMarkerCheckUrl: `${provider}::${provider === "webdav" ? "davs://sync.example/remote.php/dav/bookmarks.json" : "https://sync.example/bookmarks.json"}`
      });
      setClient(groups, config);

      const result = await syncNow();

      assert.equal(result.ok, true);
      assert.equal(httpRequests.some(request => request.method === "GET"), true);
      assert.equal(httpRequests.some(request => request.method === "PUT"), false);
    });
  }
}

for (const provider of ["direct", "webdav"]) {
  test(`${provider} does not commit a changed marker when the subsequent read fails`, async () => {
    const groups = [group([item("local", "Local")])];
    installHttpServer({
      groups: [],
      markerType: "etag",
      markerValue: '"version-2"',
      failReads: 1
    });
    const config = httpConfig(provider, {
      lastSyncedLocalHash: await hashGroups(groups),
      remoteChangeHeaderType: "etag",
      lastSeenRemoteMarker: '"version-1"',
      lastMarkerCheckUrl: `${provider}::${provider === "webdav" ? "davs://sync.example/remote.php/dav/bookmarks.json" : "https://sync.example/bookmarks.json"}`
    });
    setClient(groups, config);

    const result = await syncNow();

    assert.equal(result.ok, false);
    assert.equal(readStoredConfig().sync.lastSeenRemoteMarker, '"version-1"');
  });
}

for (const provider of ["direct", "webdav"]) {
  test(`${provider} downloads remote changes after the marker changes`, async () => {
    const localItem = item("local", "Local");
    const remoteItem = item("remote", "Remote", 200);
    const groups = [group([localItem])];
    installHttpServer({
      groups: [group([localItem, remoteItem])],
      markerType: "etag",
      markerValue: '"version-2"'
    });
    const config = httpConfig(provider, {
      lastSyncedLocalHash: await hashGroups(groups),
      remoteChangeHeaderType: "etag",
      lastSeenRemoteMarker: '"version-1"',
      lastMarkerCheckUrl: `${provider}::${provider === "webdav" ? "davs://sync.example/remote.php/dav/bookmarks.json" : "https://sync.example/bookmarks.json"}`
    });
    setClient(groups, config);

    const result = await syncNow();

    assert.equal(result.ok, true);
    assert.deepEqual(state.groups[0].items.map(entry => entry.id).sort(), ["local", "remote"]);
    assert.equal(readStoredConfig().sync.lastSeenRemoteMarker, '"version-2"');
    assert.equal(httpRequests.some(request => request.method === "GET"), true);
    assert.equal(httpRequests.some(request => request.method === "PUT"), false);
  });
}

for (const provider of ["direct", "webdav"]) {
  test(`${provider} preserves pending local edits when remote PUT fails`, async () => {
    const localItem = item("local", "Local");
    installHttpServer({
      groups: [],
      markerType: "etag",
      markerValue: '"version-2"',
      failWrites: 1
    });
    const config = httpConfig(provider, {
      lastSyncedLocalHash: "",
      remoteChangeHeaderType: "etag",
      lastSeenRemoteMarker: '"version-1"',
      lastMarkerCheckUrl: `${provider}::${provider === "webdav" ? "davs://sync.example/remote.php/dav/bookmarks.json" : "https://sync.example/bookmarks.json"}`
    });
    setClient([group([localItem])], config);

    const result = await syncNow();

    assert.equal(result.ok, false);
    assert.equal(state.groups[0].items[0].id, "local");
    assert.equal(readStoredConfig().sync.lastSyncedLocalHash, "");
    assert.equal(readStoredConfig().sync.lastSeenRemoteMarker, '"version-1"');
  });
}

test("sync interval policy supports immediate, manual, and migrates legacy custom/default to immediate", () => {
  const now = Date.now();
  const config = { sync: { intervalMode: "immediate", lastSync: now } };
  assert.equal(shouldSync(config), true);
  assert.equal(getSyncIntervalMs(config), 0);

  config.sync.intervalMode = "custom";
  assert.equal(shouldSync(config), true);
  assert.equal(getSyncIntervalMs(config), 0);

  config.sync.intervalMode = "default";
  assert.equal(shouldSync(config), true);
  assert.equal(getSyncIntervalMs(config), 0);

  config.sync.intervalMode = "manual";
  assert.equal(shouldSync(config), false);
  assert.equal(getSyncIntervalMs(config), -1);
});

test("sync preserves and merges group and bookmark customIcon, tileColor, colorFromIcon, and notes", async () => {
  const remoteBookmark = {
    ...item("bm-remote", "Remote Bookmark", 150),
    customIcon: "https://remote.example/icon.png",
    notes: "Remote note",
    tileColor: "#3355ff",
    colorFromIcon: true
  };
  const remoteGroup = {
    id: "g_custom",
    name: "AI Tools",
    iconEmoji: "🤖",
    customIcon: "https://remote.example/group.png",
    tileColor: "#ff6600",
    colorFromIcon: true,
    items: [remoteBookmark],
    updatedAt: 200,
    deleted: false,
    deletedAt: null
  };
  const localNewerBookmark = {
    ...item("bm-local", "Local Edited", 300),
    customIcon: "https://example.com/icon.png",
    notes: "Updated note",
    tileColor: "#12ab34",
    colorFromIcon: false
  };
  const localStaleRemoteBookmark = {
    ...item("bm-remote", "Stale Bookmark", 100),
    customIcon: null,
    notes: null,
    tileColor: null,
    colorFromIcon: false
  };
  const localGroup = {
    id: "g_custom",
    name: "AI Tools Old",
    iconEmoji: null,
    customIcon: null,
    tileColor: null,
    colorFromIcon: false,
    items: [localStaleRemoteBookmark, localNewerBookmark],
    updatedAt: 100,
    deleted: false,
    deletedAt: null
  };

  // Browser sync merge check
  remoteGroups = [structuredClone(remoteGroup)];
  setClient([structuredClone(localGroup)]);
  const browserResult = await syncNow();
  assert.equal(browserResult.ok, true);
  assert.equal(remoteGroups[0].iconEmoji, "🤖");
  assert.equal(remoteGroups[0].customIcon, "https://remote.example/group.png");
  assert.equal(remoteGroups[0].tileColor, "#ff6600");
  assert.equal(remoteGroups[0].colorFromIcon, true);
  const browserMergedRemoteBm = remoteGroups[0].items.find(entry => entry.id === "bm-remote");
  const browserMergedLocalBm = remoteGroups[0].items.find(entry => entry.id === "bm-local");
  assert.equal(browserMergedRemoteBm.customIcon, "https://remote.example/icon.png");
  assert.equal(browserMergedRemoteBm.notes, "Remote note");
  assert.equal(browserMergedRemoteBm.tileColor, "#3355ff");
  assert.equal(browserMergedRemoteBm.colorFromIcon, true);
  assert.equal(browserMergedLocalBm.customIcon, "https://example.com/icon.png");
  assert.equal(browserMergedLocalBm.notes, "Updated note");
  assert.equal(browserMergedLocalBm.tileColor, "#12ab34");
  assert.equal(browserMergedLocalBm.colorFromIcon, false);

  // HTTP sync checks (direct & webdav)
  for (const provider of ["direct", "webdav"]) {
    installHttpServer({ groups: [structuredClone(remoteGroup)] });
    setClient([structuredClone(localGroup)], httpConfig(provider));
    const httpResult = await syncNow();
    assert.equal(httpResult.ok, true);
    assert.equal(httpServer.groups[0].iconEmoji, "🤖");
    assert.equal(httpServer.groups[0].customIcon, "https://remote.example/group.png");
    assert.equal(httpServer.groups[0].tileColor, "#ff6600");
    assert.equal(httpServer.groups[0].colorFromIcon, true);
    const httpRemoteBm = httpServer.groups[0].items.find(entry => entry.id === "bm-remote");
    const httpLocalBm = httpServer.groups[0].items.find(entry => entry.id === "bm-local");
    assert.equal(httpRemoteBm.notes, "Remote note");
    assert.equal(httpRemoteBm.tileColor, "#3355ff");
    assert.equal(httpLocalBm.customIcon, "https://example.com/icon.png");
    assert.equal(httpLocalBm.notes, "Updated note");
    assert.equal(httpLocalBm.tileColor, "#12ab34");
    assert.equal(httpLocalBm.colorFromIcon, false);
  }
});

test("browser sync merges sections, item.sectionId, state.tags, and item.tags across clients", async () => {
  const secRemote = { id: "sec_remote", title: "Remote Section", order: 0, updatedAt: 150, deleted: false, deletedAt: null };
  const secLocal = { id: "sec_local", title: "Local Section", order: 1, updatedAt: 200, deleted: false, deletedAt: null };

  const remoteGroup = {
    ...group([{ ...item("b1", "B1", 200), sectionId: "sec_remote", tags: ["tag_shared"] }]),
    sections: [secRemote]
  };
  const localGroup = {
    ...group([{ ...item("b2", "B2", 250), sectionId: "sec_local", tags: ["tag_local"] }]),
    sections: [secLocal]
  };

  remoteGroups = [remoteGroup];
  remoteTags = [
    { id: "tag_shared", name: "Shared", color: "#10b981", updatedAt: 150, deleted: false, deletedAt: null },
    { id: "tag_del", name: "Obsolete", color: "#ef4444", updatedAt: 250, deleted: true, deletedAt: 250 }
  ];

  const localTags = [
    { id: "tag_del", name: "Obsolete", color: "#ef4444", updatedAt: 100, deleted: false, deletedAt: null },
    { id: "tag_local", name: "Work", color: "#3b82f6", updatedAt: 220, deleted: false, deletedAt: null }
  ];

  setClient([localGroup], browserConfig(), localTags);
  await syncNow();

  assert.deepEqual(
    state.groups[0].sections.filter(s => !s.deleted).map(s => s.id).sort(),
    ["sec_local", "sec_remote"]
  );

  const byId = new Map(state.groups[0].items.map(bm => [bm.id, bm]));
  assert.equal(byId.get("b1").sectionId, "sec_remote");
  assert.deepEqual(byId.get("b1").tags, ["tag_shared"]);
  assert.equal(byId.get("b2").sectionId, "sec_local");
  assert.deepEqual(byId.get("b2").tags, ["tag_local"]);

  const tagById = new Map(state.tags.map(t => [t.id, t]));
  assert.equal(tagById.get("tag_shared").deleted, false);
  assert.equal(tagById.get("tag_local").deleted, false);
  assert.equal(tagById.get("tag_del").deleted, true);
  assert.equal(remoteTags.length, 3);
});

test("HTTP sync merges stack items and handles moving a bookmark out of a stack without duplication", async () => {
  const secMain = { id: "sec_1", title: "Tools", order: 0, updatedAt: 100, deleted: false, deletedAt: null };
  const remoteStack = {
    id: "st_1",
    type: "stack",
    title: "Dev Stack",
    sectionId: null,
    children: [
      item("b1", "B1 Updated", 300),
      item("b3", "B3", 100)
    ],
    updatedAt: 350,
    deleted: false,
    deletedAt: null
  };
  const remoteMovedOut = { ...item("b2", "B2 Moved", 400), sectionId: "sec_1" };

  installHttpServer({
    groups: [{ ...group([remoteStack, remoteMovedOut]), sections: [secMain] }],
    tags: [{ id: "t1", name: "Dev", color: "#8b5cf6", updatedAt: 100, deleted: false, deletedAt: null }]
  });

  const localStack = {
    id: "st_1",
    type: "stack",
    title: "Dev Stack",
    sectionId: null,
    children: [
      item("b1", "B1 Old", 100),
      item("b2", "B2 Moved", 100),
      item("b3", "B3", 100),
      item("b4", "B4 Local", 420)
    ],
    updatedAt: 420,
    deleted: false,
    deletedAt: null
  };

  setClient(
    [{ ...group([localStack]), sections: [secMain] }],
    httpConfig("direct"),
    [{ id: "t1", name: "Dev", color: "#8b5cf6", updatedAt: 100, deleted: false, deletedAt: null }]
  );

  await syncNow();

  const mergedTop = state.groups[0].items;
  const mergedStack = mergedTop.find(entry => entry.id === "st_1");
  const movedOutItem = mergedTop.find(entry => entry.id === "b2");

  assert.ok(mergedStack);
  assert.equal(mergedStack.type, "stack");
  assert.ok(movedOutItem);
  assert.equal(movedOutItem.sectionId, "sec_1");

  const stackChildIds = mergedStack.children.map(c => c.id);
  assert.deepEqual(stackChildIds, ["b1", "b3", "b4"]);
  assert.equal(mergedStack.children.find(c => c.id === "b1").title, "B1 Updated");
  assert.equal(stackChildIds.includes("b2"), false);
});


test("syncWrite with purgedIds permanently deletes bookmarks, stacks, and groups across browser and HTTP sync", async () => {
  const bKeep = { ...item("b_keep", "Keep", 100), deleted: false, deletedAt: null };
  const bDel = { ...item("b_del", "Delete Me", 200), deleted: true, deletedAt: 200 };
  const stackDel = {
    id: "st_del",
    type: "stack",
    title: "Deleted Stack",
    sectionId: null,
    children: [
      { ...item("st_c1", "Stack Child 1", 200), deleted: true, deletedAt: 200 },
      { ...item("st_c2", "Stack Child 2", 200), deleted: true, deletedAt: 200 }
    ],
    updatedAt: 200,
    deleted: true,
    deletedAt: 200
  };
  const gMain = { ...group([bKeep, bDel, stackDel]), id: "g_main", name: "Main", updatedAt: 200, deleted: false, deletedAt: null };
  const gDel = {
    ...group([{ ...item("g_del_b1", "Group Deleted Child", 200), deleted: true, deletedAt: 200 }]),
    id: "g_del",
    name: "Trash Group",
    updatedAt: 200,
    deleted: true,
    deletedAt: 200
  };

  // 1) Browser sync permanent deletion
  remoteGroups = [structuredClone(gMain), structuredClone(gDel)];
  remoteTags = [];
  setClient([structuredClone(gMain), structuredClone(gDel)], browserConfig(), []);
  await syncNow();

  state.groups = state.groups.filter(g => g.id !== "g_del");
  state.groups[0].items = state.groups[0].items.filter(entry => entry.id !== "b_del" && entry.id !== "st_del");
  state.groups[0].updatedAt = 300;
  await syncWrite(state, { purgedIds: ["b_del", "st_del", "st_c1", "st_c2", "g_del", "g_del_b1"] });
  await syncNow();

  assert.deepEqual(state.groups.map(g => g.id), ["g_main"]);
  assert.deepEqual(state.groups[0].items.map(entry => entry.id), ["b_keep"]);
  assert.deepEqual(remoteGroups.map(g => g.id), ["g_main"]);
  assert.deepEqual(remoteGroups[0].items.map(entry => entry.id), ["b_keep"]);

  // Emptying the last remaining group on an already-synced client must not trigger bootstrap resurrection
  state.groups[0].items = [];
  state.groups[0].updatedAt = 400;
  await syncWrite(state, { purgedIds: ["b_keep"] });
  await syncNow();

  assert.deepEqual(state.groups.map(g => g.id), ["g_main"]);
  assert.deepEqual(state.groups[0].items, []);
  assert.deepEqual(remoteGroups[0].items, []);

  // 2) HTTP sync permanent deletion
  const httpMain = {
    ...group([
      { ...item("hb_keep", "HTTP Keep", 100), deleted: false, deletedAt: null },
      { ...item("hb_del", "HTTP Delete", 200), deleted: true, deletedAt: 200 }
    ]),
    id: "g_http",
    name: "HTTP Main",
    updatedAt: 200,
    deleted: false,
    deletedAt: null
  };
  installHttpServer({ groups: [structuredClone(httpMain)], tags: [] });
  setClient([structuredClone(httpMain)], httpConfig("direct"), []);
  await syncNow();

  state.groups[0].items = state.groups[0].items.filter(entry => entry.id !== "hb_del");
  state.groups[0].updatedAt = 300;
  await syncWrite(state, { purgedIds: ["hb_del"] });
  await syncNow();

  assert.deepEqual(state.groups[0].items.map(entry => entry.id), ["hb_keep"]);

  // Sync a second client with the same group ID to verify HTTP server storage no longer holds hb_del
  const secondClientGroup = {
    ...group([{ ...item("hb_fresh", "Fresh Item", 400), deleted: false, deletedAt: null }]),
    id: "g_http",
    name: "HTTP Main",
    updatedAt: 400,
    deleted: false,
    deletedAt: null
  };
  setClient([secondClientGroup], httpConfig("direct"), []);
  await syncNow();

  assert.deepEqual(
    state.groups[0].items.map(entry => entry.id).sort(),
    ["hb_fresh", "hb_keep"]
  );
});

test("WebDAV folder sync tests permissions and syncs bookmarks, config, widgets, background, and backups", async () => {
  const { resolveWebdavFolderBaseUrl, testSyncConnection } = await import("../newtab/sync.js");

  assert.equal(
    resolveWebdavFolderBaseUrl("https://cloud.example/dav/", "/SimpleDial/"),
    "https://cloud.example/dav/SimpleDial"
  );
  assert.equal(
    resolveWebdavFolderBaseUrl("davs://cloud.example/dav/SimpleDial/", ""),
    "https://cloud.example/dav/SimpleDial"
  );

  const files = new Map();
  let folderExists = false;
  const methodsSeen = [];

  fetchRemote = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    methodsSeen.push(`${method} ${url}`);
    const makeRes = (status, body = "") => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "",
      redirected: false,
      url,
      headers: new Map([["content-type", "application/json"]]),
      text: async () => body,
      json: async () => (body ? JSON.parse(body) : null)
    });

    if (method === "PROPFIND") {
      return makeRes(folderExists ? 207 : 404);
    }
    if (method === "MKCOL") {
      folderExists = true;
      return makeRes(201);
    }
    if (method === "PUT") {
      files.set(url, options.body || "");
      return makeRes(201);
    }
    if (method === "GET" || method === "HEAD") {
      if (!files.has(url)) return makeRes(404);
      return makeRes(200, method === "HEAD" ? "" : files.get(url));
    }
    if (method === "DELETE") {
      if (!files.has(url)) return makeRes(404);
      files.delete(url);
      return makeRes(204);
    }
    return makeRes(405);
  };

  const permResult = await testSyncConnection(
    "https://cloud.example/dav",
    "alice",
    "secret",
    "webdav",
    { webdavMode: "folder", webdavFolderPath: "SimpleDial" }
  );
  assert.equal(permResult.ok, true);
  assert.equal(permResult.reason, "folder-ready");
  assert.ok(methodsSeen.some(m => m.startsWith("MKCOL https://cloud.example/dav/SimpleDial/")));
  assert.ok(!files.has("https://cloud.example/dav/SimpleDial/.simple-dial-permission-test.tmp"));

  const folderCfg = {
    sync: {
      enabled: true,
      type: "webdav",
      webdavMode: "folder",
      webdavFolderPath: "SimpleDial",
      serverUrl: "https://cloud.example/dav",
      authMode: "basic",
      username: "alice",
      password: "secret",
      encryptionMode: "none",
      intervalMode: "manual",
      lastSync: 0,
      lastSyncedLocalHash: "",
      pendingPurgedIds: []
    },
    appearance: {
      theme: "autumn",
      tileOpacity: 0.85,
      showDeleted: true,
      lockTiles: true,
      backgroundImage: "data:image/png;base64,AAAA",
      customWidgets: [{ id: "cw1", type: "custom-search", name: "Test" }]
    },
    housekeeper: { retentionDays: 21, lastCleanup: 12345, lastLinkCheck: 67890 },
    backups: { retentionDays: 7, frequencyHours: 12, lastAutoBackup: 99999 },
    browserBookmarksAutoSync: true
  };

  setClient([group([item("wf_1", "WebDAV Item", 100)])], folderCfg, []);
  localStorage.set("myspeeddial-backups", [{ filename: "bm-1.json", timestamp: Date.now(), data: "{}" }]);

  // Default flags: bookmarks-db.json, config.json, widgets.json synced; background.json & backups.json skipped
  const syncRes = await syncNow();
  assert.equal(syncRes.ok, true);
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/bookmarks-db.json"));
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/config.json"));
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/widgets.json"));
  assert.equal(files.has("https://cloud.example/dav/SimpleDial/background.json"), false);
  assert.equal(files.has("https://cloud.example/dav/SimpleDial/backups.json"), false);

  const savedCfg = JSON.parse(files.get("https://cloud.example/dav/SimpleDial/config.json"));
  assert.equal("browserBookmarksAutoSync" in savedCfg.data, false);
  assert.equal("lastCleanup" in savedCfg.data.housekeeper, false);
  assert.equal("lastLinkCheck" in savedCfg.data.housekeeper, false);
  assert.equal("lastAutoBackup" in savedCfg.data.backups, false);
  assert.equal("showDeleted" in savedCfg.data.appearance, false);
  assert.equal("lockTiles" in savedCfg.data.appearance, false);

  // Enable background & backups sync (and verify retention pruning removes expired backup while keeping newest)
  const nowMs = Date.now();
  const expiredMs = nowMs - 20 * 24 * 60 * 60 * 1000;
  folderCfg.sync.webdavSyncBackups = true;
  folderCfg.sync.webdavSyncBackground = true;
  setClient([group([item("wf_1", "WebDAV Item", 100)])], folderCfg, []);
  localStorage.set("myspeeddial-backups", [
    { filename: "bm-new.json", timestamp: nowMs, data: "{}" },
    { filename: "bm-old.json", timestamp: expiredMs, data: "{}" }
  ]);

  const syncAllRes = await syncNow();
  assert.equal(syncAllRes.ok, true);
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/background.json"));
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/backups/index.json"));
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/backups/bookmarks/bm-new.json"));
  assert.equal(files.has("https://cloud.example/dav/SimpleDial/backups/bookmarks/bm-old.json"), false);

  const savedBg = JSON.parse(files.get("https://cloud.example/dav/SimpleDial/background.json"));
  assert.equal(savedBg.data.backgroundImage, "data:image/png;base64,AAAA");
  const savedIndex = JSON.parse(files.get("https://cloud.example/dav/SimpleDial/backups/index.json"));
  assert.deepEqual(savedIndex.data.bookmarks.map(b => b.filename), ["bm-new.json"]);

  // Remote-only backup in index.json is indexed locally without downloading payload until requested
  files.set(
    "https://cloud.example/dav/SimpleDial/backups/bookmarks/bm-remote.json",
    JSON.stringify({ groups: [group([item("b_rem", "Remote", 300)], "g_rem", 300)], tags: [] })
  );
  files.set(
    "https://cloud.example/dav/SimpleDial/backups/index.json",
    JSON.stringify({
      updatedAt: nowMs + 1000,
      data: {
        bookmarks: [
          ...savedIndex.data.bookmarks,
          { filename: "bm-remote.json", timestamp: nowMs + 500, sizeBytes: 120, deviceId: "dev-2", deviceName: "Other PC" }
        ],
        config: []
      }
    })
  );
  await syncWebdavFolderExtras(null, { includeManual: true });
  const localIndex = localStorage.get("myspeeddial-backups") || [];
  const remoteIndexed = localIndex.find(b => b.filename === "bm-remote.json");
  assert.ok(remoteIndexed, "remote backup should be indexed locally");
  assert.equal(remoteIndexed.remoteOnly, true);
  assert.equal("data" in remoteIndexed, false);
  const { fetchRemoteWebdavBackupData, deleteRemoteWebdavBackup } = await import("../newtab/sync.js");
  const downloadedData = await fetchRemoteWebdavBackupData("bookmarks", "bm-remote.json");
  assert.ok(downloadedData.includes("b_rem"));

  // Deleting an existing remote backup removes file and updates index.json
  const delExisting = await deleteRemoteWebdavBackup("bookmarks", "bm-remote.json");
  assert.equal(delExisting.ok, true);
  assert.equal(delExisting.notFoundOnRemote, false);
  assert.equal(files.has("https://cloud.example/dav/SimpleDial/backups/bookmarks/bm-remote.json"), false);
  const indexAfterDel = JSON.parse(files.get("https://cloud.example/dav/SimpleDial/backups/index.json"));
  assert.equal(indexAfterDel.data.bookmarks.some(b => b.filename === "bm-remote.json"), false);

  // Deleting a remote backup that is already missing (404) still updates index.json and flags notFoundOnRemote
  files.set(
    "https://cloud.example/dav/SimpleDial/backups/index.json",
    JSON.stringify({
      updatedAt: nowMs + 2000,
      data: {
        bookmarks: [
          ...indexAfterDel.data.bookmarks,
          { filename: "bm-gone.json", timestamp: nowMs + 600, sizeBytes: 50, deviceId: "dev-2", deviceName: "Other PC" }
        ],
        config: []
      }
    })
  );
  const delMissing = await deleteRemoteWebdavBackup("bookmarks", "bm-gone.json");
  assert.equal(delMissing.ok, true);
  assert.equal(delMissing.notFoundOnRemote, true);
  const indexAfterMissing = JSON.parse(files.get("https://cloud.example/dav/SimpleDial/backups/index.json"));
  assert.equal(indexAfterMissing.data.bookmarks.some(b => b.filename === "bm-gone.json"), false);

  // Next sync prunes remoteOnly local index entries that are no longer in remote index.json
  await syncWebdavFolderExtras(null, { includeManual: true });
  const localAfterPrune = localStorage.get("myspeeddial-backups") || [];
  assert.equal(localAfterPrune.some(b => b.filename === "bm-remote.json"), false);

  // Nested folder path with 409 on leaf MKCOL falls back to segment-by-segment MKCOL
  const createdDirs = new Set();
  fetchRemote = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    const makeRes = (status, body = "") => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      redirected: false,
      url,
      headers: new Map([["content-type", "application/json"]]),
      text: async () => body
    });
    if (method === "PROPFIND") return makeRes(createdDirs.has(url) ? 207 : 404);
    if (method === "MKCOL") {
      if (url.endsWith("/Apps/SimpleDial/") && !createdDirs.has("https://cloud.example/dav/Apps/")) {
        return makeRes(409);
      }
      createdDirs.add(url);
      return makeRes(201);
    }
    if (method === "PUT" || method === "GET" || method === "DELETE") return makeRes(200, "{}");
    return makeRes(405);
  };
  const nestedRes = await testSyncConnection(
    "https://cloud.example/dav",
    "alice",
    "secret",
    "webdav",
    { webdavMode: "folder", webdavFolderPath: "Apps/SimpleDial" }
  );
  assert.equal(nestedRes.ok, true);
  assert.ok(createdDirs.has("https://cloud.example/dav/Apps/"));
  assert.ok(createdDirs.has("https://cloud.example/dav/Apps/SimpleDial/"));
});

test("WebDAV folder sync skips manual parts during automatic syncNow() and uploads them on manual trigger", async () => {
  const files = new Map();
  fetchRemote = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    const makeRes = (status, body = "") => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      redirected: false,
      url,
      headers: new Map([["content-type", "application/json"]]),
      text: async () => body
    });
    if (method === "HEAD") return makeRes(files.has(url) ? 200 : 404);
    if (method === "GET") return files.has(url) ? makeRes(200, files.get(url)) : makeRes(404);
    if (method === "PUT") {
      files.set(url, String(options.body || ""));
      return makeRes(201);
    }
    if (method === "MKCOL" || method === "PROPFIND") return makeRes(201);
    return makeRes(405);
  };

  const cfg = {
    sync: {
      enabled: true,
      type: "webdav",
      webdavMode: "folder",
      webdavFolderPath: "SimpleDial",
      webdavSyncConfig: true,
      webdavConfigMode: "auto",
      webdavSyncWidgets: true,
      webdavWidgetsMode: "manual",
      webdavSyncBackground: true,
      webdavBackgroundMode: "manual",
      webdavSyncBackups: false,
      serverUrl: "https://cloud.example/dav",
      authMode: "basic",
      username: "alice",
      password: "secret",
      encryptionMode: "none",
      intervalMode: "manual",
      lastSync: 0,
      lastSyncedLocalHash: "",
      pendingPurgedIds: []
    },
    appearance: {
      backgroundImage: "data:image/png;base64,MANUALBG",
      customWidgets: [{ id: "cw_m1", type: "custom-search", name: "Manual", urlTemplate: "https://ex.com?q={query}" }]
    },
    housekeeper: { retentionDays: 30 },
    backups: { retentionDays: 30 }
  };

  setClient([group([item("m_1", "Manual Test", 100)])], cfg, []);

  // Automatic syncNow() syncs bookmarks-db.json and auto parts (config.json), but skips manual parts (widgets, background)
  const autoRes = await syncNow();
  assert.equal(autoRes.ok, true);
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/bookmarks-db.json"));
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/config.json"));
  assert.equal(files.has("https://cloud.example/dav/SimpleDial/widgets.json"), false);
  assert.equal(files.has("https://cloud.example/dav/SimpleDial/background.json"), false);

  // Manual trigger uploads only manual parts
  const manualRes = await syncWebdavFolderExtras(null, { includeManual: true, manualOnly: true });
  assert.equal(manualRes.ok, true);
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/widgets.json"));
  assert.ok(files.has("https://cloud.example/dav/SimpleDial/background.json"));
});

test("tag management helpers update, merge, count, delete, and remove unused tags cleanly", () => {
  state.tags = [
    { id: "t1", name: "Work", color: "#10b981", updatedAt: 100, deleted: false, deletedAt: null },
    { id: "t2", name: "Office", color: "#4a6bff", updatedAt: 100, deleted: false, deletedAt: null },
    { id: "t3", name: "Unused", color: "#f59e0b", updatedAt: 100, deleted: false, deletedAt: null }
  ];
  state.groups = [
    {
      ...group([
        { ...item("b1", "One", 100), tags: ["t1", "t1"] },
        {
          id: "st_tag",
          type: "stack",
          title: "Stack",
          sectionId: null,
          children: [
            { ...item("b2", "Two", 100), tags: ["t1", "t2"] },
            { ...item("b_del", "Deleted Bm", 100), tags: ["t3"], deleted: true, deletedAt: 100 }
          ],
          updatedAt: 100,
          deleted: false,
          deletedAt: null
        }
      ]),
      id: "g_active"
    },
    {
      ...group([{ ...item("b3", "In Deleted Group", 100), tags: ["t3"] }], "g_deleted"),
      deleted: true,
      deletedAt: 100
    }
  ];

  const counts = getTagUsageCounts();
  assert.equal(counts.get("t1"), 2);
  assert.equal(counts.get("t2"), 1);
  assert.equal(counts.get("t3") || 0, 0);

  // Reserved system names and blank names are rejected
  assert.equal(updateTagInState("t1", { name: "   ", color: "#000000" }), null);
  assert.equal(updateTagInState("t1", { name: "⚠️ HTTP", color: "#000000" }), null);

  // Rename + recolor without collision
  const renameRes = updateTagInState("t1", { name: "Work Updated", color: "#ef4444" });
  assert.equal(renameRes?.mergedIntoId, null);
  assert.equal(state.tags.find(t => t.id === "t1").name, "Work Updated");
  assert.equal(state.tags.find(t => t.id === "t1").color, "#ef4444");

  // Rename to match existing tag merges and deduplicates bookmark tag IDs
  const mergeRes = updateTagInState("t2", { name: "work updated", color: "#8b5cf6" });
  assert.equal(mergeRes?.mergedIntoId, "t1");
  assert.equal(state.tags.find(t => t.id === "t2").deleted, true);
  assert.equal(state.tags.find(t => t.id === "t1").color, "#8b5cf6");
  const stackChild = state.groups[0].items[1].children[0];
  assert.deepEqual(stackChild.tags, ["t1"]);

  // Remove unused tags soft-deletes t3 and strips it even from deleted bookmarks / deleted groups
  const removedUnused = removeUnusedTagsFromState();
  assert.equal(removedUnused, 1);
  assert.equal(state.tags.find(t => t.id === "t3").deleted, true);
  assert.deepEqual(state.groups[0].items[1].children[1].tags, []);
  assert.deepEqual(state.groups[1].items[0].tags, []);
  assert.equal(state.tags.find(t => t.id === "t1").deleted, false);

  // Explicit delete removes remaining tag from all bookmarks
  assert.equal(deleteTagFromState("missing"), false);
  assert.equal(deleteTagFromState("t1"), true);
  assert.equal(state.tags.find(t => t.id === "t1").deleted, true);
  assert.deepEqual(state.groups[0].items[0].tags, []);
  assert.deepEqual(stackChild.tags, []);
});

test("system tags are counted in usage counts, reserve names, and stay local-only", () => {
  state.tags = [];
  state.groups = [
    {
      ...group([
        item("b_sys_1", "HTTP Site", 100),
        item("b_sys_2", "Dead Site", 100)
      ]),
      id: "g_sys"
    }
  ];

  assert.equal(isReservedSystemTagName("⚠️ HTTP"), true);
  assert.equal(isReservedSystemTagName("  ⛔dead link "), true);
  assert.equal(isReservedSystemTagName("My Custom Tag"), false);

  assert.equal(setBookmarkSystemTag("b_sys_1", SYSTEM_TAG_HTTP_ID, true), true);
  assert.equal(setBookmarkSystemTag("b_sys_2", SYSTEM_TAG_DEAD_LINK_ID, true), true);
  assert.deepEqual(getBookmarkSystemTagIds("b_sys_1"), [SYSTEM_TAG_HTTP_ID]);

  const counts = getTagUsageCounts();
  assert.equal(counts.get(SYSTEM_TAG_HTTP_ID), 1);
  assert.equal(counts.get(SYSTEM_TAG_DEAD_LINK_ID), 1);

  assert.equal(clearSystemTagFromAllBookmarks(SYSTEM_TAG_HTTP_ID), 1);
  assert.deepEqual(getBookmarkSystemTagIds("b_sys_1"), []);
  assert.equal(getTagUsageCounts().get(SYSTEM_TAG_HTTP_ID) || 0, 0);

  assert.equal(clearSystemTagFromAllBookmarks(SYSTEM_TAG_DEAD_LINK_ID), 1);
});

test("pruneOrphanedSystemTags strips system tags from soft-deleted and purged bookmarks", async () => {
  state.groups = [
    {
      ...group([
        item("b_keep", "Active", 100),
        { ...item("b_soft_del", "Soft Deleted", 100), deleted: true, deletedAt: 200 }
      ]),
      id: "g_sys_prune"
    }
  ];

  assert.equal(setBookmarkSystemTag("b_keep", SYSTEM_TAG_HTTP_ID, true), true);
  assert.equal(setBookmarkSystemTag("b_soft_del", SYSTEM_TAG_DEAD_LINK_ID, true), true);
  assert.equal(setBookmarkSystemTag("b_purged", SYSTEM_TAG_HTTP_ID, true), true);

  const pruned = await pruneOrphanedSystemTags();
  assert.equal(pruned, true);
  assert.deepEqual(getBookmarkSystemTagIds("b_keep"), [SYSTEM_TAG_HTTP_ID]);
  assert.deepEqual(getBookmarkSystemTagIds("b_soft_del"), []);
  assert.deepEqual(getBookmarkSystemTagIds("b_purged"), []);

  // saveSystemTags() also prunes orphaned entries before persisting
  assert.equal(setBookmarkSystemTag("b_soft_del", SYSTEM_TAG_DEAD_LINK_ID, true), true);
  assert.equal(setBookmarkSystemTag("b_purged", SYSTEM_TAG_HTTP_ID, true), true);
  await saveSystemTags();
  assert.deepEqual(getBookmarkSystemTagIds("b_keep"), [SYSTEM_TAG_HTTP_ID]);
  assert.deepEqual(getBookmarkSystemTagIds("b_soft_del"), []);
  assert.deepEqual(getBookmarkSystemTagIds("b_purged"), []);

  assert.equal(clearSystemTagFromAllBookmarks(SYSTEM_TAG_HTTP_ID), 1);
});

test("applySystemTagsFromStorageChange updates system tags from external changes and suppresses self-writes", async () => {
  state.groups = [{ ...group([item("b_ext", "Ext", 100)]), id: "g_ext" }];
  assert.equal(setBookmarkSystemTag("b_ext", SYSTEM_TAG_HTTP_ID, true), true);
  await saveSystemTags();

  // Immediate self-triggered storage change is suppressed
  assert.equal(applySystemTagsFromStorageChange({ b_ext: [SYSTEM_TAG_DEAD_LINK_ID] }), false);
  assert.deepEqual(getBookmarkSystemTagIds("b_ext"), [SYSTEM_TAG_HTTP_ID]);

  // Allow setTimeout(..., 0) to clear suppression flag, then apply external change
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(applySystemTagsFromStorageChange({
    b_ext: [SYSTEM_TAG_DEAD_LINK_ID, "invalid_sys_id"],
    "": [SYSTEM_TAG_HTTP_ID]
  }), true);
  assert.deepEqual(getBookmarkSystemTagIds("b_ext"), [SYSTEM_TAG_DEAD_LINK_ID]);

  assert.equal(clearSystemTagFromAllBookmarks(SYSTEM_TAG_DEAD_LINK_ID), 1);
});

test("bookmark reordering propagates from newer remote group to older local client", async () => {
  remoteGroups = [
    {
      ...group([
        item("b3", "Third", 500),
        item("b1", "First", 500),
        item("b2", "Second", 100)
      ]),
      updatedAt: 500
    }
  ];

  setClient([
    {
      ...group([
        item("b1", "First", 100),
        item("b2", "Second", 100),
        item("b3", "Third", 100)
      ]),
      updatedAt: 100
    }
  ]);

  await syncNow({ force: true });
  assert.deepEqual(state.groups[0].items.map(i => i.id), ["b3", "b1", "b2"]);
});

test("reordered object keys and undefined properties do not trigger false sync or remote PUT", async () => {
  const originalGroups = [
    {
      id: "g1",
      name: "Main",
      createdAt: 100,
      updatedAt: 100,
      deleted: false,
      deletedAt: null,
      items: [
        {
          id: "b1",
          title: "Example",
          url: "https://example.com/",
          createdAt: 100,
          updatedAt: 100,
          deleted: false,
          deletedAt: null,
          extraUndefined: undefined
        }
      ]
    }
  ];
  const reorderedGroups = [
    {
      deleted: false,
      deletedAt: null,
      id: "g1",
      items: [
        {
          createdAt: 100,
          deleted: false,
          deletedAt: null,
          id: "b1",
          title: "Example",
          updatedAt: 100,
          url: "https://example.com/"
        }
      ],
      name: "Main",
      createdAt: 100,
      updatedAt: 100
    }
  ];

  installHttpServer({
    groups: reorderedGroups,
    markerType: "sha256",
    markerValue: "a".repeat(64)
  });

  setClient(originalGroups, httpConfig("direct", {
    remoteChangeHeaderType: "sha256",
    lastSyncedLocalHash: await hashGroups(reorderedGroups),
    lastSeenRemoteMarker: "a".repeat(64),
    lastMarkerCheckUrl: "direct::https://sync.example/bookmarks.json",
    lastSync: 100
  }));

  const skipResult = await syncNow();
  assert.equal(skipResult.ok, true);
  assert.equal(skipResult.reason, "remote-marker-unchanged");
  assert.deepEqual(httpRequests.map(r => r.method), ["HEAD"]);

  // Even when a GET runs (e.g., marker changed), key-order differences must not cause a PUT.
  httpRequests = [];
  httpServer.markerValue = "b".repeat(64);
  const noChangeResult = await syncNow();
  assert.equal(noChangeResult.ok, true);
  assert.equal(noChangeResult.reason, "no-changes");
  assert.equal(noChangeResult.changed, false);
  assert.deepEqual(httpRequests.map(r => r.method), ["HEAD", "GET"]);
});

test("post-PUT sync persists updated lastSeenRemoteMarker so next sync skips GET", async () => {
  const initialGroups = [group([item("b1", "Initial", 100)], "g1")];
  const updatedGroups = [group([item("b1", "Updated", 200)], "g1")];

  installHttpServer({
    groups: initialGroups,
    markerType: "etag",
    markerValue: '"v1"'
  });

  setClient(updatedGroups, httpConfig("direct", {
    remoteChangeHeaderType: "etag",
    lastSeenRemoteMarker: '"v1"',
    lastSyncedLocalHash: await hashGroups(initialGroups),
    lastMarkerCheckUrl: "direct::https://sync.example/bookmarks.json",
    lastSync: 100
  }));

  const pushResult = await syncNow();
  assert.equal(pushResult.ok, true);
  assert.deepEqual(httpRequests.map(r => r.method), ["HEAD", "GET", "PUT", "HEAD"]);
  assert.equal(readStoredConfig().sync.lastSeenRemoteMarker, '"v2"');

  httpRequests = [];
  const nextResult = await syncNow();
  assert.equal(nextResult.ok, true);
  assert.equal(nextResult.reason, "remote-marker-unchanged");
  assert.deepEqual(httpRequests.map(r => r.method), ["HEAD"]);
});

test("syncWrite and syncNow share mutex and ifAvailable syncNow skips while write is in flight", async () => {
  const initialGroups = [group([item("b1", "Initial", 100)], "g1")];
  const updatedGroups = [group([item("b1", "Updated", 200)], "g1")];

  installHttpServer({
    groups: initialGroups,
    markerType: "etag",
    markerValue: '"v1"'
  });

  let releaseFirstGet;
  const firstGetGate = new Promise(resolve => { releaseFirstGet = resolve; });
  const baseFetch = fetchRemote;
  let gated = false;
  fetchRemote = async (input, init = {}) => {
    if (!gated && (init.method || "GET") === "GET") {
      gated = true;
      await firstGetGate;
    }
    return baseFetch(input, init);
  };

  setClient(updatedGroups, httpConfig("direct", {
    remoteChangeHeaderType: "etag",
    lastSeenRemoteMarker: '"v1"',
    lastSyncedLocalHash: await hashGroups(initialGroups),
    lastMarkerCheckUrl: "direct::https://sync.example/bookmarks.json",
    lastSync: 100
  }));

  const writePromise = syncWrite();
  // Wait a microtask so syncWrite enters the lock and blocks on GET.
  await Promise.resolve();

  const skippedPoll = await syncNow({ ifAvailable: true });
  assert.equal(skippedPoll.ok, true);
  assert.equal(skippedPoll.reason, "sync-locked");
  assert.equal(skippedPoll.changed, false);

  const queuedSyncNow = syncNow();
  releaseFirstGet();

  const [writeOk, syncNowResult] = await Promise.all([writePromise, queuedSyncNow]);
  assert.equal(writeOk, true);
  assert.equal(syncNowResult.ok, true);
  assert.equal(syncNowResult.reason, "remote-marker-unchanged");
  assert.deepEqual(httpRequests.map(r => r.method), ["GET", "PUT", "HEAD", "HEAD"]);
});


test("syncWrite skips network in manual and disabled modes while queuing purgedIds only when enabled", async () => {
  installHttpServer({ groups: [] });
  setClient([group([item("b1", "Keep", 100)])], httpConfig("direct", { enabled: true, intervalMode: "manual" }));
  httpRequests = [];

  assert.equal(await syncWrite(state, { purgedIds: ["b_deleted"] }), true);
  assert.equal(httpRequests.length, 0);
  assert.ok(localStorage.get("myspeeddial-sync-tombstones")?.tombstones?.b_deleted > 0);

  // Disabled sync skips both network and tombstone recording
  setClient([group([item("b1", "Keep", 100)])], httpConfig("direct", { enabled: false, intervalMode: "immediate", pendingPurgedIds: [] }));
  assert.equal(await syncWrite(state, { purgedIds: ["b_deleted_disabled"] }), true);
  assert.equal(httpRequests.length, 0);
  assert.equal(localStorage.get("myspeeddial-sync-tombstones")?.tombstones?.b_deleted_disabled, undefined);
});

test("syncNow updates lastSync when remote-marker-unchanged skips GET", async () => {
  const localGroups = [group([item("b1", "Same", 100)])];
  installHttpServer({
    groups: localGroups,
    markerType: "etag",
    markerValue: '"v1"'
  });
  setClient(localGroups, httpConfig("direct", {
    enabled: true,
    intervalMode: "immediate",
    lastSync: 1000,
    remoteChangeHeaderType: "etag",
    lastSeenRemoteMarker: '"v1"',
    lastSyncedLocalHash: await hashGroups(localGroups),
    lastMarkerCheckUrl: "direct::https://sync.example/bookmarks.json"
  }));
  httpRequests = [];

  const result = await syncNow();
  assert.equal(result.ok, true);
  assert.equal(result.reason, "remote-marker-unchanged");
  assert.deepEqual(httpRequests.map(r => r.method), ["HEAD"]);
  assert.ok(readStoredConfig().sync.lastSync > 1000);
});

test("syncForceUpload and syncForceDownload overwrite cleanly even when sync is disabled and reject 404/empty/invalid JSON on download", async () => {
  const localGroups = [group([item("b_local", "Local", 100)])];
  const localTags = [{ id: "t1", name: "LocalTag", color: "#3b82f6", updatedAt: 100, deleted: false, deletedAt: null }];
  let serverPayload = { groups: [group([item("b_remote", "OldRemote", 50)])], tags: [] };

  installHttpServer({
    groups: serverPayload.groups,
    markerType: "etag",
    markerValue: '"forced-1"'
  });
  setClient(localGroups, httpConfig("direct", {
    enabled: false,
    lastSync: 0,
    pendingPurgedIds: ["b_old_purge"]
  }), localTags);

  let lastPutBody = null;
  fetchRemote = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    if (method === "PUT") {
      lastPutBody = init.body;
      return new Response("", { status: 200, headers: { etag: '"forced-1"' } });
    }
    if (method === "GET") {
      return new Response(JSON.stringify(serverPayload), {
        status: 200,
        headers: { "content-type": "application/json", etag: '"forced-2"' }
      });
    }
    return new Response("", { status: 405 });
  };

  // Force upload even when sync is disabled
  const upRes = await syncForceUpload(state);
  assert.equal(upRes.ok, true);
  assert.deepEqual(readStoredConfig().sync.pendingPurgedIds, []);
  assert.ok(readStoredConfig().sync.lastSync > 0);
  const uploaded = JSON.parse(lastPutBody);
  assert.equal(uploaded.groups[0].items[0].id, "b_local");
  assert.equal(uploaded.tags[0].id, "t1");

  // Force download overwrites both groups and tags without merging
  serverPayload = {
    groups: [group([item("b_dl", "Downloaded", 200)])],
    tags: [{ id: "t_dl", name: "DlTag", color: "#ef4444", updatedAt: 200, deleted: false, deletedAt: null }]
  };
  const dlRes = await syncForceDownload();
  assert.equal(dlRes.ok, true);
  assert.equal(state.groups[0].items[0].id, "b_dl");
  assert.equal(state.tags[0].id, "t_dl");
  assert.equal(readStoredConfig().sync.lastSeenRemoteMarker, '"forced-2"');

  // Force download refuses to wipe local data on 404, empty body, or invalid JSON
  for (const badRes of [
    new Response("", { status: 404 }),
    new Response("   ", { status: 200 }),
    new Response("{bad json", { status: 200, headers: { "content-type": "application/json" } })
  ]) {
    fetchRemote = async () => badRes;
    const failRes = await syncForceDownload();
    assert.equal(failRes.ok, false);
    assert.equal(state.groups[0].items[0].id, "b_dl");
  }
});

test("syncNow does not overwrite remote data with empty groups on invalid JSON or unexpected payload", async () => {
  const localGroups = [group([item("b_local", "Local", 50)], "g_local", 50)];
  setClient(localGroups, httpConfig("direct", {
    enabled: true,
    lastSync: 100
  }));

  for (const badBody of ["{truncated", "Service Unavailable", JSON.stringify({ ok: true }), "[]"]) {
    let putCalled = false;
    fetchRemote = async (_url, init = {}) => {
      if ((init.method || "GET").toUpperCase() === "PUT") {
        putCalled = true;
        return new Response("", { status: 200 });
      }
      return new Response(badBody, { status: 200, headers: { "content-type": "application/json" } });
    };

    const res = await syncNow();
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid-json");
    assert.equal(putCalled, false);
    assert.equal(state.groups[0].id, "g_local");
  }
});

test("cleanupDeletedItems persists pendingPurgedIds before saveState and serializes with syncNow", async () => {
  const { cleanupDeletedItems } = await import("../newtab/sync.js");
  const oldDeletedAt = Date.now() - (40 * 24 * 60 * 60 * 1000);
  const keepItem = item("b_keep", "Keep", 100);
  const expiredItem = { ...item("b_old", "Old", 50), deleted: true, deletedAt: oldDeletedAt };

  installHttpServer({
    groups: [group([keepItem, expiredItem], "g1", 100)]
  });
  setClient(
    [group([keepItem, expiredItem], "g1", 100)],
    httpConfig("direct", { enabled: true, lastSync: 100 })
  );

  // Even if syncNow runs concurrently, cleanupDeletedItems must serialize under withSyncLock
  // and purge b_old without resurrecting it from the remote copy.
  const [purgedCount, syncRes] = await Promise.all([
    cleanupDeletedItems(30),
    syncNow()
  ]);

  assert.equal(purgedCount, 1);
  assert.equal(syncRes.ok, true);
  assert.deepEqual(state.groups[0].items.map(i => i.id), ["b_keep"]);
  assert.deepEqual(httpServer.groups[0].items.map(i => i.id), ["b_keep"]);
});

test("saveState suppresses delayed and overlapping self-writes without blocking external storage changes", async () => {
  const { saveState, applyStateFromStorageChange } = await import("../newtab/state.js");
  setClient([group([item("b1", "One", 100)], "g1", 100)], httpConfig("direct", { enabled: false }));

  const firstSnapshot = structuredClone(state);
  const p1 = saveState();
  state.groups[0].items[0].title = "Two";
  const secondSnapshot = structuredClone(state);
  const p2 = saveState();

  // While saves are in flight, stale storage.onChanged is suppressed without clearing suppression
  assert.equal(applyStateFromStorageChange(firstSnapshot), false);
  assert.equal(state.groups[0].items[0].title, "Two");

  await Promise.all([p1, p2]);
  await new Promise(resolve => setTimeout(resolve, 10));

  // Even after setTimeout(0) has passed, delayed self-write events are still suppressed
  assert.equal(applyStateFromStorageChange(secondSnapshot), false);
  assert.equal(state.groups[0].items[0].title, "Two");

  // Genuine external change from another tab is applied
  const externalSnapshot = structuredClone(secondSnapshot);
  externalSnapshot.groups[0].items[0].title = "External";
  assert.equal(applyStateFromStorageChange(externalSnapshot), true);
  assert.equal(state.groups[0].items[0].title, "External");
});

test("syncNow safely merges untrusted ids like __proto__, constructor, and toString", async () => {
  setClient([group([item("b1", "One", 100)], "g1", 100)], httpConfig("direct"));
  installHttpServer({
    groups: [
      group([
        item("toString", "Remote toString", 200),
        item("constructor", "Remote constructor", 200),
        item("__proto__", "Remote proto", 200)
      ], "constructor", 200)
    ],
    tags: [{ id: "toString", name: "Tag", updatedAt: 200 }]
  });

  const res = await syncNow({ force: true });
  assert.equal(res.ok, true);
  const mergedGroupIds = state.groups.map(g => g.id);
  assert.ok(mergedGroupIds.includes("g1"));
  assert.ok(mergedGroupIds.includes("constructor"));
  assert.equal(({}).polluted, undefined);
});

test("two clients with equal freshness but different group and tag order converge to identical order", async () => {
  const g1 = group([item("b1", "One", 100)], "g1", 100);
  const g2 = group([item("b2", "Two", 100)], "g2", 100);
  const t1 = { id: "t1", name: "Tag1", updatedAt: 100 };
  const t2 = { id: "t2", name: "Tag2", updatedAt: 100 };

  // Client A has [g1, g2] and [t1, t2], server has [g2, g1] and [t2, t1]
  setClient([structuredClone(g1), structuredClone(g2)], httpConfig("direct"), [structuredClone(t1), structuredClone(t2)]);
  installHttpServer({
    groups: [structuredClone(g2), structuredClone(g1)],
    tags: [structuredClone(t2), structuredClone(t1)]
  });
  await syncNow({ force: true });
  const orderFromA = state.groups.map(g => g.id);
  const tagOrderFromA = state.tags.map(t => t.id);

  // Client B has [g2, g1] and [t2, t1], server has [g1, g2] and [t1, t2]
  setClient([structuredClone(g2), structuredClone(g1)], httpConfig("direct"), [structuredClone(t2), structuredClone(t1)]);
  installHttpServer({
    groups: [structuredClone(g1), structuredClone(g2)],
    tags: [structuredClone(t1), structuredClone(t2)]
  });
  await syncNow({ force: true });
  const orderFromB = state.groups.map(g => g.id);
  const tagOrderFromB = state.tags.map(t => t.id);

  assert.deepEqual(orderFromA, orderFromB);
  assert.deepEqual(tagOrderFromA, tagOrderFromB);
});

test("synced tombstones prevent offline client from resurrecting permanently deleted items", async () => {
  const { clearLocalTombstoneState } = await import("../newtab/sync.js");
  await clearLocalTombstoneState();

  const b1 = item("b1", "Keep", 100);
  const b2 = item("b2", "DeleteMe", 100);
  installHttpServer({ groups: [group([b1, b2], "g1", 100)], tags: [] });

  // Device A permanently deletes b2
  setClient([group([b1], "g1", 100)], httpConfig("direct", { lastSync: 200 }));
  await syncWrite(state, { purgedIds: ["b2"] });

  assert.ok(httpServer.tombstones?.b2 > 0);
  assert.deepEqual(httpServer.groups[0].items.map(i => i.id), ["b1"]);

  // Offline Device B still has b2 locally (with older updatedAt) and syncs later
  await clearLocalTombstoneState();
  setClient([group([b1, b2], "g1", 100)], httpConfig("direct", { lastSync: 150 }));
  const resB = await syncNow({ force: true });
  assert.equal(resB.ok, true);
  assert.deepEqual(state.groups[0].items.map(i => i.id), ["b1"]);
});

test("record modified after tombstone timestamp survives and clears tombstone", async () => {
  const { clearLocalTombstoneState } = await import("../newtab/sync.js");
  await clearLocalTombstoneState();
  const oldPurgeTs = 1000;
  localStorage.set("myspeeddial-sync-tombstones", {
    tombstones: { b2: oldPurgeTs },
    tombstonePrunedBefore: 0
  });

  const b2Edited = item("b2", "Recreated", 2000);
  setClient([group([b2Edited], "g1", 2000)], httpConfig("direct", { lastSync: 500 }));
  installHttpServer({ groups: [group([], "g1", 1000)], tags: [] });

  const res = await syncNow({ force: true });
  assert.equal(res.ok, true);
  assert.deepEqual(state.groups[0].items.map(i => i.id), ["b2"]);
  const storedTombstones = localStorage.get("myspeeddial-sync-tombstones");
  assert.equal(storedTombstones?.tombstones?.b2, undefined);
});

test("stale device pauses with stale-device-conflict and resolves via Smart or Selective merge", async () => {
  const { clearLocalTombstoneState, getStaleDeviceConflictDetails, resolveStaleDeviceConflict } = await import("../newtab/sync.js");
  await clearLocalTombstoneState();

  const now = Date.now();
  const prunedBefore = now - 1000;
  const staleLastSync = now - (10 * 24 * 60 * 60 * 1000);

  const remoteKeep = item("b1", "RemoteKeep", now - 5000);
  const localDeletedWhileOffline = item("b_old", "OldLocalOnly", staleLastSync - 1000);
  const localNewWhileOffline = item("b_new", "NewLocalOnly", now - 500);

  installHttpServer({
    groups: [group([remoteKeep], "g1", now - 5000)],
    tags: [],
    tombstonePrunedBefore: prunedBefore
  });

  setClient(
    [group([remoteKeep, localDeletedWhileOffline, localNewWhileOffline], "g1", now - 500)],
    httpConfig("direct", { lastSync: staleLastSync, lastSeenRemoteMarker: "" })
  );

  const res = await syncNow();
  assert.equal(res.ok, false);
  assert.equal(res.reason, "stale-device-conflict");
  assert.equal(readStoredConfig().sync.pausedReason, "stale-device-conflict");

  // Smart merge drops b_old (<= tombstonePrunedBefore) and keeps b_new (> tombstonePrunedBefore)
  const details = await getStaleDeviceConflictDetails();
  assert.equal(details.ok, true);
  assert.deepEqual(details.ambiguousItems.map(i => i.id), ["b_old"]);

  const smartRes = await resolveStaleDeviceConflict({ mode: "smart" });
  assert.equal(smartRes.ok, true);
  assert.equal(readStoredConfig().sync.pausedReason, null);
  assert.deepEqual(state.groups[0].items.map(i => i.id).sort(), ["b1", "b_new"]);
});

test("repeated fatal auth errors pause sync and syncForceUpload resets epoch and clears pause", async () => {
  const { clearLocalTombstoneState } = await import("../newtab/sync.js");
  await clearLocalTombstoneState();

  setClient([group([item("b1", "One", 100)], "g1", 100)], httpConfig("direct", { lastSync: 50 }));
  fetchRemote = async () => new Response("Unauthorized", { status: 401 });

  await syncNow({ force: true });
  await syncNow({ force: true });
  await syncNow({ force: true });
  assert.equal(readStoredConfig().sync.pausedReason, "auth");

  // Subsequent normal syncNow short-circuits while paused
  const pausedRes = await syncNow();
  assert.equal(pausedRes.ok, false);
  assert.equal(pausedRes.paused, true);

  // Force upload succeeds when server recovers, sets tombstonePrunedBefore, and clears pause
  installHttpServer({ groups: [], tags: [] });
  const uploadRes = await syncForceUpload();
  assert.equal(uploadRes.ok, true);
  assert.equal(readStoredConfig().sync.pausedReason, null);
  const storedTombstones = localStorage.get("myspeeddial-sync-tombstones");
  assert.ok(storedTombstones.tombstonePrunedBefore > 0);
});

test("dbuid mismatch pauses sync and resolves via merge wizard, force download, or force upload", async () => {
  const { clearLocalTombstoneState, getStaleDeviceConflictDetails, resolveStaleDeviceConflict } = await import("../newtab/sync.js");
  await clearLocalTombstoneState();

  // Bootstrap empty device automatically adopts remote dbuid without mismatch
  setClient([group([], "g_boot", 100)], httpConfig("direct", { lastSync: 0, lastSyncedLocalHash: "" }));
  installHttpServer({ groups: [group([item("b1", "Remote", 200)], "g1", 200)], tags: [], dbuid: "remote-db-1" });
  const bootRes = await syncNow();
  assert.equal(bootRes.ok, true);
  assert.equal(localStorage.get("myspeeddial-sync-tombstones")?.dbuid, "remote-db-1");

  // Two different databases (different dbuids) pause with dbuid-mismatch
  localStorage.set("myspeeddial-sync-tombstones", {
    dbuid: "local-db-999",
    tombstones: {},
    tombstonePrunedBefore: 0
  });
  setClient([group([item("b_local", "LocalOnly", 300)], "g_local", 300)], httpConfig("direct", { lastSync: 100 }));
  const mismatchRes = await syncNow({ force: true });
  assert.equal(mismatchRes.ok, false);
  assert.equal(mismatchRes.reason, "dbuid-mismatch");
  assert.equal(readStoredConfig().sync.pausedReason, "dbuid-mismatch");

  const details = await getStaleDeviceConflictDetails();
  assert.equal(details.ok, true);
  assert.equal(details.dbuidMismatch, true);
  assert.equal(details.localDbuid, "local-db-999");
  assert.equal(details.remoteDbuid, "remote-db-1");

  // Resolving via smart merge merges both DBs and adopts remote dbuid
  const mergeRes = await resolveStaleDeviceConflict({ mode: "smart" });
  assert.equal(mergeRes.ok, true);
  assert.equal(readStoredConfig().sync.pausedReason, null);
  assert.equal(localStorage.get("myspeeddial-sync-tombstones")?.dbuid, "remote-db-1");
  assert.equal(httpServer.dbuid, "remote-db-1");

  // Force upload mints a fresh dbuid
  const uploadRes = await syncForceUpload();
  assert.equal(uploadRes.ok, true);
  const newDbuid = localStorage.get("myspeeddial-sync-tombstones")?.dbuid;
  assert.ok(newDbuid && newDbuid !== "remote-db-1");
  assert.equal(httpServer.dbuid, newDbuid);
});

test("selective stale resolution keeps parent group and parent stack when only child item is selected", async () => {
  const { clearLocalTombstoneState, resolveStaleDeviceConflict } = await import("../newtab/sync.js");
  await clearLocalTombstoneState();

  const now = Date.now();
  const staleLastSync = now - (10 * 24 * 60 * 60 * 1000);
  const prunedBefore = now - (2 * 24 * 60 * 60 * 1000);
  const oldTs = staleLastSync - 1000;

  const localStack = {
    id: "stack_local",
    type: "stack",
    title: "LocalStack",
    updatedAt: oldTs,
    children: [item("b_child", "KeepMe", oldTs), item("b_drop", "DropMe", oldTs)]
  };
  const localOnlyGroup = group([localStack, item("b_other", "DropOther", oldTs)], "g_local", oldTs);
  localOnlyGroup.name = "LocalOnlyGroup";

  installHttpServer({
    groups: [group([item("b_cloud", "CloudItem", now)], "g_cloud", now)],
    tags: [],
    tombstonePrunedBefore: prunedBefore,
    dbuid: "db-selective-parent"
  });

  localStorage.set("myspeeddial-sync-tombstones", {
    dbuid: "db-selective-parent",
    tombstones: {},
    tombstonePrunedBefore: 0
  });
  setClient([localOnlyGroup], httpConfig("direct", { lastSync: staleLastSync, lastSeenRemoteMarker: "" }));

  const res = await resolveStaleDeviceConflict({ mode: "selective", keepIds: ["b_child"] });
  assert.equal(res.ok, true);

  const keptGroup = state.groups.find(g => g.id === "g_local");
  assert.ok(keptGroup, "parent group should be kept when child item is selected");
  assert.equal(keptGroup.items.length, 1);
  assert.equal(keptGroup.items[0].id, "stack_local");
  assert.deepEqual(keptGroup.items[0].children.map(c => c.id), ["b_child"]);
});

test("WebDAV extra part conflict pauses conflicting part and resolves via remote, local, or keep-disabled", async () => {
  const { resolveWebdavExtraConflict } = await import("../newtab/sync.js");
  const files = new Map();
  files.set("https://cloud.example/dav/SimpleDial/bookmarks-db.json", JSON.stringify({ groups: [], tags: [] }));
  files.set("https://cloud.example/dav/SimpleDial/config.json", JSON.stringify({
    updatedAt: 5000,
    data: { appearance: { theme: "spring" }, housekeeper: {}, backups: {} }
  }));
  files.set("https://cloud.example/dav/SimpleDial/widgets.json", JSON.stringify({
    updatedAt: 5000,
    data: { customWidgets: [{ id: "w_remote", type: "custom-search", name: "Remote" }] }
  }));

  fetchRemote = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    const makeRes = (status, body = "") => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      redirected: false,
      url,
      headers: new Map([["content-type", "application/json"]]),
      text: async () => body
    });
    if (method === "GET" || method === "HEAD") {
      return files.has(url) ? makeRes(200, method === "HEAD" ? "" : files.get(url)) : makeRes(404);
    }
    if (method === "PUT") {
      files.set(url, options.body || "");
      return makeRes(201);
    }
    return makeRes(405);
  };

  const folderCfg = {
    sync: {
      enabled: true,
      type: "webdav",
      webdavMode: "folder",
      webdavFolderPath: "SimpleDial",
      serverUrl: "https://cloud.example/dav",
      authMode: "basic",
      username: "alice",
      password: "secret",
      intervalMode: "immediate",
      webdavSyncConfig: true,
      webdavSyncWidgets: true,
      webdavSyncBackground: false,
      webdavSyncBackups: false,
      lastSyncedExtraHashes: {},
      webdavExtraConflicts: {}
    },
    appearance: {
      theme: "winter",
      customWidgets: [{ id: "w_local", type: "custom-search", name: "Local" }]
    }
  };
  setClient([], folderCfg, []);

  const syncRes = await syncNow();
  assert.equal(syncRes.ok, true);

  const afterConflict = readStoredConfig();
  assert.equal(afterConflict.sync.webdavSyncConfig, false);
  assert.equal(afterConflict.sync.webdavSyncWidgets, false);
  assert.ok(afterConflict.sync.webdavExtraConflicts.config);
  assert.ok(afterConflict.sync.webdavExtraConflicts.widgets);
  assert.equal(afterConflict.appearance.theme, "winter");

  // Resolve config with remote -> applies remote theme and re-enables webdavSyncConfig
  const resConfig = await resolveWebdavExtraConflict("config", "remote");
  assert.equal(resConfig.ok, true);
  const afterConfigResolve = readStoredConfig();
  assert.equal(afterConfigResolve.appearance.theme, "spring");
  assert.equal(afterConfigResolve.sync.webdavSyncConfig, true);
  assert.equal(afterConfigResolve.sync.webdavExtraConflicts.config, undefined);

  // Resolve widgets with keep-disabled -> clears conflict and keeps webdavSyncWidgets disabled
  const resWidgets = await resolveWebdavExtraConflict("widgets", "keep-disabled");
  assert.equal(resWidgets.ok, true);
  const afterWidgetsResolve = readStoredConfig();
  assert.equal(afterWidgetsResolve.sync.webdavSyncWidgets, false);
  assert.equal(afterWidgetsResolve.sync.webdavExtraConflicts.widgets, undefined);
  assert.equal(afterWidgetsResolve.appearance.customWidgets[0].id, "w_local");
});

test("WebDAV folder sync sends If-Match ETag, retries on 412, and detects updatedAt rollback", async () => {
  const { syncWebdavFolderExtras } = await import("../newtab/sync.js");
  const { saveConfig } = await import("../newtab/config.js");

  const widgetsUrl = "https://cloud.example/dav/SimpleDial/widgets.json";
  const initialRemote = {
    updatedAt: 2000,
    data: {
      customWidgets: [{ id: "w_1", type: "custom-search", name: "One" }],
      customSearchAutoRouteDefaults: {},
      customSearchAutoRouteIcons: {},
      widgetOrder: ["groups", "manage", "search", "bookmarks", "syncStatus", "dateTime", "bookmarksCount", "shortcutPalette", "storageUsage", "w_1"],
      widgetAlign: {},
      widgetNewRow: {}
    }
  };
  const concurrentRemote = {
    updatedAt: 3000,
    data: {
      ...initialRemote.data,
      customWidgets: [{ id: "w_1", type: "custom-search", name: "Concurrent" }]
    }
  };

  let currentEtag = '"etag-1-gzip"';
  let currentWidgetsBody = JSON.stringify(initialRemote);
  let simulateConcurrent412 = true;
  const observedIfMatch = [];

  fetchRemote = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const makeRes = (status, body = "", etag = "") => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      redirected: false,
      url,
      headers: new Map([
        ["content-type", "application/json"],
        ...(etag ? [["ETag", etag]] : [])
      ]),
      text: async () => body
    });
    if (url !== widgetsUrl) {
      return method === "PUT" ? makeRes(201) : makeRes(404);
    }
    if (method === "GET") {
      return makeRes(200, currentWidgetsBody, currentEtag);
    }
    if (method === "PUT") {
      observedIfMatch.push(options.headers?.["If-Match"] || "");
      if (simulateConcurrent412) {
        simulateConcurrent412 = false;
        currentEtag = '"etag-2"';
        currentWidgetsBody = JSON.stringify(concurrentRemote);
        return makeRes(412, "", currentEtag);
      }
      currentEtag = '"etag-3"';
      currentWidgetsBody = options.body || "";
      return makeRes(200, "", currentEtag);
    }
    return makeRes(405);
  };

  // First sync downloads initialRemote and records lastSyncedExtraHashes + lastSeenExtraUpdatedAt
  const baseCfg = {
    sync: {
      enabled: true,
      type: "webdav",
      webdavMode: "folder",
      webdavFolderPath: "SimpleDial",
      serverUrl: "https://cloud.example/dav",
      authMode: "basic",
      username: "alice",
      password: "secret",
      intervalMode: "immediate",
      webdavSyncConfig: false,
      webdavSyncWidgets: true,
      webdavSyncBackground: false,
      webdavSyncBackups: false,
      lastSyncedExtraHashes: {},
      lastSeenExtraUpdatedAt: {},
      webdavExtraConflicts: {}
    },
    appearance: {}
  };
  setClient([], baseCfg, []);
  await syncWebdavFolderExtras();

  // Local edit triggers PUT with If-Match: "etag-1"; server returns 412 with concurrentRemote -> pauses with conflict instead of overwriting
  const syncedCfg = readStoredConfig();
  assert.equal(syncedCfg.sync.lastSeenExtraUpdatedAt.widgets, 2000);
  syncedCfg.appearance.customWidgets = [{ id: "w_1", type: "custom-search", name: "LocalEdit" }];
  await saveConfig(syncedCfg);

  const res412 = await syncWebdavFolderExtras();
  assert.equal(res412.ok, true);
  assert.equal(observedIfMatch[0], '"etag-1"');
  const after412 = readStoredConfig();
  assert.equal(after412.sync.webdavSyncWidgets, false);
  assert.ok(after412.sync.webdavExtraConflicts.widgets);
  assert.equal(JSON.parse(currentWidgetsBody).data.customWidgets[0].name, "Concurrent");

  // Re-enable widgets sync with higher lastSeenExtraUpdatedAt; server serves stale updatedAt (1500 < 5000) -> flagged as conflict
  after412.sync.webdavSyncWidgets = true;
  after412.sync.webdavExtraConflicts = {};
  after412.sync.lastSeenExtraUpdatedAt.widgets = 5000;
  await saveConfig(after412);
  currentWidgetsBody = JSON.stringify({ ...initialRemote, updatedAt: 1500 });

  const resRollback = await syncWebdavFolderExtras();
  assert.equal(resRollback.ok, true);
  const afterRollback = readStoredConfig();
  assert.equal(afterRollback.sync.webdavSyncWidgets, false);
  assert.ok(afterRollback.sync.webdavExtraConflicts.widgets);
});

test("WebDAV bookmarks-db sends normalized If-Match ETag, re-merges on 412, and normalizes -gzip HEAD/GET markers", async () => {
  const { syncForceUpload } = await import("../newtab/sync.js");
  const bookmarksDbUrl = "https://cloud.example/dav/SimpleDial/bookmarks-db.json";
  const itemA = item("b_local", "Local Bookmark", "https://local.example", 2000);
  const itemConcurrent = item("b_concurrent", "Concurrent Bookmark", "https://concurrent.example", 2500);
  const initialDb = {
    groups: [group([item("b_base", "Base Bookmark", "https://base.example", 1000)], "g_main", "Main", 1000)],
    tags: []
  };
  const concurrentDb = {
    groups: [group([item("b_base", "Base Bookmark", "https://base.example", 1000), itemConcurrent], "g_main", "Main", 2500)],
    tags: []
  };

  let dbEtag = '"db-etag-1"';
  let dbBody = JSON.stringify(initialDb);
  let simulateConcurrentPut = true;
  const putIfMatchHeaders = [];

  fetchRemote = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const makeRes = (status, body = "", etag = "") => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      redirected: false,
      url,
      headers: new Map([
        ["content-type", "application/json"],
        ...(etag ? [["ETag", etag]] : [])
      ]),
      text: async () => body
    });
    if (url !== bookmarksDbUrl) {
      return method === "PUT" ? makeRes(201) : makeRes(404);
    }
    if (method === "HEAD") {
      // Simulate HEAD returning ETag without -gzip
      return makeRes(200, "", dbEtag);
    }
    if (method === "GET") {
      // Simulate GET returning ETag with -gzip
      return makeRes(200, dbBody, dbEtag.replace(/"$/, '-gzip"'));
    }
    if (method === "PUT") {
      putIfMatchHeaders.push(options.headers?.["If-Match"] ?? null);
      if (simulateConcurrentPut) {
        simulateConcurrentPut = false;
        dbEtag = '"db-etag-2"';
        dbBody = JSON.stringify(concurrentDb);
        return makeRes(412, "", dbEtag);
      }
      dbEtag = '"db-etag-3"';
      dbBody = options.body || "";
      return makeRes(204, "", dbEtag);
    }
    return makeRes(405);
  };

  setClient(
    [group([item("b_base", "Base Bookmark", "https://base.example", 1000), itemA], "g_main", "Main", 2000)],
    {
      sync: {
        enabled: true,
        type: "webdav",
        webdavMode: "folder",
        webdavFolderPath: "SimpleDial",
        serverUrl: "https://cloud.example/dav",
        authMode: "basic",
        username: "alice",
        password: "secret",
        intervalMode: "immediate",
        webdavSyncConfig: false,
        webdavSyncWidgets: false,
        webdavSyncBackground: false,
        webdavSyncBackups: false,
        remoteChangeHeaderType: "etag",
        lastSeenRemoteMarker: '"db-etag-1"',
        lastMarkerCheckUrl: "webdav::folder::SimpleDial::https://cloud.example/dav"
      },
      appearance: {}
    },
    []
  );

  // First syncNow: HEAD returns "db-etag-1", local has pending itemA -> GET returns "db-etag-1-gzip",
  // first PUT sends If-Match: "db-etag-1" -> 412 -> re-reads "db-etag-2-gzip", re-merges, second PUT sends If-Match: "db-etag-2" -> 204
  const res1 = await syncNow();
  assert.equal(res1.ok, true);
  assert.deepEqual(putIfMatchHeaders, ['"db-etag-1"', '"db-etag-2"']);
  const mergedIds = state.groups[0].items.map(i => i.id).sort();
  assert.deepEqual(mergedIds, ["b_base", "b_concurrent", "b_local"]);
  assert.equal(readStoredConfig().sync.lastSeenRemoteMarker, '"db-etag-3"');

  // Second syncNow with no local changes: HEAD returns "db-etag-3", matches normalized marker -> skips GET
  const res2 = await syncNow();
  assert.equal(res2.ok, true);
  assert.equal(res2.reason, "remote-marker-unchanged");

  // Force upload must NOT send If-Match
  const forceRes = await syncForceUpload();
  assert.equal(forceRes.ok, true);
  assert.equal(putIfMatchHeaders[2], null);
});

test("syncWriteTest uses temp probe in WebDAV folder mode and refuses to overwrite mismatched remote DB in Direct mode", async () => {
  const { syncWriteTest } = await import("../newtab/sync.js");
  const { saveConfig } = await import("../newtab/config.js");

  // 1. WebDAV folder mode must never touch bookmarks-db.json
  const webdavUrls = [];
  fetchRemote = async (url, options = {}) => {
    webdavUrls.push(`${String(options.method || "GET").toUpperCase()} ${url}`);
    return new Response(null, { status: 204 });
  };
  const wdCfg = {
    sync: {
      enabled: true,
      type: "webdav",
      webdavMode: "folder",
      webdavFolderPath: "SimpleDial",
      serverUrl: "https://cloud.example/dav",
      authMode: "basic",
      username: "alice",
      password: "secret"
    },
    appearance: {}
  };
  setClient(
    [group([item("b_new", "New Device", "https://new.example", 2000)], "g_new", "New", 2000)],
    wdCfg,
    []
  );
  await saveConfig(wdCfg);
  const wdRes = await syncWriteTest();
  assert.equal(wdRes.ok, true);
  assert.ok(webdavUrls.some(u => u.includes(".simpledial-write-test-")));
  assert.ok(!webdavUrls.some(u => u.includes("bookmarks-db.json")));

  // 2. Direct mode must refuse to overwrite remote DB when dbuid mismatches
  let directPutCalled = false;
  fetchRemote = async (_url, options = {}) => {
    if (String(options.method || "GET").toUpperCase() === "PUT") {
      directPutCalled = true;
      return new Response("", { status: 200 });
    }
    return new Response(JSON.stringify({
      groups: [group([item("b_existing", "Existing", "https://existing.example", 1000)], "g_1", "Main", 1000)],
      tags: [],
      dbuid: "remote-db-123"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const directCfg = httpConfig("direct", { lastSync: 0 });
  setClient(
    [group([item("b_new", "New Device", "https://new.example", 2000)], "g_new", "New", 2000)],
    directCfg,
    []
  );
  await saveConfig(directCfg);
  const directRes = await syncWriteTest();
  assert.equal(directRes.ok, false);
  assert.equal(directRes.reason, "dbuid-mismatch");
  assert.equal(directPutCalled, false);
});
