import { state, saveState, generateId, loadState } from "./state.js";
import { loadTheme, applySideSpaces } from "./theme.js";
import { updateCustomTimeZoneWidgets, pollAllRestStatusWidgets, startRestStatusPolling, startNotesReminderPolling } from "./custom-widgets.js";
import { render, updateFooter, getSyncErrorLabel } from "./render.js";
import { refreshBookmarkIconsIfNeeded } from "./bookmarks.js";
import { loadConfig } from "./config.js";
import { syncNow, syncWrite, startSyncLoop, cleanupDeletedItems, clearLastSyncErrorReason } from "./sync.js";
import { initLanguage, setLanguage, getCurrentLanguage, t, getAvailableLanguages } from "./i18n.js";
import { runBackupInitCheck } from "./backup.js";
import { touchVaultActivity, checkVaultAutoLock, isVaultUnlocked } from "./crypto.js";
import "./browser-bookmarks-sync.js";

// Make t global for modules that don't import it
window.t = t;

const dateTimeDisplay = document.getElementById("date-time-display");
const ICON_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_SYNC_DELAY_MS = 1000;
let isDateTimeEnabled = false;
let dateTimePreviewEnabled = null;
let dateFormatter = null;
let formatterLocale = "";
let initialSyncInProgress = false;

function getEffectiveDateTimeEnabled() {
  return dateTimePreviewEnabled ?? isDateTimeEnabled;
}

function applyDateTimeVisibility() {
  if (!dateTimeDisplay) return;
  dateTimeDisplay.style.display = getEffectiveDateTimeEnabled() ? "block" : "none";
}

function updateDateTimeEnabledFromConfig(config) {
  const appearance = config?.appearance || {};
  isDateTimeEnabled = appearance.dateTimeSpace !== "disabled" && (appearance.showDateTime ?? true);
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
import { initKeyboardNavigation, updateShortcutPaletteButton } from "./keyboard-nav.js";

initKeyboardNavigation();

// Load context menu and drag-drop modules asynchronously to avoid blocking initial render
(async () => {
  await import("./contextmenu.js");
  await import("./dragdrop.js");
})();

window.addEventListener("keydown", e => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const ctrl = isMac ? e.metaKey : e.ctrlKey;

  if (ctrl && e.key.toLowerCase() === "f") {
    e.preventDefault();

    const searchWidget = document.getElementById("search-widget");
    if (searchWidget && searchWidget.classList.contains("search-mode-icon")) {
      searchWidget.classList.add("expanded");
    }

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
  // 1-3) Load language, bookmark state, and config in parallel
  let [, , config] = await Promise.all([
    initLanguage(),
    loadState(),
    loadConfig()
  ]);

  // 4) Load and apply theme using already-loaded config
  await loadTheme(config);
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

  // 10) Start the clock display (pause ticks when tab is hidden)
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    updateClock();
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") updateClock();
  });
  updateClock();
  setInterval(() => { void updateFooter(); }, 60000);
  setTimeout(() => {
    void pollAllRestStatusWidgets({ force: false });
    startRestStatusPolling();
    startNotesReminderPolling();
  }, 150);

  // Vault idle auto-lock monitoring (when vaultAutoLockMinutes > 0)
  let lastVaultActivityCheckMs = 0;
  const onVaultActivity = async () => {
    if (!isVaultUnlocked()) return;
    const now = Date.now();
    if (now - lastVaultActivityCheckMs < 15000) return;
    lastVaultActivityCheckMs = now;
    const latestCfg = await loadConfig();
    if (latestCfg?.vaultAutoLockMinutes > 0) {
      void touchVaultActivity(latestCfg.vaultAutoLockMinutes);
    }
  };
  document.addEventListener("pointerdown", () => { void onVaultActivity(); }, { passive: true });
  document.addEventListener("keydown", () => { void onVaultActivity(); }, { passive: true });
  setInterval(async () => {
    if (!isVaultUnlocked()) return;
    const latestCfg = await loadConfig();
    if (await checkVaultAutoLock(latestCfg?.vaultAutoLockMinutes || 0)) {
      void updateFooter(latestCfg);
      void pollAllRestStatusWidgets({ force: true });
    }
  }, 30000);

  // 4) Sync (in background, with re-render after data changes)
  if (config.sync.enabled && (config.sync.serverUrl || config.sync.type === 'browser')) {
    initialSyncInProgress = true;
    setTimeout(() => {
      (async () => {
        const result = await syncNow();
        void updateFooter();

        if (!result.ok) {
          console.warn("Sync failed:", result.reason || "unknown", result);
          const latestCfg = await loadConfig();
          if (result.reason === "credentials-locked" && latestCfg?.vaultMuteSyncLockedWarning) {
            return;
          }
          showSyncUnavailableNotification(result);
          return;
        }

        if (result.changed) {
          render(); // re-render UI after merging cloud data
        }
      })()
        .catch(err => console.warn("initial sync failed", err))
        .finally(() => {
          initialSyncInProgress = false;
        });
    }, STARTUP_SYNC_DELAY_MS);
  }

  // 5) Start sync loop
  startSyncLoop({
    initialDelayMs: 6000,
    shouldSkip: () => initialSyncInProgress
  });

  // 5b) Backup check (in background, non-blocking)
  runBackupInitCheck().catch(err => console.error("Backup init check failed", err));

  // 6) Housekeeping cleanup (in  background, non-blocking)
  if (config.housekeeper?.autoCleanupEnabled) {
    const retentionDays = config.housekeeper?.retentionDays || 30;
    cleanupDeletedItems(retentionDays).catch(err => console.error("Housekeeping cleanup failed", err));
  }
  config = null; // Release startup config reference from long-lived interval closures

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
  void applySideSpaces(configChange.newValue).then(() => render());
  updateClock();
  void updateFooter(configChange.newValue);
});

