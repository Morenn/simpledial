import { loadConfig, saveConfig } from "./config.js";
import { t, getCurrentLanguage, setLanguage, resetLanguageToBrowser, getSavedLanguageOverride } from "./i18n.js";
import { render } from "./render.js";
import { cleanupOldBackups } from "./backup.js";
import { updateUIText, updateClock } from "./main.js";
import {
  settingsState,
  setSettingsDirty,
  markSettingsDirty,
  updateChoiceOptionStates
} from "./settings/context.js";
import {
  initSyncSettings,
  populateSyncSettings,
  applySyncToConfig,
  updateManualSyncButtonVisibility,
  setSyncStatusMessage,
  clearSyncStatuses
} from "./settings/sync-ui.js";
import {
  initBackupSettings,
  populateBackupSettings,
  applyBackupToConfig,
  refreshBackupsTable
} from "./settings/backup-ui.js";
import {
  initAppearanceSettings,
  populateAppearanceSettings,
  applyAppearanceToConfig,
  ensureAppearanceDraft,
  revertAppearancePreviewToSaved,
  updateDateTimeVisibility
} from "./settings/appearance-ui.js";
import {
  initHousekeeperSettings,
  updateHouseKeeperInfo,
  applyHousekeeperToConfig
} from "./settings/housekeeper-ui.js";
import { initCustomWidgetsSettings } from "./settings/custom-widgets-ui.js";

// ======================================================
// SETTINGS MODAL ORCHESTRATOR
// ======================================================

const settingsModal = document.getElementById("settings-modal");
const settingsBtn = document.getElementById("settings-btn");
const settingsSaveBtn = document.getElementById("settings-save");
const settingsSaveCloseBtn = document.getElementById("settings-save-close");
const settingsCancelBtn = document.getElementById("settings-cancel");
const languageSelect = document.getElementById("language-select");
const groupCountToggle = document.getElementById("group-count-toggle");

// Advanced Elements
const advFaviconDebugLogging = document.getElementById("enable-favicon-debug-logging");
const advDeadLinkDebugLogging = document.getElementById("enable-dead-link-debug-logging");
const advSyncDebugLogging = document.getElementById("enable-sync-debug-logging");
const advI18nHotReload = document.getElementById("enable-i18n-hot-reload");
const advExperimentalFaviconFetchLink = document.getElementById("enable-experimental-favicon-fetch-link");
const advExperimentalFaviconFetchManifest = document.getElementById("enable-experimental-favicon-fetch-manifest");

// Tab System
const tabButtons = document.querySelectorAll(".settings-tab-btn");
const tabContents = document.querySelectorAll(".settings-tab-content");

function applyAdvancedSettingsToControls(advancedConfig = {}) {
  if (advFaviconDebugLogging) {
    advFaviconDebugLogging.checked = advancedConfig.faviconDebugLogging ?? advancedConfig.enableDebugLogging ?? false;
  }
  if (advDeadLinkDebugLogging) {
    advDeadLinkDebugLogging.checked = advancedConfig.deadLinkDebugLogging ?? advancedConfig.enableDeadLinkDebugLogging ?? false;
  }
  if (advSyncDebugLogging) {
    advSyncDebugLogging.checked = advancedConfig.syncDebugLogging ?? false;
  }
  if (advI18nHotReload) {
    advI18nHotReload.checked = advancedConfig.i18nHotReload ?? advancedConfig.enableI18nHotReload ?? false;
  }
  if (advExperimentalFaviconFetchLink) {
    advExperimentalFaviconFetchLink.checked = advancedConfig.faviconFetchLink ?? advancedConfig.experimentalFaviconFetchLink ?? false;
  }
  if (advExperimentalFaviconFetchManifest) {
    advExperimentalFaviconFetchManifest.checked = advancedConfig.faviconFetchManifest ?? advancedConfig.experimentalFaviconFetchManifest ?? false;
  }
}

async function initializeAdvancedSettingsControls() {
  try {
    const config = await loadConfig();
    applyAdvancedSettingsToControls(config.advanced || {});
  } catch (err) {
    console.warn("Failed to initialize advanced settings controls", err);
  }
}

