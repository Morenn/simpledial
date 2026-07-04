import { loadState, saveState, state } from "./state.js";
import { loadTheme } from "./theme.js";
import { render } from "./render.js";
import { loadConfig } from "./config.js";
import { syncRead, syncWrite, startSyncLoop } from "./sync.js";
import { initLanguage, setLanguage, getCurrentLanguage, t, getAvailableLanguages } from "./i18n.js";

// Make t global for modules that don't import it
window.t = t;

// Listener activation
import "./groups.js";
import "./bookmarks.js";
import "./contextmenu.js";
import "./dragdrop.js";

window.addEventListener("keydown", e => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const ctrl = isMac ? e.metaKey : e.ctrlKey;

  if (ctrl && e.key.toLowerCase() === "f") {
    e.preventDefault();

    const search = document.getElementById("search-box");
    if (search) {
      search.focus();
      search.select();

      // Pulse effect
      search.classList.remove("search-pulse"); // reset if the effect was recently active
      void search.offsetWidth;                // force reflow
      search.classList.add("search-pulse");
    }
  }
});

(async function init() {
  // 1) Initialize language
  await initLanguage();

  // 2) Load saved state (groups, bookmarks, deleted items)
  await loadState();

  // 3) Load and apply theme
  await loadTheme();

  // 4) Initialize sync if enabled
  const config = await loadConfig();
  
  if (config.sync.enabled && (config.sync.serverUrl || config.sync.type === 'browser')) {
    const cloud = await syncRead();

    if (cloud && cloud.groups) {
      if (cloud.groups.length === 0 && state.groups.length > 0) {
        // Remote is empty, preserve local entries and push them to remote first
        await syncWrite();
      } else {
        // 🔥 We sync only groups, not whole state
        state.groups = cloud.groups;
        await saveState();
      }
    } else if (config.sync.enabled) {
      // Sync is enabled but server is unavailable - notify user
      console.warn("Sync server is unavailable, using local data");
      showSyncUnavailableNotification();
    }
  }

  // 5) Start sync loop to keep data updated across tabs and with server
  startSyncLoop();

  // 6) Setup language selector
  setupLanguageSelector();

  // 7) Update initial UI text
  updateUIText();

  // 8) Render UI
  render();
})();

// Language selector setup
function setupLanguageSelector() {
  const langSelect = document.getElementById("language-select");
  if (langSelect) {
    // Populate options from LANG_FILES (via i18n.getAvailableLanguages)
    try {
      const langs = getAvailableLanguages();
      // Clear any existing options
      langSelect.innerHTML = "";
      langs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.code;
        opt.textContent = l.name;
        langSelect.appendChild(opt);
      });
    } catch (err) {
      console.warn('Failed to populate language selector', err);
    }

    // Set current language
    langSelect.value = getCurrentLanguage();

    // Handle language change
    langSelect.addEventListener("change", (e) => {
      const newLang = e.target.value;
      if (setLanguage(newLang)) {
        // Re-render UI with new language
        render();
        // Update all UI text
        updateUIText();
      }
    });
  }
}

