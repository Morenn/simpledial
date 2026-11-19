import {
  state,
  saveState,
  generateId,
  getAllGroupBookmarks,
  findBookmarkLocation,
  SYSTEM_TAG_HTTP_ID,
  SYSTEM_TAG_DEAD_LINK_ID,
  SYSTEM_TAG_DUPLICATE_ID,
  setBookmarkSystemTag,
  clearSystemTagFromAllBookmarks,
  saveSystemTags,
  isReservedSystemTagName,
  getNextDefaultTagColor,
  getTagUsageCounts,
  deleteTagFromState,
  removeUnusedTagsFromState,
  updateTagInState
} from "../state.js";
import { loadConfig, saveConfig } from "../config.js";
import { cleanupDeletedItems, checkDeadLinks, syncWrite } from "../sync.js";
import { t } from "../i18n.js";
import { render, searchByBookmarkTag } from "../render.js";
import {
  getFailedIconRefreshBookmarks,
  setBookmarkIconExcludedById,
  clearFailedIconRefresh,
  clearAllFailedIconRefreshes,
  DEFAULT_FALLBACK_ICON_MAX_BYTES,
  DEFAULT_FALLBACK_ICON_MAX_DIM,
  getFallbackBookmarkIconUrl,
  isValidFallbackBookmarkIcon,
  setCustomFallbackBookmarkIcon
} from "../bookmarks.js";
import { getLocalExcludedIconDomainsText, setLocalExcludedIconDomainsText, isValidHexColor } from "../color-utils.js";
import { settingsState, markSettingsDirty, updateChoiceOptionStates } from "./context.js";

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
const hkDupByUrl = document.getElementById("hk-dup-by-url");
const hkDupByName = document.getElementById("hk-dup-by-name");
const hkCheckDuplicates = document.getElementById("hk-check-duplicates");
const hkClearDuplicates = document.getElementById("hk-clear-duplicates");
const hkDuplicatesStatus = document.getElementById("hk-duplicates-status");
const hkIconRefreshAll = document.getElementById("hk-icon-refresh-all");
const hkIconRefreshMissing = document.getElementById("hk-icon-refresh-missing");
const hkIconRefreshNone = document.getElementById("hk-icon-refresh-none");
const hkIconRefreshHours = document.getElementById("hk-icon-refresh-hours");
const hkIconExcludeDomains = document.getElementById("hk-icon-exclude-domains");
const hkDefaultIconPreview = document.getElementById("hk-default-icon-preview");
const hkDefaultIconEmojiInput = document.getElementById("hk-default-icon-emoji");
const hkDefaultIconUploadBtn = document.getElementById("hk-default-icon-upload-btn");
const hkDefaultIconResetBtn = document.getElementById("hk-default-icon-reset-btn");
const hkDefaultIconFile = document.getElementById("hk-default-icon-file");
const hkDefaultIconStatus = document.getElementById("hk-default-icon-status");
const hkShowFailedIcons = document.getElementById("hk-show-failed-icons");
const failedIconsModal = document.getElementById("failed-icons-modal");
const failedIconsTableBody = document.getElementById("failed-icons-table-body");
const failedIconsFilterInput = document.getElementById("failed-icons-filter");
const failedIconsExcludeAll = document.getElementById("failed-icons-exclude-all");
const failedIconsClear = document.getElementById("failed-icons-clear");
const failedIconsClose = document.getElementById("failed-icons-close");
const hkNewTagName = document.getElementById("hk-new-tag-name");
const hkNewTagColor = document.getElementById("hk-new-tag-color");
const hkAddTagBtn = document.getElementById("hk-add-tag-btn");
const hkRemoveUnusedTagsBtn = document.getElementById("hk-remove-unused-tags-btn");
const hkTagsList = document.getElementById("hk-tags-list");
const hkTagsStatus = document.getElementById("hk-tags-status");

let isSavingHkTags = false;

