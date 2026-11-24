import { t } from "../i18n.js";
import { isAllowedThemeUrl } from "../color-utils.js";
import { createCustomWidgetIconElement } from "./shared.js";
import { requestRestEndpointPermission, hasHostPermissionForUrl } from "./rest-status-widget.js";

const RSS_CACHE_KEY = "myspeeddial-rss-cache";
const RSS_READ_KEY = "myspeeddial-rss-read";
const RSS_REQUEST_TIMEOUT_MS = 10000;
const RSS_MAX_STORED_READ_IDS = 120;

let rssCacheLoaded = false;
let rssCacheLoadPromise = null;
let rssCacheByWidget = {};
let rssReadLoaded = false;
let rssReadByWidget = {};
let rssPollingIntervalId = null;

if (typeof chrome !== "undefined" && chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    let updated = false;
    if (changes[RSS_CACHE_KEY]?.newValue && typeof changes[RSS_CACHE_KEY].newValue === "object") {
      rssCacheByWidget = changes[RSS_CACHE_KEY].newValue;
      rssCacheLoaded = true;
      updated = true;
    }
    if (changes[RSS_READ_KEY]?.newValue && typeof changes[RSS_READ_KEY].newValue === "object") {
      rssReadByWidget = changes[RSS_READ_KEY].newValue;
      rssReadLoaded = true;
      updated = true;
    }
    if (updated && typeof document !== "undefined") {
      void import("../config.js").then(async ({ loadConfig }) => {
        const cfg = await loadConfig();
        const widgets = Array.isArray(cfg?.appearance?.customWidgets) ? cfg.appearance.customWidgets : [];
        for (const groupEntry of groupRssFeedWidgets(widgets)) {
          const el = document.querySelector(`.custom-rss-widget[data-widget-id="${groupEntry.representative.id}"]`);
          if (el) updateRssBarDom(el, groupEntry);
        }
      }).catch(() => {});
    }
  });
}

export function isValidRssFeedUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  return /^https?:\/\//i.test(trimmed) && isAllowedThemeUrl(trimmed);
}

export function normalizeRssRefreshMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 30;
  return Math.max(5, Math.min(1440, Math.round(num)));
}

export function normalizeRssMaxItems(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 15;
  return Math.max(1, Math.min(50, Math.round(num)));
}

export function groupRssFeedWidgets(widgets = []) {
  const rssWidgets = (Array.isArray(widgets) ? widgets : []).filter(w => w?.type === "rss-feed");
  const groupOrder = [];
  const groupsMap = new Map();

  for (const widget of rssWidgets) {
    const gName = typeof widget.groupName === "string" ? widget.groupName.trim() : "";
    const key = gName ? `g:${gName.toLowerCase()}` : `s:${widget.id}`;
    if (!groupsMap.has(key)) {
      const entry = { key, groupName: gName, members: [] };
      groupsMap.set(key, entry);
      groupOrder.push(entry);
    }
    groupsMap.get(key).members.push(widget);
  }

  return groupOrder.map(entry => ({
    ...entry,
    representative: entry.members[0]
  }));
}

