import { state, saveState, generateId, isStackItem, getAllGroupBookmarks, SYSTEM_TAG_HTTP_ID, SYSTEM_TAG_DEAD_LINK_ID, setBookmarkSystemTag, clearSystemTagFromAllBookmarks, saveSystemTags } from "./state.js";
import { loadConfig, saveConfig, defaultConfig } from "./config.js";
import { testSyncConnection, requestHostPermission, syncNow, cleanupDeletedItems, checkDeadLinks, syncWrite, syncRead, syncReadTest, syncWriteTest, resetLogonCount } from "./sync.js";
import { t, getCurrentLanguage, setLanguage, resetLanguageToBrowser, getSavedLanguageOverride } from "./i18n.js";
import { deriveKeyFromPassword, generateLocalKeyRaw, importRawKey, encryptWithKey, decryptWithKey } from './crypto.js';
import { findOrCreateSimpleDialFolder, getBookmarkChildren } from './bookmarks-api.js';
import { render, calculateGridLayout } from "./render.js";
import { applyBackground, applyBgDim, applyBarOpacity, applyTileOpacity, applyTileSize, applyGroupTileSize, applySideSpaces, applyThemeStyle, fetchAndCacheThemeUrl, fetchBackgroundImageFromUrl, isAllowedThemeUrl, getCustomThemeUrlCache, normalizeWidgetOrder, groupCustomSearchWidgets, isValidCustomSearchUrlTemplate, isValidCustomSearchJsonTemplate, isValidTimeZone, normalizeCustomTimeZones, serializeCustomWidgetsExport, parseImportedCustomWidgets, resolveCustomWidgetIcon, fetchCustomWidgetsFromUrl, applyCustomWidgetUpdate, revertCustomWidgetVersion, buildCustomSearchPreview, normalizeCustomWidgetVariables } from "./theme.js";
import { createBackup, listBackups, restoreBackup, deleteBackup, cleanupOldBackups, getBackup } from "./backup.js";
import { updateUIText, updateClock } from "./main.js";
import { syncBrowserBookmarks } from "./browser-bookmarks-sync.js";
import { applyMassTileColorFromIcon } from "./bookmarks.js";
import { renderGroups } from "./groups.js";
import { normalizeCustomIconValue } from "./color-utils.js";
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
const settingsUnsavedIndicator = document.getElementById("settings-unsaved-indicator");

// Backups Elements
const backupRetentionDays = document.getElementById("backup-retention-days");
const backupFrequencyHours = document.getElementById("backup-frequency-hours");
const backupCreateNowBtn = document.getElementById("backup-create-now");
const backupStatus = document.getElementById("backup-status");
const backupsTableBody = document.getElementById("backups-table-body");
const backupSubtabBtns = document.querySelectorAll(".backups-subtab-btn");
let currentBackupTabType = "bookmarks";

// Export/Import Elements
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
const exportBookmarksBtn = document.getElementById("export-bookmarks-btn");
const importBookmarksBtn = document.getElementById("import-bookmarks-btn");
const exportNetscapeBtn = document.getElementById("export-netscape-btn");
const importNetscapeBtn = document.getElementById("import-netscape-btn");
const importNetscapeFile = document.getElementById("import-netscape-file");
const browserBookmarksAutoSync = document.getElementById("browser-bookmarks-auto-sync");

// Appearance Elements
const showDeletedToggle = document.getElementById("show-deleted-toggle");
const languageSelect = document.getElementById("language-select");
const themeSelect = document.getElementById("theme-select");
const themeCustomFileRow = document.getElementById("theme-custom-file-row");
const themeCssFileInput = document.getElementById("theme-css-file-input");
const themeCssFileName = document.getElementById("theme-css-file-name");
const themeCustomUrlRow = document.getElementById("theme-custom-url-row");
const themeCssUrlInput = document.getElementById("theme-css-url-input");
const themeCssUrlApply = document.getElementById("theme-css-url-apply");
const themeStatus = document.getElementById("theme-status");
const themeBackgroundsLink = document.getElementById("theme-backgrounds-link");
const themeBackgroundsPixabayLink = document.getElementById("theme-backgrounds-pixabay-link");
const themeBackgroundsPexelsLink = document.getElementById("theme-backgrounds-pexels-link");
const bgImageInput = document.getElementById("bg-image-input");
const bgImageUrlInput = document.getElementById("bg-image-url-input");
const bgImageUrlApply = document.getElementById("bg-image-url-apply");
const bgImageUrlStatus = document.getElementById("bg-image-url-status");
const bgSizeSelect = document.getElementById("bg-size-select");
const bgDimSlider = document.getElementById("bg-dim-slider");
const bgDimValue = document.getElementById("bg-dim-value");
const bgPreview = document.getElementById("bg-preview");
const bgRemoveBtn = document.getElementById("bg-remove-btn");
const resetAppearanceBtn = document.getElementById("reset-appearance-btn");
const tileOpacitySlider = document.getElementById("tile-opacity-slider");
const tileOpacityValue = document.getElementById("tile-opacity-value");
const barOpacitySlider = document.getElementById("bar-opacity-slider");
const barOpacityValue = document.getElementById("bar-opacity-value");
const tileSizeSlider = document.getElementById("tile-size-slider");
const tileSizeValue = document.getElementById("tile-size-value");
const groupTileSizeSlider = document.getElementById("group-tile-size-slider");
const groupTileSizeValue = document.getElementById("group-tile-size-value");
const groupCountToggle = document.getElementById("group-count-toggle");
const showSideSpacesToggle = document.getElementById("show-side-spaces-toggle");
const highlightSideSpacesToggle = document.getElementById("highlight-side-spaces-toggle");
const tallBookmarkTilesToggle = document.getElementById("tall-bookmark-tiles-toggle");
const clickableTagsToggle = document.getElementById("clickable-tags-toggle");
const searchStyleSelect = document.getElementById("search-style-select");
const headerSingleRowToggle = document.getElementById("header-single-row-toggle");
const widgetOrderList = document.getElementById("widget-order-list");
const customWidgetsList = document.getElementById("custom-widgets-list");
const customWidgetIconInput = document.getElementById("custom-widget-icon");
const customWidgetCustomIconInput = document.getElementById("custom-widget-custom-icon");
const customWidgetIconUploadBtn = document.getElementById("custom-widget-icon-upload-btn");
const customWidgetIconFile = document.getElementById("custom-widget-icon-file");
const customWidgetModeSelect = document.getElementById("custom-widget-mode");
const customWidgetAddTitle = document.querySelector(".custom-widget-add-title");
const customWidgetNameInput = document.getElementById("custom-widget-name");
const customWidgetGroupInput = document.getElementById("custom-widget-group");
const customWidgetUrlInput = document.getElementById("custom-widget-url");
const customWidgetNewTabInput = document.getElementById("custom-widget-newtab");
const customWidgetDefaultInput = document.getElementById("custom-widget-default");
const customWidgetJsonRow = document.getElementById("custom-widget-json-row");
const customWidgetJsonTemplateInput = document.getElementById("custom-widget-json-template");
const customWidgetVarsList = document.getElementById("custom-widget-vars-list");
const customWidgetAddVarBtn = document.getElementById("custom-widget-add-var-btn");
const customWidgetVarsSection = document.querySelector(".custom-widget-vars-section");
const customWidgetTimezoneSection = document.getElementById("custom-widget-timezone-section");
const customWidgetTzSeconds = document.getElementById("custom-widget-tz-seconds");
const customWidgetTz24h = document.getElementById("custom-widget-tz-24h");
const customWidgetTzAddBtn = document.getElementById("custom-widget-tz-add-btn");
const customWidgetTzList = document.getElementById("custom-widget-tz-list");
const customWidgetTzDatalist = document.getElementById("custom-widget-tz-datalist");
const customWidgetNewTabLabel = customWidgetNewTabInput?.closest(".custom-widget-newtab-label");
const customWidgetDefaultLabel = customWidgetDefaultInput?.closest(".custom-widget-default-label");
const customWidgetAddBtn = document.getElementById("custom-widget-add-btn");
const customWidgetCancelEditBtn = document.getElementById("custom-widget-cancel-edit-btn");
const customWidgetPreviewToggleBtn = document.getElementById("custom-widget-preview-toggle-btn");
const customWidgetPreviewBox = document.getElementById("custom-widget-preview-box");
const customWidgetPreviewInputs = document.getElementById("custom-widget-preview-inputs");
const customWidgetPreviewUrl = document.getElementById("custom-widget-preview-url");
const customWidgetPreviewJsonRow = document.getElementById("custom-widget-preview-json-row");
const customWidgetPreviewJson = document.getElementById("custom-widget-preview-json");
const customWidgetExportBtn = document.getElementById("custom-widget-export-btn");
const customWidgetImportBtn = document.getElementById("custom-widget-import-btn");
const customWidgetImportFile = document.getElementById("custom-widget-import-file");
const customWidgetSourceUrlInput = document.getElementById("custom-widget-source-url");
const customWidgetLoadUrlBtn = document.getElementById("custom-widget-load-url-btn");
const customWidgetUpdateAllBtn = document.getElementById("custom-widget-update-all-btn");
const customWidgetExportAllBtn = document.getElementById("custom-widget-export-all-btn");
const customWidgetsLibraryStatus = document.getElementById("custom-widgets-library-status");
const exportWidgetsBtn = document.getElementById("export-widgets-btn");
const importWidgetsBtn = document.getElementById("import-widgets-btn");
const widgetsExportStatus = document.getElementById("widgets-export-status");
const customWidgetStatus = document.getElementById("custom-widget-status");
const massEnableColorFromIconBtn = document.getElementById("mass-enable-color-from-icon");
const massDisableColorFromIconBtn = document.getElementById("mass-disable-color-from-icon");
const massColorFromIconStatus = document.getElementById("mass-color-from-icon-status");

// HouseKeeper Elements
const hkRetentionDays = document.getElementById("hk-retention-days");
const hkAutoCleanup = document.getElementById("hk-auto-cleanup");
const hkManualCleanup = document.getElementById("hk-manual-cleanup");
const hkCleanupStatus = document.getElementById("hk-cleanup-status");
const hkLastCleanup = document.getElementById("hk-last-cleanup");
const hkEnableLinkCheck = document.getElementById("hk-enable-link-check");
const hkCheckLinks = document.getElementById("hk-check-links");
const hkCheckHttpBookmarks = document.getElementById("hk-check-http-bookmarks");
const hkLinkCheckStatus = document.getElementById("hk-link-check-status");
const hkDeadLinksCount = document.getElementById("hk-dead-links-count");
const hkClearErrors = document.getElementById("hk-clear-errors");
const hkIconRefreshAll = document.getElementById("hk-icon-refresh-all");
const hkIconRefreshMissing = document.getElementById("hk-icon-refresh-missing");
const hkIconRefreshNone = document.getElementById("hk-icon-refresh-none");
const hkIconRefreshHours = document.getElementById("hk-icon-refresh-hours");

// Advanced Elements
const advFaviconDebugLogging = document.getElementById("enable-favicon-debug-logging");
const advDeadLinkDebugLogging = document.getElementById("enable-dead-link-debug-logging");
const advSyncDebugLogging = document.getElementById("enable-sync-debug-logging");
const advI18nHotReload = document.getElementById("enable-i18n-hot-reload");
const advExperimentalFaviconFetchLink = document.getElementById("enable-experimental-favicon-fetch-link");
const advExperimentalFaviconFetchManifest = document.getElementById("enable-experimental-favicon-fetch-manifest");

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

// Tab System
const tabButtons = document.querySelectorAll(".settings-tab-btn");
const tabContents = document.querySelectorAll(".settings-tab-content");

let isInitializingSettingsForm = false;
let settingsDirty = false;
let appearanceDraft = null;
let appearancePreviewUrlCss = "";
let appearancePreviewUrlTarget = "";
let savedLanguageSnapshot = null;
let pendingLanguageReset = false;