// Update all UI text elements
function updateUIText() {
  // Search box
  const searchBox = document.getElementById("search-box");
  if (searchBox) searchBox.placeholder = t("searchPlaceholder");

  // Theme toggle
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) themeToggle.title = t("themeToggle");

  // Settings button (moved to modal)
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) settingsBtn.title = t("settings") || "Settings";

  // Show deleted button
  const showDeletedBtn = document.getElementById("show-deleted-btn");
  if (showDeletedBtn) showDeletedBtn.title = t("showDeleted");

  // Manual sync button
  const manualSyncBtn = document.getElementById("manual-sync-btn");
  if (manualSyncBtn) manualSyncBtn.title = t("syncNow");

  // Context menu
  const contextMenu = document.getElementById("context-menu");
  if (contextMenu) {
    const editItem = contextMenu.querySelector('[data-action="edit"]');
    if (editItem) editItem.textContent = t("edit");

    const deleteItem = contextMenu.querySelector('[data-action="delete"]');
    if (deleteItem) deleteItem.textContent = t("delete");

    const restoreItem = contextMenu.querySelector('[data-action="restore"]');
    if (restoreItem) restoreItem.textContent = t("restore");

    const deletePermanentItem = contextMenu.querySelector('[data-action="delete-permanent"]');
    if (deletePermanentItem) deletePermanentItem.textContent = t("deletePermanent");

    const refreshItem = contextMenu.querySelector('[data-action="refresh-icon"]');
    if (refreshItem) refreshItem.textContent = t("refreshIcon");
  }

  // Bookmark modal
  const modalTitle = document.getElementById("modal-title");
  if (modalTitle) {
    // Title is set dynamically in bookmarks.js, but we can update labels
    const titleLabel = document.querySelector('label[for="bm-title"]');
    if (titleLabel) titleLabel.textContent = t("bookmarkTitle");

    const urlLabel = document.querySelector('label[for="bm-url"]');
    if (urlLabel) urlLabel.textContent = t("bookmarkUrl");

    const iconLabel = document.querySelector('label[for="bm-icon"]');
    if (iconLabel) iconLabel.textContent = t("bookmarkIcon");

    const saveBtn = document.getElementById("bm-save");
    if (saveBtn) saveBtn.textContent = t("save");

    const cancelBtn = document.getElementById("bm-cancel");
    if (cancelBtn) cancelBtn.textContent = t("cancel");
  }

  // Sync modal
  const syncModal = document.getElementById("sync-modal");
  if (syncModal) {
    const syncTitle = syncModal.querySelector("h2");
    if (syncTitle) syncTitle.textContent = t("syncServer");

    const serverLabel = syncModal.querySelector("label");
    if (serverLabel && serverLabel.textContent.includes("Server URL")) {
      serverLabel.textContent = t("serverUrl");
    }

    const syncUrl = document.getElementById("sync-url");
    if (syncUrl) syncUrl.placeholder = "https://sync.local/speeddial.json"; // Keep placeholder as-is for now

    const testBtn = document.getElementById("sync-test");
    if (testBtn) testBtn.textContent = t("testConnection");

    const enableLabel = syncModal.querySelector(".checkbox-row");
    if (enableLabel && enableLabel.lastElementChild) {
      enableLabel.lastElementChild.textContent = t("enableSync");
    }

    const saveSyncBtn = document.getElementById("sync-save");
    if (saveSyncBtn) saveSyncBtn.textContent = t("saveSettings");

    const closeBtn = document.getElementById("sync-cancel");
    if (closeBtn) closeBtn.textContent = t("close");
  }

  // Update settings modal text
  updateSettingsModalText();
}

// Update settings modal text based on language
function updateSettingsModalText() {
  // Get all elements with data-i18n attribute
  const elementsWithI18n = document.querySelectorAll('[data-i18n]');
  elementsWithI18n.forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = t(key);
    
    // Preserve emoji/icon if present
    const content = el.textContent.trim();
    const emojiMatch = content.match(/^[^\w\s]+\s+/); // Match emoji/icon at start
    const emoji = emojiMatch ? emojiMatch[0] : '';
    
    if (emoji) {
      el.textContent = emoji + text;
    } else {
      el.textContent = text;
    }
  });

  // Update specific paragraphs with data-i18n
  const paragraphs = document.querySelectorAll('p[data-i18n]');
  paragraphs.forEach(p => {
    const key = p.getAttribute('data-i18n');
    p.textContent = t(key);
  });

  // Update button text content
  const allButtons = document.querySelectorAll('button[data-i18n]');
  allButtons.forEach(btn => {
    const key = btn.getAttribute('data-i18n');
    const text = t(key);
    
    // Preserve emoji/icon if present
    const content = btn.textContent.trim();
    const emojiMatch = content.match(/^[^\w\s]+\s+/); // Match emoji/icon at start
    const emoji = emojiMatch ? emojiMatch[0] : '';
    
    if (emoji) {
      btn.textContent = emoji + text;
    } else {
      btn.textContent = text;
    }
  });

  // Update labels with spans inside them (checkboxes and radio buttons)
  const labelsWithSpans = document.querySelectorAll('label[class*="row"] span[data-i18n]');
  labelsWithSpans.forEach(span => {
    const key = span.getAttribute('data-i18n');
    const text = t(key);
    
    // Preserve emoji/icon if present
    const content = span.textContent.trim();
    const emojiMatch = content.match(/^[^\w\s]+\s+/); // Match emoji/icon at start
    const emoji = emojiMatch ? emojiMatch[0] : '';
    
    if (emoji) {
      span.textContent = emoji + text;
    } else {
      span.textContent = text;
    }
  });

  // Update labels without child spans
  const allLabels = document.querySelectorAll('label[data-i18n]');
  allLabels.forEach(label => {
    const key = label.getAttribute('data-i18n');
    const text = t(key);
    label.textContent = text;
  });
}

// Show notification when sync server is unavailable
function showSyncUnavailableNotification() {
  const notification = document.createElement("div");
  notification.className = "notification notification-warning";
  notification.style.position = "fixed";
  notification.style.top = "20px";
  notification.style.right = "20px";
  notification.style.padding = "12px 16px";
  notification.style.backgroundColor = "#ff9800";
  notification.style.color = "white";
  notification.style.borderRadius = "4px";
  notification.style.zIndex = "9999";
  notification.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
  notification.style.fontFamily = "system-ui, -apple-system, sans-serif";
  notification.style.fontSize = "14px";
  notification.textContent = t("syncServerUnavailable") || "Sync server is unavailable. Using local data.";

  document.body.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transition = "opacity 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}