function decodeXmlEntities(str) {
  if (typeof str !== "string" || !str) return "";
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSafeFeedItemUrl(rawHref, baseUrl = "") {
  if (typeof rawHref !== "string" || !rawHref.trim()) return "";
  const cleaned = rawHref.trim();
  try {
    const resolved = baseUrl ? new URL(cleaned, baseUrl).href : new URL(cleaned).href;
    return isValidRssFeedUrl(resolved) ? resolved : "";
  } catch {
    return "";
  }
}

function parseDateMs(rawDate) {
  if (typeof rawDate !== "string" || !rawDate.trim()) return 0;
  const parsed = Date.parse(rawDate.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseXmlViaDomParser(text, feedUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (!doc || doc.querySelector("parsererror")) {
    return null;
  }

  const rootName = doc.documentElement?.localName?.toLowerCase() || "";
  const items = [];

  if (rootName === "feed") {
    const feedTitle = doc.querySelector("feed > title")?.textContent?.trim() || "";
    const entries = [...doc.querySelectorAll("entry")];
    for (const entry of entries) {
      const title = decodeXmlEntities(entry.querySelector("title")?.textContent || "");
      const links = [...entry.querySelectorAll("link")];
      const preferredLink =
        links.find(l => (l.getAttribute("rel") || "alternate").toLowerCase() === "alternate" && l.getAttribute("href")) ||
        links.find(l => l.getAttribute("href"));
      const link = resolveSafeFeedItemUrl(preferredLink?.getAttribute("href") || "", feedUrl);
      const rawId = entry.querySelector("id")?.textContent?.trim() || link || title;
      const publishedAt = parseDateMs(
        entry.querySelector("published")?.textContent || entry.querySelector("updated")?.textContent || ""
      );
      if (!title || !link) continue;
      items.push({ id: rawId.slice(0, 240), title, link, publishedAt });
    }
    return { feedTitle, items };
  }

  const feedTitle = doc.querySelector("channel > title")?.textContent?.trim() || "";
  const rssItems = [...doc.querySelectorAll("item")];
  for (const itemEl of rssItems) {
    const title = decodeXmlEntities(itemEl.querySelector("title")?.textContent || "");
    const linkText = itemEl.querySelector("link")?.textContent?.trim() || "";
    const guidText = itemEl.querySelector("guid")?.textContent?.trim() || "";
    const link = resolveSafeFeedItemUrl(linkText || guidText, feedUrl);
    const rawId = guidText || link || title;
    const pubText =
      itemEl.querySelector("pubDate")?.textContent ||
      itemEl.getElementsByTagName("dc:date")?.[0]?.textContent ||
      "";
    const publishedAt = parseDateMs(pubText);
    if (!title || !link) continue;
    items.push({ id: rawId.slice(0, 240), title, link, publishedAt });
  }
  return { feedTitle, items };
}

function extractFirstTagText(block, tagNames) {
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = block.match(re);
    if (m) return decodeXmlEntities(m[1]);
  }
  return "";
}

function parseXmlViaRegex(text, feedUrl) {
  const isAtom = /<feed\b/i.test(text) && /<entry\b/i.test(text);
  const items = [];
  if (isAtom) {
    const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    let m;
    while ((m = entryRe.exec(text)) !== null) {
      const block = m[1];
      const title = extractFirstTagText(block, ["title"]);
      const altMatch = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i)
        || block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
      const link = resolveSafeFeedItemUrl(altMatch ? decodeXmlEntities(altMatch[1]) : "", feedUrl);
      const rawId = extractFirstTagText(block, ["id"]) || link || title;
      const publishedAt = parseDateMs(extractFirstTagText(block, ["published", "updated"]));
      if (!title || !link) continue;
      items.push({ id: rawId.slice(0, 240), title, link, publishedAt });
    }
    return { feedTitle: extractFirstTagText(text, ["title"]), items };
  }

  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(text)) !== null) {
    const block = m[1];
    const title = extractFirstTagText(block, ["title"]);
    const linkText = extractFirstTagText(block, ["link"]);
    const guidText = extractFirstTagText(block, ["guid"]);
    const link = resolveSafeFeedItemUrl(linkText || guidText, feedUrl);
    const rawId = guidText || link || title;
    const publishedAt = parseDateMs(extractFirstTagText(block, ["pubDate", "dc:date"]));
    if (!title || !link) continue;
    items.push({ id: rawId.slice(0, 240), title, link, publishedAt });
  }
  return { feedTitle: extractFirstTagText(text, ["title"]), items };
}

export function parseFeedResponse(rawText, feedUrl = "") {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return { feedTitle: "", items: [] };
  }
  const trimmed = rawText.trim().replace(/^\uFEFF/, "");

  // JSON Feed (https://jsonfeed.org/)
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      if (json && Array.isArray(json.items)) {
        const items = [];
        for (const entry of json.items) {
          if (!entry || typeof entry !== "object") continue;
          const title = typeof entry.title === "string"
            ? entry.title.trim()
            : (typeof entry.summary === "string" ? entry.summary.trim() : "");
          const link = resolveSafeFeedItemUrl(entry.url || entry.external_url || "", feedUrl);
          const rawId = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : (link || title);
          const publishedAt = parseDateMs(entry.date_published || entry.date_modified || "");
          if (!title || !link) continue;
          items.push({ id: rawId.slice(0, 240), title, link, publishedAt });
        }
        return {
          feedTitle: typeof json.title === "string" ? json.title.trim() : "",
          items
        };
      }
    } catch {
      // Fall through to XML parsing
    }
  }

  if (typeof DOMParser !== "undefined") {
    const domParsed = parseXmlViaDomParser(trimmed, feedUrl);
    if (domParsed) return domParsed;
  }
  return parseXmlViaRegex(trimmed, feedUrl);
}

