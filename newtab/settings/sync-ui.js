import { state, saveState } from "../state.js";
import { loadConfig, saveConfig } from "../config.js";
import { testSyncConnection, requestHostPermission, syncNow, syncWrite, syncRead, syncReadTest, syncWriteTest, syncWebdavFolderExtras, resetLogonCount } from "../sync.js";
import { t } from "../i18n.js";
import { deriveKeyFromPassword, generateLocalKeyRaw, importRawKey, encryptWithKey, decryptWithKey } from "../crypto.js";
import { render } from "../render.js";
import {
  settingsState,
  updateChoiceOptionStates,
  syncRadioGroupFromModel,
  bindRadioGroupToModel
} from "./context.js";

const manualSyncBtn = document.getElementById("manual-sync-btn");
const syncUrl = document.getElementById("sync-url");
const syncTest = document.getElementById("sync-test");
const syncReadTestBtn = document.getElementById("sync-read-test");
const syncWriteTestBtn = document.getElementById("sync-write-test");
const syncEnable = document.getElementById("sync-enable");
const syncType = document.getElementById("sync-type");
const syncWebdavMode = document.getElementById("sync-webdav-mode");
const syncWebdavModeRow = document.getElementById("sync-webdav-mode-row");
const syncWebdavModeChoices = document.querySelectorAll('input[name="sync-webdav-mode-choice"]');
const syncWebdavFolderRow = document.getElementById("sync-webdav-folder-row");
const syncWebdavContentsCard = document.getElementById("sync-webdav-contents-card");
const syncWebdavFolder = document.getElementById("sync-webdav-folder");
const syncWebdavWidgets = document.getElementById("sync-webdav-widgets");
const syncWebdavConfig = document.getElementById("sync-webdav-config");
const syncWebdavBackups = document.getElementById("sync-webdav-backups");
const syncWebdavBackground = document.getElementById("sync-webdav-background");
const syncWebdavWidgetsMode = document.getElementById("sync-webdav-widgets-mode");
const syncWebdavConfigMode = document.getElementById("sync-webdav-config-mode");
const syncWebdavBackupsMode = document.getElementById("sync-webdav-backups-mode");
const syncWebdavBackgroundMode = document.getElementById("sync-webdav-background-mode");
const syncWebdavManualBtn = document.getElementById("sync-webdav-manual-btn");
const syncWebdavManualStatus = document.getElementById("sync-webdav-manual-status");

const WEBDAV_EXTRA_PARTS = [
  { checkbox: syncWebdavWidgets, modeSelect: syncWebdavWidgetsMode, syncField: "webdavSyncWidgets", modeField: "webdavWidgetsMode" },
  { checkbox: syncWebdavConfig, modeSelect: syncWebdavConfigMode, syncField: "webdavSyncConfig", modeField: "webdavConfigMode" },
  { checkbox: syncWebdavBackups, modeSelect: syncWebdavBackupsMode, syncField: "webdavSyncBackups", modeField: "webdavBackupsMode" },
  { checkbox: syncWebdavBackground, modeSelect: syncWebdavBackgroundMode, syncField: "webdavSyncBackground", modeField: "webdavBackgroundMode" }
];

function updateWebdavPartModeStates() {
  let hasManualPart = false;
  for (const part of WEBDAV_EXTRA_PARTS) {
    const enabled = !!part.checkbox?.checked;
    if (part.modeSelect) {
      part.modeSelect.disabled = !enabled;
      if (enabled && part.modeSelect.value === "manual") {
        hasManualPart = true;
      }
    }
  }
  if (syncWebdavManualBtn) {
    const isFolder = syncType?.value === "webdav" && syncWebdavMode?.value === "folder";
    syncWebdavManualBtn.disabled = !isFolder || !hasManualPart;
  }
}
const syncAuthMode = document.getElementById("sync-auth-mode");
const syncUsername = document.getElementById("sync-username");
const syncPassword = document.getElementById("sync-password");
const syncStatus = document.getElementById("sync-status");
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

