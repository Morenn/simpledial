import { state, saveState, generateId, isStackItem } from "../state.js";
import { loadConfig, saveConfig } from "../config.js";
import { t } from "../i18n.js";
import { findOrCreateSimpleDialFolder, getBookmarkChildren } from "../bookmarks-api.js";
import { render, calculateGridLayout } from "../render.js";
import { createBackup, listBackups, restoreBackup, restoreBackupFromJson, deleteBackup, cleanupOldBackups, getBackup } from "../backup.js";
import { syncBrowserBookmarks } from "../browser-bookmarks-sync.js";
import { settingsState, setSettingsDirty } from "./context.js";
import { initImportWizard } from "./importwizard-ui.js";

const settingsModal = document.getElementById("settings-modal");
const backupRetentionDays = document.getElementById("backup-retention-days");
const backupFrequencyHours = document.getElementById("backup-frequency-hours");
const backupCreateNowBtn = document.getElementById("backup-create-now");
const backupUploadRestoreBtn = document.getElementById("backup-upload-restore-btn");
const backupUploadRestoreFile = document.getElementById("backup-upload-restore-file");
const backupStatus = document.getElementById("backup-status");
const backupsTableBody = document.getElementById("backups-table-body");
const backupSubtabBtns = document.querySelectorAll(".backups-subtab-btn");

const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
const exportBookmarksBtn = document.getElementById("export-bookmarks-btn");
const importBookmarksBtn = document.getElementById("import-bookmarks-btn");
const browserBookmarksOverwriteModal = document.getElementById("browser-bookmarks-overwrite-modal");
const browserBookmarksOverwriteCheckbox = document.getElementById("browser-bookmarks-overwrite-checkbox");
const browserBookmarksOverwriteConfirmBtn = document.getElementById("browser-bookmarks-overwrite-confirm");
const browserBookmarksOverwriteCancelBtn = document.getElementById("browser-bookmarks-overwrite-cancel");
const exportNetscapeBtn = document.getElementById("export-netscape-btn");
const importNetscapeBtn = document.getElementById("import-netscape-btn");
const importNetscapeFile = document.getElementById("import-netscape-file");
const browserBookmarksAutoSync = document.getElementById("browser-bookmarks-auto-sync");

const MAX_BACKUP_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB

let currentBackupTabType = "bookmarks";

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
    let customWidgetCount = typeof backup.customWidgetCount === "number" ? backup.customWidgetCount : null;
    if (customWidgetCount === null && typeof backup.data === "string") {
      try {
        const parsed = JSON.parse(backup.data);
        customWidgetCount = Array.isArray(parsed?.appearance?.customWidgets) ? parsed.appearance.customWidgets.length : 0;
      } catch {
        customWidgetCount = 0;
      }
    }
    const widgetsLabel = t("customWidgetsTab") || "Custom Widgets";
    return `${t("themeSelect")} ${themeLabel} (${settingCount}) • ${widgetsLabel}: ${customWidgetCount ?? 0}`;
  }
  const stats = getBackupStats(backup);
  return `G:${stats.groupCount} B:${stats.bookmarkCount}`;
}

export async function refreshBackupsTable() {
  if (!backupsTableBody) return;

  const activeType = currentBackupTabType;
  const backups = await listBackups(activeType);
  backupsTableBody.innerHTML = "";

  if (!backups.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "backups-empty";
    cell.textContent = t("noBackupsYet");
    row.appendChild(cell);
    backupsTableBody.appendChild(row);
    return;
  }

  let currentAddonVersion = null;
  try {
    currentAddonVersion = chrome?.runtime?.getManifest?.()?.version || null;
  } catch {
    currentAddonVersion = null;
  }

  backups.forEach(backup => {
    const row = document.createElement("tr");

    const timestampCell = document.createElement("td");
    timestampCell.textContent = formatBackupTimestamp(backup.timestamp);

    let backupVersion = typeof backup.addonVersion === "string" && backup.addonVersion ? backup.addonVersion : null;
    if (!backupVersion && typeof backup.data === "string") {
      try {
        const parsed = JSON.parse(backup.data);
        if (typeof parsed?.addonVersion === "string" && parsed.addonVersion) {
          backupVersion = parsed.addonVersion;
        }
      } catch {
        // ignore
      }
    }
    const versionCell = document.createElement("td");
    if (backupVersion) {
      const differs = currentAddonVersion && backupVersion !== currentAddonVersion;
      versionCell.textContent = differs ? `v${backupVersion} ⚠️` : `v${backupVersion}`;
    } else {
      versionCell.textContent = "—";
    }

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
    row.appendChild(versionCell);
    row.appendChild(sizeCell);
    row.appendChild(statsCell);
    row.appendChild(actionsCell);
    backupsTableBody.appendChild(row);
  });
}