async function ensureRssCacheLoaded() {
  if (rssCacheLoaded) return rssCacheByWidget;
  if (rssCacheLoadPromise) return rssCacheLoadPromise;
  rssCacheLoadPromise = (async () => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get([RSS_CACHE_KEY, RSS_READ_KEY]);
        if (res?.[RSS_CACHE_KEY] && typeof res[RSS_CACHE_KEY] === "object") {
          rssCacheByWidget = res[RSS_CACHE_KEY];
        }
        if (res?.[RSS_READ_KEY] && typeof res[RSS_READ_KEY] === "object") {
          rssReadByWidget = res[RSS_READ_KEY];
        }
        rssReadLoaded = true;
        rssCacheLoaded = true;
      } catch {
        // ignore
      }
    } else {
      rssCacheLoaded = true;
    }
    return rssCacheByWidget;
  })().finally(() => {
    rssCacheLoadPromise = null;
  });
  return rssCacheLoadPromise;
}

async function persistRssCache() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [RSS_CACHE_KEY]: rssCacheByWidget });
    } catch {
      // ignore
    }
  }
}

async function persistRssReadState() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [RSS_READ_KEY]: rssReadByWidget });
    } catch {
      // ignore
    }
  }
}

function getReadSetForWidget(widgetId) {
  const list = rssReadByWidget[widgetId];
  return new Set(Array.isArray(list) ? list : []);
}

async function refreshRssReadFromStorage({ includeCache = false } = {}) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const keys = includeCache ? [RSS_READ_KEY, RSS_CACHE_KEY] : [RSS_READ_KEY];
      const res = await chrome.storage.local.get(keys);
      if (res?.[RSS_READ_KEY] && typeof res[RSS_READ_KEY] === "object") {
        rssReadByWidget = res[RSS_READ_KEY];
      }
      if (includeCache && res?.[RSS_CACHE_KEY] && typeof res[RSS_CACHE_KEY] === "object") {
        rssCacheByWidget = res[RSS_CACHE_KEY];
      }
      rssReadLoaded = true;
    } catch {
      // ignore
    }
  }
}

export async function markRssItemRead(widgetId, itemId) {
  if (!widgetId || !itemId) return;
  await ensureRssCacheLoaded();
  await refreshRssReadFromStorage();
  const prev = Array.isArray(rssReadByWidget[widgetId]) ? rssReadByWidget[widgetId] : [];
  if (prev.includes(itemId)) return;
  const next = [itemId, ...prev].slice(0, RSS_MAX_STORED_READ_IDS);
  rssReadByWidget[widgetId] = next;
  await persistRssReadState();
}

export async function markRssItemUnread(widgetId, itemId) {
  if (!widgetId || !itemId) return;
  await ensureRssCacheLoaded();
  await refreshRssReadFromStorage();
  const prev = Array.isArray(rssReadByWidget[widgetId]) ? rssReadByWidget[widgetId] : [];
  if (!prev.includes(itemId)) return;
  rssReadByWidget[widgetId] = prev.filter(id => id !== itemId);
  await persistRssReadState();
}

export async function markAllRssItemsRead(widgets = []) {
  await ensureRssCacheLoaded();
  const missingCache = widgets.some(w => w?.id && !rssCacheByWidget[w.id]);
  await refreshRssReadFromStorage({ includeCache: missingCache });
  let changed = false;
  for (const w of widgets) {
    const cache = rssCacheByWidget[w.id];
    const items = Array.isArray(cache?.items) ? cache.items : [];
    if (items.length === 0) continue;
    const prev = Array.isArray(rssReadByWidget[w.id]) ? rssReadByWidget[w.id] : [];
    const prevSet = new Set(prev);
    const hasNew = items.some(i => i?.id && !prevSet.has(i.id));
    if (!hasNew) continue;
    const merged = [...new Set([...items.map(i => i.id), ...prev])].slice(0, RSS_MAX_STORED_READ_IDS);
    rssReadByWidget[w.id] = merged;
    changed = true;
  }
  if (changed) {
    await persistRssReadState();
  }
}

