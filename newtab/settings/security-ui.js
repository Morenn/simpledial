import { loadConfig, saveConfig, shouldSync } from "../config.js";
import { t } from "../i18n.js";
import { pollAllRestStatusWidgets } from "../custom-widgets.js";
import { updateFooter } from "../render.js";
import { syncNow, clearLastSyncErrorReason } from "../sync.js";
import {
  setupVault,
  unlockVault,
  tryAutoUnlockVault,
  lockVault,
  changeVaultPassword,
  isVaultUnlocked,
  isEncryptedSecret,
  setSecret,
  validateVaultPassword,
  isVaultPasswordExpired,
  getVaultPasswordDaysRemaining,
  VAULT_PASSWORD_CHANGE_INTERVAL,
  DEFAULT_VAULT_KDF,
  normalizeVaultAutoLockMinutes,
  touchVaultActivity
} from "../crypto.js";
import { settingsState } from "./context.js";
import { clearSyncCredentialsInUi } from "./sync-ui.js";

const statusBadgeEl = document.getElementById("security-vault-status");
const plaintextCountEl = document.getElementById("security-plaintext-count");
const setupPanel = document.getElementById("security-setup-panel");
const lockedPanel = document.getElementById("security-locked-panel");
const unlockedPanel = document.getElementById("security-unlocked-panel");
const destroyPanel = document.getElementById("security-destroy-panel");
const destroyBtn = document.getElementById("security-destroy-btn");

const setupPasswordInput = document.getElementById("security-setup-password");
const setupConfirmInput = document.getElementById("security-setup-confirm");
const setupKdfSelect = document.getElementById("security-setup-kdf");
const setupBtn = document.getElementById("security-setup-btn");

const unlockPasswordInput = document.getElementById("security-unlock-password");
const unlockBtn = document.getElementById("security-unlock-btn");

const lockBtn = document.getElementById("security-lock-btn");
const encryptExistingBtn = document.getElementById("security-encrypt-existing-btn");
const autoLockInput = document.getElementById("security-autolock-minutes");
const muteSyncLockedInput = document.getElementById("security-mute-sync-locked-warning");

const oldPasswordInput = document.getElementById("security-old-password");
const newPasswordInput = document.getElementById("security-new-password");
const newConfirmInput = document.getElementById("security-new-confirm");
const changeKdfSelect = document.getElementById("security-change-kdf");
const changePwBtn = document.getElementById("security-change-pw-btn");

const actionStatusEl = document.getElementById("security-action-status");

function countPlaintextWidgetTokens(widgets = []) {
  if (!Array.isArray(widgets)) return 0;
  return widgets.filter(w =>
    (w?.type === "rest-status" && typeof w.authHeaderValue === "string" && w.authHeaderValue !== "" && !isEncryptedSecret(w.authHeaderValue))
    || (w?.type === "weather" && typeof w.apiKey === "string" && w.apiKey !== "" && !isEncryptedSecret(w.apiKey))
  ).length;
}

async function encryptWidgetsList(widgets = []) {
  if (!Array.isArray(widgets) || !isVaultUnlocked()) return { widgets, changed: false };
  let changed = false;
  const next = [];
  for (const w of widgets) {
    if (
      w?.type === "rest-status" &&
      typeof w.authHeaderValue === "string" &&
      w.authHeaderValue !== "" &&
      !isEncryptedSecret(w.authHeaderValue)
    ) {
      const encrypted = await setSecret(w.authHeaderValue, `widget:${w.id}:authHeaderValue`, { requireVault: true });
      next.push({ ...w, authHeaderValue: encrypted });
      changed = true;
    } else if (
      w?.type === "weather" &&
      typeof w.apiKey === "string" &&
      w.apiKey !== "" &&
      !isEncryptedSecret(w.apiKey)
    ) {
      const encrypted = await setSecret(w.apiKey, `widget:${w.id}:apiKey`, { requireVault: true });
      next.push({ ...w, apiKey: encrypted });
      changed = true;
    } else {
      next.push(w);
    }
  }
  return { widgets: next, changed };
}

function formatPasswordPolicyError(errors = []) {
  const parts = errors.map(e => {
    switch (e.code) {
      case "length": return `at least ${e.min} characters`;
      case "maxLength": return `at most ${e.max} characters`;
      case "digits": return `at least ${e.min} digit(s)`;
      case "letters": return `at least ${e.min} letter(s)`;
      case "lowercase": return `at least ${e.min} lowercase letter(s)`;
      case "uppercase": return `at least ${e.min} uppercase letter(s)`;
      case "specials": return `at least ${e.min} special character(s)`;
      default: return e.code;
    }
  });
  return (t("securityPasswordPolicyError") || "Password must contain:") + " " + parts.join(", ");
}