function setHkTagsStatus(message, color = "#4caf50") {
  if (!hkTagsStatus) return;
  hkTagsStatus.textContent = message;
  hkTagsStatus.style.color = color;
}

async function persistAndSyncTagChanges() {
  isSavingHkTags = true;
  try {
    await saveState();
  } finally {
    isSavingHkTags = false;
  }
  void syncWrite();
  try { render(); } catch {}
}

function renderHousekeeperTagsList() {
  if (!hkTagsList) return;
  const counts = getTagUsageCounts();
  const activeTags = (state.tags || []).filter(tag => tag && !tag.deleted);

  if (hkRemoveUnusedTagsBtn) {
    hkRemoveUnusedTagsBtn.disabled = !activeTags.some(tag => (counts.get(tag.id) || 0) === 0);
  }

  hkTagsList.innerHTML = "";
  if (activeTags.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "hk-tags-empty";
    emptyEl.textContent = t("hkBookmarkTagsEmpty") || "No bookmark tags created yet.";
    hkTagsList.appendChild(emptyEl);
    return;
  }

  for (const tag of activeTags) {
    const row = document.createElement("div");
    row.className = "hk-tag-row";
    const tagColor = isValidHexColor(tag.color) ? tag.color : "#4a6bff";
    row.style.setProperty("--tag-color", tagColor);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "hk-tag-color-input";
    colorInput.value = tagColor;
    colorInput.dataset.noDirty = "true";
    colorInput.title = t("edit") || "Edit";
    colorInput.setAttribute("aria-label", `${tag.name} color`);
    colorInput.addEventListener("change", async () => {
      const result = updateTagInState(tag.id, { name: tag.name, color: colorInput.value });
      if (!result) return;
      row.style.setProperty("--tag-color", result.tag.color);
      await persistAndSyncTagChanges();
      setHkTagsStatus(`✅ ${t("hkTagUpdated") || "Tag updated."}`);
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "sync-compact-input hk-tag-name-input";
    nameInput.maxLength = 24;
    nameInput.value = tag.name;
    nameInput.dataset.noDirty = "true";
    nameInput.setAttribute("aria-label", tag.name);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "icon-btn hk-tag-save-btn";
    saveBtn.textContent = t("save") || "Save";
    saveBtn.disabled = true;

    const syncSaveState = () => {
      const nextName = nameInput.value.trim();
      saveBtn.disabled = !nextName || nextName === tag.name || isReservedSystemTagName(nextName);
    };
    nameInput.addEventListener("input", syncSaveState);

    const commitRename = async () => {
      const nextName = nameInput.value.trim();
      if (!nextName || nextName === tag.name || isReservedSystemTagName(nextName)) {
        nameInput.value = tag.name;
        syncSaveState();
        return;
      }
      const result = updateTagInState(tag.id, { name: nextName, color: colorInput.value });
      if (!result) {
        nameInput.value = tag.name;
        syncSaveState();
        return;
      }
      await persistAndSyncTagChanges();
      renderHousekeeperTagsList();
      setHkTagsStatus(`✅ ${t("hkTagUpdated") || "Tag updated."}`);
    };

    saveBtn.addEventListener("click", () => {
      void commitRename();
    });

    nameInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitRename();
      } else if (e.key === "Escape" && nameInput.value.trim() !== tag.name) {
        e.preventDefault();
        e.stopPropagation();
        nameInput.value = tag.name;
        syncSaveState();
        nameInput.blur();
      }
    });

    const useCount = counts.get(tag.id) || 0;
    const usageBadge = document.createElement("button");
    usageBadge.type = "button";
    usageBadge.className = "hk-tag-usage-badge" + (useCount === 0 ? " is-unused" : "");
    usageBadge.textContent = (t("hkTagUsageCount") || "{0} bookmark(s)").replace("{0}", String(useCount));
    usageBadge.title = tag.name;
    usageBadge.addEventListener("click", () => {
      const settingsCancel = document.getElementById("settings-cancel");
      if (settingsCancel) {
        settingsCancel.click();
      } else {
        document.getElementById("settings-modal")?.classList.add("hidden");
      }
      searchByBookmarkTag(tag.name);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn danger hk-tag-delete-btn";
    deleteBtn.textContent = "🗑️";
    deleteBtn.title = t("delete") || "Delete";
    deleteBtn.setAttribute("aria-label", `${t("delete") || "Delete"} ${tag.name}`);
    deleteBtn.addEventListener("click", async () => {
      if (!deleteTagFromState(tag.id)) return;
      await persistAndSyncTagChanges();
      renderHousekeeperTagsList();
      setHkTagsStatus(`✅ ${t("hkTagDeleted") || "Tag deleted."}`);
    });

    row.append(colorInput, nameInput, saveBtn, usageBadge, deleteBtn);
    hkTagsList.appendChild(row);
  }
}

export function getHousekeeperIconRefreshMode() {
  if (hkIconRefreshNone?.checked) return "none";
  if (hkIconRefreshMissing?.checked) return "missing";
  return "all";
}

export function updateHousekeeperIconRefreshFrequencyEnabled() {
  if (!hkIconRefreshHours) return;
  hkIconRefreshHours.disabled = getHousekeeperIconRefreshMode() === "none";
}

export function updateDefaultFallbackIconPreview(draftOrConfig = null) {
  const candidate = draftOrConfig?.defaultBookmarkIcon ?? draftOrConfig?.appearance?.defaultBookmarkIcon;
  if (hkDefaultIconEmojiInput) {
    const str = typeof candidate === "string" ? candidate.trim() : "";
    hkDefaultIconEmojiInput.value = (str && !str.startsWith("data:") && isValidFallbackBookmarkIcon(str)) ? str : "";
  }
  if (!hkDefaultIconPreview) return;
  hkDefaultIconPreview.src = getFallbackBookmarkIconUrl(
    candidate !== undefined ? { appearance: { defaultBookmarkIcon: candidate } } : null
  );
}

export function updateHouseKeeperInfo(config) {
  if (!hkRetentionDays) return;

  hkRetentionDays.value = config.housekeeper.retentionDays || 30;

  if (hkAutoCleanup) {
    hkAutoCleanup.checked = config.housekeeper.autoCleanupEnabled || false;
  }

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
  if (hkIconExcludeDomains) {
    hkIconExcludeDomains.value = getLocalExcludedIconDomainsText();
  }
  if (hkDefaultIconStatus) {
    hkDefaultIconStatus.textContent = "";
  }
  updateDefaultFallbackIconPreview(settingsState.appearanceDraft || config);
  updateHousekeeperIconRefreshFrequencyEnabled();
  updateChoiceOptionStates();

  if (config.housekeeper.lastCleanup) {
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
  } else if (hkLastCleanup) {
    hkLastCleanup.textContent = "Last cleanup: Never";
  }

  if (hkNewTagName) hkNewTagName.value = "";
  if (hkNewTagColor) hkNewTagColor.value = getNextDefaultTagColor();
  if (hkTagsStatus) hkTagsStatus.textContent = "";
  renderHousekeeperTagsList();
}

export function applyHousekeeperToConfig(config) {
  config.housekeeper.retentionDays = parseInt(hkRetentionDays?.value, 10) || 30;
  config.housekeeper.autoCleanupEnabled = !!hkAutoCleanup?.checked;
  config.housekeeper.enableLinkCheck = !!hkEnableLinkCheck?.checked;
  config.housekeeper.iconAutoRefreshMode = getHousekeeperIconRefreshMode();
  config.housekeeper.iconAutoRefreshHours = Math.max(1, parseInt(hkIconRefreshHours?.value, 10) || 24);
  if (hkIconExcludeDomains) {
    setLocalExcludedIconDomainsText(hkIconExcludeDomains.value);
  }
}

function isHttpBookmarkUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    return new URL(url.trim()).protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeDuplicateUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeDuplicateName(title) {
  if (typeof title !== "string") return "";
  return title.trim().toLowerCase();
}

function processFallbackIconUpload(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("invalid-image"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("invalid-image"));
    reader.onload = () => {
      const rawDataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!rawDataUrl) {
        reject(new Error("invalid-image"));
        return;
      }
      if (file.type === "image/svg+xml") {
        if (rawDataUrl.length > DEFAULT_FALLBACK_ICON_MAX_BYTES) {
          reject(new Error("too-large"));
          return;
        }
        resolve(rawDataUrl);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error("invalid-image"));
      img.onload = () => {
        const maxDim = DEFAULT_FALLBACK_ICON_MAX_DIM;
        const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((img.width || maxDim) * scale));
        canvas.height = Math.max(1, Math.round((img.height || maxDim) * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("invalid-image"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let encoded = canvas.toDataURL("image/png");
        if (encoded.length > DEFAULT_FALLBACK_ICON_MAX_BYTES) {
          encoded = canvas.toDataURL("image/webp", 0.85);
        }
        if (encoded.length > DEFAULT_FALLBACK_ICON_MAX_BYTES) {
          reject(new Error("too-large"));
          return;
        }
        resolve(encoded);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function initHousekeeperSettings({ ensureAppearanceDraft }) {
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

        hkLinkCheckStatus.textContent = "✅ Link check completed.";
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

  if (hkClearErrors) {
    hkClearErrors.addEventListener("click", async () => {
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
        hkDeadLinksCount.textContent = "Dead links found: 0";

        try { render(); } catch {}
      } catch (error) {
        hkLinkCheckStatus.textContent = "❌ Clearing failed";
        hkLinkCheckStatus.style.color = "#f44336";
        console.error("Clear dead-link tags error:", error);
      } finally {
        hkClearErrors.disabled = false;
      }
    });
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
          try { render(); } catch {}
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

  if (hkCheckDuplicates) {
    hkCheckDuplicates.addEventListener("click", async () => {
      const matchByUrl = hkDupByUrl ? hkDupByUrl.checked : true;
      const matchByName = hkDupByName ? hkDupByName.checked : true;

      if (!matchByUrl && !matchByName) {
        if (hkDuplicatesStatus) {
          hkDuplicatesStatus.textContent = `⚠️ ${t("checkDuplicatesSelectOption")}`;
          hkDuplicatesStatus.style.color = "#f59e0b";
        }
        return;
      }

      hkCheckDuplicates.disabled = true;
      if (hkDuplicatesStatus) {
        hkDuplicatesStatus.textContent = `🔍 ${t("checkDuplicatesChecking")}`;
        hkDuplicatesStatus.style.color = "#999";
      }

      try {
        const items = [];
        const urlCounts = new Map();
        const nameCounts = new Map();

        for (const group of (state.groups || [])) {
          if (!group || group.deleted) continue;
          for (const item of getAllGroupBookmarks(group)) {
            const normUrl = matchByUrl ? normalizeDuplicateUrl(item.url) : "";
            const normName = matchByName ? normalizeDuplicateName(item.title) : "";
            if (normUrl) urlCounts.set(normUrl, (urlCounts.get(normUrl) || 0) + 1);
            if (normName) nameCounts.set(normName, (nameCounts.get(normName) || 0) + 1);
            items.push({ item, normUrl, normName });
          }
        }

        let duplicateCount = 0;
        let newlyTagged = 0;
        let changed = false;

        for (const { item, normUrl, normName } of items) {
          const isDuplicate =
            (normUrl && (urlCounts.get(normUrl) || 0) > 1) ||
            (normName && (nameCounts.get(normName) || 0) > 1);

          if (isDuplicate) {
            duplicateCount++;
            if (setBookmarkSystemTag(item.id, SYSTEM_TAG_DUPLICATE_ID, true)) {
              newlyTagged++;
              changed = true;
            }
          } else if (setBookmarkSystemTag(item.id, SYSTEM_TAG_DUPLICATE_ID, false)) {
            changed = true;
          }
        }

        if (changed) {
          await saveSystemTags();
          try { render(); } catch {}
        }

        if (hkDuplicatesStatus) {
          if (duplicateCount === 0) {
            hkDuplicatesStatus.textContent = `✅ ${t("checkDuplicatesNone")}`;
            hkDuplicatesStatus.style.color = "#4caf50";
          } else {
            const msg = t("checkDuplicatesFound")
              .replace("{count}", String(duplicateCount))
              .replace("{tagged}", String(newlyTagged));
            hkDuplicatesStatus.textContent = `🎭 ${msg}`;
            hkDuplicatesStatus.style.color = "#a855f7";
          }
        }
      } catch (error) {
        if (hkDuplicatesStatus) {
          hkDuplicatesStatus.textContent = `❌ ${t("checkDuplicatesFailed")}`;
          hkDuplicatesStatus.style.color = "#f44336";
        }
        console.error("Check duplicates error:", error);
      } finally {
        hkCheckDuplicates.disabled = false;
      }
    });
  }

  if (hkClearDuplicates) {
    hkClearDuplicates.addEventListener("click", async () => {
      hkClearDuplicates.disabled = true;
      try {
        const cleared = clearSystemTagFromAllBookmarks(SYSTEM_TAG_DUPLICATE_ID);
        if (cleared > 0) {
          await saveSystemTags();
          try { render(); } catch {}
        }
        if (hkDuplicatesStatus) {
          hkDuplicatesStatus.textContent = `✅ ${t("clearDuplicatesDone").replace("{count}", String(cleared))}`;
          hkDuplicatesStatus.style.color = "#4caf50";
        }
      } catch (error) {
        if (hkDuplicatesStatus) {
          hkDuplicatesStatus.textContent = `❌ ${t("checkDuplicatesFailed")}`;
          hkDuplicatesStatus.style.color = "#f44336";
        }
        console.error("Clear duplicate tags error:", error);
      } finally {
        hkClearDuplicates.disabled = false;
      }
    });
  }

  let failedIconsChanged = false;
  let failedIconsModalVisibleIds = new Set();

  function getFilteredFailedIcons() {
    const query = (failedIconsFilterInput?.value || "").trim().toLowerCase();
    const liveEntries = getFailedIconRefreshBookmarks();
    const byId = new Map(liveEntries.map(e => [e.id, e]));
    for (const id of failedIconsModalVisibleIds) {
      if (!byId.has(id)) {
        const loc = typeof findBookmarkLocation === "function" ? findBookmarkLocation(id) : null;
        const item = loc?.item;
        if (item && !item.deleted) {
          byId.set(id, {
            id: item.id,
            title: item.title || item.url || item.id,
            url: item.url || "",
            excluded: false
          });
        }
      }
    }
    const entries = [...byId.values()];
    if (!query) return entries;
    return entries.filter(entry =>
      entry.title.toLowerCase().includes(query) || entry.url.toLowerCase().includes(query)
    );
  }

  function renderFailedIconsTable() {
    if (!failedIconsTableBody) return;
    const entries = getFilteredFailedIcons();
    failedIconsTableBody.innerHTML = "";

    if (entries.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.className = "backups-empty";
      cell.textContent = t("failedIconRefreshesEmpty") || "No failed icon refreshes recorded.";
      row.appendChild(cell);
      failedIconsTableBody.appendChild(row);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement("tr");

      const titleCell = document.createElement("td");
      titleCell.textContent = entry.title;

      const urlCell = document.createElement("td");
      urlCell.className = "failed-icons-url-cell";
      urlCell.textContent = entry.url;
      urlCell.title = entry.url;

      const actionsCell = document.createElement("td");
      actionsCell.className = "failed-icons-actions-cell";
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = `icon-btn failed-icons-action-btn${entry.excluded ? "" : " primary"}`;
      toggleBtn.textContent = entry.excluded
        ? `✅ ${t("failedIconExcludedBtn")}`
        : `🚫 ${t("failedIconExcludeBtn")}`;
      toggleBtn.addEventListener("click", () => {
        setBookmarkIconExcludedById(entry.id, !entry.excluded);
        failedIconsChanged = true;
        renderFailedIconsTable();
      });

      const dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.className = "icon-btn failed-icons-action-btn";
      dismissBtn.textContent = "✖️";
      dismissBtn.title = t("delete") || "Remove";
      dismissBtn.addEventListener("click", () => {
        failedIconsModalVisibleIds.delete(entry.id);
        clearFailedIconRefresh(entry.id);
        renderFailedIconsTable();
      });

      actionsCell.append(toggleBtn, dismissBtn);
      row.append(titleCell, urlCell, actionsCell);
      failedIconsTableBody.appendChild(row);
    }
  }

  const closeFailedIconsModal = () => {
    if (!failedIconsModal) return;
    failedIconsModal.classList.add("hidden");
    failedIconsModalVisibleIds.clear();
    if (failedIconsChanged) {
      failedIconsChanged = false;
      try { render(); } catch {}
    }
  };

  if (failedIconsFilterInput) {
    failedIconsFilterInput.addEventListener("input", renderFailedIconsTable);
  }
  if (hkShowFailedIcons && failedIconsModal) {
    hkShowFailedIcons.addEventListener("click", () => {
      failedIconsChanged = false;
      failedIconsModalVisibleIds = new Set(getFailedIconRefreshBookmarks().map(e => e.id));
      if (failedIconsFilterInput) failedIconsFilterInput.value = "";
      renderFailedIconsTable();
      failedIconsModal.classList.remove("hidden");
    });
  }
  if (failedIconsClose && failedIconsModal) {
    failedIconsClose.addEventListener("click", closeFailedIconsModal);
  }
  if (failedIconsModal) {
    failedIconsModal.addEventListener("click", (e) => {
      if (e.target === failedIconsModal) {
        closeFailedIconsModal();
      }
    });
  }
  if (failedIconsExcludeAll) {
    failedIconsExcludeAll.addEventListener("click", () => {
      for (const entry of getFilteredFailedIcons()) {
        setBookmarkIconExcludedById(entry.id, true);
      }
      failedIconsChanged = true;
      renderFailedIconsTable();
    });
  }
  if (failedIconsClear) {
    failedIconsClear.addEventListener("click", () => {
      clearAllFailedIconRefreshes();
      failedIconsModalVisibleIds = new Set(getFailedIconRefreshBookmarks().map(e => e.id));
      renderFailedIconsTable();
    });
  }

  if (hkDefaultIconEmojiInput) {
    hkDefaultIconEmojiInput.addEventListener("input", async () => {
      const raw = hkDefaultIconEmojiInput.value.trim();
      if (raw && !isValidFallbackBookmarkIcon(raw)) {
        if (hkDefaultIconStatus) {
          hkDefaultIconStatus.textContent = `❌ ${t("defaultFallbackIconInvalid") || "Please enter a valid emoji or image."}`;
          hkDefaultIconStatus.style.color = "#f44336";
        }
        return;
      }
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      draft.defaultBookmarkIcon = raw || null;
      setCustomFallbackBookmarkIcon(draft.defaultBookmarkIcon);
      if (hkDefaultIconPreview) {
        hkDefaultIconPreview.src = getFallbackBookmarkIconUrl({ appearance: { defaultBookmarkIcon: draft.defaultBookmarkIcon } });
      }
      if (hkDefaultIconStatus) hkDefaultIconStatus.textContent = "";
      try { await render(); } catch {}
    });
  }

  if (hkDefaultIconUploadBtn && hkDefaultIconFile) {
    hkDefaultIconUploadBtn.addEventListener("click", () => {
      hkDefaultIconFile.value = "";
      hkDefaultIconFile.click();
    });
    hkDefaultIconFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await processFallbackIconUpload(file);
        if (!isValidFallbackBookmarkIcon(dataUrl)) {
          throw new Error("too-large");
        }
        markSettingsDirty();
        const draft = await ensureAppearanceDraft();
        draft.defaultBookmarkIcon = dataUrl;
        setCustomFallbackBookmarkIcon(dataUrl);
        updateDefaultFallbackIconPreview(draft);
        if (hkDefaultIconStatus) {
          hkDefaultIconStatus.textContent = "";
        }
        try { await render(); } catch {}
      } catch (err) {
        if (hkDefaultIconStatus) {
          const msg = err?.message === "too-large"
            ? (t("defaultFallbackIconTooLarge") || "Icon exceeds 200 KB limit after resizing to 128×128.")
            : (t("defaultFallbackIconInvalid") || "Please select a valid image file.");
          hkDefaultIconStatus.textContent = `❌ ${msg}`;
          hkDefaultIconStatus.style.color = "#f44336";
        }
      }
    });
  }

  if (hkDefaultIconResetBtn) {
    hkDefaultIconResetBtn.addEventListener("click", async () => {
      markSettingsDirty();
      const draft = await ensureAppearanceDraft();
      draft.defaultBookmarkIcon = null;
      setCustomFallbackBookmarkIcon(null);
      updateDefaultFallbackIconPreview(draft);
      if (hkDefaultIconStatus) {
        hkDefaultIconStatus.textContent = "";
      }
      try { await render(); } catch {}
    });
  }

  [hkIconRefreshAll, hkIconRefreshMissing, hkIconRefreshNone].forEach(input => {
    if (!input) return;
    input.addEventListener("change", () => {
      updateHousekeeperIconRefreshFrequencyEnabled();
      updateChoiceOptionStates();
    });
  });

  const addTagFromHousekeeper = async () => {
    if (!hkNewTagName) return;
    const rawName = hkNewTagName.value.trim();
    if (!rawName || isReservedSystemTagName(rawName)) {
      hkNewTagName.value = "";
      return;
    }

    if (!Array.isArray(state.tags)) {
      state.tags = [];
    }

    const color = isValidHexColor(hkNewTagColor?.value) ? hkNewTagColor.value : "#10b981";
    const existing = state.tags.find(
      tag => tag && !tag.deleted && tag.name.toLowerCase() === rawName.toLowerCase()
    );

    if (existing) {
      updateTagInState(existing.id, { name: existing.name, color });
    } else {
      state.tags.push({
        id: generateId("t"),
        name: rawName,
        color,
        updatedAt: Date.now(),
        deleted: false,
        deletedAt: null
      });
      if (hkNewTagColor) {
        hkNewTagColor.value = getNextDefaultTagColor();
      }
    }

    hkNewTagName.value = "";
    await persistAndSyncTagChanges();
    renderHousekeeperTagsList();
    setHkTagsStatus(`✅ ${t("hkTagUpdated") || "Tag updated."}`);
  };

  if (hkAddTagBtn) {
    hkAddTagBtn.addEventListener("click", () => {
      void addTagFromHousekeeper();
    });
  }

  if (hkNewTagName) {
    hkNewTagName.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        void addTagFromHousekeeper();
      }
    });
  }

  if (hkRemoveUnusedTagsBtn) {
    hkRemoveUnusedTagsBtn.addEventListener("click", async () => {
      const removed = removeUnusedTagsFromState();
      if (removed > 0) {
        await persistAndSyncTagChanges();
      }
      renderHousekeeperTagsList();
      setHkTagsStatus(
        `✅ ${(t("hkUnusedTagsRemoved") || "Removed {0} unused tag(s).").replace("{0}", String(removed))}`
      );
    });
  }

  window.addEventListener("speeddial:data-changed", () => {
    renderHousekeeperTagsList();
  });

  window.addEventListener("speeddial:state-saved", () => {
    if (!isSavingHkTags) {
      renderHousekeeperTagsList();
    }
  });
}