if (languageSelect) {
  languageSelect.addEventListener("change", () => {
    pendingLanguageReset = false;
    markSettingsDirty();
  });
}

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
  const trackedElements = document.querySelectorAll('#sync-tab input, #sync-tab select, #appearance-tab input, #appearance-tab select, #housekeeper-tab input, #backups-tab input, #advanced-tab input, #export-tab input');
  trackedElements.forEach(el => {
    if (el.type === 'hidden') return;
    el.addEventListener('input', markSettingsDirty);
    el.addEventListener('change', markSettingsDirty);
  });
  if (groupCountToggle) {
    groupCountToggle.addEventListener('change', () => {
      markSettingsDirty();
      window.groupCountPreviewEnabled = groupCountToggle.checked;
      if (appearanceDraft) {
        appearanceDraft.showGroupBookmarkCount = groupCountToggle.checked;
      }
      void render();
    });
  }
  const WIDGET_REGISTRY = {
    groups: { key: "widgetGroups", fallback: "Group selector", field: "groupsSpace", defaultSpace: "header", allowDisabled: false },
    search: { key: "widgetSearch", fallback: "Search bar", field: "searchSpace", defaultSpace: "header", allowDisabled: false },
    manage: { key: "widgetManage", fallback: "Manage buttons", field: "manageSpace", defaultSpace: "header", allowDisabled: false },
    bookmarks: { key: "widgetBookmarks", fallback: "Bookmarks", field: null, defaultSpace: "center", allowDisabled: false, fixedSpace: true },
    syncStatus: { key: "widgetSyncStatus", fallback: "Sync status", field: "syncStatusSpace", defaultSpace: "footer", allowDisabled: true },
    dateTime: { key: "widgetDateTime", fallback: "Date & Time", field: "dateTimeSpace", defaultSpace: "footer", allowDisabled: true },
    bookmarksCount: { key: "widgetBookmarksCount", fallback: "Bookmarks count", field: "bookmarksCountSpace", defaultSpace: "footer", allowDisabled: true }
  };

  const renderWidgetOrderList = (appearance = null) => {
    if (!widgetOrderList) return;
    const resolvedAppearance = appearance || appearanceDraft || {};
    const customWidgets = Array.isArray(resolvedAppearance.customWidgets) ? resolvedAppearance.customWidgets : [];
    const customWidgetMap = new Map(customWidgets.filter(w => w?.id).map(w => [w.id, w]));
    const customGroups = groupCustomSearchWidgets(customWidgets);
    const customGroupByRepId = new Map(customGroups.map(g => [g.representative.id, g]));
    const secondaryCustomIds = new Set();
    for (const g of customGroups) {
      for (const m of g.members) {
        if (m.id !== g.representative.id) secondaryCustomIds.add(m.id);
      }
    }
    const order = normalizeWidgetOrder(resolvedAppearance.widgetOrder, customWidgets);
    const spaceKeyMap = {
      disabled: "spaceDisabled",
      header: "spaceHeader",
      left: "spaceLeft",
      center: "spaceCenter",
      right: "spaceRight",
      footer: "spaceFooter"
    };
    const spaceLabels = {
      disabled: t("spaceDisabled") || "Disabled",
      header: t("spaceHeader") || "Header",
      left: t("spaceLeft") || "Left space",
      center: t("spaceCenter") || "Center space",
      right: t("spaceRight") || "Right space",
      footer: t("spaceFooter") || "Footer"
    };
    const dateTimeSpace = (resolvedAppearance.dateTimeSpace === "disabled" || resolvedAppearance.showDateTime === false)
      ? "disabled"
      : (resolvedAppearance.dateTimeSpace || "footer");

    const alignKeyMap = {
      auto: "alignAuto",
      top: "alignTop",
      bottom: "alignBottom",
      left: "alignLeft",
      right: "alignRight",
      center: "alignCenter"
    };
    const alignLabels = {
      auto: t("alignAuto") || "Auto",
      top: t("alignTop") || "Top",
      bottom: t("alignBottom") || "Bottom",
      left: t("alignLeft") || "Left",
      right: t("alignRight") || "Right",
      center: t("alignCenter") || "Center"
    };
    const widgetAlign = resolvedAppearance.widgetAlign || {};
    const widgetNewRow = resolvedAppearance.widgetNewRow || {};

    widgetOrderList.innerHTML = "";
    const spaceBuckets = {
      header: [],
      left: [],
      center: [],
      right: [],
      footer: [],
      disabled: []
    };
    const visibleOrder = order.filter(key =>
      (WIDGET_REGISTRY[key] || customWidgetMap.get(key)) && !secondaryCustomIds.has(key)
    );
    visibleOrder.forEach((key, visibleIdx) => {
      const builtInDef = WIDGET_REGISTRY[key];
      const customDef = customWidgetMap.get(key);
      if (!builtInDef && !customDef) return;
      const idx = order.indexOf(key);
      const isCustom = !!customDef;
      const customGroup = isCustom ? customGroupByRepId.get(key) : null;
      const customLabel = (customGroup && customGroup.members.length > 1)
        ? `${customGroup.groupName} (${customGroup.members.length})`
        : (customDef?.name || "Search");
      const def = builtInDef || {
        key: null,
        fallback: `${customDef.icon || "🔎"} ${customLabel}`,
        field: null,
        defaultSpace: "right",
        allowDisabled: true,
        fixedSpace: false
      };
      const currentSpace = isCustom
        ? (customDef.space || "right")
        : (key === "dateTime"
          ? dateTimeSpace
          : (def.field ? (resolvedAppearance[def.field] || def.defaultSpace) : def.defaultSpace));

      const row = document.createElement("div");
      row.className = "widget-order-item";

      const nameEl = document.createElement("span");
      nameEl.className = "widget-order-name";
      if (def.key) {
        nameEl.setAttribute("data-i18n", def.key);
        nameEl.textContent = t(def.key) || def.fallback;
      } else {
        nameEl.textContent = def.fallback;
        nameEl.title = customDef.urlTemplate || "";
      }

      let spaceControl;
      let alignControl = null;
      if (def.fixedSpace) {
        spaceControl = document.createElement("span");
        spaceControl.className = "widget-order-space";
        if (spaceKeyMap[currentSpace]) {
          spaceControl.setAttribute("data-i18n", spaceKeyMap[currentSpace]);
        }
        spaceControl.textContent = spaceLabels[currentSpace] || currentSpace;
      } else {
        spaceControl = document.createElement("select");
        spaceControl.className = "appearance-select widget-order-space-select";
        spaceControl.setAttribute("aria-label", nameEl.textContent);
        const spaceOptions = def.allowDisabled
          ? ["disabled", "header", "left", "center", "right", "footer"]
          : ["header", "left", "center", "right", "footer"];
        spaceOptions.forEach(optVal => {
          const opt = document.createElement("option");
          opt.value = optVal;
          opt.setAttribute("data-i18n", spaceKeyMap[optVal]);
          opt.textContent = spaceLabels[optVal] || optVal;
          spaceControl.appendChild(opt);
        });
        spaceControl.value = currentSpace;
        spaceControl.addEventListener("change", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          if (isCustom) {
            draft.customWidgets = (draft.customWidgets || []).map(w =>
              w.id === key ? { ...w, space: spaceControl.value } : w
            );
          } else {
            draft[def.field] = spaceControl.value;
            if (key === "dateTime") {
              draft.showDateTime = spaceControl.value !== "disabled";
              updateDateTimeVisibility(draft.showDateTime);
            }
          }
          renderWidgetOrderList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });

        alignControl = document.createElement("select");
        alignControl.className = "appearance-select widget-order-align-select";
        alignControl.setAttribute("aria-label", `${nameEl.textContent} align`);
        ["auto", "top", "bottom", "left", "right", "center"].forEach(alignVal => {
          const opt = document.createElement("option");
          opt.value = alignVal;
          opt.setAttribute("data-i18n", alignKeyMap[alignVal]);
          opt.textContent = alignLabels[alignVal] || alignVal;
          alignControl.appendChild(opt);
        });
        alignControl.value = alignKeyMap[widgetAlign[key]] ? widgetAlign[key] : "auto";
        alignControl.addEventListener("change", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          draft.widgetAlign = { ...(draft.widgetAlign || {}), [key]: alignControl.value };
          renderWidgetOrderList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });
      }

      const actions = document.createElement("div");
      actions.className = "widget-order-actions";

      if (!def.fixedSpace) {
        const newRowBtn = document.createElement("button");
        newRowBtn.type = "button";
        const isNewRow = !!widgetNewRow[key];
        newRowBtn.className = `widget-order-btn widget-newrow-btn${isNewRow ? " active" : ""}`;
        newRowBtn.textContent = "↵";
        newRowBtn.title = t("widgetNewRowTitle") || "Start on new row";
        newRowBtn.setAttribute("aria-pressed", String(isNewRow));
        newRowBtn.addEventListener("click", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          const nextVal = !(draft.widgetNewRow && draft.widgetNewRow[key]);
          draft.widgetNewRow = { ...(draft.widgetNewRow || {}), [key]: nextVal };
          renderWidgetOrderList(draft);
          renderWidgetOrderList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });
        actions.appendChild(newRowBtn);
      }

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "widget-order-btn";
      upBtn.textContent = "↑";
      upBtn.title = t("moveWidgetUp") || "Move up";
      upBtn.disabled = visibleIdx === 0;
      upBtn.addEventListener("click", async () => {
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const nextOrder = normalizeWidgetOrder(draft.widgetOrder, draft.customWidgets);
        if (visibleIdx <= 0) return;
        const prevKey = visibleOrder[visibleIdx - 1];
        const curPos = nextOrder.indexOf(key);
        const prevPos = nextOrder.indexOf(prevKey);
        if (curPos === -1 || prevPos === -1) return;
        [nextOrder[prevPos], nextOrder[curPos]] = [nextOrder[curPos], nextOrder[prevPos]];
        draft.widgetOrder = nextOrder;
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "widget-order-btn";
      downBtn.textContent = "↓";
      downBtn.title = t("moveWidgetDown") || "Move down";
      downBtn.disabled = visibleIdx === visibleOrder.length - 1;
      downBtn.addEventListener("click", async () => {
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const nextOrder = normalizeWidgetOrder(draft.widgetOrder, draft.customWidgets);
        if (visibleIdx >= visibleOrder.length - 1) return;
        const nextKey = visibleOrder[visibleIdx + 1];
        const curPos = nextOrder.indexOf(key);
        const nextPos = nextOrder.indexOf(nextKey);
        if (curPos === -1 || nextPos === -1) return;
        [nextOrder[curPos], nextOrder[nextPos]] = [nextOrder[nextPos], nextOrder[curPos]];
        draft.widgetOrder = nextOrder;
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      });

      actions.append(upBtn, downBtn);
      if (alignControl) {
        row.append(nameEl, spaceControl, alignControl, actions);
      } else {
        row.append(nameEl, spaceControl, actions);
      }
      const bucketKey = spaceBuckets[currentSpace] ? currentSpace : "right";
      spaceBuckets[bucketKey].push(row);
    });

    const SPACE_GROUP_ORDER = ["header", "left", "center", "right", "footer", "disabled"];
    for (const spaceKey of SPACE_GROUP_ORDER) {
      const rows = spaceBuckets[spaceKey];
      if (!rows || rows.length === 0) continue;

      const groupEl = document.createElement("div");
      groupEl.className = `widget-space-group${spaceKey === "disabled" ? " widget-space-group-disabled" : ""}`;

      const headerEl = document.createElement("div");
      headerEl.className = "widget-space-group-header";
      const labelSpan = document.createElement("span");
      if (spaceKeyMap[spaceKey]) {
        labelSpan.setAttribute("data-i18n", spaceKeyMap[spaceKey]);
      }
      labelSpan.textContent = spaceLabels[spaceKey] || spaceKey;
      const countSpan = document.createElement("span");
      countSpan.className = "widget-space-group-count";
      countSpan.textContent = String(rows.length);
      headerEl.append(labelSpan, countSpan);

      const itemsEl = document.createElement("div");
      itemsEl.className = "widget-space-group-items";
      rows.forEach(r => itemsEl.appendChild(r));

      groupEl.append(headerEl, itemsEl);
      widgetOrderList.appendChild(groupEl);
    }
    renderCustomWidgetsList(resolvedAppearance);
  };

  const renderCustomWidgetsList = (appearance = null) => {
    if (!customWidgetsList) return;
    const customList = Array.isArray(appearance?.customWidgets) ? appearance.customWidgets : [];
    customWidgetsList.innerHTML = "";
    if (customWidgetExportAllBtn) {
      customWidgetExportAllBtn.classList.toggle("hidden", customList.length === 0);
    }
    if (customWidgetUpdateAllBtn) {
      customWidgetUpdateAllBtn.classList.toggle("hidden", !customList.some(w => !!w?.sourceUrl));
    }

    if (customList.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "custom-widgets-empty";
      emptyEl.textContent = t("customWidgetsLibraryEmpty") || "No custom widgets yet. Create or import one above.";
      customWidgetsList.appendChild(emptyEl);
      return;
    }

    const buildCustomWidgetLibraryRow = (customDef) => {
      const row = document.createElement("div");
      row.className = "widget-order-item custom-widget-library-item";

      const { emoji, customIcon } = resolveCustomWidgetIcon(customDef);
      const iconWrap = document.createElement("span");
      iconWrap.className = "custom-search-icon";
      if (customIcon) {
        const img = document.createElement("img");
        img.className = "widget-order-icon-img";
        img.src = customIcon;
        img.alt = "";
        img.addEventListener("error", () => {
          iconWrap.textContent = emoji;
        }, { once: true });
        iconWrap.appendChild(img);
      } else {
        iconWrap.textContent = emoji;
      }

      const info = document.createElement("div");
      info.className = "custom-widget-library-info";
      const titleEl = document.createElement("div");
      titleEl.className = "custom-widget-library-name";
      titleEl.textContent = customDef.name || customDef.id;
      const isTimezone = customDef.type === "timezone";
      const tzList = isTimezone ? normalizeCustomTimeZones(customDef.timeZones) : [];
      const badge = document.createElement("span");
      badge.className = "custom-widget-mode-badge";
      badge.textContent = isTimezone
        ? `🕒 ${tzList.length}`
        : (customDef.mode === "json" ? "JSON" : "Simple");
      titleEl.appendChild(badge);
      const groupName = !isTimezone && typeof customDef.groupName === "string" ? customDef.groupName.trim() : "";
      if (groupName) {
        const groupBadge = document.createElement("span");
        groupBadge.className = "custom-widget-group-badge";
        groupBadge.textContent = groupName;
        titleEl.appendChild(groupBadge);
      }

      const urlEl = document.createElement("div");
      urlEl.className = "custom-widget-library-url";
      urlEl.textContent = isTimezone
        ? tzList.map(z => `${z.label} (${z.timeZone})`).join(", ")
        : (customDef.urlTemplate || "");
      info.append(titleEl, urlEl);
      if (customDef.sourceUrl) {
        const sourceEl = document.createElement("div");
        sourceEl.className = "custom-widget-library-source";
        sourceEl.textContent = customDef.sourceUrl;
        info.appendChild(sourceEl);
      }

      const actions = document.createElement("div");
      actions.className = "widget-order-actions";

      if (customDef.sourceUrl) {
        const updateBtn = document.createElement("button");
        updateBtn.type = "button";
        updateBtn.className = "widget-order-btn";
        updateBtn.textContent = "🔄";
        updateBtn.title = t("customSearchUpdateWidgetTitle") || "Update from URL";
        updateBtn.addEventListener("click", async () => {
          await updateSingleCustomWidgetFromUrl(customDef.id);
        });
        actions.appendChild(updateBtn);
      }

      if (customDef.previousVersion) {
        const revertBtn = document.createElement("button");
        revertBtn.type = "button";
        revertBtn.className = "widget-order-btn";
        revertBtn.textContent = "↩️";
        revertBtn.title = t("customSearchRevertWidgetTitle") || "Revert to previous version";
        revertBtn.addEventListener("click", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          draft.customWidgets = (draft.customWidgets || []).map(w =>
            w.id === customDef.id ? revertCustomWidgetVersion(w) : w
          );
          if (editingCustomWidgetId === customDef.id) {
            const reverted = draft.customWidgets.find(w => w.id === customDef.id);
            if (reverted) loadCustomWidgetIntoForm(reverted);
          }
          renderWidgetOrderList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
          if (customWidgetsLibraryStatus) {
            customWidgetsLibraryStatus.textContent = "↩️ " + (t("customSearchRevertedSuccess") || "Reverted to previous version (click Save to persist).");
          }
        });
        actions.appendChild(revertBtn);
      }

      const exportOneBtn = document.createElement("button");
      exportOneBtn.type = "button";
      exportOneBtn.className = "widget-order-btn";
      exportOneBtn.textContent = "📥";
      exportOneBtn.title = t("exportWidgetTitle") || "Export widget";
      exportOneBtn.addEventListener("click", () => {
        const slug = (customDef.name || "widget").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "widget";
        exportCustomWidgetsLibrary([customDef], `simple-dial-widget-${slug}`, customWidgetStatus);
      });

      const dupBtn = document.createElement("button");
      dupBtn.type = "button";
      dupBtn.className = "widget-order-btn";
      dupBtn.textContent = "📋";
      dupBtn.title = t("customSearchDuplicateWidgetTitle") || "Duplicate widget";
      dupBtn.addEventListener("click", async () => {
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const copyLabel = t("customSearchCopySuffix") || "Copy";
        const cloned = {
          ...customDef,
          id: `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name: `${customDef.name || "Widget"} (${copyLabel})`,
          variables: Array.isArray(customDef.variables) ? customDef.variables.map(v => ({ ...v })) : []
        };
        delete cloned.sourceUrl;
        delete cloned.sourceUpdatedAt;
        delete cloned.previousVersion;
        draft.customWidgets = [...(draft.customWidgets || []), cloned];
        draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), cloned.id], draft.customWidgets);
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      });

      if (groupName) {
        const defaultBtn = document.createElement("button");
        defaultBtn.type = "button";
        defaultBtn.className = "widget-order-btn custom-widget-default-btn";
        if (customDef.isDefault) {
          defaultBtn.classList.add("active");
        }
        defaultBtn.textContent = customDef.isDefault ? "★" : "☆";
        defaultBtn.title = t("customSearchSetDefaultTitle") || "Set as default in group";
        defaultBtn.addEventListener("click", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          draft.customWidgets = (draft.customWidgets || []).map(w => {
            if ((typeof w?.groupName === "string" ? w.groupName.trim() : "") === groupName) {
              return { ...w, isDefault: w.id === customDef.id };
            }
            return w;
          });
          renderWidgetOrderList(draft);
          renderWidgetOrderList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });
        actions.appendChild(defaultBtn);
      }

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "widget-order-btn";
      editBtn.textContent = "✏️";
      editBtn.title = t("edit") || "Edit";
      editBtn.addEventListener("click", () => {
        loadCustomWidgetIntoForm(customDef);
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "widget-order-btn widget-delete-btn";
      delBtn.textContent = "🗑️";
      delBtn.title = t("deleteWidgetTitle") || "Delete widget";
      delBtn.addEventListener("click", async () => {
        markSettingsDirty();
        if (editingCustomWidgetId === customDef.id) {
          resetCustomWidgetForm();
        }
        const draft = await ensureAppearanceDraft();
        draft.customWidgets = (draft.customWidgets || []).filter(w => w.id !== customDef.id);
        draft.widgetOrder = normalizeWidgetOrder(
          (draft.widgetOrder || []).filter(id => id !== customDef.id),
          draft.customWidgets
        );
        if (draft.widgetAlign) delete draft.widgetAlign[customDef.id];
        if (draft.widgetNewRow) delete draft.widgetNewRow[customDef.id];
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      });

      actions.append(exportOneBtn, dupBtn, editBtn, delBtn);
      row.append(iconWrap, info, actions);
      return row;
    };

    const entries = [];
    const groupMap = new Map();
    for (const customDef of customList) {
      if (!customDef?.id) continue;
      const isTimezone = customDef.type === "timezone";
      const groupName = !isTimezone && typeof customDef.groupName === "string" ? customDef.groupName.trim() : "";
      if (!groupName) {
        entries.push({ kind: "single", widget: customDef });
        continue;
      }
      const key = groupName.toLowerCase();
      let groupEntry = groupMap.get(key);
      if (!groupEntry) {
        groupEntry = { kind: "group", groupName, members: [] };
        groupMap.set(key, groupEntry);
        entries.push(groupEntry);
      }
      groupEntry.members.push(customDef);
    }

    for (const entry of entries) {
      if (entry.kind === "single") {
        customWidgetsList.appendChild(buildCustomWidgetLibraryRow(entry.widget));
        continue;
      }

      const groupCard = document.createElement("div");
      groupCard.className = "custom-widget-group-card";

      const groupHeader = document.createElement("div");
      groupHeader.className = "custom-widget-group-header";

      const groupTitle = document.createElement("div");
      groupTitle.className = "custom-widget-group-title";
      const groupNameSpan = document.createElement("span");
      groupNameSpan.textContent = `📁 ${entry.groupName}`;
      const countBadge = document.createElement("span");
      countBadge.className = "custom-widget-group-count";
      countBadge.textContent = String(entry.members.length);
      groupTitle.append(groupNameSpan, countBadge);

      const exportGroupBtn = document.createElement("button");
      exportGroupBtn.type = "button";
      exportGroupBtn.className = "icon-btn custom-widget-group-export-btn";
      exportGroupBtn.textContent = "📥 " + (t("customWidgetsExportGroupBtn") || "Export group");
      exportGroupBtn.addEventListener("click", () => {
        const slug = entry.groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
        exportCustomWidgetsLibrary(entry.members, `simple-dial-group-${slug}`, customWidgetsLibraryStatus);
      });

      groupHeader.append(groupTitle, exportGroupBtn);

      const membersWrap = document.createElement("div");
      membersWrap.className = "custom-widget-group-members";
      for (const member of entry.members) {
        membersWrap.appendChild(buildCustomWidgetLibraryRow(member));
      }

      groupCard.append(groupHeader, membersWrap);
      customWidgetsList.appendChild(groupCard);
    }
  };
  window.renderCustomWidgetsList = renderCustomWidgetsList;
  window.renderWidgetOrderList = renderWidgetOrderList;

  let editingCustomWidgetId = null;
  let customWidgetVarsDraft = [{ key: "query", label: "Search", type: "text", optionsText: "" }];
  let customWidgetTzDraft = [
    { label: "UTC", timeZone: "UTC" },
    { label: "New York", timeZone: "America/New_York" }
  ];

  if (customWidgetTzDatalist && customWidgetTzDatalist.children.length === 0) {
    let zones = [];
    try {
      if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
        zones = Intl.supportedValuesOf("timeZone");
      }
    } catch {
      zones = [];
    }
    if (!Array.isArray(zones) || zones.length === 0) {
      zones = ["UTC", "Europe/London", "Europe/Prague", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];
    }
    const frag = document.createDocumentFragment();
    for (const tz of zones) {
      const opt = document.createElement("option");
      opt.value = tz;
      frag.appendChild(opt);
    }
    customWidgetTzDatalist.appendChild(frag);
  }

  const renderCustomWidgetTzEditor = () => {
    if (!customWidgetTzList) return;
    customWidgetTzList.innerHTML = "";
    customWidgetTzDraft.forEach((tzItem, idx) => {
      const row = document.createElement("div");
      row.className = "custom-widget-tz-row";

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "sync-compact-input custom-widget-tz-label-input";
      labelInput.value = tzItem.label || "";
      labelInput.placeholder = t("customTzLabelPlaceholder") || "Label (e.g. New York)";
      labelInput.addEventListener("input", () => {
        tzItem.label = labelInput.value;
      });

      const zoneInput = document.createElement("input");
      zoneInput.type = "text";
      zoneInput.className = "sync-compact-input custom-widget-tz-zone-input";
      zoneInput.setAttribute("list", "custom-widget-tz-datalist");
      zoneInput.value = tzItem.timeZone || "";
      zoneInput.placeholder = t("customTzZonePlaceholder") || "Time zone (e.g. America/New_York)";
      zoneInput.addEventListener("input", () => {
        tzItem.timeZone = zoneInput.value;
        if (!labelInput.value.trim() && isValidTimeZone(zoneInput.value.trim())) {
          const autoLabel = zoneInput.value.trim().split("/").pop()?.replace(/_/g, " ") || "";
          if (autoLabel) {
            labelInput.placeholder = autoLabel;
          }
        }
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "widget-order-btn widget-delete-btn";
      removeBtn.textContent = "🗑️";
      removeBtn.disabled = customWidgetTzDraft.length <= 1;
      removeBtn.addEventListener("click", () => {
        if (customWidgetTzDraft.length <= 1) return;
        customWidgetTzDraft.splice(idx, 1);
        renderCustomWidgetTzEditor();
      });

      row.append(labelInput, zoneInput, removeBtn);
      customWidgetTzList.appendChild(row);
    });
  };

  if (customWidgetTzAddBtn) {
    customWidgetTzAddBtn.addEventListener("click", () => {
      customWidgetTzDraft.push({ label: "", timeZone: "" });
      renderCustomWidgetTzEditor();
    });
  }

  const syncCustomWidgetModeUI = () => {
    const mode = customWidgetModeSelect?.value || "simple";
    const isJson = mode === "json";
    const isTimezone = mode === "timezone";

    if (customWidgetAddTitle) {
      const titleKey = isTimezone ? "customTzAddTitle" : "customSearchAddTitle";
      const titleFallback = isTimezone ? "Add Time Zone Widget" : "Add Custom Search Widget";
      customWidgetAddTitle.setAttribute("data-i18n", titleKey);
      customWidgetAddTitle.textContent = t(titleKey) || titleFallback;
    }

    if (customWidgetJsonRow) {
      customWidgetJsonRow.classList.toggle("hidden", !isJson);
    }
    if (customWidgetTimezoneSection) {
      customWidgetTimezoneSection.classList.toggle("hidden", !isTimezone);
    }
    if (customWidgetVarsSection) {
      customWidgetVarsSection.classList.toggle("hidden", isTimezone);
    }
    if (customWidgetUrlInput) {
      customWidgetUrlInput.classList.toggle("hidden", isTimezone);
      customWidgetUrlInput.placeholder = isJson
        ? "https://example.com/search/"
        : (t("customSearchUrlPlaceholder") || "https://www.google.com/search?q={query}");
    }
    if (customWidgetGroupInput) {
      customWidgetGroupInput.classList.toggle("hidden", isTimezone);
    }
    if (customWidgetNewTabLabel) {
      customWidgetNewTabLabel.classList.toggle("hidden", isTimezone);
    }
    if (customWidgetDefaultLabel) {
      customWidgetDefaultLabel.classList.toggle("hidden", isTimezone);
    }
    if (customWidgetPreviewToggleBtn) {
      customWidgetPreviewToggleBtn.classList.toggle("hidden", isTimezone);
    }
    if (isTimezone && customWidgetPreviewBox) {
      customWidgetPreviewBox.classList.add("hidden");
    }
    if (customWidgetNameInput) {
      customWidgetNameInput.placeholder = isTimezone
        ? (t("customTzDefaultName") || "Time Zones")
        : (t("customSearchNamePlaceholder") || "Name (e.g. Google)");
    }
    if (customWidgetIconInput && !editingCustomWidgetId) {
      if (isTimezone && customWidgetIconInput.value === "🔎") {
        customWidgetIconInput.value = "🕒";
      } else if (!isTimezone && customWidgetIconInput.value === "🕒") {
        customWidgetIconInput.value = "🔎";
      }
    }
  };

  const renderCustomWidgetVarsEditor = () => {
    if (!customWidgetVarsList) return;
    customWidgetVarsList.innerHTML = "";
    customWidgetVarsDraft.forEach((varItem, idx) => {
      const row = document.createElement("div");
      row.className = "custom-widget-var-row";

      const keyInput = document.createElement("input");
      keyInput.type = "text";
      keyInput.className = "sync-compact-input custom-widget-var-key";
      keyInput.value = varItem.key || "";
      keyInput.placeholder = "key (e.g. query)";
      keyInput.addEventListener("input", () => {
        varItem.key = keyInput.value;
      });

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.className = "sync-compact-input custom-widget-var-label";
      labelInput.value = varItem.label || "";
      labelInput.placeholder = t("customSearchVarLabelPlaceholder") || "Label";
      labelInput.addEventListener("input", () => {
        varItem.label = labelInput.value;
      });

      const typeSelect = document.createElement("select");
      typeSelect.className = "appearance-select custom-widget-var-type";
      [
        { value: "text", key: "customSearchVarTypeText", fallback: "Text" },
        { value: "list", key: "customSearchVarTypeList", fallback: "Comma list" },
        { value: "select", key: "customSearchVarTypeSelect", fallback: "Dropdown" },
        { value: "multi", key: "customSearchVarTypeMulti", fallback: "Multi-select" }
      ].forEach(optDef => {
        const opt = document.createElement("option");
        opt.value = optDef.value;
        opt.setAttribute("data-i18n", optDef.key);
        const translated = t(optDef.key);
        opt.textContent = (translated && translated !== optDef.key) ? translated : optDef.fallback;
        typeSelect.appendChild(opt);
      });
      typeSelect.value = varItem.type || "text";

      const optionsInput = document.createElement("textarea");
      optionsInput.className = "sync-compact-input custom-widget-var-options";
      optionsInput.rows = 2;
      optionsInput.value = varItem.optionsText || "";
      optionsInput.placeholder = t("customSearchVarOptionsPlaceholder") || "Label=Value (one per line)";
      optionsInput.classList.toggle("hidden", typeSelect.value !== "select" && typeSelect.value !== "multi");
      optionsInput.addEventListener("input", () => {
        varItem.optionsText = optionsInput.value;
      });

      typeSelect.addEventListener("change", () => {
        varItem.type = typeSelect.value;
        optionsInput.classList.toggle("hidden", typeSelect.value !== "select" && typeSelect.value !== "multi");
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "widget-order-btn widget-delete-btn";
      removeBtn.textContent = "🗑️";
      removeBtn.disabled = customWidgetVarsDraft.length <= 1;
      removeBtn.addEventListener("click", () => {
        if (customWidgetVarsDraft.length <= 1) return;
        customWidgetVarsDraft.splice(idx, 1);
        renderCustomWidgetVarsEditor();
      });

      row.append(keyInput, labelInput, typeSelect, removeBtn, optionsInput);
      customWidgetVarsList.appendChild(row);
    });
    renderCustomWidgetPreviewInputs?.();
  };

  let customWidgetPreviewValues = {};

  function updateCustomWidgetPreviewOutput() {
    if (!customWidgetPreviewBox || customWidgetPreviewBox.classList.contains("hidden")) return;
    const mode = customWidgetModeSelect?.value === "json" ? "json" : "simple";
    const urlTemplate = (customWidgetUrlInput?.value || "").trim();
    const jsonTemplate = (customWidgetJsonTemplateInput?.value || "").trim();
    const variables = normalizeCustomWidgetVariables({
      name: (customWidgetNameInput?.value || "").trim() || "Search",
      variables: customWidgetVarsDraft
    });

    const previewWidget = { mode, urlTemplate, jsonTemplate, variables };
    const result = buildCustomSearchPreview(previewWidget, customWidgetPreviewValues);

    if (customWidgetPreviewUrl) {
      if (!result.valid) {
        customWidgetPreviewUrl.textContent = result.error === "invalid_json"
          ? ("⚠️ " + (t("customSearchInvalidJson") || "Enter a valid JSON template."))
          : ("⚠️ " + (t("customSearchInvalidUrl") || "Enter a valid http(s) URL template."));
      } else {
        customWidgetPreviewUrl.textContent = result.url || "";
      }
    }

    if (customWidgetPreviewJsonRow && customWidgetPreviewJson) {
      const showJson = mode === "json" && result.valid;
      customWidgetPreviewJsonRow.classList.toggle("hidden", !showJson);
      customWidgetPreviewJson.textContent = showJson ? result.jsonString : "";
    }
  }

  function renderCustomWidgetPreviewInputs() {
    if (!customWidgetPreviewInputs || !customWidgetPreviewBox || customWidgetPreviewBox.classList.contains("hidden")) {
      return;
    }
    const vars = normalizeCustomWidgetVariables({
      name: (customWidgetNameInput?.value || "").trim() || "Search",
      variables: customWidgetVarsDraft
    });
    customWidgetPreviewInputs.innerHTML = "";

    vars.forEach(v => {
      const field = document.createElement("div");
      field.className = "custom-widget-preview-field";
      const lbl = document.createElement("label");
      lbl.textContent = `${v.label || v.key} (${v.key})`;
      field.appendChild(lbl);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "sync-compact-input";
      input.placeholder = (v.type === "list" || v.type === "multi") ? "A, B" : (v.label || v.key);
      const currentVal = customWidgetPreviewValues[v.key];
      input.value = Array.isArray(currentVal) ? currentVal.join(", ") : (typeof currentVal === "string" ? currentVal : "");
      input.addEventListener("input", () => {
        const raw = input.value;
        if (v.type === "list" || v.type === "multi") {
          customWidgetPreviewValues[v.key] = raw.split(",").map(s => s.trim()).filter(Boolean);
        } else {
          customWidgetPreviewValues[v.key] = raw;
        }
        updateCustomWidgetPreviewOutput();
      });
      field.appendChild(input);
      customWidgetPreviewInputs.appendChild(field);
    });

    updateCustomWidgetPreviewOutput();
  }

  const resetCustomWidgetForm = () => {
    editingCustomWidgetId = null;
    if (customWidgetIconInput) customWidgetIconInput.value = "🔎";
    if (customWidgetCustomIconInput) customWidgetCustomIconInput.value = "";
    if (customWidgetModeSelect) customWidgetModeSelect.value = "simple";
    if (customWidgetNameInput) customWidgetNameInput.value = "";
    if (customWidgetGroupInput) customWidgetGroupInput.value = "";
    if (customWidgetUrlInput) customWidgetUrlInput.value = "";
    if (customWidgetJsonTemplateInput) customWidgetJsonTemplateInput.value = "";
    if (customWidgetNewTabInput) customWidgetNewTabInput.checked = false;
    if (customWidgetDefaultInput) customWidgetDefaultInput.checked = false;
    if (customWidgetAddBtn) customWidgetAddBtn.textContent = t("customSearchAddBtn") || "+ Add";
    if (customWidgetCancelEditBtn) customWidgetCancelEditBtn.classList.add("hidden");
    if (customWidgetStatus) customWidgetStatus.textContent = "";
    customWidgetVarsDraft = [{ key: "query", label: "Search", type: "text", optionsText: "" }];
    customWidgetTzDraft = [
      { label: "UTC", timeZone: "UTC" },
      { label: "New York", timeZone: "America/New_York" }
    ];
    if (customWidgetTzSeconds) customWidgetTzSeconds.checked = false;
    if (customWidgetTz24h) customWidgetTz24h.checked = true;
    syncCustomWidgetModeUI();
    renderCustomWidgetVarsEditor();
    renderCustomWidgetTzEditor();
  };

  const loadCustomWidgetIntoForm = (widget) => {
    if (!widget) return;
    const isTimezone = widget.type === "timezone";
    editingCustomWidgetId = widget.id;
    if (customWidgetIconInput) customWidgetIconInput.value = widget.icon || (isTimezone ? "🕒" : "🔎");
    if (customWidgetCustomIconInput) customWidgetCustomIconInput.value = widget.customIcon || "";
    if (customWidgetModeSelect) {
      customWidgetModeSelect.value = isTimezone ? "timezone" : (widget.mode === "json" ? "json" : "simple");
    }
    if (customWidgetNameInput) customWidgetNameInput.value = widget.name || "";
    if (customWidgetGroupInput) customWidgetGroupInput.value = isTimezone ? "" : (widget.groupName || "");
    if (customWidgetUrlInput) customWidgetUrlInput.value = widget.urlTemplate || "";
    if (customWidgetJsonTemplateInput) customWidgetJsonTemplateInput.value = widget.jsonTemplate || "";
    if (customWidgetNewTabInput) customWidgetNewTabInput.checked = !!widget.openInNewTab;
    if (customWidgetDefaultInput) customWidgetDefaultInput.checked = !isTimezone && !!widget.isDefault;
    if (customWidgetTzSeconds) customWidgetTzSeconds.checked = !!widget.showSeconds;
    if (customWidgetTz24h) customWidgetTz24h.checked = widget.use24Hour !== false;
    if (customWidgetAddBtn) customWidgetAddBtn.textContent = t("save") || "Save";
    if (customWidgetCancelEditBtn) customWidgetCancelEditBtn.classList.remove("hidden");
    if (customWidgetStatus) customWidgetStatus.textContent = "";
    customWidgetVarsDraft = Array.isArray(widget.variables) && widget.variables.length > 0
      ? widget.variables.map(v => ({ ...v }))
      : [{ key: "query", label: widget.name || "Search", type: "text", optionsText: "" }];
    customWidgetTzDraft = Array.isArray(widget.timeZones) && widget.timeZones.length > 0
      ? widget.timeZones.map(z => ({ label: z.label || "", timeZone: z.timeZone || "" }))
      : [{ label: "UTC", timeZone: "UTC" }];
    syncCustomWidgetModeUI();
    renderCustomWidgetVarsEditor();
    renderCustomWidgetTzEditor();
  };

  syncCustomWidgetModeUI();
  renderCustomWidgetVarsEditor();
  renderCustomWidgetTzEditor();

  if (customWidgetModeSelect) {
    customWidgetModeSelect.addEventListener("change", () => {
      syncCustomWidgetModeUI();
      updateCustomWidgetPreviewOutput();
    });
  }

  if (customWidgetUrlInput) {
    customWidgetUrlInput.addEventListener("input", updateCustomWidgetPreviewOutput);
  }
  if (customWidgetJsonTemplateInput) {
    customWidgetJsonTemplateInput.addEventListener("input", updateCustomWidgetPreviewOutput);
  }
  if (customWidgetVarsList) {
    customWidgetVarsList.addEventListener("input", renderCustomWidgetPreviewInputs);
    customWidgetVarsList.addEventListener("change", renderCustomWidgetPreviewInputs);
  }
  if (customWidgetPreviewToggleBtn && customWidgetPreviewBox) {
    customWidgetPreviewToggleBtn.addEventListener("click", () => {
      const isHidden = customWidgetPreviewBox.classList.toggle("hidden");
      if (!isHidden) {
        renderCustomWidgetPreviewInputs();
      }
    });
  }

  if (customWidgetAddVarBtn) {
    customWidgetAddVarBtn.addEventListener("click", () => {
      customWidgetVarsDraft.push({
        key: `var${customWidgetVarsDraft.length + 1}`,
        label: `Filter ${customWidgetVarsDraft.length + 1}`,
        type: "text",
        optionsText: ""
      });
      renderCustomWidgetVarsEditor();
    });
  }

  if (customWidgetCancelEditBtn) {
    customWidgetCancelEditBtn.addEventListener("click", resetCustomWidgetForm);
  }

  if (customWidgetIconUploadBtn && customWidgetIconFile) {
    customWidgetIconUploadBtn.addEventListener("click", () => {
      customWidgetIconFile.value = "";
      customWidgetIconFile.click();
    });
    customWidgetIconFile.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file || !customWidgetCustomIconInput) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) return;
        if (file.type === "image/svg+xml" || dataUrl.length <= 24000) {
          customWidgetCustomIconInput.value = dataUrl;
          return;
        }
        const img = new Image();
        img.onload = () => {
          const maxDim = 64;
          const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((img.width || maxDim) * scale));
          canvas.height = Math.max(1, Math.round((img.height || maxDim) * scale));
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            customWidgetCustomIconInput.value = canvas.toDataURL("image/png");
          } else {
            customWidgetCustomIconInput.value = dataUrl;
          }
        };
        img.onerror = () => {
          customWidgetCustomIconInput.value = dataUrl;
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  const handleSpaceOrSearchStylePreview = async () => {
    markSettingsDirty();
    const draft = await ensureAppearanceDraft();
    if (showSideSpacesToggle) draft.showSideSpaces = showSideSpacesToggle.checked;
    if (highlightSideSpacesToggle) draft.highlightSideSpaces = highlightSideSpacesToggle.checked;
    if (searchStyleSelect) draft.searchStyle = searchStyleSelect.value;
    renderWidgetOrderList(draft);
    await applySideSpaces({ appearance: draft });
    await render();
    calculateGridLayout();
  };

  if (showSideSpacesToggle) {
    showSideSpacesToggle.addEventListener('change', handleSpaceOrSearchStylePreview);
  }
  if (highlightSideSpacesToggle) {
    highlightSideSpacesToggle.addEventListener('change', handleSpaceOrSearchStylePreview);
  }
  if (tallBookmarkTilesToggle) {
    tallBookmarkTilesToggle.addEventListener('change', async () => {
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      draft.tallBookmarkTiles = tallBookmarkTilesToggle.checked;
      await applyTileSize({ appearance: draft });
      await render();
      calculateGridLayout();
    });
  }
  if (clickableTagsToggle) {
    clickableTagsToggle.addEventListener('change', async () => {
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      draft.clickableTags = clickableTagsToggle.checked;
      await applyTileSize({ appearance: draft });
    });
  }
  if (searchStyleSelect) {
    searchStyleSelect.addEventListener('change', handleSpaceOrSearchStylePreview);
  }
  if (headerSingleRowToggle) {
    headerSingleRowToggle.addEventListener('change', async () => {
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      draft.headerSingleRow = headerSingleRowToggle.checked;
      await applySideSpaces({ appearance: draft });
    });
  }
  if (customWidgetAddBtn) {
    customWidgetAddBtn.addEventListener('click', async () => {
      const selectedMode = customWidgetModeSelect?.value || "simple";
      const isTimezone = selectedMode === "timezone";
      const mode = selectedMode === "json" ? "json" : "simple";
      const name = (customWidgetNameInput?.value || "").trim();
      const groupName = (customWidgetGroupInput?.value || "").trim();
      const urlTemplate = (customWidgetUrlInput?.value || "").trim();
      const jsonTemplate = (customWidgetJsonTemplateInput?.value || "").trim();
      const defaultIcon = isTimezone ? "🕒" : "🔎";
      const icon = (customWidgetIconInput?.value || defaultIcon).trim() || defaultIcon;
      const rawCustomIcon = (customWidgetCustomIconInput?.value || "").trim();
      let customIcon = null;
      if (rawCustomIcon) {
        customIcon = normalizeCustomIconValue(rawCustomIcon, { allowEmoji: false });
        if (!customIcon) {
          if (customWidgetStatus) {
            customWidgetStatus.textContent = "❌ " + (t("customSearchInvalidIcon") || "Enter a valid icon URL or upload an image.");
          }
          return;
        }
      }

      if (isTimezone) {
        const timeZones = normalizeCustomTimeZones(customWidgetTzDraft);
        if (timeZones.length === 0) {
          if (customWidgetStatus) {
            customWidgetStatus.textContent = "❌ " + (t("customTzInvalidError") || "Add at least one valid IANA time zone (e.g. UTC, Europe/Prague, America/New_York).");
          }
          return;
        }
        const resolvedName = name || t("customTzDefaultName") || "Time Zones";
        const showSeconds = !!customWidgetTzSeconds?.checked;
        const use24Hour = customWidgetTz24h ? !!customWidgetTz24h.checked : true;

        if (customWidgetStatus) customWidgetStatus.textContent = "";
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        if (editingCustomWidgetId) {
          draft.customWidgets = (draft.customWidgets || []).map(w =>
            w.id === editingCustomWidgetId
              ? { ...w, type: "timezone", name: resolvedName, icon, customIcon, timeZones, showSeconds, use24Hour }
              : w
          );
        } else {
          const newWidget = {
            id: `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: "timezone",
            name: resolvedName,
            icon,
            customIcon,
            timeZones,
            showSeconds,
            use24Hour,
            space: "right",
            align: "auto",
            newRow: false
          };
          draft.customWidgets = [...(draft.customWidgets || []), newWidget];
          draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
        }

        resetCustomWidgetForm();
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
        return;
      }

      const openInNewTab = !!customWidgetNewTabInput?.checked;
      const isDefault = !!customWidgetDefaultInput?.checked && !!groupName;
      const variables = customWidgetVarsDraft
        .map(v => ({
          key: (v.key || "").trim(),
          label: (v.label || v.key || "").trim(),
          type: v.type || "text",
          optionsText: v.optionsText || ""
        }))
        .filter(v => v.key);

      if (!name || !isValidCustomSearchUrlTemplate(urlTemplate)) {
        if (customWidgetStatus) {
          customWidgetStatus.textContent = "❌ " + (t("customSearchInvalidUrl") || "Enter a name and valid http(s) URL template.");
        }
        return;
      }
      if (mode === "json" && !isValidCustomSearchJsonTemplate(jsonTemplate)) {
        if (customWidgetStatus) {
          customWidgetStatus.textContent = "❌ " + (t("customSearchInvalidJson") || "Enter a valid JSON template.");
        }
        return;
      }

      if (customWidgetStatus) customWidgetStatus.textContent = "";
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      if (editingCustomWidgetId) {
        draft.customWidgets = (draft.customWidgets || []).map(w => {
          if (w.id === editingCustomWidgetId) {
            return { ...w, mode, name, groupName, isDefault, icon, customIcon, urlTemplate, jsonTemplate, openInNewTab, variables };
          }
          if (isDefault && groupName && (typeof w?.groupName === "string" ? w.groupName.trim() : "") === groupName) {
            return { ...w, isDefault: false };
          }
          return w;
        });
      } else {
        const existingWidgets = isDefault && groupName
          ? (draft.customWidgets || []).map(w =>
              (typeof w?.groupName === "string" ? w.groupName.trim() : "") === groupName
                ? { ...w, isDefault: false }
                : w
            )
          : (draft.customWidgets || []);
        const newWidget = {
          id: `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          type: "custom-search",
          mode,
          name,
          groupName,
          isDefault,
          icon,
          customIcon,
          urlTemplate,
          jsonTemplate,
          openInNewTab,
          variables,
          space: "right",
          align: "auto",
          newRow: false
        };
        draft.customWidgets = [...existingWidgets, newWidget];
        draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
      }

      resetCustomWidgetForm();
      renderWidgetOrderList(draft);
      await applySideSpaces({ appearance: draft });
      await render();
      calculateGridLayout();
    });
  }

  function exportCustomWidgetsLibrary(widgets, filenamePrefix = "simple-dial-search-widgets", statusEl = customWidgetStatus) {
    const list = Array.isArray(widgets) ? widgets : [];
    if (list.length === 0) {
      if (statusEl) {
        statusEl.textContent = t("customSearchExportEmpty") || "No custom search widgets to export.";
      }
      return;
    }
    const payload = serializeCustomWidgetsExport(list);
    const dataStr = JSON.stringify(payload, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filenamePrefix}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    if (statusEl) {
      statusEl.textContent = "✅ " + (t("customSearchExportSuccess") || "Exported") + ` (${list.length})`;
    }
  }

  let activeWidgetImportStatusEl = customWidgetStatus;

  const triggerCustomWidgetExport = async (statusEl) => {
    const draft = await ensureAppearanceDraft();
    exportCustomWidgetsLibrary(draft.customWidgets || [], "simple-dial-search-widgets", statusEl);
  };

  const customWidgetTrustModal = document.getElementById("custom-widget-trust-modal");
  const customWidgetTrustSource = document.getElementById("custom-widget-trust-source");
  const customWidgetTrustCheckbox = document.getElementById("custom-widget-trust-checkbox");
  const customWidgetTrustConfirmBtn = document.getElementById("custom-widget-trust-confirm");
  const customWidgetTrustCancelBtn = document.getElementById("custom-widget-trust-cancel");

  const confirmTrustedWidgetSource = (sourceLabel) => {
    if (!customWidgetTrustModal || !customWidgetTrustCheckbox || !customWidgetTrustConfirmBtn || !customWidgetTrustCancelBtn) {
      return Promise.resolve(confirm(t("customSearchTrustedSourceConfirm") || "Only import or load custom search widgets from sources you trust. Continue?"));
    }

    return new Promise((resolve) => {
      if (customWidgetTrustSource) {
        customWidgetTrustSource.textContent = sourceLabel || "";
        customWidgetTrustSource.classList.toggle("hidden", !sourceLabel);
      }
      customWidgetTrustCheckbox.checked = false;
      customWidgetTrustConfirmBtn.disabled = true;
      customWidgetTrustModal.classList.remove("hidden");

      const cleanup = (result) => {
        customWidgetTrustModal.classList.add("hidden");
        customWidgetTrustCheckbox.removeEventListener("change", onCheckChange);
        customWidgetTrustConfirmBtn.removeEventListener("click", onConfirm);
        customWidgetTrustCancelBtn.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKeyDown);
        resolve(result);
      };

      const onCheckChange = () => {
        customWidgetTrustConfirmBtn.disabled = !customWidgetTrustCheckbox.checked;
      };
      const onConfirm = () => {
        if (!customWidgetTrustCheckbox.checked) return;
        cleanup(true);
      };
      const onCancel = () => cleanup(false);
      const onKeyDown = (ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          cleanup(false);
        }
      };

      customWidgetTrustCheckbox.addEventListener("change", onCheckChange);
      customWidgetTrustConfirmBtn.addEventListener("click", onConfirm);
      customWidgetTrustCancelBtn.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKeyDown);
    });
  };

  const triggerCustomWidgetImport = (statusEl) => {
    activeWidgetImportStatusEl = statusEl || customWidgetStatus;
    if (customWidgetImportFile) {
      customWidgetImportFile.value = "";
      customWidgetImportFile.click();
    }
  };

  if (customWidgetExportBtn) {
    customWidgetExportBtn.addEventListener("click", () => triggerCustomWidgetExport(customWidgetStatus));
  }
  if (customWidgetExportAllBtn) {
    customWidgetExportAllBtn.addEventListener("click", () => triggerCustomWidgetExport(customWidgetsLibraryStatus));
  }
  if (exportWidgetsBtn) {
    exportWidgetsBtn.addEventListener("click", () => triggerCustomWidgetExport(widgetsExportStatus));
  }
  if (customWidgetImportBtn) {
    customWidgetImportBtn.addEventListener("click", () => triggerCustomWidgetImport(customWidgetStatus));
  }
  if (importWidgetsBtn) {
    importWidgetsBtn.addEventListener("click", () => triggerCustomWidgetImport(widgetsExportStatus));
  }
  const mergeImportedCustomWidgets = async (importedWidgets, { sourceUrl = null } = {}) => {
    markSettingsDirty();
    const draft = await ensureAppearanceDraft();
    const existing = Array.isArray(draft.customWidgets) ? [...draft.customWidgets] : [];
    const existingIndexById = new Map(existing.map((w, idx) => [w.id, idx]));

    let addedCount = 0;
    let updatedCount = 0;
    const nowIso = new Date().toISOString();

    for (const w of importedWidgets) {
      if (existingIndexById.has(w.id)) {
        const idx = existingIndexById.get(w.id);
        existing[idx] = applyCustomWidgetUpdate(existing[idx], w, sourceUrl || existing[idx].sourceUrl || null);
        updatedCount++;
      } else {
        const nextWidget = sourceUrl
          ? { ...w, sourceUrl, sourceUpdatedAt: nowIso }
          : w;
        existingIndexById.set(nextWidget.id, existing.length);
        existing.push(nextWidget);
        addedCount++;
      }
    }

    draft.customWidgets = existing;
    draft.widgetOrder = normalizeWidgetOrder(
      [...(draft.widgetOrder || []), ...existing.map(w => w.id)],
      draft.customWidgets
    );

    renderWidgetOrderList(draft);
    await applySideSpaces({ appearance: draft });
    await render();
    calculateGridLayout();
    return { addedCount, updatedCount, total: addedCount + updatedCount };
  };

  async function updateSingleCustomWidgetFromUrl(widgetId) {
    const draft = await ensureAppearanceDraft();
    const target = (draft.customWidgets || []).find(w => w.id === widgetId);
    if (!target?.sourceUrl) return;
    if (customWidgetsLibraryStatus) {
      customWidgetsLibraryStatus.textContent = "⏳ " + (t("customSearchUpdatingStatus") || "Updating from URL...");
    }
    try {
      const { url, widgets } = await fetchCustomWidgetsFromUrl(target.sourceUrl);
      const match =
        widgets.find(w => w.id === target.id) ||
        widgets.find(w => w.name && target.name && w.name.toLowerCase() === target.name.toLowerCase()) ||
        (widgets.length === 1 ? widgets[0] : null);
      if (!match) {
        if (customWidgetsLibraryStatus) {
          customWidgetsLibraryStatus.textContent = "❌ " + (t("customSearchUpdateNotFound") || "Matching widget not found at source URL.");
        }
        return;
      }
      markSettingsDirty();
      draft.customWidgets = (draft.customWidgets || []).map(w =>
        w.id === target.id ? applyCustomWidgetUpdate(w, match, url) : w
      );
      if (editingCustomWidgetId === target.id) {
        const updated = draft.customWidgets.find(w => w.id === target.id);
        if (updated) loadCustomWidgetIntoForm(updated);
      }
      renderWidgetOrderList(draft);
      await applySideSpaces({ appearance: draft });
      await render();
      calculateGridLayout();
      if (customWidgetsLibraryStatus) {
        customWidgetsLibraryStatus.textContent = "✅ " + (t("customSearchUpdateSuccess") || "Widget updated (you can revert with ↩️; click Save to persist).");
      }
    } catch (err) {
      if (customWidgetsLibraryStatus) {
        const detail = err?.message === "INVALID_WIDGET_URL"
          ? (t("customSearchInvalidSourceUrl") || "Enter a valid http(s) URL.")
          : (err?.message || "Failed to update from URL.");
        customWidgetsLibraryStatus.textContent = "❌ " + detail;
      }
    }
  }

  if (customWidgetImportFile) {
    customWidgetImportFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const statusEl = activeWidgetImportStatusEl || customWidgetStatus;
      const trusted = await confirmTrustedWidgetSource(file.name);
      if (!trusted) {
        customWidgetImportFile.value = "";
        return;
      }
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const { widgets: importedWidgets, validFormat } = parseImportedCustomWidgets(parsed);
        if (!validFormat || importedWidgets.length === 0) {
          if (statusEl) {
            statusEl.textContent = "❌ " + (t("customSearchImportInvalid") || "No valid custom search widgets found in file.");
          }
          return;
        }

        const { total } = await mergeImportedCustomWidgets(importedWidgets);
        if (statusEl) {
          statusEl.textContent = "✅ " + (t("customSearchImportSuccess") || "Imported") + ` (${total})`;
        }
      } catch {
        if (statusEl) {
          statusEl.textContent = "❌ " + (t("customSearchImportInvalid") || "No valid custom search widgets found in file.");
        }
      } finally {
        customWidgetImportFile.value = "";
      }
    });
  }

  if (customWidgetLoadUrlBtn && customWidgetSourceUrlInput) {
    customWidgetLoadUrlBtn.addEventListener("click", async () => {
      const rawUrl = customWidgetSourceUrlInput.value.trim();
      if (!rawUrl) {
        if (customWidgetStatus) {
          customWidgetStatus.textContent = "❌ " + (t("customSearchInvalidSourceUrl") || "Enter a valid http(s) URL.");
        }
        return;
      }
      const trusted = await confirmTrustedWidgetSource(rawUrl);
      if (!trusted) return;
      if (customWidgetStatus) {
        customWidgetStatus.textContent = "⏳ " + (t("customSearchLoadingUrlStatus") || "Loading widgets from URL...");
      }
      try {
        const { url, widgets } = await fetchCustomWidgetsFromUrl(rawUrl);
        const { total } = await mergeImportedCustomWidgets(widgets, { sourceUrl: url });
        customWidgetSourceUrlInput.value = "";
        if (customWidgetStatus) {
          customWidgetStatus.textContent = "✅ " + (t("customSearchImportSuccess") || "Imported") + ` (${total})`;
        }
      } catch (err) {
        if (customWidgetStatus) {
          const msg = err?.message === "INVALID_WIDGET_URL"
            ? (t("customSearchInvalidSourceUrl") || "Enter a valid http(s) URL.")
            : err?.message === "INVALID_WIDGET_PAYLOAD"
              ? (t("customSearchImportInvalid") || "No valid custom search widgets found at URL.")
              : (err?.message || "Failed to load from URL.");
          customWidgetStatus.textContent = "❌ " + msg;
        }
      }
    });
  }

  if (customWidgetUpdateAllBtn) {
    customWidgetUpdateAllBtn.addEventListener("click", async () => {
      const draft = await ensureAppearanceDraft();
      const urlWidgets = (draft.customWidgets || []).filter(w => !!w?.sourceUrl);
      if (urlWidgets.length === 0) return;

      if (customWidgetsLibraryStatus) {
        customWidgetsLibraryStatus.textContent = "⏳ " + (t("customSearchUpdatingStatus") || "Updating from URL...");
      }

      const uniqueUrls = [...new Set(urlWidgets.map(w => w.sourceUrl))];
      let updatedCount = 0;
      let errorCount = 0;
      const fetchedByUrl = new Map();

      for (const sourceUrl of uniqueUrls) {
        try {
          const res = await fetchCustomWidgetsFromUrl(sourceUrl);
          fetchedByUrl.set(sourceUrl, res);
        } catch {
          errorCount++;
        }
      }

      if (fetchedByUrl.size > 0) {
        markSettingsDirty();
        draft.customWidgets = (draft.customWidgets || []).map(w => {
          if (!w?.sourceUrl || !fetchedByUrl.has(w.sourceUrl)) return w;
          const { url, widgets } = fetchedByUrl.get(w.sourceUrl);
          const match =
            widgets.find(item => item.id === w.id) ||
            widgets.find(item => item.name && w.name && item.name.toLowerCase() === w.name.toLowerCase()) ||
            (widgets.length === 1 ? widgets[0] : null);
          if (!match) return w;
          updatedCount++;
          return applyCustomWidgetUpdate(w, match, url);
        });
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      }

      if (customWidgetsLibraryStatus) {
        if (updatedCount > 0 && errorCount === 0) {
          customWidgetsLibraryStatus.textContent = "✅ " + (t("customSearchUpdateSuccess") || "Updated") + ` (${updatedCount})`;
        } else if (updatedCount > 0) {
          customWidgetsLibraryStatus.textContent = "⚠️ " + (t("customSearchUpdateSuccess") || "Updated") + ` (${updatedCount}), ${errorCount} failed`;
        } else {
          customWidgetsLibraryStatus.textContent = "❌ " + (t("customSearchUpdateNotFound") || "Failed to update widgets from URL.");
        }
      }
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
    if (typeof window.clearDateTimePreview === "function") {
      window.clearDateTimePreview();
    }
  } catch (err) {
    console.warn("Failed to revert date/time preview", err);
  }
}

const SEASONAL_BACKGROUND_THEMES = new Set(["spring", "summer", "autumn", "winter"]);

function getThemeBackgroundQuery(themeValue) {
  return encodeURIComponent(SEASONAL_BACKGROUND_THEMES.has(themeValue) ? themeValue : "wallpaper");
}

function updateThemeCustomRowsVisibility(themeValue) {
  if (themeCustomFileRow) {
    themeCustomFileRow.classList.toggle("hidden", themeValue !== "custom-file");
  }
  if (themeCustomUrlRow) {
    themeCustomUrlRow.classList.toggle("hidden", themeValue !== "custom-url");
  }
  const query = getThemeBackgroundQuery(themeValue);
  if (themeBackgroundsLink) {
    themeBackgroundsLink.href = `https://unsplash.com/s/photos/${query}?license=free`;
  }
  if (themeBackgroundsPixabayLink) {
    themeBackgroundsPixabayLink.href = `https://pixabay.com/photos/search/${query}`;
  }
  if (themeBackgroundsPexelsLink) {
    themeBackgroundsPexelsLink.href = `https://www.pexels.com/search/?q=${query}&orientation=landscape`;
  }
}

function setBackgroundUrlStatusMessage(message = "", isError = false) {
  if (!bgImageUrlStatus) return;
  bgImageUrlStatus.textContent = message;
  bgImageUrlStatus.style.color = message ? (isError ? "#e53935" : "#4caf50") : "";
}

function setThemeStatusMessage(message = "", isError = false) {
  if (!themeStatus) return;
  themeStatus.textContent = message;
  themeStatus.style.color = message ? (isError ? "#e53935" : "#4caf50") : "";
}

function applyThemeDraftToControls(draft) {
  if (!draft) return;
  if (themeSelect) themeSelect.value = draft.theme;
  if (themeCssFileName) themeCssFileName.textContent = draft.customThemeFileName;
  if (themeCssUrlInput) themeCssUrlInput.value = draft.customThemeUrl;
  if (themeCssFileInput) themeCssFileInput.value = "";
  setThemeStatusMessage("");
  updateThemeCustomRowsVisibility(draft.theme);
}

function createAppearanceDraftFromConfig(config) {
  const appearance = config?.appearance || {};
  return {
    theme: appearance.theme || "default",
    customThemeCss: appearance.customThemeCss || "",
    customThemeFileName: appearance.customThemeFileName || "",
    customThemeUrl: appearance.customThemeUrl || "",
    backgroundImage: appearance.backgroundImage ?? null,
    backgroundImageUrl: appearance.backgroundImageUrl || "",
    backgroundSize: appearance.backgroundSize || 'stretched',
    bgDim: appearance.bgDim ?? 0,
    tileOpacity: appearance.tileOpacity ?? 1,
    barOpacity: appearance.barOpacity ?? 1,
    tileSize: appearance.tileSize ?? 1,
    groupTileSize: appearance.groupTileSize ?? 1,
    showDateTime: appearance.showDateTime ?? true,
    showDeleted: appearance.showDeleted ?? false,
    showGroupBookmarkCount: appearance.showGroupBookmarkCount ?? true,
    showSideSpaces: appearance.showSideSpaces ?? false,
    highlightSideSpaces: appearance.highlightSideSpaces ?? false,
    tallBookmarkTiles: appearance.tallBookmarkTiles ?? false,
    clickableTags: appearance.clickableTags ?? true,
    dateTimeSpace: (appearance.dateTimeSpace === "disabled" || appearance.showDateTime === false)
      ? "disabled"
      : (appearance.dateTimeSpace || "footer"),
    groupsSpace: appearance.groupsSpace || "header",
    searchSpace: appearance.searchSpace || "header",
    manageSpace: appearance.manageSpace || "header",
    syncStatusSpace: appearance.syncStatusSpace || "footer",
    bookmarksCountSpace: appearance.bookmarksCountSpace || "footer",
    headerSingleRow: appearance.headerSingleRow !== false,
    searchStyle: appearance.searchStyle || "full",
    customWidgets: Array.isArray(appearance.customWidgets) ? appearance.customWidgets.map(w => ({ ...w })) : [],
    widgetOrder: normalizeWidgetOrder(appearance.widgetOrder, appearance.customWidgets),
    widgetAlign: { ...(appearance.widgetAlign || {}) },
    widgetNewRow: { ...(appearance.widgetNewRow || {}) }
  };
}

async function ensureAppearanceDraft() {
  if (!appearanceDraft) {
    const config = await loadConfig();
    appearanceDraft = createAppearanceDraftFromConfig(config);
  }
  return appearanceDraft;
}

function syncAppearanceControlsFromDraft(draft) {
  applyThemeDraftToControls(draft);

  if (bgSizeSelect) bgSizeSelect.value = draft.backgroundSize;

  if (bgDimSlider) {
    const dimPercent = Math.round((draft.bgDim ?? 0) * 100);
    bgDimSlider.value = dimPercent;
    if (bgDimValue) bgDimValue.textContent = `${dimPercent}%`;
  }

  if (tileOpacitySlider) {
    const opacityPercent = Math.round((draft.tileOpacity ?? 1) * 100);
    tileOpacitySlider.value = opacityPercent;
    if (tileOpacityValue) tileOpacityValue.textContent = `${opacityPercent}%`;
  }

  if (barOpacitySlider) {
    const barOpacityPercent = Math.round((draft.barOpacity ?? 1) * 100);
    barOpacitySlider.value = barOpacityPercent;
    if (barOpacityValue) barOpacityValue.textContent = `${barOpacityPercent}%`;
  }

  if (tileSizeSlider) {
    const sizePercent = Math.round((draft.tileSize ?? 1) * 100);
    tileSizeSlider.value = sizePercent;
    if (tileSizeValue) tileSizeValue.textContent = `${sizePercent}%`;
  }

  if (groupTileSizeSlider) {
    const groupSizePercent = Math.round((draft.groupTileSize ?? 1) * 100);
    groupTileSizeSlider.value = groupSizePercent;
    if (groupTileSizeValue) groupTileSizeValue.textContent = `${groupSizePercent}%`;
  }

  if (showDeletedToggle) {
    showDeletedToggle.checked = !!draft.showDeleted;
    showDeletedToggle.dispatchEvent(new Event("change"));
    updateShowDeletedButtonAppearance();
  }

  if (groupCountToggle) {
    groupCountToggle.checked = !!draft.showGroupBookmarkCount;
  }
  if (headerSingleRowToggle) {
    headerSingleRowToggle.checked = !!draft.headerSingleRow;
  }
  window.groupCountPreviewEnabled = null;

  if (showSideSpacesToggle) {
    showSideSpacesToggle.checked = !!draft.showSideSpaces;
  }
  if (highlightSideSpacesToggle) {
    highlightSideSpacesToggle.checked = !!draft.highlightSideSpaces;
  }
  if (tallBookmarkTilesToggle) {
    tallBookmarkTilesToggle.checked = !!draft.tallBookmarkTiles;
  }
  if (clickableTagsToggle) {
    clickableTagsToggle.checked = draft.clickableTags !== false;
  }
  if (searchStyleSelect) {
    searchStyleSelect.value = draft.searchStyle || "full";
  }
  window.renderWidgetOrderList?.(draft);

  if (bgPreview) {
    if (draft.backgroundImage) {
      bgPreview.style.backgroundImage = `url('${draft.backgroundImage}')`;
      bgPreview.style.display = 'block';
    } else {
      bgPreview.style.backgroundImage = '';
      bgPreview.style.display = 'none';
    }
  }

  if (bgImageInput) bgImageInput.value = "";
  if (bgImageUrlInput) bgImageUrlInput.value = draft.backgroundImageUrl || "";
  setBackgroundUrlStatusMessage("");
}

async function revertAppearancePreviewToSaved() {
  try {
    const config = await loadConfig();
    appearanceDraft = createAppearanceDraftFromConfig(config);
    appearancePreviewUrlCss = "";
    appearancePreviewUrlTarget = "";

    syncAppearanceControlsFromDraft(appearanceDraft);

    await applyThemeStyle(config);
    await applyBackground(config);
    await applyBgDim(config);
    await applyTileOpacity(config);
    await applyBarOpacity(config);
    await applyTileSize(config);
    await applyGroupTileSize(config);
    await applySideSpaces(config);
    await revertDateTimePreviewToSaved();
    if (savedLanguageSnapshot) {
      const currentLang = getCurrentLanguage();
      if (savedLanguageSnapshot.override) {
        if (currentLang !== savedLanguageSnapshot.override) {
          await setLanguage(savedLanguageSnapshot.override, { persist: true });
        }
      } else {
        await resetLanguageToBrowser({ persist: true });
      }
      if (languageSelect) {
        languageSelect.value = getCurrentLanguage();
      }
      pendingLanguageReset = false;
      updateUIText();
      updateClock();
    }
    await render();
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
    window.groupCountPreviewEnabled = null;
    savedLanguageSnapshot = {
      lang: getCurrentLanguage(),
      override: getSavedLanguageOverride()
    };
    pendingLanguageReset = false;

    const config = await loadConfig();

  // Load sync settings
  syncUrl.value = config.sync.serverUrl || "";
  syncEnable.checked = config.sync.enabled;
  if (syncType) syncType.value = config.sync.type || 'direct';
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
  if (bgDimSlider) {
    const dimPercent = Math.round((config.appearance?.bgDim ?? 0) * 100);
    bgDimSlider.value = dimPercent;
    if (bgDimValue) {
      bgDimValue.textContent = `${dimPercent}%`;
    }
  }
  if (bgImageUrlInput) {
    bgImageUrlInput.value = config.appearance?.backgroundImageUrl || "";
  }
  setBackgroundUrlStatusMessage("");
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

  // Load header & footer opacity settings
  if (barOpacitySlider) {
    const barOpacityPercent = Math.round((config.appearance?.barOpacity ?? 1) * 100);
    barOpacitySlider.value = barOpacityPercent;
    if (barOpacityValue) {
      barOpacityValue.textContent = `${barOpacityPercent}%`;
    }
  }

  // Load tile size settings
  if (tileSizeSlider) {
    const sizePercent = Math.round((config.appearance?.tileSize ?? 1) * 100);
    tileSizeSlider.value = sizePercent;
    if (tileSizeValue) {
      tileSizeValue.textContent = `${sizePercent}%`;
    }
  }

  // Load group tile size settings
  if (groupTileSizeSlider) {
    const groupSizePercent = Math.round((config.appearance?.groupTileSize ?? 1) * 100);
    groupTileSizeSlider.value = groupSizePercent;
    if (groupTileSizeValue) {
      groupTileSizeValue.textContent = `${groupSizePercent}%`;
    }
  }

  // Load group bookmark count display toggle state
  if (groupCountToggle) {
    groupCountToggle.checked = config.appearance?.showGroupBookmarkCount ?? true;
  }

  if (showSideSpacesToggle) {
    showSideSpacesToggle.checked = config.appearance?.showSideSpaces ?? false;
  }
  if (highlightSideSpacesToggle) {
    highlightSideSpacesToggle.checked = config.appearance?.highlightSideSpaces ?? false;
  }
  if (tallBookmarkTilesToggle) {
    tallBookmarkTilesToggle.checked = config.appearance?.tallBookmarkTiles ?? false;
  }
  if (clickableTagsToggle) {
    clickableTagsToggle.checked = config.appearance?.clickableTags ?? true;
  }
  if (searchStyleSelect) {
    searchStyleSelect.value = config.appearance?.searchStyle || "full";
  }
  window.renderWidgetOrderList?.(config.appearance || {});

  // Load advanced settings
  applyAdvancedSettingsToControls(config.advanced || {});
  if (browserBookmarksAutoSync) {
    browserBookmarksAutoSync.checked = !!config.browserBookmarksAutoSync;
  }

  if (showDeletedToggle) {
    showDeletedToggle.checked = config.appearance?.showDeleted ?? false;
    showDeletedToggle.dispatchEvent(new Event("change"));
    updateShowDeletedButtonAppearance();
  }

  appearanceDraft = createAppearanceDraftFromConfig(config);
  appearancePreviewUrlCss = "";
  appearancePreviewUrlTarget = "";
  applyThemeDraftToControls(appearanceDraft);

  // Load backups settings
  if (backupRetentionDays) {
    backupRetentionDays.value = config.backups?.retentionDays || 14;
  }
  if (backupFrequencyHours) {
    backupFrequencyHours.value = config.backups?.frequencyHours || 24;
  }
  await refreshBackupsTable();

    syncStatus.textContent = "";
    if (syncTestStatus) syncTestStatus.textContent = "";
    if (syncNowStatus) syncNowStatus.textContent = "";
    if (massColorFromIconStatus) massColorFromIconStatus.textContent = "";
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
    resetLogonCount();
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
        const headerSummary = formatSupportedHeadersSummary(result.supportedHeaders);
        if (syncTestStatus) syncTestStatus.textContent = "✅ " + t("readTestSuccessful") + ` (${groupCount})` + (headerSummary ? ` — ${headerSummary}` : '');
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
const REMOTE_MARKER_LABELS = { sha256: 'X-JSON-SHA256', etag: 'ETag', 'last-modified': 'Last-Modified' };

function formatSupportedHeadersSummary(supportedHeaders) {
  if (!supportedHeaders) return '';

  const supported = Object.keys(supportedHeaders).filter(type => supportedHeaders[type]);
  if (supported.length === 0) return t('noChangeMarkerHeaders');

  return t('supportedChangeMarkerHeaders') + ': ' + supported.map(type => REMOTE_MARKER_LABELS[type] || type).join(', ');
}

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
function serializeExportBookmarkItem(i) {
  if (isStackItem(i)) {
    return {
      id: i.id,
      type: "stack",
      title: i.title || t("defaultStackName") || "Stack",
      sectionId: i.sectionId || null,
      tileColor: i.tileColor || null,
      updatedAt: i.updatedAt,
      deleted: i.deleted || false,
      deletedAt: i.deletedAt || null,
      children: (i.children || []).map(serializeExportBookmarkItem)
    };
  }

  return {
    id: i.id,
    title: i.title,
    url: i.url,
    customIcon: i.customIcon || null,
    notes: i.notes || null,
    tags: Array.isArray(i.tags) ? [...i.tags] : [],
    sectionId: i.sectionId || null,
    tileColor: i.tileColor || null,
    colorFromIcon: !!i.colorFromIcon,
    customIconCache: i.customIconCache || null,
    iconRefreshedAt: Number(i.iconRefreshedAt || 0),
    updatedAt: i.updatedAt,
    deleted: i.deleted || false,
    deletedAt: i.deletedAt || null
  };
}

exportBtn.addEventListener("click", async () => {
  // Export a clean copy of state ensuring customization fields are present
  const exportData = {
    tags: Array.isArray(state.tags) ? state.tags.map(tag => ({ ...tag })) : [],
    groups: state.groups.map(g => ({
      id: g.id,
      name: g.name,
      iconEmoji: g.iconEmoji || null,
      customIcon: g.customIcon || null,
      tileColor: g.tileColor || null,
      colorFromIcon: !!g.colorFromIcon,
      sections: Array.isArray(g.sections) ? g.sections.map(s => ({ ...s })) : [],
      updatedAt: g.updatedAt,
      deleted: g.deleted,
      deletedAt: g.deletedAt,
      items: (g.items || []).map(serializeExportBookmarkItem)
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
        alert(t("invalidFileFormat"));
        return;
      }

      const config = await loadConfig();
      if (config.sync.enabled === true) {
        config.sync.enabled = false;
      }
      config.browserBookmarksAutoSync = false;
      await saveConfig(config);

      state.groups = imported.groups.map(g => ({
        ...g,
        sections: Array.isArray(g.sections) ? g.sections : [],
        items: Array.isArray(g.items) ? g.items : []
      }));
      state.tags = Array.isArray(imported.tags) ? imported.tags : [];
      await saveState();
      alert(t('importedSuccessfully') + "\n\n" + t('syncDisabledAfterImport'));
      
      settingsModal.classList.add("hidden");
      // Re-render UI to show imported data
      window.location.reload();
    } catch (error) {
      alert(`${t("failedToParse")} ${error.message}`);
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
        alert(t("invalidFileFormat"));
        return;
      }

      const config = await loadConfig();
      if (config.sync.enabled === true) {
        config.sync.enabled = false;
      }
      config.browserBookmarksAutoSync = false;
      await saveConfig(config);

      state.groups = importedGroups;
      await saveState();

      alert(t('importedSuccessfully') + "\n\n" + t('syncDisabledAfterImport'));
      
      settingsModal.classList.add("hidden");
      window.location.reload();
    } catch (error) {
      alert(`${t("failedToParse")} ${error.message}`);
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

    for (const item of (group.items || []).filter(i => !i.deleted)) {
      if (isStackItem(item)) {
        const stackTitle = escapeHtml(item.title || "Stack");
        const stackDate = formatDate(item.updatedAt);
        lines.push(`<DT><H3 ADD_DATE=\"${stackDate}\">${stackTitle}</H3>`);
        lines.push("<DL><p>");
        for (const child of (item.children || []).filter(c => !c.deleted && c.url)) {
          const title = escapeHtml(child.title || child.url);
          const href = escapeHtml(child.url);
          const itemDate = formatDate(child.updatedAt);
          lines.push(`<DT><A HREF=\"${href}\" ADD_DATE=\"${itemDate}\">${title}</A>`);
        }
        lines.push("</DL><p>");
      } else if (item.url) {
        const title = escapeHtml(item.title || item.url);
        const href = escapeHtml(item.url);
        const itemDate = formatDate(item.updatedAt);
        lines.push(`<DT><A HREF=\"${href}\" ADD_DATE=\"${itemDate}\">${title}</A>`);
      }
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
            deletedAt: null
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
        deletedAt: null
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
    await syncBrowserBookmarks({ force: true });

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
          deletedAt: null
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
          deletedAt: null
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

    const config = await loadConfig();
    if (config.sync.enabled === true) {
      config.sync.enabled = false;
    }
    config.browserBookmarksAutoSync = false;
    await saveConfig(config);

    state.groups = importedGroups;
    await saveState();

    alert(t('bookmarksImportSuccessful') + "\n\n" + t('syncDisabledAfterImport'));
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
        const draft = await ensureAppearanceDraft();
        draft.backgroundImage = base64Data;
        draft.backgroundImageUrl = "";
        if (bgImageUrlInput) bgImageUrlInput.value = "";
        setBackgroundUrlStatusMessage("");
        
        // Show preview
        if (bgPreview) {
          bgPreview.style.backgroundImage = `url('${base64Data}')`;
          bgPreview.style.display = 'block';
        }

        const previewConfig = { appearance: { ...draft } };
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

async function applyBackgroundFromUrlInput() {
  if (!bgImageUrlInput) return;
  const rawUrl = bgImageUrlInput.value.trim();
  if (!isAllowedThemeUrl(rawUrl)) {
    setBackgroundUrlStatusMessage(t("invalidBackgroundUrl") || "Please enter a valid image URL.", true);
    return;
  }

  try {
    setBackgroundUrlStatusMessage("...");
    const { url, dataUrl } = await fetchBackgroundImageFromUrl(rawUrl);
    const draft = await ensureAppearanceDraft();
    draft.backgroundImage = dataUrl;
    draft.backgroundImageUrl = url;
    bgImageUrlInput.value = url;
    if (bgImageInput) bgImageInput.value = "";

    if (bgPreview) {
      bgPreview.style.backgroundImage = `url('${dataUrl}')`;
      bgPreview.style.display = "block";
    }

    await applyBackground({ appearance: { ...draft } });
    setBackgroundUrlStatusMessage("✅");
    markSettingsDirty();
  } catch (err) {
    setBackgroundUrlStatusMessage(err?.message || t("invalidBackgroundUrl") || "Failed to load image URL.", true);
  }
}

if (bgImageUrlApply) {
  bgImageUrlApply.addEventListener("click", () => {
    void applyBackgroundFromUrlInput();
  });
}

if (bgImageUrlInput) {
  bgImageUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void applyBackgroundFromUrlInput();
    }
  });
}

if (bgRemoveBtn) {
  bgRemoveBtn.addEventListener("click", async () => {
    if (!confirm(t("confirmRemoveBackgroundImage") || "Are you sure you want to remove the background image?")) {
      return;
    }

    const draft = await ensureAppearanceDraft();
    draft.backgroundImage = null;
    draft.backgroundImageUrl = "";

    if (bgPreview) {
      bgPreview.style.backgroundImage = "";
      bgPreview.style.display = "none";
    }
    if (bgImageInput) {
      bgImageInput.value = "";
    }
    if (bgImageUrlInput) {
      bgImageUrlInput.value = "";
    }
    setBackgroundUrlStatusMessage("");

    const previewConfig = { appearance: { ...draft } };
    await applyBackground(previewConfig);
    markSettingsDirty();
  });
}

if (bgDimSlider) {
  bgDimSlider.addEventListener("input", async (e) => {
    const value = Number(e.target.value) || 0;
    if (bgDimValue) {
      bgDimValue.textContent = `${value}%`;
    }
    const dimValue = value / 100;
    document.body.style.setProperty('--bg-dim', dimValue);

    const draft = await ensureAppearanceDraft();
    draft.bgDim = dimValue;
    markSettingsDirty();
  });
}

if (resetAppearanceBtn) {
  resetAppearanceBtn.addEventListener("click", async () => {
    if (!confirm(t("confirmResetAppearance") || "Reset all appearance settings to defaults?")) {
      return;
    }

    const existingCustomWidgets = Array.isArray(appearanceDraft?.customWidgets)
      ? appearanceDraft.customWidgets
      : ((await loadConfig()).appearance?.customWidgets || []);
    const disabledCustomWidgets = existingCustomWidgets.map(w => ({ ...w, space: "disabled" }));

    appearanceDraft = createAppearanceDraftFromConfig({
      appearance: {
        ...defaultConfig.appearance,
        customWidgets: disabledCustomWidgets,
        widgetOrder: normalizeWidgetOrder(defaultConfig.appearance.widgetOrder, disabledCustomWidgets)
      }
    });
    appearancePreviewUrlCss = "";
    appearancePreviewUrlTarget = "";
    setThemeStatusMessage("");

    syncAppearanceControlsFromDraft(appearanceDraft);

    const previewConfig = { appearance: { ...appearanceDraft } };
    await applyThemeStyle(previewConfig);
    await applyBackground(previewConfig);
    await applyBgDim(previewConfig);
    await applyTileOpacity(previewConfig);
    await applyBarOpacity(previewConfig);
    await applyTileSize(previewConfig);
    await applyGroupTileSize(previewConfig);
    await applySideSpaces(previewConfig);
    updateDateTimeVisibility(true);
    await render();
    calculateGridLayout();
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

// ---------- Theme Settings ----------
async function handleApplyThemeUrlPreview() {
  const rawUrl = themeCssUrlInput ? themeCssUrlInput.value.trim() : "";
  if (!isAllowedThemeUrl(rawUrl)) {
    setThemeStatusMessage("❌ " + t("invalidThemeUrl"), true);
    return false;
  }

  if (themeCssUrlApply) {
    themeCssUrlApply.disabled = true;
  }
  setThemeStatusMessage("⏳ ...");

  try {
    const fetched = await fetchAndCacheThemeUrl(rawUrl, { saveCache: false });
    const draft = await ensureAppearanceDraft();
    draft.theme = "custom-url";
    draft.customThemeUrl = fetched.url;
    appearancePreviewUrlCss = fetched.css;
    appearancePreviewUrlTarget = fetched.url;

    if (themeSelect) {
      themeSelect.value = "custom-url";
    }
    if (themeCssUrlInput) {
      themeCssUrlInput.value = fetched.url;
    }
    updateThemeCustomRowsVisibility("custom-url");

    await applyThemeStyle(
      { appearance: { ...draft } },
      { persistCache: false, previewUrlCss: fetched.css }
    );
    setThemeStatusMessage(`✅ ${fetched.url}`);
    markSettingsDirty();
    return true;
  } catch (error) {
    const detail = error?.message === "INVALID_THEME_URL" || !error?.message
      ? t("invalidThemeUrl")
      : error.message;
    setThemeStatusMessage("❌ " + detail, true);
    return false;
  } finally {
    if (themeCssUrlApply) {
      themeCssUrlApply.disabled = false;
    }
  }
}

if (themeSelect) {
  themeSelect.addEventListener("change", async () => {
    const draft = await ensureAppearanceDraft();
    draft.theme = themeSelect.value || "default";
    updateThemeCustomRowsVisibility(draft.theme);
    setThemeStatusMessage("");

    const previewOptions = { persistCache: false };
    const currentUrl = (draft.customThemeUrl || "").trim();
    if (draft.theme === "custom-url" && appearancePreviewUrlCss && appearancePreviewUrlTarget === currentUrl) {
      previewOptions.previewUrlCss = appearancePreviewUrlCss;
    }

    await applyThemeStyle({ appearance: { ...draft } }, previewOptions);
    markSettingsDirty();
  });
}

if (themeCssFileInput) {
  themeCssFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const cssText = typeof ev.target?.result === "string" ? ev.target.result : "";
        if (!cssText.trim()) {
          setThemeStatusMessage("❌ Theme CSS file is empty", true);
          return;
        }

        const draft = await ensureAppearanceDraft();
        draft.theme = "custom-file";
        draft.customThemeCss = cssText;
        draft.customThemeFileName = file.name || "custom.css";

        if (themeSelect) {
          themeSelect.value = "custom-file";
        }
        if (themeCssFileName) {
          themeCssFileName.textContent = draft.customThemeFileName;
        }
        updateThemeCustomRowsVisibility("custom-file");

        await applyThemeStyle({ appearance: { ...draft } }, { persistCache: false });
        setThemeStatusMessage(`✅ ${draft.customThemeFileName}`);
        markSettingsDirty();
      } catch (error) {
        setThemeStatusMessage("❌ " + (error?.message || "Failed to load CSS file"), true);
        console.error("Theme CSS load error", error);
      } finally {
        themeCssFileInput.value = "";
      }
    };

    reader.onerror = () => {
      setThemeStatusMessage("❌ Failed to read CSS file", true);
      themeCssFileInput.value = "";
    };

    reader.readAsText(file);
  });
}

if (themeCssUrlApply) {
  themeCssUrlApply.addEventListener("click", () => {
    void handleApplyThemeUrlPreview();
  });
}

if (themeCssUrlInput) {
  themeCssUrlInput.addEventListener("input", () => {
    const enteredUrl = themeCssUrlInput.value.trim();
    if (appearanceDraft) {
      appearanceDraft.customThemeUrl = enteredUrl;
    }
    if (appearancePreviewUrlTarget !== enteredUrl) {
      appearancePreviewUrlCss = "";
    }
  });
  themeCssUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleApplyThemeUrlPreview();
    }
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

// ---------- Header & Footer Opacity Settings ----------
if (barOpacitySlider) {
  barOpacitySlider.addEventListener("input", (e) => {
    const value = e.target.value;
    if (barOpacityValue) {
      barOpacityValue.textContent = `${value}%`;
    }
    const opacityValue = value / 100;
    document.body.style.setProperty('--bar-opacity', opacityValue);

    if (appearanceDraft) {
      appearanceDraft.barOpacity = opacityValue;
    }
    markSettingsDirty();
  });
}

// ---------- Tile Size Settings ----------
if (tileSizeSlider) {
  tileSizeSlider.addEventListener("input", (e) => {
    const value = e.target.value;
    if (tileSizeValue) {
      tileSizeValue.textContent = `${value}%`;
    }
    const sizeValue = value / 100;
    document.body.style.setProperty('--tile-scale', sizeValue);
    calculateGridLayout();

    if (appearanceDraft) {
      appearanceDraft.tileSize = sizeValue;
    }
    markSettingsDirty();
  });
}

// ---------- Group Tile Size Settings ----------
if (groupTileSizeSlider) {
  groupTileSizeSlider.addEventListener("input", (e) => {
    const value = e.target.value;
    if (groupTileSizeValue) {
      groupTileSizeValue.textContent = `${value}%`;
    }
    const sizeValue = value / 100;
    document.body.style.setProperty('--group-tile-scale', sizeValue);
    renderGroups(true);
    calculateGridLayout();

    if (appearanceDraft) {
      appearanceDraft.groupTileSize = sizeValue;
    }
    markSettingsDirty();
  });
}

// ---------- Mass Auto Tile Color From Icon ----------
async function handleMassColorFromIconAction(enable) {
  if (massEnableColorFromIconBtn) massEnableColorFromIconBtn.disabled = true;
  if (massDisableColorFromIconBtn) massDisableColorFromIconBtn.disabled = true;
  if (massColorFromIconStatus) {
    massColorFromIconStatus.textContent = "";
    massColorFromIconStatus.style.color = "";
  }

  try {
    const result = await applyMassTileColorFromIcon(enable);
    const totalUpdated = (result?.groupsUpdated || 0) + (result?.bookmarksUpdated || 0);
    if (massColorFromIconStatus) {
      const msgKey = enable ? "massColorFromIconActivated" : "massColorFromIconDeactivated";
      massColorFromIconStatus.textContent = `✅ ${t(msgKey)} (${totalUpdated})`;
    }
  } catch (err) {
    console.error("Mass color from icon action failed", err);
    if (massColorFromIconStatus) {
      massColorFromIconStatus.textContent = `❌ ${err?.message || "Error"}`;
    }
  } finally {
    if (massEnableColorFromIconBtn) massEnableColorFromIconBtn.disabled = false;
    if (massDisableColorFromIconBtn) massDisableColorFromIconBtn.disabled = false;
  }
}

if (massEnableColorFromIconBtn) {
  massEnableColorFromIconBtn.addEventListener("click", () => {
    void handleMassColorFromIconAction(true);
  });
}

if (massDisableColorFromIconBtn) {
  massDisableColorFromIconBtn.addEventListener("click", () => {
    void handleMassColorFromIconAction(false);
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
  config.browserBookmarksAutoSync = !!browserBookmarksAutoSync?.checked;

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
  config.housekeeper.iconAutoRefreshMode = getHousekeeperIconRefreshMode();
  config.housekeeper.iconAutoRefreshHours = Math.max(1, parseInt(hkIconRefreshHours?.value, 10) || 24);

  // Save backups config
  config.backups.retentionDays = Math.max(1, parseInt(backupRetentionDays?.value, 10) || 14);
  config.backups.frequencyHours = Math.max(1, parseInt(backupFrequencyHours?.value, 10) || 24);

  // Save appearance settings
  const selectedTheme = themeSelect
    ? (themeSelect.value || "default")
    : (appearanceDraft?.theme || config.appearance.theme || "default");
  config.appearance.theme = selectedTheme;
  if (appearanceDraft) {
    config.appearance.customThemeCss = appearanceDraft.customThemeCss || "";
    config.appearance.customThemeFileName = appearanceDraft.customThemeFileName || "";
    config.appearance.customThemeUrl = themeCssUrlInput
      ? themeCssUrlInput.value.trim()
      : (appearanceDraft.customThemeUrl || "");
  } else if (themeCssUrlInput) {
    config.appearance.customThemeUrl = themeCssUrlInput.value.trim();
  }

  let themePreviewCssForSave = "";
  if (selectedTheme === "custom-url") {
    const targetUrl = (config.appearance.customThemeUrl || "").trim();
    if (!isAllowedThemeUrl(targetUrl)) {
      setThemeStatusMessage("❌ " + t("invalidThemeUrl"), true);
      if (syncStatus) syncStatus.textContent = "❌ " + t("invalidThemeUrl");
      return false;
    }

    if (appearancePreviewUrlCss && appearancePreviewUrlTarget === targetUrl) {
      themePreviewCssForSave = appearancePreviewUrlCss;
    } else {
      const cachedEntry = await getCustomThemeUrlCache();
      if (!cachedEntry || cachedEntry.url !== targetUrl || !cachedEntry.css) {
        try {
          const fetched = await fetchAndCacheThemeUrl(targetUrl, { saveCache: true });
          config.appearance.customThemeUrl = fetched.url;
          if (appearanceDraft) appearanceDraft.customThemeUrl = fetched.url;
          if (themeCssUrlInput) themeCssUrlInput.value = fetched.url;
          themePreviewCssForSave = fetched.css;
        } catch (error) {
          const detail = error?.message === "INVALID_THEME_URL" || !error?.message
            ? t("invalidThemeUrl")
            : error.message;
          setThemeStatusMessage("❌ " + detail, true);
          if (syncStatus) syncStatus.textContent = "❌ " + detail;
          return false;
        }
      }
    }
  }

  await applyThemeStyle(config, {
    persistCache: true,
    previewUrlCss: themePreviewCssForSave
  });
  appearancePreviewUrlCss = "";
  appearancePreviewUrlTarget = "";

  if (bgSizeSelect) {
    config.appearance.backgroundSize = bgSizeSelect.value || 'stretched';
  }
  if (bgDimSlider) {
    config.appearance.bgDim = (Number(bgDimSlider.value) || 0) / 100;
    await applyBgDim(config);
  }
  if (tileOpacitySlider) {
    config.appearance.tileOpacity = tileOpacitySlider.value / 100;
  }
  if (barOpacitySlider) {
    config.appearance.barOpacity = barOpacitySlider.value / 100;
    await applyBarOpacity(config);
  }
  if (tileSizeSlider) {
    config.appearance.tileSize = tileSizeSlider.value / 100;
    await applyTileSize(config);
  }
  if (groupTileSizeSlider) {
    config.appearance.groupTileSize = groupTileSizeSlider.value / 100;
    await applyGroupTileSize(config);
  }
  if (appearanceDraft) {
    config.appearance.backgroundImage = appearanceDraft.backgroundImage ?? null;
    config.appearance.backgroundImageUrl = appearanceDraft.backgroundImageUrl || "";
  }

  if (showDeletedToggle) {
    config.appearance.showDeleted = showDeletedToggle.checked;
  }

  if (groupCountToggle) {
    config.appearance.showGroupBookmarkCount = groupCountToggle.checked;
  }
  window.groupCountPreviewEnabled = null;

  if (showSideSpacesToggle) {
    config.appearance.showSideSpaces = showSideSpacesToggle.checked;
  }
  if (highlightSideSpacesToggle) {
    config.appearance.highlightSideSpaces = highlightSideSpacesToggle.checked;
  }
  if (tallBookmarkTilesToggle) {
    config.appearance.tallBookmarkTiles = tallBookmarkTilesToggle.checked;
  }
  if (clickableTagsToggle) {
    config.appearance.clickableTags = clickableTagsToggle.checked;
  }
  if (appearanceDraft) {
    config.appearance.dateTimeSpace = appearanceDraft.dateTimeSpace || "footer";
    config.appearance.showDateTime = config.appearance.dateTimeSpace !== "disabled";
    config.appearance.groupsSpace = appearanceDraft.groupsSpace || "header";
    config.appearance.searchSpace = appearanceDraft.searchSpace || "header";
    config.appearance.manageSpace = appearanceDraft.manageSpace || "header";
    config.appearance.syncStatusSpace = appearanceDraft.syncStatusSpace || "footer";
    config.appearance.bookmarksCountSpace = appearanceDraft.bookmarksCountSpace || "footer";
    config.appearance.headerSingleRow = !!appearanceDraft.headerSingleRow;
  }
  if (searchStyleSelect) {
    config.appearance.searchStyle = searchStyleSelect.value || "full";
  }
  if (appearanceDraft?.customWidgets) {
    config.appearance.customWidgets = appearanceDraft.customWidgets.map(w => ({ ...w }));
  }
  if (appearanceDraft?.widgetOrder) {
    config.appearance.widgetOrder = normalizeWidgetOrder(appearanceDraft.widgetOrder, config.appearance.customWidgets);
  }
  if (appearanceDraft?.widgetAlign) {
    config.appearance.widgetAlign = { ...appearanceDraft.widgetAlign };
  }
  if (appearanceDraft?.widgetNewRow) {
    config.appearance.widgetNewRow = { ...appearanceDraft.widgetNewRow };
  }
  await applyTileSize(config);
  await applySideSpaces(config);

  // Save advanced settings
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

  // Persist language selection on Save
  if (pendingLanguageReset) {
    await resetLanguageToBrowser({ persist: true });
    pendingLanguageReset = false;
  } else if (languageSelect?.value && (savedLanguageSnapshot?.override !== languageSelect.value || getCurrentLanguage() !== languageSelect.value)) {
    await setLanguage(languageSelect.value, { persist: true });
  }
  savedLanguageSnapshot = {
    lang: getCurrentLanguage(),
    override: getSavedLanguageOverride()
  };

  // Single save operation
  await saveConfig(config);
  await cleanupOldBackups(config.backups.retentionDays);

  // Update manual sync button visibility based on new settings
  updateManualSyncButtonVisibility(config);

  // Apply highlight setting immediately
  try {
    render();
  } catch (e) {}

  if (typeof window.applySavedDateTimeEnabled === "function") {
    window.applySavedDateTimeEnabled(config.appearance.dateTimeSpace !== "disabled");
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

      hkCleanupStatus.textContent = `✅ ${t("hkCleanupCompleted").replace("{0}", String(deletedCount))}`;
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
    hkLinkCheckStatus.textContent = `🔍 ${t("hkLinkCheckRunning")}`;
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

  // ---------- HouseKeeper - Clear Dead-Link Tags ----------
  if (hkClearErrors) {
    hkClearErrors.addEventListener('click', async () => {
      hkClearErrors.disabled = true;
      hkLinkCheckStatus.textContent = "🔄 Clearing dead-link tags...";
      hkLinkCheckStatus.style.color = "#999";

      try {
        const cleared = clearSystemTagFromAllBookmarks(SYSTEM_TAG_DEAD_LINK_ID);
        if (cleared > 0) {
          await saveSystemTags();
        }

        hkLinkCheckStatus.textContent = `✅ Cleared ${cleared} dead-link tag(s).`;
        hkLinkCheckStatus.style.color = "#4caf50";
        hkDeadLinksCount.textContent = `Dead links found: 0`;

        try { render(); } catch (e) {}
      } catch (error) {
        hkLinkCheckStatus.textContent = "❌ Clearing failed";
        hkLinkCheckStatus.style.color = "#f44336";
        console.error("Clear dead-link tags error:", error);
      } finally {
        hkClearErrors.disabled = false;
      }
    });
  }

  // ---------- HouseKeeper - Check HTTP Bookmarks ----------
  function isHttpBookmarkUrl(url) {
    if (typeof url !== "string" || !url.trim()) return false;
    try {
      return new URL(url.trim()).protocol === "http:";
    } catch {
      return false;
    }
  }

  if (hkCheckHttpBookmarks) {
    hkCheckHttpBookmarks.addEventListener("click", async () => {
      hkCheckHttpBookmarks.disabled = true;
      hkLinkCheckStatus.textContent = `🔍 ${t("checkHttpBookmarksChecking")}`;
      hkLinkCheckStatus.style.color = "#999";

      try {
        let httpCount = 0;
        let newlyTagged = 0;
        let untagged = 0;
        let changed = false;

        for (const group of (state.groups || [])) {
          if (!group || group.deleted) continue;

          for (const item of getAllGroupBookmarks(group)) {
            const isHttp = isHttpBookmarkUrl(item.url);
            if (isHttp) {
              httpCount++;
              if (setBookmarkSystemTag(item.id, SYSTEM_TAG_HTTP_ID, true)) {
                newlyTagged++;
                changed = true;
              }
            } else if (setBookmarkSystemTag(item.id, SYSTEM_TAG_HTTP_ID, false)) {
              untagged++;
              changed = true;
            }
          }
        }

        if (changed) {
          await saveSystemTags();
          try { render(); } catch (e) {}
        }

        if (httpCount === 0) {
          const baseMsg = t("checkHttpBookmarksNone");
          hkLinkCheckStatus.textContent = untagged > 0
            ? `✅ ${baseMsg} (${untagged})`
            : `✅ ${baseMsg}`;
          hkLinkCheckStatus.style.color = "#4caf50";
        } else {
          const msg = t("checkHttpBookmarksFound")
            .replace("{count}", String(httpCount))
            .replace("{tagged}", String(newlyTagged));
          hkLinkCheckStatus.textContent = `⚠️ ${msg}`;
          hkLinkCheckStatus.style.color = "#f59e0b";
        }
      } catch (error) {
        hkLinkCheckStatus.textContent = `❌ ${t("checkHttpBookmarksFailed")}`;
        hkLinkCheckStatus.style.color = "#f44336";
        console.error("Check HTTP bookmarks error:", error);
      } finally {
        hkCheckHttpBookmarks.disabled = false;
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

function formatBackupSummary(backup, type) {
  if (type === "config") {
    const themeLabel = backup.theme || "default";
    const settingCount = Number(backup.settingCount || 0);
    return `${t("themeSelect")} ${themeLabel} (${settingCount})`;
  }
  const stats = getBackupStats(backup);
  return `G:${stats.groupCount} B:${stats.bookmarkCount}`;
}

backupSubtabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const nextType = btn.dataset.backupType || "bookmarks";
    if (nextType === currentBackupTabType) return;
    currentBackupTabType = nextType;
    backupSubtabBtns.forEach(item => {
      item.classList.toggle("active", item === btn);
    });
    if (backupStatus) backupStatus.textContent = "";
    void refreshBackupsTable();
  });
});

async function refreshBackupsTable() {
  if (!backupsTableBody) return;

  const activeType = currentBackupTabType;
  const backups = await listBackups(activeType);
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
    statsCell.textContent = formatBackupSummary(backup, activeType);

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
      const entry = await createBackup(currentBackupTabType);
      const config = await loadConfig();
      await cleanupOldBackups(config.backups?.retentionDays || 14, currentBackupTabType);
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
        const entry = await getBackup(downloadFile, currentBackupTabType);
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
      const confirmKey = currentBackupTabType === "config"
        ? "confirmRestoreConfigBackup"
        : "confirmRestoreBackup";
      const confirmed = confirm(t(confirmKey));
      if (!confirmed) return;

      try {
        const result = await restoreBackup(restoreFile, currentBackupTabType);
        if (currentBackupTabType === "config" && result.config) {
          pendingLanguageReset = false;
          setSettingsDirty(false);
          await revertAppearancePreviewToSaved();
          updateDateTimeVisibility(result.config.appearance?.dateTimeSpace !== "disabled");
          await render();
          calculateGridLayout();
          if (backupStatus) {
            backupStatus.textContent = "✅ " + t("backupConfigRestored");
          }
        } else {
          await refreshBackupsTable();
          if (backupStatus) {
            backupStatus.textContent = `⚠️ ${result.warning}`;
          }
          alert(result.warning);
        }
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
        await deleteBackup(deleteFile, currentBackupTabType);
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

[hkIconRefreshAll, hkIconRefreshMissing, hkIconRefreshNone].forEach(input => {
  if (!input) return;
  input.addEventListener("change", () => {
    updateHousekeeperIconRefreshFrequencyEnabled();
    updateChoiceOptionStates();
  });
});

// open browser native extension settings in a new tab (Chromium only; hidden on Gecko/Firefox)
const openExtensionSettingsBtn = document.getElementById('open-extension-settings');
if (openExtensionSettingsBtn) {
  const isGecko = (typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function')
    || /\b(?:Firefox|Gecko)\/\d+/i.test(navigator.userAgent || '');
  if (isGecko) {
    const footer = openExtensionSettingsBtn.closest('.appearance-card-footer');
    if (footer) footer.style.display = 'none';
    openExtensionSettingsBtn.style.display = 'none';
  } else {
    openExtensionSettingsBtn.addEventListener('click', () => {
      const extensionId = chrome.runtime.id;
      const settingsUrl = `chrome://extensions/?id=${extensionId}`;
      chrome.tabs.create({ url: settingsUrl });
    });
  }
}

// button to reset language to browser default (preview until saved)
document.getElementById('reset-language-to-browser').addEventListener('click', async () => {
  pendingLanguageReset = true;
  await resetLanguageToBrowser({ persist: false });
  if (languageSelect) {
    languageSelect.value = getCurrentLanguage();
  }
  markSettingsDirty();
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
