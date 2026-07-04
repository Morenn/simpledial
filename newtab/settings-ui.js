import { state, saveState, generateId } from "./state.js";
import { loadConfig, saveConfig, getSyncIntervalMs, DEFAULT_SYNC_INTERVAL } from "./config.js";
import { testSyncConnection, requestHostPermission, syncNow, cleanupDeletedItems, checkDeadLinks, syncWrite } from "./sync.js";
import { t, getCurrentLanguage } from "./i18n.js";
import { deriveKeyFromPassword, generateLocalKeyRaw, importRawKey, encryptWithKey, decryptWithKey } from './crypto.js';
import { findOrCreateSimpleDialFolder, getBookmarkChildren, createBookmarkNode, removeBookmarkNode } from './bookmarks-api.js';
import { render } from "./render.js";

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

// Tab System
const tabButtons = document.querySelectorAll(".settings-tab-btn");
const tabContents = document.querySelectorAll(".settings-tab-content");

let isInitializingSettingsForm = false;
let settingsDirty = false;

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
  setSettingsDirty(true);
}

function initializeSettingsDirtyTracking() {
  const trackedElements = document.querySelectorAll('#sync-tab input, #sync-tab select, #appearance-tab input, #appearance-tab select, #housekeeper-tab input');
  trackedElements.forEach(el => {
    if (el.type === 'hidden') return;
    el.addEventListener('input', markSettingsDirty);
    el.addEventListener('change', markSettingsDirty);
  });
}

bindRadioGroupToModel(syncType, syncTypeChoices);
bindRadioGroupToModel(syncAuthMode, syncAuthChoices);
bindRadioGroupToModel(document.getElementById('sync-encrypt-mode'), syncEncryptChoices);
initializeSettingsDirtyTracking();
updateChoiceOptionStates();

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

// ---------- Open Settings Modal ----------
settingsBtn.addEventListener("click", async () => {
  isInitializingSettingsForm = true;
  try {
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
  });
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    settingsModal.classList.add("hidden");
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

// ---------- Sync Now Button ----------
syncNowBtn.addEventListener("click", async () => {
  syncNowBtn.disabled = true;
  syncNowBtn.textContent = "⬆️ " + t("syncing");

  const success = await syncNow();

  if (success) {
    if (syncNowStatus) syncNowStatus.textContent = "✅ " + t("syncSuccessful");
  } else {
    if (syncNowStatus) syncNowStatus.textContent = "❌ " + t("syncFailed");
  }

  // Re-enable button after 2 seconds
  setTimeout(() => {
    syncNowBtn.disabled = false;
    syncNowBtn.textContent = "⬆️ " + t("syncNow");
    
    // Update last sync time
    loadConfig().then(config => updateLastSyncInfo(config));
  }, 2000);
});

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

    const importedGroups = [];
    const orphanItems = [];

    for (const child of children) {
      if (child.url) {
        orphanItems.push(child);
        continue;
      }

      const items = [];
      const groupChildren = await getBookmarkChildren(child.id);
      for (const item of groupChildren || []) {
        if (!item.url) continue;
        items.push({
          id: generateId('b'),
          title: item.title || item.url,
          url: item.url,
          customIcon: null,
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
      importedGroups.unshift({
        id: generateId('g'),
        name: 'Imported bookmarks',
        items: orphanItems.map(item => ({
          id: generateId('b'),
          title: item.title || item.url,
          url: item.url,
          customIcon: null,
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
    return;
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

  // Single save operation
  await saveConfig(config);

  // Update manual sync button visibility based on new settings
  updateManualSyncButtonVisibility(config);

  // Apply highlight setting immediately
  try {
    render();
  } catch (e) {}

  setSettingsDirty(false);

  if (!closeAfterSave && syncStatus) {
    syncStatus.textContent = "✅ " + t('settingsSaved');
  }

  if (closeAfterSave) {
    settingsModal.classList.add("hidden");
  }
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

  const success = await syncNow();

  if (success) {
    manualSyncBtn.style.opacity = "1";
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

