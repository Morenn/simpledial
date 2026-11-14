import { THEME_KEY } from "./state.js";
import { loadConfig } from "./config.js";

const BACKGROUND_IMAGE_CACHE_KEY = "myspeeddial-background-image-cache";
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

export function isAllowedThemeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("//")) return false;

  try {
    const baseHref = typeof window !== "undefined" && window.location?.href ? window.location.href : undefined;
    const parsed = new URL(trimmed, baseHref);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "chrome-extension:" ||
      parsed.protocol === "moz-extension:"
    );
  } catch {
    return false;
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
export async function loadTheme() {
  const res = await chrome.storage.local.get(THEME_KEY);
  const saved = res && res[THEME_KEY];

  const modeClass = saved === "theme-light" ? "theme-light" : "theme-dark";
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(modeClass);

  const config = await loadConfig();
  const cachedBackground = await getBackgroundImageFromCache();
  if (cachedBackground && !config.appearance?.backgroundImage) {
    config.appearance = { ...(config.appearance || {}), backgroundImage: cachedBackground };
  }

  // Apply selected theme override CSS (default, summer, autumn, winter, custom file/URL)
  await applyThemeStyle(config);

  // Load background image
  await applyBackground(config);

  // Load tile opacity
  await applyTileOpacity(config);

  // Load tile size
  await applyTileSize(config);

  // Load group tile size
  await applyGroupTileSize(config);
}

// ---------- Apply background ----------
export async function applyBackground(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  const body = document.body;
  const cachedBackground = await getBackgroundImageFromCache();
  const bgImage = config.appearance?.backgroundImage || cachedBackground;
  const bgSize = config.appearance?.backgroundSize || "stretched";

  if (config.appearance && bgImage && config.appearance.backgroundImage !== bgImage) {
    config.appearance.backgroundImage = bgImage;
  }

  if (!bgImage) {
    await saveBackgroundImageToCache(null);
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

  await saveBackgroundImageToCache(bgImage);
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
}

// ---------- Apply group tile size ----------
export async function applyGroupTileSize(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  document.body.style.setProperty('--group-tile-scale', clampTileScale(config.appearance?.groupTileSize));
}

// ---------- Toggle theme ----------
const themeToggle = typeof document !== "undefined" ? document.getElementById("theme-toggle") : null;

if (themeToggle) {
  themeToggle.addEventListener("click", async () => {
    const isDark = document.body.classList.contains("theme-dark");
    const next = isDark ? "theme-light" : "theme-dark";

    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(next);
    await chrome.storage.local.set({ [THEME_KEY]: next });
  });
}
