import { state, saveState, generateId } from "./state.js";
import { loadConfig, saveConfig, getSyncIntervalMs, DEFAULT_SYNC_INTERVAL } from "./config.js";
import { testSyncConnection, requestHostPermission, syncNow, cleanupDeletedItems, checkDeadLinks, syncWrite, syncRead, syncReadTest, syncWriteTest } from "./sync.js";
import { t, getCurrentLanguage, resetLanguageToBrowser } from "./i18n.js";
import { deriveKeyFromPassword, generateLocalKeyRaw, importRawKey, encryptWithKey, decryptWithKey } from './crypto.js';
import { findOrCreateSimpleDialFolder, getBookmarkChildren, createBookmarkNode, removeBookmarkNode } from './bookmarks-api.js';
import { render } from "./render.js";
import { applyBackground, applyTileOpacity } from "./theme.js";
import { createBackup, listBackups, restoreBackup, deleteBackup, cleanupOldBackups, getBackup } from "./backup.js";
import { updateUIText, updateClock } from "./main.js";

// ======================================================
// SETTINGS MODAL UI
// ======================================================

// ---------- DOM Elements ----------
const settingsModal = document.getElementById("settings-modal");
const settingsBtn = document.getElementById("settings-btn");
const showDeletedBtn = document.getElementById("show-deleted-btn");
const manualSyncBtn = document.getElementById("manual-sync-btn");
const settingsSaveBtn = document.getElementById("settings-save");
const settingsSaveCloseBtn = document.getElementById("settings-save-close");
const settingsCancelBtn = document.getElementById("settings-cancel");

// Sync Tab Elements
const syncUrl = document.getElementById("sync-url");
const syncTest = document.getElementById("sync-test");
const syncReadTestBtn = document.getElementById("sync-read-test");
const syncWriteTestBtn = document.getElementById("sync-write-test");
const syncEnable = document.getElementById("sync-enable");
const syncType = document.getElementById("sync-type");
const syncWebdavType = document.getElementById("sync-webdav-type");
const syncAuthMode = document.getElementById("sync-auth-mode");
const syncUsername = document.getElementById("sync-username");
const syncPassword = document.getElementById("sync-password");
const syncStatus = document.getElementById("sync-status");
const syncWebdavTypeRow = document.getElementById("sync-webdav-type-row");
const syncCredentialsSaveBtn = document.getElementById("sync-credentials-save");
const syncCredentialsRow = document.getElementById("sync-credentials-row");
const syncImmediate = document.getElementById("sync-immediate");
const syncCustom = document.getElementById("sync-custom");
const syncCustomValue = document.getElementById("sync-interval-value");
const syncManual = document.getElementById("sync-manual");
const syncNowBtn = document.getElementById("sync-now-btn");
const syncUploadBtn = document.getElementById("sync-upload-btn");
const syncDownloadBtn = document.getElementById("sync-download-btn");
const syncTestStatus = document.getElementById("sync-test-status");
const syncNowStatus = document.getElementById("sync-now-status");
const lastSyncInfo = document.getElementById("last-sync-info");
const syncTypeChoices = document.querySelectorAll('input[name="sync-type-choice"]');
const syncAuthChoices = document.querySelectorAll('input[name="sync-auth-choice"]');
const syncEncryptChoices = document.querySelectorAll('input[name="sync-encrypt-choice"]');
const syncBrowserHint = document.getElementById("sync-browser-hint");
const syncAuthCard = document.getElementById("sync-auth-card");
const syncCredentialsCard = document.getElementById("sync-credentials-card");
const syncEncryptSection = document.getElementById("sync-encrypt-section");
const syncUsernameRow = document.getElementById("sync-username-row");
const syncPasswordRow = document.getElementById("sync-password-row");
const syncAuthResetNote = document.getElementById("sync-auth-reset-note");
const settingsUnsavedIndicator = document.getElementById("settings-unsaved-indicator");

// Backups Elements
const backupRetentionDays = document.getElementById("backup-retention-days");
const backupFrequencyHours = document.getElementById("backup-frequency-hours");
const backupCreateNowBtn = document.getElementById("backup-create-now");
const backupStatus = document.getElementById("backup-status");
const backupsTableBody = document.getElementById("backups-table-body");

// Export/Import Elements
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
const exportBookmarksBtn = document.getElementById("export-bookmarks-btn");
const importBookmarksBtn = document.getElementById("import-bookmarks-btn");
const exportNetscapeBtn = document.getElementById("export-netscape-btn");
const importNetscapeBtn = document.getElementById("import-netscape-btn");
const importNetscapeFile = document.getElementById("import-netscape-file");

// Appearance Elements
const showDeletedToggle = document.getElementById("show-deleted-toggle");
const languageSelect = document.getElementById("language-select");
const bgImageInput = document.getElementById("bg-image-input");
const bgSizeSelect = document.getElementById("bg-size-select");
const bgPreview = document.getElementById("bg-preview");
const bgRemoveBtn = document.getElementById("bg-remove-btn");
const tileOpacitySlider = document.getElementById("tile-opacity-slider");
const tileOpacityValue = document.getElementById("tile-opacity-value");
const dateTimeToggle = document.getElementById("date-time-toggle");

// HouseKeeper Elements
const hkRetentionDays = document.getElementById("hk-retention-days");
const hkAutoCleanup = document.getElementById("hk-auto-cleanup");
const hkManualCleanup = document.getElementById("hk-manual-cleanup");
const hkCleanupStatus = document.getElementById("hk-cleanup-status");
const hkLastCleanup = document.getElementById("hk-last-cleanup");
const hkEnableLinkCheck = document.getElementById("hk-enable-link-check");
const hkHighlightDeadLinks = document.getElementById("hk-highlight-dead-links");
const hkCheckLinks = document.getElementById("hk-check-links");
const hkLinkCheckStatus = document.getElementById("hk-link-check-status");
const hkDeadLinksCount = document.getElementById("hk-dead-links-count");
const hkClearErrors = document.getElementById("hk-clear-errors");
const hkIconRefreshAll = document.getElementById("hk-icon-refresh-all");
const hkIconRefreshMissing = document.getElementById("hk-icon-refresh-missing");
const hkIconRefreshNone = document.getElementById("hk-icon-refresh-none");
const hkIconRefreshHours = document.getElementById("hk-icon-refresh-hours");

// Advanced Elements
const advFaviconDebugLogging = document.getElementById("enable-favicon-debug-logging");
const advExperimentalFaviconFetchLink = document.getElementById("enable-experimental-favicon-fetch-link");
const advExperimentalFaviconFetchManifest = document.getElementById("enable-experimental-favicon-fetch-manifest");

function applyAdvancedSettingsToControls(advancedConfig = {}) {
  if (advFaviconDebugLogging) {
    advFaviconDebugLogging.checked = advancedConfig.faviconDebugLogging ?? advancedConfig.enableDebugLogging ?? false;
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

// Tab System
const tabButtons = document.querySelectorAll(".settings-tab-btn");
const tabContents = document.querySelectorAll(".settings-tab-content");

let isInitializingSettingsForm = false;
let settingsDirty = false;
let appearanceDraft = null;

function updateChoiceOptionStates() {
  document.querySelectorAll('.choice-option').forEach(option => {
    const input = option.querySelector('input[type="radio"]');
    option.classList.toggle('active', !!(input && input.checked));
  });
}

function syncRadioGroupFromModel(hiddenInput, radioInputs) {
  if (!hiddenInput || !radioInputs || !radioInputs.length) return;
  radioInputs.forEach(radio => {
    radio.checked = (radio.value === hiddenInput.value);
  });
  updateChoiceOptionStates();
}

function bindRadioGroupToModel(hiddenInput, radioInputs) {
  if (!hiddenInput || !radioInputs || !radioInputs.length) return;
  radioInputs.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      hiddenInput.value = radio.value;
      hiddenInput.dispatchEvent(new Event('change'));
      updateChoiceOptionStates();
      markSettingsDirty();
    });
  });
}

function setSettingsDirty(isDirty) {
  settingsDirty = !!isDirty;
  if (settingsUnsavedIndicator) {
    settingsUnsavedIndicator.classList.toggle('hidden', !settingsDirty);
  }
}

function markSettingsDirty() {
  if (isInitializingSettingsForm) return;
  if (settingsModal?.classList.contains("hidden")) return;
  setSettingsDirty(true);
}

