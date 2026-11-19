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

const [{ state, getTagUsageCounts, updateTagInState, deleteTagFromState, removeUnusedTagsFromState }, { syncNow, syncWrite, syncWebdavFolderExtras }, { shouldSync, getSyncIntervalMs }] = await Promise.all([
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
      intervalMode: "custom",
      customIntervalMinutes: 1,
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

function installHttpServer({ groups = [], tags = undefined, markerType = null, markerValue = "", failReads = 0, failWrites = 0 } = {}) {
  httpServer = {
    groups: structuredClone(groups),
    tags: tags !== undefined ? structuredClone(tags) : undefined,
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
      const payload = httpServer.tags !== undefined
        ? { groups: httpServer.groups, tags: httpServer.tags }
        : { groups: httpServer.groups };
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
      if (httpServer.markerType === "etag") {
        httpServer.markerValue = `"v${Number.parseInt(httpServer.markerValue.match(/\\d+/)?.[0] || "0", 10) + 1}"`;
      } else if (httpServer.markerType === "sha256") {
        httpServer.markerValue = String(Number.parseInt(httpServer.markerValue || "0", 16) + 1).padStart(64, "0");
      }
      return new Response(null, { status: 200 });
    }

    return new Response("Method not allowed", { status: 405 });
  };
}

async function hashGroups(groups) {
  const bytes = new TextEncoder().encode(JSON.stringify(groups));
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

test("sync interval policy supports immediate, custom, default, and manual modes", () => {
  const now = Date.now();
  const config = { sync: { intervalMode: "immediate", lastSync: now } };
  assert.equal(shouldSync(config), true);
  assert.equal(getSyncIntervalMs(config), 0);

  config.sync.intervalMode = "custom";
  config.sync.customIntervalMinutes = 5;
  config.sync.lastSync = now - 4 * 60_000;
  assert.equal(shouldSync(config), false);
  config.sync.lastSync = now - 5 * 60_000 - 1;
  assert.equal(shouldSync(config), true);
  assert.equal(getSyncIntervalMs(config), 5 * 60_000);

  config.sync.intervalMode = "default";
  assert.equal(getSyncIntervalMs(config), 60_000);

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
