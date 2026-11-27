import { t } from "../i18n.js";
import { sanitizeSvgDataUrl } from "../color-utils.js";
import { render, calculateGridLayout } from "../render.js";
import { applySideSpaces, applyTileSize } from "../theme.js";
import { formatBackupTimestamp } from "../backup.js";
import {
  MAX_CALENDAR_SOURCES,
  deleteWebcalSecretUrl,
  loadWebcalSecretUrl,
  normalizeCalendarSourceUrl,
  normalizeCalendarColor,
  normalizeCalendarRefreshMinutes,
  requestCalendarSourcePermission,
  fetchWebcalSource,
  getCalendarSourceCacheStatus,
  removeCalendarSourceCache,
  saveWebcalSecretUrl,
} from "../calendar-sources.js";
import {
  deleteCaldavCredentials,
  fetchCaldavSource,
  loadCaldavCredentials,
  saveCaldavCredentials,
  syncNotesRemindersToCaldav,
} from "../calendar-caldav.js";
import {
  normalizeWidgetOrder,
  moveWidgetGroupInOrder,
  buildWidgetGroupMeta,
  getWidgetGroupMemberIds,
  resolveGroupedWidgetMapValue,
  isValidCustomSearchUrlTemplate,
  isValidCustomSearchJsonTemplate,
  isValidTimeZone,
  normalizeCustomTimeZones,
  serializeCustomWidgetsExport,
  parseImportedCustomWidgets,
  stringifyAsciiJson,
  resolveCustomWidgetIcon,
  fetchCustomWidgetsFromUrl,
  applyCustomWidgetUpdate,
  revertCustomWidgetVersion,
  buildCustomSearchPreview,
  normalizeCustomWidgetVariables,
  normalizeCustomSearchRoutePrefixes,
  isValidRestEndpointUrl,
  normalizeRestRefreshSeconds,
  parseRestMetricsText,
  formatRestMetricsText,
  fetchAndEvaluateRestWidget,
  requestRestEndpointPermission,
  pollAllRestStatusWidgets,
  isValidRssFeedUrl,
  normalizeRssRefreshMinutes,
  normalizeRssMaxItems,
  requestRssFeedPermission,
  pollAllRssFeedWidgets,
  normalizeWeatherDisplaySize,
  normalizeWeatherProvider,
  normalizeWeatherUnit,
  normalizeWeatherRefreshMinutes,
  requestWeatherPermission,
  searchWeatherLocations,
  pollAllWeatherWidgets
} from "../custom-widgets.js";
import { normalizeCustomIconValue, applyCachedIconImageSrc } from "../color-utils.js";
import { loadConfig, saveConfig } from "../config.js";
import { loadSyncModule } from "../lazy-modules.js";
import { getSecret, setSecret, isEncryptedSecret, isVaultUnlocked, tryAutoUnlockVault, isInsecureHttpUrl } from "../crypto.js";
import { settingsState, markSettingsDirty } from "./context.js";
import { ensureAppearanceDraft, updateDateTimeVisibility } from "./appearance-ui.js";

const showSideSpacesToggle = document.getElementById("show-side-spaces-toggle");
const highlightSideSpacesToggle = document.getElementById("highlight-side-spaces-toggle");
const tallBookmarkTilesToggle = document.getElementById("tall-bookmark-tiles-toggle");
const clickableTagsToggle = document.getElementById("clickable-tags-toggle");
const searchStyleSelect = document.getElementById("search-style-select");
const headerSingleRowToggle = document.getElementById("header-single-row-toggle");
const widgetOrderList = document.getElementById("widget-order-list");
const customWidgetsList = document.getElementById("custom-widgets-list");
const customWidgetsFilterBar = document.getElementById("custom-widgets-filter-bar");
const customWidgetsFilterInput = document.getElementById("custom-widgets-filter-input");
const customWidgetsTypeFilter = document.getElementById("custom-widgets-type-filter");
const customWidgetIconInput = document.getElementById("custom-widget-icon");
const customWidgetCustomIconInput = document.getElementById("custom-widget-custom-icon");
const customWidgetIconUploadBtn = document.getElementById("custom-widget-icon-upload-btn");
const customWidgetIconFile = document.getElementById("custom-widget-icon-file");
const customWidgetModeSelect = document.getElementById("custom-widget-mode");
const customWidgetAddTitle = document.querySelector(".custom-widget-add-title");
const customWidgetNameInput = document.getElementById("custom-widget-name");
const customWidgetGroupField = document.getElementById("custom-widget-group-field");
const customWidgetGroupSelect = document.getElementById("custom-widget-group-select");
const customWidgetNewGroupModal = document.getElementById("custom-widget-new-group-modal");
const customWidgetNewGroupInput = document.getElementById("custom-widget-new-group-input");
const customWidgetNewGroupCreateBtn = document.getElementById("custom-widget-new-group-create-btn");
const customWidgetNewGroupCancelBtn = document.getElementById("custom-widget-new-group-cancel-btn");
const customWidgetUrlField = document.getElementById("custom-widget-url-field");
const customWidgetRoutePrefixesInput = document.getElementById("custom-widget-route-prefixes");
const customWidgetUrlInput = document.getElementById("custom-widget-url");
const customWidgetAdvancedDetails = document.getElementById("custom-widget-advanced-details");
const customWidgetSearchAdvanced = document.getElementById("custom-widget-search-advanced");
const customWidgetRestAdvanced = document.getElementById("custom-widget-rest-advanced");
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
const customWidgetRestStatusSection = document.getElementById("custom-widget-rest-status-section");
const customWidgetRestUrl = document.getElementById("custom-widget-rest-url");
const customWidgetRestMethod = document.getElementById("custom-widget-rest-method");
const customWidgetRestJsonPath = document.getElementById("custom-widget-rest-json-path");
const customWidgetRestSuffix = document.getElementById("custom-widget-rest-suffix");
const customWidgetRestInterval = document.getElementById("custom-widget-rest-interval");
const customWidgetRestOk = document.getElementById("custom-widget-rest-ok");
const customWidgetRestWarn = document.getElementById("custom-widget-rest-warn");
const customWidgetRestValueMap = document.getElementById("custom-widget-rest-value-map");
const customWidgetRestLink = document.getElementById("custom-widget-rest-link");
const customWidgetRestHeaderName = document.getElementById("custom-widget-rest-header-name");
const customWidgetRestHeaderValue = document.getElementById("custom-widget-rest-header-value");
const customWidgetRestHideGroup = document.getElementById("custom-widget-rest-hide-group");
const customWidgetRestHideValue = document.getElementById("custom-widget-rest-hide-value");
const customWidgetRestMetrics = document.getElementById("custom-widget-rest-metrics");
const customWidgetRestCollapseMetrics = document.getElementById("custom-widget-rest-collapse-metrics");
const customWidgetRestTestBtn = document.getElementById("custom-widget-rest-test-btn");
const customWidgetRestTestResult = document.getElementById("custom-widget-rest-test-result");
const customWidgetNotesSection = document.getElementById("custom-widget-notes-section");
const customWidgetNotesCompact = document.getElementById("custom-widget-notes-compact");
const customWidgetRssSection = document.getElementById("custom-widget-rss-section");
const customWidgetRssUrl = document.getElementById("custom-widget-rss-url");
const customWidgetRssRefresh = document.getElementById("custom-widget-rss-refresh");
const customWidgetRssMaxItems = document.getElementById("custom-widget-rss-max-items");
const customWidgetWeatherSection = document.getElementById("custom-widget-weather-section");
const customWidgetWeatherProvider = document.getElementById("custom-widget-weather-provider");
const customWidgetWeatherSize = document.getElementById("custom-widget-weather-size");
const customWidgetWeatherLocQuery = document.getElementById("custom-widget-weather-location-query");
const customWidgetWeatherSearchBtn = document.getElementById("custom-widget-weather-search-btn");
const customWidgetWeatherLocResults = document.getElementById("custom-widget-weather-location-results");
const customWidgetWeatherLocName = document.getElementById("custom-widget-weather-location-name");
const customWidgetWeatherLat = document.getElementById("custom-widget-weather-lat");
const customWidgetWeatherLon = document.getElementById("custom-widget-weather-lon");
const customWidgetWeatherUnit = document.getElementById("custom-widget-weather-unit");
const customWidgetWeatherRefresh = document.getElementById("custom-widget-weather-refresh");
const customWidgetWeatherApiKeyRow = document.getElementById("custom-widget-weather-apikey-row");
const customWidgetWeatherApiKey = document.getElementById("custom-widget-weather-apikey");
const customWidgetNewTabLabel = customWidgetNewTabInput?.closest(".custom-widget-newtab-label");
const customWidgetDefaultLabel = customWidgetDefaultInput?.closest(".custom-widget-default-label");
const customWidgetAddBtn = document.getElementById("custom-widget-add-btn");
const customWidgetCancelEditBtn = document.getElementById("custom-widget-cancel-edit-btn");
const openNewCustomWidgetBtn = document.getElementById("open-new-custom-widget-btn");
const customWidgetEditorModal = document.getElementById("custom-widget-editor-modal");
const customWidgetEditorStatus = document.getElementById("custom-widget-editor-status");
const customWidgetPreviewToggleBtn = document.getElementById("custom-widget-preview-toggle-btn");
const customWidgetPreviewBox = document.getElementById("custom-widget-preview-box");
const customWidgetPreviewInputs = document.getElementById("custom-widget-preview-inputs");
const customWidgetPreviewUrl = document.getElementById("custom-widget-preview-url");
const customWidgetPreviewJsonRow = document.getElementById("custom-widget-preview-json-row");
const customWidgetPreviewJson = document.getElementById("custom-widget-preview-json");
const customWidgetImportBtn = document.getElementById("custom-widget-import-btn");
const customWidgetImportFile = document.getElementById("custom-widget-import-file");
const customWidgetToggleUrlBtn = document.getElementById("custom-widget-toggle-url-btn");
const customWidgetUrlImportBox = document.getElementById("custom-widget-url-import-box");
const customWidgetSourceUrlInput = document.getElementById("custom-widget-source-url");
const customWidgetLoadUrlBtn = document.getElementById("custom-widget-load-url-btn");
const customWidgetUpdateAllBtn = document.getElementById("custom-widget-update-all-btn");
const customWidgetExportAllBtn = document.getElementById("custom-widget-export-all-btn");
const customWidgetsLibraryStatus = document.getElementById("custom-widgets-library-status");
const exportWidgetsBtn = document.getElementById("export-widgets-btn");
const importWidgetsBtn = document.getElementById("import-widgets-btn");
const widgetsExportStatus = document.getElementById("widgets-export-status");
const customWidgetStatus = customWidgetsLibraryStatus;