function initializeSettingsDirtyTracking() {
  const trackedElements = document.querySelectorAll('#sync-tab input, #sync-tab select, #appearance-tab input, #appearance-tab select, #housekeeper-tab input, #backups-tab input, #advanced-tab input');
  trackedElements.forEach(el => {
    if (el.type === 'hidden') return;
    el.addEventListener('input', markSettingsDirty);
    el.addEventListener('change', markSettingsDirty);
  });
  // Explicitly track the date/time toggle state change for robustness
  const dateTimeToggle = document.getElementById("date-time-toggle");
  if (dateTimeToggle) {
    dateTimeToggle.addEventListener('change', () => {
        markSettingsDirty(); 
        // Also update visibility when toggled
        updateDateTimeVisibility(dateTimeToggle.checked);
    });
  }
}

bindRadioGroupToModel(syncType, syncTypeChoices);
bindRadioGroupToModel(syncAuthMode, syncAuthChoices);
bindRadioGroupToModel(document.getElementById('sync-encrypt-mode'), syncEncryptChoices);
initializeSettingsDirtyTracking();
updateChoiceOptionStates();
void initializeAdvancedSettingsControls();

// ---------- Tab Switching ----------
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;

    // Remove active class from all buttons and contents
    tabButtons.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));

    // Add active class to clicked button and corresponding content
    btn.classList.add("active");
    document.getElementById(`${tabName}-tab`).classList.add("active");
  });
});

/**
 * Updates the visibility of the date and time display element based on the toggle state.
 */
function updateDateTimeVisibility(isVisible) {
  if (typeof window.setDateTimePreviewEnabled === "function") {
    window.setDateTimePreviewEnabled(!!isVisible);
    return;
  }

  const dateTimeDisplay = document.getElementById("date-time-display");
  if (dateTimeDisplay) {
    dateTimeDisplay.style.display = isVisible ? "block" : "none";
  }
}

function getHousekeeperIconRefreshMode() {
  if (hkIconRefreshNone?.checked) return "none";
  if (hkIconRefreshMissing?.checked) return "missing";
  return "all";
}

function updateHousekeeperIconRefreshFrequencyEnabled() {
  if (!hkIconRefreshHours) return;
  hkIconRefreshHours.disabled = getHousekeeperIconRefreshMode() === "none";
}

async function revertDateTimePreviewToSaved() {
  try {
    const config = await loadConfig();
    const persistedValue = config.appearance?.showDateTime ?? true;
    if (dateTimeToggle) {
      dateTimeToggle.checked = persistedValue;
    }
    if (typeof window.clearDateTimePreview === "function") {
      window.clearDateTimePreview();
    }
  } catch (err) {
    console.warn("Failed to revert date/time preview", err);
  }
}

async function revertAppearancePreviewToSaved() {
  try {
    const config = await loadConfig();
    const appearance = config.appearance || {};

    appearanceDraft = {
      backgroundImage: appearance.backgroundImage ?? null,
      backgroundSize: appearance.backgroundSize || 'stretched',
      tileOpacity: appearance.tileOpacity ?? 1,
      showDateTime: appearance.showDateTime ?? true,
      showDeleted: appearance.showDeleted ?? false
    };

    if (bgSizeSelect) bgSizeSelect.value = appearanceDraft.backgroundSize;

    if (tileOpacitySlider) {
      const opacityPercent = Math.round((appearanceDraft.tileOpacity ?? 1) * 100);
      tileOpacitySlider.value = opacityPercent;
      if (tileOpacityValue) tileOpacityValue.textContent = `${opacityPercent}%`;
    }

    if (showDeletedToggle) {
      showDeletedToggle.checked = !!appearanceDraft.showDeleted;
      showDeletedToggle.dispatchEvent(new Event("change"));
      updateShowDeletedButtonAppearance();
    }

    if (dateTimeToggle) {
      dateTimeToggle.checked = !!appearanceDraft.showDateTime;
    }

    if (bgPreview) {
      if (appearanceDraft.backgroundImage) {
        bgPreview.style.backgroundImage = `url('${appearanceDraft.backgroundImage}')`;
        bgPreview.style.display = 'block';
      } else {
        bgPreview.style.backgroundImage = '';
        bgPreview.style.display = 'none';
      }
    }

    if (bgImageInput) bgImageInput.value = "";

    await applyBackground(config);
    await applyTileOpacity(config);
    await revertDateTimePreviewToSaved();
  } catch (err) {
    console.warn("Failed to revert appearance preview", err);
  }
}

