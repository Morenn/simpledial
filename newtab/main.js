import { state, saveState, generateId, loadState, STORAGE_KEY, THEME_KEY, ACTIVE_GROUP_KEY, SYSTEM_TAGS_KEY, applyStateFromStorageChange, applySystemTagsFromStorageChange } from "./state.js";
import { loadTheme, applySideSpaces, BACKGROUND_IMAGE_CACHE_KEY, CUSTOM_THEME_CSS_CACHE_KEY, CUSTOM_THEME_URL_CACHE_KEY } from "./theme.js";
import { render, updateFooter, getSyncErrorLabel, isShowDeletedEnabled, bindShowDeletedToggleListener } from "./render.js";
import { refreshBookmarkIconsIfNeeded } from "./bookmarks.js";
import { loadConfig, updateDebugLoggingFlags, logDebug, shouldSync, CONFIG_STORAGE_KEY } from "./config.js";
import { initLanguage, setLanguage, getCurrentLanguage, t, getAvailableLanguages } from "./i18n.js";
import { prefetchStartupStorage, clearStartupStorageCache } from "./storage-cache.js";
import { loadSyncModule, getLoadedSyncModule, loadCryptoModule, getLoadedCryptoModule } from "./lazy-modules.js";

let tzWidgetMod = null;
let restWidgetMod = null;
let rssWidgetMod = null;
let weatherWidgetMod = null;
let notesReminderStarted = false;
let caldavReminderStarted = false;

function startActiveCustomWidgets(config) {
  const customWidgets = Array.isArray(config?.appearance?.customWidgets) ? config.appearance.customWidgets : [];
  if (!tzWidgetMod && customWidgets.some(w => w?.type === "timezone" && w?.space !== "disabled")) {
    void import("./widgets/timezone-widget.js").then(m => {
      tzWidgetMod = m;
      m.updateCustomTimeZoneWidgets();
    });
  }
  if (!restWidgetMod && customWidgets.some(w => w?.type === "rest-status" && w?.space !== "disabled")) {
    void import("./widgets/rest-status-widget.js").then(m => {
      restWidgetMod = m;
      void m.pollAllRestStatusWidgets({ force: false });
      m.startRestStatusPolling();
    });
  }
  if (!notesReminderStarted && customWidgets.some(w => w?.type === "notes" && w?.space !== "disabled")) {
    notesReminderStarted = true;
    void import("./widgets/notes-widget.js").then(m => {
      m.startNotesReminderPolling();
    });
  }
  const calendarSources = Array.isArray(config?.appearance?.calendarSources)
    ? config.appearance.calendarSources
    : [];
  if (
    !caldavReminderStarted &&
    calendarSources.some(
      (s) =>
        s &&
        (s.type === "caldav" || s.type === "webcal") &&
        Boolean(s.url) &&
        s.enabled !== false &&
        (s.enableReminders !== undefined ? Boolean(s.enableReminders) : s.type === "caldav"),
    )
  ) {
    caldavReminderStarted = true;
    void import("./calendar-reminders.js").then(m => {
      m.startCalendarReminderPolling();
    });
  }
  if (customWidgets.some(w => w?.type === "rss-feed" && w?.space !== "disabled")) {
    if (!rssWidgetMod) {
      void import("./widgets/rss-widget.js").then(m => {
        rssWidgetMod = m;
        void m.pollAllRssFeedWidgets({ force: false });
        m.startRssFeedPolling();
      });
    } else {
      void rssWidgetMod.pollAllRssFeedWidgets({ force: false });
    }
  }
  if (customWidgets.some(w => w?.type === "weather" && w?.space !== "disabled")) {
    if (!weatherWidgetMod) {
      void import("./widgets/weather-widget.js").then(m => {
        weatherWidgetMod = m;
        void m.pollAllWeatherWidgets({ force: false });
        m.startWeatherPolling();
      });
    } else {
      void weatherWidgetMod.pollAllWeatherWidgets({ force: false });
    }
  }
}

