import test from "node:test";
import assert from "node:assert/strict";

const storageData = new Map();
const storageChangeListeners = [];
let storageGetCalls = 0;

function makeClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach(n => classes.add(n)),
    remove: (...names) => names.forEach(n => classes.delete(n)),
    toggle: (name, force) => {
      if (force === undefined) {
        if (classes.has(name)) { classes.delete(name); return false; }
        classes.add(name); return true;
      }
      if (force) classes.add(name);
      else classes.delete(name);
      return !!force;
    },
    contains: (name) => classes.has(name),
    _set: classes
  };
}

function makeStyle() {
  const props = new Map();
  return {
    setProperty: (k, v) => props.set(k, String(v)),
    getPropertyValue: (k) => props.get(k) || "",
    _props: props
  };
}

function makeElement(id = "") {
  const attrs = new Map();
  return {
    id,
    tagName: "DIV",
    style: makeStyle(),
    classList: makeClassList(),
    dataset: {},
    children: [],
    textContent: "",
    title: "",
    href: "",
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    removeAttribute: (k) => attrs.delete(k),
    appendChild: (el) => el,
    remove() { elementsById.delete(this.id); },
    querySelectorAll: () => [],
    addEventListener: () => {},
    _attrs: attrs
  };
}

const elementsById = new Map([
  ["lock-tiles-btn", makeElement("lock-tiles-btn")]
]);

globalThis.document = {
  documentElement: { style: makeStyle(), dataset: {} },
  body: { style: makeStyle(), classList: makeClassList(), dataset: {} },
  head: {
    appendChild: (el) => {
      if (el?.id) elementsById.set(el.id, el);
      return el;
    }
  },
  createElement: (tag) => ({ ...makeElement(), tagName: tag.toUpperCase() }),
  getElementById: (id) => elementsById.get(id) || null,
  querySelectorAll: () => []
};

globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} })
};

globalThis.chrome = {
  i18n: { getMessage: (k) => k },
  runtime: { getURL: (p) => `chrome-extension://test/${p}` },
  storage: {
    local: {
      async get(keys) {
        storageGetCalls++;
        if (keys === null || keys === undefined) {
          const all = {};
          for (const [k, v] of storageData.entries()) all[k] = structuredClone(v);
          return all;
        }
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) {
          if (storageData.has(k)) out[k] = structuredClone(storageData.get(k));
        }
        return out;
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          const oldValue = storageData.has(k) ? structuredClone(storageData.get(k)) : undefined;
          storageData.set(k, structuredClone(v));
          changes[k] = { oldValue, newValue: structuredClone(v) };
        }
        for (const listener of storageChangeListeners) {
          listener(changes, "local");
        }
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) storageData.delete(k);
      }
    },
    onChanged: {
      addListener(fn) {
        storageChangeListeners.push(fn);
      }
    }
  }
};

const [
  { defaultConfig, loadConfig, saveConfig, invalidateConfigCache, updateDebugLoggingFlags, logDebug },
  { applyTileOpacity, applyBarOpacity, applyBgDim, applyTileSize, applyGroupTileSize, applyTilesLock, applyThemeStyle, applyBackground },
  { measureAddonStorageUsage, formatStorageBytes }
] = await Promise.all([
  import("../newtab/config.js"),
  import("../newtab/theme.js"),
  import("../newtab/storage-stats.js")
]);

test("loadConfig merges defaults, caches reads, and invalidates on cache reset or storage change", async () => {
  storageData.clear();
  invalidateConfigCache();
  storageGetCalls = 0;

  const initial = await loadConfig();
  assert.equal(initial.housekeeper.retentionDays, defaultConfig.housekeeper.retentionDays);
  assert.equal(initial.appearance.tileSize, 1);
  assert.equal(initial.advanced.syncDebugLogging, false);
  assert.equal(storageGetCalls, 1);

  // Cached hit should not hit chrome.storage.local again
  await loadConfig();
  assert.equal(storageGetCalls, 1);

  // Saving nested partial overrides preserves sibling defaults
  const updated = structuredClone(initial);
  updated.housekeeper.autoCleanupEnabled = true;
  updated.vaultAutoLockMinutes = 15;
  await saveConfig(updated);

  const fromCache = await loadConfig();
  assert.equal(fromCache.housekeeper.autoCleanupEnabled, true);
  assert.equal(fromCache.housekeeper.iconAutoRefreshMode, "missing");
  assert.equal(fromCache.vaultAutoLockMinutes, 15);
  assert.equal(storageGetCalls, 2);

  // External storage change invalidates cache
  await chrome.storage.local.set({
    "myspeeddial-config": { advanced: { syncDebugLogging: true } }
  });
  const reloaded = await loadConfig();
  assert.equal(reloaded.advanced.syncDebugLogging, true);
  assert.equal(storageGetCalls, 3);
});