// ---------- Open Settings Modal ----------
settingsBtn.addEventListener("click", async () => {
  isInitializingSettingsForm = true;
  try {
    if (typeof window.clearDateTimePreview === "function") {
      window.clearDateTimePreview();
    }

    const config = await loadConfig();

  // Load sync settings
  syncUrl.value = config.sync.serverUrl || "";
  syncEnable.checked = config.sync.enabled;
  if (syncType) syncType.value = config.sync.type || 'direct';
  if (syncWebdavType) syncWebdavType.value = config.sync.webdavType || 'generic';
  if (syncAuthMode) syncAuthMode.value = config.sync.authMode || (config.sync.password ? 'basic' : 'none');
  syncRadioGroupFromModel(syncType, syncTypeChoices);
  syncRadioGroupFromModel(syncAuthMode, syncAuthChoices);

  // Load encryption mode
  const syncEncryptMode = document.getElementById('sync-encrypt-mode');
  if (syncEncryptMode) {
    syncEncryptMode.value = config.sync.encryptionMode || 'none';
    syncRadioGroupFromModel(syncEncryptMode, syncEncryptChoices);
  }

  // Try to populate credentials depending on encryption mode
  try {
    if (config.sync.authMode === 'basic') {
      if (config.sync.encryptionMode === 'none') {
        if (syncUsername) syncUsername.value = config.sync.username || '';
        if (syncPassword) syncPassword.value = config.sync.password || '';
      } else if (config.sync.encryptionMode === 'local' && config.sync.localKey && config.sync.enc) {
        // decrypt using stored local key
        try {
          const key = await importRawKey(config.sync.localKey);
          const plain = await decryptWithKey(key, config.sync.enc.ciphertext, config.sync.enc.iv);
          const obj = JSON.parse(plain);
          if (syncUsername) syncUsername.value = obj.username || '';
          if (syncPassword) syncPassword.value = obj.password || '';
        } catch (e) {
          console.warn('Failed to decrypt local credentials', e);
        }
      } else if (config.sync.encryptionMode === 'master' && config.sync.enc) {
        // If we have a cached master key in window, try to decrypt
        if (window._speeddial_masterKey) {
          try {
            const plain = await decryptWithKey(window._speeddial_masterKey, config.sync.enc.ciphertext, config.sync.enc.iv);
            const obj = JSON.parse(plain);
            if (syncUsername) syncUsername.value = obj.username || '';
            if (syncPassword) syncPassword.value = obj.password || '';
          } catch (e) {
            console.warn('Failed to decrypt with cached master key', e);
            syncStatus.textContent = "❌ " + t('enterMasterPasswordPrompt');
          }
        } else {
          // Prompt user to unlock credentials now
          const pw = prompt(t('enterMasterPasswordPrompt') + " (leave empty to skip)");
          if (pw) {
            try {
              const derived = await deriveKeyFromPassword(pw, config.sync.enc.salt);
              const plain = await decryptWithKey(derived.key, config.sync.enc.ciphertext, config.sync.enc.iv);
              window._speeddial_masterKey = derived.key; // cache for session
              const obj = JSON.parse(plain);
              if (syncUsername) syncUsername.value = obj.username || '';
              if (syncPassword) syncPassword.value = obj.password || '';
            } catch (e) {
              console.warn('Master password failed', e);
              syncStatus.textContent = "❌ " + t('enterMasterPasswordPrompt');
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('Error while loading encrypted credentials', e);
  }

  // Reset credentials changed state and update UI visibility
  credentialsTouched = false;
  updateSyncFields();
  updateSyncNowButtonDisabledState();

  // Load sync interval settings
  const intervalMode = config.sync.intervalMode || "default";
  if (intervalMode === "immediate") {
    syncImmediate.checked = true;
    syncCustomValue.disabled = true;
  } else if (intervalMode === "custom") {
    syncCustom.checked = true;
    syncCustomValue.disabled = false;
    syncCustomValue.value = config.sync.customIntervalMinutes || 60;
  } else {
    syncManual.checked = true;
    syncCustomValue.disabled = true;
  }
  updateChoiceOptionStates();

  // Update last sync info
  updateLastSyncInfo(config);

  // Update manual sync button visibility
  updateManualSyncButtonVisibility(config);
  
  // Update HouseKeeper UI
  updateHouseKeeperInfo(config);

  // Set current language in language select
  if (languageSelect) {
    languageSelect.value = getCurrentLanguage();
  }

  // Load background settings
  if (bgSizeSelect) {
    bgSizeSelect.value = config.appearance?.backgroundSize || 'stretched';
  }
  if (config.appearance?.backgroundImage && bgPreview) {
    bgPreview.style.backgroundImage = `url('${config.appearance.backgroundImage}')`;
    bgPreview.style.display = 'block';
  } else if (bgPreview) {
    bgPreview.style.display = 'none';
  }

  // Load tile opacity settings
  if (tileOpacitySlider) {
    const opacityPercent = Math.round((config.appearance?.tileOpacity ?? 1) * 100);
    tileOpacitySlider.value = opacityPercent;
    if (tileOpacityValue) {
      tileOpacityValue.textContent = `${opacityPercent}%`;
    }
  }

  // Load date & time display toggle state
  if (dateTimeToggle) {
    const isVisible = config.appearance?.showDateTime ?? true;
    dateTimeToggle.checked = isVisible;
  }

  // Load advanced settings
  applyAdvancedSettingsToControls(config.advanced || {});

  if (showDeletedToggle) {
    showDeletedToggle.checked = config.appearance?.showDeleted ?? false;
    showDeletedToggle.dispatchEvent(new Event("change"));
    updateShowDeletedButtonAppearance();
  }

  appearanceDraft = {
    backgroundImage: config.appearance?.backgroundImage ?? null,
    backgroundSize: config.appearance?.backgroundSize || 'stretched',
    tileOpacity: config.appearance?.tileOpacity ?? 1,
    showDateTime: config.appearance?.showDateTime ?? true,
    showDeleted: config.appearance?.showDeleted ?? false
  };

  // Load backups settings
  if (backupRetentionDays) {
    backupRetentionDays.value = config.backups?.retentionDays || 30;
  }
  if (backupFrequencyHours) {
    backupFrequencyHours.value = config.backups?.frequencyHours || 24;
  }
  await refreshBackupsTable();

    syncStatus.textContent = "";
    if (syncTestStatus) syncTestStatus.textContent = "";
    if (syncNowStatus) syncNowStatus.textContent = "";
    settingsModal.classList.remove("hidden");
    setSettingsDirty(false);
  } finally {
    isInitializingSettingsForm = false;
  }
});

// ---------- Close Settings Modal ----------
if (settingsCancelBtn) {
  settingsCancelBtn.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
    void revertAppearancePreviewToSaved();
  });
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    settingsModal.classList.add("hidden");
    void revertAppearancePreviewToSaved();
  }
});

// ---------- Sync Interval Radio Buttons ----------
syncImmediate.addEventListener("change", () => {
  syncCustomValue.disabled = true;
  updateChoiceOptionStates();
});

syncCustom.addEventListener("change", () => {
  syncCustomValue.disabled = false;
  syncCustomValue.focus();
  updateChoiceOptionStates();
});

syncManual.addEventListener("change", () => {
  syncCustomValue.disabled = true;
  updateChoiceOptionStates();
});

// ---------- Auth fields handling ----------
let credentialsTouched = false;

function clearSyncCredentialsInConfig(config) {
  if (!config || !config.sync) return;
  config.sync.username = '';
  config.sync.password = '';
  delete config.sync.enc;
  delete config.sync.localKey;
  config.sync.encryptionMode = 'none';
}

function clearSyncCredentialsInUi() {
  if (syncUsername) syncUsername.value = '';
  if (syncPassword) syncPassword.value = '';
  const syncEncryptMode = document.getElementById('sync-encrypt-mode');
  if (syncEncryptMode) {
    syncEncryptMode.value = 'none';
    syncRadioGroupFromModel(syncEncryptMode, syncEncryptChoices);
  }
  credentialsTouched = false;
  updateCredentialsSaveButton();
}

function updateSyncFields() {
  const isBrowserSync = syncType && syncType.value === 'browser';
  const isDirect = syncType && syncType.value === 'direct';
  const isWebdav = syncType && syncType.value === 'webdav';
  const syncUrlDiv = document.getElementById('sync-url-row');
  const authDiv = syncAuthCard;
  const encryptDiv = syncEncryptSection;
  const userDiv = syncUsernameRow;
  const passDiv = syncPasswordRow;

  if (syncUrlDiv) syncUrlDiv.style.display = isBrowserSync ? 'none' : '';
  if (syncTest) syncTest.style.display = isBrowserSync ? 'none' : '';
  if (authDiv) authDiv.style.display = isBrowserSync ? 'none' : '';
  if (syncWebdavTypeRow) syncWebdavTypeRow.style.display = isWebdav ? '' : 'none';
  if (syncBrowserHint) syncBrowserHint.classList.toggle('hidden', !isBrowserSync);

  const usingBasic = (isDirect || isWebdav) && syncAuthMode && syncAuthMode.value === 'basic';
  if (syncCredentialsCard) syncCredentialsCard.style.display = usingBasic ? '' : 'none';
  if (userDiv) userDiv.style.display = usingBasic ? '' : 'none';
  if (passDiv) passDiv.style.display = usingBasic ? '' : 'none';

  const showEncrypt = usingBasic;
  if (encryptDiv) encryptDiv.style.display = showEncrypt ? '' : 'none';

  if (syncUsername) syncUsername.required = usingBasic;
  if (syncPassword) syncPassword.required = usingBasic;

  const userLabel = document.getElementById('sync-username-label');
  const passLabel = document.getElementById('sync-password-label');
  if (userLabel) userLabel.textContent = (userLabel.textContent || '').replace(' *', '') + (usingBasic ? ' *' : '');
  if (passLabel) passLabel.textContent = (passLabel.textContent || '').replace(' *', '') + (usingBasic ? ' *' : '');

  if (syncCredentialsRow) {
    syncCredentialsRow.style.display = usingBasic ? '' : 'none';
  }
  if (syncAuthResetNote) {
    syncAuthResetNote.classList.toggle('hidden', !!usingBasic || isBrowserSync);
  }
  updateCredentialsSaveButton();
}

function updateSyncNowButtonDisabledState() {
  if (!syncNowBtn) return;
  syncNowBtn.disabled = !(syncEnable && syncEnable.checked);
}

function updateCredentialsSaveButton() {
  if (!syncCredentialsSaveBtn) return;
  const isBasic = syncAuthMode && syncAuthMode.value === 'basic';
  syncCredentialsSaveBtn.disabled = !credentialsTouched || !isBasic;
}

function markCredentialsTouched() {
  credentialsTouched = true;
  updateCredentialsSaveButton();
}

if (syncAuthMode) syncAuthMode.addEventListener('change', () => {
  updateSyncFields();
  markCredentialsTouched();
});
if (syncEnable) syncEnable.addEventListener('change', updateSyncNowButtonDisabledState);
if (syncType) syncType.addEventListener('change', updateSyncFields);
if (syncWebdavType) syncWebdavType.addEventListener('change', updateSyncFields);
if (syncUsername) syncUsername.addEventListener('input', markCredentialsTouched);
if (syncPassword) syncPassword.addEventListener('input', markCredentialsTouched);
const syncEncryptModeEl = document.getElementById('sync-encrypt-mode');
if (syncEncryptModeEl) syncEncryptModeEl.addEventListener('change', markCredentialsTouched);

if (syncCredentialsSaveBtn) {
  syncCredentialsSaveBtn.addEventListener('click', async () => {
    const config = await loadConfig();

    if (!(syncType && (syncType.value === 'direct' || syncType.value === 'webdav') && syncAuthMode && syncAuthMode.value === 'basic')) {
      syncStatus.textContent = "❌ " + t('syncAuthCredentialsRequired');
      return;
    }

    config.sync.type = syncType.value || 'direct';
    if (syncType && syncType.value === 'browser') {
      config.sync.serverUrl = '';
      config.sync.authMode = 'none';
      clearSyncCredentialsInConfig(config);
    } else if (syncUrl.value.trim()) {
      config.sync.serverUrl = syncUrl.value.trim().replace(/\/$/, "");
    }

    if (syncWebdavType) {
      config.sync.webdavType = syncWebdavType.value || 'generic';
    }

    config.sync.authMode = 'basic';

    const formUsername = syncUsername ? syncUsername.value.trim() : '';
    const formPassword = syncPassword ? syncPassword.value : '';
    if (!formUsername || !formPassword) {
      syncStatus.textContent = "❌ " + t('syncAuthCredentialsRequired');
      return;
    }

    const syncEncryptModeEl = document.getElementById('sync-encrypt-mode');
    const encryptMode = syncEncryptModeEl ? syncEncryptModeEl.value : 'none';
    config.sync.encryptionMode = encryptMode || 'none';

    if (encryptMode === 'none') {
      config.sync.username = formUsername;
      config.sync.password = formPassword;
      delete config.sync.enc;
      delete config.sync.localKey;
    } else if (encryptMode === 'local') {
      if (!config.sync.localKey) {
        config.sync.localKey = await generateLocalKeyRaw();
      }
      try {
        const key = await importRawKey(config.sync.localKey);
        const payload = JSON.stringify({ username: formUsername, password: formPassword });
        const enc = await encryptWithKey(key, payload);
        config.sync.enc = { ciphertext: enc.ciphertext, iv: enc.iv };
        config.sync.username = '';
        config.sync.password = '';
      } catch (e) {
        console.error('Failed to encrypt with local key', e);
        syncStatus.textContent = '❌ Encryption failed';
        return;
      }
    } else if (encryptMode === 'master') {
      const pw = prompt(t('enterMasterPasswordPrompt'));
      if (!pw) {
        syncStatus.textContent = "❌ " + t('enterMasterPasswordPrompt');
        return;
      }

      const confirm = prompt(t('confirmMasterPasswordPrompt'));
      if (pw !== confirm) {
        syncStatus.textContent = "❌ " + t('confirmMasterPasswordPrompt');
        return;
      }

      try {
        const derived = await deriveKeyFromPassword(pw, null);
        const payload = JSON.stringify({ username: formUsername, password: formPassword });
        const enc = await encryptWithKey(derived.key, payload);
        config.sync.enc = { ciphertext: enc.ciphertext, iv: enc.iv, salt: derived.salt };
        config.sync.username = '';
        config.sync.password = '';
        window._speeddial_masterKey = derived.key;
      } catch (e) {
        console.error('Failed to encrypt with master password', e);
        syncStatus.textContent = '❌ Encryption failed';
        return;
      }
    }

    await saveConfig(config);
    credentialsTouched = false;
    updateCredentialsSaveButton();
    syncStatus.textContent = "✅ " + t('credentialsSaved');
  });
}

if (syncTest) {
  syncTest.addEventListener("click", async () => {
    const url = syncUrl ? syncUrl.value.trim() : '';

    if (!url) {
      if (syncTestStatus) syncTestStatus.textContent = "❌ " + t('fillUrl');
      return;
    }

    // Request host permission for the URL being tested
    const granted = await requestHostPermission(url, syncType && syncType.value ? syncType.value : 'direct');

    if (!granted) {
      if (syncTestStatus) syncTestStatus.textContent = "❌ " + t("permissionDenied");
      return;
    }

    // Test connection using the URL from input field
    if (syncTestStatus) syncTestStatus.textContent = "🔍 " + t("testingConnection");

    const useBasic = syncAuthMode && syncAuthMode.value === 'basic';
    const result = await testSyncConnection(
      url,
      useBasic ? (syncUsername ? syncUsername.value : '') : '',
      useBasic ? (syncPassword ? syncPassword.value : '') : '',
      syncType && syncType.value ? syncType.value : 'direct'
    );

    // Map detailed status reasons to user-friendly messages
    let message = '';
    if (result.ok) {
      if (result.reason === 'not-found-will-create') {
        message = "✅ " + t("serverResponds") + " " + t("fileWillBeCreated");
      } else {
        message = "✅ " + t("serverResponds");
      }
    } else {
      switch (result.reason) {
        case 'auth-redirect':
          message = "❌ " + t("syncAuthRedirectOpened");
          break;
        case 'auth':
          message = "❌ " + t("wrongCredentials");
          break;
        case 'timeout':
          message = "❌ " + t("connectionTimeout");
          break;
        case 'network-or-cors':
          message = "❌ " + t("unreachableServer");
          break;
        case 'auth-encoding-failed':
          message = "❌ " + t("invalidCredentialsEncoding");
          break;
        case 'invalid-url':
          message = "❌ " + t("invalidUrl");
          break;
        case 'http-error':
          message = "❌ " + t("serverError") + ` (${result.status})`;
          break;
        default:
          message = "❌ " + t("serverNotResponds");
      }
    }
    if (syncTestStatus) syncTestStatus.textContent = message;
  });
}

if (syncReadTestBtn) {
  syncReadTestBtn.addEventListener("click", async () => {
    syncReadTestBtn.disabled = true;
    if (syncTestStatus) syncTestStatus.textContent = "🔍 " + t("readingFromServer");

    try {
      if (settingsDirty) {
        const saved = await persistSettings(false);
        if (!saved) {
          if (syncTestStatus) syncTestStatus.textContent = "❌ " + t('saveCredentialsFirst');
          return;
        }
      }

      const result = await syncReadTest();
      if (result.ok) {
        const groupCount = Array.isArray(result.data?.groups) ? result.data.groups.length : 0;
        if (syncTestStatus) syncTestStatus.textContent = "✅ " + t("readTestSuccessful") + ` (${groupCount})`;
      } else {
        if (syncTestStatus) syncTestStatus.textContent = "❌ " + getSyncFailureMessage(result);
      }
    } finally {
      syncReadTestBtn.disabled = false;
    }
  });
}

if (syncWriteTestBtn) {
  syncWriteTestBtn.addEventListener("click", async () => {
    syncWriteTestBtn.disabled = true;
    if (syncTestStatus) syncTestStatus.textContent = "🔍 " + t("writingToServer");

    try {
      if (settingsDirty) {
        const saved = await persistSettings(false);
        if (!saved) {
          if (syncTestStatus) syncTestStatus.textContent = "❌ " + t('saveCredentialsFirst');
          return;
        }
      }

      const result = await syncWriteTest();
      if (result.ok) {
        if (syncTestStatus) syncTestStatus.textContent = "✅ " + t("writeTestSuccessful");
      } else {
        if (syncTestStatus) syncTestStatus.textContent = "❌ " + getSyncFailureMessage(result);
      }
    } finally {
      syncWriteTestBtn.disabled = false;
    }
  });
}

// ---------- Sync Now Button ----------
function getSyncFailureMessage(result) {
  switch (result?.reason) {
    case 'not-configured':
      return t('syncNotConfigured');
    case 'credentials-missing':
      return t('syncCredentialsMissing');
    case 'credentials-locked':
      return t('syncCredentialsLocked');
    case 'credentials-decrypt-failed':
      return t('syncCredentialsDecryptFailed');
    case 'unexpected-html-response':
      return t('syncUnexpectedHtmlResponse');
    case 'locked':
      return t('syncRemoteLocked');
    case 'auth-redirect':
      return t('syncAuthRedirectOpened');
    case 'auth':
      return t('wrongCredentials');
    case 'timeout':
      return t('connectionTimeout');
    case 'network-or-cors':
      return t('unreachableServer');
    case 'auth-encoding-failed':
      return t('invalidCredentialsEncoding');
    case 'invalid-url':
      return t('invalidUrl');
    case 'http-error':
      return `${t('serverError')} (${result.status ?? '?'})`;
    case 'browser-sync-error':
      return t('browserSyncUnavailable');
    default:
      return t('syncFailed');
  }
}

syncNowBtn.addEventListener("click", async () => {
  if (!(syncEnable && syncEnable.checked)) {
    if (syncNowStatus) syncNowStatus.textContent = "❌ " + t("syncNotConfigured");
    updateSyncNowButtonDisabledState();
    return;
  }

  syncNowBtn.disabled = true;
  syncNowBtn.textContent = "⬆️ " + t("syncing");

  if (settingsDirty) {
    const saved = await persistSettings(false);
    if (!saved) {
      if (syncNowStatus) syncNowStatus.textContent = "❌ " + t('saveCredentialsFirst');
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = "⬆️ " + t("syncNow");
      return;
    }
  }

  const result = await syncNow();

  if (result.ok) {
    if (syncNowStatus) syncNowStatus.textContent = "✅ " + t("syncSuccessful");
  } else {
    if (syncNowStatus) syncNowStatus.textContent = "❌ " + getSyncFailureMessage(result);
  }

  // Re-enable button after 2 seconds
  setTimeout(() => {
    updateSyncNowButtonDisabledState();
    syncNowBtn.textContent = "⬆️ " + t("syncNow");
    
    // Update last sync time
    loadConfig().then(config => updateLastSyncInfo(config));
  }, 2000);
});

if (syncUploadBtn) {
  syncUploadBtn.addEventListener("click", async () => {
    syncUploadBtn.disabled = true;
    if (syncNowStatus) syncNowStatus.textContent = "⏫ " + t("syncing");

    if (settingsDirty) {
      const saved = await persistSettings(false);
      if (!saved) {
        if (syncNowStatus) syncNowStatus.textContent = "❌ " + t('saveCredentialsFirst');
        syncUploadBtn.disabled = false;
        return;
      }
    }

    const ok = await syncWrite(state);
    if (syncNowStatus) {
      syncNowStatus.textContent = ok ? "✅ " + t("syncUploadSuccessful") : "❌ " + t("syncFailed");
    }

    syncUploadBtn.disabled = false;
    loadConfig().then(config => updateLastSyncInfo(config));
  });
}

if (syncDownloadBtn) {
  syncDownloadBtn.addEventListener("click", async () => {
    syncDownloadBtn.disabled = true;
    if (syncNowStatus) syncNowStatus.textContent = "⏬ " + t("syncing");

    if (settingsDirty) {
      const saved = await persistSettings(false);
      if (!saved) {
        if (syncNowStatus) syncNowStatus.textContent = "❌ " + t('saveCredentialsFirst');
        syncDownloadBtn.disabled = false;
        return;
      }
    }

    const remote = await syncRead();
    if (remote && Array.isArray(remote.groups)) {
      state.groups = remote.groups;
      await saveState();
      await render();
      if (syncNowStatus) syncNowStatus.textContent = "✅ " + t("syncDownloadSuccessful");
    } else {
      if (syncNowStatus) syncNowStatus.textContent = "❌ " + t("syncFailed");
    }

    syncDownloadBtn.disabled = false;
    loadConfig().then(config => updateLastSyncInfo(config));
  });
}

// ---------- Export ----------
exportBtn.addEventListener("click", async () => {
  // Export a clean copy of state ensuring hasError flag is present on items
  const exportData = {
    groups: state.groups.map(g => ({
      id: g.id,
      name: g.name,
      updatedAt: g.updatedAt,
      deleted: g.deleted,
      deletedAt: g.deletedAt,
      items: (g.items || []).map(i => ({
        id: i.id,
        title: i.title,
        url: i.url,
        customIcon: i.customIcon || null,
        customIconCache: i.customIconCache || null,
        iconRefreshedAt: Number(i.iconRefreshedAt || 0),
        updatedAt: i.updatedAt,
        deleted: i.deleted || false,
        deletedAt: i.deletedAt || null,
        hasError: !!i.hasError
      }))
    }))
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `speeddial-backup-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

// ---------- Import ----------
importBtn.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const imported = JSON.parse(event.target.result);

      if (!imported.groups || !Array.isArray(imported.groups)) {
        alert("Invalid file format");
        return;
      }

      state.groups = imported.groups;
      await saveState();

      alert("Data imported successfully!");
      settingsModal.classList.add("hidden");
      // Re-render UI to show imported data
      window.location.reload();
    } catch (error) {
      alert("Failed to parse file: " + error.message);
    }
  };

  reader.readAsText(file);
});

importNetscapeBtn?.addEventListener("click", () => {
  importNetscapeFile?.click();
});

importNetscapeFile?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const content = event.target.result;
      const importedGroups = parseNetscapeBookmarks(content);

      if (!importedGroups || importedGroups.length === 0) {
        alert("Invalid file format");
        return;
      }

      state.groups = importedGroups;
      await saveState();

      alert("Data imported successfully!");
      settingsModal.classList.add("hidden");
      window.location.reload();
    } catch (error) {
      alert("Failed to parse file: " + error.message);
    }
  };

  reader.readAsText(file);
});

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeNetscapeBookmarks(groups) {
  const formatDate = ts => Math.floor((ts || Date.now()) / 1000);
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">",
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>"
  ];

  for (const group of groups) {
    const groupName = escapeHtml(group.name || "Group");
    const groupDate = formatDate(group.updatedAt);
    lines.push(`<DT><H3 ADD_DATE=\"${groupDate}\">${groupName}</H3>`);
    lines.push("<DL><p>");

    for (const item of (group.items || []).filter(i => !i.deleted && i.url)) {
      const title = escapeHtml(item.title || item.url);
      const href = escapeHtml(item.url);
      const itemDate = formatDate(item.updatedAt);
      lines.push(`<DT><A HREF=\"${href}\" ADD_DATE=\"${itemDate}\">${title}</A>`);
    }

    lines.push("</DL><p>");
  }

  lines.push("</DL><p>");
  return lines.join("\n");
}

function parseNetscapeBookmarks(content) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/html");
  const dl = doc.querySelector("body > dl");
  if (!dl) {
    throw new Error("Invalid NETSCAPE bookmarks file");
  }

  const groups = [];
  const orphanItems = [];
  const children = Array.from(dl.children);

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.tagName !== "DT") {
      continue;
    }

    const heading = node.querySelector("h3");
    if (heading) {
      const groupName = heading.textContent || "Group";
      const next = children[i + 1];
      const items = [];

      if (next && next.tagName === "DL") {
        for (const itemLink of Array.from(next.querySelectorAll("dt > a"))) {
          const href = itemLink.getAttribute("href");
          if (!href) continue;
          items.push({
            id: generateId("b"),
            title: itemLink.textContent || href,
            url: href,
            customIcon: null,
            customIconCache: null,
            iconRefreshedAt: 0,
            updatedAt: Date.now(),
            deleted: false,
            deletedAt: null,
            hasError: false
          });
        }
        i += 1;
      }

      groups.push({
        id: generateId("g"),
        name: groupName,
        items,
        updatedAt: Date.now(),
        deleted: false,
        deletedAt: null
      });
      continue;
    }

    const link = node.querySelector("a");
    if (link) {
      orphanItems.push({
        id: generateId("b"),
        title: link.textContent || link.getAttribute("href") || "",
        url: link.getAttribute("href") || "",
        customIcon: null,
        customIconCache: null,
        iconRefreshedAt: 0,
        updatedAt: Date.now(),
        deleted: false,
        deletedAt: null,
        hasError: false
      });
    }
  }

  if (orphanItems.length > 0) {
    groups.unshift({
      id: generateId("g"),
      name: "Imported bookmarks",
      items: orphanItems,
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    });
  }

  return groups;
}