// Make t global for modules that don't import it
window.t = t;

let settingsModalsLoadPromise = null;
async function ensureSettingsModalsLoaded() {
  if (document.getElementById("settings-modal") && document.getElementById("custom-widget-editor-modal")) {
    return;
  }
  if (!settingsModalsLoadPromise) {
    settingsModalsLoadPromise = (async () => {
      const runtimeApi = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;
      const url = runtimeApi.getURL("newtab/settings-modals.html");
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load settings-modals.html (${response.status})`);
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const settingsAnchor = document.getElementById("custom-widget-trust-modal");
      const editorAnchor = document.getElementById("custom-widget-new-group-modal");
      for (const child of Array.from(doc.body.children)) {
        if (child.id && document.getElementById(child.id)) continue;
        const imported = document.importNode(child, true);
        if (imported.id === "settings-modal" && settingsAnchor?.parentNode === document.body) {
          document.body.insertBefore(imported, settingsAnchor);
        } else if (imported.id === "custom-widget-editor-modal" && editorAnchor?.parentNode === document.body) {
          document.body.insertBefore(imported, editorAnchor);
        } else {
          document.body.appendChild(imported);
        }
      }
      const showDeletedToggle = document.getElementById("show-deleted-toggle");
      if (showDeletedToggle) {
        showDeletedToggle.checked = document.body?.dataset?.showDeleted === "true";
        if (!showDeletedToggle.dataset.appearanceBound) {
          showDeletedToggle.dataset.appearanceBound = "true";
          showDeletedToggle.addEventListener("change", () => {
            updateShowDeletedButtonAppearance();
          });
        }
        bindShowDeletedToggleListener();
      }
      setupLanguageSelector();
      updateSettingsModalText("#settings-modal, #custom-widget-editor-modal");
    })().catch(err => {
      settingsModalsLoadPromise = null;
      throw err;
    });
  }
  return settingsModalsLoadPromise;
}

let settingsUiLoadPromise = null;
async function ensureSettingsUiLoaded() {
  if (!settingsUiLoadPromise) {
    settingsUiLoadPromise = (async () => {
      await ensureSettingsModalsLoaded();
      return await import("./settings-ui.js");
    })().catch(err => {
      settingsUiLoadPromise = null;
      throw err;
    });
  }
  return settingsUiLoadPromise;
}

const lazyPromptUnlockVault = async () => {
  await ensureSettingsUiLoaded();
  if (typeof window.promptUnlockVault === "function" && window.promptUnlockVault !== lazyPromptUnlockVault) {
    return window.promptUnlockVault();
  }
  return false;
};
window.promptUnlockVault = lazyPromptUnlockVault;

window.openSyncSettings = async () => {
  const mod = await ensureSettingsUiLoaded();
  await mod.openSettingsModal("sync");
};

window.openInfoSettings = async () => {
  const mod = await ensureSettingsUiLoaded();
  await mod.openSettingsModal("info");
};

window.openSyncMergeWizard = async () => {
  const mod = await ensureSettingsUiLoaded();
  if (typeof mod.openSyncMergeWizard === "function") {
    await mod.openSyncMergeWizard();
  } else {
    await mod.openSettingsModal("sync");
  }
};

document.getElementById("settings-btn")?.addEventListener("click", async () => {
  const mod = await ensureSettingsUiLoaded();
  await mod.openSettingsModal();
});

const headerManualSyncBtn = document.getElementById("manual-sync-btn");
function updateHeaderManualSyncButton(config) {
  if (!headerManualSyncBtn) return;
  const show = !!(config?.sync?.enabled && config?.sync?.intervalMode === "manual");
  headerManualSyncBtn.classList.toggle("hidden", !show);
}

if (headerManualSyncBtn) {
  headerManualSyncBtn.addEventListener("click", async () => {
    headerManualSyncBtn.disabled = true;
    headerManualSyncBtn.textContent = "⬆️";
    headerManualSyncBtn.style.opacity = "0.5";
    try {
      const { syncNow } = await loadSyncModule();
      const result = await syncNow({ includeManualExtras: true, force: true });
      void updateFooter(null, { allowLazyLoad: true });
      if (result.ok) {
        if (result.changed) {
          render();
        }
      } else {
        showSyncUnavailableNotification(result);
      }
    } finally {
      setTimeout(() => {
        headerManualSyncBtn.disabled = false;
        headerManualSyncBtn.style.opacity = "1";
      }, 1000);
    }
  });
}

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

if (dateTimeDisplay) {
  dateTimeDisplay.setAttribute("role", "button");
  dateTimeDisplay.setAttribute("tabindex", "0");
  dateTimeDisplay.setAttribute("aria-haspopup", "dialog");
  dateTimeDisplay.setAttribute("aria-expanded", "false");

  const openOrToggleDateTimeCalendar = async () => {
    const { toggleDateTimeCalendarPopover } = await import("./calendar-popover.js");
    await toggleDateTimeCalendarPopover(dateTimeDisplay);
  };

  dateTimeDisplay.addEventListener("click", () => {
    void openOrToggleDateTimeCalendar();
  });

  dateTimeDisplay.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void openOrToggleDateTimeCalendar();
    }
  });
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

let keyboardNavPromise = null;
function ensureKeyboardNavLoaded() {
  if (!keyboardNavPromise) {
    keyboardNavPromise = import("./keyboard-nav.js").then(m => {
      m.initKeyboardNavigation();
      return m;
    });
  }
  return keyboardNavPromise;
}

document.addEventListener("keydown", () => {
  void ensureKeyboardNavLoaded();
}, { once: true, passive: true });

document.getElementById("footer-shortcut-palette")?.addEventListener("click", async () => {
  if (!keyboardNavPromise) {
    const m = await ensureKeyboardNavLoaded();
    m.updateShortcutPaletteButton?.();
    document.getElementById("footer-shortcut-palette")?.click();
  }
}, { once: true });

// contextmenu loads lazily on first right-click; dragdrop loads lazily only when tiles are unlocked

let contextMenuLoaded = false;
document.addEventListener("contextmenu", async e => {
  if (contextMenuLoaded) return;
  const groupTab = e.target?.closest?.(".group-tab");
  const bookmarkTile = e.target?.closest?.(".bookmark-tile");
  if (!groupTab && !bookmarkTile) return;
  if (groupTab?.classList?.contains("add-group")) return;
  if (bookmarkTile?.classList?.contains("add-bookmark")) return;
  e.preventDefault();
  contextMenuLoaded = true;
  const mod = await import("./contextmenu.js");
  mod.handleContextMenu(e);
});

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

export function updateShowDeletedButtonAppearance() {
  const showDeletedBtn = document.getElementById("show-deleted-btn");
  if (!showDeletedBtn) return;
  if (isShowDeletedEnabled()) {
    showDeletedBtn.style.opacity = "1";
    showDeletedBtn.style.transform = "scale(1.1)";
  } else {
    showDeletedBtn.style.opacity = "0.6";
    showDeletedBtn.style.transform = "scale(1)";
  }
}

(async function init() {
  const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const tInitStart = perfNow();
  const timeStep = async (fn) => {
    const start = perfNow();
    const res = await fn();
    return { res, ms: Math.round(perfNow() - start) };
  };

  // 1-3) Prefetch startup storage keys in one batch, then load language, bookmark state, and config in parallel
  await prefetchStartupStorage([
    CONFIG_STORAGE_KEY,
    STORAGE_KEY,
    SYSTEM_TAGS_KEY,
    ACTIVE_GROUP_KEY,
    THEME_KEY,
    BACKGROUND_IMAGE_CACHE_KEY,
    CUSTOM_THEME_CSS_CACHE_KEY,
    CUSTOM_THEME_URL_CACHE_KEY
  ]);
  const [langRes, stateRes, configRes] = await Promise.all([
    timeStep(() => initLanguage()),
    timeStep(() => loadState()),
    timeStep(() => loadConfig())
  ]);
  let config = configRes.res;
  const tAfterData = perfNow();

  // 4) Load and apply theme using already-loaded config
  updateDebugLoggingFlags(config.advanced);
  await loadTheme(config);
  clearStartupStorageCache();
  const tAfterTheme = perfNow();
  updateDateTimeEnabledFromConfig(config);

  if (document.body) {
    document.body.dataset.showDeleted = config.appearance?.showDeleted ? "true" : "false";
  }
  const showDeletedBtn = document.getElementById("show-deleted-btn");
  const showDeletedToggle = document.getElementById("show-deleted-toggle");
  if (showDeletedBtn && !showDeletedBtn.dataset.bound) {
    showDeletedBtn.dataset.bound = "true";
    showDeletedBtn.addEventListener("click", () => {
      const nextValue = !isShowDeletedEnabled();
      if (document.body) {
        document.body.dataset.showDeleted = nextValue ? "true" : "false";
      }
      const currentToggle = document.getElementById("show-deleted-toggle");
      if (currentToggle) {
        currentToggle.checked = nextValue;
        currentToggle.dispatchEvent(new Event("change"));
      } else {
        render();
      }
      updateShowDeletedButtonAppearance();
    });
  }
  if (showDeletedToggle) {
    if (!showDeletedToggle.dataset.appearanceBound) {
      showDeletedToggle.dataset.appearanceBound = "true";
      showDeletedToggle.addEventListener("change", () => {
        updateShowDeletedButtonAppearance();
      });
    }
    showDeletedToggle.checked = !!config.appearance?.showDeleted;
  }
  updateShowDeletedButtonAppearance();

  // 7) Setup language selector
  setupLanguageSelector();

  // 8) Update initial visible UI text before first render; defer hidden modals until after paint
  updateUIText({ includeModals: false });

  // 9) Render UI immediately with local data — does not wait for network
  await render(config);
  const tAfterRender = perfNow();
  logDebug("startupTiming", {
    moduleLoadMs: Math.round(tInitStart),
    initLanguageMs: langRes.ms,
    loadStateMs: stateRes.ms,
    loadConfigMs: configRes.ms,
    dataParallelMs: Math.round(tAfterData - tInitStart),
    loadThemeMs: Math.round(tAfterTheme - tAfterData),
    renderMs: Math.round(tAfterRender - tAfterTheme),
    totalToRenderMs: Math.round(tAfterRender)
  });

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
  const initialWidgetsSnapshot = {
    appearance: {
      customWidgets: config.appearance?.customWidgets,
      calendarSources: config.appearance?.calendarSources
    }
  };
  updateHeaderManualSyncButton(config);
  const startupSyncEnabled = !!(config.sync.enabled && (config.sync.serverUrl || config.sync.type === 'browser') && shouldSync(config));
  const startupHousekeeperCleanup = config.housekeeper?.autoCleanupEnabled
    ? (config.housekeeper?.retentionDays || 30)
    : 0;
  config = null; // Release startup config reference from long-lived interval closures

  const scheduleAfterFirstPaint = callback => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(callback, 0));
    } else {
      setTimeout(callback, 0);
    }
  };

  // Vault idle auto-lock monitoring (when vaultAutoLockMinutes > 0)
  let lastVaultActivityCheckMs = 0;
  const getCryptoModuleForAutoLock = async latestCfg => {
    const loaded = getLoadedCryptoModule();
    if (loaded) return loaded;
    if (latestCfg?.vaultHeader && latestCfg?.vaultAutoLockMinutes > 0) {
      return await loadCryptoModule();
    }
    return null;
  };
  const onVaultActivity = async () => {
    const preloadedCrypto = getLoadedCryptoModule();
    if (preloadedCrypto && !preloadedCrypto.isVaultUnlocked()) return;
    const now = Date.now();
    if (now - lastVaultActivityCheckMs < 15000) return;
    lastVaultActivityCheckMs = now;
    const latestCfg = await loadConfig();
    if (!(latestCfg?.vaultAutoLockMinutes > 0)) return;
    const cryptoMod = await getCryptoModuleForAutoLock(latestCfg);
    if (cryptoMod?.isVaultUnlocked()) {
      void cryptoMod.touchVaultActivity(latestCfg.vaultAutoLockMinutes);
    }
  };
  document.addEventListener("pointerdown", () => { void onVaultActivity(); }, { passive: true });
  document.addEventListener("keydown", () => { void onVaultActivity(); }, { passive: true });
  const runVaultAutoLockCheck = async () => {
    const preloadedCrypto = getLoadedCryptoModule();
    if (preloadedCrypto && !preloadedCrypto.isVaultUnlocked()) return;
    const latestCfg = await loadConfig();
    const cryptoMod = await getCryptoModuleForAutoLock(latestCfg);
    if (!cryptoMod?.isVaultUnlocked()) return;
    if (await cryptoMod.checkVaultAutoLock(latestCfg?.vaultAutoLockMinutes || 0)) {
      void updateFooter(latestCfg, { allowLazyLoad: true });
      void restWidgetMod?.pollAllRestStatusWidgets?.({ force: true });
    }
  };
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void runVaultAutoLockCheck();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void runVaultAutoLockCheck();
    }
  });

  // Defer background startup work until after the first paint completes.
  scheduleAfterFirstPaint(() => {
    updateSettingsModalText();
    void updateFooter(null, { allowLazyLoad: true });
    setTimeout(() => {
      const hasBookmarks = Array.isArray(state.groups) && state.groups.some(
        g => !g?.deleted && Array.isArray(g.items) && g.items.some(i => !i?.deleted)
      );
      if (hasBookmarks) {
        void ensureKeyboardNavLoaded();
      }
      startActiveCustomWidgets(initialWidgetsSnapshot);
    }, 150);

    // 4) Sync (in background, with re-render after data changes)
    if (startupSyncEnabled) {
      initialSyncInProgress = true;
      setTimeout(() => {
        (async () => {
          const { syncNow } = await loadSyncModule();
          const result = await syncNow();
          void updateFooter(null, { allowLazyLoad: true });

          if (!result.ok) {
            if (result.reason === "credentials-locked") {
              logDebug("sync", "Sync skipped: credentials-locked", result);
              const latestCfg = await loadConfig();
              if (latestCfg?.vaultMuteSyncLockedWarning) {
                return;
              }
            } else {
              console.warn("Sync failed:", result.reason || "unknown", result);
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
    void loadSyncModule()
      .then(({ startSyncLoop }) => startSyncLoop({
        initialDelayMs: 6000,
        shouldSkip: () => initialSyncInProgress
      }))
      .catch(err => console.warn("Sync loop init failed", err));

    // 5b) Backup check & browser bookmarks sync (deferred in background, non-blocking)
    setTimeout(() => {
      void import("./backup.js")
        .then(m => m.runBackupInitCheck())
        .catch(err => console.error("Backup init check failed", err));
      void import("./browser-bookmarks-sync.js")
        .catch(err => console.warn("Browser bookmarks sync init failed", err));
    }, 800);

    // 6) Housekeeping cleanup (in background, non-blocking)
    if (startupHousekeeperCleanup > 0) {
      loadSyncModule()
        .then(({ cleanupDeletedItems }) => cleanupDeletedItems(startupHousekeeperCleanup))
        .catch(err => console.error("Housekeeping cleanup failed", err));
    }

    // 11) Refresh bookmark icons (in background, non-blocking)
    refreshBookmarkIconsIfNeeded({ force: false, persist: true, sync: false })
      .then(changed => { if (changed) render(); })
      .catch(err => console.warn("icon refresh failed", err));
    startIconRefreshLoop();
  });
})();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let shouldRender = false;
  const dataChange = changes[STORAGE_KEY];
  if (dataChange?.newValue && applyStateFromStorageChange(dataChange.newValue)) {
    shouldRender = true;
    void updateFooter();
  }

  const systemTagsChange = changes[SYSTEM_TAGS_KEY];
  if (systemTagsChange && applySystemTagsFromStorageChange(systemTagsChange.newValue ?? {})) {
    shouldRender = true;
  }

  if (shouldRender) {
    render();
  }

  const themeChange = changes[THEME_KEY];
  const configChange = changes["myspeeddial-config"];
  if (!configChange?.newValue) {
    if (themeChange) {
      void loadTheme();
    }
    return;
  }

  updateDebugLoggingFlags(configChange.newValue.advanced);
  updateDateTimeEnabledFromConfig(configChange.newValue);
  updateHeaderManualSyncButton(configChange.newValue);
  const appearanceChanged = themeChange ||
    JSON.stringify(configChange.oldValue?.appearance ?? null) !== JSON.stringify(configChange.newValue?.appearance ?? null);
  if (appearanceChanged) {
    void loadTheme(configChange.newValue).then(() => {
      startActiveCustomWidgets(configChange.newValue);
      render(configChange.newValue);
    });
  }
  updateClock();
  void updateFooter(configChange.newValue, { allowLazyLoad: true });
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
    const { syncWrite } = await loadSyncModule();
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
    if (!langSelect.dataset.bound) {
      langSelect.dataset.bound = "true";
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
}

/**
 * Updates the date and time display element with localized formatting, 
 * only if the feature is enabled in settings.
 */
export function updateClock() {
  const now = new Date();
  tzWidgetMod?.updateCustomTimeZoneWidgets?.(now);

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
export function updateUIText({ includeModals = true } = {}) {
  window._updateShortcutPaletteButton?.();
  if (dateTimeDisplay) {
    dateTimeDisplay.title = t("dateTimeCalendarTitle");
  }
  window.refreshDateTimeCalendarPopover?.();
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

  // Update settings modal text (and other hidden modals) when requested
  if (includeModals) {
    updateSettingsModalText();
  } else {
    updateSettingsModalText("#top-bar, #workspace-main, footer");
  }
}

function getLeadingIconPrefix(text) {
  const match = text.trim().match(/^(?:\u2139\uFE0F?|[^\p{L}\p{N}\s+-])+\s+/u);
  return match ? match[0] : "";
}

// Update settings modal text based on language
function updateSettingsModalText(rootSelector = null) {
  const roots = rootSelector
    ? Array.from(document.querySelectorAll(rootSelector))
    : [document];
  const queryAllInRoots = (selector) => roots.flatMap(r => Array.from(r.querySelectorAll(selector)));

  // Single pass over all [data-i18n] elements (covers p, button, label, span, etc.)
  queryAllInRoots('[data-i18n]').forEach(el => {
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
  const placeholderEls = queryAllInRoots('[data-i18n-placeholder]');
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
    const nodes = queryAllInRoots(selector);
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
        getLoadedSyncModule()?.clearLastSyncErrorReason();
        void updateFooter(null, { allowLazyLoad: true });
      }
    });
  } else if (reason === "stale-device-conflict" || reason === "dbuid-mismatch") {
    notification.textContent = `⚠️ ${message} — ${t("syncStaleClickToResolve") || "Click to resolve"}`;
    notification.style.cursor = "pointer";
    notification.addEventListener("click", async () => {
      notification.remove();
      await window.openSyncMergeWizard?.();
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
  window.addEventListener("speeddial:sync-status-changed", () => {
    void updateFooter();
  });
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
