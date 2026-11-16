import { state, saveState, SYSTEM_TAG_IMPORTED_ID, setBookmarkSystemTag, clearSystemTagFromAllBookmarks, saveSystemTags } from "../state.js";
import { loadConfig, saveConfig } from "../config.js";
import { t } from "../i18n.js";
import { getBookmarksTree } from "../bookmarks-api.js";
import { listBookmarkFolders, findBookmarkNodeById, buildImportedGroupsFromFolder, mergeImportedGroupsIntoState, countSkippedImportNodes, isBookmarkRootId } from "../browser-import.js";
import { render, calculateGridLayout } from "../render.js";
import { renderGroups } from "../groups.js";
import { updateChoiceOptionStates } from "./context.js";

const importWizardBtn = document.getElementById("import-wizard-btn");
const browserImportModal = document.getElementById("browser-import-modal");
const browserImportRootSelect = document.getElementById("browser-import-root");
const browserImportStructureSelect = document.getElementById("browser-import-structure");
const browserImportTargetGroupField = document.getElementById("browser-import-target-group-field");
const browserImportTargetGroupSelect = document.getElementById("browser-import-target-group");
const browserImportDepthSelect = document.getElementById("browser-import-depth");
const browserImportModeInputs = document.querySelectorAll('input[name="browser-import-mode"]');
const browserImportTagCheckbox = document.getElementById("browser-import-tag");
const browserImportPreview = document.getElementById("browser-import-preview");
const browserImportStatus = document.getElementById("browser-import-status");
const browserImportConfirmBtn = document.getElementById("browser-import-confirm");
const browserImportClearTagsBtn = document.getElementById("browser-import-clear-tags");
const browserImportCancelBtn = document.getElementById("browser-import-cancel");

