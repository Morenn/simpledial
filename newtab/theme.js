import { THEME_KEY } from "./state.js";
import { loadConfig, saveConfig } from "./config.js";
import { t } from "./i18n.js";
import { isAllowedThemeUrl } from "./color-utils.js";
import {
  VALID_WIDGET_SPACES,
  normalizeWidgetOrder
} from "./widgets/shared.js";

const widgetModuleCache = new Map();

async function getWidgetModuleIfActive(type, customWidgets) {
  const hasActive = customWidgets.some(w => w?.type === type && w?.space !== "disabled");
  if (!hasActive && !widgetModuleCache.has(type)) {
    return null;
  }
  if (!widgetModuleCache.has(type)) {
    let loadedMod = null;
    if (type === "custom-search") {
      loadedMod = await import("./widgets/search-widget.js");
    } else if (type === "timezone") {
      loadedMod = await import("./widgets/timezone-widget.js");
    } else if (type === "rest-status") {
      loadedMod = await import("./widgets/rest-status-widget.js");
    } else if (type === "notes") {
      loadedMod = await import("./widgets/notes-widget.js");
    } else if (type === "rss-feed") {
      loadedMod = await import("./widgets/rss-widget.js");
    } else if (type === "weather") {
      loadedMod = await import("./widgets/weather-widget.js");
    } else {
      return null;
    }
    widgetModuleCache.set(type, loadedMod);
  }
  return widgetModuleCache.get(type);
}

export { isAllowedThemeUrl };

const BACKGROUND_IMAGE_CACHE_KEY = "myspeeddial-background-image-cache";
export const MAX_BACKGROUND_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_BACKGROUND_IMAGE_FETCH_BYTES = 25 * 1024 * 1024; // 25 MB raw fetch safety cap before downscale
const MAX_BACKGROUND_WIDTH = 1920;
const MAX_BACKGROUND_HEIGHT = 1080;
const CUSTOM_THEME_CSS_CACHE_KEY = "myspeeddial-custom-theme-css-cache";
const CUSTOM_THEME_URL_CACHE_KEY = "myspeeddial-custom-theme-url-cache";
const THEME_OVERRIDE_LINK_ID = "theme-override-stylesheet";
const THEME_CUSTOM_STYLE_ID = "theme-custom-style";

export const BUILTIN_THEME_FILES = {
  spring: "themes/spring.css",
  summer: "themes/summer.css",
  autumn: "themes/autumn.css",
  winter: "themes/winter.css"
};

export async function getBackgroundImageFromCache() {
  const res = await chrome.storage.local.get(BACKGROUND_IMAGE_CACHE_KEY);
  const cached = res && res[BACKGROUND_IMAGE_CACHE_KEY];
  return typeof cached === "string" && cached.trim() ? cached : null;
}

export async function saveBackgroundImageToCache(bgImage) {
  if (!bgImage) {
    await chrome.storage.local.remove(BACKGROUND_IMAGE_CACHE_KEY);
    return;
  }

  await chrome.storage.local.set({ [BACKGROUND_IMAGE_CACHE_KEY]: bgImage });
}

export async function getCustomThemeCssFromCache() {
  const res = await chrome.storage.local.get(CUSTOM_THEME_CSS_CACHE_KEY);
  const cached = res && res[CUSTOM_THEME_CSS_CACHE_KEY];
  return typeof cached === "string" && cached.trim() ? cached : "";
}

export async function saveCustomThemeCssToCache(cssText) {
  if (!cssText || typeof cssText !== "string" || !cssText.trim()) {
    await chrome.storage.local.remove(CUSTOM_THEME_CSS_CACHE_KEY);
    return;
  }

  await chrome.storage.local.set({ [CUSTOM_THEME_CSS_CACHE_KEY]: cssText });
}

export async function getCustomThemeUrlCache() {
  const res = await chrome.storage.local.get(CUSTOM_THEME_URL_CACHE_KEY);
  const cached = res && res[CUSTOM_THEME_URL_CACHE_KEY];
  if (cached && typeof cached.url === "string" && typeof cached.css === "string") {
    return cached;
  }
  return null;
}