test("updateDebugLoggingFlags and logDebug gate output per debug channel", async () => {
  const originalLog = console.log;
  const originalDebug = console.debug;
  const originalInfo = console.info;
  const logged = [];
  console.log = (...args) => logged.push(args.join(" "));
  console.debug = (...args) => logged.push(args.join(" "));
  console.info = (...args) => logged.push(args.join(" "));
  try {
    updateDebugLoggingFlags({
      faviconDebugLogging: false,
      deadLinkDebugLogging: false,
      syncDebugLogging: false,
      startupTimingDebugLogging: false
    });
    logDebug("sync", "hidden-sync");
    logDebug("favicon", "hidden-fav");
    logDebug("deadLink", "hidden-dead");
    logDebug("startupTiming", "hidden-startup");
    await new Promise(r => setTimeout(r, 20));
    assert.equal(logged.length, 0);

    updateDebugLoggingFlags({
      faviconDebugLogging: true,
      deadLinkDebugLogging: true,
      syncDebugLogging: true,
      startupTimingDebugLogging: true
    });
    logDebug("sync", "shown-sync");
    logDebug("syncMergeDiff", "shown-diff");
    logDebug("favicon", "shown-fav");
    logDebug("deadLink", "shown-dead");
    logDebug("startupTiming", "shown-startup");
    await new Promise(r => setTimeout(r, 20));
    assert.ok(logged.some(m => m.includes("shown-sync")));
    assert.ok(logged.some(m => m.includes("shown-startup")));
    assert.ok(logged.length >= 3);
  } finally {
    console.log = originalLog;
    console.debug = originalDebug;
    console.info = originalInfo;
    updateDebugLoggingFlags({});
  }
});

test("appearance opacity, dim, scale, and lock config options update DOM styles and classes", async () => {
  await applyTileOpacity({ appearance: { tileOpacity: 0.65 } });
  assert.equal(document.body.style.getPropertyValue("--tile-opacity"), "0.65");

  await applyBarOpacity({ appearance: { barOpacity: 0.4 } });
  assert.equal(document.body.style.getPropertyValue("--bar-opacity"), "0.4");

  await applyBgDim({ appearance: { bgDim: 1.5 } });
  assert.equal(document.body.style.getPropertyValue("--bg-dim"), "0.9");
  await applyBgDim({ appearance: { bgDim: -0.2 } });
  assert.equal(document.body.style.getPropertyValue("--bg-dim"), "0");

  await applyTileSize({ appearance: { tileSize: 2.5, tallBookmarkTiles: true, clickableTags: false } });
  assert.equal(document.body.style.getPropertyValue("--tile-scale"), "1.5");
  assert.equal(document.body.classList.contains("tall-bookmark-tiles"), true);
  assert.equal(document.body.classList.contains("clickable-bookmark-tags"), false);

  await applyGroupTileSize({ appearance: { groupTileSize: 0.1 } });
  assert.equal(document.body.style.getPropertyValue("--group-tile-scale"), "0.5");

  await applyTilesLock({ appearance: { lockTiles: true } });
  assert.equal(document.body.classList.contains("tiles-locked"), true);
  assert.equal(elementsById.get("lock-tiles-btn").textContent, "🔒");
  assert.equal(elementsById.get("lock-tiles-btn").classList.contains("locked"), true);

  await applyTilesLock({ appearance: { lockTiles: false } });
  assert.equal(document.body.classList.contains("tiles-locked"), false);
  assert.equal(elementsById.get("lock-tiles-btn").textContent, "🔓");
});