export async function populateSecuritySettings(config = null) {
  const cfg = config || await loadConfig();
  const hasHeader = !!cfg?.vaultHeader?.check;
  const autoLockMinutes = normalizeVaultAutoLockMinutes(cfg?.vaultAutoLockMinutes);
  if (hasHeader && !isVaultUnlocked()) {
    await tryAutoUnlockVault(cfg.vaultHeader, { autoLockMinutes });
  }
  if (autoLockInput) {
    autoLockInput.value = String(autoLockMinutes);
  }
  if (muteSyncLockedInput) {
    muteSyncLockedInput.checked = !!cfg?.vaultMuteSyncLockedWarning;
  }
  const unlocked = hasHeader && isVaultUnlocked();
  const activeWidgets = settingsState.appearanceDraft?.customWidgets || cfg?.appearance?.customWidgets || [];
  const plainCount = countPlaintextWidgetTokens(activeWidgets);

  if (statusBadgeEl) {
    if (!hasHeader) {
      statusBadgeEl.textContent = "⚪ " + (t("securityStatusNotSet") || "Vault not set up");
    } else if (unlocked) {
      const expired = isVaultPasswordExpired(cfg.vaultHeader);
      const daysLeft = getVaultPasswordDaysRemaining(cfg.vaultHeader);
      if (expired) {
        statusBadgeEl.textContent = `⚠️ ${t("securityStatusUnlocked") || "Vault unlocked"} (${(t("securityPasswordExpired") || "Password older than {0} days — please change it").replace("{0}", String(VAULT_PASSWORD_CHANGE_INTERVAL))})`;
      } else if (daysLeft !== null) {
        statusBadgeEl.textContent = `🟢 ${t("securityStatusUnlocked") || "Vault unlocked"} (${(t("securityDaysRemaining") || "expires in {0} day(s)").replace("{0}", String(daysLeft))})`;
      } else {
        statusBadgeEl.textContent = "🟢 " + (t("securityStatusUnlocked") || "Vault unlocked");
      }
    } else {
      statusBadgeEl.textContent = "🔒 " + (t("securityStatusLocked") || "Vault locked");
    }
  }

  if (plaintextCountEl) {
    plaintextCountEl.textContent = plainCount > 0
      ? `⚠️ ${plainCount} ${t("securityPlaintextTokensCount") || "unencrypted widget token(s)"}`
      : "";
  }

  setupPanel?.classList.toggle("hidden", hasHeader);
  lockedPanel?.classList.toggle("hidden", !hasHeader || unlocked);
  unlockedPanel?.classList.toggle("hidden", !hasHeader || !unlocked);
  destroyPanel?.classList.toggle("hidden", !hasHeader);
  encryptExistingBtn?.classList.toggle("hidden", !unlocked || plainCount === 0);
  if (changeKdfSelect && hasHeader) {
    changeKdfSelect.value = cfg.vaultHeader.kdf || "PBKDF2-SHA256";
  } else if (setupKdfSelect && !hasHeader) {
    setupKdfSelect.value = DEFAULT_VAULT_KDF;
  }
}

function clearAllWidgetSecrets(widgets = []) {
  if (!Array.isArray(widgets)) return [];
  return widgets.map(w => {
    if (!w || typeof w !== "object") return w;
    if (!("authHeaderValue" in w) && !("apiKey" in w)) return w;
    const next = { ...w };
    if ("authHeaderValue" in next) next.authHeaderValue = "";
    if ("apiKey" in next) next.apiKey = "";
    return next;
  });
}