exportNetscapeBtn?.addEventListener("click", async () => {
  const html = serializeNetscapeBookmarks(state.groups.filter(g => !g.deleted));
  const dataBlob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `speeddial-bookmarks-${Date.now()}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

exportBookmarksBtn?.addEventListener("click", async () => {
  try {
    const folder = await findOrCreateSimpleDialFolder();
    const existingChildren = await getBookmarkChildren(folder.id);

    for (const child of existingChildren) {
      await removeBookmarkNode(child.id);
    }

    const groupsToExport = state.groups.filter(g => !g.deleted);
    for (const group of groupsToExport) {
      const groupFolder = await createBookmarkNode({ parentId: folder.id, title: group.name || 'Group' });
      const itemsToExport = (group.items || []).filter(item => !item.deleted && item.url);
      for (const item of itemsToExport) {
        await createBookmarkNode({
          parentId: groupFolder.id,
          title: item.title || item.url,
          url: item.url
        });
      }
    }

    syncStatus.textContent = "✅ " + t('bookmarksExportSuccessful');
    alert(t('bookmarksExportSuccessful'));
  } catch (error) {
    console.error('Export to browser bookmarks failed', error);
    syncStatus.textContent = "❌ " + t('syncFailed');
    alert(t('syncFailed'));
  }
});

importBookmarksBtn?.addEventListener("click", async () => {
  if (!confirm(t('browserBookmarksImportWarning'))) {
    return;
  }

  try {
    const folder = await findOrCreateSimpleDialFolder();
    const children = await getBookmarkChildren(folder.id);
    if (!children || children.length === 0) {
      alert(t('browserBookmarksEmpty'));
      return;
    }

    // Sort children by index to ensure consistent ordering across all platforms
    const sortedChildren = (children || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    const importedGroups = [];
    const orphanItems = [];

    for (const child of sortedChildren) {
      if (child.url) {
        orphanItems.push(child);
        continue;
      }

      const items = [];
      const groupChildren = await getBookmarkChildren(child.id);
      // Sort group children by index to ensure consistent ordering across all platforms
      const sortedGroupChildren = (groupChildren || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const item of sortedGroupChildren) {
        if (!item.url) continue;
        items.push({
          id: generateId('b'),
          title: item.title || item.url,
          url: item.url,
          customIcon: null,
          customIconCache: null,
          iconRefreshedAt: 0,
          updatedAt: Date.now(),
          deleted: false,
          deletedAt: null,
          hasError: false
        });
      }

      importedGroups.push({
        id: generateId('g'),
        name: child.title || 'Group',
        items,
        updatedAt: Date.now(),
        deleted: false,
        deletedAt: null
      });
    }

    if (orphanItems.length > 0) {
      // Sort orphan items by index to ensure consistent ordering across all platforms
      const sortedOrphanItems = orphanItems.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      importedGroups.unshift({
        id: generateId('g'),
        name: 'Imported bookmarks',
        items: sortedOrphanItems.map(item => ({
          id: generateId('b'),
          title: item.title || item.url,
          url: item.url,
          customIcon: null,
          customIconCache: null,
          iconRefreshedAt: 0,
          updatedAt: Date.now(),
          deleted: false,
          deletedAt: null,
          hasError: false
        })),
        updatedAt: Date.now(),
        deleted: false,
        deletedAt: null
      });
    }

    if (importedGroups.length === 0) {
      alert(t('browserBookmarksEmpty'));
      return;
    }

    state.groups = importedGroups;
    await saveState();

    alert(t('bookmarksImportSuccessful'));
    settingsModal.classList.add("hidden");
    window.location.reload();
  } catch (error) {
    console.error('Import from browser bookmarks failed', error);
    syncStatus.textContent = "❌ " + t('syncFailed');
    alert(t('syncFailed'));
  }
});

// ---------- Background Image Settings ----------
if (bgImageInput) {
  bgImageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (limit to 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert("Image file is too large. Please use an image smaller than 2MB.");
      bgImageInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const base64Data = event.target.result;
        if (!appearanceDraft) {
          const config = await loadConfig();
          appearanceDraft = {
            backgroundImage: config.appearance?.backgroundImage ?? null,
            backgroundSize: config.appearance?.backgroundSize || 'stretched',
            tileOpacity: config.appearance?.tileOpacity ?? 1,
            showDateTime: config.appearance?.showDateTime ?? true,
            showDeleted: config.appearance?.showDeleted ?? false
          };
        }
        appearanceDraft.backgroundImage = base64Data;
        
        // Show preview
        if (bgPreview) {
          bgPreview.style.backgroundImage = `url('${base64Data}')`;
          bgPreview.style.display = 'block';
        }

        const previewConfig = { appearance: { ...appearanceDraft } };
        await applyBackground(previewConfig);
        markSettingsDirty();
      } catch (error) {
        alert("Failed to load image: " + error.message);
        console.error("Image load error", error);
      }
    };

    reader.readAsDataURL(file);
  });
}

if (bgRemoveBtn) {
  bgRemoveBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to remove the background image?")) {
      return;
    }

    if (!appearanceDraft) {
      const config = await loadConfig();
      appearanceDraft = {
        backgroundImage: config.appearance?.backgroundImage ?? null,
        backgroundSize: config.appearance?.backgroundSize || 'stretched',
        tileOpacity: config.appearance?.tileOpacity ?? 1,
        showDateTime: config.appearance?.showDateTime ?? true,
        showDeleted: config.appearance?.showDeleted ?? false
      };
    }
    appearanceDraft.backgroundImage = null;

    if (bgPreview) {
      bgPreview.style.backgroundImage = "";
      bgPreview.style.display = "none";
    }
    if (bgImageInput) {
      bgImageInput.value = "";
    }

    const previewConfig = { appearance: { ...appearanceDraft } };
    await applyBackground(previewConfig);
    markSettingsDirty();
  });
}

if (bgSizeSelect) {
  bgSizeSelect.addEventListener("change", async () => {
    if (!appearanceDraft) {
      const config = await loadConfig();
      appearanceDraft = {
        backgroundImage: config.appearance?.backgroundImage ?? null,
        backgroundSize: config.appearance?.backgroundSize || 'stretched',
        tileOpacity: config.appearance?.tileOpacity ?? 1,
        showDateTime: config.appearance?.showDateTime ?? true,
        showDeleted: config.appearance?.showDeleted ?? false
      };
    }
    appearanceDraft.backgroundSize = bgSizeSelect.value || 'stretched';

    const previewConfig = { appearance: { ...appearanceDraft } };
    await applyBackground(previewConfig);
    markSettingsDirty();
  });
}

// ---------- Tile Opacity Settings ----------
if (tileOpacitySlider) {
  tileOpacitySlider.addEventListener("input", (e) => {
    const value = e.target.value;
    if (tileOpacityValue) {
      tileOpacityValue.textContent = `${value}%`;
    }
    // Apply opacity immediately
    const opacityValue = value / 100;
    document.body.style.setProperty('--tile-opacity', opacityValue);

    if (appearanceDraft) {
      appearanceDraft.tileOpacity = opacityValue;
    }
    markSettingsDirty();
  });
}

// ---------- Save Settings ----------
async function persistSettings(closeAfterSave = false) {
  const config = await loadConfig();

  // Save sync type and URL directly to config
  if (syncType) {
    config.sync.type = syncType.value || 'direct';
  }

  if (syncType && syncType.value === 'browser') {
    config.sync.serverUrl = '';
    config.sync.authMode = 'none';
    config.sync.username = '';
    config.sync.password = '';
    delete config.sync.enc;
    delete config.sync.localKey;
    config.sync.encryptionMode = 'none';
  } else if (syncUrl.value.trim()) {
    config.sync.serverUrl = syncUrl.value.trim().replace(/\/$/, ""); // Remove trailing slash
  }

  if (syncWebdavType) {
    config.sync.webdavType = syncWebdavType.value || 'generic';
  }

  // Persist selected auth mode for direct/webdav sync types.
  if (syncType && (syncType.value === 'direct' || syncType.value === 'webdav') && syncAuthMode) {
    config.sync.authMode = syncAuthMode.value || 'none';

    if (config.sync.authMode === 'none') {
      clearSyncCredentialsInConfig(config);
      clearSyncCredentialsInUi();
    }
  }

  // Preserve auth and credential storage unless the credentials form was explicitly modified
  if (credentialsTouched && syncAuthMode && syncAuthMode.value === 'basic') {
    syncStatus.textContent = "❌ " + t('saveCredentialsFirst');
    return false;
  }

  // Save enable/disable state
  config.sync.enabled = syncEnable.checked;

  // Save sync interval mode
  if (syncImmediate.checked) {
    config.sync.intervalMode = "immediate";
  } else if (syncCustom.checked) {
    config.sync.intervalMode = "custom";
    config.sync.customIntervalMinutes = parseInt(syncCustomValue.value) || 60;
  } else {
    config.sync.intervalMode = "manual";
  }

  // Save HouseKeeper config
  config.housekeeper.retentionDays = parseInt(hkRetentionDays.value) || 30;
  config.housekeeper.autoCleanupEnabled = hkAutoCleanup.checked;
  config.housekeeper.enableLinkCheck = hkEnableLinkCheck.checked;
  config.housekeeper.highlightDeadLinks = hkHighlightDeadLinks ? !!hkHighlightDeadLinks.checked : true;
  config.housekeeper.iconAutoRefreshMode = getHousekeeperIconRefreshMode();
  config.housekeeper.iconAutoRefreshHours = Math.max(1, parseInt(hkIconRefreshHours?.value, 10) || 24);

  // Save backups config
  config.backups.retentionDays = Math.max(1, parseInt(backupRetentionDays?.value, 10) || 30);
  config.backups.frequencyHours = Math.max(1, parseInt(backupFrequencyHours?.value, 10) || 24);

  // Save appearance settings
  if (bgSizeSelect) {
    config.appearance.backgroundSize = bgSizeSelect.value || 'stretched';
  }
  if (tileOpacitySlider) {
    config.appearance.tileOpacity = tileOpacitySlider.value / 100;
  }
  if (appearanceDraft) {
    config.appearance.backgroundImage = appearanceDraft.backgroundImage ?? null;
  }

  // Save date & time display toggle state
  if (dateTimeToggle) {
    config.appearance.showDateTime = dateTimeToggle.checked;
  }

  if (showDeletedToggle) {
    config.appearance.showDeleted = showDeletedToggle.checked;
  }

  // Save advanced settings
  config.advanced.faviconDebugLogging = !!advFaviconDebugLogging?.checked;
  config.advanced.faviconFetchLink = !!advExperimentalFaviconFetchLink?.checked;
  config.advanced.faviconFetchManifest = !!advExperimentalFaviconFetchManifest?.checked;
  delete config.advanced.enableDebugLogging;
  delete config.advanced.experimentalFaviconFetchLink;
  delete config.advanced.experimentalFaviconFetchManifest;

  // Single save operation
  await saveConfig(config);
  await cleanupOldBackups(config.backups.retentionDays);

  // Update manual sync button visibility based on new settings
  updateManualSyncButtonVisibility(config);

  // Apply highlight setting immediately
  try {
    render();
  } catch (e) {}

  if (dateTimeToggle && typeof window.applySavedDateTimeEnabled === "function") {
    window.applySavedDateTimeEnabled(dateTimeToggle.checked);
  } else if (typeof window.clearDateTimePreview === "function") {
    window.clearDateTimePreview();
  }

  setSettingsDirty(false);

  if (!closeAfterSave && syncStatus) {
    syncStatus.textContent = "✅ " + t('settingsSaved');
  }

  if (closeAfterSave) {
    settingsModal.classList.add("hidden");
  }

  return true;
}

settingsSaveBtn.addEventListener("click", async () => {
  await persistSettings(false);
});

if (settingsSaveCloseBtn) {
  settingsSaveCloseBtn.addEventListener("click", async () => {
    await persistSettings(true);
  });
}

// ---------- Show Deleted Button ----------
showDeletedBtn.addEventListener("click", () => {
  showDeletedToggle.checked = !showDeletedToggle.checked;
  showDeletedToggle.dispatchEvent(new Event("change"));
  
  // Update button appearance
  updateShowDeletedButtonAppearance();
});

function updateShowDeletedButtonAppearance() {
  if (showDeletedToggle.checked) {
    showDeletedBtn.style.opacity = "1";
    showDeletedBtn.style.transform = "scale(1.1)";
  } else {
    showDeletedBtn.style.opacity = "0.6";
    showDeletedBtn.style.transform = "scale(1)";
  }
}

if (showDeletedToggle) {
  showDeletedToggle.addEventListener("change", () => {
    updateShowDeletedButtonAppearance();
  });
}

// Initialize button appearance
updateShowDeletedButtonAppearance();

// ---------- HouseKeeper - Manual Cleanup ----------
if (hkManualCleanup) {
  hkManualCleanup.addEventListener("click", async () => {
    hkManualCleanup.disabled = true;
    hkCleanupStatus.textContent = "🔍 Cleaning...";
    hkCleanupStatus.style.color = "#999";

    try {
      const config = await loadConfig();
      const deletedCount = await cleanupDeletedItems(config.housekeeper.retentionDays);

      config.housekeeper.lastCleanup = Date.now();
      await saveConfig(config);

      hkCleanupStatus.textContent = `✅ Cleanup completed - ${deletedCount} records permanently deleted.`;
      hkCleanupStatus.style.color = "#4caf50";

      updateHouseKeeperInfo(config);
      render();
    } catch (error) {
      hkCleanupStatus.textContent = "❌ Cleanup failed";
      hkCleanupStatus.style.color = "#f44336";
      console.error("Cleanup error:", error);
    } finally {
      hkManualCleanup.disabled = false;
    }
  });
}

// ---------- HouseKeeper - Check Links ----------
if (hkCheckLinks) {
  hkCheckLinks.addEventListener("click", async () => {
    hkCheckLinks.disabled = true;
    hkLinkCheckStatus.textContent = "🔍 Checking links...";
    hkLinkCheckStatus.style.color = "#999";

    try {
      const config = await loadConfig();
      const deadLinkCount = await checkDeadLinks();

      config.housekeeper.lastLinkCheck = Date.now();
      await saveConfig(config);

      hkLinkCheckStatus.textContent = `✅ Link check completed.`;
      hkLinkCheckStatus.style.color = "#4caf50";
      hkDeadLinksCount.textContent = `Dead links found: ${deadLinkCount}`;

      render();
    } catch (error) {
      hkLinkCheckStatus.textContent = "❌ Link check failed";
      hkLinkCheckStatus.style.color = "#f44336";
      console.error("Link check error:", error);
    } finally {
      hkCheckLinks.disabled = false;
    }
  });
}

  // ---------- HouseKeeper - Clear Dead-Link Flags ----------
  if (hkClearErrors) {
    hkClearErrors.addEventListener('click', async () => {
      hkClearErrors.disabled = true;
      hkLinkCheckStatus.textContent = "🔄 Clearing dead-link flags...";
      hkLinkCheckStatus.style.color = "#999";

      try {
        let cleared = 0;
        let changed = false;

        for (const group of state.groups) {
          for (const item of group.items) {
            if (item.hasError) {
              item.hasError = false;
              item.updatedAt = Date.now();
              cleared++;
              changed = true;
            }
          }

          if (changed) {
            group.updatedAt = Date.now();
          }
        }

        if (changed) {
          await saveState();
          try { await syncWrite(); } catch (e) { console.warn('syncWrite failed', e); }
        }

        hkLinkCheckStatus.textContent = `✅ Cleared ${cleared} dead-link flags.`;
        hkLinkCheckStatus.style.color = "#4caf50";
        hkDeadLinksCount.textContent = `Dead links found: 0`;

        try { render(); } catch (e) {}
      } catch (error) {
        hkLinkCheckStatus.textContent = "❌ Clearing failed";
        hkLinkCheckStatus.style.color = "#f44336";
        console.error("Clear dead-link flags error:", error);
      } finally {
        hkClearErrors.disabled = false;
      }
    });
  }

// ---------- Manual Sync Button ----------
manualSyncBtn.addEventListener("click", async () => {
  manualSyncBtn.disabled = true;
  manualSyncBtn.textContent = "⬆️";
  manualSyncBtn.style.opacity = "0.5";

  if (settingsDirty) {
    const saved = await persistSettings(false);
    if (!saved) {
      if (syncStatus) syncStatus.textContent = "❌ " + t('saveCredentialsFirst');
      manualSyncBtn.disabled = false;
      manualSyncBtn.style.opacity = "1";
      return;
    }
  }

  const result = await syncNow();

  if (result.ok) {
    manualSyncBtn.style.opacity = "1";
    if (syncStatus) syncStatus.textContent = "✅ " + t('syncSuccessful');
  } else {
    if (syncStatus) syncStatus.textContent = "❌ " + getSyncFailureMessage(result);
  }

  // Re-enable button after 2 seconds
  setTimeout(() => {
    manualSyncBtn.disabled = false;
    manualSyncBtn.style.opacity = "1";
  }, 2000);
});

function updateManualSyncButtonVisibility(config) {
  if (!manualSyncBtn) return;
  
  // Get current settings
  const isSyncEnabled = config && config.sync && config.sync.enabled;
  const intervalMode = config && config.sync ? (config.sync.intervalMode || "default") : "default";
  
  // Show button only if sync is enabled AND interval mode is "manual"
  const isManualMode = isSyncEnabled && intervalMode === "manual";
  
  console.log(`[Manual Sync] Enabled: ${isSyncEnabled}, Mode: ${intervalMode}, Show: ${isManualMode}`);
  
  if (isManualMode) {
    manualSyncBtn.classList.remove("hidden");
    console.log("[Manual Sync] Button shown");
  } else {
    manualSyncBtn.classList.add("hidden");
    console.log("[Manual Sync] Button hidden");
  }
}

// ---------- Helper Function ----------
function updateLastSyncInfo(config) {
  if (!config.sync.lastSync) {
    lastSyncInfo.textContent = "Never synced";
    return;
  }

  const lastSyncDate = new Date(config.sync.lastSync);
  const now = Date.now();
  const diffMs = now - config.sync.lastSync;
  const diffMins = Math.floor(diffMs / 60000);

  let timeStr = "";
  if (diffMins === 0) {
    timeStr = "just now";
  } else if (diffMins === 1) {
    timeStr = "1 minute ago";
  } else if (diffMins < 60) {
    timeStr = `${diffMins} minutes ago`;
  } else {
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) {
      timeStr = "1 hour ago";
    } else if (diffHours < 24) {
      timeStr = `${diffHours} hours ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) {
        timeStr = "1 day ago";
      } else {
        timeStr = `${diffDays} days ago`;
      }
    }
  }

  lastSyncInfo.textContent = `Last sync: ${timeStr}`;
}