test("applyThemeStyle and applyBackground apply built-in themes, custom CSS, and background sizes", async () => {
  await applyThemeStyle({ appearance: { theme: "winter" } });
  const themeLink = [...elementsById.values()].find(el => el.tagName === "LINK");
  assert.ok(themeLink);
  assert.equal(themeLink.href, "themes/winter.css");

  await applyThemeStyle({ appearance: { theme: "custom-file", customThemeCss: "body { color: red; }" } });
  const customStyleEl = [...elementsById.values()].find(el => el.tagName === "STYLE");
  assert.ok(customStyleEl);
  assert.equal(customStyleEl.textContent, "body { color: red; }");

  await applyThemeStyle({ appearance: { theme: "default" } });
  assert.equal([...elementsById.values()].some(el => el.tagName === "LINK"), false);

  await applyBackground({
    appearance: {
      backgroundImage: "data:image/png;base64,iVBORw0KGgo=",
      backgroundSize: "tile"
    }
  });
  assert.equal(document.body.style.backgroundImage, "url('data:image/png;base64,iVBORw0KGgo=')");
  assert.equal(document.body.style.backgroundSize, "auto");
  assert.equal(document.body.style.backgroundRepeat, "repeat");

  await applyBackground({
    appearance: {
      backgroundImage: "data:image/png;base64,iVBORw0KGgo=",
      backgroundSize: "fit"
    }
  });
  assert.equal(document.body.style.backgroundSize, "contain");
  assert.equal(document.body.style.backgroundRepeat, "no-repeat");

  await applyBackground({ appearance: { backgroundImage: null } });
  assert.equal(document.body.style.backgroundImage, "");

  // Security: strip @import and external url(...) in custom CSS
  await applyThemeStyle({
    appearance: {
      theme: "custom-file",
      customThemeCss: "@import url('https://evil.test/x.css'); body { background: url(https://evil.test/leak?q=1); color: blue; } .icon { background: url('data:image/png;base64,AAA'); }"
    }
  });
  const sanitizedStyleEl = elementsById.get("theme-custom-style");
  assert.ok(sanitizedStyleEl);
  assert.ok(!sanitizedStyleEl.textContent.includes("@import"));
  assert.ok(!sanitizedStyleEl.textContent.includes("https://evil.test"));
  assert.ok(sanitizedStyleEl.textContent.includes("color: blue;"));
  assert.ok(sanitizedStyleEl.textContent.includes("data:image/png;base64,AAA"));

  // Security: block unsafe backgroundImage schemes and escape delimiters
  await applyBackground({ appearance: { backgroundImage: "javascript:alert(1)" } });
  assert.equal(document.body.style.backgroundImage, "");
  await applyBackground({ appearance: { backgroundImage: "data:text/html,<script>alert(1)</script>" } });
  assert.equal(document.body.style.backgroundImage, "");
  await applyBackground({ appearance: { backgroundImage: "data:image/png;base64,iVBORw0KGgo=');}" } });
  assert.equal(document.body.style.backgroundImage, "url('data:image/png;base64,iVBORw0KGgo=\\'\\);}')");
});

test("measureAddonStorageUsage categorizes chrome.storage.local keys and formats byte sizes", async () => {
  storageData.clear();
  await chrome.storage.local.set({
    "myspeeddial-data": { groups: [{ id: "g1", name: "Test", items: [] }] },
    "myspeeddial-rss-cache": { "cw-1": { items: [{ id: "1", title: "News" }] } },
    "myspeeddial-system-tags": { b1: ["sys_http"] }
  });

  const stats = await measureAddonStorageUsage();
  assert.ok(stats.localBytes > 0);
  assert.ok(stats.categories.bookmarks > 0);
  assert.ok(stats.categories.rss > 0);
  assert.ok(stats.categories.systemTags > 0);
  assert.equal(formatStorageBytes(512), "512 B");
  assert.equal(formatStorageBytes(2048), "2.0 KB");
  assert.equal(formatStorageBytes(2 * 1024 * 1024), "2.00 MB");
  assert.equal(defaultConfig.appearance.storageUsageSpace, "disabled");
});