export async function saveCustomThemeUrlCache(url, cssText) {
  if (!url || typeof cssText !== "string" || !cssText.trim()) {
    await chrome.storage.local.remove(CUSTOM_THEME_URL_CACHE_KEY);
    return;
  }

  await chrome.storage.local.set({
    [CUSTOM_THEME_URL_CACHE_KEY]: { url: String(url).trim(), css: cssText }
  });
}

function isAllowedBackgroundImage(bgImage) {
  if (!bgImage || typeof bgImage !== "string") return false;

  const trimmed = bgImage.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("//")) return false;

  try {
    const parsed = new URL(trimmed, window.location.href);
    return parsed.protocol !== "http:" && parsed.protocol !== "https:";
  } catch {
    return true;
  }
}


function getOriginPattern(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.protocol}//${parsed.host}/*`;
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

export async function fetchAndCacheThemeUrl(rawUrl, { saveCache = true } = {}) {
  const trimmed = String(rawUrl || "").trim();
  if (!isAllowedThemeUrl(trimmed)) {
    throw new Error("INVALID_THEME_URL");
  }

  const baseHref = typeof window !== "undefined" && window.location?.href ? window.location.href : undefined;
  const parsed = new URL(trimmed, baseHref);

  const originPattern = getOriginPattern(parsed.href);
  if (originPattern && typeof chrome !== "undefined" && chrome.permissions?.request) {
    try {
      await chrome.permissions.request({ origins: [originPattern] });
    } catch {
      // Proceed to fetch in case host permission is already active or not supported
    }
  }

  const response = await fetch(parsed.href, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  const contentType = response.headers?.get?.("content-type")?.toLowerCase() || "";
  if (contentType.includes("text/html")) {
    throw new Error("URL returned HTML instead of CSS");
  }

  const cssText = await response.text();
  if (!cssText || !cssText.trim()) {
    throw new Error("Theme CSS file is empty");
  }
  if (/^\s*(<!doctype\s+html|<html[\s>])/i.test(cssText)) {
    throw new Error("URL returned HTML instead of CSS");
  }

  if (saveCache) {
    await saveCustomThemeUrlCache(parsed.href, cssText);
  }
  return { url: parsed.href, css: cssText };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read image data"));
    reader.readAsDataURL(blob);
  });
}

function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== "string") return 0;
  const commaIdx = dataUrl.indexOf(",");
  const b64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
  return Math.floor((b64Len * 3) / 4);
}

/**
 * Downscales and re-encodes a background image Blob if it exceeds dimensions
 * (1920x1080) or `maxBytes` (`MAX_BACKGROUND_IMAGE_BYTES`).
 */
export async function downscaleBackgroundImage(blob, maxBytes = MAX_BACKGROUND_IMAGE_BYTES) {
  if (!blob || blob.size === 0) {
    throw new Error("Image file is empty");
  }

  const maxMbLabel = Math.max(1, Math.round(maxBytes / (1024 * 1024)));

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    if (blob.size > maxBytes) {
      throw new Error(`Image file is too large (max ${maxMbLabel}MB)`);
    }
    return blobToDataUrl(blob);
  }

  let srcBitmap = null;
  try {
    srcBitmap = await createImageBitmap(blob);
  } catch {
    // Fallback for formats createImageBitmap may reject (e.g. SVG)
    if (blob.size > maxBytes) {
      throw new Error(`Image file is too large (max ${maxMbLabel}MB)`);
    }
    return blobToDataUrl(blob);
  }

  try {
    const { width, height } = srcBitmap;
    const scale = Math.min(1, MAX_BACKGROUND_WIDTH / width, MAX_BACKGROUND_HEIGHT / height);

    if (scale >= 1 && blob.size <= maxBytes) {
      return blobToDataUrl(blob);
    }

    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (blob.size > maxBytes) {
        throw new Error(`Image file is too large (max ${maxMbLabel}MB)`);
      }
      return blobToDataUrl(blob);
    }

    let resizedBitmap = null;
    try {
      resizedBitmap = scale < 1
        ? await createImageBitmap(blob, { resizeWidth: targetW, resizeHeight: targetH, resizeQuality: "high" })
        : srcBitmap;
      ctx.drawImage(resizedBitmap, 0, 0, targetW, targetH);
    } catch {
      ctx.drawImage(srcBitmap, 0, 0, targetW, targetH);
    } finally {
      if (resizedBitmap && resizedBitmap !== srcBitmap) {
        resizedBitmap.close?.();
      }
    }

    const qualities = [0.85, 0.72, 0.58];
    for (const mime of ["image/webp", "image/jpeg"]) {
      for (const q of qualities) {
        const candidate = canvas.toDataURL(mime, q);
        if (candidate.startsWith(`data:${mime}`) && estimateDataUrlBytes(candidate) <= maxBytes) {
          return candidate;
        }
      }
    }

    throw new Error(`Image file is too large (max ${maxMbLabel}MB)`);
  } finally {
    srcBitmap?.close?.();
  }
}

export async function fetchBackgroundImageFromUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!isAllowedThemeUrl(trimmed)) {
    throw new Error("INVALID_BG_URL");
  }

  const baseHref = typeof window !== "undefined" && window.location?.href ? window.location.href : undefined;
  const parsed = new URL(trimmed, baseHref);

  const originPattern = getOriginPattern(parsed.href);
  if (originPattern && typeof chrome !== "undefined" && chrome.permissions?.request) {
    try {
      await chrome.permissions.request({ origins: [originPattern] });
    } catch {
      // Proceed to fetch in case host permission is already active or not supported
    }
  }

  const response = await fetch(parsed.href, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  const contentType = response.headers?.get?.("content-type")?.toLowerCase() || "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error("URL did not return an image");
  }

  const blob = await response.blob();
  if (!blob || blob.size === 0) {
    throw new Error("Image file is empty");
  }
  if (blob.size > MAX_BACKGROUND_IMAGE_FETCH_BYTES) {
    throw new Error("Image file is too large to process");
  }

  const dataUrl = await downscaleBackgroundImage(blob, MAX_BACKGROUND_IMAGE_BYTES);
  return { url: parsed.href, dataUrl };
}

function removeElementIfPresent(id) {
  const el = document.getElementById(id);
  if (el) {
    if (typeof el.remove === "function") {
      el.remove();
    } else if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }
}

function ensureHeadLinkElement(href) {
  if (!document.head) return;
  let link = document.getElementById(THEME_OVERRIDE_LINK_ID);
  if (!link) {
    link = document.createElement("link");
    link.id = THEME_OVERRIDE_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.getAttribute?.("href") !== href) {
    link.href = href;
  }
}