function updateHouseKeeperInfo(config) {
  if (!hkRetentionDays) return;

  // Update retention days display
  hkRetentionDays.value = config.housekeeper.retentionDays || 30;

  // Update auto-cleanup checkbox
  if (hkAutoCleanup) {
    hkAutoCleanup.checked = config.housekeeper.autoCleanupEnabled || false;
  }

  // Update link check checkbox
  if (hkEnableLinkCheck) {
    hkEnableLinkCheck.checked = config.housekeeper.enableLinkCheck || false;
  }

  // Update highlight dead links checkbox
  if (hkHighlightDeadLinks) {
    // default to true when not present
    if (typeof config.housekeeper.highlightDeadLinks === 'boolean') {
      hkHighlightDeadLinks.checked = config.housekeeper.highlightDeadLinks;
    } else {
      hkHighlightDeadLinks.checked = true;
    }
  }

  const iconRefreshMode = config.housekeeper.iconAutoRefreshMode || "all";
  if (hkIconRefreshAll) hkIconRefreshAll.checked = iconRefreshMode === "all";
  if (hkIconRefreshMissing) hkIconRefreshMissing.checked = iconRefreshMode === "missing";
  if (hkIconRefreshNone) hkIconRefreshNone.checked = iconRefreshMode === "none";
  if (hkIconRefreshHours) {
    hkIconRefreshHours.value = String(Math.max(1, parseInt(config.housekeeper.iconAutoRefreshHours, 10) || 24));
  }
  updateHousekeeperIconRefreshFrequencyEnabled();
  updateChoiceOptionStates();

  // Update last cleanup timestamp
  if (config.housekeeper.lastCleanup) {
    const lastCleanupDate = new Date(config.housekeeper.lastCleanup);
    const now = Date.now();
    const diffMs = now - config.housekeeper.lastCleanup;
    const diffMins = Math.floor(diffMs / 60000);

    let timeStr = "";
    if (diffMins === 0) {
      timeStr = "just now";
    } else if (diffMins === 1) {
      timeStr = "1 minute ago";
    } else if (diffMins < 60) {
      timeStr = `${diffMins} minutes ago`;
    } else {
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) {
        timeStr = "1 hour ago";
      } else if (diffHours < 24) {
        timeStr = `${diffHours} hours ago`;
      } else {
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) {
          timeStr = "1 day ago";
        } else {
          timeStr = `${diffDays} days ago`;
        }
      }
    }

    if (hkLastCleanup) {
      hkLastCleanup.textContent = `Last cleanup: ${timeStr}`;
    }
  } else {
    if (hkLastCleanup) {
      hkLastCleanup.textContent = "Last cleanup: Never";
    }
  }
}