export function initImportWizard({ setSyncStatusMessage }) {
  let browserImportTreeCache = null;

  function getSelectedBrowserImportMode() {
    for (const input of browserImportModeInputs) {
      if (input.checked) return input.value;
    }
    return "merge";
  }

  function updateTargetGroupFieldVisibility() {
    if (!browserImportTargetGroupField) return;
    const isSingleGroupMerge =
      (browserImportStructureSelect?.value || "groups") === "single-group" &&
      getSelectedBrowserImportMode() === "merge";
    browserImportTargetGroupField.classList.toggle("hidden", !isSingleGroupMerge);
  }

  function populateTargetGroupOptions() {
    if (!browserImportTargetGroupSelect) return;
    browserImportTargetGroupSelect.innerHTML = "";
    const newOpt = document.createElement("option");
    newOpt.value = "";
    newOpt.textContent = t("browserImportTargetGroupNew") || "Create new group (or match by name)";
    browserImportTargetGroupSelect.appendChild(newOpt);

    for (const group of (state.groups || []).filter(g => g && !g.deleted)) {
      const opt = document.createElement("option");
      opt.value = group.id;
      opt.textContent = group.name || "Group";
      browserImportTargetGroupSelect.appendChild(opt);
    }
  }

  function computeBrowserImportPlan() {
    if (!browserImportTreeCache || !browserImportRootSelect) return null;
    const rootNode = findBookmarkNodeById(browserImportTreeCache, browserImportRootSelect.value);
    if (!rootNode) return null;

    const structureMode = browserImportStructureSelect?.value || "groups";
    const maxDepth = browserImportDepthSelect?.value || "auto";
    const mode = getSelectedBrowserImportMode();
    const targetGroupId =
      structureMode === "single-group" && mode === "merge"
        ? (browserImportTargetGroupSelect?.value || null)
        : null;

    const importedGroups = buildImportedGroupsFromFolder(rootNode, {
      structureMode,
      maxDepth,
      fallbackGroupName: t("browserImportFallbackGroup") || "Imported bookmarks"
    });
    const plan = mergeImportedGroupsIntoState(state.groups, importedGroups, { mode, targetGroupId });
    plan.specialSkipped = countSkippedImportNodes(rootNode);
    return plan;
  }

  function updateBrowserImportPreview() {
    if (!browserImportPreview) return;
    const plan = computeBrowserImportPlan();
    if (!plan) {
      browserImportPreview.textContent = t("browserBookmarksEmpty");
      if (browserImportConfirmBtn) browserImportConfirmBtn.disabled = true;
      return;
    }

    const { stats, groupDetails = [], specialSkipped = 0 } = plan;
    const totalSkipped = stats.duplicatesSkipped + specialSkipped;

    browserImportPreview.innerHTML = "";
    const summaryEl = document.createElement("div");
    summaryEl.className = "browser-import-preview-summary";

    const groupsText = stats.groupsMatched > 0
      ? `${t("browserImportPreviewGroups") || "Groups"}: ${stats.groupsCreated + stats.groupsMatched} (${stats.groupsCreated} ${t("browserImportPreviewNew") || "new"}, ${stats.groupsMatched} ${t("browserImportPreviewMerge") || "merge"})`
      : `${t("browserImportPreviewGroups") || "Groups"}: ${stats.groupsCreated}`;

    const summaryItems = [
      groupsText,
      `${t("browserImportPreviewSections") || "Sections"}: ${stats.sectionsCreated}`,
      `${t("browserImportPreviewStacks") || "Stacks"}: ${stats.stacksCreated}`,
      `${t("browserImportPreviewBookmarks") || "Bookmarks"}: ${stats.bookmarksAdded}`,
      `${t("browserImportPreviewSkipped") || "Skipped"}: ${totalSkipped}${specialSkipped > 0 ? ` (${stats.duplicatesSkipped} dup, ${specialSkipped} internal)` : ""}`
    ];

    for (const text of summaryItems) {
      const span = document.createElement("span");
      span.textContent = text;
      summaryEl.appendChild(span);
    }
    browserImportPreview.appendChild(summaryEl);

    if (groupDetails.length > 0) {
      const listEl = document.createElement("div");
      listEl.className = "browser-import-preview-list";
      for (const detail of groupDetails) {
        const row = document.createElement("div");
        row.className = "browser-import-preview-row";

        const nameWrap = document.createElement("span");
        nameWrap.className = "browser-import-preview-name";
        const badge = document.createElement("span");
        badge.className = "browser-import-preview-badge";
        badge.textContent = detail.action === "merge"
          ? (t("browserImportPreviewMerge") || "merge")
          : (detail.action === "replace"
            ? (t("browserImportPreviewReplace") || "replace")
            : (t("browserImportPreviewNew") || "new"));
        const nameText = document.createElement("span");
        nameText.textContent = detail.name;
        nameText.title = detail.name;
        nameWrap.append(badge, nameText);

        const countsEl = document.createElement("span");
        countsEl.className = "browser-import-preview-counts";
        const detailParts = [`+${detail.bookmarksAdded} ${t("browserImportPreviewBookmarks") || "Bookmarks"}`];
        if (detail.sectionsCreated > 0) {
          detailParts.push(`${detail.sectionsCreated} ${t("browserImportPreviewSections") || "Sections"}`);
        }
        if (detail.stacksCreated > 0) {
          detailParts.push(`${detail.stacksCreated} ${t("browserImportPreviewStacks") || "Stacks"}`);
        }
        if (detail.duplicatesSkipped > 0) {
          detailParts.push(`${detail.duplicatesSkipped} ${t("browserImportPreviewSkipped") || "Skipped"}`);
        }
        countsEl.textContent = detailParts.join(" • ");

        row.append(nameWrap, countsEl);
        listEl.appendChild(row);
      }
      browserImportPreview.appendChild(listEl);
    }

    if (browserImportConfirmBtn) {
      browserImportConfirmBtn.disabled = stats.bookmarksAdded === 0;
    }
  }

  const closeBrowserImportModal = () => {
    browserImportModal?.classList.add("hidden");
  };

  if (importWizardBtn && browserImportModal) {
    importWizardBtn.addEventListener("click", async () => {
      try {
        if (browserImportStatus) browserImportStatus.textContent = "";
        browserImportTreeCache = await getBookmarksTree();
        const folders = listBookmarkFolders(browserImportTreeCache);

        if (browserImportRootSelect) {
          browserImportRootSelect.innerHTML = "";
          for (const folder of folders) {
            const opt = document.createElement("option");
            opt.value = folder.id;
            const indent = "\u00A0\u00A0".repeat(folder.depth);
            opt.textContent = `${indent}${folder.title} (${folder.totalBookmarks})`;
            browserImportRootSelect.appendChild(opt);
          }
          const firstNonZero = folders.find(f => !isBookmarkRootId(f.id) && f.totalBookmarks > 0);
          if (firstNonZero) {
            browserImportRootSelect.value = firstNonZero.id;
          }
        }

        populateTargetGroupOptions();
        updateTargetGroupFieldVisibility();
        updateChoiceOptionStates();
        updateBrowserImportPreview();
        browserImportModal.classList.remove("hidden");
      } catch (error) {
        console.error("Failed to load browser bookmarks tree", error);
        setSyncStatusMessage("❌ " + t("syncFailed"));
      }
    });
  }

  [browserImportRootSelect, browserImportStructureSelect, browserImportTargetGroupSelect, browserImportDepthSelect].forEach(sel => {
    sel?.addEventListener("change", () => {
      updateTargetGroupFieldVisibility();
      updateBrowserImportPreview();
    });
  });
  browserImportModeInputs.forEach(input => {
    input.addEventListener("change", () => {
      updateChoiceOptionStates();
      updateTargetGroupFieldVisibility();
      updateBrowserImportPreview();
    });
  });

  if (browserImportClearTagsBtn) {
    browserImportClearTagsBtn.addEventListener("click", async () => {
      const cleared = clearSystemTagFromAllBookmarks(SYSTEM_TAG_IMPORTED_ID);
      if (cleared > 0) {
        await saveSystemTags();
        try { await render(); } catch {}
      }
      if (browserImportStatus) {
        browserImportStatus.textContent = "✅ " + (t("browserImportClearTagsDone") || "Cleared Imported tag from {count} bookmark(s).").replace("{count}", String(cleared));
      }
    });
  }

  browserImportCancelBtn?.addEventListener("click", closeBrowserImportModal);
  browserImportModal?.addEventListener("click", (e) => {
    if (e.target === browserImportModal) closeBrowserImportModal();
  });

  if (browserImportConfirmBtn) {
    browserImportConfirmBtn.addEventListener("click", async () => {
      const plan = computeBrowserImportPlan();
      if (!plan || plan.stats.bookmarksAdded === 0) {
        if (browserImportStatus) browserImportStatus.textContent = "❌ " + t("browserBookmarksEmpty");
        return;
      }

      const mode = getSelectedBrowserImportMode();
      if (mode === "replace") {
        if (!confirm(t("browserBookmarksImportWarning"))) {
          return;
        }
        const config = await loadConfig();
        if (config.sync.enabled === true) {
          config.sync.enabled = false;
        }
        config.browserBookmarksAutoSync = false;
        await saveConfig(config);
      }

      state.groups = plan.groups;
      if (mode === "replace" || !state.groups.some(g => g.id === window.activeGroupId && !g.deleted)) {
        const firstActive = state.groups.find(g => g && !g.deleted);
        window.activeGroupId = firstActive ? firstActive.id : null;
      }
      await saveState();

      if (browserImportTagCheckbox?.checked && plan.importedBookmarkIds.length > 0) {
        for (const bookmarkId of plan.importedBookmarkIds) {
          setBookmarkSystemTag(bookmarkId, SYSTEM_TAG_IMPORTED_ID, true);
        }
        await saveSystemTags();
      }

      closeBrowserImportModal();
      renderGroups(true);
      await render();
      calculateGridLayout();

      const msg = (t("browserImportSuccess") || "Imported {count} bookmark(s).")
        .replace("{count}", String(plan.stats.bookmarksAdded));
      setSyncStatusMessage("✅ " + msg);
      alert(mode === "replace" ? `${msg}\n\n${t("syncDisabledAfterImport")}` : msg);
    });
  }
}
