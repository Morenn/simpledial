import { loadConfig, saveConfig, updateDebugLoggingFlags } from "./config.js";
import { t, getCurrentLanguage, setLanguage, resetLanguageToBrowser, getSavedLanguageOverride } from "./i18n.js";
import { measureAddonStorageUsage, formatStorageBytes } from "./storage-stats.js";
import { render } from "./render.js";
import { ensureHostPermission } from "./bookmarks.js";
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
  clearSyncStatuses,
  openSyncMergeWizard
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
import { initSecuritySettings, populateSecuritySettings } from "./settings/security-ui.js";

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
const advStartupTimingDebugLogging = document.getElementById("enable-startup-timing-debug-logging");
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
  if (advStartupTimingDebugLogging) {
    advStartupTimingDebugLogging.checked = advancedConfig.startupTimingDebugLogging ?? false;
  }
  updateDebugLoggingFlags(advancedConfig);
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
    if (el.type === "hidden" || el.dataset.noDirty === "true") return;
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

  for (const checkbox of [advExperimentalFaviconFetchLink, advExperimentalFaviconFetchManifest]) {
    if (!checkbox) continue;
    checkbox.addEventListener("change", async () => {
      if (!checkbox.checked) return;
      const granted = await ensureHostPermission();
      if (!granted) {
        checkbox.checked = false;
      }
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
  config.advanced.startupTimingDebugLogging = !!advStartupTimingDebugLogging?.checked;
  updateDebugLoggingFlags(config.advanced);
  config.advanced.i18nHotReload = !!advI18nHotReload?.checked;
  config.advanced.faviconFetchLink = !!advExperimentalFaviconFetchLink?.checked;
  config.advanced.faviconFetchManifest = !!advExperimentalFaviconFetchManifest?.checked;
  delete config.advanced.enableDebugLogging;
  delete config.advanced.enableI18nHotReload;
  delete config.advanced.experimentalFaviconFetchLink;
  delete config.advanced.experimentalFaviconFetchManifest;

  let languageChanged = false;
  if (settingsState.pendingLanguageReset) {
    await resetLanguageToBrowser({ persist: true });
    settingsState.pendingLanguageReset = false;
    languageChanged = true;
  } else if (
    languageSelect?.value &&
    (settingsState.savedLanguageSnapshot?.override !== languageSelect.value || getCurrentLanguage() !== languageSelect.value)
  ) {
    await setLanguage(languageSelect.value, { persist: true });
    languageChanged = true;
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
    if (languageChanged) {
      updateUIText();
      updateClock();
    }
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
    if (tabName === "info") {
      void renderInfoStorageStats();
    }
  });
});

async function renderInfoStorageStats() {
  const summaryEl = document.getElementById("info-storage-summary");
  const breakdownEl = document.getElementById("info-storage-breakdown");
  if (!summaryEl || !breakdownEl) return;

  const stats = await measureAddonStorageUsage();
  const localPct = Math.min(100, Math.round((stats.localBytes / stats.localLimitBytes) * 100));
  const syncPct = Math.min(100, Math.round((stats.syncBytes / stats.syncLimitBytes) * 100));

  summaryEl.innerHTML = "";
  const addMeter = (label, used, limit, pct) => {
    const row = document.createElement("div");
    row.className = "info-storage-meter-row";
    const top = document.createElement("div");
    top.className = "info-storage-meter-top";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    const val = document.createElement("span");
    val.textContent = `${formatStorageBytes(used)} / ${formatStorageBytes(limit)} (${pct}%)`;
    top.append(lbl, val);
    const bar = document.createElement("div");
    bar.className = "info-storage-bar";
    const fill = document.createElement("div");
    fill.className = "info-storage-bar-fill" + (pct >= 85 ? " is-high" : "");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    row.append(top, bar);
    summaryEl.appendChild(row);
  };

  addMeter("Extension Storage (local)", stats.localBytes, stats.localLimitBytes, localPct);
  addMeter(
    "Icon Cache (localStorage)",
    stats.localStorageBytes,
    stats.localStorageLimitBytes,
    Math.min(100, Math.round((stats.localStorageBytes / stats.localStorageLimitBytes) * 100))
  );
  if (stats.syncBytes > 0) {
    addMeter("Browser Sync (sync)", stats.syncBytes, stats.syncLimitBytes, syncPct);
  }

  breakdownEl.innerHTML = "";
  const catLabels = [
    ["bookmarks", "Bookmarks & Groups"],
    ["config", "Config & Widgets"],
    ["backups", "Backups"],
    ["themeCache", "Background & Theme Cache"],
    ["notes", "Notes"],
    ["rss", "RSS Cache & Read State"],
    ["weather", "Weather Cache"],
    ["systemTags", "Local System Tags"],
    ["other", "Other"]
  ];
  for (const [key, label] of catLabels) {
    const bytes = stats.categories[key] || 0;
    if (bytes === 0 && (key === "other" || key === "weather")) continue;
    const chip = document.createElement("div");
    chip.className = "info-storage-chip";
    const kSpan = document.createElement("span");
    kSpan.textContent = label;
    const vSpan = document.createElement("strong");
    vSpan.textContent = formatStorageBytes(bytes);
    chip.append(kSpan, vSpan);
    breakdownEl.appendChild(chip);
  }
}

document.getElementById("info-storage-refresh-btn")?.addEventListener("click", () => {
  void renderInfoStorageStats();
});

export { openSyncMergeWizard };

// ---------- Open Settings Modal ----------
export async function openSettingsModal(initialTab = null) {
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
    await populateSecuritySettings(config);

    clearSyncStatuses();
    if (initialTab) {
      document.querySelector(`.settings-tab-btn[data-tab="${CSS.escape(initialTab)}"]`)?.click();
    }
    settingsModal?.classList.remove("hidden");
    setSettingsDirty(false);
  } finally {
    settingsState.isInitializingSettingsForm = false;
  }
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
    const subModalCancelMap = {
      "custom-widget-new-group-modal": "custom-widget-new-group-cancel-btn",
      "custom-widget-trust-modal": "custom-widget-trust-cancel",
      "sync-force-overwrite-modal": "sync-force-overwrite-cancel",
      "sync-merge-wizard-modal": "sync-merge-wizard-cancel",
      "vault-unlock-modal": "vault-unlock-modal-cancel",
      "failed-icons-modal": "failed-icons-close"
    };
    const subModalIds = [
      "custom-widget-new-group-modal",
      "custom-widget-trust-modal",
      "sync-force-overwrite-modal",
      "sync-merge-wizard-modal",
      "vault-unlock-modal",
      "vault-force-change-modal",
      "browser-bookmarks-overwrite-modal",
      "browser-import-modal",
      "failed-icons-modal",
      "custom-widget-editor-modal"
    ];
    for (const id of subModalIds) {
      const subModal = document.getElementById(id);
      if (subModal && !subModal.classList.contains("hidden")) {
        if (id === "vault-force-change-modal") {
          return;
        } else if (id === "custom-widget-editor-modal" && typeof window.closeCustomWidgetEditorModal === "function") {
          window.closeCustomWidgetEditorModal();
        } else if (subModalCancelMap[id]) {
          const cancelBtn = document.getElementById(subModalCancelMap[id]);
          if (cancelBtn) {
            cancelBtn.click();
          } else {
            subModal.classList.add("hidden");
          }
        } else {
          subModal.classList.add("hidden");
        }
        return;
      }
    }
    if (settingsModal && !settingsModal.classList.contains("hidden")) {
      settingsModal.classList.add("hidden");
      void revertAppearancePreviewToSaved();
    }
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
initSecuritySettings();

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