function formatBytes(sizeBytes) {
  const bytes = Number(sizeBytes) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatBackupTimestamp(timestamp) {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "-";
  }
}

function getBackupStats(backup) {
  const explicitGroupCount = Number(backup?.groupCount);
  const explicitBookmarkCount = Number(backup?.bookmarkCount);
  if (Number.isFinite(explicitGroupCount) && Number.isFinite(explicitBookmarkCount)) {
    return {
      groupCount: Math.max(0, Math.floor(explicitGroupCount)),
      bookmarkCount: Math.max(0, Math.floor(explicitBookmarkCount))
    };
  }

  try {
    const parsed = JSON.parse(backup?.data || "{}");
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
    const bookmarkCount = groups.reduce((sum, group) => {
      const items = Array.isArray(group?.items)
        ? group.items
        : (Array.isArray(group?.bookmarks) ? group.bookmarks : []);
      return sum + items.length;
    }, 0);
    return {
      groupCount: groups.length,
      bookmarkCount
    };
  } catch {
    return {
      groupCount: 0,
      bookmarkCount: 0
    };
  }
}

async function refreshBackupsTable() {
  if (!backupsTableBody) return;

  const backups = await listBackups();
  backupsTableBody.innerHTML = "";

  if (!backups.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "backups-empty";
    cell.textContent = t("noBackupsYet");
    row.appendChild(cell);
    backupsTableBody.appendChild(row);
    return;
  }

  backups.forEach(backup => {
    const row = document.createElement("tr");

    const timestampCell = document.createElement("td");
    timestampCell.textContent = formatBackupTimestamp(backup.timestamp);

    const sizeCell = document.createElement("td");
    sizeCell.textContent = formatBytes(backup.sizeBytes);

    const statsCell = document.createElement("td");
    const stats = getBackupStats(backup);
    statsCell.textContent = `G:${stats.groupCount} B:${stats.bookmarkCount}`;

    const actionsCell = document.createElement("td");

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "icon-btn primary";
    restoreBtn.textContent = t("restoreBackup");
    restoreBtn.dataset.backupFileRestore = backup.filename;
    restoreBtn.type = "button";
    actionsCell.appendChild(restoreBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn danger";
    deleteBtn.textContent = t("deleteBackup");
    deleteBtn.dataset.backupFileDelete = backup.filename;
    deleteBtn.type = "button";
    deleteBtn.style.marginLeft = "0.5rem";
    actionsCell.appendChild(deleteBtn);

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "icon-btn";
    downloadBtn.textContent = t("downloadBackup");
    downloadBtn.dataset.backupFileDownload = backup.filename;
    downloadBtn.type = "button";
    downloadBtn.style.marginLeft = "0.5rem";
    actionsCell.appendChild(downloadBtn);

    row.appendChild(timestampCell);
    row.appendChild(sizeCell);
    row.appendChild(statsCell);
    row.appendChild(actionsCell);
    backupsTableBody.appendChild(row);
  });
}
if (backupCreateNowBtn) {
  backupCreateNowBtn.addEventListener("click", async () => {
    backupCreateNowBtn.disabled = true;
    if (backupStatus) backupStatus.textContent = "💾 " + t("creatingBackup");

    try {
      const entry = await createBackup();
      const config = await loadConfig();
      await cleanupOldBackups(config.backups?.retentionDays || 30);
      await refreshBackupsTable();

      if (backupStatus) {
        backupStatus.textContent = "✅ " + t("backupCreated") + ` (${entry.filename})`;
      }
    } catch (error) {
      if (backupStatus) backupStatus.textContent = "❌ " + t("backupCreateFailed");
      console.error("createBackup failed", error);
    } finally {
      backupCreateNowBtn.disabled = false;
    }
  });
}

if (backupsTableBody) {
  backupsTableBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const restoreFile = target.dataset.backupFileRestore;
    const deleteFile = target.dataset.backupFileDelete;
    const downloadFile = target.dataset.backupFileDownload;

    if (!restoreFile && !deleteFile && !downloadFile) return;

    if (downloadFile) {
      try {
        const entry = await getBackup(downloadFile);
        const blob = new Blob([entry.data], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = entry.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
      } catch (error) {
        if (backupStatus) backupStatus.textContent = "❌ " + t("backupDownloadFailed");
        console.error("getBackup failed", error);
      }
      return;
    }

    if (restoreFile) {
      const confirmed = confirm(t("confirmRestoreBackup"));
      if (!confirmed) return;

      try {
        const result = await restoreBackup(restoreFile);
        await refreshBackupsTable();
        if (backupStatus) {
          backupStatus.textContent = `⚠️ ${result.warning}`;
        }
        alert(result.warning);
      } catch (error) {
        if (backupStatus) backupStatus.textContent = "❌ " + t("backupRestoreFailed");
        console.error("restoreBackup failed", error);
      }
      return;
    }

    if (deleteFile) {
      const confirmedDelete = confirm(t("confirmDeleteBackup"));
      if (!confirmedDelete) return;

      try {
        await deleteBackup(deleteFile);
        await refreshBackupsTable();
        if (backupStatus) {
          backupStatus.textContent = "✅ " + t("backupDeleted");
        }
      } catch (error) {
        if (backupStatus) backupStatus.textContent = "❌ " + t("backupDeleteFailed");
        console.error("deleteBackup failed", error);
      }
    }
  });
}