const REMOTE_MARKER_LABELS = { sha256: "X-JSON-SHA256", etag: "ETag", "last-modified": "Last-Modified" };

export function setSyncStatusMessage(message = "") {
  if (syncStatus) syncStatus.textContent = message;
}

export function clearSyncStatuses() {
  if (syncStatus) syncStatus.textContent = "";
  if (syncTestStatus) syncTestStatus.textContent = "";
  if (syncNowStatus) syncNowStatus.textContent = "";
  if (syncWebdavManualStatus) syncWebdavManualStatus.textContent = "";
}

export function clearSyncCredentialsInConfig(config) {
  if (!config || !config.sync) return;
  config.sync.username = "";
  config.sync.password = "";
  delete config.sync.enc;
  delete config.sync.localKey;
  config.sync.encryptionMode = "none";
}

export function clearSyncCredentialsInUi() {
  if (syncUsername) syncUsername.value = "";
  if (syncPassword) syncPassword.value = "";
  const syncEncryptMode = document.getElementById("sync-encrypt-mode");
  if (syncEncryptMode) {
    syncEncryptMode.value = "none";
    syncRadioGroupFromModel(syncEncryptMode, syncEncryptChoices);
  }
  settingsState.credentialsTouched = false;
  updateCredentialsSaveButton();
  updateWebdavPartModeStates();
}

export function updateSyncFields() {
  const isBrowserSync = syncType && syncType.value === "browser";
  const isDirect = syncType && syncType.value === "direct";
  const isWebdav = syncType && syncType.value === "webdav";
  const isWebdavFolder = isWebdav && syncWebdavMode && syncWebdavMode.value === "folder";
  const syncUrlDiv = document.getElementById("sync-url-row");
  const authDiv = syncAuthCard;
  const encryptDiv = syncEncryptSection;
  const userDiv = syncUsernameRow;
  const passDiv = syncPasswordRow;

  if (syncUrlDiv) syncUrlDiv.style.display = isBrowserSync ? "none" : "";
  if (syncWebdavModeRow) syncWebdavModeRow.classList.toggle("hidden", !isWebdav);
  if (syncWebdavFolderRow) syncWebdavFolderRow.classList.toggle("hidden", !isWebdavFolder);
  if (syncWebdavContentsCard) syncWebdavContentsCard.classList.toggle("hidden", !isWebdavFolder);
  if (syncUrl) {
    syncUrl.placeholder = isWebdavFolder
      ? "https://cloud.example/remote.php/dav/files/user"
      : "https://sync.local/speeddial.json";
  }
  if (syncTest) syncTest.style.display = isBrowserSync ? "none" : "";
  if (authDiv) authDiv.style.display = isBrowserSync ? "none" : "";
  if (syncBrowserHint) syncBrowserHint.classList.toggle("hidden", !isBrowserSync);

  const usingBasic = (isDirect || isWebdav) && syncAuthMode && syncAuthMode.value === "basic";
  if (syncCredentialsCard) syncCredentialsCard.style.display = usingBasic ? "" : "none";
  if (userDiv) userDiv.style.display = usingBasic ? "" : "none";
  if (passDiv) passDiv.style.display = usingBasic ? "" : "none";

  const showEncrypt = usingBasic;
  if (encryptDiv) encryptDiv.style.display = showEncrypt ? "" : "none";

  if (syncUsername) syncUsername.required = usingBasic;
  if (syncPassword) syncPassword.required = usingBasic;

  const userLabel = document.getElementById("sync-username-label");
  const passLabel = document.getElementById("sync-password-label");
  if (userLabel) userLabel.textContent = (userLabel.textContent || "").replace(" *", "") + (usingBasic ? " *" : "");
  if (passLabel) passLabel.textContent = (passLabel.textContent || "").replace(" *", "") + (usingBasic ? " *" : "");

  if (syncCredentialsRow) {
    syncCredentialsRow.style.display = usingBasic ? "" : "none";
  }
  if (syncAuthResetNote) {
    syncAuthResetNote.classList.toggle("hidden", !!usingBasic || isBrowserSync);
  }
  updateCredentialsSaveButton();
  updateWebdavPartModeStates();
}