export async function pruneRssStorageForWidgets(activeWidgets = []) {
  await ensureRssCacheLoaded();
  const activeIds = new Set(
    (Array.isArray(activeWidgets) ? activeWidgets : [])
      .filter(w => w?.type === "rss-feed" && typeof w.id === "string" && w.id)
      .map(w => w.id)
  );
  let cacheChanged = false;
  let readChanged = false;
  for (const id of Object.keys(rssCacheByWidget)) {
    if (!activeIds.has(id)) {
      delete rssCacheByWidget[id];
      cacheChanged = true;
    }
  }
  for (const id of Object.keys(rssReadByWidget)) {
    if (!activeIds.has(id)) {
      delete rssReadByWidget[id];
      readChanged = true;
    }
  }
  if (cacheChanged) await persistRssCache();
  if (readChanged) await persistRssReadState();
  return cacheChanged || readChanged;
}

export async function requestRssFeedPermission(feedUrl) {
  return requestRestEndpointPermission(feedUrl);
}

export async function fetchRssFeedWidget(widget) {
  if (!widget || !isValidRssFeedUrl(widget.feedUrl)) {
    return { ok: false, error: "Invalid feed URL", items: [] };
  }
  const hasPerm = await hasHostPermissionForUrl(widget.feedUrl);
  if (!hasPerm) {
    return { ok: false, error: "Permission required", items: [] };
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), RSS_REQUEST_TIMEOUT_MS) : null;

  try {
    const res = await fetch(widget.feedUrl, {
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, items: [] };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 1024 * 1024) {
      return { ok: false, error: "Feed too large", items: [] };
    }
    const text = new TextDecoder("utf-8").decode(buf);
    const parsed = parseFeedResponse(text, widget.feedUrl);
    const maxItems = normalizeRssMaxItems(widget.maxItems);
    return {
      ok: true,
      error: null,
      feedTitle: parsed.feedTitle,
      items: parsed.items.slice(0, maxItems)
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "Timeout" : (err?.message || "Fetch error"),
      items: []
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getWidgetItemsWithReadState(widget) {
  const cache = rssCacheByWidget[widget.id];
  const items = Array.isArray(cache?.items) ? cache.items : [];
  const readSet = getReadSetForWidget(widget.id);
  return items.map(item => ({
    ...item,
    widgetId: widget.id,
    widgetName: widget.name || cache?.feedTitle || "Feed",
    read: readSet.has(item.id)
  }));
}

function updateRssBarDom(barEl, groupEntry) {
  if (!barEl) return;
  const allItems = [];
  let hasError = false;
  let lastError = "";
  let hasLoadedOnce = false;

  for (const w of groupEntry.members) {
    const cache = rssCacheByWidget[w.id];
    if (cache) hasLoadedOnce = true;
    if (cache?.error) {
      hasError = true;
      lastError = cache.error;
    }
    allItems.push(...getWidgetItemsWithReadState(w));
  }

  allItems.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  const unreadItems = allItems.filter(i => !i.read);
  const unreadCount = unreadItems.length;

  const badgeEl = barEl.querySelector(".custom-rss-badge");
  const headlineEl = barEl.querySelector(".custom-rss-headline");
  if (badgeEl) {
    badgeEl.textContent = String(unreadCount);
    badgeEl.classList.toggle("hidden", unreadCount === 0);
  }
  barEl.classList.toggle("has-unread", unreadCount > 0);

  if (headlineEl) {
    if (unreadItems.length > 0) {
      headlineEl.textContent = unreadItems[0].title;
      barEl.title = `${groupEntry.groupName || groupEntry.representative.name || "Feed"} — ${unreadItems[0].title}`;
    } else if (allItems.length > 0) {
      headlineEl.textContent = allItems[0].title;
      barEl.title = `${groupEntry.groupName || groupEntry.representative.name || "Feed"} — ${allItems[0].title}`;
    } else if (hasError) {
      if (lastError === "Permission required") {
        headlineEl.textContent = t("rssPermissionRequiredBar") || "🔒 Permission required — open & refresh";
        barEl.title = t("rssPermissionRequiredBarTitle") || "Open widget and click Refresh (↻) to grant permission";
      } else {
        headlineEl.textContent = lastError;
        barEl.title = lastError;
      }
    } else if (!hasLoadedOnce) {
      headlineEl.textContent = t("rssLoading") || "Loading feed...";
    } else {
      headlineEl.textContent = t("rssEmpty") || "No articles";
    }
  }
}

function formatRelativeFeedTime(ms) {
  if (!ms || ms <= 0) return "";
  const diffMins = Math.floor(Math.max(0, Date.now() - ms) / 60000);
  if (diffMins < 1) return t("rssJustNow") || "just now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

function ensureRssModalElement() {
  let modal = document.getElementById("rss-feed-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "rss-feed-modal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content rss-modal-content">
      <div class="rss-modal-header">
        <div class="rss-modal-title-wrap">
          <span class="rss-modal-icon"></span>
          <h3 class="rss-modal-title"></h3>
          <span class="rss-modal-unread-badge hidden"></span>
        </div>
        <div class="rss-modal-actions">
          <button type="button" class="icon-btn rss-mark-all-btn"></button>
          <button type="button" class="icon-btn rss-refresh-btn" title="Refresh">↻</button>
          <button type="button" class="icon-btn rss-close-btn" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="rss-modal-tabs hidden"></div>
      <div class="rss-modal-list"></div>
    </div>
  `;

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  modal.querySelector(".rss-close-btn")?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      modal.classList.add("hidden");
    }
  });

  document.body.appendChild(modal);
  return modal;
}

export async function openRssFeedModal(groupEntry, barEl = null) {
  await ensureRssCacheLoaded();
  const modal = ensureRssModalElement();
  const rep = groupEntry.representative;
  const titleText = groupEntry.groupName || rep.name || "Feed";
  let activeFilterWidgetId = "all";

  const iconEl = modal.querySelector(".rss-modal-icon");
  const titleEl = modal.querySelector(".rss-modal-title");
  const unreadBadge = modal.querySelector(".rss-modal-unread-badge");
  const markAllBtn = modal.querySelector(".rss-mark-all-btn");
  const refreshBtn = modal.querySelector(".rss-refresh-btn");
  const tabsEl = modal.querySelector(".rss-modal-tabs");
  const listEl = modal.querySelector(".rss-modal-list");

  if (iconEl) {
    iconEl.innerHTML = "";
    iconEl.appendChild(createCustomWidgetIconElement(rep));
  }
  if (titleEl) titleEl.textContent = titleText;
  if (markAllBtn) markAllBtn.textContent = t("rssMarkAllRead") || "Mark all read";

  const renderModalBody = (focusToggleKey = null) => {
    const prevScrollTop = listEl ? listEl.scrollTop : 0;
    const items = [];
    for (const w of groupEntry.members) {
      if (activeFilterWidgetId !== "all" && w.id !== activeFilterWidgetId) continue;
      items.push(...getWidgetItemsWithReadState(w));
    }
    items.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

    const totalUnread = groupEntry.members.reduce(
      (sum, w) => sum + getWidgetItemsWithReadState(w).filter(i => !i.read).length,
      0
    );
    if (unreadBadge) {
      unreadBadge.textContent = String(totalUnread);
      unreadBadge.classList.toggle("hidden", totalUnread === 0);
    }
    if (markAllBtn) {
      markAllBtn.disabled = totalUnread === 0;
    }

    if (tabsEl) {
      tabsEl.innerHTML = "";
      if (groupEntry.members.length > 1) {
        tabsEl.classList.remove("hidden");
        const mkTab = (id, label) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "rss-modal-tab" + (activeFilterWidgetId === id ? " active" : "");
          btn.textContent = label;
          btn.addEventListener("click", () => {
            activeFilterWidgetId = id;
            renderModalBody();
          });
          return btn;
        };
        tabsEl.appendChild(mkTab("all", t("all") || "All"));
        for (const w of groupEntry.members) {
          tabsEl.appendChild(mkTab(w.id, w.name || "Feed"));
        }
      } else {
        tabsEl.classList.add("hidden");
      }
    }

    if (!listEl) return;
    listEl.innerHTML = "";
    const visibleMembers = activeFilterWidgetId === "all"
      ? groupEntry.members
      : groupEntry.members.filter(w => w.id === activeFilterWidgetId);
    const needsPermission = visibleMembers.some(w => rssCacheByWidget[w.id]?.error === "Permission required");
    if (needsPermission) {
      const notice = document.createElement("div");
      notice.className = "rss-modal-permission-notice";
      const msg = document.createElement("span");
      msg.textContent = t("rssPermissionRequiredNotice")
        || "Host permission is required to fetch this feed. Click Refresh (↻) or Grant permission & Refresh.";
      const grantBtn = document.createElement("button");
      grantBtn.type = "button";
      grantBtn.className = "icon-btn primary rss-grant-permission-btn";
      grantBtn.textContent = t("rssGrantPermissionAndRefresh") || "Grant permission & Refresh";
      grantBtn.addEventListener("click", () => {
        void handleRefresh(grantBtn);
      });
      notice.append(msg, grantBtn);
      listEl.appendChild(notice);
    }

    if (items.length === 0) {
      if (!needsPermission) {
        const empty = document.createElement("div");
        empty.className = "rss-modal-empty";
        empty.textContent = t("rssEmpty") || "No articles available.";
        listEl.appendChild(empty);
      }
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "rss-modal-item" + (item.read ? " is-read" : " is-unread");

      const mainBtn = document.createElement("button");
      mainBtn.type = "button";
      mainBtn.className = "rss-item-main";
      mainBtn.title = item.link;

      const dot = document.createElement("span");
      dot.className = "rss-item-dot";

      const titleSpan = document.createElement("span");
      titleSpan.className = "rss-item-title";
      titleSpan.textContent = item.title;

      const meta = document.createElement("span");
      meta.className = "rss-item-meta";
      const timeStr = formatRelativeFeedTime(item.publishedAt);
      meta.textContent = groupEntry.members.length > 1 && activeFilterWidgetId === "all"
        ? (timeStr ? `${item.widgetName} · ${timeStr}` : item.widgetName)
        : timeStr;

      mainBtn.append(dot, titleSpan, meta);
      mainBtn.addEventListener("click", async () => {
        await markRssItemRead(item.widgetId, item.id);
        updateRssBarDom(barEl, groupEntry);
        renderModalBody();
        window.open(item.link, "_blank", "noopener,noreferrer");
      });

      const toggleReadBtn = document.createElement("button");
      toggleReadBtn.type = "button";
      toggleReadBtn.className = "rss-item-toggle-read";
      const toggleLabel = item.read
        ? (t("rssMarkUnread") || "Mark as unread")
        : (t("rssMarkRead") || "Mark as read");
      toggleReadBtn.title = toggleLabel;
      toggleReadBtn.setAttribute("aria-label", toggleLabel);
      toggleReadBtn.textContent = item.read ? "●" : "✓";
      const toggleKey = `${item.widgetId}:${item.id}`;
      toggleReadBtn.dataset.rssToggleKey = toggleKey;
      toggleReadBtn.addEventListener("click", async () => {
        const hadFocus = document.activeElement === toggleReadBtn;
        toggleReadBtn.disabled = true;
        try {
          if (item.read) {
            await markRssItemUnread(item.widgetId, item.id);
          } else {
            await markRssItemRead(item.widgetId, item.id);
          }
          updateRssBarDom(barEl, groupEntry);
          renderModalBody(hadFocus ? toggleKey : null);
        } finally {
          toggleReadBtn.disabled = false;
        }
      });

      row.append(mainBtn, toggleReadBtn);
      listEl.appendChild(row);
    }

    if (prevScrollTop > 0) {
      listEl.scrollTop = prevScrollTop;
    }
    if (focusToggleKey) {
      for (const btn of listEl.querySelectorAll(".rss-item-toggle-read")) {
        if (btn.dataset.rssToggleKey === focusToggleKey) {
          btn.focus();
          break;
        }
      }
    }
  };

  if (markAllBtn) {
    markAllBtn.onclick = async () => {
      await markAllRssItemsRead(groupEntry.members);
      updateRssBarDom(barEl, groupEntry);
      renderModalBody();
    };
  }

  const handleRefresh = async (triggerBtn = null) => {
    if (refreshBtn) refreshBtn.disabled = true;
    if (triggerBtn && triggerBtn !== refreshBtn) triggerBtn.disabled = true;
    try {
      for (const w of groupEntry.members) {
        await requestRssFeedPermission(w.feedUrl);
        const res = await fetchRssFeedWidget(w);
        rssCacheByWidget[w.id] = {
          fetchedAt: Date.now(),
          feedTitle: res.feedTitle || "",
          items: res.ok ? res.items : (rssCacheByWidget[w.id]?.items || []),
          error: res.ok ? null : res.error
        };
      }
      await persistRssCache();
      updateRssBarDom(barEl, groupEntry);
      renderModalBody();
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
      if (triggerBtn && triggerBtn !== refreshBtn) triggerBtn.disabled = false;
    }
  };

  if (refreshBtn) {
    refreshBtn.onclick = () => handleRefresh(refreshBtn);
  }

  renderModalBody();
  modal.classList.remove("hidden");
}

export function syncCustomRssWidgetElements(customWidgets = []) {
  const groups = groupRssFeedWidgets(customWidgets);
  const validKeys = new Set(groups.map(g => g.representative.id));

  document.querySelectorAll(".custom-rss-widget").forEach(el => {
    if (!validKeys.has(el.dataset.widgetId)) {
      el.remove();
    }
  });

  const elements = {};
  for (const groupEntry of groups) {
    const rep = groupEntry.representative;
    let el = document.querySelector(`.custom-rss-widget[data-widget-id="${rep.id}"]`);
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "custom-rss-widget";
      el.dataset.widgetId = rep.id;

      const iconWrap = document.createElement("span");
      iconWrap.className = "custom-rss-icon";

      const nameEl = document.createElement("span");
      nameEl.className = "custom-rss-name";

      const badgeEl = document.createElement("span");
      badgeEl.className = "custom-rss-badge hidden";

      const headlineEl = document.createElement("span");
      headlineEl.className = "custom-rss-headline";

      el.append(iconWrap, nameEl, badgeEl, headlineEl);
    }

    const iconWrap = el.querySelector(".custom-rss-icon");
    if (iconWrap) {
      iconWrap.innerHTML = "";
      iconWrap.appendChild(createCustomWidgetIconElement(rep));
    }
    const nameEl = el.querySelector(".custom-rss-name");
    if (nameEl) {
      nameEl.textContent = groupEntry.groupName || rep.name || "Feed";
    }
    el.onclick = () => {
      void openRssFeedModal(groupEntry, el);
    };
    updateRssBarDom(el, groupEntry);
    elements[rep.id] = el;
  }

  void ensureRssCacheLoaded().then(async () => {
    const settingsModal = typeof document !== "undefined" ? document.getElementById("settings-modal") : null;
    if (!settingsModal || settingsModal.classList.contains("hidden")) {
      await pruneRssStorageForWidgets(customWidgets);
    }
    for (const groupEntry of groups) {
      const el = elements[groupEntry.representative.id];
      if (el) updateRssBarDom(el, groupEntry);
    }
  });

  return elements;
}

export async function pollAllRssFeedWidgets({ force = false, customWidgets = null } = {}) {
  await ensureRssCacheLoaded();
  let widgets = customWidgets;
  if (!Array.isArray(widgets)) {
    try {
      const { loadConfig } = await import("../config.js");
      widgets = (await loadConfig())?.appearance?.customWidgets || [];
    } catch {
      widgets = [];
    }
  }

  await pruneRssStorageForWidgets(widgets);

  const rssWidgets = widgets.filter(w => w?.type === "rss-feed" && isValidRssFeedUrl(w.feedUrl));
  if (rssWidgets.length === 0) return;

  const now = Date.now();
  let anyUpdated = false;

  for (const w of rssWidgets) {
    const cache = rssCacheByWidget[w.id];
    const refreshMs = normalizeRssRefreshMinutes(w.refreshMinutes) * 60 * 1000;
    if (!force && cache?.fetchedAt && (now - cache.fetchedAt) < refreshMs) {
      continue;
    }
    const res = await fetchRssFeedWidget(w);
    rssCacheByWidget[w.id] = {
      fetchedAt: Date.now(),
      feedTitle: res.feedTitle || "",
      items: res.ok ? res.items : (cache?.items || []),
      error: res.ok ? null : res.error
    };
    anyUpdated = true;
  }

  if (anyUpdated) {
    await persistRssCache();
    for (const groupEntry of groupRssFeedWidgets(widgets)) {
      const el = document.querySelector(`.custom-rss-widget[data-widget-id="${groupEntry.representative.id}"]`);
      if (el) updateRssBarDom(el, groupEntry);
    }
  }
}

export function startRssFeedPolling() {
  if (rssPollingIntervalId) return;
  rssPollingIntervalId = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void pollAllRssFeedWidgets();
  }, 60 * 1000);
}
