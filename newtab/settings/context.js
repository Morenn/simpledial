// Shared state and form helpers for the settings modal modules.

const settingsModal = document.getElementById("settings-modal");
const settingsUnsavedIndicator = document.getElementById("settings-unsaved-indicator");

export const settingsState = {
  isInitializingSettingsForm: false,
  settingsDirty: false,
  appearanceDraft: null,
  appearancePreviewUrlCss: "",
  appearancePreviewUrlTarget: "",
  savedLanguageSnapshot: null,
  pendingLanguageReset: false,
  credentialsTouched: false
};

export function setSettingsDirty(isDirty) {
  settingsState.settingsDirty = !!isDirty;
  if (settingsUnsavedIndicator) {
    settingsUnsavedIndicator.classList.toggle("hidden", !settingsState.settingsDirty);
  }
}

export function markSettingsDirty() {
  if (settingsState.isInitializingSettingsForm) return;
  if (settingsModal?.classList.contains("hidden")) return;
  setSettingsDirty(true);
}

export function updateChoiceOptionStates() {
  document.querySelectorAll(".choice-option").forEach(option => {
    const input = option.querySelector('input[type="radio"]');
    option.classList.toggle("active", !!(input && input.checked));
  });
}

export function syncRadioGroupFromModel(hiddenInput, radioInputs) {
  if (!hiddenInput || !radioInputs || !radioInputs.length) return;
  radioInputs.forEach(radio => {
    radio.checked = (radio.value === hiddenInput.value);
  });
  updateChoiceOptionStates();
}

export function bindRadioGroupToModel(hiddenInput, radioInputs) {
  if (!hiddenInput || !radioInputs || !radioInputs.length) return;
  radioInputs.forEach(radio => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      hiddenInput.value = radio.value;
      hiddenInput.dispatchEvent(new Event("change"));
      updateChoiceOptionStates();
      markSettingsDirty();
    });
  });
}
