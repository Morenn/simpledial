import { t } from "../i18n.js";
import { render, calculateGridLayout } from "../render.js";
import { applySideSpaces } from "../theme.js";
import {
  normalizeWidgetOrder,
  groupCustomSearchWidgets,
  isValidCustomSearchUrlTemplate,
  isValidCustomSearchJsonTemplate,
  isValidTimeZone,
  normalizeCustomTimeZones,
  serializeCustomWidgetsExport,
  parseImportedCustomWidgets,
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
  groupRestStatusWidgets
} from "../custom-widgets.js";
import { normalizeCustomIconValue, applyCachedIconImageSrc } from "../color-utils.js";
import { loadConfig } from "../config.js";
import { getSecret, setSecret, isEncryptedSecret, isVaultUnlocked, isInsecureHttpUrl } from "../crypto.js";
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
    dateTime: { key: "widgetDateTime", fallback: "Date & Time", field: "dateTimeSpace", defaultSpace: "footer", allowDisabled: true },
    shortcutPalette: { key: "widgetShortcutPalette", fallback: "Shortcut palette", field: "shortcutPaletteSpace", defaultSpace: "footer", allowDisabled: true },
    bookmarksCount: { key: "widgetBookmarksCount", fallback: "Bookmarks count", field: "bookmarksCountSpace", defaultSpace: "footer", allowDisabled: true }
  };

  const collapsedWidgetSpaceGroups = new Set();

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
    const customGroups = [
      ...groupCustomSearchWidgets(customWidgets),
      ...groupRestStatusWidgets(customWidgets)
    ];
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
    const getWidgetSpaceForKey = (key) => {
      const builtInDef = WIDGET_REGISTRY[key];
      const customDef = customWidgetMap.get(key);
      if (customDef) {
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
            draft.customWidgets = (draft.customWidgets || []).map(w => {
              if (w.id !== key) return w;
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
        alignControl.value = alignKeyMap[widgetAlign[key]] ? widgetAlign[key] : "auto";
        alignControl.addEventListener("change", async () => {
          markSettingsDirty();
          const draft = await ensureAppearanceDraft();
          draft.widgetAlign = { ...(draft.widgetAlign || {}), [key]: alignControl.value };
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
        const nextOrder = normalizeWidgetOrder(draft.widgetOrder, draft.customWidgets);
        const targetKey = sameSpaceKeys[targetIdx];
        const curPos = nextOrder.indexOf(key);
        const targetPos = nextOrder.indexOf(targetKey);
        if (curPos === -1 || targetPos === -1) return;
        [nextOrder[targetPos], nextOrder[curPos]] = [nextOrder[curPos], nextOrder[targetPos]];
        draft.widgetOrder = nextOrder;
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

      actions.append(upBtn, downBtn);
      if (alignControl) {
        row.append(nameEl, spaceControl, alignControl, actions);
      } else {
        row.append(nameEl, spaceControl, actions);
      }
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

  const createCustomWidgetSpacePill = (targetWidgetId, currentSpace) => {
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
      draft.customWidgets = (draft.customWidgets || []).map(w => {
        if (w.id !== targetWidgetId) return w;
        const currentlyDisabled = w.space === "disabled";
        if (currentlyDisabled) {
          const restoreSpace = (w.lastActiveSpace && w.lastActiveSpace !== "disabled") ? w.lastActiveSpace : "right";
          return { ...w, space: restoreSpace, lastActiveSpace: restoreSpace };
        }
        const activeSpace = validSpaces.includes(w.space) ? w.space : "right";
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
    customWidgetsFilterInput.addEventListener("input", () => {
      renderCustomWidgetsList(settingsState.appearanceDraft);
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

    const buildCustomWidgetLibraryRow = (customDef, effectiveSpace = customDef?.space, { insideGroup = false } = {}) => {
      const isDisabled = effectiveSpace === "disabled";
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
      const isNonSearch = isTimezone || isRestStatus || isNotes;
      const tzList = isTimezone ? normalizeCustomTimeZones(customDef.timeZones) : [];
      const badge = document.createElement("span");
      badge.className = "custom-widget-mode-badge";
      badge.textContent = isNotes
        ? "📝"
        : (isRestStatus
          ? "REST"
          : (isTimezone
            ? `🕒 ${tzList.length}`
            : (customDef.mode === "json" ? "JSON" : "Simple")));
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
        const srcBadge = document.createElement("span");
        srcBadge.className = "custom-widget-mode-badge";
        srcBadge.textContent = "🌐";
        srcBadge.title = customDef.sourceUrl;
        titleEl.appendChild(srcBadge);
      }

      const urlEl = document.createElement("div");
      urlEl.className = "custom-widget-library-url";
      const rawSubtitle = isNotes
        ? (customDef.compactMode ? (t("customNotesCompactMode") || "Compact button only") : (t("customWidgetModeNotes") || "Notes / Scratchpad"))
        : (isRestStatus
          ? (customDef.endpointUrl || "")
          : (isTimezone
            ? tzList.map(z => `${z.label} (${z.timeZone})`).join(", ")
            : (customDef.urlTemplate || "")));
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
          draft.customWidgets = (draft.customWidgets || []).map(w => {
            if ((typeof w?.groupName === "string" ? w.groupName.trim() : "") === groupName) {
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

      if (!(typeof customDef.groupName === "string" && customDef.groupName.trim())) {
        actions.appendChild(createCustomWidgetSpacePill(customDef.id, customDef.space));
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

      if (customDef.sourceUrl) {
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

      const groupSpacePill = createCustomWidgetSpacePill(groupRep.id, groupRep?.space);

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
        const memberIds = new Set(entry.members.map(m => m.id));
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
        exportCustomWidgetsLibrary(entry.members, `simple-dial-group-${slug}`, customWidgetsLibraryStatus);
      });

      const deleteGroupBtn = document.createElement("button");
      deleteGroupBtn.type = "button";
      deleteGroupBtn.className = "widget-order-btn danger";
      deleteGroupBtn.textContent = "🗑️";
      deleteGroupBtn.title = t("delete") || "Delete group";
      deleteGroupBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete group "${entry.groupName}" and all ${entry.members.length} widgets in it?`)) return;
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        const memberIds = new Set(entry.members.map(m => m.id));
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
      for (const member of entry.members) {
        membersWrap.appendChild(buildCustomWidgetLibraryRow(member, groupRep?.space, { insideGroup: true }));
      }

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
    const isRest = mode === "rest-status";
    const list = Array.isArray(settingsState.appearanceDraft?.customWidgets)
      ? settingsState.appearanceDraft.customWidgets
      : [];
    const seen = new Map();
    for (const w of list) {
      if (!w) continue;
      const wIsRest = w.type === "rest-status";
      const wIsUnsupported = w.type === "timezone" || w.type === "notes";
      if (wIsUnsupported || wIsRest !== isRest) continue;
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
    const isNonSearch = isTimezone || isRestStatus || isNotes;

    if (customWidgetAddTitle) {
      if (editingCustomWidgetId) {
        customWidgetAddTitle.setAttribute("data-i18n", "customWidgetEditTitle");
        customWidgetAddTitle.textContent = t("customWidgetEditTitle") || "Edit Custom Widget";
      } else {
        const titleKey = isNotes
          ? "customNotesAddTitle"
          : (isRestStatus
            ? "customRestAddTitle"
            : (isTimezone ? "customTzAddTitle" : "customSearchAddTitle"));
        const titleFallback = isNotes
          ? "Add Notes / Scratchpad Widget"
          : (isRestStatus
            ? "Add REST / JSON Status Widget"
            : (isTimezone ? "Add Time Zone Widget" : "Add Custom Search Widget"));
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
      customWidgetGroupField.classList.toggle("hidden", isTimezone || isNotes);
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
      customWidgetNameInput.placeholder = isNotes
        ? (t("notesDefaultName") || "Notes")
        : (isRestStatus
          ? (t("customRestNamePlaceholder") || "Name (e.g. Pi-hole, Proxmox)")
          : (isTimezone
            ? (t("customTzDefaultName") || "Time Zones")
            : (t("customSearchNamePlaceholder") || "Name (e.g. Google)")));
    }
    if (customWidgetIconInput && !editingCustomWidgetId) {
      const val = customWidgetIconInput.value;
      const defaultIcons = new Set(["🔎", "🕒", "📡", "📝"]);
      if (defaultIcons.has(val)) {
        customWidgetIconInput.value = isNotes ? "📝" : (isRestStatus ? "📡" : (isTimezone ? "🕒" : "🔎"));
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
    if (customWidgetRestHeaderValue) customWidgetRestHeaderValue.value = "";
    if (customWidgetRestHideGroup) customWidgetRestHideGroup.checked = false;
    if (customWidgetRestHideValue) customWidgetRestHideValue.checked = false;
    if (customWidgetRestMetrics) customWidgetRestMetrics.value = "";
    if (customWidgetRestCollapseMetrics) customWidgetRestCollapseMetrics.checked = false;
    if (customWidgetNotesCompact) customWidgetNotesCompact.checked = false;
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
    const isNonSearch = isTimezone || isRestStatus || isNotes;
    editingCustomWidgetId = widget.id;
    if (customWidgetIconInput) {
      customWidgetIconInput.value = widget.icon || (isNotes ? "📝" : (isRestStatus ? "📡" : (isTimezone ? "🕒" : "🔎")));
    }
    if (customWidgetCustomIconInput) customWidgetCustomIconInput.value = widget.customIcon || "";
    if (customWidgetModeSelect) {
      customWidgetModeSelect.value = isNotes
        ? "notes"
        : (isRestStatus
          ? "rest-status"
          : (isTimezone ? "timezone" : (widget.mode === "json" ? "json" : "simple")));
    }
    if (customWidgetNameInput) customWidgetNameInput.value = widget.name || "";
    const initialGroupName = isTimezone || isNotes ? "" : (widget.groupName || "");
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
    if (customWidgetRestHeaderValue) {
      if (isEncryptedSecret(widget.authHeaderValue)) {
        customWidgetRestHeaderValue.value = "";
        lockedEncryptedRestToken = widget.authHeaderValue;
        updateRestAuthWarningBadge(true);
        void (async () => {
          const cfg = await loadConfig();
          const res = await getSecret(widget.authHeaderValue, `widget:${widget.id}:authHeaderValue`, {
            vaultHeader: cfg?.vaultHeader || null
          });
          if (res.ok && editingCustomWidgetId === widget.id) {
            customWidgetRestHeaderValue.value = res.value;
            lockedEncryptedRestToken = "";
            updateRestAuthWarningBadge(false);
          }
        })();
      } else {
        customWidgetRestHeaderValue.value = widget.authHeaderValue || "";
        updateRestAuthWarningBadge(false);
      }
    }
    if (customWidgetRestHideGroup) customWidgetRestHideGroup.checked = !!widget.hideGroupName;
    if (customWidgetRestHideValue) customWidgetRestHideValue.checked = !!widget.hideValue;
    if (customWidgetRestMetrics) customWidgetRestMetrics.value = formatRestMetricsText(widget.metrics);
    if (customWidgetRestCollapseMetrics) customWidgetRestCollapseMetrics.checked = !!widget.collapseMetrics;
    if (customWidgetNotesCompact) customWidgetNotesCompact.checked = !!widget.compactMode;
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
      if (file.type === "image/svg+xml" || dataUrl.length <= 24000) {
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

  if (customWidgetAddBtn) {
    customWidgetAddBtn.addEventListener('click', async () => {
      const selectedMode = customWidgetModeSelect?.value || "simple";
      const isTimezone = selectedMode === "timezone";
      const isRestStatus = selectedMode === "rest-status";
      const isNotes = selectedMode === "notes";
      const mode = selectedMode === "json" ? "json" : "simple";
      const name = (customWidgetNameInput?.value || "").trim();
      const rawGroupName = (customWidgetGroupSelect?.value || "").trim();
      const groupName = rawGroupName === "__create__" ? "" : rawGroupName;
      const urlTemplate = (customWidgetUrlInput?.value || "").trim();
      const jsonTemplate = (customWidgetJsonTemplateInput?.value || "").trim();
      const defaultIcon = isNotes ? "📝" : (isRestStatus ? "📡" : (isTimezone ? "🕒" : "🔎"));
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
        await applySideSpaces({ appearance: draft });
        await render();
        calculateGridLayout();
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
        if (editingCustomWidgetId) {
          draft.customWidgets = (draft.customWidgets || []).map(w =>
            w.id === editingCustomWidgetId ? { ...w, ...restFields } : w
          );
        } else {
          const newWidget = {
            id: targetWidgetId,
            ...restFields,
            space: "right",
            align: "auto",
            newRow: false
          };
          draft.customWidgets = [...(draft.customWidgets || []), newWidget];
          draft.widgetOrder = normalizeWidgetOrder([...(draft.widgetOrder || []), newWidget.id], draft.customWidgets);
        }

        closeCustomWidgetEditorModal();
        renderWidgetOrderList(draft);
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
      if (editingCustomWidgetId) {
        draft.customWidgets = (draft.customWidgets || []).map(w => {
          if (w.id === editingCustomWidgetId) {
            return { ...w, mode, name, groupName, isDefault, routePrefixes, icon, customIcon, urlTemplate, jsonTemplate, openInNewTab, variables };
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
          routePrefixes,
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

      closeCustomWidgetEditorModal();
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
    const dataStr = JSON.stringify(payload);
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
    if (importedWidgets.some(w => w?.type === "rest-status")) {
      void pollAllRestStatusWidgets({ force: true });
    }
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
            statusEl.textContent = "❌ " + (t("customSearchImportInvalid") || "No valid custom widgets found in file.");
          }
          return;
        }

        const { total } = await mergeImportedCustomWidgets(importedWidgets);
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
      try {
        const { url, widgets } = await fetchCustomWidgetsFromUrl(rawUrl);
        const { total } = await mergeImportedCustomWidgets(widgets, { sourceUrl: url });
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