export async function destroyVaultAndSecrets() {
  const confirmed = window.confirm(
    t("securityConfirmDestroyVault")
      || "Destroy the vault and erase all stored widget secrets? You will need to create a new vault and re-enter your API tokens."
  );
  if (!confirmed) return false;

  await lockVault();
  const cfg = await loadConfig();
  cfg.vaultHeader = null;
  const hadVaultSync = cfg.sync?.encryptionMode === "vault";
  if (hadVaultSync) {
    cfg.sync.encryptionMode = "none";
    cfg.sync.username = "";
    cfg.sync.password = "";
    delete cfg.sync.enc;
  }
  cfg.appearance = {
    ...(cfg.appearance || {}),
    customWidgets: clearAllWidgetSecrets(cfg.appearance?.customWidgets || [])
  };
  await saveConfig(cfg);
  if (hadVaultSync) {
    clearSyncCredentialsInUi();
  }

  if (settingsState.appearanceDraft?.customWidgets) {
    settingsState.appearanceDraft.customWidgets = clearAllWidgetSecrets(settingsState.appearanceDraft.customWidgets);
  }

  if (actionStatusEl) {
    actionStatusEl.textContent = "🗑️ " + (t("securityVaultDestroyed") || "Vault destroyed and all secrets cleared. You can now set a new password.");
  }
  await populateSecuritySettings(cfg);
  void updateFooter(cfg);
  void pollAllRestStatusWidgets({ force: true });
  return true;
}

async function encryptAndPersistPlaintextTokens() {
  const cfg = await loadConfig();
  const savedRes = await encryptWidgetsList(cfg?.appearance?.customWidgets || []);
  if (savedRes.changed) {
    cfg.appearance = { ...(cfg.appearance || {}), customWidgets: savedRes.widgets };
    await saveConfig(cfg);
  }
  if (settingsState.appearanceDraft?.customWidgets) {
    const draftRes = await encryptWidgetsList(settingsState.appearanceDraft.customWidgets);
    if (draftRes.changed) {
      settingsState.appearanceDraft.customWidgets = draftRes.widgets;
    }
  }
  return savedRes.changed;
}

async function promptForceChangeExpiredPassword(oldPassword, cfg) {
  const modal = document.getElementById("vault-force-change-modal");
  const newInput = document.getElementById("vault-force-new-password");
  const confirmInput = document.getElementById("vault-force-confirm-password");
  const errorEl = document.getElementById("vault-force-change-error");
  const submitBtn = document.getElementById("vault-force-change-submit");
  if (!modal || !newInput || !confirmInput || !submitBtn) return;

  return new Promise(resolve => {
    newInput.value = "";
    confirmInput.value = "";
    if (errorEl) errorEl.textContent = "";
    modal.classList.remove("hidden");
    newInput.focus();

    const finish = () => {
      modal.classList.add("hidden");
      newInput.value = "";
      confirmInput.value = "";
      submitBtn.removeEventListener("click", onSubmit);
      confirmInput.removeEventListener("keydown", onKeyDown);
      resolve();
    };

    const onSubmit = async () => {
      const nextPw = newInput.value || "";
      const confirmPw = confirmInput.value || "";
      const pwCheck = validateVaultPassword(nextPw);
      if (!pwCheck.valid) {
        if (errorEl) errorEl.textContent = "❌ " + formatPasswordPolicyError(pwCheck.errors);
        newInput.focus();
        return;
      }
      if (nextPw === oldPassword) {
        if (errorEl) errorEl.textContent = "❌ " + (t("securityPasswordSameError") || "New password must be different from your current password.");
        newInput.focus();
        return;
      }
      if (nextPw !== confirmPw) {
        if (errorEl) errorEl.textContent = "❌ " + (t("securityPasswordMismatch") || "Passwords do not match.");
        confirmInput.focus();
        return;
      }
      try {
        cfg.vaultHeader = await changeVaultPassword(oldPassword, nextPw, cfg.vaultHeader, {
          autoLockMinutes: cfg?.vaultAutoLockMinutes || 0
        });
        await saveConfig(cfg);
        finish();
      } catch (err) {
        if (errorEl) errorEl.textContent = `❌ ${err?.message || "Failed to update password"}`;
      }
    };

    const onKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void onSubmit();
      }
    };

    submitBtn.addEventListener("click", onSubmit);
    confirmInput.addEventListener("keydown", onKeyDown);
  });
}