const addSectionBtn = document.getElementById("add-section-btn");
if (addSectionBtn) {
  addSectionBtn.addEventListener("click", async () => {
    const group = state.groups.find(g => g.id === window.activeGroupId && !g.deleted);
    if (!group) return;

    const suggested = t("defaultSectionName") || "New section";
    const entered = prompt(t("newSectionName") || "New section name:", suggested);
    if (entered === null) return;
    const name = entered.trim() || suggested;

    if (!Array.isArray(group.sections)) group.sections = [];
    const now = Date.now();
    group.sections.push({
      id: generateId("sec"),
      name,
      updatedAt: now,
      deleted: false,
      deletedAt: null
    });
    group.updatedAt = now;

    await saveState();
    await syncWrite();
    render();
  });
}

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

    // Handle language change (preview until saved in settings)
    langSelect.addEventListener("change", async (e) => {
      const newLang = e.target.value;
      if (await setLanguage(newLang, { persist: false })) {
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
  const now = new Date();
  updateCustomTimeZoneWidgets(now);

  if (!dateTimeDisplay) return;

  if (!getEffectiveDateTimeEnabled()) {
    applyDateTimeVisibility();
    return;
  }

  applyDateTimeVisibility();

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
  updateShortcutPaletteButton();
  // Search box & search controls
  const searchBox = document.getElementById("search-box");
  if (searchBox) searchBox.placeholder = t("searchPlaceholder");

  const searchToggleBtn = document.getElementById("search-toggle-btn");
  if (searchToggleBtn) {
    const searchTitle = t("searchPlaceholder");
    searchToggleBtn.title = searchTitle;
    searchToggleBtn.setAttribute("aria-label", searchTitle);
    searchToggleBtn.setAttribute("data-i18n-title-key", "searchPlaceholder");
    searchToggleBtn.setAttribute("data-i18n-aria-key", "searchPlaceholder");
  }

  const searchClearBtn = document.getElementById("search-clear-btn");
  if (searchClearBtn) {
    const clearTitle = t("clearSearch");
    searchClearBtn.title = clearTitle;
    searchClearBtn.setAttribute("aria-label", clearTitle);
    searchClearBtn.setAttribute("data-i18n-title-key", "clearSearch");
    searchClearBtn.setAttribute("data-i18n-aria-key", "clearSearch");
  }

  // Lock tiles button
  const lockTilesBtn = document.getElementById("lock-tiles-btn");
  if (lockTilesBtn) {
    const locked = document.body.classList.contains("tiles-locked");
    const lockKey = locked ? "unlockTiles" : "lockTiles";
    const lockTitle = t(lockKey);
    lockTilesBtn.title = lockTitle;
    lockTilesBtn.setAttribute("aria-label", lockTitle);
    lockTilesBtn.setAttribute("data-i18n-title-key", lockKey);
    lockTilesBtn.setAttribute("data-i18n-aria-key", lockKey);
  }

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

    const openNewTabItem = contextMenu.querySelector('[data-action="open-new-tab"]');
    if (openNewTabItem) openNewTabItem.textContent = t("openInNewTab");

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

  // Group modal
  const groupModal = document.getElementById("group-modal");
  if (groupModal) {
    const grpNameLabel = document.querySelector('label[for="grp-name"]');
    if (grpNameLabel) grpNameLabel.textContent = t("groupName");

    const grpEmojiLabel = document.querySelector('label[for="grp-emoji"]');
    if (grpEmojiLabel) grpEmojiLabel.textContent = t("groupEmoji");

    const grpIconLabel = document.querySelector('label[for="grp-icon"]');
    if (grpIconLabel) grpIconLabel.textContent = t("groupIcon");

    const grpSaveBtn = document.getElementById("grp-save");
    if (grpSaveBtn) grpSaveBtn.textContent = t("save");

    const grpCancelBtn = document.getElementById("grp-cancel");
    if (grpCancelBtn) grpCancelBtn.textContent = t("cancel");
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

function getLeadingIconPrefix(text) {
  const match = text.trim().match(/^(?:\u2139\uFE0F?|[^\p{L}\p{N}\s+-])+\s+/u);
  return match ? match[0] : "";
}

// Update settings modal text based on language
function updateSettingsModalText() {
  // Single pass over all [data-i18n] elements (covers p, button, label, span, etc.)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = t(key);

    if (el.tagName === 'P' || (el.tagName === 'LABEL' && !el.querySelector('span[data-i18n]'))) {
      el.textContent = text;
      return;
    }

    const emoji = getLeadingIconPrefix(el.textContent);
    if (emoji && !text.startsWith(emoji.trim())) {
      el.textContent = emoji + text;
    } else {
      el.textContent = text;
    }
  });

  // Update inputs with data-i18n-placeholder
  const placeholderEls = document.querySelectorAll('[data-i18n-placeholder]');
  placeholderEls.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
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

  if (typeof window.renderWidgetOrderList === "function") {
    window.renderWidgetOrderList();
  }
}

// Show notification when sync fails or credentials are locked
function showSyncUnavailableNotification(result = null) {
  const reason = result?.reason || null;
  const message = getSyncErrorLabel(reason);

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

  if (reason === "credentials-locked") {
    notification.textContent = `🔐 ${message} (${t("vaultLockedClickToUnlock") || "Vault locked — click badge to unlock"})`;
    notification.style.cursor = "pointer";
    notification.addEventListener("click", async () => {
      notification.remove();
      if (typeof window.promptUnlockVault === "function" && await window.promptUnlockVault()) {
        clearLastSyncErrorReason();
        void updateFooter();
        const r = await syncNow();
        void updateFooter();
        if (r?.changed) render();
      }
    });
  } else {
    notification.textContent = message;
  }

  document.body.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transition = "opacity 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("simpledial:config-synced", async () => {
    try {
      const cfg = await loadConfig();
      await loadTheme();
      await applySideSpaces(cfg);
      await render();
      updateUIText();
      updateClock();
    } catch (err) {
      console.warn("Failed to apply synced config to UI", err);
    }
  });
}
