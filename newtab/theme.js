import { THEME_KEY } from "./state.js";

// ---------- Load theme ----------
export async function loadTheme() {
  const res = await chrome.storage.local.get(THEME_KEY);
  const saved = res && res[THEME_KEY];

  if (saved === "theme-light" || saved === "theme-dark") {
    document.body.className = saved;
  }
}

// ---------- Toggle theme ----------
const themeToggle = document.getElementById("theme-toggle");

themeToggle.addEventListener("click", async () => {
  const isDark = document.body.classList.contains("theme-dark");
  const next = isDark ? "theme-light" : "theme-dark";

  document.body.className = next;
  await chrome.storage.local.set({ [THEME_KEY]: next });
});