function initializeSettingsDirtyTracking() {
  const trackedElements = document.querySelectorAll(
    "#sync-tab input, #sync-tab select, #appearance-tab input, #appearance-tab select, #housekeeper-tab input, #backups-tab input, #advanced-tab input, #export-tab input"
  );
  trackedElements.forEach(el => {
    if (el.type === "hidden") return;
    el.addEventListener("input", markSettingsDirty);
    el.addEventListener("change", markSettingsDirty);
  });

  if (groupCountToggle) {
    groupCountToggle.addEventListener("change", () => {
      markSettingsDirty();
      window.groupCountPreviewEnabled = groupCountToggle.checked;
      if (settingsState.appearanceDraft) {
        settingsState.appearanceDraft.showGroupBookmarkCount = groupCountToggle.checked;
      }
      void render();
    });
  }
}

async function persistSettings(closeAfterSave = false) {
  const config = await loadConfig();

  if (!applySyncToConfig(config)) {
    return false;
  }

  applyHousekeeperToConfig(config);
  applyBackupToConfig(config);

  const appearanceOk = await applyAppearanceToConfig(config, { setSyncStatusMessage });
  if (!appearanceOk) {
    return false;
  }

  config.advanced.faviconDebugLogging = !!advFaviconDebugLogging?.checked;
  config.advanced.deadLinkDebugLogging = !!advDeadLinkDebugLogging?.checked;
  config.advanced.syncDebugLogging = !!advSyncDebugLogging?.checked;
  config.advanced.i18nHotReload = !!advI18nHotReload?.checked;
  config.advanced.faviconFetchLink = !!advExperimentalFaviconFetchLink?.checked;
  config.advanced.faviconFetchManifest = !!advExperimentalFaviconFetchManifest?.checked;
  delete config.advanced.enableDebugLogging;
  delete config.advanced.enableI18nHotReload;
  delete config.advanced.experimentalFaviconFetchLink;
  delete config.advanced.experimentalFaviconFetchManifest;

  if (settingsState.pendingLanguageReset) {
    await resetLanguageToBrowser({ persist: true });
    settingsState.pendingLanguageReset = false;
  } else if (
    languageSelect?.value &&
    (settingsState.savedLanguageSnapshot?.override !== languageSelect.value || getCurrentLanguage() !== languageSelect.value)
  ) {
    await setLanguage(languageSelect.value, { persist: true });
  }
  settingsState.savedLanguageSnapshot = {
    lang: getCurrentLanguage(),
    override: getSavedLanguageOverride()
  };

  await saveConfig(config);
  await cleanupOldBackups(config.backups.retentionDays);

  updateManualSyncButtonVisibility(config);

  try {
    render();
  } catch {}

  if (typeof window.applySavedDateTimeEnabled === "function") {
    window.applySavedDateTimeEnabled(config.appearance.dateTimeSpace !== "disabled");
  } else if (typeof window.clearDateTimePreview === "function") {
    window.clearDateTimePreview();
  }

  setSettingsDirty(false);

  if (!closeAfterSave) {
    setSyncStatusMessage("✅ " + t("settingsSaved"));
  }

  if (closeAfterSave) {
    settingsModal?.classList.add("hidden");
  }

  return true;
}

if (languageSelect) {
  languageSelect.addEventListener("change", () => {
    settingsState.pendingLanguageReset = false;
    markSettingsDirty();
  });
}