export function populateBackupSettings(config) {
  if (browserBookmarksAutoSync) {
    browserBookmarksAutoSync.checked = !!config.browserBookmarksAutoSync;
  }
  if (backupRetentionDays) {
    backupRetentionDays.value = config.backups?.retentionDays || 14;
  }
  if (backupFrequencyHours) {
    backupFrequencyHours.value = config.backups?.frequencyHours || 24;
  }
}

export function applyBackupToConfig(config) {
  config.browserBookmarksAutoSync = !!browserBookmarksAutoSync?.checked;
  config.backups.retentionDays = Math.max(1, parseInt(backupRetentionDays?.value, 10) || 14);
  config.backups.frequencyHours = Math.max(1, parseInt(backupFrequencyHours?.value, 10) || 24);
}

export function initBackupSettings({ setSyncStatusMessage, revertAppearancePreviewToSaved, updateDateTimeVisibility }) {
  if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
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
  }

  if (importBtn && importFile) {
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
          alert(t("importedSuccessfully") + "\n\n" + t("syncDisabledAfterImport"));

          settingsModal?.classList.add("hidden");
          window.location.reload();
        } catch (error) {
          alert(`${t("failedToParse")} ${error.message}`);
        }
      };

      reader.readAsText(file);
    });
  }

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

        alert(t("importedSuccessfully") + "\n\n" + t("syncDisabledAfterImport"));

        settingsModal?.classList.add("hidden");
        window.location.reload();
      } catch (error) {
        alert(`${t("failedToParse")} ${error.message}`);
      }
    };

    reader.readAsText(file);
  });

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

      setSyncStatusMessage("✅ " + t("bookmarksExportSuccessful"));
      alert(t("bookmarksExportSuccessful"));
    } catch (error) {
      console.error("Export to browser bookmarks failed", error);
      setSyncStatusMessage("❌ " + t("syncFailed"));
      alert(t("syncFailed"));
    }
  });

  async function executeSimpleDialFolderImport() {
    try {
      const folder = await findOrCreateSimpleDialFolder();
      const children = await getBookmarkChildren(folder.id);
      if (!children || children.length === 0) {
        alert(t("browserBookmarksEmpty"));
        return;
      }

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
        const sortedGroupChildren = (groupChildren || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        for (const item of sortedGroupChildren) {
          if (!item.url) continue;
          items.push({
            id: generateId("b"),
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
          id: generateId("g"),
          name: child.title || "Group",
          items,
          updatedAt: Date.now(),
          deleted: false,
          deletedAt: null
        });
      }

      if (orphanItems.length > 0) {
        const sortedOrphanItems = orphanItems.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        importedGroups.unshift({
          id: generateId("g"),
          name: "Imported bookmarks",
          items: sortedOrphanItems.map(item => ({
            id: generateId("b"),
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
        alert(t("browserBookmarksEmpty"));
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

      alert(t("bookmarksImportSuccessful") + "\n\n" + t("syncDisabledAfterImport"));
      settingsModal?.classList.add("hidden");
      window.location.reload();
    } catch (error) {
      console.error("Import from browser bookmarks failed", error);
      setSyncStatusMessage("❌ " + t("syncFailed"));
      alert(t("syncFailed"));
    }
  }

  importBookmarksBtn?.addEventListener("click", () => {
    if (browserBookmarksOverwriteModal) {
      if (browserBookmarksOverwriteCheckbox) {
        browserBookmarksOverwriteCheckbox.checked = false;
      }
      if (browserBookmarksOverwriteConfirmBtn) {
        browserBookmarksOverwriteConfirmBtn.disabled = true;
      }
      browserBookmarksOverwriteModal.classList.remove("hidden");
      return;
    }
    if (confirm(t("browserBookmarksImportWarning"))) {
      void executeSimpleDialFolderImport();
    }
  });

  browserBookmarksOverwriteCheckbox?.addEventListener("change", () => {
    if (browserBookmarksOverwriteConfirmBtn) {
      browserBookmarksOverwriteConfirmBtn.disabled = !browserBookmarksOverwriteCheckbox.checked;
    }
  });

  browserBookmarksOverwriteCancelBtn?.addEventListener("click", () => {
    browserBookmarksOverwriteModal?.classList.add("hidden");
  });

  browserBookmarksOverwriteModal?.addEventListener("click", (e) => {
    if (e.target === browserBookmarksOverwriteModal) {
      browserBookmarksOverwriteModal.classList.add("hidden");
    }
  });

  browserBookmarksOverwriteConfirmBtn?.addEventListener("click", async () => {
    if (browserBookmarksOverwriteCheckbox && !browserBookmarksOverwriteCheckbox.checked) {
      return;
    }
    browserBookmarksOverwriteModal?.classList.add("hidden");
    await executeSimpleDialFolderImport();
  });

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

  const applyRestoredBackupResult = async (result, restoredType) => {
    if (restoredType === "config" && result.config) {
      settingsState.pendingLanguageReset = false;
      setSettingsDirty(false);
      await revertAppearancePreviewToSaved();
      updateDateTimeVisibility(result.config.appearance?.dateTimeSpace !== "disabled");
      await render();
      calculateGridLayout();
      if (result.secretsRemoved) {
        const warningMsg = t("backupConfigRestoredSecretsWarning")
          || "Configuration restored. Widget secrets are not stored in backups — please re-enter your API tokens.";
        if (backupStatus) {
          backupStatus.textContent = "⚠️ " + warningMsg;
        }
        alert(warningMsg);
      } else if (backupStatus) {
        backupStatus.textContent = "✅ " + t("backupConfigRestored");
      }
    } else {
      await refreshBackupsTable();
      if (backupStatus) {
        backupStatus.textContent = `⚠️ ${result.warning}`;
      }
      alert(result.warning);
    }
  };

  if (backupUploadRestoreBtn && backupUploadRestoreFile) {
    backupUploadRestoreBtn.addEventListener("click", () => {
      backupUploadRestoreFile.click();
    });

    backupUploadRestoreFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_BACKUP_UPLOAD_BYTES) {
        const msg = t("backupFileTooLarge") || "Backup file is too large (max 3 MB).";
        if (backupStatus) backupStatus.textContent = "❌ " + msg;
        alert(msg);
        backupUploadRestoreFile.value = "";
        return;
      }
      try {
        const text = await file.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          alert(t("invalidFileFormat"));
          return;
        }
        const detectedType = (parsed && typeof parsed.appearance === "object" && parsed.appearance !== null && !Array.isArray(parsed.appearance))
          ? "config"
          : (parsed && Array.isArray(parsed.groups) ? "bookmarks" : null);
        if (!detectedType) {
          alert(t("invalidFileFormat"));
          return;
        }
        const confirmKey = detectedType === "config"
          ? "confirmRestoreConfigBackup"
          : "confirmRestoreBackup";
        const trustWarning = t("backupUploadTrustWarning")
          || "Only restore backup files from trusted sources.";
        if (!confirm(`⚠️ ${trustWarning}\n\n${t(confirmKey)}`)) return;
        const result = await restoreBackupFromJson(text, detectedType, file.name);
        await applyRestoredBackupResult(result, detectedType);
      } catch (error) {
        if (backupStatus) backupStatus.textContent = "❌ " + t("backupRestoreFailed");
        console.error("restoreBackupFromJson failed", error);
      } finally {
        backupUploadRestoreFile.value = "";
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
          await applyRestoredBackupResult(result, currentBackupTabType);
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

  initImportWizard({ setSyncStatusMessage });
}
