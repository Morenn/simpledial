import { THEME_KEY } from "./state.js";
import { loadConfig } from "./config.js";

const BACKGROUND_IMAGE_CACHE_KEY = "myspeeddial-background-image-cache";

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


// ---------- Load theme ----------
export async function loadTheme() {
  const res = await chrome.storage.local.get(THEME_KEY);
  const saved = res && res[THEME_KEY];

  if (saved === "theme-light" || saved === "theme-dark") {
    document.body.className = saved;
  }

  const config = await loadConfig();
  const cachedBackground = await getBackgroundImageFromCache();
  if (cachedBackground && !config.appearance?.backgroundImage) {
    config.appearance = { ...(config.appearance || {}), backgroundImage: cachedBackground };
  }

  // Load background image
  await applyBackground(config);

  // Load tile opacity
  await applyTileOpacity(config);
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

// ---------- Toggle theme ----------
const themeToggle = document.getElementById("theme-toggle");

themeToggle.addEventListener("click", async () => {
  const isDark = document.body.classList.contains("theme-dark");
  const next = isDark ? "theme-light" : "theme-dark";

  document.body.className = next;
  await chrome.storage.local.set({ [THEME_KEY]: next });
});