export async function promptUnlockVault() {
  const cfg = await loadConfig();
  if (!cfg?.vaultHeader?.check) return false;
  const autoLockMinutes = normalizeVaultAutoLockMinutes(cfg?.vaultAutoLockMinutes);
  if (await tryAutoUnlockVault(cfg.vaultHeader, { autoLockMinutes })) return true;

  const modal = document.getElementById("vault-unlock-modal");
  const input = document.getElementById("vault-unlock-modal-input");
  const errorEl = document.getElementById("vault-unlock-modal-error");
  const submitBtn = document.getElementById("vault-unlock-modal-submit");
  const cancelBtn = document.getElementById("vault-unlock-modal-cancel");
  if (!modal || !input || !submitBtn || !cancelBtn) return false;

  return new Promise(resolve => {
    input.value = "";
    if (errorEl) errorEl.textContent = "";
    modal.classList.remove("hidden");
    input.focus();

    const cleanup = (result) => {
      modal.classList.add("hidden");
      input.value = "";
      submitBtn.removeEventListener("click", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keydown", onDocKeyDown);
      resolve(result);
    };

    const onSubmit = async () => {
      const pw = input.value || "";
      if (!pw) {
        if (errorEl) errorEl.textContent = "❌ " + (t("securityPasswordRequired") || "Enter a vault password.");
        input.focus();
        return;
      }
      try {
        await unlockVault(pw, cfg.vaultHeader, { autoLockMinutes });
        clearLastSyncErrorReason();
        if (isVaultPasswordExpired(cfg.vaultHeader)) {
          modal.classList.add("hidden");
          await promptForceChangeExpiredPassword(pw, cfg);
        }
        await populateSecuritySettings(cfg);
        void updateFooter(cfg);
        void pollAllRestStatusWidgets({ force: true });
        if (cfg?.sync?.enabled && cfg?.sync?.encryptionMode === "vault" && shouldSync(cfg)) {
          void syncNow().then((r) => {
            updateFooter();
            if (r?.ok && r?.changed) {
              window.dispatchEvent(new CustomEvent("speeddial:data-changed"));
            }
          });
        }
        cleanup(true);
      } catch {
        if (errorEl) errorEl.textContent = "❌ " + (t("securityWrongPassword") || "Incorrect vault password.");
        input.select();
        input.focus();
      }
    };

    const onCancel = () => cleanup(false);
    const onKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void onSubmit();
      }
    };
    const onDocKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      }
    };

    submitBtn.addEventListener("click", onSubmit);
    cancelBtn.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onDocKeyDown);
  });
}