// ---------- Initialization ----------
async function initializeManualSyncButton() {
  if (!manualSyncBtn) {
    console.warn("Manual sync button not found in DOM");
    return;
  }
  
  const config = await loadConfig();
  updateManualSyncButtonVisibility(config);
  updateHouseKeeperInfo(config);
}

// Run initialization after a small delay to ensure DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeManualSyncButton);
} else {
  // DOM already loaded
  setTimeout(initializeManualSyncButton, 0);
}

// Re-render when highlight checkbox toggles so indicators show/hide immediately
if (hkHighlightDeadLinks) {
  hkHighlightDeadLinks.addEventListener('change', () => {
    try { render(); } catch (e) {}
  });
}

[hkIconRefreshAll, hkIconRefreshMissing, hkIconRefreshNone].forEach(input => {
  if (!input) return;
  input.addEventListener("change", () => {
    updateHousekeeperIconRefreshFrequencyEnabled();
    updateChoiceOptionStates();
  });
});

// open browser native extension settings in a new tab
document.getElementById('open-extension-settings').addEventListener('click', () => {
  const extensionId = chrome.runtime.id; 
  const settingsUrl = `chrome://extensions/?id=${extensionId}`;
  chrome.tabs.create({ url: settingsUrl });
});

// button to reset language to browser default
document.getElementById('reset-language-to-browser').addEventListener('click', () => {
  resetLanguageToBrowser();
  if (languageSelect) {
    languageSelect.value = getCurrentLanguage();
  }
  render();
  updateUIText();
  updateClock();
});

// ---------- Settings Modal Maximize/Restore ----------
const settingsMaximizeBtn = document.getElementById("settings-maximize-btn");
const settingsModalContent = settingsModal.querySelector(".modal-content");

if (settingsMaximizeBtn && settingsModalContent) {
  settingsMaximizeBtn.addEventListener("click", () => {
    const isMaximized = settingsModalContent.classList.toggle("maximized");
    settingsMaximizeBtn.textContent = isMaximized ? "🗗" : "⛶";
    settingsMaximizeBtn.title = isMaximized ? t("restoreSize") : t("maximize");
  });
}