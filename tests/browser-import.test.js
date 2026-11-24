import test from "node:test";
import assert from "node:assert/strict";

globalThis.chrome = globalThis.chrome || {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    }
  }
};

const {
  listBookmarkFolders,
  findBookmarkNodeById,
  buildImportedGroupsFromFolder,
  mergeImportedGroupsIntoState,
  countSkippedImportNodes
} = await import("../newtab/browser-import.js");
const { isStackItem } = await import("../newtab/state.js");

const SAMPLE_TREE = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "1",
        title: "Bookmarks Bar",
        children: [
          { id: "b1", title: "Home", url: "https://home.example" },
          {
            id: "10",
            title: "Work",
            children: [
              { id: "b2", title: "Portal", url: "https://portal.example" },
              {
                id: "11",
                title: "Docs",
                children: [
                  { id: "b3", title: "Guide", url: "https://guide.example" },
                  {
                    id: "12",
                    title: "API",
                    children: [
                      { id: "b4", title: "REST", url: "https://rest.example" },
                      {
                        id: "13",
                        title: "DeepNested",
                        children: [
                          { id: "b5", title: "V1", url: "https://v1.example" }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            id: "20",
            title: "Simple",
            children: [
              { id: "b6", title: "News", url: "https://news.example" }
            ]
          }
        ]
      }
    ]
  }
];

test("listBookmarkFolders and findBookmarkNodeById flatten folders with bookmark counts", () => {
  const folders = listBookmarkFolders(SAMPLE_TREE);
  assert.equal(folders[0].id, "0");
  assert.equal(folders[0].totalBookmarks, 6);

  const work = folders.find(f => f.id === "10");
  assert.equal(work.title, "Work");
  assert.equal(work.totalBookmarks, 4);

  const node = findBookmarkNodeById(SAMPLE_TREE, "11");
  assert.equal(node.title, "Docs");
});

test("buildImportedGroupsFromFolder maps auto depth up to Group -> Section -> Stack -> Bookmarks and flattens deeper", () => {
  const barNode = findBookmarkNodeById(SAMPLE_TREE, "1");
  const groups = buildImportedGroupsFromFolder(barNode, {
    structureMode: "groups",
    maxDepth: "auto",
    fallbackGroupName: "Bookmarks Bar"
  });

  assert.equal(groups.length, 3);
  assert.equal(groups[0].name, "Bookmarks Bar");
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].url, "https://home.example");

  const workGroup = groups.find(g => g.name === "Work");
  assert.equal(workGroup.sections.length, 1);
  assert.equal(workGroup.sections[0].name, "Docs");

  const loosePortal = workGroup.items.find(i => !isStackItem(i) && i.title === "Portal");
  assert.equal(loosePortal.sectionId, null);

  const docsSectionId = workGroup.sections[0].id;
  const guide = workGroup.items.find(i => !isStackItem(i) && i.title === "Guide");
  assert.equal(guide.sectionId, docsSectionId);

  const apiStack = workGroup.items.find(i => isStackItem(i) && i.title === "API");
  assert.equal(apiStack.sectionId, docsSectionId);
  assert.deepEqual(
    apiStack.children.map(c => c.url),
    ["https://rest.example", "https://v1.example"]
  );

  const simpleGroup = groups.find(g => g.name === "Simple");
  assert.equal(simpleGroup.sections.length, 0);
  assert.equal(simpleGroup.items.length, 1);
  assert.equal(simpleGroup.items[0].url, "https://news.example");
});

test("buildImportedGroupsFromFolder supports single-group and depth overrides", () => {
  const workNode = findBookmarkNodeById(SAMPLE_TREE, "10");

  const singleGroup = buildImportedGroupsFromFolder(workNode, {
    structureMode: "single-group",
    maxDepth: "sections"
  });
  assert.equal(singleGroup.length, 1);
  assert.equal(singleGroup[0].name, "Work");
  assert.equal(singleGroup[0].sections.length, 1);
  assert.equal(singleGroup[0].items.some(i => isStackItem(i)), false);
  assert.equal(singleGroup[0].items.length, 4);

  const stacksOnly = buildImportedGroupsFromFolder(workNode, {
    structureMode: "single-group",
    maxDepth: "stacks"
  });
  assert.equal(stacksOnly[0].sections.length, 0);
  const docsStack = stacksOnly[0].items.find(i => isStackItem(i));
  assert.equal(docsStack.title, "Docs");
  assert.equal(docsStack.children.length, 3);

  const flatOnly = buildImportedGroupsFromFolder(workNode, {
    structureMode: "single-group",
    maxDepth: "flat"
  });
  assert.equal(flatOnly[0].sections.length, 0);
  assert.equal(flatOnly[0].items.length, 4);
});

test("mergeImportedGroupsIntoState merges matching groups/sections and skips duplicate URLs", () => {
  const existing = [
    {
      id: "g_existing",
      name: "Work",
      sections: [{ id: "sec_existing", name: "Docs", order: 0, updatedAt: 1, deleted: false, deletedAt: null }],
      items: [
        { id: "b_existing", title: "Portal", url: "https://portal.example", sectionId: null, deleted: false }
      ],
      deleted: false
    }
  ];

  const barNode = findBookmarkNodeById(SAMPLE_TREE, "1");
  const imported = buildImportedGroupsFromFolder(barNode, { structureMode: "groups", maxDepth: "auto" });

  const merged = mergeImportedGroupsIntoState(existing, imported, { mode: "merge" });
  assert.equal(merged.stats.groupsMatched, 1);
  assert.equal(merged.stats.groupsCreated, 2);
  assert.equal(merged.stats.duplicatesSkipped, 1);
  assert.equal(merged.stats.bookmarksAdded, 5);
  assert.equal(merged.importedBookmarkIds.length, 5);

  const workGroup = merged.groups.find(g => g.id === "g_existing");
  assert.equal(workGroup.sections.length, 1);
  const guide = workGroup.items.find(i => !isStackItem(i) && i.title === "Guide");
  assert.equal(guide.sectionId, "sec_existing");

  const replaced = mergeImportedGroupsIntoState(existing, imported, { mode: "replace" });
  assert.equal(replaced.groups.length, 3);
  assert.equal(replaced.stats.bookmarksAdded, 6);
  assert.equal(replaced.stats.duplicatesSkipped, 0);
});

test("browser import skips place: URLs, normalizes trailing slashes, and merges into targetGroupId", () => {
  const treeWithPlace = [
    {
      id: "1",
      title: "Folder",
      children: [
        { id: "p1", title: "Most Visited", url: "place:sort=8&maxResults=10" },
        { id: "b1", title: "Example", url: "https://example.com/" },
        { id: "b2", title: "Other", url: "https://other.example/path/" }
      ]
    }
  ];

  const imported = buildImportedGroupsFromFolder(treeWithPlace[0], {
    structureMode: "single-group",
    maxDepth: "auto"
  });
  assert.equal(imported.length, 1);
  assert.equal(imported[0].items.length, 2);
  assert.equal(imported[0].items.some(i => i.url.startsWith("place:")), false);

  const existing = [
    {
      id: "g_target",
      name: "My Custom Group",
      sections: [],
      items: [
        { id: "b_ex", title: "Example", url: "https://example.com", sectionId: null, deleted: false }
      ],
      deleted: false
    }
  ];

  const merged = mergeImportedGroupsIntoState(existing, imported, {
    mode: "merge",
    targetGroupId: "g_target"
  });
  assert.equal(merged.groups.length, 1);
  assert.equal(merged.stats.groupsMatched, 1);
  assert.equal(merged.stats.duplicatesSkipped, 1);
  assert.equal(merged.stats.bookmarksAdded, 1);
  assert.equal(merged.groups[0].items.length, 2);
  assert.equal(countSkippedImportNodes(treeWithPlace[0]), 1);
  assert.equal(merged.groupDetails.length, 1);
  assert.equal(merged.groupDetails[0].action, "merge");
  assert.equal(merged.groupDetails[0].duplicatesSkipped, 1);
});

test("listBookmarkFolders handles Firefox Gecko root________ and ignores separators", () => {
  const geckoTree = [
    {
      id: "root________",
      title: "",
      children: [
        {
          id: "toolbar_____",
          title: "Bookmarks Toolbar",
          children: [
            { id: "sep1", type: "separator", title: "" },
            { id: "gb1", title: "MDN", url: "https://developer.mozilla.org" }
          ]
        },
        {
          id: "menu________",
          title: "Bookmarks Menu",
          children: []
        }
      ]
    }
  ];

  const folders = listBookmarkFolders(geckoTree);
  assert.equal(folders[0].id, "root________");
  assert.equal(folders[0].title, "All Bookmarks");
  assert.equal(folders[0].totalBookmarks, 1);
  assert.equal(folders[1].id, "toolbar_____");
  assert.equal(folders[1].depth, 1);

  const rootNode = findBookmarkNodeById(geckoTree, "root________");
  const groups = buildImportedGroupsFromFolder(rootNode, { structureMode: "groups", maxDepth: "auto" });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Bookmarks Toolbar");
  assert.equal(groups[0].items.length, 1);
});

test("bookmarks-api wrappers reject when chrome.runtime.lastError is set", async () => {
  const { getBookmarksTree, getBookmarkChildren, createBookmarkNode, removeBookmarkNode } = await import("../newtab/bookmarks-api.js");
  const prevBookmarks = globalThis.chrome.bookmarks;
  const prevRuntime = globalThis.chrome.runtime;

  try {
    globalThis.chrome.runtime = { lastError: { message: "Permission denied" } };
    globalThis.chrome.bookmarks = {
      getTree: (cb) => cb([]),
      getChildren: (_id, cb) => cb([]),
      create: (_data, cb) => cb(null),
      removeTree: (_id, cb) => cb()
    };

    await assert.rejects(() => getBookmarksTree(), /Permission denied/);
    await assert.rejects(() => getBookmarkChildren("1"), /Permission denied/);
    await assert.rejects(() => createBookmarkNode({ parentId: "1", title: "X" }), /Permission denied/);
    await assert.rejects(() => removeBookmarkNode("1"), /Permission denied/);
  } finally {
    globalThis.chrome.bookmarks = prevBookmarks;
    globalThis.chrome.runtime = prevRuntime;
  }
});

test("syncBrowserBookmarks builds before deleting, rolls back on error, and serializes forced calls", async () => {
  const { state } = await import("../newtab/state.js");
  const { saveConfig, defaultConfig } = await import("../newtab/config.js");
  const prevBookmarks = globalThis.chrome.bookmarks;
  const prevRuntime = globalThis.chrome.runtime;
  const prevStorage = globalThis.chrome.storage;

  const store = new Map();
  globalThis.chrome.storage = {
    local: {
      get: async (k) => ({ [k]: structuredClone(store.get(k)) }),
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v));
      }
    }
  };
  globalThis.chrome.runtime = {};

  let nextId = 100;
  let failNextCreate = false;
  const ops = [];
  const existingChildren = [{ id: "old_1", title: "Old Group" }];

  globalThis.chrome.bookmarks = {
    getTree: (cb) => cb([{
      id: "0",
      children: [{ id: "1", title: "Bookmarks Bar", children: [{ id: "sd_root", title: "SimpleDial", children: existingChildren }] }]
    }]),
    getChildren: (_id, cb) => cb([...existingChildren]),
    create: (data, cb) => {
      if (failNextCreate && data.url) {
        globalThis.chrome.runtime.lastError = { message: "Bookmark create failed" };
        cb(null);
        delete globalThis.chrome.runtime.lastError;
        return;
      }
      const node = { id: `new_${++nextId}`, ...data };
      ops.push(`create:${node.id}:${node.title}`);
      cb(node);
    },
    removeTree: (id, cb) => {
      ops.push(`remove:${id}`);
      cb();
    }
  };

  try {
    const { syncBrowserBookmarks } = await import("../newtab/browser-bookmarks-sync.js");
    const cfg = structuredClone(defaultConfig);
    cfg.browserBookmarksAutoSync = true;
    await saveConfig(cfg);

    state.groups = [{
      id: "g1",
      name: "Work",
      deleted: false,
      items: [{ id: "b1", title: "Portal", url: "https://portal.example", deleted: false }]
    }];

    // Mid-sync failure should roll back created folder and NOT delete old_1
    failNextCreate = true;
    await assert.rejects(() => syncBrowserBookmarks({ force: true }), /Bookmark create failed/);
    assert.ok(!ops.includes("remove:old_1"), "old_1 must not be removed on failure");
    assert.ok(ops.some(o => o.startsWith("remove:new_")), "partially created folder must be rolled back");

    // Successful run creates new folder before removing old_1
    ops.length = 0;
    failNextCreate = false;
    const ok = await syncBrowserBookmarks({ force: true });
    assert.equal(ok, true);
    const firstCreateIdx = ops.findIndex(o => o.startsWith("create:"));
    const removeOldIdx = ops.indexOf("remove:old_1");
    assert.ok(firstCreateIdx !== -1 && removeOldIdx > firstCreateIdx, "new bookmarks must be created before old_1 is removed");
  } finally {
    globalThis.chrome.bookmarks = prevBookmarks;
    globalThis.chrome.runtime = prevRuntime;
    globalThis.chrome.storage = prevStorage;
  }
});