function setHeadCustomStyle(cssText) {
  if (!cssText) {
    removeElementIfPresent(THEME_CUSTOM_STYLE_ID);
    return;
  }
  if (!document.head) return;
  let styleEl = document.getElementById(THEME_CUSTOM_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = THEME_CUSTOM_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = cssText;
}

// ---------- Apply override theme stylesheet ----------
export async function applyThemeStyle(config = null, options = {}) {
  if (!config) {
    config = await loadConfig();
  }

  const { persistCache = true, previewUrlCss = "" } = options || {};
  const appearance = config.appearance || {};
  const theme = typeof appearance.theme === "string" && appearance.theme ? appearance.theme : "default";

  if (Object.prototype.hasOwnProperty.call(BUILTIN_THEME_FILES, theme)) {
    setHeadCustomStyle("");
    ensureHeadLinkElement(BUILTIN_THEME_FILES[theme]);
    return;
  }

  if (theme === "custom-file") {
    removeElementIfPresent(THEME_OVERRIDE_LINK_ID);
    let cssText = typeof appearance.customThemeCss === "string" ? appearance.customThemeCss : "";
    if (cssText.trim()) {
      if (persistCache) {
        await saveCustomThemeCssToCache(cssText);
      }
    } else {
      cssText = await getCustomThemeCssFromCache();
    }
    setHeadCustomStyle(cssText);
    return;
  }

  if (theme === "custom-url") {
    const customUrl = typeof appearance.customThemeUrl === "string" ? appearance.customThemeUrl.trim() : "";
    if (!isAllowedThemeUrl(customUrl)) {
      removeElementIfPresent(THEME_OVERRIDE_LINK_ID);
      setHeadCustomStyle("");
      return;
    }

    if (typeof previewUrlCss === "string" && previewUrlCss.trim()) {
      if (persistCache) {
        await saveCustomThemeUrlCache(customUrl, previewUrlCss);
      }
      removeElementIfPresent(THEME_OVERRIDE_LINK_ID);
      setHeadCustomStyle(previewUrlCss);
      return;
    }

    const cachedEntry = await getCustomThemeUrlCache();
    const inlineCss = cachedEntry && cachedEntry.url === customUrl ? cachedEntry.css : "";
    if (inlineCss) {
      removeElementIfPresent(THEME_OVERRIDE_LINK_ID);
      setHeadCustomStyle(inlineCss);
      return;
    }

    // Attempt background fetch only when host permission is already granted or non-http(s) URL
    const originPattern = getOriginPattern(customUrl);
    let canFetchSilently = !originPattern;
    if (originPattern && typeof chrome !== "undefined" && chrome.permissions?.contains) {
      try {
        canFetchSilently = await chrome.permissions.contains({ origins: [originPattern] });
      } catch {
        canFetchSilently = false;
      }
    }

    if (canFetchSilently && typeof fetch === "function") {
      try {
        const fetched = await fetchAndCacheThemeUrl(customUrl, { saveCache: persistCache });
        removeElementIfPresent(THEME_OVERRIDE_LINK_ID);
        setHeadCustomStyle(fetched.css);
        return;
      } catch (err) {
        console.warn("Failed to load theme stylesheet from URL:", customUrl, err);
      }
    }

    removeElementIfPresent(THEME_OVERRIDE_LINK_ID);
    setHeadCustomStyle("");
    return;
  }

  // "default" or unrecognized value: revert to base style.css theme variables
  removeElementIfPresent(THEME_OVERRIDE_LINK_ID);
  setHeadCustomStyle("");
}

// ---------- Load theme ----------
export async function loadTheme(preloadedConfig = null) {
  const [res, config, cachedBackground] = await Promise.all([
    chrome.storage.local.get(THEME_KEY),
    preloadedConfig ? Promise.resolve(preloadedConfig) : loadConfig(),
    getBackgroundImageFromCache()
  ]);
  const saved = res && res[THEME_KEY];

  const modeClass = saved === "theme-light" ? "theme-light" : "theme-dark";
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(modeClass);

  if (cachedBackground && !config.appearance?.backgroundImage) {
    config.appearance = { ...(config.appearance || {}), backgroundImage: cachedBackground };
  }

  // Apply selected theme override CSS (default, summer, autumn, winter, custom file/URL)
  await applyThemeStyle(config);

  // Load background image (avoid redundant storage write when cache already matches)
  await applyBackground(config, { cachedBackground });

  // Load background dim overlay, opacities, sizes, and side spaces
  await applyBgDim(config);
  await applyTileOpacity(config);
  await applyBarOpacity(config);
  await applyTileSize(config);
  await applyGroupTileSize(config);
  await applySideSpaces(config);
}

// ---------- Apply background ----------
export async function applyBackground(config = null, options = {}) {
  if (!config) {
    config = await loadConfig();
  }

  const body = document.body;
  const hasKnownCache = Object.prototype.hasOwnProperty.call(options || {}, "cachedBackground");
  const hasExplicitBackgroundField = Boolean(
    config?.appearance && Object.prototype.hasOwnProperty.call(config.appearance, "backgroundImage")
  );
  const cachedBackground = hasKnownCache
    ? options.cachedBackground
    : (hasExplicitBackgroundField ? null : await getBackgroundImageFromCache());
  const bgImage = config.appearance?.backgroundImage ?? cachedBackground;
  const bgSize = config.appearance?.backgroundSize || "stretched";

  if (config.appearance && bgImage && config.appearance.backgroundImage !== bgImage) {
    config.appearance.backgroundImage = bgImage;
  }

  if (!bgImage) {
    if (!hasKnownCache || cachedBackground) {
      await saveBackgroundImageToCache(null);
    }
    // Remove background
    body.style.backgroundImage = "";
    body.style.backgroundSize = "";
    body.style.backgroundPosition = "";
    body.style.backgroundRepeat = "";
    body.style.backgroundAttachment = "";
    return;
  }

  if (!isAllowedBackgroundImage(bgImage)) {
    console.warn("Blocked remote background image URL for startup performance", bgImage);
    await saveBackgroundImageToCache(null);
    body.style.backgroundImage = "";
    body.style.backgroundSize = "";
    body.style.backgroundPosition = "";
    body.style.backgroundRepeat = "";
    body.style.backgroundAttachment = "";
    return;
  }

  if (!hasKnownCache || bgImage !== cachedBackground) {
    await saveBackgroundImageToCache(bgImage);
  }
  // Set base background image
  body.style.backgroundImage = `url('${bgImage}')`;
  body.style.backgroundAttachment = "fixed";

  // Apply size option
  switch (bgSize) {
    case "stretched":
      body.style.backgroundSize = "100% 100%";
      body.style.backgroundPosition = "center";
      body.style.backgroundRepeat = "no-repeat";
      break;
    case "fill":
      body.style.backgroundSize = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundRepeat = "no-repeat";
      break;
    case "fit":
      body.style.backgroundSize = "contain";
      body.style.backgroundPosition = "center";
      body.style.backgroundRepeat = "no-repeat";
      body.style.backgroundColor = "#000";
      break;
    case "tile":
      body.style.backgroundSize = "auto";
      body.style.backgroundPosition = "0 0";
      body.style.backgroundRepeat = "repeat";
      break;
    case "center":
      body.style.backgroundSize = "auto";
      body.style.backgroundPosition = "center";
      body.style.backgroundRepeat = "no-repeat";
      break;
    case "span":
      body.style.backgroundSize = "100% 100%";
      body.style.backgroundPosition = "0 0";
      body.style.backgroundRepeat = "no-repeat";
      break;
    default:
      body.style.backgroundSize = "100% 100%";
      body.style.backgroundPosition = "center";
      body.style.backgroundRepeat = "no-repeat";
  }
}

// ---------- Apply tile opacity ----------
export async function applyTileOpacity(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  const opacity = config.appearance?.tileOpacity ?? 1;
  // Set on body element where the CSS variable is defined with theme classes
  document.body.style.setProperty('--tile-opacity', opacity);
}

// ---------- Apply header & footer opacity ----------
export async function applyBarOpacity(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  const opacity = config.appearance?.barOpacity ?? 1;
  document.body.style.setProperty('--bar-opacity', opacity);
}

// ---------- Apply background dim overlay ----------
export async function applyBgDim(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  const raw = Number(config.appearance?.bgDim ?? 0);
  const dim = Number.isFinite(raw) ? Math.min(0.9, Math.max(0, raw)) : 0;
  document.body.style.setProperty('--bg-dim', dim);
}

function clampTileScale(rawSize) {
  const parsed = Number(rawSize);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(1.5, Math.max(0.5, parsed)) : 1;
}

// ---------- Apply tile size ----------
export async function applyTileSize(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  document.body.style.setProperty('--tile-scale', clampTileScale(config.appearance?.tileSize));
  document.body.classList.toggle("tall-bookmark-tiles", !!config.appearance?.tallBookmarkTiles);
  document.body.classList.toggle("clickable-bookmark-tags", config.appearance?.clickableTags !== false);
}

// ---------- Apply group tile size ----------
export async function applyGroupTileSize(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  document.body.style.setProperty('--group-tile-scale', clampTileScale(config.appearance?.groupTileSize));
}

// ---------- Lock/Unlock tile movements ----------
export async function applyTilesLock(config = null) {
  if (typeof document === "undefined") return;
  if (!config) {
    config = await loadConfig();
  }

  const isLocked = !!config.appearance?.lockTiles;
  document.body.classList.toggle("tiles-locked", isLocked);

  const lockBtn = document.getElementById("lock-tiles-btn");
  if (lockBtn) {
    lockBtn.textContent = isLocked ? "🔒" : "🔓";
    lockBtn.classList.toggle("locked", isLocked);
    const titleKey = isLocked ? "unlockTiles" : "lockTiles";
    const fallback = isLocked ? "Unlock tile movements" : "Lock tile movements";
    const translated = t(titleKey);
    const titleText = translated && translated !== titleKey ? translated : fallback;
    lockBtn.title = titleText;
    lockBtn.setAttribute("aria-label", titleText);
    lockBtn.setAttribute("data-i18n-title-key", titleKey);
    lockBtn.setAttribute("data-i18n-aria-key", titleKey);
  }
}


function normalizeWidgetSpace(rawSpace, fallback = "header") {
  return VALID_WIDGET_SPACES.has(rawSpace) ? rawSpace : fallback;
}

function syncSideSpaceContainer(spaceEl, showEmptySideSpaces, highlightSideSpaces) {
  if (!spaceEl) return;
  spaceEl.querySelectorAll(".side-space-placeholder").forEach(el => el.remove());

  const visibleWidgets = Array.from(spaceEl.children).filter(el => el.style.display !== "none");
  if (visibleWidgets.length === 0 && showEmptySideSpaces && highlightSideSpaces) {
    const placeholder = document.createElement("div");
    placeholder.className = "side-space-placeholder";
    placeholder.setAttribute("data-i18n", "widgetSpacePlaceholder");
    const label = t("widgetSpacePlaceholder");
    placeholder.textContent = label && label !== "widgetSpacePlaceholder" ? label : "Widget Space";
    spaceEl.appendChild(placeholder);
  }

  spaceEl.classList.toggle("collapsed", !showEmptySideSpaces && visibleWidgets.length === 0);
}

// ---------- Apply mandatory widget spaces, search field style & display flags ----------
export async function applySideSpaces(config = null) {
  if (typeof document === "undefined") return;
  if (!config) {
    config = await loadConfig();
  }

  const appearance = config.appearance || {};
  const showSideSpaces = !!appearance.showSideSpaces;
  const highlightSideSpaces = !!appearance.highlightSideSpaces;
  const groupsSpace = normalizeWidgetSpace(appearance.groupsSpace, "header");
  const searchSpace = normalizeWidgetSpace(appearance.searchSpace, "center");
  const manageSpace = normalizeWidgetSpace(appearance.manageSpace, "header");
  const syncStatusSpace = appearance.syncStatusSpace === "disabled"
    ? "disabled"
    : normalizeWidgetSpace(appearance.syncStatusSpace, "footer");
  const dateTimeSpace = (appearance.dateTimeSpace === "disabled" || appearance.showDateTime === false)
    ? "disabled"
    : normalizeWidgetSpace(appearance.dateTimeSpace, "footer");
  const bookmarksCountSpace = appearance.bookmarksCountSpace === "disabled"
    ? "disabled"
    : normalizeWidgetSpace(appearance.bookmarksCountSpace, "footer");
  const shortcutPaletteSpace = appearance.shortcutPaletteSpace === "disabled"
    ? "disabled"
    : normalizeWidgetSpace(appearance.shortcutPaletteSpace, "footer");
  const storageUsageSpace = (!appearance.storageUsageSpace || appearance.storageUsageSpace === "disabled")
    ? "disabled"
    : normalizeWidgetSpace(appearance.storageUsageSpace, "disabled");
  const customWidgets = Array.isArray(appearance.customWidgets) ? appearance.customWidgets : [];
  const autoRouteDefaults = (appearance.customSearchAutoRouteDefaults && typeof appearance.customSearchAutoRouteDefaults === "object")
    ? appearance.customSearchAutoRouteDefaults
    : {};
  const autoRouteIcons = (appearance.customSearchAutoRouteIcons && typeof appearance.customSearchAutoRouteIcons === "object")
    ? appearance.customSearchAutoRouteIcons
    : {};
  const [searchMod, tzMod, restMod, notesMod, rssMod, weatherMod] = await Promise.all([
    getWidgetModuleIfActive("custom-search", customWidgets),
    getWidgetModuleIfActive("timezone", customWidgets),
    getWidgetModuleIfActive("rest-status", customWidgets),
    getWidgetModuleIfActive("notes", customWidgets),
    getWidgetModuleIfActive("rss-feed", customWidgets),
    getWidgetModuleIfActive("weather", customWidgets)
  ]);
  const customElements = {
    ...(searchMod ? searchMod.syncCustomSearchWidgetElements(customWidgets, autoRouteDefaults, autoRouteIcons) : {}),
    ...(tzMod ? tzMod.syncCustomTimeZoneWidgetElements(customWidgets) : {}),
    ...(restMod ? restMod.syncCustomRestStatusWidgetElements(customWidgets) : {}),
    ...(notesMod ? notesMod.syncCustomNotesWidgetElements(customWidgets) : {}),
    ...(rssMod ? rssMod.syncCustomRssWidgetElements(customWidgets) : {}),
    ...(weatherMod ? weatherMod.syncCustomWeatherWidgetElements(customWidgets) : {})
  };
  const widgetOrder = normalizeWidgetOrder(appearance.widgetOrder, customWidgets);
  const rawSearchStyle = appearance.searchStyle;
  const searchStyle = (rawSearchStyle === "icon" || rawSearchStyle === "hover") ? rawSearchStyle : "full";

  document.body.classList.toggle("tall-bookmark-tiles", !!appearance.tallBookmarkTiles);
  document.body.classList.toggle("clickable-bookmark-tags", appearance.clickableTags !== false);
  document.body.classList.toggle("highlight-side-spaces", highlightSideSpaces);
  await applyTilesLock(config);

  const topBar = document.getElementById("top-bar");
  if (topBar) {
    topBar.classList.toggle("header-single-row", appearance.headerSingleRow !== false);
  }
  const leftSpace = document.getElementById("left-space");
  const rightSpace = document.getElementById("right-space");
  const centerWidgets = document.getElementById("center-space-widgets");
  const centerBottomWidgets = document.getElementById("center-space-bottom-widgets");
  const pageFooter = document.getElementById("page-footer");
  const footerWidgets = document.getElementById("footer-widgets");

  const groupsHeader = document.getElementById("groups-header");
  const searchWidget = document.getElementById("search-widget");
  const searchBox = document.getElementById("search-box");
  const dateTimeDisplay = document.getElementById("date-time-display");
  const manageActions = document.getElementById("manage-actions");
  const footerSyncStatus = document.getElementById("footer-sync-status");
  const footerShortcutPalette = document.getElementById("footer-shortcut-palette");
  const footerBookmarksTotal = document.getElementById("footer-bookmarks-total");
  const footerStorageUsage = document.getElementById("footer-storage-usage");

  const widgetElements = {
    groups: groupsHeader,
    search: searchWidget,
    manage: manageActions,
    syncStatus: footerSyncStatus,
    dateTime: dateTimeDisplay,
    shortcutPalette: footerShortcutPalette,
    bookmarksCount: footerBookmarksTotal,
    storageUsage: footerStorageUsage,
    ...customElements
  };
  const widgetSpaces = {
    groups: groupsSpace,
    search: searchSpace,
    manage: manageSpace,
    syncStatus: syncStatusSpace,
    dateTime: dateTimeSpace,
    shortcutPalette: shortcutPaletteSpace,
    bookmarksCount: bookmarksCountSpace,
    storageUsage: storageUsageSpace
  };
  const customAlignMap = {};
  const customNewRowMap = {};
  for (const cw of customWidgets) {
    if (!cw?.id) continue;
    widgetSpaces[cw.id] = cw.space === "disabled" ? "disabled" : normalizeWidgetSpace(cw.space, "right");
    if (cw.align) customAlignMap[cw.id] = cw.align;
    if (cw.newRow) customNewRowMap[cw.id] = true;
  }
  const bookmarksIndex = widgetOrder.indexOf("bookmarks");

  const spaceContainers = {
    left: leftSpace,
    right: rightSpace,
    footer: footerWidgets
  };

  [topBar, centerWidgets, centerBottomWidgets, footerWidgets].forEach(container => {
    container?.querySelectorAll(".widget-row-break").forEach(el => el.remove());
  });

  const widgetAlign = { ...customAlignMap, ...(appearance.widgetAlign || {}) };
  const widgetNewRow = { ...customNewRowMap, ...(appearance.widgetNewRow || {}) };
  const VALID_ALIGNS = new Set(["top", "bottom", "left", "right", "center"]);

  let hasVisibleHeaderWidget = false;

  for (let idx = 0; idx < widgetOrder.length; idx++) {
    const key = widgetOrder[idx];
    if (key === "bookmarks") continue;
    const el = widgetElements[key];
    if (!el) continue;

    const space = widgetSpaces[key];
    if (space === "disabled") {
      el.style.display = "none";
      el.dataset.space = "disabled";
      delete el.dataset.widgetAlign;
      continue;
    }
    if (key === "dateTime") {
      el.style.display = "block";
    } else if (key === "manage" || key === "groups" || key === "syncStatus" || customElements[key]) {
      el.style.display = "flex";
    } else if (key === "bookmarksCount" || key === "shortcutPalette" || key === "storageUsage") {
      el.style.display = "inline-flex";
    }

    const align = widgetAlign[key];
    if (VALID_ALIGNS.has(align)) {
      el.dataset.widgetAlign = align;
    } else {
      delete el.dataset.widgetAlign;
    }

    if (space === "header") {
      if (topBar) {
        if (widgetNewRow[key] && hasVisibleHeaderWidget) {
          const br = document.createElement("div");
          br.className = "widget-row-break";
          topBar.appendChild(br);
        }
        topBar.appendChild(el);
        hasVisibleHeaderWidget = true;
      }
    } else if (space === "center") {
      const targetCenter = idx > bookmarksIndex && centerBottomWidgets ? centerBottomWidgets : centerWidgets;
      if (targetCenter) {
        if (widgetNewRow[key] && targetCenter.children.length > 0) {
          const br = document.createElement("div");
          br.className = "widget-row-break";
          targetCenter.appendChild(br);
        }
        targetCenter.appendChild(el);
      }
    } else if (spaceContainers[space]) {
      const targetContainer = spaceContainers[space];
      if (space === "footer" && widgetNewRow[key] && targetContainer.children.length > 0) {
        const br = document.createElement("div");
        br.className = "widget-row-break";
        targetContainer.appendChild(br);
      }
      targetContainer.appendChild(el);
    }
    el.dataset.space = space;
  }

  if (searchWidget) {
    searchWidget.classList.toggle("search-mode-icon", searchStyle === "icon" || searchStyle === "hover");
    searchWidget.classList.toggle("search-mode-hover", searchStyle === "hover");
    searchWidget.classList.toggle("search-mode-full", searchStyle === "full");

    if (searchStyle === "full") {
      searchWidget.classList.remove("expanded");
    } else if (searchBox && searchBox.value.trim() !== "") {
      searchWidget.classList.add("expanded");
    }
  }

  syncSideSpaceContainer(leftSpace, showSideSpaces, highlightSideSpaces);
  syncSideSpaceContainer(rightSpace, showSideSpaces, highlightSideSpaces);

  if (footerStorageUsage && storageUsageSpace !== "disabled") {
    if (!footerStorageUsage.dataset.bound) {
      footerStorageUsage.dataset.bound = "true";
      footerStorageUsage.addEventListener("click", () => {
        document.getElementById("settings-btn")?.click();
        setTimeout(() => {
          document.querySelector('.settings-tab-btn[data-tab="info"]')?.click();
        }, 50);
      });
    }
    void import("./storage-stats.js").then(m => m.updateStorageUsageWidget(footerStorageUsage));
  }

  if (pageFooter) {
    const hasFooterWidget = footerWidgets && Array.from(footerWidgets.children).some(
      child => !child.classList.contains("widget-row-break") && child.style.display !== "none"
    );
    pageFooter.style.display = hasFooterWidget ? "" : "none";
  }
}

// ---------- Toggle theme & tile lock ----------
const themeToggle = typeof document !== "undefined" ? document.getElementById("theme-toggle") : null;
const lockTilesBtn = typeof document !== "undefined" ? document.getElementById("lock-tiles-btn") : null;

if (themeToggle) {
  themeToggle.addEventListener("click", async () => {
    const isDark = document.body.classList.contains("theme-dark");
    const next = isDark ? "theme-light" : "theme-dark";

    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(next);
    await chrome.storage.local.set({ [THEME_KEY]: next });
  });
}

if (lockTilesBtn) {
  lockTilesBtn.addEventListener("click", async () => {
    const config = await loadConfig();
    if (!config.appearance) config.appearance = {};
    config.appearance.lockTiles = !config.appearance.lockTiles;
    await saveConfig(config);
    await applyTilesLock(config);
    if (!config.appearance.lockTiles) {
      void import("./dragdrop.js").then(m => m.setupBookmarkDrag()).catch(() => {});
    }
  });
}