// ---------- Tab Switching ----------
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    tabButtons.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${tabName}-tab`)?.classList.add("active");
  });
});

// ---------- Open Settings Modal ----------
if (settingsBtn) {
  settingsBtn.addEventListener("click", async () => {
    settingsState.isInitializingSettingsForm = true;
    try {
      if (typeof window.clearDateTimePreview === "function") {
        window.clearDateTimePreview();
      }
      window.groupCountPreviewEnabled = null;
      settingsState.savedLanguageSnapshot = {
        lang: getCurrentLanguage(),
        override: getSavedLanguageOverride()
      };
      settingsState.pendingLanguageReset = false;

      const config = await loadConfig();

      await populateSyncSettings(config);
      updateHouseKeeperInfo(config);

      if (languageSelect) {
        languageSelect.value = getCurrentLanguage();
      }

      populateAppearanceSettings(config);
      applyAdvancedSettingsToControls(config.advanced || {});
      populateBackupSettings(config);
      await refreshBackupsTable();

      clearSyncStatuses();
      settingsModal?.classList.remove("hidden");
      setSettingsDirty(false);
    } finally {
      settingsState.isInitializingSettingsForm = false;
    }
  });
}

// ---------- Close Settings Modal ----------
if (settingsCancelBtn) {
  settingsCancelBtn.addEventListener("click", () => {
    settingsModal?.classList.add("hidden");
    void revertAppearancePreviewToSaved();
  });
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const subModalIds = ["browser-bookmarks-overwrite-modal", "browser-import-modal", "failed-icons-modal", "custom-widget-trust-modal", "custom-widget-editor-modal"];
    for (const id of subModalIds) {
      const subModal = document.getElementById(id);
      if (subModal && !subModal.classList.contains("hidden")) {
        if (id === "custom-widget-editor-modal" && typeof window.closeCustomWidgetEditorModal === "function") {
          window.closeCustomWidgetEditorModal();
        } else {
          subModal.classList.add("hidden");
        }
        return;
      }
    }
    settingsModal?.classList.add("hidden");
    void revertAppearancePreviewToSaved();
  }
});

// ---------- Save Settings ----------
if (settingsSaveBtn) {
  settingsSaveBtn.addEventListener("click", async () => {
    await persistSettings(false);
  });
}

if (settingsSaveCloseBtn) {
  settingsSaveCloseBtn.addEventListener("click", async () => {
    await persistSettings(true);
  });
}

// ---------- Open Browser Extension Settings (Chromium only) ----------
const openExtensionSettingsBtn = document.getElementById("open-extension-settings");
if (openExtensionSettingsBtn) {
  const isGecko = (typeof browser !== "undefined" && typeof browser.runtime?.getBrowserInfo === "function")
    || /\b(?:Firefox|Gecko)\/\d+/i.test(navigator.userAgent || "");
  if (isGecko) {
    const footer = openExtensionSettingsBtn.closest(".appearance-card-footer");
    if (footer) footer.style.display = "none";
    openExtensionSettingsBtn.style.display = "none";
  } else {
    openExtensionSettingsBtn.addEventListener("click", () => {
      const extensionId = chrome.runtime.id;
      const settingsUrl = `chrome://extensions/?id=${extensionId}`;
      chrome.tabs.create({ url: settingsUrl });
    });
  }
}

// ---------- Reset Language to Browser Default ----------
const resetLanguageBtn = document.getElementById("reset-language-to-browser");
if (resetLanguageBtn) {
  resetLanguageBtn.addEventListener("click", async () => {
    settingsState.pendingLanguageReset = true;
    await resetLanguageToBrowser({ persist: false });
    if (languageSelect) {
      languageSelect.value = getCurrentLanguage();
    }
    markSettingsDirty();
    render();
    updateUIText();
    updateClock();
  });
}

// ---------- Settings Modal Maximize/Restore ----------
const settingsMaximizeBtn = document.getElementById("settings-maximize-btn");
const settingsModalContent = settingsModal?.querySelector(".modal-content");

if (settingsMaximizeBtn && settingsModalContent) {
  settingsMaximizeBtn.addEventListener("click", () => {
    const isMaximized = settingsModalContent.classList.toggle("maximized");
    settingsMaximizeBtn.textContent = isMaximized ? "🗗" : "⛶";
    settingsMaximizeBtn.title = isMaximized ? t("restoreSize") : t("maximize");
  });
}

// ---------- Info Tab ----------
(async () => {
  const badge = document.getElementById("info-version-string");
  if (!badge) return;

  const manifest = chrome.runtime.getManifest();
  let label = manifest.version || "?";

  try {
    const res = await fetch(chrome.runtime.getURL("version.json"));
    if (res.ok) {
      const v = await res.json();
      if (v.commit && v.commit !== "dev") {
        label += ` (${v.commit})`;
      } else if (v.commit === "dev") {
        label += " (dev)";
      }
    }
  } catch {
    // version.json missing or unreadable — show manifest version only
  }

  badge.textContent = label;
})();

// ---------- Initialize Feature Modules ----------
initSyncSettings({ persistSettings });
initBackupSettings({
  setSyncStatusMessage,
  revertAppearancePreviewToSaved,
  updateDateTimeVisibility
});
initAppearanceSettings();
initHousekeeperSettings({ ensureAppearanceDraft });
initCustomWidgetsSettings();

initializeSettingsDirtyTracking();
updateChoiceOptionStates();
void initializeAdvancedSettingsControls();

async function initializeTopBarSettingsState() {
  const config = await loadConfig();
  updateManualSyncButtonVisibility(config);
  updateHouseKeeperInfo(config);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeTopBarSettingsState);
} else {
  setTimeout(initializeTopBarSettingsState, 0);
}