export function updateSyncNowButtonDisabledState() {
  if (!syncNowBtn) return;
  syncNowBtn.disabled = !(syncEnable && syncEnable.checked);
}

function updateCredentialsSaveButton() {
  if (!syncCredentialsSaveBtn) return;
  const isBasic = syncAuthMode && syncAuthMode.value === "basic";
  syncCredentialsSaveBtn.disabled = !settingsState.credentialsTouched || !isBasic;
}

function markCredentialsTouched() {
  settingsState.credentialsTouched = true;
  updateCredentialsSaveButton();
  updateWebdavPartModeStates();
}

function formatSupportedHeadersSummary(supportedHeaders) {
  if (!supportedHeaders) return "";

  const supported = Object.keys(supportedHeaders).filter(type => supportedHeaders[type]);
  if (supported.length === 0) return t("noChangeMarkerHeaders");

  return t("supportedChangeMarkerHeaders") + ": " + supported.map(type => REMOTE_MARKER_LABELS[type] || type).join(", ");
}

export function getSyncFailureMessage(result) {
  switch (result?.reason) {
    case "not-configured":
      return t("syncNotConfigured");
    case "credentials-missing":
      return t("syncCredentialsMissing");
    case "credentials-locked":
      return t("syncCredentialsLocked");
    case "credentials-decrypt-failed":
      return t("syncCredentialsDecryptFailed");
    case "unexpected-html-response":
      return t("syncUnexpectedHtmlResponse");
    case "locked":
      return t("syncRemoteLocked");
    case "auth-redirect":
      return t("syncAuthRedirectOpened");
    case "auth":
      return t("wrongCredentials");
    case "timeout":
      return t("connectionTimeout");
    case "network-or-cors":
      return t("unreachableServer");
    case "auth-encoding-failed":
      return t("invalidCredentialsEncoding");
    case "invalid-url":
      return t("invalidUrl");
    case "http-error":
      return `${t("serverError")} (${result.status ?? "?"})`;
    case "browser-sync-error":
      return t("browserSyncUnavailable");
    default:
      return t("syncFailed");
  }
}