export function initCustomWidgetsSettings() {
  const WIDGET_REGISTRY = {
    groups: { key: "widgetGroups", fallback: "Group selector", field: "groupsSpace", defaultSpace: "header", allowDisabled: false },
    search: { key: "widgetSearch", fallback: "Search bar", field: "searchSpace", defaultSpace: "center", allowDisabled: false },
    manage: { key: "widgetManage", fallback: "Manage buttons", field: "manageSpace", defaultSpace: "header", allowDisabled: false },
    bookmarks: { key: "widgetBookmarks", fallback: "Bookmarks", field: null, defaultSpace: "center", allowDisabled: false, fixedSpace: true },
    syncStatus: { key: "widgetSyncStatus", fallback: "Sync status", field: "syncStatusSpace", defaultSpace: "footer", allowDisabled: true },
    dateTime: { key: "widgetDateTime", fallback: "Date & Time", field: "dateTimeSpace", defaultSpace: "footer", allowDisabled: true, configurable: true },
    shortcutPalette: { key: "widgetShortcutPalette", fallback: "Shortcut palette", field: "shortcutPaletteSpace", defaultSpace: "footer", allowDisabled: true },
    bookmarksCount: { key: "widgetBookmarksCount", fallback: "Bookmarks count", field: "bookmarksCountSpace", defaultSpace: "footer", allowDisabled: true },
    storageUsage: { key: "widgetStorageUsage", fallback: "Storage usage", field: "storageUsageSpace", defaultSpace: "disabled", allowDisabled: true }
  };

  const collapsedWidgetSpaceGroups = new Set();

  let systemWidgetModalListenersBound = false;
  let editingCalendarSourceId = null;
  let editingCalendarSourceType = "webcal";

  const syncCalendarFormDoneButtonState = (isFormOpen) => {
    const doneBtn = document.getElementById("system-widget-editor-done-btn");
    if (doneBtn) {
      doneBtn.classList.toggle("primary", !isFormOpen);
    }
  };

  const closeSystemWidgetEditorModal = () => {
    const modal = document.getElementById("system-widget-editor-modal");
    const form = document.getElementById("system-calendar-source-form");
    if (form && !form.classList.contains("hidden")) {
      const confirmed = window.confirm(
        t("calendarDiscardUnsavedConfirm") || "You have unsaved calendar changes. Discard them and close?",
      );
      if (!confirmed) {
        setCalendarFormStatus(t("calendarSaveOrCancelHint") || "Click Save to apply changes or Cancel to discard.", true);
        document.getElementById("system-calendar-save-btn")?.focus();
        return;
      }
      form.classList.add("hidden");
    }
    syncCalendarFormDoneButtonState(false);
    editingCalendarSourceId = null;
    editingCalendarSourceType = "webcal";
    if (modal) modal.classList.add("hidden");
  };

  const setCalendarFormStatus = (msg, isError = false) => {
    const statusEl = document.getElementById("system-calendar-form-status");
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = `status${isError ? " error" : ""}`;
  };

  const openCalendarSourceForm = (source = null, typeOverride = "webcal") => {
    const form = document.getElementById("system-calendar-source-form");
    const nameInput = document.getElementById("system-calendar-name-input");
    const colorInput = document.getElementById("system-calendar-color-input");
    const urlInput = document.getElementById("system-calendar-url-input");
    const refreshInput = document.getElementById("system-calendar-refresh-input");
    const caldavFields = document.getElementById("system-calendar-caldav-fields");
    const webcalPrivateRow = document.getElementById("system-calendar-webcal-private-row");
    const privateCheckbox = document.getElementById("system-calendar-private-checkbox");
    const userInput = document.getElementById("system-calendar-username-input");
    const passInput = document.getElementById("system-calendar-password-input");
    const syncNotesCheckbox = document.getElementById("system-calendar-sync-notes-checkbox");
    const remindersCheckbox = document.getElementById("system-calendar-reminders-checkbox");
    const hideNameCheckbox = document.getElementById("system-calendar-hide-name-checkbox");
    const encryptCacheCheckbox = document.getElementById("system-calendar-encrypt-cache-checkbox");
    if (!form || !nameInput || !colorInput || !urlInput || !refreshInput) return;

    editingCalendarSourceId = source?.id || null;
    editingCalendarSourceType = source?.type === "caldav" || typeOverride === "caldav" ? "caldav" : "webcal";
    const isCaldav = editingCalendarSourceType === "caldav";

    nameInput.value = source?.name || "";
    colorInput.value = normalizeCalendarColor(source?.color);
    urlInput.value = source?.privateUrl ? "" : (source?.url || "");
    urlInput.placeholder = isCaldav
      ? (t("calendarCaldavUrlPlaceholder") || "https://dav.example.com/calendars/user/personal/")
      : (t("calendarUrlPlaceholder") || "https://... or webcal://...ics");
    refreshInput.value = String(normalizeCalendarRefreshMinutes(source?.refreshMinutes));

    const hasEncryptCache = Boolean(source?.encryptCache);
    if (caldavFields) caldavFields.classList.toggle("hidden", !isCaldav);
    if (webcalPrivateRow) webcalPrivateRow.classList.remove("hidden");
    if (privateCheckbox) {
      privateCheckbox.checked = Boolean(source?.privateUrl) || hasEncryptCache;
      privateCheckbox.disabled = hasEncryptCache;
    }
    if (userInput) userInput.value = "";
    if (passInput) passInput.value = "";
    if (syncNotesCheckbox) {
      if (source) {
        syncNotesCheckbox.checked = Boolean(source.syncNotesReminders);
      } else {
        const hasExistingSyncTarget = (settingsState.appearanceDraft?.calendarSources || []).some(
          (s) => s?.type === "caldav" && s.syncNotesReminders,
        );
        syncNotesCheckbox.checked = !hasExistingSyncTarget;
      }
    }
    if (remindersCheckbox) {
      remindersCheckbox.checked = source
        ? (source.enableReminders !== undefined ? Boolean(source.enableReminders) : source.type === "caldav")
        : isCaldav;
    }
    if (hideNameCheckbox) {
      hideNameCheckbox.checked = Boolean(source?.hideName);
    }
    if (encryptCacheCheckbox) {
      encryptCacheCheckbox.checked = hasEncryptCache;
    }
    if (source?.privateUrl && source?.id) {
      urlInput.value = "";
      urlInput.placeholder = t("secretSavedPlaceholder") || "<secret saved>";
      void loadWebcalSecretUrl(source.id).then((res) => {
        if (editingCalendarSourceId !== source.id) return;
        if (res.locked) {
          setCalendarFormStatus("🔒 " + (t("securityStatusLocked") || "Vault locked"), true);
        }
      });
    }
    if (isCaldav && source?.id && userInput) {
      userInput.value = "";
      userInput.placeholder = t("calendarCaldavUsernamePlaceholder") || "Username";
      if (passInput) {
        passInput.value = "";
        passInput.placeholder = t("calendarCaldavPasswordPlaceholder") || "Password / App password";
      }
      void loadCaldavCredentials(source.id).then((creds) => {
        if (editingCalendarSourceId === source.id && creds) {
          const savedText = t("secretSavedPlaceholder") || "<secret saved>";
          if (creds.locked) {
            userInput.placeholder = savedText;
            if (passInput) passInput.placeholder = savedText;
            setCalendarFormStatus("🔒 " + (t("securityStatusLocked") || "Vault locked"), true);
          } else {
            if (creds.username) userInput.placeholder = savedText;
            if (passInput && creds.password) passInput.placeholder = savedText;
          }
        }
      });
    } else if (passInput) {
      passInput.placeholder = t("calendarCaldavPasswordPlaceholder") || "Password / App password";
    }

    setCalendarFormStatus("");
    form.classList.remove("hidden");
    syncCalendarFormDoneButtonState(true);
    nameInput.focus();
  };

  const renderSystemCalendarSourcesList = async () => {
    const listEl = document.getElementById("system-calendar-sources-list");
    const filterInput = document.getElementById("system-calendar-filter-input");
    if (!listEl) return;

    const draft = await ensureAppearanceDraft();
    const sources = Array.isArray(draft.calendarSources) ? draft.calendarSources : [];
    const totalCount = sources.length;
    const countBadge = document.getElementById("system-calendar-webcal-count");
    if (countBadge) {
      countBadge.textContent = `${totalCount} / ${MAX_CALENDAR_SOURCES}`;
    }
    const atLimit = totalCount >= MAX_CALENDAR_SOURCES;
    const addCalBtn = document.getElementById("system-calendar-add-btn");
    if (addCalBtn) {
      addCalBtn.disabled = atLimit;
    }
    const addCaldavBtn = document.getElementById("system-calendar-add-caldav-btn");
    if (addCaldavBtn) {
      addCaldavBtn.disabled = atLimit;
    }
    if (filterInput) {
      filterInput.classList.toggle("hidden", sources.length <= 4);
    }

    const reminderSourcesRow = document.getElementById("system-calendar-reminder-sources-row");
    const reminderTagsEl = document.getElementById("system-calendar-reminder-tags");
    if (reminderSourcesRow && reminderTagsEl) {
      reminderSourcesRow.classList.toggle("hidden", sources.length === 0);
      reminderTagsEl.replaceChildren();
      for (const src of sources) {
        const isOn = src.enableReminders !== undefined ? Boolean(src.enableReminders) : src.type === "caldav";
        const tagBtn = document.createElement("button");
        tagBtn.type = "button";
        tagBtn.className = `system-calendar-reminder-tag${isOn ? " is-active" : ""}`;
        tagBtn.setAttribute("aria-pressed", String(isOn));

        const tagDot = document.createElement("span");
        tagDot.className = "system-calendar-color-dot";
        tagDot.style.backgroundColor = normalizeCalendarColor(src.color);

        const tagLabel = document.createElement("span");
        tagLabel.textContent = src.name || (src.type === "caldav" ? "CalDAV" : "WebCAL");

        tagBtn.append(tagDot, tagLabel);
        tagBtn.addEventListener("click", async () => {
          const nextDraft = await ensureAppearanceDraft();
          nextDraft.calendarSources = (nextDraft.calendarSources || []).map((item) =>
            item.id === src.id ? { ...item, enableReminders: !isOn } : item,
          );
          markSettingsDirty();
          void renderSystemCalendarSourcesList();
        });
        reminderTagsEl.appendChild(tagBtn);
      }
    }

    const caldavSources = sources.filter((s) => s?.type === "caldav");
    const notesTargetRow = document.getElementById("system-calendar-notes-target-row");
    const notesTargetSelect = document.getElementById("system-calendar-notes-target-select");
    if (notesTargetRow && notesTargetSelect) {
      notesTargetRow.classList.toggle("hidden", caldavSources.length === 0);
      notesTargetSelect.replaceChildren();
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = t("calendarNotesSyncNone") || "None";
      notesTargetSelect.appendChild(noneOpt);
      let activeCaldavId = "";
      for (const cal of caldavSources) {
        const opt = document.createElement("option");
        opt.value = cal.id;
        opt.textContent = cal.name || "CalDAV";
        notesTargetSelect.appendChild(opt);
        if (cal.syncNotesReminders && !activeCaldavId) {
          activeCaldavId = cal.id;
        }
      }
      notesTargetSelect.value = activeCaldavId;
    }

    const query = (filterInput?.value || "").trim().toLowerCase();
    const filtered = query
      ? sources.filter((s) =>
          (s.name || "").toLowerCase().includes(query) ||
          (s.url || "").toLowerCase().includes(query))
      : sources;

    listEl.replaceChildren();
    if (filtered.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "system-calendar-empty";
      emptyEl.textContent = t("calendarNoSources") || "No calendars added yet.";
      listEl.appendChild(emptyEl);
      return;
    }

    for (const source of filtered) {
      const row = document.createElement("div");
      row.className = `system-calendar-row${source.enabled === false ? " is-disabled" : ""}`;

      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = source.enabled !== false;
      toggle.title = t("enable") || "Enable";
      toggle.addEventListener("change", async () => {
        const nextDraft = await ensureAppearanceDraft();
        const nextSources = Array.isArray(nextDraft.calendarSources) ? [...nextDraft.calendarSources] : [];
        const idx = nextSources.findIndex((s) => s.id === source.id);
        if (idx !== -1) {
          nextSources[idx] = { ...nextSources[idx], enabled: toggle.checked };
          nextDraft.calendarSources = nextSources;
          markSettingsDirty();
          void renderSystemCalendarSourcesList();
        }
      });

      const dot = document.createElement("span");
      dot.className = "system-calendar-color-dot";
      dot.style.backgroundColor = normalizeCalendarColor(source.color);

      const info = document.createElement("div");
      info.className = "system-calendar-row-info";

      const nameEl = document.createElement("span");
      nameEl.className = "system-calendar-row-name";
      nameEl.textContent = source.name || "Calendar";
      nameEl.title = source.privateUrl ? "🔒 Private URL (local only)" : (source.url || "");

      const typeBadge = document.createElement("span");
      typeBadge.className = "system-calendar-type-badge";
      typeBadge.textContent = source.type === "caldav"
        ? (source.privateUrl ? "🔒 CalDAV" : "CalDAV")
        : (source.privateUrl ? "🔒 WebCAL" : "WebCAL");

      const statusBadge = document.createElement("span");
      statusBadge.className = "system-calendar-status-badge";
      void getCalendarSourceCacheStatus(source.id).then((cached) => {
        if (!cached) return;
        if (cached.lastError) {
          statusBadge.textContent = "⚠️";
          statusBadge.title = cached.lastError;
        } else if (cached.fetchedAt) {
          statusBadge.textContent = "✓";
          statusBadge.title = new Date(cached.fetchedAt).toLocaleString();
        }
      });

      info.append(nameEl, typeBadge, statusBadge);

      const actions = document.createElement("div");
      actions.className = "system-calendar-row-actions";

      const isRemindersOn = source.enableReminders !== undefined
        ? Boolean(source.enableReminders)
        : source.type === "caldav";
      const notifyBtn = document.createElement("button");
      notifyBtn.type = "button";
      notifyBtn.className = `widget-order-btn system-calendar-sync-btn${isRemindersOn ? " is-active" : ""}`;
      notifyBtn.textContent = "🔔";
      notifyBtn.title = t("calendarEnableRemindersLabel") || "Show reminder notifications";
      notifyBtn.setAttribute("aria-pressed", String(isRemindersOn));
      notifyBtn.addEventListener("click", async () => {
        const nextDraft = await ensureAppearanceDraft();
        nextDraft.calendarSources = (nextDraft.calendarSources || []).map((s) =>
          s.id === source.id ? { ...s, enableReminders: !isRemindersOn } : s,
        );
        markSettingsDirty();
        void renderSystemCalendarSourcesList();
      });
      actions.appendChild(notifyBtn);

      if (source.type === "caldav") {
        const isSyncTarget = Boolean(source.syncNotesReminders);
        const syncNotesBtn = document.createElement("button");
        syncNotesBtn.type = "button";
        syncNotesBtn.className = `widget-order-btn system-calendar-sync-btn${isSyncTarget ? " is-active" : ""}`;
        syncNotesBtn.textContent = "📝";
        syncNotesBtn.title = t("calendarCaldavSyncNotesLabel") || "Sync Notepad reminders to this CalDAV calendar";
        syncNotesBtn.setAttribute("aria-pressed", String(isSyncTarget));
        syncNotesBtn.addEventListener("click", async () => {
          const nextDraft = await ensureAppearanceDraft();
          const nextValue = !isSyncTarget;
          nextDraft.calendarSources = (nextDraft.calendarSources || []).map((s) => {
            if (s.type !== "caldav") return s;
            return {
              ...s,
              syncNotesReminders: s.id === source.id ? nextValue : false,
            };
          });
          markSettingsDirty();
          void renderSystemCalendarSourcesList();
        });
        actions.appendChild(syncNotesBtn);
      }

      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "widget-order-btn";
      refreshBtn.textContent = "🔄";
      refreshBtn.title = t("refresh") || "Refresh";
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        let targetUrl = source.url;
        if (source.privateUrl) {
          const secretRes = await loadWebcalSecretUrl(source.id);
          targetUrl = secretRes.ok ? secretRes.value : "";
        }
        const granted = targetUrl ? await requestCalendarSourcePermission(targetUrl) : false;
        if (granted) {
          if (source.type === "caldav") {
            await fetchCaldavSource(source, { force: true });
            if (source.syncNotesReminders) {
              await syncNotesRemindersToCaldav().catch(() => {});
            }
          } else {
            await fetchWebcalSource(source, { force: true });
          }
        }
        refreshBtn.disabled = false;
        void renderSystemCalendarSourcesList();
      });

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "widget-order-btn";
      editBtn.textContent = "✏️";
      editBtn.title = t("edit") || "Edit";
      editBtn.addEventListener("click", () => {
        openCalendarSourceForm(source, source.type || "webcal");
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "widget-order-btn";
      deleteBtn.textContent = "🗑️";
      deleteBtn.title = t("delete") || "Delete";
      deleteBtn.addEventListener("click", async () => {
        const nextDraft = await ensureAppearanceDraft();
        nextDraft.calendarSources = (nextDraft.calendarSources || []).filter((s) => s.id !== source.id);
        markSettingsDirty();
        await removeCalendarSourceCache(source.id);
        if (source.type === "caldav") {
          await deleteCaldavCredentials(source.id);
        } else if (source.privateUrl) {
          await deleteWebcalSecretUrl(source.id);
        }
        if (editingCalendarSourceId === source.id) {
          document.getElementById("system-calendar-source-form")?.classList.add("hidden");
          syncCalendarFormDoneButtonState(false);
          editingCalendarSourceId = null;
          editingCalendarSourceType = "webcal";
        }
        void renderSystemCalendarSourcesList();
      });

      actions.append(refreshBtn, editBtn, deleteBtn);
      row.append(toggle, dot, info, actions);
      listEl.appendChild(row);
    }
  };

  const ensureSystemWidgetModalListeners = () => {
    if (systemWidgetModalListenersBound) return;
    const modal = document.getElementById("system-widget-editor-modal");
    const doneBtn = document.getElementById("system-widget-editor-done-btn");
    const addCalBtn = document.getElementById("system-calendar-add-btn");
    const addCaldavBtn = document.getElementById("system-calendar-add-caldav-btn");
    const cancelCalBtn = document.getElementById("system-calendar-cancel-btn");
    const saveCalBtn = document.getElementById("system-calendar-save-btn");
    const filterInput = document.getElementById("system-calendar-filter-input");

    if (doneBtn) {
      doneBtn.addEventListener("click", closeSystemWidgetEditorModal);
    }
    if (addCalBtn) {
      addCalBtn.addEventListener("click", () => openCalendarSourceForm(null, "webcal"));
    }
    if (addCaldavBtn) {
      addCaldavBtn.addEventListener("click", () => openCalendarSourceForm(null, "caldav"));
    }
    if (cancelCalBtn) {
      cancelCalBtn.addEventListener("click", () => {
        document.getElementById("system-calendar-source-form")?.classList.add("hidden");
        syncCalendarFormDoneButtonState(false);
        editingCalendarSourceId = null;
        editingCalendarSourceType = "webcal";
        setCalendarFormStatus("");
      });
    }
    if (filterInput) {
      filterInput.addEventListener("input", () => {
        void renderSystemCalendarSourcesList();
      });
    }
    const notesTargetSelect = document.getElementById("system-calendar-notes-target-select");
    if (notesTargetSelect) {
      notesTargetSelect.addEventListener("change", async () => {
        const selectedId = notesTargetSelect.value || "";
        const nextDraft = await ensureAppearanceDraft();
        nextDraft.calendarSources = (nextDraft.calendarSources || []).map((s) => {
          if (s.type !== "caldav") return s;
          return { ...s, syncNotesReminders: s.id === selectedId };
        });
        markSettingsDirty();
        void renderSystemCalendarSourcesList();
      });
    }
    const formEncryptCacheCheckbox = document.getElementById("system-calendar-encrypt-cache-checkbox");
    const formPrivateCheckbox = document.getElementById("system-calendar-private-checkbox");
    if (formEncryptCacheCheckbox && formPrivateCheckbox) {
      formEncryptCacheCheckbox.addEventListener("change", () => {
        if (formEncryptCacheCheckbox.checked) {
          formPrivateCheckbox.checked = true;
          formPrivateCheckbox.disabled = true;
        } else {
          formPrivateCheckbox.disabled = false;
        }
      });
    }
    if (saveCalBtn) {
      saveCalBtn.addEventListener("click", async () => {
        const nameInput = document.getElementById("system-calendar-name-input");
        const colorInput = document.getElementById("system-calendar-color-input");
        const urlInput = document.getElementById("system-calendar-url-input");
        const refreshInput = document.getElementById("system-calendar-refresh-input");
        const userInput = document.getElementById("system-calendar-username-input");
        const passInput = document.getElementById("system-calendar-password-input");
        const syncNotesCheckbox = document.getElementById("system-calendar-sync-notes-checkbox");
        const remindersCheckbox = document.getElementById("system-calendar-reminders-checkbox");
        const hideNameCheckbox = document.getElementById("system-calendar-hide-name-checkbox");
        const encryptCacheCheckbox = document.getElementById("system-calendar-encrypt-cache-checkbox");
        const privateCheckbox = document.getElementById("system-calendar-private-checkbox");
        const isCaldav = editingCalendarSourceType === "caldav";
        const isEncryptCache = Boolean(encryptCacheCheckbox?.checked);
        const isPrivateUrl = Boolean(privateCheckbox?.checked) || isEncryptCache;
        let normalizedUrl = normalizeCalendarSourceUrl(urlInput?.value || "");
        let keepExistingPrivateUrl = false;
        if (!normalizedUrl && editingCalendarSourceId && !(urlInput?.value || "").trim()) {
          const existingSecret = await loadWebcalSecretUrl(editingCalendarSourceId);
          if (existingSecret.ok && existingSecret.value) {
            normalizedUrl = existingSecret.value;
            keepExistingPrivateUrl = true;
          } else if (existingSecret.locked) {
            setCalendarFormStatus("🔒 " + (t("securityStatusLocked") || "Vault locked"), true);
            return;
          }
        }
        if (!normalizedUrl) {
          setCalendarFormStatus(t("calendarInvalidUrl") || "Please enter a valid http(s):// or webcal:// URL.", true);
          return;
        }
        if (!keepExistingPrivateUrl && isInsecureHttpUrl(normalizedUrl)) {
          const confirmed = window.confirm(
            t("insecureHttpCalendarConfirm") ||
              "Warning: This URL uses unencrypted HTTP (not HTTPS). Calendar data and credentials will be sent unencrypted over the network.\n\nContinue anyway?",
          );
          if (!confirmed) {
            setCalendarFormStatus(`❌ ${t("insecureHttpAuthWarning") || "HTTP URL sends data unencrypted."}`, true);
            return;
          }
        }

        if (isPrivateUrl || isEncryptCache) {
          const cfg = await loadConfig();
          if (!cfg?.vaultHeader?.check) {
            setCalendarFormStatus("🔒 " + (t("securityStatusNotSet") || "Set up the Secrets Vault in the Security tab first."), true);
            return;
          }
          if (!isVaultUnlocked()) {
            await tryAutoUnlockVault(cfg.vaultHeader);
          }
          if (!isVaultUnlocked() && typeof window.promptUnlockVault === "function") {
            await window.promptUnlockVault();
          }
          if (!isVaultUnlocked()) {
            setCalendarFormStatus("🔒 " + (t("securityStatusLocked") || "Vault locked"), true);
            return;
          }
        } else if (isCaldav) {
          const cfg = await loadConfig();
          if (cfg?.vaultHeader?.check && !isVaultUnlocked()) {
            await tryAutoUnlockVault(cfg.vaultHeader);
            if (!isVaultUnlocked() && typeof window.promptUnlockVault === "function") {
              await window.promptUnlockVault();
            }
            if (!isVaultUnlocked()) {
              setCalendarFormStatus("🔒 " + (t("securityStatusLocked") || "Vault locked"), true);
              return;
            }
          }
        }

        saveCalBtn.disabled = true;
        setCalendarFormStatus(t("loading") || "Checking feed...");
        const granted = await requestCalendarSourcePermission(normalizedUrl);
        if (!granted) {
          saveCalBtn.disabled = false;
          setCalendarFormStatus(t("calendarPermissionDenied") || "Host permission is required to fetch this calendar.", true);
          return;
        }

        const draft = await ensureAppearanceDraft();
        const existingSources = Array.isArray(draft.calendarSources) ? [...draft.calendarSources] : [];
        if (!editingCalendarSourceId && existingSources.length >= MAX_CALENDAR_SOURCES) {
          saveCalBtn.disabled = false;
          setCalendarFormStatus(`Maximum of ${MAX_CALENDAR_SOURCES} calendars reached.`, true);
          return;
        }

        const sourceId = editingCalendarSourceId || `${isCaldav ? "caldav" : "webcal"}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const entry = {
          id: sourceId,
          type: isCaldav ? "caldav" : "webcal",
          name: (nameInput?.value || "").trim() || (isCaldav ? "CalDAV" : "WebCAL"),
          url: isPrivateUrl ? "" : normalizedUrl,
          privateUrl: isPrivateUrl,
          color: normalizeCalendarColor(colorInput?.value),
          enabled: true,
          refreshMinutes: normalizeCalendarRefreshMinutes(refreshInput?.value),
          enableReminders: remindersCheckbox ? Boolean(remindersCheckbox.checked) : isCaldav,
          hideName: Boolean(hideNameCheckbox?.checked),
          encryptCache: isEncryptCache,
          syncNotesReminders: isCaldav ? Boolean(syncNotesCheckbox?.checked) : false,
        };

        let prevCaldavSecretEntry = undefined;
        let hadPrevCaldavSecret = false;
        if (isCaldav) {
          if (editingCalendarSourceId && typeof chrome !== "undefined" && chrome.storage?.local) {
            const prevStored = await chrome.storage.local.get("myspeeddial-calendar-secrets");
            const prevMap = prevStored?.["myspeeddial-calendar-secrets"];
            if (prevMap && typeof prevMap === "object" && Object.prototype.hasOwnProperty.call(prevMap, sourceId)) {
              hadPrevCaldavSecret = true;
              prevCaldavSecretEntry = prevMap[sourceId];
            }
          }
          await saveCaldavCredentials(sourceId, {
            username: userInput?.value || "",
            password: passInput?.value || "",
          });
        }

        const testEntry = isPrivateUrl ? { ...entry, privateUrl: false, url: normalizedUrl } : entry;
        const testRes = isCaldav
          ? await fetchCaldavSource(testEntry, { force: true })
          : await fetchWebcalSource(testEntry, { force: true });
        if (!testRes.ok) {
          if (isCaldav) {
            if (!editingCalendarSourceId) {
              await deleteCaldavCredentials(sourceId);
            } else if (typeof chrome !== "undefined" && chrome.storage?.local) {
              const curStored = await chrome.storage.local.get("myspeeddial-calendar-secrets");
              const curMap = curStored?.["myspeeddial-calendar-secrets"] && typeof curStored["myspeeddial-calendar-secrets"] === "object"
                ? { ...curStored["myspeeddial-calendar-secrets"] }
                : {};
              if (hadPrevCaldavSecret) {
                curMap[sourceId] = prevCaldavSecretEntry;
              } else {
                delete curMap[sourceId];
              }
              await chrome.storage.local.set({ "myspeeddial-calendar-secrets": curMap });
            }
          }
          saveCalBtn.disabled = false;
          setCalendarFormStatus(testRes.error || "Failed to fetch calendar.", true);
          return;
        }
        if (isPrivateUrl || isEncryptCache) {
          await saveWebcalSecretUrl(sourceId, normalizedUrl);
        } else if (editingCalendarSourceId) {
          await deleteWebcalSecretUrl(sourceId);
        }

        if (entry.syncNotesReminders) {
          for (let i = 0; i < existingSources.length; i += 1) {
            if (existingSources[i].id !== entry.id && existingSources[i].syncNotesReminders) {
              existingSources[i] = { ...existingSources[i], syncNotesReminders: false };
            }
          }
        }
        const existingIdx = existingSources.findIndex((s) => s.id === entry.id);
        if (existingIdx !== -1) {
          entry.enabled = existingSources[existingIdx].enabled !== false;
          existingSources[existingIdx] = entry;
        } else {
          existingSources.push(entry);
        }
        draft.calendarSources = existingSources;
        markSettingsDirty();

        saveCalBtn.disabled = false;
        document.getElementById("system-calendar-source-form")?.classList.add("hidden");
        syncCalendarFormDoneButtonState(false);
        editingCalendarSourceId = null;
        editingCalendarSourceType = "webcal";
        setCalendarFormStatus("");
        void renderSystemCalendarSourcesList();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
        const unlockModal = document.getElementById("vault-unlock-modal");
        if (unlockModal && !unlockModal.classList.contains("hidden")) return;
        e.stopPropagation();
        closeSystemWidgetEditorModal();
      }
    }, true);
    systemWidgetModalListenersBound = true;
  };

  const openSystemWidgetEditorModal = (widgetKey) => {
    const builtInDef = WIDGET_REGISTRY[widgetKey];
    if (!builtInDef) return;
    ensureSystemWidgetModalListeners();
    const modal = document.getElementById("system-widget-editor-modal");
    if (!modal) return;
    const titleEl = document.getElementById("system-widget-editor-title");
    if (titleEl) {
      titleEl.textContent = (builtInDef.key ? t(builtInDef.key) : "") || builtInDef.fallback;
    }
    const dateTimeFields = document.getElementById("system-widget-datetime-fields");
    if (dateTimeFields) {
      dateTimeFields.classList.toggle("hidden", widgetKey !== "dateTime");
    }
    if (widgetKey === "dateTime") {
      const weekSelect = document.getElementById("calendar-week-start-select");
      if (weekSelect) {
        weekSelect.value = settingsState.appearanceDraft?.calendarWeekStartsOn === "sunday" ? "sunday" : "monday";
        weekSelect.focus();
      }
      void renderSystemCalendarSourcesList();
    }
    modal.classList.remove("hidden");
  };

  const bindCollapsibleGroupToggle = (containerEl, headerEl, chevronEl, collapsedSet, key) => {
    const isCollapsed = collapsedSet.has(key);
    containerEl.classList.toggle("collapsed", isCollapsed);
    chevronEl.textContent = isCollapsed ? "▸" : "▾";
    headerEl.setAttribute("role", "button");
    headerEl.tabIndex = 0;
    headerEl.setAttribute("aria-expanded", String(!isCollapsed));

    const toggle = () => {
      const nextCollapsed = !collapsedSet.has(key);
      if (nextCollapsed) {
        collapsedSet.add(key);
      } else {
        collapsedSet.delete(key);
      }
      containerEl.classList.toggle("collapsed", nextCollapsed);
      chevronEl.textContent = nextCollapsed ? "▸" : "▾";
      headerEl.setAttribute("aria-expanded", String(!nextCollapsed));
    };

    headerEl.addEventListener("click", toggle);
    headerEl.addEventListener("keydown", e => {
      if (e.target instanceof Element && e.target !== headerEl && e.target.closest("button")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  };

  const renderWidgetOrderList = (appearance = null) => {
    if (!widgetOrderList) return;
    const resolvedAppearance = appearance || settingsState.appearanceDraft || {};
    const customWidgets = Array.isArray(resolvedAppearance.customWidgets) ? resolvedAppearance.customWidgets : [];
    const customWidgetMap = new Map(customWidgets.filter(w => w?.id).map(w => [w.id, w]));
    const { membersByGroupKey, groupKeyById, anchorByGroupKey } = buildWidgetGroupMeta(customWidgets);
    const customGroupByRepId = new Map();
    const groupSpaceByKey = new Map();
    const secondaryCustomIds = new Set();
    for (const [gKey, members] of membersByGroupKey.entries()) {
      const displayRep =
        members.find(m => !m.disabled && m.isDefault) ||
        members.find(m => !m.disabled) ||
        anchorByGroupKey.get(gKey) ||
        members[0];
      if (!displayRep) continue;
      const gName = typeof displayRep.groupName === "string" && displayRep.groupName.trim()
        ? displayRep.groupName.trim()
        : (members[0].groupName || "").trim();
      customGroupByRepId.set(displayRep.id, {
        groupName: gName,
        members,
        representative: displayRep
      });
      const spaceDonor = members.find(m => m.isDefault) || members[0];
      const resolvedGroupSpace = ["disabled", "header", "left", "center", "right", "footer"].includes(spaceDonor?.space)
        ? spaceDonor.space
        : "header";
      groupSpaceByKey.set(gKey, resolvedGroupSpace);
      for (const m of members) {
        if (m.id !== displayRep.id) secondaryCustomIds.add(m.id);
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
    const getWidgetSpaceForKey = (key) => {
      const builtInDef = WIDGET_REGISTRY[key];
      const customDef = customWidgetMap.get(key);
      if (customDef) {
        const gKey = groupKeyById.get(key);
        if (gKey && groupSpaceByKey.has(gKey)) {
          return groupSpaceByKey.get(gKey);
        }
        return ["disabled", "header", "left", "center", "right", "footer"].includes(customDef.space)
          ? customDef.space
          : "header";
      }
      if (key === "dateTime") {
        return (resolvedAppearance.dateTimeSpace === "disabled" || resolvedAppearance.showDateTime === false)
          ? "disabled"
          : (resolvedAppearance.dateTimeSpace || builtInDef.defaultSpace);
      }
      return builtInDef?.field ? (resolvedAppearance[builtInDef.field] || builtInDef.defaultSpace) : (builtInDef?.defaultSpace || "center");
    };
    const spaceKeyBuckets = {
      header: [],
      left: [],
      center: [],
      right: [],
      footer: [],
      disabled: []
    };
    for (const key of visibleOrder) {
      const sp = getWidgetSpaceForKey(key);
      const bk = spaceKeyBuckets[sp] ? sp : "right";
      spaceKeyBuckets[bk].push(key);
    }
    visibleOrder.forEach((key) => {
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
        ? getWidgetSpaceForKey(key)
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
        spaceControl.name = `widget-space-${key}`;
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
            const memberIds = new Set(getWidgetGroupMemberIds(key, draft.customWidgets));
            draft.customWidgets = (draft.customWidgets || []).map(w => {
              if (!memberIds.has(w.id)) return w;
              const prevActive = (w.space && w.space !== "disabled") ? w.space : (w.lastActiveSpace || "right");
              return {
                ...w,
                space: spaceControl.value,
                lastActiveSpace: spaceControl.value !== "disabled" ? spaceControl.value : prevActive
              };
            });
          } else {
            draft[def.field] = spaceControl.value;
            if (key === "dateTime") {
              draft.showDateTime = spaceControl.value !== "disabled";
              updateDateTimeVisibility(draft.showDateTime);
            }
          }
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });

        alignControl = document.createElement("select");
        alignControl.name = `widget-align-${key}`;
        alignControl.className = "appearance-select widget-order-align-select";
        alignControl.setAttribute("aria-label", `${nameEl.textContent} align`);
        ["auto", "top", "bottom", "left", "right", "center"].forEach(alignVal => {
          const opt = document.createElement("option");
          opt.value = alignVal;
          opt.setAttribute("data-i18n", alignKeyMap[alignVal]);
          opt.textContent = alignLabels[alignVal] || alignVal;
          alignControl.appendChild(opt);
        });
        const resolvedAlign = resolveGroupedWidgetMapValue(widgetAlign, key, customWidgets);
        alignControl.value = alignKeyMap[resolvedAlign] ? resolvedAlign : "auto";
        alignControl.addEventListener("change", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          const nextAlign = { ...(draft.widgetAlign || {}) };
          for (const memberId of getWidgetGroupMemberIds(key, draft.customWidgets)) {
            nextAlign[memberId] = alignControl.value;
          }
          draft.widgetAlign = nextAlign;
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
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
        const isNewRow = !!resolveGroupedWidgetMapValue(widgetNewRow, key, customWidgets);
        newRowBtn.className = `widget-order-btn widget-newrow-btn${isNewRow ? " active" : ""}`;
        newRowBtn.textContent = "↵";
        newRowBtn.title = t("widgetNewRowTitle") || "Start on new row";
        newRowBtn.setAttribute("aria-pressed", String(isNewRow));
        newRowBtn.addEventListener("click", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          const nextVal = !resolveGroupedWidgetMapValue(draft.widgetNewRow, key, draft.customWidgets);
          const nextNewRow = { ...(draft.widgetNewRow || {}) };
          for (const memberId of getWidgetGroupMemberIds(key, draft.customWidgets)) {
            nextNewRow[memberId] = nextVal;
          }
          draft.widgetNewRow = nextNewRow;
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });
        actions.appendChild(newRowBtn);
      }

      const bucketKey = spaceBuckets[currentSpace] ? currentSpace : "right";
      const sameSpaceKeys = spaceKeyBuckets[bucketKey] || [];
      const spaceIdx = sameSpaceKeys.indexOf(key);

      const moveWithinSpace = async (delta) => {
        const targetIdx = spaceIdx + delta;
        if (spaceIdx === -1 || targetIdx < 0 || targetIdx >= sameSpaceKeys.length) return;
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        draft.widgetOrder = moveWidgetGroupInOrder(
          draft.widgetOrder,
          key,
          sameSpaceKeys[targetIdx],
          draft.customWidgets
        );
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      };

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "widget-order-btn";
      upBtn.textContent = "↑";
      upBtn.title = t("moveWidgetUp") || "Move up";
      upBtn.disabled = spaceIdx <= 0;
      upBtn.addEventListener("click", () => { void moveWithinSpace(-1); });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "widget-order-btn";
      downBtn.textContent = "↓";
      downBtn.title = t("moveWidgetDown") || "Move down";
      downBtn.disabled = spaceIdx === -1 || spaceIdx >= sameSpaceKeys.length - 1;
      downBtn.addEventListener("click", () => { void moveWithinSpace(1); });

      let editSystemBtn = null;
      if (builtInDef?.configurable) {
        editSystemBtn = document.createElement("button");
        editSystemBtn.type = "button";
        editSystemBtn.className = "widget-order-btn";
        editSystemBtn.textContent = "✏️";
        editSystemBtn.title = t("edit") || "Edit";
        editSystemBtn.setAttribute("aria-label", t("edit") || "Edit");
        editSystemBtn.addEventListener("click", () => {
          openSystemWidgetEditorModal(key);
        });
      }

      actions.append(upBtn, downBtn);
      const rowNodes = [nameEl];
      if (editSystemBtn) rowNodes.push(editSystemBtn);
      rowNodes.push(spaceControl);
      if (alignControl) rowNodes.push(alignControl);
      rowNodes.push(actions);
      row.append(...rowNodes);
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

      const titleWrap = document.createElement("span");
      titleWrap.className = "widget-space-group-title";
      const chevronSpan = document.createElement("span");
      chevronSpan.className = "widget-space-group-chevron";
      const labelSpan = document.createElement("span");
      if (spaceKeyMap[spaceKey]) {
        labelSpan.setAttribute("data-i18n", spaceKeyMap[spaceKey]);
      }
      labelSpan.textContent = spaceLabels[spaceKey] || spaceKey;
      titleWrap.append(chevronSpan, labelSpan);

      const countSpan = document.createElement("span");
      countSpan.className = "widget-space-group-count";
      countSpan.textContent = String(rows.length);
      headerEl.append(titleWrap, countSpan);
      bindCollapsibleGroupToggle(groupEl, headerEl, chevronSpan, collapsedWidgetSpaceGroups, spaceKey);

      const itemsEl = document.createElement("div");
      itemsEl.className = "widget-space-group-items";
      rows.forEach(r => itemsEl.appendChild(r));

      groupEl.append(headerEl, itemsEl);
      widgetOrderList.appendChild(groupEl);
    }
    renderCustomWidgetsList(resolvedAppearance);
  };

  const collapsedCustomWidgetGroups = new Set();

  const closeAllWidgetMoreMenus = (exceptMenu = null) => {
    if (!customWidgetsList) return;
    customWidgetsList.querySelectorAll(".custom-widget-more-menu:not(.hidden)").forEach(menu => {
      if (menu !== exceptMenu) menu.classList.add("hidden");
    });
  };
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest(".custom-widget-more-wrap")) {
      closeAllWidgetMoreMenus();
    }
  });

  const formatCompactWidgetSubtitle = (rawText) => {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (!trimmed) return "";
    try {
      const parsed = new URL(trimmed.replace(/\{[a-zA-Z0-9_-]+\}/g, "query"));
      const pathPart = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
      return `${parsed.host}${pathPart}`;
    } catch {
      return trimmed;
    }
  };

  const createCustomWidgetSpacePill = (targetWidgetIds, currentSpace, defaultActiveSpace = "right") => {
    const targetIds = new Set(Array.isArray(targetWidgetIds) ? targetWidgetIds : [targetWidgetIds]);
    const validSpaces = ["disabled", "header", "left", "center", "right", "footer"];
    const resolvedSpace = validSpaces.includes(currentSpace) ? currentSpace : "header";
    const isDisabled = resolvedSpace === "disabled";
    const spaceLabels = {
      disabled: t("spaceDisabled") || "Disabled",
      header: t("spaceHeader") || "Header",
      left: t("spaceLeft") || "Left space",
      center: t("spaceCenter") || "Center space",
      right: t("spaceRight") || "Right space",
      footer: t("spaceFooter") || "Footer"
    };
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `custom-widget-space-pill${isDisabled ? " is-disabled" : ""}`;
    const labelText = spaceLabels[resolvedSpace] || resolvedSpace;
    pill.textContent = labelText;
    pill.title = `${labelText} — click to ${isDisabled ? "enable" : "disable"} (change placement in Appearance → Widgets)`;
    pill.setAttribute("aria-pressed", String(!isDisabled));
    pill.addEventListener("click", async (e) => {
      e.stopPropagation();
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      const nextDisabled = !isDisabled;
      draft.customWidgets = (draft.customWidgets || []).map(w => {
        if (!targetIds.has(w.id)) return w;
        if (!nextDisabled) {
          const restoreSpace = (w.lastActiveSpace && w.lastActiveSpace !== "disabled") ? w.lastActiveSpace : defaultActiveSpace;
          return { ...w, space: restoreSpace, lastActiveSpace: restoreSpace };
        }
        const activeSpace = (validSpaces.includes(w.space) && w.space !== "disabled")
          ? w.space
          : ((w.lastActiveSpace && w.lastActiveSpace !== "disabled") ? w.lastActiveSpace : defaultActiveSpace);
        return { ...w, space: "disabled", lastActiveSpace: activeSpace };
      });
      renderWidgetOrderList(draft);
      renderCustomWidgetsList(draft);
      await applySideSpaces({ appearance: draft });
      await render();
      calculateGridLayout();
    });
    return pill;
  };

  if (customWidgetsFilterInput) {
    let customWidgetsFilterTimer = 0;
    customWidgetsFilterInput.addEventListener("input", () => {
      clearTimeout(customWidgetsFilterTimer);
      customWidgetsFilterTimer = setTimeout(() => {
        customWidgetsFilterTimer = 0;
        renderCustomWidgetsList(settingsState.appearanceDraft);
      }, 120);
    });
  }
  if (customWidgetsTypeFilter) {
    customWidgetsTypeFilter.addEventListener("change", () => {
      renderCustomWidgetsList(settingsState.appearanceDraft);
    });
  }

  const renderCustomWidgetsList = (appearance = null) => {
    if (!customWidgetsList) return;
    const customList = Array.isArray(appearance?.customWidgets) ? appearance.customWidgets : [];
    customWidgetsList.innerHTML = "";
    if (customWidgetsFilterBar) {
      customWidgetsFilterBar.classList.toggle("hidden", customList.length === 0);
    }
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

    const filterQuery = (customWidgetsFilterInput?.value || "").trim().toLowerCase();
    const filterType = customWidgetsTypeFilter?.value || "all";
    const groupSpaceByKey = new Map();
    for (const w of customList) {
      const gName = typeof w?.groupName === "string" ? w.groupName.trim() : "";
      if (!gName) continue;
      const gKey = `${w.type || "custom-search"}:${gName.toLowerCase()}`;
      const existing = groupSpaceByKey.get(gKey);
      if (!existing || w.isDefault) {
        groupSpaceByKey.set(gKey, w.space || "header");
      }
    }
    const filteredList = customList.filter(w => {
      if (!w?.id) return false;
      const wType = w.type || "custom-search";
      const gName = typeof w.groupName === "string" ? w.groupName.trim() : "";
      const effSpace = gName ? groupSpaceByKey.get(`${wType}:${gName.toLowerCase()}`) : w.space;
      if (filterType === "disabled") {
        if (effSpace !== "disabled") return false;
      } else if (filterType !== "all" && wType !== filterType) {
        return false;
      }
      if (filterQuery) {
        const haystack = [w.name, gName, w.urlTemplate, w.endpointUrl, w.sourceUrl]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(filterQuery)) return false;
      }
      return true;
    });

    if (filteredList.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "custom-widgets-empty";
      emptyEl.textContent = t("customWidgetsFilterEmpty") || "No matching widgets.";
      customWidgetsList.appendChild(emptyEl);
      return;
    }

    const createDisabledStatusDot = () => {
      const dot = document.createElement("span");
      dot.className = "custom-widget-disabled-dot";
      const label = t("spaceDisabled") || "Disabled";
      dot.title = label;
      dot.setAttribute("aria-label", label);
      return dot;
    };

    const getGroupRepId = (members) => {
      const enabledMembers = (members || []).filter(m => !m?.disabled);
      const pool = enabledMembers.length > 0 ? enabledMembers : (members || []);
      const first = pool[0];
      if (!first) return null;
      if (!first.type || first.type === "custom-search") {
        return (pool.find(m => m?.isDefault) || first).id;
      }
      return first.id;
    };

    const transferGroupRepPlacement = (draft, oldRepId, newRepId) => {
      if (!oldRepId || !newRepId || oldRepId === newRepId) return;
      if (Array.isArray(draft.widgetOrder)) {
        const oldOrderIdx = draft.widgetOrder.indexOf(oldRepId);
        if (oldOrderIdx !== -1) {
          const nextOrder = draft.widgetOrder.filter(id => id !== newRepId);
          const replacedIdx = nextOrder.indexOf(oldRepId);
          if (replacedIdx !== -1) {
            nextOrder[replacedIdx] = newRepId;
          }
          draft.widgetOrder = nextOrder;
        }
      }
      if (draft.widgetAlign && Object.prototype.hasOwnProperty.call(draft.widgetAlign, oldRepId)) {
        draft.widgetAlign = { ...draft.widgetAlign, [newRepId]: draft.widgetAlign[oldRepId] };
        delete draft.widgetAlign[oldRepId];
      }
      if (draft.widgetNewRow && Object.prototype.hasOwnProperty.call(draft.widgetNewRow, oldRepId)) {
        draft.widgetNewRow = { ...draft.widgetNewRow, [newRepId]: draft.widgetNewRow[oldRepId] };
        delete draft.widgetNewRow[oldRepId];
      }
    };

    const buildCustomWidgetLibraryRow = (
      customDef,
      effectiveSpace = customDef?.space,
      { insideGroup = false, groupMembers = null, memberIndex = -1 } = {}
    ) => {
      const isDisabled = effectiveSpace === "disabled" || !!customDef?.disabled;
      const row = document.createElement("div");
      row.className = `widget-order-item custom-widget-library-item${isDisabled ? " is-disabled" : ""}`;

      const { emoji, customIcon } = resolveCustomWidgetIcon(customDef);
      const iconWrap = document.createElement("span");
      iconWrap.className = "custom-search-icon";
      if (customIcon) {
        const img = document.createElement("img");
        img.className = "widget-order-icon-img";
        applyCachedIconImageSrc(img, customIcon);
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
      info.addEventListener("click", () => {
        loadCustomWidgetIntoForm(customDef);
        openCustomWidgetEditorModal();
      });
      const titleEl = document.createElement("div");
      titleEl.className = "custom-widget-library-name";
      titleEl.textContent = customDef.name || customDef.id;
      if (isDisabled) {
        titleEl.appendChild(createDisabledStatusDot());
      }
      const isTimezone = customDef.type === "timezone";
      const isRestStatus = customDef.type === "rest-status";
      const isNotes = customDef.type === "notes";
      const isRssFeed = customDef.type === "rss-feed";
      const isWeather = customDef.type === "weather";
      const isNonSearch = isTimezone || isRestStatus || isNotes || isRssFeed || isWeather;
      const tzList = isTimezone ? normalizeCustomTimeZones(customDef.timeZones) : [];
      const badge = document.createElement("span");
      badge.className = "custom-widget-mode-badge";
      badge.textContent = isWeather
        ? (customDef.displaySize || "small").toUpperCase()
        : (isRssFeed
          ? "RSS"
          : (isNotes
            ? "📝"
            : (isRestStatus
              ? "REST"
              : (isTimezone
                ? `🕒 ${tzList.length}`
                : (customDef.mode === "json" ? "JSON" : "Simple")))));
      titleEl.appendChild(badge);
      const groupName = !isNonSearch && typeof customDef.groupName === "string" ? customDef.groupName.trim() : "";
      if (groupName && !insideGroup) {
        const groupBadge = document.createElement("span");
        groupBadge.className = "custom-widget-group-badge";
        groupBadge.textContent = groupName;
        titleEl.appendChild(groupBadge);
      }
      const routePrefixes = !isNonSearch ? normalizeCustomSearchRoutePrefixes(customDef.routePrefixes) : [];
      if (routePrefixes.length > 0) {
        const routeBadge = document.createElement("span");
        routeBadge.className = "custom-widget-route-badge";
        routeBadge.textContent = `🔀 ${routePrefixes.join(", ")}`;
        routeBadge.title = `${t("customSearchAutoRoutedBadge") || "Auto-routed"}: ${routePrefixes.join(", ")}`;
        titleEl.appendChild(routeBadge);
      }
      if (customDef.sourceUrl) {
        const isLocked = !!customDef.lockSourceUpdates;
        const srcBadge = document.createElement("button");
        srcBadge.type = "button";
        srcBadge.className = `custom-widget-mode-badge custom-widget-source-toggle${isLocked ? " is-locked" : ""}`;
        srcBadge.textContent = isLocked ? "🚫🌐" : "🌐";
        srcBadge.title = isLocked
          ? `${customDef.sourceUrl} — ${t("customWidgetUrlUpdatesBlocked") || "URL updates blocked (click to allow)"}`
          : `${customDef.sourceUrl} — ${t("customWidgetUrlUpdatesAllowed") || "Click to block URL updates"}`;
        srcBadge.setAttribute("aria-pressed", String(isLocked));
        srcBadge.addEventListener("click", async (e) => {
          e.stopPropagation();
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          draft.customWidgets = (draft.customWidgets || []).map(w => {
            if (w.id !== customDef.id) return w;
            const nextLocked = !w.lockSourceUpdates;
            if (nextLocked) {
              return { ...w, lockSourceUpdates: true };
            }
            const { lockSourceUpdates: _ignored, ...rest } = w;
            return rest;
          });
          renderCustomWidgetsList(draft);
        });
        titleEl.appendChild(srcBadge);
      }

      const urlEl = document.createElement("div");
      urlEl.className = "custom-widget-library-url";
      const rawSubtitle = isWeather
        ? (customDef.locationName || `${customDef.latitude}, ${customDef.longitude}`)
        : (isRssFeed
          ? (customDef.feedUrl || "")
          : (isNotes
          ? (customDef.compactMode ? (t("customNotesCompactMode") || "Compact button only") : (t("customWidgetModeNotes") || "Notes / Scratchpad"))
          : (isRestStatus
            ? (customDef.endpointUrl || "")
            : (isTimezone
              ? tzList.map(z => `${z.label} (${z.timeZone})`).join(", ")
              : (customDef.urlTemplate || "")))));
      urlEl.textContent = (isNotes || isTimezone) ? rawSubtitle : formatCompactWidgetSubtitle(rawSubtitle);
      if (rawSubtitle) {
        urlEl.title = rawSubtitle;
      }
      info.append(titleEl, urlEl);

      const actions = document.createElement("div");
      actions.className = "widget-order-actions";

      if (groupName) {
        const gKey = groupName.toLowerCase();
        const groupHasRouting = customList.some(
          w => w && w.type !== "timezone"
            && (typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "") === gKey
            && normalizeCustomSearchRoutePrefixes(w.routePrefixes).length > 0
        );
        const autoRouteDefaultActive = groupHasRouting && appearance?.customSearchAutoRouteDefaults?.[gKey] !== false;
        const isWidgetDefaultActive = !!customDef.isDefault && !autoRouteDefaultActive;

        const defaultBtn = document.createElement("button");
        defaultBtn.type = "button";
        defaultBtn.className = "widget-order-btn custom-widget-default-btn";
        if (isWidgetDefaultActive) {
          defaultBtn.classList.add("active");
        }
        defaultBtn.textContent = isWidgetDefaultActive ? "★" : "☆";
        defaultBtn.title = t("customSearchSetDefaultTitle") || "Set as default in group";
        defaultBtn.addEventListener("click", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          const targetGroupKey = groupName.trim().toLowerCase();
          draft.customWidgets = (draft.customWidgets || []).map(w => {
            if (w?.type === "custom-search" && (typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "") === targetGroupKey) {
              return { ...w, isDefault: w.id === customDef.id };
            }
            return w;
          });
          draft.customSearchAutoRouteDefaults = {
            ...(draft.customSearchAutoRouteDefaults || {}),
            [gKey]: false
          };
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });
        actions.appendChild(defaultBtn);
      }

      if (insideGroup && Array.isArray(groupMembers)) {
        const toggleDisabledBtn = document.createElement("button");
        toggleDisabledBtn.type = "button";
        toggleDisabledBtn.className = `widget-order-btn${customDef.disabled ? " active" : ""}`;
        toggleDisabledBtn.textContent = customDef.disabled ? "🚫" : "👁️";
        toggleDisabledBtn.title = customDef.disabled
          ? (t("enableWidget") || "Enable widget")
          : (t("disableWidget") || "Disable widget");
        toggleDisabledBtn.setAttribute("aria-pressed", String(!!customDef.disabled));
        toggleDisabledBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          const oldRepId = getGroupRepId(groupMembers);
          const groupSpace = effectiveSpace || (groupMembers.find(m => m?.isDefault) || groupMembers[0])?.space;
          const nextDisabled = !customDef.disabled;
          draft.customWidgets = (draft.customWidgets || []).map(w =>
            w?.id === customDef.id
              ? { ...w, disabled: nextDisabled, ...(groupSpace ? { space: groupSpace } : {}) }
              : w
          );
          const nextGroupMembers = groupMembers.map(m =>
            m?.id === customDef.id ? { ...m, disabled: nextDisabled } : m
          );
          const newRepId = getGroupRepId(nextGroupMembers);
          transferGroupRepPlacement(draft, oldRepId, newRepId);
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });
        actions.appendChild(toggleDisabledBtn);
      }

      if (insideGroup && Array.isArray(groupMembers) && groupMembers.length > 1 && memberIndex !== -1) {
        const moveInGroup = async (delta) => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          const list = Array.isArray(draft.customWidgets) ? [...draft.customWidgets] : [];
          const memberIds = groupMembers.map(m => m.id);
          const posInGroup = memberIds.indexOf(customDef.id);
          const targetPosInGroup = posInGroup + delta;
          if (posInGroup < 0 || targetPosInGroup < 0 || targetPosInGroup >= memberIds.length) return;
          const sourceIdx = list.findIndex(w => w?.id === customDef.id);
          const targetIdx = list.findIndex(w => w?.id === memberIds[targetPosInGroup]);
          if (sourceIdx === -1 || targetIdx === -1) return;

          const oldRepId = getGroupRepId(groupMembers);
          [list[sourceIdx], list[targetIdx]] = [list[targetIdx], list[sourceIdx]];
          const nextGroupMembers = [...groupMembers];
          [nextGroupMembers[posInGroup], nextGroupMembers[targetPosInGroup]] = [
            nextGroupMembers[targetPosInGroup],
            nextGroupMembers[posInGroup]
          ];
          const newRepId = getGroupRepId(nextGroupMembers);
          transferGroupRepPlacement(draft, oldRepId, newRepId);

          draft.customWidgets = list;
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        };

        const moveUpBtn = document.createElement("button");
        moveUpBtn.type = "button";
        moveUpBtn.className = "widget-order-btn";
        moveUpBtn.textContent = "↑";
        moveUpBtn.title = t("moveUp") || "Move up";
        moveUpBtn.disabled = memberIndex === 0;
        moveUpBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void moveInGroup(-1);
        });

        const moveDownBtn = document.createElement("button");
        moveDownBtn.type = "button";
        moveDownBtn.className = "widget-order-btn";
        moveDownBtn.textContent = "↓";
        moveDownBtn.title = t("moveDown") || "Move down";
        moveDownBtn.disabled = memberIndex === groupMembers.length - 1;
        moveDownBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void moveInGroup(1);
        });

        actions.append(moveUpBtn, moveDownBtn);
      }

      if (!(typeof customDef.groupName === "string" && customDef.groupName.trim())) {
        actions.appendChild(createCustomWidgetSpacePill(
          customDef.id,
          customDef.space,
          (customDef.type === "rss-feed" || customDef.type === "rest-status" || customDef.type === "weather") ? "left" : "right"
        ));
      }

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "widget-order-btn";
      editBtn.textContent = "✏️";
      editBtn.title = t("edit") || "Edit";
      editBtn.addEventListener("click", () => {
        loadCustomWidgetIntoForm(customDef);
        openCustomWidgetEditorModal();
      });

      const moreWrap = document.createElement("div");
      moreWrap.className = "custom-widget-more-wrap";

      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "widget-order-btn custom-widget-more-btn";
      moreBtn.textContent = "⋯";
      moreBtn.title = t("moreActions") || "More actions";
      moreBtn.setAttribute("aria-haspopup", "menu");

      const moreMenu = document.createElement("div");
      moreMenu.className = "custom-widget-more-menu hidden";
      moreMenu.setAttribute("role", "menu");

      const addMenuItem = (label, onClick, { danger = false } = {}) => {
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = `custom-widget-more-item${danger ? " danger" : ""}`;
        itemBtn.setAttribute("role", "menuitem");
        itemBtn.textContent = label;
        itemBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          moreMenu.classList.add("hidden");
          await onClick();
        });
        moreMenu.appendChild(itemBtn);
      };

      addMenuItem(`📋 ${t("customSearchDuplicateWidgetTitle") || "Duplicate"}`, async () => {
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
        if ("authHeaderValue" in cloned) cloned.authHeaderValue = "";
        if ("apiKey" in cloned) cloned.apiKey = "";
        draft.customWidgets = [...(draft.customWidgets || []), cloned];
        draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), cloned.id], draft.customWidgets);
        renderWidgetOrderList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      });

      addMenuItem(`📥 ${t("exportWidgetTitle") || "Export"}`, () => {
        const slug = (customDef.name || "widget").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "widget";
        exportCustomWidgetsLibrary([customDef], `simple-dial-widget-${slug}`, customWidgetStatus);
      });

      if (customDef.sourceUrl && !customDef.lockSourceUpdates) {
        addMenuItem(`🔄 ${t("customSearchUpdateWidgetTitle") || "Update from URL"}`, async () => {
          await updateSingleCustomWidgetFromUrl(customDef.id);
        });
      }

      if (customDef.previousVersion) {
        addMenuItem(`↩️ ${t("customSearchRevertWidgetTitle") || "Revert"}`, async () => {
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
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
          if (customWidgetsLibraryStatus) {
            customWidgetsLibraryStatus.textContent = "↩️ " + (t("customSearchRevertedSuccess") || "Reverted to previous version (click Save to persist).");
          }
        });
      }

      addMenuItem(`🗑️ ${t("deleteWidgetTitle") || "Delete"}`, async () => {
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
      }, { danger: true });

      moreBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const wasHidden = moreMenu.classList.contains("hidden");
        closeAllWidgetMoreMenus(moreMenu);
        moreMenu.classList.toggle("hidden", !wasHidden);
      });

      moreWrap.append(moreBtn, moreMenu);
      actions.append(editBtn, moreWrap);
      row.append(iconWrap, info, actions);
      return row;
    };

    const entries = [];
    const groupMap = new Map();
    for (const customDef of filteredList) {
      if (!customDef?.id) continue;
      const isTimezone = customDef.type === "timezone";
      const groupName = typeof customDef.groupName === "string" ? customDef.groupName.trim() : "";
      if (!groupName) {
        entries.push({ kind: "single", widget: customDef });
        continue;
      }
      const key = `${customDef.type || "custom-search"}:${groupName.toLowerCase()}`;
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

      const groupKey = entry.groupName.toLowerCase();
      const groupRep = entry.members.find(m => m?.isDefault) || entry.members[0];
      const isGroupDisabled = groupRep?.space === "disabled";
      const groupCard = document.createElement("div");
      groupCard.className = `custom-widget-group-card${isGroupDisabled ? " is-disabled" : ""}`;

      const groupHeader = document.createElement("div");
      groupHeader.className = "custom-widget-group-header";

      const groupTitle = document.createElement("div");
      groupTitle.className = "custom-widget-group-title";
      const chevronSpan = document.createElement("span");
      chevronSpan.className = "widget-space-group-chevron";
      const groupNameSpan = document.createElement("span");
      groupNameSpan.textContent = `📁 ${entry.groupName}`;
      const countBadge = document.createElement("span");
      countBadge.className = "custom-widget-group-count";
      countBadge.textContent = String(entry.members.length);
      groupTitle.append(chevronSpan, groupNameSpan, countBadge);
      if (isGroupDisabled) {
        groupTitle.appendChild(createDisabledStatusDot());
      }

      const groupPrefixes = entry.members.flatMap(m => normalizeCustomSearchRoutePrefixes(m?.routePrefixes));
      let autoRouteIconEditor = null;
      if (groupPrefixes.length > 0) {
        const autoRouteBadge = document.createElement("span");
        autoRouteBadge.className = "custom-widget-route-badge";
        autoRouteBadge.textContent = `🔀 ${t("customSearchAutoRoutedBadge")}`;
        autoRouteBadge.title = groupPrefixes.join(", ");
        groupTitle.appendChild(autoRouteBadge);

        const currentAutoRouteIcon = typeof appearance?.customSearchAutoRouteIcons?.[groupKey] === "string"
          ? appearance.customSearchAutoRouteIcons[groupKey].trim()
          : "";
        const autoRouteIconBtn = document.createElement("button");
        autoRouteIconBtn.type = "button";
        autoRouteIconBtn.className = "widget-order-btn custom-widget-autoroute-icon-btn";
        autoRouteIconBtn.title = t("customSearchAutoRouteIconTitle") || "Set Auto-route icon";
        const customAutoImgUrl = normalizeCustomIconValue(currentAutoRouteIcon, { allowEmoji: false });
        if (customAutoImgUrl) {
          const iconImg = document.createElement("img");
          iconImg.className = "widget-order-icon-img";
          applyCachedIconImageSrc(iconImg, customAutoImgUrl);
          iconImg.alt = "";
          iconImg.addEventListener("error", () => {
            autoRouteIconBtn.textContent = "🔀";
          }, { once: true });
          autoRouteIconBtn.appendChild(iconImg);
        } else {
          autoRouteIconBtn.textContent = currentAutoRouteIcon || "🔀";
        }

        autoRouteIconEditor = document.createElement("div");
        autoRouteIconEditor.className = "custom-widget-autoroute-icon-editor hidden";

        const iconInput = document.createElement("input");
        iconInput.type = "text";
        iconInput.name = `autoroute-icon-${groupKey}`;
        iconInput.className = "sync-compact-input custom-widget-autoroute-icon-input";
        iconInput.value = currentAutoRouteIcon;
        iconInput.placeholder = t("customSearchAutoRouteIconPlaceholder") || "Emoji or image URL (default: 🔀)";

        const uploadBtn = document.createElement("button");
        uploadBtn.type = "button";
        uploadBtn.className = "icon-btn";
        uploadBtn.textContent = "🖼️";
        uploadBtn.title = t("customSearchUploadIconTitle") || "Upload icon image";
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.name = `autoroute-icon-file-${groupKey}`;
        fileInput.accept = "image/*";
        fileInput.style.display = "none";
        uploadBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          fileInput.value = "";
          fileInput.click();
        });
        fileInput.addEventListener("change", (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          readWidgetIconFile(file, (dataUrl) => {
            iconInput.value = dataUrl;
          });
        });

        const applyAutoRouteIcon = async (nextRaw) => {
          const trimmed = (nextRaw || "").trim();
          const normalized = trimmed ? normalizeCustomIconValue(trimmed, { allowEmoji: true }) : "";
          if (trimmed && !normalized) {
            if (customWidgetsLibraryStatus) {
              customWidgetsLibraryStatus.textContent = "❌ " + (t("customSearchInvalidIcon") || "Enter a valid icon URL or upload an image.");
            }
            return;
          }
          if (customWidgetsLibraryStatus) customWidgetsLibraryStatus.textContent = "";
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          const nextIcons = { ...(draft.customSearchAutoRouteIcons || {}) };
          if (normalized) {
            nextIcons[groupKey] = normalized;
          } else {
            delete nextIcons[groupKey];
          }
          draft.customSearchAutoRouteIcons = nextIcons;
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        };

        const saveIconBtn = document.createElement("button");
        saveIconBtn.type = "button";
        saveIconBtn.className = "icon-btn primary";
        saveIconBtn.textContent = t("save") || "Save";
        saveIconBtn.addEventListener("click", () => applyAutoRouteIcon(iconInput.value));

        const resetIconBtn = document.createElement("button");
        resetIconBtn.type = "button";
        resetIconBtn.className = "icon-btn";
        resetIconBtn.textContent = "✖️";
        resetIconBtn.title = t("clear") || "Clear";
        resetIconBtn.addEventListener("click", () => applyAutoRouteIcon(""));

        autoRouteIconEditor.append(iconInput, uploadBtn, fileInput, saveIconBtn, resetIconBtn);

        autoRouteIconBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const isHidden = autoRouteIconEditor.classList.toggle("hidden");
          if (!isHidden) iconInput.focus();
        });

        const isAutoRouteDefault = appearance?.customSearchAutoRouteDefaults?.[groupKey] !== false;
        const autoRouteDefaultBtn = document.createElement("button");
        autoRouteDefaultBtn.type = "button";
        autoRouteDefaultBtn.className = `widget-order-btn custom-widget-default-btn${isAutoRouteDefault ? " active" : ""}`;
        autoRouteDefaultBtn.textContent = isAutoRouteDefault ? "★" : "☆";
        autoRouteDefaultBtn.title = t("customSearchAutoRouteSetDefaultTitle") || "Set Auto-route as default in group";
        autoRouteDefaultBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          draft.customSearchAutoRouteDefaults = {
            ...(draft.customSearchAutoRouteDefaults || {}),
            [groupKey]: true
          };
          renderWidgetOrderList(draft);
          renderCustomWidgetsList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        });
        groupTitle.append(autoRouteIconBtn, autoRouteDefaultBtn);
      }

      const groupActions = document.createElement("div");
      groupActions.className = "custom-widget-group-actions";
      const fullGroupMembers = customList.filter(w =>
        w
        && typeof w.groupName === "string"
        && w.groupName.trim().toLowerCase() === groupKey
        && (w.type === "rest-status") === (groupRep?.type === "rest-status")
        && (w.type === "rss-feed") === (groupRep?.type === "rss-feed")
      );
      const effectiveGroupMembers = fullGroupMembers.length > 0 ? fullGroupMembers : entry.members;

      const groupSpacePill = createCustomWidgetSpacePill(
        effectiveGroupMembers.map(m => m.id),
        groupRep?.space,
        (groupRep?.type === "rss-feed" || groupRep?.type === "rest-status") ? "left" : "right"
      );

      const renameGroupBtn = document.createElement("button");
      renameGroupBtn.type = "button";
      renameGroupBtn.className = "widget-order-btn";
      renameGroupBtn.textContent = "✏️";
      renameGroupBtn.title = t("rename") || "Rename group";
      renameGroupBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const entered = prompt(t("customWidgetsRenameGroupPrompt") || "New group name:", entry.groupName);
        if (entered === null) return;
        const nextName = entered.trim();
        if (!nextName || nextName === entry.groupName) return;
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const memberIds = new Set(effectiveGroupMembers.map(m => m.id));
        draft.customWidgets = (draft.customWidgets || []).map(w =>
          memberIds.has(w.id) ? { ...w, groupName: nextName } : w
        );
        const nextKey = nextName.toLowerCase();
        if (nextKey !== groupKey) {
          if (draft.customSearchAutoRouteDefaults && Object.prototype.hasOwnProperty.call(draft.customSearchAutoRouteDefaults, groupKey)) {
            draft.customSearchAutoRouteDefaults[nextKey] = draft.customSearchAutoRouteDefaults[groupKey];
            delete draft.customSearchAutoRouteDefaults[groupKey];
          }
          if (draft.customSearchAutoRouteIcons && Object.prototype.hasOwnProperty.call(draft.customSearchAutoRouteIcons, groupKey)) {
            draft.customSearchAutoRouteIcons[nextKey] = draft.customSearchAutoRouteIcons[groupKey];
            delete draft.customSearchAutoRouteIcons[groupKey];
          }
        }
        renderWidgetOrderList(draft);
        renderCustomWidgetsList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      });

      const exportGroupBtn = document.createElement("button");
      exportGroupBtn.type = "button";
      exportGroupBtn.className = "widget-order-btn";
      exportGroupBtn.textContent = "📥";
      exportGroupBtn.title = t("customWidgetsExportGroupBtn") || "Export group";
      exportGroupBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const slug = entry.groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
        exportCustomWidgetsLibrary(effectiveGroupMembers, `simple-dial-group-${slug}`, customWidgetsLibraryStatus);
      });

      const deleteGroupBtn = document.createElement("button");
      deleteGroupBtn.type = "button";
      deleteGroupBtn.className = "widget-order-btn danger";
      deleteGroupBtn.textContent = "🗑️";
      deleteGroupBtn.title = t("delete") || "Delete group";
      deleteGroupBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete group "${entry.groupName}" and all ${effectiveGroupMembers.length} widgets in it?`)) return;
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const memberIds = new Set(effectiveGroupMembers.map(m => m.id));
        draft.customWidgets = (draft.customWidgets || []).filter(w => !memberIds.has(w.id));
        draft.widgetOrder = normalizeWidgetOrder(
          (draft.widgetOrder || []).filter(id => !memberIds.has(id)),
          draft.customWidgets
        );
        for (const id of memberIds) {
          if (draft.widgetAlign) delete draft.widgetAlign[id];
          if (draft.widgetNewRow) delete draft.widgetNewRow[id];
        }
        renderWidgetOrderList(draft);
        renderCustomWidgetsList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
      });

      groupActions.append(groupSpacePill, renameGroupBtn, exportGroupBtn, deleteGroupBtn);
      groupHeader.append(groupTitle, groupActions);
      bindCollapsibleGroupToggle(groupCard, groupHeader, chevronSpan, collapsedCustomWidgetGroups, groupKey);

      const membersWrap = document.createElement("div");
      membersWrap.className = "custom-widget-group-members";
      entry.members.forEach((member, idx) => {
        membersWrap.appendChild(buildCustomWidgetLibraryRow(member, groupRep?.space, {
          insideGroup: true,
          groupMembers: entry.members,
          memberIndex: idx
        }));
      });

      groupCard.appendChild(groupHeader);
      if (autoRouteIconEditor) {
        groupCard.appendChild(autoRouteIconEditor);
      }
      groupCard.appendChild(membersWrap);
      customWidgetsList.appendChild(groupCard);
    }
  };
  window.renderCustomWidgetsList = renderCustomWidgetsList;
  window.renderWidgetOrderList = renderWidgetOrderList;

  let editingCustomWidgetId = null;
  let lockedEncryptedRestToken = "";
  let lockedEncryptedWeatherApiKey = "";
  let customWidgetVarsDraft = [{ key: "query", label: "Search", type: "text", optionsText: "" }];

  const updateRestAuthWarningBadge = (hasLockedToken = false) => {
    const warnEl = document.querySelector(".custom-widget-rest-auth-warning");
    if (!warnEl) return;
    const hasToken = hasLockedToken || !!(customWidgetRestHeaderValue?.value || "").trim() || !!lockedEncryptedRestToken;
    const httpWarn = hasToken && isInsecureHttpUrl(customWidgetRestUrl?.value)
      ? ` ⚠️ ${t("insecureHttpAuthWarning") || "HTTP URL sends credentials unencrypted."}`
      : "";
    if (hasLockedToken) {
      warnEl.classList.remove("is-encrypted");
      warnEl.textContent = "🔒 " + (t("customRestAuthLockedWarning") || "Token is encrypted, but vault is locked. Unlock in Security tab to view or change it.") + httpWarn;
      return;
    }
    if (isVaultUnlocked()) {
      warnEl.classList.add("is-encrypted");
      warnEl.textContent = "🔒 " + (t("customRestAuthEncryptedInfo") || "Vault unlocked: token is encrypted locally (never backed up, exported, or synced; re-enter after restore).") + httpWarn;
    } else {
      warnEl.classList.remove("is-encrypted");
      warnEl.textContent = "⚠️ " + (t("customRestAuthWarning") || "Experimental: header tokens stay local only (never backed up, exported, or synced; re-enter after restore). Enable Vault in Security tab to encrypt.") + httpWarn;
    }
  };
  customWidgetRestUrl?.addEventListener("input", () => updateRestAuthWarningBadge(!!lockedEncryptedRestToken));
  customWidgetRestHeaderValue?.addEventListener("input", () => updateRestAuthWarningBadge(!!lockedEncryptedRestToken));
  let customWidgetTzDraft = [
    { label: "UTC", timeZone: "UTC" },
    { label: "New York", timeZone: "America/New_York" }
  ];

  const ensureTimeZoneDatalistPopulated = () => {
    if (!customWidgetTzDatalist || customWidgetTzDatalist.children.length > 0) return;
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
  };

  const renderCustomWidgetTzEditor = () => {
    if (!customWidgetTzList) return;
    ensureTimeZoneDatalistPopulated();
    customWidgetTzList.innerHTML = "";
    customWidgetTzDraft.forEach((tzItem, idx) => {
      const row = document.createElement("div");
      row.className = "custom-widget-tz-row";

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.name = `tz-label-${idx}`;
      labelInput.className = "sync-compact-input custom-widget-tz-label-input";
      labelInput.value = tzItem.label || "";
      labelInput.placeholder = t("customTzLabelPlaceholder") || "Label (e.g. New York)";
      labelInput.addEventListener("input", () => {
        tzItem.label = labelInput.value;
      });

      const zoneInput = document.createElement("input");
      zoneInput.type = "text";
      zoneInput.name = `tz-zone-${idx}`;
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

  let lastSelectedWidgetGroup = "";

  const renderCustomWidgetGroupSelect = (selectedValue = null) => {
    if (!customWidgetGroupSelect) return;
    const mode = customWidgetModeSelect?.value || "simple";
    if (mode === "timezone" || mode === "notes") {
      customWidgetGroupSelect.innerHTML = "";
      customWidgetGroupSelect.classList.add("hidden");
      return;
    }
    const targetCategory = mode === "rest-status" ? "rest-status" : (mode === "rss-feed" ? "rss-feed" : "search");
    const list = Array.isArray(settingsState.appearanceDraft?.customWidgets)
      ? settingsState.appearanceDraft.customWidgets
      : [];
    const seen = new Map();
    for (const w of list) {
      if (!w) continue;
      if (w.type === "timezone" || w.type === "notes" || w.type === "weather") continue;
      const wCategory = w.type === "rest-status" ? "rest-status" : (w.type === "rss-feed" ? "rss-feed" : "search");
      if (wCategory !== targetCategory) continue;
      const name = typeof w.groupName === "string" ? w.groupName.trim() : "";
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }

    const desiredRaw = selectedValue !== null
      ? String(selectedValue).trim()
      : (customWidgetGroupSelect.value === "__create__" ? lastSelectedWidgetGroup : customWidgetGroupSelect.value.trim());
    if (desiredRaw && desiredRaw !== "__create__" && !seen.has(desiredRaw.toLowerCase())) {
      seen.set(desiredRaw.toLowerCase(), desiredRaw);
    }

    const groupNames = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    customWidgetGroupSelect.innerHTML = "";

    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = `— ${t("customSearchGroupPlaceholder") || "Group (optional)"} —`;
    customWidgetGroupSelect.appendChild(placeholderOpt);

    let matchedValue = "";
    const desiredKey = desiredRaw.toLowerCase();
    for (const groupName of groupNames) {
      const opt = document.createElement("option");
      opt.value = groupName;
      opt.textContent = groupName;
      if (desiredKey && groupName.toLowerCase() === desiredKey) {
        matchedValue = groupName;
      }
      customWidgetGroupSelect.appendChild(opt);
    }

    const createOpt = document.createElement("option");
    createOpt.value = "__create__";
    createOpt.textContent = "+ Create New Group...";
    customWidgetGroupSelect.appendChild(createOpt);

    customWidgetGroupSelect.value = matchedValue;
    lastSelectedWidgetGroup = matchedValue;
    customWidgetGroupSelect.classList.remove("hidden");
  };

  const closeNewWidgetGroupModal = ({ restorePrevious = true } = {}) => {
    if (customWidgetNewGroupModal) {
      customWidgetNewGroupModal.classList.add("hidden");
    }
    if (restorePrevious && customWidgetGroupSelect) {
      customWidgetGroupSelect.value = lastSelectedWidgetGroup || "";
    }
  };

  const confirmNewWidgetGroupModal = () => {
    const entered = (customWidgetNewGroupInput?.value || "").trim();
    if (!entered) {
      customWidgetNewGroupInput?.focus();
      return;
    }
    closeNewWidgetGroupModal({ restorePrevious: false });
    renderCustomWidgetGroupSelect(entered);
  };

  if (customWidgetGroupSelect) {
    customWidgetGroupSelect.addEventListener("change", () => {
      if (customWidgetGroupSelect.value === "__create__") {
        if (customWidgetNewGroupInput) customWidgetNewGroupInput.value = "";
        customWidgetNewGroupModal?.classList.remove("hidden");
        customWidgetNewGroupInput?.focus();
        return;
      }
      lastSelectedWidgetGroup = customWidgetGroupSelect.value || "";
    });
  }
  customWidgetNewGroupCreateBtn?.addEventListener("click", confirmNewWidgetGroupModal);
  customWidgetNewGroupCancelBtn?.addEventListener("click", () => closeNewWidgetGroupModal({ restorePrevious: true }));
  customWidgetNewGroupInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      confirmNewWidgetGroupModal();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeNewWidgetGroupModal({ restorePrevious: true });
    }
  });
  customWidgetNewGroupModal?.addEventListener("click", (ev) => {
    if (ev.target === customWidgetNewGroupModal) {
      closeNewWidgetGroupModal({ restorePrevious: true });
    }
  });

  const syncCustomWidgetModeUI = () => {
    const mode = customWidgetModeSelect?.value || "simple";
    const isJson = mode === "json";
    const isTimezone = mode === "timezone";
    const isRestStatus = mode === "rest-status";
    const isNotes = mode === "notes";
    const isRssFeed = mode === "rss-feed";
    const isWeather = mode === "weather";
    const isNonSearch = isTimezone || isRestStatus || isNotes || isRssFeed || isWeather;

    if (customWidgetAddTitle) {
      if (editingCustomWidgetId) {
        customWidgetAddTitle.setAttribute("data-i18n", "customWidgetEditTitle");
        customWidgetAddTitle.textContent = t("customWidgetEditTitle") || "Edit Custom Widget";
      } else {
        const titleKey = isWeather
          ? "customWeatherAddTitle"
          : (isRssFeed
            ? "customRssAddTitle"
            : (isNotes
              ? "customNotesAddTitle"
              : (isRestStatus
                ? "customRestAddTitle"
                : (isTimezone ? "customTzAddTitle" : "customSearchAddTitle"))));
        const titleFallback = isWeather
          ? "Add Weather Widget"
          : (isRssFeed
            ? "Add RSS / Atom Feed Widget"
            : (isNotes
              ? "Add Notes / Scratchpad Widget"
              : (isRestStatus
                ? "Add REST / JSON Status Widget"
                : (isTimezone ? "Add Time Zone Widget" : "Add Custom Search Widget"))));
        customWidgetAddTitle.setAttribute("data-i18n", titleKey);
        customWidgetAddTitle.textContent = t(titleKey) || titleFallback;
      }
    }

    if (customWidgetJsonRow) {
      customWidgetJsonRow.classList.toggle("hidden", !isJson);
    }
    if (customWidgetTimezoneSection) {
      customWidgetTimezoneSection.classList.toggle("hidden", !isTimezone);
    }
    if (customWidgetRestStatusSection) {
      customWidgetRestStatusSection.classList.toggle("hidden", !isRestStatus);
    }
    if (customWidgetNotesSection) {
      customWidgetNotesSection.classList.toggle("hidden", !isNotes);
    }
    if (customWidgetRssSection) {
      customWidgetRssSection.classList.toggle("hidden", !isRssFeed);
    }
    if (customWidgetWeatherSection) {
      customWidgetWeatherSection.classList.toggle("hidden", !isWeather);
    }
    if (customWidgetWeatherApiKeyRow && customWidgetWeatherProvider) {
      customWidgetWeatherApiKeyRow.classList.toggle("hidden", customWidgetWeatherProvider.value !== "openweathermap");
    }
    if (customWidgetVarsSection) {
      customWidgetVarsSection.classList.toggle("hidden", isNonSearch);
    }
    if (customWidgetUrlField) {
      customWidgetUrlField.classList.toggle("hidden", isNonSearch);
    }
    if (customWidgetUrlInput) {
      customWidgetUrlInput.placeholder = isJson
        ? "https://example.com/search/"
        : (t("customSearchUrlPlaceholder") || "https://www.google.com/search?q={query}");
    }
    if (customWidgetGroupField) {
      customWidgetGroupField.classList.toggle("hidden", isTimezone || isNotes || isWeather);
    }
    renderCustomWidgetGroupSelect();
    if (customWidgetSearchAdvanced) {
      customWidgetSearchAdvanced.classList.toggle("hidden", isNonSearch);
    }
    if (customWidgetRestAdvanced) {
      customWidgetRestAdvanced.classList.toggle("hidden", !isRestStatus);
    }
    if (customWidgetPreviewToggleBtn) {
      customWidgetPreviewToggleBtn.classList.toggle("hidden", isNonSearch);
    }
    if (isNonSearch && customWidgetPreviewBox) {
      customWidgetPreviewBox.classList.add("hidden");
    }
    if (customWidgetNameInput) {
      customWidgetNameInput.placeholder = isRssFeed
        ? (t("customRssNamePlaceholder") || "Name (e.g. Hacker News)")
        : (isNotes
          ? (t("notesDefaultName") || "Notes")
          : (isRestStatus
            ? (t("customRestNamePlaceholder") || "Name (e.g. Pi-hole, Proxmox)")
            : (isTimezone
              ? (t("customTzDefaultName") || "Time Zones")
              : (t("customSearchNamePlaceholder") || "Name (e.g. Google)"))));
    }
    if (customWidgetIconInput && !editingCustomWidgetId) {
      const val = customWidgetIconInput.value;
      const defaultIcons = new Set(["🔎", "🕒", "📡", "📝", "📰"]);
      if (defaultIcons.has(val)) {
        customWidgetIconInput.value = isRssFeed ? "📰" : (isNotes ? "📝" : (isRestStatus ? "📡" : (isTimezone ? "🕒" : "🔎")));
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
      keyInput.name = `var-key-${idx}`;
      keyInput.className = "sync-compact-input custom-widget-var-key";
      keyInput.value = varItem.key || "";
      keyInput.placeholder = "key (e.g. query)";
      keyInput.addEventListener("input", () => {
        varItem.key = keyInput.value;
      });

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.name = `var-label-${idx}`;
      labelInput.className = "sync-compact-input custom-widget-var-label";
      labelInput.value = varItem.label || "";
      labelInput.placeholder = t("customSearchVarLabelPlaceholder") || "Label";
      labelInput.addEventListener("input", () => {
        varItem.label = labelInput.value;
      });

      const typeSelect = document.createElement("select");
      typeSelect.name = `var-type-${idx}`;
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
      optionsInput.name = `var-options-${idx}`;
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
      const inputId = `custom-widget-preview-var-${v.key}`;
      const lbl = document.createElement("label");
      lbl.htmlFor = inputId;
      lbl.textContent = `${v.label || v.key} (${v.key})`;
      field.appendChild(lbl);

      const input = document.createElement("input");
      input.type = "text";
      input.id = inputId;
      input.name = v.key;
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
    lockedEncryptedRestToken = "";
    lockedEncryptedWeatherApiKey = "";
    updateRestAuthWarningBadge(false);
    if (customWidgetIconInput) customWidgetIconInput.value = "🔎";
    if (customWidgetCustomIconInput) customWidgetCustomIconInput.value = "";
    if (customWidgetModeSelect) customWidgetModeSelect.value = "simple";
    if (customWidgetNameInput) customWidgetNameInput.value = "";
    if (customWidgetGroupSelect) customWidgetGroupSelect.value = "";
    lastSelectedWidgetGroup = "";
    if (customWidgetRoutePrefixesInput) customWidgetRoutePrefixesInput.value = "";
    if (customWidgetUrlInput) customWidgetUrlInput.value = "";
    if (customWidgetJsonTemplateInput) customWidgetJsonTemplateInput.value = "";
    if (customWidgetNewTabInput) customWidgetNewTabInput.checked = false;
    if (customWidgetDefaultInput) customWidgetDefaultInput.checked = false;
    if (customWidgetAddBtn) customWidgetAddBtn.textContent = t("customSearchAddBtn") || "+ Add";
    if (customWidgetStatus) customWidgetStatus.textContent = "";
    if (customWidgetEditorStatus) customWidgetEditorStatus.textContent = "";
    customWidgetVarsDraft = [{ key: "query", label: "Search", type: "text", optionsText: "" }];
    customWidgetTzDraft = [
      { label: "UTC", timeZone: "UTC" },
      { label: "New York", timeZone: "America/New_York" }
    ];
    if (customWidgetTzSeconds) customWidgetTzSeconds.checked = false;
    if (customWidgetTz24h) customWidgetTz24h.checked = true;
    if (customWidgetRestUrl) customWidgetRestUrl.value = "";
    if (customWidgetRestMethod) customWidgetRestMethod.value = "GET";
    if (customWidgetRestJsonPath) customWidgetRestJsonPath.value = "";
    if (customWidgetRestSuffix) customWidgetRestSuffix.value = "";
    if (customWidgetRestInterval) customWidgetRestInterval.value = "60";
    if (customWidgetRestOk) customWidgetRestOk.value = "";
    if (customWidgetRestWarn) customWidgetRestWarn.value = "";
    if (customWidgetRestValueMap) customWidgetRestValueMap.value = "";
    if (customWidgetRestLink) customWidgetRestLink.value = "";
    if (customWidgetRestHeaderName) customWidgetRestHeaderName.value = "";
    if (customWidgetRestHeaderValue) {
      customWidgetRestHeaderValue.value = "";
      customWidgetRestHeaderValue.placeholder = t("customRestHeaderValuePlaceholder") || "Header value / token (optional)";
    }
    if (customWidgetRestHideGroup) customWidgetRestHideGroup.checked = false;
    if (customWidgetRestHideValue) customWidgetRestHideValue.checked = false;
    if (customWidgetRestMetrics) customWidgetRestMetrics.value = "";
    if (customWidgetRestCollapseMetrics) customWidgetRestCollapseMetrics.checked = false;
    if (customWidgetNotesCompact) customWidgetNotesCompact.checked = false;
    if (customWidgetRssUrl) customWidgetRssUrl.value = "";
    if (customWidgetRssRefresh) customWidgetRssRefresh.value = "30";
    if (customWidgetRssMaxItems) customWidgetRssMaxItems.value = "15";
    if (customWidgetWeatherProvider) customWidgetWeatherProvider.value = "open-meteo";
    if (customWidgetWeatherSize) customWidgetWeatherSize.value = "small";
    if (customWidgetWeatherLocQuery) customWidgetWeatherLocQuery.value = "";
    if (customWidgetWeatherLocResults) {
      customWidgetWeatherLocResults.innerHTML = "";
      customWidgetWeatherLocResults.classList.add("hidden");
    }
    if (customWidgetWeatherLocName) customWidgetWeatherLocName.value = "";
    if (customWidgetWeatherLat) customWidgetWeatherLat.value = "";
    if (customWidgetWeatherLon) customWidgetWeatherLon.value = "";
    if (customWidgetWeatherUnit) customWidgetWeatherUnit.value = "C";
    if (customWidgetWeatherRefresh) customWidgetWeatherRefresh.value = "30";
    if (customWidgetWeatherApiKey) customWidgetWeatherApiKey.value = "";
    if (customWidgetRestTestResult) customWidgetRestTestResult.textContent = "";
    if (customWidgetAdvancedDetails) customWidgetAdvancedDetails.open = false;
    syncCustomWidgetModeUI();
    renderCustomWidgetGroupSelect("");
    renderCustomWidgetVarsEditor();
    renderCustomWidgetTzEditor();
  };

  const loadCustomWidgetIntoForm = (widget) => {
    if (!widget) return;
    const isTimezone = widget.type === "timezone";
    const isRestStatus = widget.type === "rest-status";
    const isNotes = widget.type === "notes";
    const isRssFeed = widget.type === "rss-feed";
    const isWeather = widget.type === "weather";
    const isNonSearch = isTimezone || isRestStatus || isNotes || isRssFeed || isWeather;
    editingCustomWidgetId = widget.id;
    if (customWidgetIconInput) {
      customWidgetIconInput.value = widget.icon || (isWeather ? "🌤️" : (isRssFeed ? "📰" : (isNotes ? "📝" : (isRestStatus ? "📡" : (isTimezone ? "🕒" : "🔎")))));
    }
    if (customWidgetCustomIconInput) customWidgetCustomIconInput.value = widget.customIcon || "";
    if (customWidgetModeSelect) {
      customWidgetModeSelect.value = isWeather
        ? "weather"
        : (isRssFeed
          ? "rss-feed"
          : (isNotes
            ? "notes"
            : (isRestStatus
              ? "rest-status"
              : (isTimezone ? "timezone" : (widget.mode === "json" ? "json" : "simple")))));
    }
    if (customWidgetNameInput) customWidgetNameInput.value = widget.name || "";
    const initialGroupName = isTimezone || isNotes || isWeather ? "" : (widget.groupName || "");
    lastSelectedWidgetGroup = initialGroupName;
    if (customWidgetRoutePrefixesInput) {
      customWidgetRoutePrefixesInput.value = isNonSearch
        ? ""
        : normalizeCustomSearchRoutePrefixes(widget.routePrefixes).join(", ");
    }
    if (customWidgetUrlInput) customWidgetUrlInput.value = widget.urlTemplate || "";
    if (customWidgetJsonTemplateInput) customWidgetJsonTemplateInput.value = widget.jsonTemplate || "";
    if (customWidgetNewTabInput) customWidgetNewTabInput.checked = !!widget.openInNewTab;
    if (customWidgetDefaultInput) customWidgetDefaultInput.checked = !isNonSearch && !!widget.isDefault;
    if (customWidgetTzSeconds) customWidgetTzSeconds.checked = !!widget.showSeconds;
    if (customWidgetTz24h) customWidgetTz24h.checked = widget.use24Hour !== false;
    if (customWidgetRestUrl) customWidgetRestUrl.value = widget.endpointUrl || "";
    if (customWidgetRestMethod) customWidgetRestMethod.value = widget.method === "HEAD" ? "HEAD" : "GET";
    if (customWidgetRestJsonPath) customWidgetRestJsonPath.value = widget.jsonPath || "";
    if (customWidgetRestSuffix) customWidgetRestSuffix.value = widget.valueSuffix || "";
    if (customWidgetRestInterval) customWidgetRestInterval.value = String(normalizeRestRefreshSeconds(widget.refreshSeconds));
    if (customWidgetRestOk) customWidgetRestOk.value = widget.okMatch || "";
    if (customWidgetRestWarn) customWidgetRestWarn.value = widget.warnMatch || "";
    if (customWidgetRestValueMap) customWidgetRestValueMap.value = widget.valueMap || "";
    if (customWidgetRestLink) customWidgetRestLink.value = widget.linkUrl || "";
    if (customWidgetRestHeaderName) customWidgetRestHeaderName.value = widget.authHeaderName || "";
    lockedEncryptedRestToken = "";
    lockedEncryptedWeatherApiKey = "";
    if (customWidgetRestHeaderValue) {
      if (isEncryptedSecret(widget.authHeaderValue)) {
        customWidgetRestHeaderValue.value = "";
        customWidgetRestHeaderValue.placeholder = t("secretSavedPlaceholder") || "<secret saved>";
        lockedEncryptedRestToken = widget.authHeaderValue;
        updateRestAuthWarningBadge(true);
        void (async () => {
          const cfg = await loadConfig();
          const res = await getSecret(widget.authHeaderValue, `widget:${widget.id}:authHeaderValue`, {
            vaultHeader: cfg?.vaultHeader || null
          });
          if (res.ok && editingCustomWidgetId === widget.id) {
            updateRestAuthWarningBadge(false);
          }
        })();
      } else {
        customWidgetRestHeaderValue.value = widget.authHeaderValue || "";
        customWidgetRestHeaderValue.placeholder = t("customRestHeaderValuePlaceholder") || "Header value / token (optional)";
        updateRestAuthWarningBadge(false);
      }
    }
    if (customWidgetRestHideGroup) customWidgetRestHideGroup.checked = !!widget.hideGroupName;
    if (customWidgetRestHideValue) customWidgetRestHideValue.checked = !!widget.hideValue;
    if (customWidgetRestMetrics) customWidgetRestMetrics.value = formatRestMetricsText(widget.metrics);
    if (customWidgetRestCollapseMetrics) customWidgetRestCollapseMetrics.checked = !!widget.collapseMetrics;
    if (customWidgetNotesCompact) customWidgetNotesCompact.checked = !!widget.compactMode;
    if (customWidgetRssUrl) customWidgetRssUrl.value = widget.feedUrl || "";
    if (customWidgetRssRefresh) customWidgetRssRefresh.value = String(normalizeRssRefreshMinutes(widget.refreshMinutes));
    if (customWidgetRssMaxItems) customWidgetRssMaxItems.value = String(normalizeRssMaxItems(widget.maxItems));
    if (customWidgetWeatherProvider) customWidgetWeatherProvider.value = normalizeWeatherProvider(widget.provider);
    if (customWidgetWeatherSize) customWidgetWeatherSize.value = normalizeWeatherDisplaySize(widget.displaySize);
    if (customWidgetWeatherLocName) customWidgetWeatherLocName.value = widget.locationName || "";
    if (customWidgetWeatherLat) customWidgetWeatherLat.value = Number.isFinite(Number(widget.latitude)) ? String(widget.latitude) : "";
    if (customWidgetWeatherLon) customWidgetWeatherLon.value = Number.isFinite(Number(widget.longitude)) ? String(widget.longitude) : "";
    if (customWidgetWeatherUnit) customWidgetWeatherUnit.value = normalizeWeatherUnit(widget.unit);
    if (customWidgetWeatherRefresh) customWidgetWeatherRefresh.value = String(normalizeWeatherRefreshMinutes(widget.refreshMinutes));
    lockedEncryptedWeatherApiKey = "";
    if (customWidgetWeatherApiKey) {
      customWidgetWeatherApiKey.value = "";
      customWidgetWeatherApiKey.placeholder = "Enter provider API key";
      if (isEncryptedSecret(widget.apiKey)) {
        customWidgetWeatherApiKey.placeholder = t("secretSavedPlaceholder") || "<secret saved>";
        lockedEncryptedWeatherApiKey = widget.apiKey;
      } else if (typeof widget.apiKey === "string") {
        customWidgetWeatherApiKey.value = widget.apiKey;
      }
    }
    if (customWidgetRestTestResult) customWidgetRestTestResult.textContent = "";
    if (customWidgetAddBtn) customWidgetAddBtn.textContent = t("save") || "Save";
    if (customWidgetStatus) customWidgetStatus.textContent = "";
    if (customWidgetEditorStatus) customWidgetEditorStatus.textContent = "";
    customWidgetVarsDraft = Array.isArray(widget.variables) && widget.variables.length > 0
      ? widget.variables.map(v => ({ ...v }))
      : [{ key: "query", label: widget.name || "Search", type: "text", optionsText: "" }];
    customWidgetTzDraft = Array.isArray(widget.timeZones) && widget.timeZones.length > 0
      ? widget.timeZones.map(z => ({ label: z.label || "", timeZone: z.timeZone || "" }))
      : [{ label: "UTC", timeZone: "UTC" }];
    syncCustomWidgetModeUI();
    renderCustomWidgetGroupSelect(initialGroupName);
    if (customWidgetAdvancedDetails) {
      const hasAdvanced = Boolean(
        widget.customIcon ||
        (!isNonSearch && normalizeCustomSearchRoutePrefixes(widget.routePrefixes).length > 0) ||
        (!isNonSearch && widget.openInNewTab) ||
        (!isNonSearch && widget.isDefault) ||
        (isRestStatus && (
          widget.valueMap ||
          widget.linkUrl ||
          (Array.isArray(widget.metrics) && widget.metrics.length > 0) ||
          widget.collapseMetrics ||
          widget.hideGroupName ||
          widget.hideValue ||
          widget.authHeaderName ||
          widget.authHeaderValue
        ))
      );
      customWidgetAdvancedDetails.open = hasAdvanced;
    }
    renderCustomWidgetVarsEditor();
    renderCustomWidgetTzEditor();
  };

  syncCustomWidgetModeUI();

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

  const openCustomWidgetEditorModal = () => {
    if (!customWidgetEditorModal) return;
    customWidgetEditorModal.classList.remove("hidden");
    customWidgetNameInput?.focus();
  };

  const closeCustomWidgetEditorModal = () => {
    if (customWidgetEditorModal) {
      customWidgetEditorModal.classList.add("hidden");
    }
    resetCustomWidgetForm();
  };
  window.closeCustomWidgetEditorModal = closeCustomWidgetEditorModal;
  window.openCustomWidgetById = (widgetId) => {
    if (!widgetId) return;
    void ensureAppearanceDraft().then((draft) => {
      const target = (draft.customWidgets || []).find((w) => w?.id === widgetId);
      if (!target) return;
      loadCustomWidgetIntoForm(target);
      openCustomWidgetEditorModal();
    });
  };
  window.openCalendarSourceEditor = (sourceId) => {
    if (!sourceId) return;
    void ensureAppearanceDraft().then((draft) => {
      const target = (draft.calendarSources || []).find((s) => s?.id === sourceId);
      if (!target) return;
      openSystemWidgetEditorModal("dateTime");
      openCalendarSourceForm(target, target.type || "webcal");
    });
  };

  if (openNewCustomWidgetBtn) {
    openNewCustomWidgetBtn.addEventListener("click", () => {
      resetCustomWidgetForm();
      openCustomWidgetEditorModal();
    });
  }

  if (customWidgetCancelEditBtn) {
    customWidgetCancelEditBtn.addEventListener("click", closeCustomWidgetEditorModal);
  }

  const readWidgetIconFile = (file, onDataUrl) => {
    if (!file || typeof onDataUrl !== "function") return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      if (file.type === "image/svg+xml" || /^data:image\/svg\+xml/i.test(dataUrl)) {
        const sanitized = sanitizeSvgDataUrl(dataUrl);
        if (sanitized) onDataUrl(sanitized);
        return;
      }
      if (dataUrl.length <= 24000) {
        onDataUrl(dataUrl);
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
          onDataUrl(canvas.toDataURL("image/png"));
        } else {
          onDataUrl(dataUrl);
        }
      };
      img.onerror = () => onDataUrl(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  if (customWidgetIconUploadBtn && customWidgetIconFile) {
    customWidgetIconUploadBtn.addEventListener("click", () => {
      customWidgetIconFile.value = "";
      customWidgetIconFile.click();
    });
    customWidgetIconFile.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file || !customWidgetCustomIconInput) return;
      readWidgetIconFile(file, (dataUrl) => {
        customWidgetCustomIconInput.value = dataUrl;
      });
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
  if (customWidgetRestTestBtn) {
    customWidgetRestTestBtn.addEventListener("click", async () => {
      const endpointUrl = (customWidgetRestUrl?.value || "").trim();
      if (!isValidRestEndpointUrl(endpointUrl)) {
        if (customWidgetRestTestResult) {
          customWidgetRestTestResult.textContent = "❌ " + (t("customRestInvalidUrl") || "Enter a valid http(s) endpoint URL.");
        }
        return;
      }
      const permitted = await requestRestEndpointPermission(endpointUrl);
      if (!permitted) {
        if (customWidgetRestTestResult) {
          customWidgetRestTestResult.textContent = "❌ " + (t("hostPermissionRequired") || "Host permission is required.");
        }
        return;
      }
      if (customWidgetRestTestResult) {
        customWidgetRestTestResult.textContent = "⏳ " + (t("testing") || "Testing...");
      }
      const testWidget = {
        id: editingCustomWidgetId || "test",
        name: (customWidgetNameInput?.value || "Test").trim() || "Test",
        endpointUrl,
        method: customWidgetRestMethod?.value === "HEAD" ? "HEAD" : "GET",
        jsonPath: (customWidgetRestJsonPath?.value || "").trim(),
        valueSuffix: customWidgetRestSuffix?.value || "",
        valueMap: (customWidgetRestValueMap?.value || "").trim(),
        okMatch: (customWidgetRestOk?.value || "").trim(),
        warnMatch: (customWidgetRestWarn?.value || "").trim(),
        metrics: parseRestMetricsText(customWidgetRestMetrics?.value || ""),
        authHeaderName: (customWidgetRestHeaderName?.value || "").trim(),
        authHeaderValue: (customWidgetRestHeaderValue?.value || "") || lockedEncryptedRestToken
      };
      const result = await fetchAndEvaluateRestWidget(testWidget);
      const badge = result.state === "ok" ? "🟢" : (result.state === "warn" ? "🟡" : "🔴");
      if (customWidgetRestTestResult) {
        customWidgetRestTestResult.textContent = `${badge} ${result.text} (${result.detail})`;
      }
    });
  }

  if (customWidgetWeatherProvider && customWidgetWeatherApiKeyRow) {
    customWidgetWeatherProvider.addEventListener("change", () => {
      customWidgetWeatherApiKeyRow.classList.toggle("hidden", customWidgetWeatherProvider.value !== "openweathermap");
    });
  }

  if (customWidgetWeatherSearchBtn && customWidgetWeatherLocQuery && customWidgetWeatherLocResults) {
    customWidgetWeatherSearchBtn.addEventListener("click", async () => {
      const q = customWidgetWeatherLocQuery.value.trim();
      if (!q) return;
      customWidgetWeatherSearchBtn.disabled = true;
      try {
        const results = await searchWeatherLocations(q);
        customWidgetWeatherLocResults.innerHTML = "";
        if (results.length === 0) {
          customWidgetWeatherLocResults.classList.add("hidden");
          if (customWidgetEditorStatus) {
            customWidgetEditorStatus.textContent = "❌ " + (t("customWeatherLocationNotFound") || "Location not found.");
          }
          return;
        }
        for (const loc of results) {
          const opt = document.createElement("option");
          opt.value = JSON.stringify(loc);
          opt.textContent = `${loc.label} (${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)})`;
          customWidgetWeatherLocResults.appendChild(opt);
        }
        customWidgetWeatherLocResults.classList.remove("hidden");
        const first = results[0];
        if (customWidgetWeatherLocName) customWidgetWeatherLocName.value = first.label;
        if (customWidgetWeatherLat) customWidgetWeatherLat.value = String(first.latitude);
        if (customWidgetWeatherLon) customWidgetWeatherLon.value = String(first.longitude);
        if (customWidgetNameInput && !customWidgetNameInput.value.trim()) {
          customWidgetNameInput.value = first.label.split(",")[0].trim();
        }
        if (customWidgetEditorStatus) customWidgetEditorStatus.textContent = "";
      } catch (err) {
        if (customWidgetEditorStatus) {
          customWidgetEditorStatus.textContent = err?.message === "PERMISSION_REQUIRED"
            ? "❌ " + (t("hostPermissionRequired") || "Host permission is required.")
            : "❌ " + (t("customWeatherSearchFailed") || "Location search failed.");
        }
      } finally {
        customWidgetWeatherSearchBtn.disabled = false;
      }
    });

    customWidgetWeatherLocResults.addEventListener("change", () => {
      try {
        const loc = JSON.parse(customWidgetWeatherLocResults.value);
        if (customWidgetWeatherLocName) customWidgetWeatherLocName.value = loc.label;
        if (customWidgetWeatherLat) customWidgetWeatherLat.value = String(loc.latitude);
        if (customWidgetWeatherLon) customWidgetWeatherLon.value = String(loc.longitude);
      } catch {
        // ignore
      }
    });
  }

  if (customWidgetAddBtn) {
    customWidgetAddBtn.addEventListener('click', async () => {
      const selectedMode = customWidgetModeSelect?.value || "simple";
      const isTimezone = selectedMode === "timezone";
      const isRestStatus = selectedMode === "rest-status";
      const isNotes = selectedMode === "notes";
      const isRssFeed = selectedMode === "rss-feed";
      const isWeather = selectedMode === "weather";
      const mode = selectedMode === "json" ? "json" : "simple";
      const name = (customWidgetNameInput?.value || "").trim();
      const rawGroupName = (customWidgetGroupSelect?.value || "").trim();
      const groupName = rawGroupName === "__create__" ? "" : rawGroupName;
      const urlTemplate = (customWidgetUrlInput?.value || "").trim();
      const jsonTemplate = (customWidgetJsonTemplateInput?.value || "").trim();
      const defaultIcon = isWeather ? "🌤️" : (isRssFeed ? "📰" : (isNotes ? "📝" : (isRestStatus ? "📡" : (isTimezone ? "🕒" : "🔎"))));
      const icon = (customWidgetIconInput?.value || defaultIcon).trim() || defaultIcon;
      const rawCustomIcon = (customWidgetCustomIconInput?.value || "").trim();
      let customIcon = null;
      if (rawCustomIcon) {
        customIcon = normalizeCustomIconValue(rawCustomIcon, { allowEmoji: false });
        if (!customIcon) {
          if (customWidgetEditorStatus) {
            customWidgetEditorStatus.textContent = "❌ " + (t("customSearchInvalidIcon") || "Enter a valid icon URL or upload an image.");
          }
          return;
        }
      }

      if (isTimezone) {
        const timeZones = normalizeCustomTimeZones(customWidgetTzDraft);
        if (timeZones.length === 0) {
          if (customWidgetEditorStatus) {
            customWidgetEditorStatus.textContent = "❌ " + (t("customTzInvalidError") || "Add at least one valid IANA time zone (e.g. UTC, Europe/Prague, America/New_York).");
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

        closeCustomWidgetEditorModal();
        renderWidgetOrderList(draft);
        renderCustomWidgetsList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
        return;
      }

      if (isWeather) {
        const provider = normalizeWeatherProvider(customWidgetWeatherProvider?.value);
        const locationName = (customWidgetWeatherLocName?.value || "").trim() || name;
        const lat = Number(customWidgetWeatherLat?.value);
        const lon = Number(customWidgetWeatherLon?.value);
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          if (customWidgetEditorStatus) {
            customWidgetEditorStatus.textContent = "❌ " + (t("customWeatherInvalidError") || "Enter a widget name and valid coordinates (or search a location).");
          }
          return;
        }
        const targetWidgetId = editingCustomWidgetId || `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        let apiKey = (customWidgetWeatherApiKey?.value || "").trim();
        if (provider === "openweathermap") {
          if (!apiKey && lockedEncryptedWeatherApiKey) {
            apiKey = lockedEncryptedWeatherApiKey;
          } else if (apiKey) {
            apiKey = await setSecret(apiKey, `widget:${targetWidgetId}:apiKey`);
          }
        } else {
          apiKey = "";
        }
        await requestWeatherPermission(provider);
        const weatherFields = {
          type: "weather",
          name,
          icon,
          customIcon,
          provider,
          locationName,
          latitude: lat,
          longitude: lon,
          displaySize: normalizeWeatherDisplaySize(customWidgetWeatherSize?.value),
          unit: normalizeWeatherUnit(customWidgetWeatherUnit?.value),
          refreshMinutes: normalizeWeatherRefreshMinutes(customWidgetWeatherRefresh?.value),
          apiKey
        };
        if (customWidgetStatus) customWidgetStatus.textContent = "";
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        if (editingCustomWidgetId) {
          draft.customWidgets = (draft.customWidgets || []).map(w =>
            w.id === editingCustomWidgetId ? { ...w, ...weatherFields } : w
          );
        } else {
          const newWidget = {
            id: targetWidgetId,
            ...weatherFields,
            space: "left",
            align: "auto",
            newRow: false
          };
          draft.customWidgets = [...(draft.customWidgets || []), newWidget];
          draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
        }
        closeCustomWidgetEditorModal();
        renderWidgetOrderList(draft);
        renderCustomWidgetsList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
        void pollAllWeatherWidgets({ force: true });
        return;
      }

      if (isRssFeed) {
        const feedUrl = (customWidgetRssUrl?.value || "").trim();
        if (!name || !isValidRssFeedUrl(feedUrl)) {
          if (customWidgetEditorStatus) {
            customWidgetEditorStatus.textContent = "❌ " + (t("customRssInvalidError") || "Enter a widget name and valid http(s) feed URL.");
          }
          return;
        }
        await requestRssFeedPermission(feedUrl);
        const rssFields = {
          type: "rss-feed",
          name,
          groupName,
          icon,
          customIcon,
          feedUrl,
          refreshMinutes: normalizeRssRefreshMinutes(customWidgetRssRefresh?.value),
          maxItems: normalizeRssMaxItems(customWidgetRssMaxItems?.value)
        };
        if (customWidgetStatus) customWidgetStatus.textContent = "";
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const inheritedPlacement = resolveGroupPlacement(draft.customWidgets, "rss-feed", groupName, editingCustomWidgetId);
        if (editingCustomWidgetId) {
          draft.customWidgets = (draft.customWidgets || []).map(w => {
            if (w.id !== editingCustomWidgetId) return w;
            const prevKey = typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "";
            const nextKey = groupName.trim().toLowerCase();
            const joinPlacement = (nextKey && nextKey !== prevKey) ? inheritedPlacement : null;
            return { ...w, ...rssFields, ...(joinPlacement || {}) };
          });
        } else {
          const newWidget = {
            id: `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            ...rssFields,
            space: inheritedPlacement?.space || "left",
            ...(inheritedPlacement?.lastActiveSpace ? { lastActiveSpace: inheritedPlacement.lastActiveSpace } : {}),
            align: "auto",
            newRow: false
          };
          draft.customWidgets = [...(draft.customWidgets || []), newWidget];
          draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
        }
        closeCustomWidgetEditorModal();
        renderWidgetOrderList(draft);
        renderCustomWidgetsList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
        void pollAllRssFeedWidgets({ force: true });
        return;
      }

      if (isNotes) {
        const resolvedName = name || t("notesDefaultName") || "Notes";
        const notesFields = {
          type: "notes",
          name: resolvedName,
          icon,
          customIcon,
          compactMode: !!customWidgetNotesCompact?.checked
        };
        if (customWidgetStatus) customWidgetStatus.textContent = "";
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        if (editingCustomWidgetId) {
          draft.customWidgets = (draft.customWidgets || []).map(w =>
            w.id === editingCustomWidgetId ? { ...w, ...notesFields } : w
          );
        } else {
          const newWidget = {
            id: `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            ...notesFields,
            space: "right",
            align: "auto",
            newRow: false
          };
          draft.customWidgets = [...(draft.customWidgets || []), newWidget];
          draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
        }
        closeCustomWidgetEditorModal();
        renderWidgetOrderList(draft);
        renderCustomWidgetsList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
        return;
      }

      if (isRestStatus) {
        const endpointUrl = (customWidgetRestUrl?.value || "").trim();
        if (!name || !isValidRestEndpointUrl(endpointUrl)) {
          if (customWidgetEditorStatus) {
            customWidgetEditorStatus.textContent = "❌ " + (t("customRestInvalidError") || "Enter a widget name and valid http(s) endpoint URL.");
          }
          return;
        }
        const rawLinkUrl = (customWidgetRestLink?.value || "").trim();
        if (rawLinkUrl && !isValidRestEndpointUrl(rawLinkUrl)) {
          if (customWidgetEditorStatus) {
            customWidgetEditorStatus.textContent = "❌ " + (t("customRestInvalidLinkUrl") || "Click URL must start with http:// or https://.");
          }
          return;
        }
        await requestRestEndpointPermission(endpointUrl);

        const targetWidgetId = editingCustomWidgetId || `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        let authHeaderValue = customWidgetRestHeaderValue?.value || "";
        if (!authHeaderValue && lockedEncryptedRestToken) {
          authHeaderValue = lockedEncryptedRestToken;
        } else if (authHeaderValue) {
          authHeaderValue = await setSecret(authHeaderValue, `widget:${targetWidgetId}:authHeaderValue`);
        }

        const restFields = {
          type: "rest-status",
          name,
          groupName,
          hideGroupName: !!customWidgetRestHideGroup?.checked,
          hideValue: !!customWidgetRestHideValue?.checked,
          metrics: parseRestMetricsText(customWidgetRestMetrics?.value || ""),
          collapseMetrics: !!customWidgetRestCollapseMetrics?.checked,
          icon,
          customIcon,
          endpointUrl,
          method: customWidgetRestMethod?.value === "HEAD" ? "HEAD" : "GET",
          jsonPath: (customWidgetRestJsonPath?.value || "").trim(),
          valueSuffix: customWidgetRestSuffix?.value || "",
          valueMap: (customWidgetRestValueMap?.value || "").trim(),
          refreshSeconds: normalizeRestRefreshSeconds(customWidgetRestInterval?.value),
          okMatch: (customWidgetRestOk?.value || "").trim(),
          warnMatch: (customWidgetRestWarn?.value || "").trim(),
          linkUrl: rawLinkUrl,
          authHeaderName: (customWidgetRestHeaderName?.value || "").trim(),
          authHeaderValue
        };

        if (customWidgetStatus) customWidgetStatus.textContent = "";
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const inheritedPlacement = resolveGroupPlacement(draft.customWidgets, "rest-status", groupName, editingCustomWidgetId);
        if (editingCustomWidgetId) {
          draft.customWidgets = (draft.customWidgets || []).map(w => {
            if (w.id !== editingCustomWidgetId) return w;
            const prevKey = typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "";
            const nextKey = groupName.trim().toLowerCase();
            const joinPlacement = (nextKey && nextKey !== prevKey) ? inheritedPlacement : null;
            return { ...w, ...restFields, ...(joinPlacement || {}) };
          });
        } else {
          const newWidget = {
            id: targetWidgetId,
            ...restFields,
            space: inheritedPlacement?.space || "left",
            ...(inheritedPlacement?.lastActiveSpace ? { lastActiveSpace: inheritedPlacement.lastActiveSpace } : {}),
            align: "auto",
            newRow: false
          };
          draft.customWidgets = [...(draft.customWidgets || []), newWidget];
          draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
        }

        closeCustomWidgetEditorModal();
        renderWidgetOrderList(draft);
        renderCustomWidgetsList(draft);
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
        void pollAllRestStatusWidgets({ force: true });
        return;
      }

      const openInNewTab = !!customWidgetNewTabInput?.checked;
      const isDefault = !!customWidgetDefaultInput?.checked && !!groupName;
      const routePrefixes = normalizeCustomSearchRoutePrefixes(customWidgetRoutePrefixesInput?.value);
      const variables = customWidgetVarsDraft
        .map(v => ({
          key: (v.key || "").trim(),
          label: (v.label || v.key || "").trim(),
          type: v.type || "text",
          optionsText: v.optionsText || ""
        }))
        .filter(v => v.key);

      if (!name || !isValidCustomSearchUrlTemplate(urlTemplate)) {
        if (customWidgetEditorStatus) {
          customWidgetEditorStatus.textContent = "❌ " + (t("customSearchInvalidUrl") || "Enter a name and valid http(s) URL template.");
        }
        return;
      }
      if (mode === "json" && !isValidCustomSearchJsonTemplate(jsonTemplate)) {
        if (customWidgetEditorStatus) {
          customWidgetEditorStatus.textContent = "❌ " + (t("customSearchInvalidJson") || "Enter a valid JSON template.");
        }
        return;
      }

      if (customWidgetStatus) customWidgetStatus.textContent = "";
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      const inheritedPlacement = resolveGroupPlacement(draft.customWidgets, "custom-search", groupName, editingCustomWidgetId);
      const targetGroupKey = groupName.trim().toLowerCase();
      if (editingCustomWidgetId) {
        draft.customWidgets = (draft.customWidgets || []).map(w => {
          if (w.id === editingCustomWidgetId) {
            const prevKey = typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "";
            const nextKey = targetGroupKey;
            const joinPlacement = (nextKey && nextKey !== prevKey) ? inheritedPlacement : null;
            return { ...w, mode, name, groupName, isDefault, routePrefixes, icon, customIcon, urlTemplate, jsonTemplate, openInNewTab, variables, ...(joinPlacement || {}) };
          }
          if (isDefault && targetGroupKey && w?.type === "custom-search" && (typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "") === targetGroupKey) {
            return { ...w, isDefault: false };
          }
          return w;
        });
      } else {
        const existingWidgets = isDefault && targetGroupKey
          ? (draft.customWidgets || []).map(w =>
              (w?.type === "custom-search" && (typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "") === targetGroupKey)
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
          routePrefixes,
          icon,
          customIcon,
          urlTemplate,
          jsonTemplate,
          openInNewTab,
          variables,
          space: inheritedPlacement?.space || "right",
          ...(inheritedPlacement?.lastActiveSpace ? { lastActiveSpace: inheritedPlacement.lastActiveSpace } : {}),
          align: "auto",
          newRow: false
        };
        draft.customWidgets = [...existingWidgets, newWidget];
        draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
      }

      closeCustomWidgetEditorModal();
      renderWidgetOrderList(draft);
      await applySideSpaces({ appearance: draft });
      await render();
      calculateGridLayout();
    });
  }

  function exportCustomWidgetsLibrary(
    widgets,
    filenamePrefix = "speeddial-widgets",
    statusEl = customWidgetStatus,
    { autoRouteIcons = null, autoRouteDefaults = null } = {}
  ) {
    const list = Array.isArray(widgets) ? widgets : [];
    if (list.length === 0) {
      if (statusEl) {
        statusEl.textContent = t("customSearchExportEmpty") || "No custom search widgets to export.";
      }
      return;
    }
    const payload = serializeCustomWidgetsExport(list, { autoRouteIcons, autoRouteDefaults });
    const dataStr = stringifyAsciiJson(payload);
    const dataBlob = new Blob([dataStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filenamePrefix}-${formatBackupTimestamp()}.json`;
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
    exportCustomWidgetsLibrary(draft.customWidgets || [], "speeddial-widgets", statusEl, {
      autoRouteIcons: draft.customSearchAutoRouteIcons,
      autoRouteDefaults: draft.customSearchAutoRouteDefaults
    });
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
  const applyImportedAutoRouteSettings = (draft, { autoRouteIcons = null, autoRouteDefaults = null } = {}) => {
    if (autoRouteIcons && Object.keys(autoRouteIcons).length > 0) {
      draft.customSearchAutoRouteIcons = {
        ...(draft.customSearchAutoRouteIcons || {}),
        ...autoRouteIcons
      };
    }
    if (autoRouteDefaults && Object.keys(autoRouteDefaults).length > 0) {
      draft.customSearchAutoRouteDefaults = {
        ...(draft.customSearchAutoRouteDefaults || {}),
        ...autoRouteDefaults
      };
    }
  };

  const resolveGroupPlacement = (customWidgets, widgetType, targetGroupName, excludeId = null) => {
    const gKey = typeof targetGroupName === "string" ? targetGroupName.trim().toLowerCase() : "";
    if (!gKey) return null;
    const matches = (Array.isArray(customWidgets) ? customWidgets : []).filter(w =>
      w
      && w.id !== excludeId
      && (w.type || "custom-search") === widgetType
      && (typeof w.groupName === "string" ? w.groupName.trim().toLowerCase() : "") === gKey
    );
    if (matches.length === 0) return null;
    const rep = matches.find(w => w.isDefault) || matches[0];
    return {
      space: rep.space || ((widgetType === "rss-feed" || widgetType === "rest-status") ? "left" : "right"),
      ...(rep.lastActiveSpace ? { lastActiveSpace: rep.lastActiveSpace } : {})
    };
  };

  const mergeImportedCustomWidgets = async (importedWidgets, { sourceUrl = null, autoRouteIcons = null, autoRouteDefaults = null } = {}) => {
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
        if (existing[idx]?.lockSourceUpdates) {
          continue;
        }
        existing[idx] = applyCustomWidgetUpdate(existing[idx], w, sourceUrl || existing[idx].sourceUrl || null);
        updatedCount++;
      } else {
        const inheritedPlacement = resolveGroupPlacement(existing, w.type || "custom-search", w.groupName, w.id);
        const nextWidget = {
          ...w,
          ...(inheritedPlacement || {}),
          ...(sourceUrl ? { sourceUrl, sourceUpdatedAt: nowIso } : {})
        };
        existingIndexById.set(nextWidget.id, existing.length);
        existing.push(nextWidget);
        addedCount++;
      }
    }

    draft.customWidgets = existing;
    applyImportedAutoRouteSettings(draft, { autoRouteIcons, autoRouteDefaults });
    draft.widgetOrder = normalizeWidgetOrder(
      [...(draft.widgetOrder || []), ...existing.map(w => w.id)],
      draft.customWidgets
    );

    renderWidgetOrderList(draft);
    await applySideSpaces({ appearance: draft });
    await render();
    calculateGridLayout();
    if (importedWidgets.some(w => w?.type === "rest-status")) {
      void pollAllRestStatusWidgets({ force: true });
    }
    return { addedCount, updatedCount, total: addedCount + updatedCount };
  };

  let inFlightUrlWidgetSyncPauseCount = 0;
  let shouldRestoreWidgetSyncAfterUrlUpdates = false;

  const withWidgetsSyncTemporarilyDisabled = async (fn) => {
    inFlightUrlWidgetSyncPauseCount++;
    try {
      const preCfg = await loadConfig();
      if (preCfg?.sync?.type === "webdav" && preCfg?.sync?.webdavMode === "folder" && preCfg?.sync?.webdavSyncWidgets !== false) {
        const syncMod = await loadSyncModule();
        if (typeof syncMod?.withSyncLock === "function") {
          await syncMod.withSyncLock(() => {});
        }
        const cfg = await loadConfig();
        if (cfg?.sync?.type === "webdav" && cfg?.sync?.webdavMode === "folder" && cfg?.sync?.webdavSyncWidgets !== false) {
          shouldRestoreWidgetSyncAfterUrlUpdates = true;
          cfg.sync.webdavSyncWidgets = false;
          await saveConfig(cfg);
        }
      }
    } catch {}
    try {
      return await fn();
    } finally {
      inFlightUrlWidgetSyncPauseCount = Math.max(0, inFlightUrlWidgetSyncPauseCount - 1);
      if (inFlightUrlWidgetSyncPauseCount === 0 && shouldRestoreWidgetSyncAfterUrlUpdates) {
        shouldRestoreWidgetSyncAfterUrlUpdates = false;
        try {
          const latestCfg = await loadConfig();
          if (latestCfg?.sync) {
            latestCfg.sync.webdavSyncWidgets = true;
            await saveConfig(latestCfg);
          }
        } catch {}
      }
    }
  };

  async function updateSingleCustomWidgetFromUrl(widgetId) {
    const draft = await ensureAppearanceDraft();
    const target = (draft.customWidgets || []).find(w => w.id === widgetId);
    if (!target?.sourceUrl || target.lockSourceUpdates) return;
    if (customWidgetsLibraryStatus) {
      customWidgetsLibraryStatus.textContent = "⏳ " + (t("customSearchUpdatingStatus") || "Updating from URL...");
    }
    await withWidgetsSyncTemporarilyDisabled(async () => {
      try {
        const { url, widgets, autoRouteIcons, autoRouteDefaults } = await fetchCustomWidgetsFromUrl(target.sourceUrl);
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
        const groupKey = typeof match.groupName === "string" ? match.groupName.trim().toLowerCase() : "";
        if (groupKey) {
          applyImportedAutoRouteSettings(draft, {
            autoRouteIcons: autoRouteIcons?.[groupKey] ? { [groupKey]: autoRouteIcons[groupKey] } : null,
            autoRouteDefaults: typeof autoRouteDefaults?.[groupKey] === "boolean" ? { [groupKey]: autoRouteDefaults[groupKey] } : null
          });
        }
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
    });
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
        const { widgets: importedWidgets, validFormat, autoRouteIcons, autoRouteDefaults } = parseImportedCustomWidgets(parsed);
        if (!validFormat || importedWidgets.length === 0) {
          if (statusEl) {
            statusEl.textContent = "❌ " + (t("customSearchImportInvalid") || "No valid custom widgets found in file.");
          }
          return;
        }

        const { total } = await mergeImportedCustomWidgets(importedWidgets, { autoRouteIcons, autoRouteDefaults });
        if (statusEl) {
          statusEl.textContent = "✅ " + (t("customSearchImportSuccess") || "Imported") + ` (${total})`;
        }
      } catch (err) {
        console.error("Custom widget import failed", err);
        if (statusEl) {
          statusEl.textContent = "❌ " + (t("customSearchImportInvalid") || "No valid custom widgets found in file.");
        }
      } finally {
        customWidgetImportFile.value = "";
      }
    });
  }

  if (customWidgetToggleUrlBtn && customWidgetUrlImportBox) {
    customWidgetToggleUrlBtn.addEventListener("click", () => {
      const isNowHidden = customWidgetUrlImportBox.classList.toggle("hidden");
      if (!isNowHidden) {
        customWidgetSourceUrlInput?.focus();
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
      await withWidgetsSyncTemporarilyDisabled(async () => {
        try {
          const { url, widgets, autoRouteIcons, autoRouteDefaults } = await fetchCustomWidgetsFromUrl(rawUrl);
          const { total } = await mergeImportedCustomWidgets(widgets, { sourceUrl: url, autoRouteIcons, autoRouteDefaults });
          customWidgetSourceUrlInput.value = "";
          customWidgetUrlImportBox?.classList.add("hidden");
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
    });
  }

  if (customWidgetUpdateAllBtn) {
    customWidgetUpdateAllBtn.addEventListener("click", async () => {
      const draft = await ensureAppearanceDraft();
      const urlWidgets = (draft.customWidgets || []).filter(w => !!w?.sourceUrl && !w?.lockSourceUpdates);
      if (urlWidgets.length === 0) {
        if (customWidgetsLibraryStatus && (draft.customWidgets || []).some(w => !!w?.sourceUrl)) {
          customWidgetsLibraryStatus.textContent = "ℹ️ " + (t("customWidgetUrlUpdatesAllBlocked") || "All URL-linked widgets are locked against updates.");
        }
        return;
      }

      if (customWidgetsLibraryStatus) {
        customWidgetsLibraryStatus.textContent = "⏳ " + (t("customSearchUpdatingStatus") || "Updating from URL...");
      }

      const uniqueUrls = [...new Set(urlWidgets.map(w => w.sourceUrl))];
      let updatedCount = 0;
      let errorCount = 0;
      const fetchedByUrl = new Map();

      await withWidgetsSyncTemporarilyDisabled(async () => {
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
            if (!w?.sourceUrl || w.lockSourceUpdates || !fetchedByUrl.has(w.sourceUrl)) return w;
            const { url, widgets, autoRouteIcons, autoRouteDefaults } = fetchedByUrl.get(w.sourceUrl);
            const match =
              widgets.find(item => item.id === w.id) ||
              widgets.find(item => item.name && w.name && item.name.toLowerCase() === w.name.toLowerCase()) ||
              (widgets.length === 1 ? widgets[0] : null);
            if (!match) return w;
            updatedCount++;
            const groupKey = typeof match.groupName === "string" ? match.groupName.trim().toLowerCase() : "";
            if (groupKey) {
              applyImportedAutoRouteSettings(draft, {
                autoRouteIcons: autoRouteIcons?.[groupKey] ? { [groupKey]: autoRouteIcons[groupKey] } : null,
                autoRouteDefaults: typeof autoRouteDefaults?.[groupKey] === "boolean" ? { [groupKey]: autoRouteDefaults[groupKey] } : null
              });
            }
            return applyCustomWidgetUpdate(w, match, url);
          });
          renderWidgetOrderList(draft);
          await applySideSpaces({ appearance: draft });
          await render();
          calculateGridLayout();
        }
      });

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