export function initSecuritySettings() {
  window.promptUnlockVault = promptUnlockVault;

  destroyBtn?.addEventListener("click", () => {
    void destroyVaultAndSecrets();
  });

  setupBtn?.addEventListener("click", async () => {
    const pw = setupPasswordInput?.value || "";
    const confirm = setupConfirmInput?.value || "";
    const pwCheck = validateVaultPassword(pw);
    if (!pwCheck.valid) {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + formatPasswordPolicyError(pwCheck.errors);
      return;
    }
    if (pw !== confirm) {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + (t("securityPasswordMismatch") || "Passwords do not match.");
      return;
    }
    try {
      const kdf = setupKdfSelect?.value || DEFAULT_VAULT_KDF;
      const cfg = await loadConfig();
      const header = await setupVault(pw, {
        kdf,
        autoLockMinutes: normalizeVaultAutoLockMinutes(cfg?.vaultAutoLockMinutes)
      });
      cfg.vaultHeader = header;
      const res = await encryptWidgetsList(cfg.appearance?.customWidgets || []);
      cfg.appearance = { ...(cfg.appearance || {}), customWidgets: res.widgets };
      await saveConfig(cfg);

      if (settingsState.appearanceDraft?.customWidgets) {
        const draftRes = await encryptWidgetsList(settingsState.appearanceDraft.customWidgets);
        settingsState.appearanceDraft.customWidgets = draftRes.widgets;
      }

      if (setupPasswordInput) setupPasswordInput.value = "";
      if (setupConfirmInput) setupConfirmInput.value = "";
      if (actionStatusEl) actionStatusEl.textContent = "✅ " + (t("securityVaultEnabled") || "Vault enabled and existing tokens encrypted.");
      await populateSecuritySettings(cfg);
      void pollAllRestStatusWidgets({ force: true });
    } catch (err) {
      if (actionStatusEl) actionStatusEl.textContent = `❌ ${err?.message || "Setup failed"}`;
    }
  });

  unlockBtn?.addEventListener("click", async () => {
    const pw = unlockPasswordInput?.value || "";
    if (!pw) {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + (t("securityPasswordRequired") || "Enter a vault password.");
      return;
    }
    try {
      const cfg = await loadConfig();
      await unlockVault(pw, cfg.vaultHeader, {
        autoLockMinutes: normalizeVaultAutoLockMinutes(cfg?.vaultAutoLockMinutes)
      });
      clearLastSyncErrorReason();
      if (unlockPasswordInput) unlockPasswordInput.value = "";
      if (isVaultPasswordExpired(cfg.vaultHeader)) {
        await promptForceChangeExpiredPassword(pw, cfg);
        if (actionStatusEl) actionStatusEl.textContent = "✅ " + (t("securityPasswordChanged") || "Vault password updated.");
      } else if (actionStatusEl) {
        actionStatusEl.textContent = "✅ " + (t("securityStatusUnlocked") || "Vault unlocked");
      }
      await populateSecuritySettings(cfg);
      void updateFooter(cfg);
      if (cfg?.sync?.enabled && cfg?.sync?.encryptionMode === "vault" && shouldSync(cfg)) {
        void syncNow().then((r) => {
          updateFooter();
          if (r?.ok && r?.changed) {
            window.dispatchEvent(new CustomEvent("speeddial:data-changed"));
          }
        });
      }
      void pollAllRestStatusWidgets({ force: true });
    } catch {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + (t("securityWrongPassword") || "Incorrect vault password.");
    }
  });

  lockBtn?.addEventListener("click", async () => {
    await lockVault();
    if (actionStatusEl) actionStatusEl.textContent = "🔒 " + (t("securityStatusLocked") || "Vault locked");
    await populateSecuritySettings();
    void updateFooter();
    void pollAllRestStatusWidgets({ force: true });
  });

  autoLockInput?.addEventListener("change", async () => {
    const mins = normalizeVaultAutoLockMinutes(autoLockInput.value);
    autoLockInput.value = String(mins);
    const cfg = await loadConfig();
    cfg.vaultAutoLockMinutes = mins;
    await saveConfig(cfg);
    await touchVaultActivity(mins, { force: true });
    if (actionStatusEl) {
      actionStatusEl.textContent = "✅ " + (t("securityAutoLockSaved") || "Auto-lock setting saved.");
    }
  });

  muteSyncLockedInput?.addEventListener("change", async () => {
    const cfg = await loadConfig();
    cfg.vaultMuteSyncLockedWarning = !!muteSyncLockedInput.checked;
    await saveConfig(cfg);
  });

  encryptExistingBtn?.addEventListener("click", async () => {
    await encryptAndPersistPlaintextTokens();
    if (actionStatusEl) actionStatusEl.textContent = "✅ " + (t("securityTokensEncrypted") || "All widget tokens encrypted.");
    await populateSecuritySettings();
    void pollAllRestStatusWidgets({ force: true });
  });

  changePwBtn?.addEventListener("click", async () => {
    const oldPw = oldPasswordInput?.value || "";
    const newPw = newPasswordInput?.value || "";
    const confirmPw = newConfirmInput?.value || "";
    if (!oldPw || !newPw) {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + (t("securityPasswordRequired") || "Enter a vault password.");
      return;
    }
    const pwCheck = validateVaultPassword(newPw);
    if (!pwCheck.valid) {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + formatPasswordPolicyError(pwCheck.errors);
      return;
    }
    if (newPw !== confirmPw) {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + (t("securityPasswordMismatch") || "Passwords do not match.");
      return;
    }
    try {
      const cfg = await loadConfig();
      const currentKdf = cfg?.vaultHeader?.kdf || "PBKDF2-SHA256";
      const kdf = changeKdfSelect?.value || currentKdf;
      const isKdfMigration = kdf !== currentKdf;
      if (oldPw === newPw && !isKdfMigration) {
        if (actionStatusEl) actionStatusEl.textContent = "❌ " + (t("securityPasswordSameError") || "New password must be different from your current password.");
        return;
      }
      const nextHeader = await changeVaultPassword(oldPw, newPw, cfg.vaultHeader, {
        kdf,
        autoLockMinutes: cfg?.vaultAutoLockMinutes || 0
      });
      cfg.vaultHeader = nextHeader;
      await saveConfig(cfg);
      if (oldPasswordInput) oldPasswordInput.value = "";
      if (newPasswordInput) newPasswordInput.value = "";
      if (newConfirmInput) newConfirmInput.value = "";
      if (actionStatusEl) actionStatusEl.textContent = "✅ " + (t("securityPasswordChanged") || "Vault password updated.");
      await populateSecuritySettings(cfg);
    } catch {
      if (actionStatusEl) actionStatusEl.textContent = "❌ " + (t("securityWrongPassword") || "Incorrect vault password.");
    }
  });
}