export function updateManualSyncButtonVisibility(config) {
  if (!manualSyncBtn) return;

  const isSyncEnabled = config && config.sync && config.sync.enabled;
  const intervalMode = config && config.sync ? (config.sync.intervalMode || "default") : "default";
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

export function updateLastSyncInfo(config) {
  if (!lastSyncInfo) return;
  if (!config.sync.lastSync) {
    lastSyncInfo.textContent = "Never synced";
    return;
  }

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

export async function populateSyncSettings(config) {
  if (syncUrl) syncUrl.value = config.sync.serverUrl || "";
  if (syncEnable) syncEnable.checked = config.sync.enabled;
  if (syncType) syncType.value = config.sync.type || "direct";
  if (syncWebdavMode) syncWebdavMode.value = config.sync.webdavMode === "folder" ? "folder" : "file";
  if (syncWebdavFolder) syncWebdavFolder.value = config.sync.webdavFolderPath || "";
  if (syncWebdavWidgets) syncWebdavWidgets.checked = config.sync.webdavSyncWidgets !== false;
  if (syncWebdavConfig) syncWebdavConfig.checked = config.sync.webdavSyncConfig !== false;
  if (syncWebdavBackups) syncWebdavBackups.checked = !!config.sync.webdavSyncBackups;
  if (syncWebdavBackground) syncWebdavBackground.checked = !!config.sync.webdavSyncBackground;
  for (const part of WEBDAV_EXTRA_PARTS) {
    if (part.modeSelect) {
      part.modeSelect.value = config.sync[part.modeField] === "manual" ? "manual" : "auto";
    }
  }
  updateWebdavPartModeStates();
  if (syncAuthMode) syncAuthMode.value = config.sync.authMode || (config.sync.password ? "basic" : "none");
  syncRadioGroupFromModel(syncType, syncTypeChoices);
  syncRadioGroupFromModel(syncWebdavMode, syncWebdavModeChoices);
  syncRadioGroupFromModel(syncAuthMode, syncAuthChoices);

  const syncEncryptMode = document.getElementById("sync-encrypt-mode");
  if (syncEncryptMode) {
    syncEncryptMode.value = config.sync.encryptionMode || "none";
    syncRadioGroupFromModel(syncEncryptMode, syncEncryptChoices);
  }

  try {
    if (config.sync.authMode === "basic") {
      if (config.sync.encryptionMode === "none") {
        if (syncUsername) syncUsername.value = config.sync.username || "";
        if (syncPassword) syncPassword.value = config.sync.password || "";
      } else if (config.sync.encryptionMode === "local" && config.sync.localKey && config.sync.enc) {
        try {
          const key = await importRawKey(config.sync.localKey);
          const plain = await decryptWithKey(key, config.sync.enc.ciphertext, config.sync.enc.iv);
          const obj = JSON.parse(plain);
          if (syncUsername) syncUsername.value = obj.username || "";
          if (syncPassword) syncPassword.value = obj.password || "";
        } catch (e) {
          console.warn("Failed to decrypt local credentials", e);
        }
      } else if (config.sync.encryptionMode === "master" && config.sync.enc) {
        if (window._speeddial_masterKey) {
          try {
            const plain = await decryptWithKey(window._speeddial_masterKey, config.sync.enc.ciphertext, config.sync.enc.iv);
            const obj = JSON.parse(plain);
            if (syncUsername) syncUsername.value = obj.username || "";
            if (syncPassword) syncPassword.value = obj.password || "";
          } catch (e) {
            console.warn("Failed to decrypt with cached master key", e);
            if (syncStatus) syncStatus.textContent = "❌ " + t("enterMasterPasswordPrompt");
          }
        } else {
          const pw = prompt(t("enterMasterPasswordPrompt") + " (leave empty to skip)");
          if (pw) {
            try {
              const derived = await deriveKeyFromPassword(pw, config.sync.enc.salt);
              const plain = await decryptWithKey(derived.key, config.sync.enc.ciphertext, config.sync.enc.iv);
              window._speeddial_masterKey = derived.key;
              const obj = JSON.parse(plain);
              if (syncUsername) syncUsername.value = obj.username || "";
              if (syncPassword) syncPassword.value = obj.password || "";
            } catch (e) {
              console.warn("Master password failed", e);
              if (syncStatus) syncStatus.textContent = "❌ " + t("enterMasterPasswordPrompt");
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("Error while loading encrypted credentials", e);
  }

  settingsState.credentialsTouched = false;
  updateSyncFields();
  updateSyncNowButtonDisabledState();

  const intervalMode = config.sync.intervalMode || "default";
  if (intervalMode === "immediate") {
    if (syncImmediate) syncImmediate.checked = true;
    if (syncCustomValue) syncCustomValue.disabled = true;
  } else if (intervalMode === "custom") {
    if (syncCustom) syncCustom.checked = true;
    if (syncCustomValue) {
      syncCustomValue.disabled = false;
      syncCustomValue.value = config.sync.customIntervalMinutes || 60;
    }
  } else {
    if (syncManual) syncManual.checked = true;
    if (syncCustomValue) syncCustomValue.disabled = true;
  }
  updateChoiceOptionStates();

  updateLastSyncInfo(config);
  updateManualSyncButtonVisibility(config);
}

export function applySyncToConfig(config) {
  if (syncType) {
    config.sync.type = syncType.value || "direct";
  }
  if (syncWebdavMode) {
    config.sync.webdavMode = syncWebdavMode.value === "folder" ? "folder" : "file";
  }
  if (syncWebdavFolder) {
    config.sync.webdavFolderPath = syncWebdavFolder.value.trim().replace(/^\/+|\/+$/g, "");
  }
  if (syncWebdavWidgets) config.sync.webdavSyncWidgets = !!syncWebdavWidgets.checked;
  if (syncWebdavConfig) config.sync.webdavSyncConfig = !!syncWebdavConfig.checked;
  if (syncWebdavBackups) config.sync.webdavSyncBackups = !!syncWebdavBackups.checked;
  if (syncWebdavBackground) config.sync.webdavSyncBackground = !!syncWebdavBackground.checked;
  for (const part of WEBDAV_EXTRA_PARTS) {
    if (part.modeSelect) {
      config.sync[part.modeField] = part.modeSelect.value === "manual" ? "manual" : "auto";
    }
  }

  if (syncType && syncType.value === "browser") {
    config.sync.serverUrl = "";
    config.sync.authMode = "none";
    config.sync.username = "";
    config.sync.password = "";
    delete config.sync.enc;
    delete config.sync.localKey;
    config.sync.encryptionMode = "none";
  } else if (syncUrl?.value.trim()) {
    config.sync.serverUrl = syncUrl.value.trim().replace(/\/$/, "");
  }

  if (syncType && (syncType.value === "direct" || syncType.value === "webdav") && syncAuthMode) {
    config.sync.authMode = syncAuthMode.value || "none";
    if (config.sync.authMode === "none") {
      clearSyncCredentialsInConfig(config);
      clearSyncCredentialsInUi();
    }
  }

  if (settingsState.credentialsTouched && syncAuthMode && syncAuthMode.value === "basic") {
    if (syncStatus) syncStatus.textContent = "❌ " + t("saveCredentialsFirst");
    return false;
  }

  config.sync.enabled = !!syncEnable?.checked;

  if (syncImmediate?.checked) {
    config.sync.intervalMode = "immediate";
  } else if (syncCustom?.checked) {
    config.sync.intervalMode = "custom";
    config.sync.customIntervalMinutes = parseInt(syncCustomValue?.value, 10) || 60;
  } else {
    config.sync.intervalMode = "manual";
  }

  return true;
}

export function initSyncSettings({ persistSettings }) {
  bindRadioGroupToModel(syncType, syncTypeChoices);
  bindRadioGroupToModel(syncWebdavMode, syncWebdavModeChoices);
  bindRadioGroupToModel(syncAuthMode, syncAuthChoices);
  bindRadioGroupToModel(document.getElementById("sync-encrypt-mode"), syncEncryptChoices);

  if (syncWebdavMode) {
    syncWebdavMode.addEventListener("change", updateSyncFields);
  }

  if (syncImmediate) {
    syncImmediate.addEventListener("change", () => {
      if (syncCustomValue) syncCustomValue.disabled = true;
      updateChoiceOptionStates();
    });
  }
  if (syncCustom) {
    syncCustom.addEventListener("change", () => {
      if (syncCustomValue) {
        syncCustomValue.disabled = false;
        syncCustomValue.focus();
      }
      updateChoiceOptionStates();
    });
  }
  if (syncManual) {
    syncManual.addEventListener("change", () => {
      if (syncCustomValue) syncCustomValue.disabled = true;
      updateChoiceOptionStates();
    });
  }

  if (syncAuthMode) {
    syncAuthMode.addEventListener("change", () => {
      updateSyncFields();
      markCredentialsTouched();
    });
  }
  if (syncEnable) syncEnable.addEventListener("change", updateSyncNowButtonDisabledState);
  if (syncType) syncType.addEventListener("change", updateSyncFields);
  for (const part of WEBDAV_EXTRA_PARTS) {
    part.checkbox?.addEventListener("change", updateWebdavPartModeStates);
    part.modeSelect?.addEventListener("change", updateWebdavPartModeStates);
  }
  if (syncUsername) syncUsername.addEventListener("input", markCredentialsTouched);
  if (syncPassword) syncPassword.addEventListener("input", markCredentialsTouched);
  const syncEncryptModeEl = document.getElementById("sync-encrypt-mode");
  if (syncEncryptModeEl) syncEncryptModeEl.addEventListener("change", markCredentialsTouched);

  if (syncCredentialsSaveBtn) {
    syncCredentialsSaveBtn.addEventListener("click", async () => {
      const config = await loadConfig();

      if (!(syncType && (syncType.value === "direct" || syncType.value === "webdav") && syncAuthMode && syncAuthMode.value === "basic")) {
        if (syncStatus) syncStatus.textContent = "❌ " + t("syncAuthCredentialsRequired");
        return;
      }

      config.sync.type = syncType.value || "direct";
      if (syncType && syncType.value === "browser") {
        config.sync.serverUrl = "";
        config.sync.authMode = "none";
        clearSyncCredentialsInConfig(config);
      } else if (syncUrl?.value.trim()) {
        config.sync.serverUrl = syncUrl.value.trim().replace(/\/$/, "");
      }

      config.sync.authMode = "basic";

      const formUsername = syncUsername ? syncUsername.value.trim() : "";
      const formPassword = syncPassword ? syncPassword.value : "";
      if (!formUsername || !formPassword) {
        if (syncStatus) syncStatus.textContent = "❌ " + t("syncAuthCredentialsRequired");
        return;
      }

      const encryptModeEl = document.getElementById("sync-encrypt-mode");
      const encryptMode = encryptModeEl ? encryptModeEl.value : "none";
      config.sync.encryptionMode = encryptMode || "none";

      if (encryptMode === "none") {
        config.sync.username = formUsername;
        config.sync.password = formPassword;
        delete config.sync.enc;
        delete config.sync.localKey;
      } else if (encryptMode === "local") {
        if (!config.sync.localKey) {
          config.sync.localKey = await generateLocalKeyRaw();
        }
        try {
          const key = await importRawKey(config.sync.localKey);
          const payload = JSON.stringify({ username: formUsername, password: formPassword });
          const enc = await encryptWithKey(key, payload);
          config.sync.enc = { ciphertext: enc.ciphertext, iv: enc.iv };
          config.sync.username = "";
          config.sync.password = "";
        } catch (e) {
          console.error("Failed to encrypt with local key", e);
          if (syncStatus) syncStatus.textContent = "❌ Encryption failed";
          return;
        }
      } else if (encryptMode === "master") {
        const pw = prompt(t("enterMasterPasswordPrompt"));
        if (!pw) {
          if (syncStatus) syncStatus.textContent = "❌ " + t("enterMasterPasswordPrompt");
          return;
        }

        const confirmPw = prompt(t("confirmMasterPasswordPrompt"));
        if (pw !== confirmPw) {
          if (syncStatus) syncStatus.textContent = "❌ " + t("confirmMasterPasswordPrompt");
          return;
        }

        try {
          const derived = await deriveKeyFromPassword(pw, null);
          const payload = JSON.stringify({ username: formUsername, password: formPassword });
          const enc = await encryptWithKey(derived.key, payload);
          config.sync.enc = { ciphertext: enc.ciphertext, iv: enc.iv, salt: derived.salt };
          config.sync.username = "";
          config.sync.password = "";
          window._speeddial_masterKey = derived.key;
        } catch (e) {
          console.error("Failed to encrypt with master password", e);
          if (syncStatus) syncStatus.textContent = "❌ Encryption failed";
          return;
        }
      }

      await saveConfig(config);
      settingsState.credentialsTouched = false;
      updateCredentialsSaveButton();
      if (syncStatus) syncStatus.textContent = "✅ " + t("credentialsSaved");
    });
  }

  if (syncTest) {
    syncTest.addEventListener("click", async () => {
      resetLogonCount();
      const url = syncUrl ? syncUrl.value.trim() : "";

      if (!url) {
        if (syncTestStatus) syncTestStatus.textContent = "❌ " + t("fillUrl");
        return;
      }

      const granted = await requestHostPermission(url, syncType && syncType.value ? syncType.value : "direct");
      if (!granted) {
        if (syncTestStatus) syncTestStatus.textContent = "❌ " + t("permissionDenied");
        return;
      }

      if (syncTestStatus) syncTestStatus.textContent = "🔍 " + t("testingConnection");

      const useBasic = syncAuthMode && syncAuthMode.value === "basic";
      const webdavMode = syncWebdavMode && syncWebdavMode.value === "folder" ? "folder" : "file";
      const webdavFolderPath = syncWebdavFolder ? syncWebdavFolder.value.trim() : "";
      const result = await testSyncConnection(
        url,
        useBasic ? (syncUsername ? syncUsername.value : "") : "",
        useBasic ? (syncPassword ? syncPassword.value : "") : "",
        syncType && syncType.value ? syncType.value : "direct",
        { webdavMode, webdavFolderPath }
      );

      let message = "";
      if (result.ok) {
        if (result.reason === "folder-ready") {
          message = "✅ " + (t("syncWebdavFolderReady") || "WebDAV folder read/write permissions verified.");
        } else if (result.reason === "not-found-will-create") {
          message = "✅ " + t("serverResponds") + " " + t("fileWillBeCreated");
        } else {
          message = "✅ " + t("serverResponds");
        }
      } else {
        switch (result.reason) {
          case "folder-create-failed":
            message = "❌ " + (t("syncWebdavFolderCreateFailed") || "Cannot create WebDAV folder.") + ` (${result.status ?? "?"})`;
            break;
          case "folder-not-writable":
            message = "❌ " + (t("syncWebdavFolderNotWritable") || "WebDAV folder is not writable.") + ` (${result.status ?? "?"})`;
            break;
          case "folder-not-readable":
            message = "❌ " + (t("syncWebdavFolderNotReadable") || "WebDAV folder is not readable.") + ` (${result.status ?? "?"})`;
            break;
          case "auth-redirect":
            message = "❌ " + t("syncAuthRedirectOpened");
            break;
          case "auth":
            message = "❌ " + t("wrongCredentials");
            break;
          case "timeout":
            message = "❌ " + t("connectionTimeout");
            break;
          case "network-or-cors":
            message = "❌ " + t("unreachableServer");
            break;
          case "auth-encoding-failed":
            message = "❌ " + t("invalidCredentialsEncoding");
            break;
          case "invalid-url":
            message = "❌ " + t("invalidUrl");
            break;
          case "http-error":
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
        if (settingsState.settingsDirty) {
          const saved = await persistSettings(false);
          if (!saved) {
            if (syncTestStatus) syncTestStatus.textContent = "❌ " + t("saveCredentialsFirst");
            return;
          }
        }

        const result = await syncReadTest();
        if (result.ok) {
          const groupCount = Array.isArray(result.data?.groups) ? result.data.groups.length : 0;
          const headerSummary = formatSupportedHeadersSummary(result.supportedHeaders);
          if (syncTestStatus) syncTestStatus.textContent = "✅ " + t("readTestSuccessful") + ` (${groupCount})` + (headerSummary ? ` — ${headerSummary}` : "");
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
        if (settingsState.settingsDirty) {
          const saved = await persistSettings(false);
          if (!saved) {
            if (syncTestStatus) syncTestStatus.textContent = "❌ " + t("saveCredentialsFirst");
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

  if (syncNowBtn) {
    syncNowBtn.addEventListener("click", async () => {
      if (!(syncEnable && syncEnable.checked)) {
        if (syncNowStatus) syncNowStatus.textContent = "❌ " + t("syncNotConfigured");
        updateSyncNowButtonDisabledState();
        return;
      }

      syncNowBtn.disabled = true;
      syncNowBtn.textContent = "⬆️ " + t("syncing");

      if (settingsState.settingsDirty) {
        const saved = await persistSettings(false);
        if (!saved) {
          if (syncNowStatus) syncNowStatus.textContent = "❌ " + t("saveCredentialsFirst");
          syncNowBtn.disabled = false;
          syncNowBtn.textContent = "⬆️ " + t("syncNow");
          return;
        }
      }

      const result = await syncNow({ includeManualExtras: true });

      if (result.ok) {
        if (syncNowStatus) syncNowStatus.textContent = "✅ " + t("syncSuccessful");
      } else {
        if (syncNowStatus) syncNowStatus.textContent = "❌ " + getSyncFailureMessage(result);
      }

      setTimeout(() => {
        updateSyncNowButtonDisabledState();
        syncNowBtn.textContent = "⬆️ " + t("syncNow");
        loadConfig().then(config => updateLastSyncInfo(config));
      }, 2000);
    });
  }

  if (syncUploadBtn) {
    syncUploadBtn.addEventListener("click", async () => {
      syncUploadBtn.disabled = true;
      if (syncNowStatus) syncNowStatus.textContent = "⏫ " + t("syncing");

      if (settingsState.settingsDirty) {
        const saved = await persistSettings(false);
        if (!saved) {
          if (syncNowStatus) syncNowStatus.textContent = "❌ " + t("saveCredentialsFirst");
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

      if (settingsState.settingsDirty) {
        const saved = await persistSettings(false);
        if (!saved) {
          if (syncNowStatus) syncNowStatus.textContent = "❌ " + t("saveCredentialsFirst");
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

  if (syncWebdavManualBtn) {
    syncWebdavManualBtn.addEventListener("click", async () => {
      if (settingsState.settingsDirty) {
        const saved = await persistSettings(false);
        if (!saved) {
          if (syncWebdavManualStatus) syncWebdavManualStatus.textContent = "❌ " + t("saveCredentialsFirst");
          return;
        }
      }
      const url = syncUrl?.value.trim() || "";
      if (url && !await requestHostPermission(url)) {
        if (syncWebdavManualStatus) syncWebdavManualStatus.textContent = "❌ " + t("hostPermissionRequired");
        return;
      }
      syncWebdavManualBtn.disabled = true;
      if (syncWebdavManualStatus) syncWebdavManualStatus.textContent = "⏳ " + t("syncing");
      try {
        const result = await syncWebdavFolderExtras(null, { includeManual: true, manualOnly: true });
        if (result?.skipped) {
          if (syncWebdavManualStatus) syncWebdavManualStatus.textContent = "ℹ️ " + (t("syncWebdavNoManualParts") || "No manual parts selected");
        } else if (result?.ok) {
          if (syncWebdavManualStatus) syncWebdavManualStatus.textContent = "✅ " + t("syncSuccessful");
        } else {
          if (syncWebdavManualStatus) syncWebdavManualStatus.textContent = "❌ " + getSyncFailureMessage(result);
        }
      } finally {
        updateWebdavPartModeStates();
      }
    });
  }

  if (manualSyncBtn) {
    manualSyncBtn.addEventListener("click", async () => {
      manualSyncBtn.disabled = true;
      manualSyncBtn.textContent = "⬆️";
      manualSyncBtn.style.opacity = "0.5";

      if (settingsState.settingsDirty) {
        const saved = await persistSettings(false);
        if (!saved) {
          if (syncStatus) syncStatus.textContent = "❌ " + t("saveCredentialsFirst");
          manualSyncBtn.disabled = false;
          manualSyncBtn.style.opacity = "1";
          return;
        }
      }

      const result = await syncNow({ includeManualExtras: true });

      if (result.ok) {
        manualSyncBtn.style.opacity = "1";
        if (syncStatus) syncStatus.textContent = "✅ " + t("syncSuccessful");
      } else {
        if (syncStatus) syncStatus.textContent = "❌ " + getSyncFailureMessage(result);
      }

      setTimeout(() => {
        manualSyncBtn.disabled = false;
        manualSyncBtn.style.opacity = "1";
      }, 2000);
    });
  }
}
