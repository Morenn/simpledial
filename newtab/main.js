import { loadState, saveState, state } from "./state.js";
import { loadTheme } from "./theme.js";
import { render } from "./render.js";
import { refreshBookmarkIconsIfNeeded } from "./bookmarks.js";
import { loadConfig } from "./config.js";
import { syncRead, syncWrite, startSyncLoop, cleanupDeletedItems } from "./sync.js";
import { initLanguage, setLanguage, getCurrentLanguage, t, getAvailableLanguages } from "./i18n.js";
import { runBackupInitCheck } from "./backup.js";

// Make t global for modules that don't import it
window.t = t;

const dateTimeDisplay = document.getElementById("date-time-display");
const ICON_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000;
let isDateTimeEnabled = false;
let dateTimePreviewEnabled = null;
let dateFormatter = null;
let formatterLocale = "";

function getEffectiveDateTimeEnabled() {
  return dateTimePreviewEnabled ?? isDateTimeEnabled;
}

function applyDateTimeVisibility() {
  if (!dateTimeDisplay) return;
  dateTimeDisplay.style.display = getEffectiveDateTimeEnabled() ? "block" : "none";
}

function updateDateTimeEnabledFromConfig(config) {
  isDateTimeEnabled = (config?.appearance?.showDateTime ?? true);
  applyDateTimeVisibility();
}

function getDateFormatter(locale) {
  if (dateFormatter && formatterLocale === locale) {
    return dateFormatter;
  }

  formatterLocale = locale;
  try {
    dateFormatter = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch (e) {
    dateFormatter = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  return dateFormatter;
}

// Settings UI can preview date/time visibility immediately without persisting config.
window.setDateTimePreviewEnabled = function setDateTimePreviewEnabled(enabled) {
  dateTimePreviewEnabled = typeof enabled === "boolean" ? enabled : null;
  applyDateTimeVisibility();
  updateClock();
};

window.clearDateTimePreview = function clearDateTimePreview() {
  dateTimePreviewEnabled = null;
  applyDateTimeVisibility();
  updateClock();
};

window.applySavedDateTimeEnabled = function applySavedDateTimeEnabled(enabled) {
  isDateTimeEnabled = !!enabled;
  dateTimePreviewEnabled = null;
  applyDateTimeVisibility();
  updateClock();
};

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

// Refresh UI when data changes (e.g., after sync)
window.addEventListener('speeddial:data-changed', () => render());

function startIconRefreshLoop() {
  setInterval(async () => {
    try {
      const changed = await refreshBookmarkIconsIfNeeded({ force: false, persist: true, sync: false });
      if (changed) {
        await render();
      }
    } catch (err) {
      console.warn("icon refresh loop failed", err);
    }
  }, ICON_REFRESH_CHECK_INTERVAL_MS);
}

(async function init() {
  // 1) Initialize language
  await initLanguage();

  // 2) Load saved state (groups, bookmarks, deleted items)
  await loadState();

  // 3) Load and apply theme
  await loadTheme();

  const config = await loadConfig();
  updateDateTimeEnabledFromConfig(config);

  const showDeletedToggle = document.getElementById("show-deleted-toggle");
  if (showDeletedToggle) {
    showDeletedToggle.checked = !!config.appearance?.showDeleted;
    showDeletedToggle.dispatchEvent(new Event("change"));
  }

  // 7) Setup language selector
  setupLanguageSelector();

  // 8) Update initial UI text
  updateUIText();

  // 9) Render UI immediately with local data — does not wait for network
  render();

  // 10) Start the clock display
  setInterval(updateClock, 1000);
  updateClock();

  // 4) Sync (in background, with re-render after data changes)
  if (config.sync.enabled && (config.sync.serverUrl || config.sync.type === 'browser')) {
    (async () => {
      const cloud = await syncRead();

      if (cloud && cloud.groups) {
        if (cloud.groups.length === 0 && state.groups.length > 0) {
          await syncWrite();
        } else {
          state.groups = cloud.groups;
          await saveState();
          render(); // re-render UI after loading cloud data
        }
      } else {
        console.warn("Sync server is unavailable, using local data");
        showSyncUnavailableNotification();
      }
    })().catch(err => console.warn("initial sync failed", err));
  }

  // 5) Start sync loop
  startSyncLoop();

  // 5b) Backup check (in background, non-blocking)
  runBackupInitCheck().catch(err => console.error("Backup init check failed", err));

  // 6) Housekeeping cleanup (in  background, non-blocking)
  if (config.housekeeper?.autoCleanupEnabled) {
    const retentionDays = config.housekeeper?.retentionDays || 30;
    cleanupDeletedItems(retentionDays).catch(err => console.error("Housekeeping cleanup failed", err));
  }

  // 11) Refresh bookmark icons (in background, non-blocking)
  refreshBookmarkIconsIfNeeded({ force: false, persist: true, sync: false })
    .then(changed => { if (changed) render(); })
    .catch(err => console.warn("icon refresh failed", err));
  startIconRefreshLoop();
})();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const configChange = changes["myspeeddial-config"];
  if (!configChange || !configChange.newValue) return;

  updateDateTimeEnabledFromConfig(configChange.newValue);
  updateClock();
});

// Language selector setup
export function setupLanguageSelector() {
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
        updateClock();
      }
    });
  }
}

/**
 * Updates the date and time display element with localized formatting, 
 * only if the feature is enabled in settings.
 */
export function updateClock() {
  if (!dateTimeDisplay) return;

  if (!getEffectiveDateTimeEnabled()) {
    applyDateTimeVisibility();
    return;
  }

  applyDateTimeVisibility();

  const now = new Date();
  const currentLocale = getCurrentLanguage();

  // Time is always computed manually — reliable across environments.
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  // const seconds = String(now.getSeconds()).padStart(2, '0');
  // const timeString = `${hours}:${minutes}:${seconds}`;
  const timeString = `${hours}:${minutes}`;

  let dateString = "";
  try {
    dateString = getDateFormatter(currentLocale).format(now);
  } catch (e) {
    const weekday = now.toLocaleDateString(currentLocale, { weekday: "long" });
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    dateString = `${weekday}, ${year}-${month}-${day}`;
  }

  // Combine date and time components robustly.
  let displayContent;
  if (dateString && timeString) {
      displayContent = `${dateString} | ${timeString}`;
  } else if (dateString) {
      displayContent = dateString;
  } else {
      displayContent = timeString;
  }

  dateTimeDisplay.textContent = displayContent;
}

// Update all UI text elements
export function updateUIText() {
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

  // Update translatable title/aria-label attributes while keeping key for future language switches.
  const attributeMappings = [
    { selector: '[title]', attr: 'title', keyAttr: 'data-i18n-title-key' },
    { selector: '[aria-label]', attr: 'aria-label', keyAttr: 'data-i18n-aria-key' }
  ];

  attributeMappings.forEach(({ selector, attr, keyAttr }) => {
    const nodes = document.querySelectorAll(selector);
    nodes.forEach(node => {
      const storedKey = node.getAttribute(keyAttr);
      const currentValue = node.getAttribute(attr);
      const key = storedKey || currentValue;
      if (!key) return;

      const translated = t(key);
      const keyIsTranslatable = translated !== key;

      if (keyIsTranslatable || storedKey) {
        if (!storedKey) {
          node.setAttribute(keyAttr, key);
        }
        node.setAttribute(attr, translated);
      }
    });
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
