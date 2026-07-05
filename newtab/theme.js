import { THEME_KEY } from "./state.js";
import { loadConfig } from "./config.js";

// ---------- Load theme ----------
export async function loadTheme() {
  const res = await chrome.storage.local.get(THEME_KEY);
  const saved = res && res[THEME_KEY];

  if (saved === "theme-light" || saved === "theme-dark") {
    document.body.className = saved;
  }

  // Load background image
  await applyBackground();

  // Load tile opacity
  await applyTileOpacity();
}

// ---------- Apply background ----------
export async function applyBackground(config = null) {
  if (!config) {
    config = await loadConfig();
  }

  const body = document.body;
  const bgImage = config.appearance?.backgroundImage;
  const bgSize = config.appearance?.backgroundSize || "stretched";

  if (!bgImage) {
    // Remove background
    body.style.backgroundImage = "";
    body.style.backgroundSize = "";
    body.style.backgroundPosition = "";
    body.style.backgroundRepeat = "";
    body.style.backgroundAttachment = "";
    return;
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

// ---------- Toggle theme ----------
const themeToggle = document.getElementById("theme-toggle");

themeToggle.addEventListener("click", async () => {
  const isDark = document.body.classList.contains("theme-dark");
  const next = isDark ? "theme-light" : "theme-dark";

  document.body.className = next;
  await chrome.storage.local.set({ [THEME_KEY]: next });
});
