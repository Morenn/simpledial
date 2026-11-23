import { state, saveState, saveActiveGroupId, isStackItem, getAllGroupBookmarks, SYSTEM_TAGS, getBookmarkSystemTagIds } from "./state.js";
import { renderGroups } from "./groups.js";
import {
  createBookmarkTile,
  createStackTile,
  openBookmarkModal,
  refreshOpenStackPopover,
  closeStackPopover,
  resetIconHydrationQueue,
  startIconHydrationAfterPaint
} from "./bookmarks.js";
import { loadConfig } from "./config.js";
import { syncWrite, syncNow, getLastSyncErrorReason, clearLastSyncErrorReason } from "./sync.js";
import { isVaultUnlocked, tryAutoUnlockVault } from "./crypto.js";
import { t } from "./i18n.js";

// ======================================================
// GRID LAYOUT CONSTANTS
// ======================================================
const TILE_HEIGHT = 43; // tile height + row gap (40px + 3px)
const COLUMN_WIDTH = 360; // column width in pixels (20% wider)
const INITIAL_HEIGHT_RATIO = 0.75; // Start with 70% of browser height
const MAX_HEIGHT_RATIO = 0.95; // Extend to 90% if needed

// ======================================================
// CALCULATE AND APPLY DYNAMIC GRID LAYOUT
// ======================================================
function getEffectiveTileScale() {
  const inlineScale = parseFloat(document.body?.style?.getPropertyValue?.("--tile-scale") || "");
  if (Number.isFinite(inlineScale) && inlineScale > 0) {
    return inlineScale;
  }
  return 1;
}

export function calculateGridLayout() {
  const main = document.querySelector("main");
  if (!main) return;

  const grid = document.getElementById("bookmarks-grid");
  const sectionsContainer = document.getElementById("sections-container");
  const centerBottomWidgets = document.getElementById("center-space-bottom-widgets");
  const sectionsHeight = (sectionsContainer && !sectionsContainer.classList.contains("hidden"))
    ? sectionsContainer.offsetHeight
    : 0;
  const bottomWidgetsHeight = centerBottomWidgets ? centerBottomWidgets.offsetHeight : 0;
  const scale = getEffectiveTileScale();
  const centerSpace = document.getElementById("center-space") || grid.parentElement;
  const centerWidth = centerSpace?.clientWidth || (main.clientWidth - 48);
  const availableWidth = Math.min(
    Math.floor(centerWidth * 0.92),
    Math.round(1200 * Math.max(1, scale))
  ) || grid.clientWidth || (main.clientWidth - 48);
  const availableHeight = Math.max(220, main.clientHeight - sectionsHeight - bottomWidgetsHeight - 80); // Subtract padding & sections height
  const baseTileHeight = document.body?.classList?.contains("tall-bookmark-tiles") ? 60 : 40;
  const tileHeight = Math.round(baseTileHeight * scale) + 3;
  const columnWidth = Math.round(COLUMN_WIDTH * scale);
  const columnGap = Math.round(16 * scale);

  // Get total number of tiles (including the add button if present)
  const tiles = grid.querySelectorAll(".bookmark-tile").length;

  if (tiles === 0) {
    grid.style.gridTemplateRows = `repeat(1, ${tileHeight}px)`;
    return;
  }

  let maxColumnsForWidth;
  if (availableWidth < columnWidth + 90) {
    // Mobile/narrow: force single column
    maxColumnsForWidth = 1;
  } else {
    // Desktop: calculate based on scaled column width + gap
    maxColumnsForWidth = Math.max(1, Math.floor(availableWidth / (columnWidth + columnGap)));
  }

  // Calculate tiles per column to fit within max columns
  // Prefer filling columns up to INITIAL_HEIGHT_RATIO before adding columns
  const tilesPerColumnFromHeight = Math.max(1, Math.floor((availableHeight * INITIAL_HEIGHT_RATIO) / tileHeight));

  let tilesPerColumn;
  // If using the height-limited tiles per column would require no more columns
  // than fit in the available width, prefer that; otherwise fall back to width-driven split.
  const requiredColumnsIfUsingHeight = Math.ceil(tiles / tilesPerColumnFromHeight);
  if (requiredColumnsIfUsingHeight <= maxColumnsForWidth) {
    tilesPerColumn = tilesPerColumnFromHeight;
  } else {
    tilesPerColumn = Math.ceil(tiles / maxColumnsForWidth);
  }

  // Adjust if height exceeds viewport, extending height limits gradually
  const requiredHeight = tilesPerColumn * tileHeight;

  if (requiredHeight > availableHeight) {
    // Try to optimize for viewport: try INITIAL_HEIGHT_RATIO and MAX_HEIGHT_RATIO
    const heightRatioInitial = Math.max(1, Math.floor((availableHeight * INITIAL_HEIGHT_RATIO) / tileHeight));
    const heightRatioMax = Math.max(1, Math.floor((availableHeight * MAX_HEIGHT_RATIO) / tileHeight));

    if (heightRatioInitial >= tilesPerColumn) {
      tilesPerColumn = heightRatioInitial;
    } else if (heightRatioMax >= tilesPerColumn) {
      tilesPerColumn = heightRatioMax;
    }
    // Otherwise allow scrolling beyond viewport
  }

  // Set grid template rows based on calculated tiles per column
  grid.style.gridTemplateRows = `repeat(${tilesPerColumn}, ${tileHeight}px)`;
}

// ======================================================
// FOOTER STATUS & COUNTERS
// ======================================================
function formatFooterLastSync(lastSyncMs) {
  if (!lastSyncMs || lastSyncMs <= 0) return null;

  const diffMins = Math.floor(Math.max(0, Date.now() - lastSyncMs) / 60000);
  if (diffMins < 1) {
    return t("footerLastSyncedJustNow");
  }
  if (diffMins < 60) {
    return t("footerLastSyncedMinutes").replace("{0}", String(diffMins));
  }
  if (diffMins < 1440) {
    return t("footerLastSyncedHours").replace("{0}", String(Math.floor(diffMins / 60)));
  }
  return t("footerLastSyncedDays").replace("{0}", String(Math.floor(diffMins / 1440)));
}

export function getSyncErrorLabel(reason) {
  switch (reason) {
    case "credentials-locked":
      return t("syncCredentialsLocked") || "Sync credentials are locked.";
    case "credentials-decrypt-failed":
      return t("syncCredentialsDecryptFailed") || "Failed to decrypt sync credentials.";
    case "credentials-missing":
      return t("syncCredentialsMissing") || "Sync credentials are missing.";
    case "auth":
      return t("wrongCredentials") || "Wrong credentials";
    case "timeout":
      return t("connectionTimeout") || "Connection timeout";
    case "invalid-url":
      return t("invalidUrl") || "Invalid URL";
    case "browser-sync-error":
      return t("browserSyncUnavailable") || "Browser sync unavailable";
    default:
      return t("syncServerUnavailable") || "Sync server is unavailable. Using local data.";
  }
}

export async function updateFooter(providedConfig = null) {
  const footerSyncStatus = document.getElementById("footer-sync-status");
  const footerSyncDot = document.getElementById("footer-sync-dot");
  const footerSyncText = document.getElementById("footer-sync-text");
  const footerBookmarksTotal = document.getElementById("footer-bookmarks-total");

  if (!footerSyncDot && !footerSyncText && !footerBookmarksTotal) return;

  const config = providedConfig || await loadConfig();
  const syncEnabled = !!config?.sync?.enabled;

  const usingBasic = syncEnabled && config?.sync?.type !== "browser" && config?.sync?.authMode === "basic";
  if (usingBasic && config?.sync?.encryptionMode === "vault" && config?.sync?.enc && !isVaultUnlocked()) {
    await tryAutoUnlockVault(config.vaultHeader);
  }
  const isVaultCredsLocked = usingBasic && config?.sync?.encryptionMode === "vault" && !!config?.sync?.enc && !isVaultUnlocked();
  const errorReason = syncEnabled ? getLastSyncErrorReason() : null;
  const isLocked = isVaultCredsLocked || errorReason === "credentials-locked";

  if (footerSyncDot) {
    if (isLocked) {
      footerSyncDot.className = "footer-status-dot locked";
      footerSyncDot.textContent = "🔐";
    } else if (errorReason) {
      footerSyncDot.className = "footer-status-dot error";
      footerSyncDot.textContent = "";
    } else {
      footerSyncDot.className = `footer-status-dot ${syncEnabled ? "active" : "disabled"}`;
      footerSyncDot.textContent = "";
    }
  }

  if (footerSyncText) {
    const statusPart = syncEnabled ? t("footerSyncActive") : t("footerSyncDisabled");
    const lastSyncStr = formatFooterLastSync(config?.sync?.lastSync);

    if (isLocked) {
      const lockedText = t("syncCredentialsLocked") || "Sync credentials are locked.";
      footerSyncText.textContent = `${lockedText} • ${lastSyncStr || t("footerNeverSynced")}`;
    } else if (errorReason) {
      footerSyncText.textContent = `⚠️ ${getSyncErrorLabel(errorReason)} • ${lastSyncStr || t("footerNeverSynced")}`;
    } else if (syncEnabled) {
      footerSyncText.textContent = `${statusPart} • ${lastSyncStr || t("footerNeverSynced")}`;
    } else {
      footerSyncText.textContent = lastSyncStr ? `${statusPart} • ${lastSyncStr}` : statusPart;
    }
  }

  if (footerSyncStatus) {
    if (isVaultCredsLocked && typeof window !== "undefined" && typeof window.promptUnlockVault === "function") {
      footerSyncStatus.style.cursor = "pointer";
      footerSyncStatus.title = t("vaultLockedClickToUnlock") || "Vault locked — click badge to unlock";
      footerSyncStatus.onclick = async () => {
        if (await window.promptUnlockVault()) {
          clearLastSyncErrorReason();
          await updateFooter();
        }
      };
    } else {
      footerSyncStatus.style.cursor = "";
      footerSyncStatus.title = "";
      footerSyncStatus.onclick = null;
    }
  }

  if (footerBookmarksTotal) {
    const totalBookmarks = (state.groups || [])
      .filter(g => !g.deleted)
      .reduce((sum, g) => sum + getAllGroupBookmarks(g, { includeDeleted: false }).filter(i => i.url).length, 0);

    footerBookmarksTotal.textContent = t("footerTotalBookmarks").replace("{0}", String(totalBookmarks));
  }
}

// ======================================================
// MAIN RENDER FUNCTION
// ======================================================

let activeRenderSeq = 0;

export async function render(providedConfig = null) {
  const seq = ++activeRenderSeq;
  const config = providedConfig || await loadConfig();
  if (seq !== activeRenderSeq) return;
  resetIconHydrationQueue();
  renderGroups(true, config);
  await renderBookmarks(config);
  if (seq !== activeRenderSeq) return;

  // Apply grid layout after rendering
  calculateGridLayout();
  if (typeof window !== "undefined") {
    window._restorePendingKeyboardFocus?.();
  }
  startIconHydrationAfterPaint();
}

// ======================================================
// SECTION RENDERING HELPER
// ======================================================
function renderTileForEntry(item, config) {
  const tile = isStackItem(item)
    ? createStackTile(item, config)
    : createBookmarkTile(item, config);
  if (item.deleted) tile.classList.add("deleted");
  return tile;
}

function buildSectionCard(group, section, sectionItems, config) {
  const sectionEl = document.createElement("section");
  sectionEl.className = "bookmark-section";
  sectionEl.dataset.sectionId = section.id;

  const header = document.createElement("div");
  header.className = "section-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "section-title-wrap";

  const titleEl = document.createElement("h3");
  titleEl.className = "section-title";
  titleEl.textContent = section.name || t("defaultSectionName") || "Section";

  const countBadge = document.createElement("span");
  countBadge.className = "section-count";
  countBadge.textContent = (t("itemsCount") || "{0} items").replace("{0}", String(sectionItems.length));

  const renameSectionHandler = async () => {
    const entered = prompt(t("renameSection") || "Rename section", section.name || "");
    if (entered === null) return;
    const trimmed = entered.trim();
    if (!trimmed) return;
    const now = Date.now();
    section.name = trimmed;
    section.updatedAt = now;
    group.updatedAt = now;
    await saveState();
    await syncWrite();
    render();
  };

  titleEl.addEventListener("dblclick", renameSectionHandler);

  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(countBadge);

  const actions = document.createElement("div");
  actions.className = "section-actions";

  const addBmBtn = document.createElement("button");
  addBmBtn.type = "button";
  addBmBtn.className = "section-action-btn section-add-bm-btn";
  addBmBtn.textContent = "+";
  addBmBtn.title = t("newBookmark") || "New bookmark";
  addBmBtn.addEventListener("click", () => {
    openBookmarkModal(null, { sectionId: section.id });
  });

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "section-action-btn section-rename-btn";
  renameBtn.textContent = "✎";
  renameBtn.title = t("renameSection") || "Rename section";
  renameBtn.addEventListener("click", renameSectionHandler);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "section-action-btn section-delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = t("deleteSection") || "Delete section";
  deleteBtn.addEventListener("click", async () => {
    const confirmMsg = (t("deleteSectionConfirm") || "Delete section \"{0}\"?").replace("{0}", section.name || "");
    if (!confirm(confirmMsg)) return;

    const now = Date.now();
    section.deleted = true;
    section.deletedAt = now;
    section.updatedAt = now;

    for (const item of (group.items || [])) {
      if (item && item.sectionId === section.id) {
        item.sectionId = null;
        item.updatedAt = now;
      }
    }
    group.updatedAt = now;

    await saveState();
    await syncWrite();
    render();
  });

  actions.appendChild(addBmBtn);
  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);

  header.appendChild(titleWrap);
  header.appendChild(actions);

  const sectionGrid = document.createElement("div");
  sectionGrid.className = "section-grid";
  sectionGrid.dataset.sectionId = section.id;

  sectionItems.forEach(item => {
    sectionGrid.appendChild(renderTileForEntry(item, config));
  });

  sectionEl.appendChild(header);
  sectionEl.appendChild(sectionGrid);
  return sectionEl;
}

// ======================================================
// RENDER BOOKMARKS
// ======================================================
async function renderBookmarks(providedConfig = null) {
  const config = providedConfig || await loadConfig();
  void updateFooter(config);
  const grid = document.getElementById("bookmarks-grid");
  const sectionsContainer = document.getElementById("sections-container");
  const workspaceToolbar = document.getElementById("workspace-toolbar");
  const addSectionBtn = document.getElementById("add-section-btn");
  const centerSpaceWidgets = document.getElementById("center-space-widgets");
  grid.innerHTML = "";
  if (sectionsContainer) sectionsContainer.innerHTML = "";

  const hasCenterWidgets = !!(
    centerSpaceWidgets &&
    Array.from(centerSpaceWidgets.children).some(el => !el.classList.contains("side-space-placeholder") && el.style.display !== "none")
  );
  const showDeleted = !!document.getElementById("show-deleted-toggle")?.checked;
  const searchText = document.getElementById("search-box")?.value.trim().toLowerCase() || "";

  // ============================================
  // 1) Global search across all groups (including stack children & tags)
  // ============================================
  if (searchText) {
    closeStackPopover();
    if (sectionsContainer) sectionsContainer.classList.add("hidden");
    if (addSectionBtn) addSectionBtn.classList.add("hidden");
    if (workspaceToolbar) workspaceToolbar.classList.toggle("hidden", !hasCenterWidgets);

    const activeTagById = new Map();
    for (const tag of SYSTEM_TAGS) {
      activeTagById.set(tag.id, tag.name.toLowerCase());
    }
    for (const tag of (state.tags || [])) {
      if (tag && !tag.deleted && tag.id) {
        activeTagById.set(tag.id, (tag.name || "").toLowerCase());
      }
    }

    const searchEntries = [];
    (state.groups || []).forEach(group => {
      if (!group) return;
      const sectionNameById = new Map(
        (group.sections || [])
          .filter(sec => sec && !sec.deleted && sec.id && sec.name)
          .map(sec => [sec.id, sec.name])
      );
      (group.items || []).forEach(item => {
        if (!item) return;
        const sectionName = item.sectionId ? (sectionNameById.get(item.sectionId) || "") : "";
        if (isStackItem(item)) {
          (item.children || []).forEach(child => {
            if (!child) return;
            searchEntries.push({
              ...child,
              deleted: !!(group.deleted || item.deleted || child.deleted),
              _groupId: group.id,
              _groupName: group.name || "",
              _sectionName: sectionName,
              _stackId: item.id,
              _stackTitle: item.title || ""
            });
          });
        } else {
          searchEntries.push({
            ...item,
            deleted: !!(group.deleted || item.deleted),
            _groupId: group.id,
            _groupName: group.name || "",
            _sectionName: sectionName,
            _stackId: null,
            _stackTitle: ""
          });
        }
      });
    });

    const filtered = searchEntries.filter(i => {
      if (i.deleted && !showDeleted) return false;

      const title = (i.title || "").toLowerCase();
      const url = (i.url || "").toLowerCase();
      const groupName = (i._groupName || "").toLowerCase();
      const sectionName = (i._sectionName || "").toLowerCase();
      const stackTitle = (i._stackTitle || "").toLowerCase();
      const allTagIds = [
        ...getBookmarkSystemTagIds(i.id),
        ...(Array.isArray(i.tags) ? i.tags : [])
      ];
      const tagMatches = allTagIds.some(tid => (activeTagById.get(tid) || "").includes(searchText));

      return (
        title.includes(searchText) ||
        url.includes(searchText) ||
        groupName.includes(searchText) ||
        (sectionName && sectionName.includes(searchText)) ||
        (stackTitle && stackTitle.includes(searchText)) ||
        tagMatches
      );
    });

    filtered.forEach(item => {
      const tile = createBookmarkTile(item, config);
      if (item.deleted) tile.classList.add("deleted");
      tile.classList.add("search-result");

      const locationParts = [item._groupName, item._sectionName, item._stackTitle].filter(Boolean);
      const locationLabel = locationParts.join(" / ");
      tile.setAttribute("data-group", locationLabel);

      const body = tile.querySelector(".bookmark-body");
      if (body && locationLabel) {
        const locationEl = document.createElement("div");
        locationEl.className = "search-result-location";
        locationEl.textContent = `📁 ${locationLabel}`;
        locationEl.title = locationLabel;
        body.appendChild(locationEl);
      }

      if (item._groupId) {
        const jumpBtn = document.createElement("button");
        jumpBtn.type = "button";
        jumpBtn.className = "search-jump-btn";
        jumpBtn.textContent = "📍";
        const jumpTitle = t("jumpToLocation");
        jumpBtn.title = jumpTitle;
        jumpBtn.setAttribute("aria-label", jumpTitle);
        jumpBtn.addEventListener("click", async e => {
          e.preventDefault();
          e.stopPropagation();

          window.activeGroupId = item._groupId;
          await saveActiveGroupId(item._groupId);

          if (searchInput) {
            searchInput.value = "";
            updateSearchClearButton();
          }

          await render();

          const targetId = item._stackId || item.id;
          if (targetId) {
            const targetTile = document.querySelector(`.bookmark-tile[data-bookmark-id="${CSS.escape(targetId)}"]`);
            if (targetTile) {
              targetTile.scrollIntoView({ behavior: "smooth", block: "center" });
              requestAnimationFrame(() => {
                targetTile.classList.remove("jump-highlight");
                void targetTile.offsetWidth;
                targetTile.classList.add("jump-highlight");
              });
              setTimeout(() => targetTile.classList.remove("jump-highlight"), 1850);
            }
          }
        });
        tile.appendChild(jumpBtn);
      }

      grid.appendChild(tile);
    });
    return;
  }

  // ============================================
  // 2) Normal workspace view for active group
  // ============================================
  const group = state.groups.find(g => g.id === window.activeGroupId && (showDeleted || !g.deleted));

  if (!group) {
    if (sectionsContainer) sectionsContainer.classList.add("hidden");
    if (addSectionBtn) addSectionBtn.classList.add("hidden");
    if (workspaceToolbar) workspaceToolbar.classList.toggle("hidden", !hasCenterWidgets);
    const emptyInfo = document.createElement("div");
    emptyInfo.className = "empty-info";
    emptyInfo.textContent = t("noActiveGroup");
    grid.appendChild(emptyInfo);
    return;
  }

  if (addSectionBtn) addSectionBtn.classList.remove("hidden");
  if (workspaceToolbar) workspaceToolbar.classList.remove("hidden");

  const activeSections = (Array.isArray(group.sections) ? group.sections : []).filter(s => s && !s.deleted);
  const activeSectionIds = new Set(activeSections.map(s => s.id));
  const visibleItems = (group.items || []).filter(i => {
    if (!i) return false;
    if (i.deleted && !showDeleted) return false;
    return true;
  });

  if (sectionsContainer) {
    if (activeSections.length > 0) {
      sectionsContainer.classList.remove("hidden");
      activeSections.forEach(section => {
        const sectionItems = visibleItems.filter(i => i.sectionId === section.id);
        sectionsContainer.appendChild(buildSectionCard(group, section, sectionItems, config));
      });
    } else {
      sectionsContainer.classList.add("hidden");
    }
  }

  const unsectionedItems = visibleItems.filter(i => !i.sectionId || !activeSectionIds.has(i.sectionId));
  unsectionedItems.forEach(item => {
    grid.appendChild(renderTileForEntry(item, config));
  });

  const addTile = document.createElement("div");
  addTile.className = "bookmark-tile add-bookmark";
  addTile.tabIndex = 0;
  addTile.textContent = "+";
  addTile.title = t("newBookmark") || "New bookmark";

  addTile.addEventListener("click", () => {
    openBookmarkModal(null, { sectionId: null });
  });

  grid.appendChild(addTile);

  await refreshOpenStackPopover(config);
  if (!document.body?.classList?.contains("tiles-locked")) {
    void import("./dragdrop.js").then(m => m.setupBookmarkDrag()).catch(() => {});
  }
}

// ======================================================
// REACTION TO SHOW DELETED TOGGLE CHANGE
// ======================================================

document.getElementById("show-deleted-toggle").addEventListener("change", () => {
  render();
});

// ======================================================
// SEARCH INPUT, EXPAND TOGGLE, CLEAR BUTTON & ESCAPE
// ======================================================

function updateSearchClearButton() {
  const search = document.getElementById("search-box");
  const clearBtn = document.getElementById("search-clear-btn");
  if (!search || !clearBtn) return;
  clearBtn.classList.toggle("hidden", search.value.length === 0);
}

const searchInput = document.getElementById("search-box");
const searchWidget = document.getElementById("search-widget");
const searchToggleBtn = document.getElementById("search-toggle-btn");
const searchClearBtn = document.getElementById("search-clear-btn");

if (searchInput) {
  updateSearchClearButton();
  searchInput.addEventListener("input", () => {
    updateSearchClearButton();
    render();
  });
}

export function searchByBookmarkTag(tagName) {
  if (!searchInput || typeof tagName !== "string") return;
  const trimmed = tagName.trim();
  if (!trimmed) return;
  if (searchWidget && !searchWidget.classList.contains("expanded")) {
    searchWidget.classList.add("expanded");
  }
  searchInput.value = trimmed;
  updateSearchClearButton();
  render();
}
window.searchByBookmarkTag = searchByBookmarkTag;

export function clearBookmarkSearch({ focus = false, collapse = true, rerender = true } = {}) {
  if (!searchInput) return;
  const hadFilter = searchInput.value.trim() !== "";
  const hadValue = searchInput.value !== "";
  if (hadValue) {
    searchInput.value = "";
    updateSearchClearButton();
    if (rerender && hadFilter) {
      render();
    }
  }
  if (collapse && searchWidget && (searchWidget.classList.contains("search-mode-icon") || searchWidget.classList.contains("search-mode-hover")) && searchWidget.classList.contains("expanded")) {
    searchWidget.classList.remove("expanded");
    if (!focus && document.activeElement === searchInput) {
      searchInput.blur();
    }
  }
  if (focus) {
    searchInput.focus();
  }
}

if (searchClearBtn && searchInput) {
  searchClearBtn.addEventListener("click", () => {
    clearBookmarkSearch({ focus: true, collapse: false, rerender: true });
  });
}

if (searchToggleBtn && searchWidget && searchInput) {
  searchToggleBtn.addEventListener("click", () => {
    if (!searchWidget.classList.contains("expanded")) {
      searchWidget.classList.add("expanded");
      searchInput.focus();
    } else if (searchInput.value.trim() === "") {
      searchWidget.classList.remove("expanded");
    } else {
      searchInput.focus();
    }
  });

  let searchHoverCollapseTimer = null;

  searchWidget.addEventListener("mouseenter", () => {
    if (!searchWidget.classList.contains("search-mode-hover")) return;
    if (searchHoverCollapseTimer) {
      clearTimeout(searchHoverCollapseTimer);
      searchHoverCollapseTimer = null;
    }
    searchWidget.classList.add("expanded");
    searchInput.focus();
  });

  searchWidget.addEventListener("mouseleave", () => {
    if (!searchWidget.classList.contains("search-mode-hover")) return;
    if (searchHoverCollapseTimer) {
      clearTimeout(searchHoverCollapseTimer);
    }
    searchHoverCollapseTimer = setTimeout(() => {
      searchHoverCollapseTimer = null;
      if (searchWidget.classList.contains("search-mode-hover") && searchInput.value.trim() === "") {
        searchWidget.classList.remove("expanded");
        if (document.activeElement === searchInput) {
          searchInput.blur();
        }
      }
    }, 160);
  });
}

document.addEventListener("click", e => {
  if (!searchWidget || !searchInput) return;
  const target = e.target;
  if (searchWidget.contains(target)) return;

  if (searchWidget.classList.contains("search-mode-icon") && searchWidget.classList.contains("expanded") && searchInput.value.trim() === "") {
    searchWidget.classList.remove("expanded");
  }

  const contextMenu = document.getElementById("context-menu");
  const contextMenuOpen = contextMenu && !contextMenu.classList.contains("hidden") && contextMenu.style.display !== "none";
  if (contextMenuOpen || document.querySelector(".modal:not(.hidden)")) {
    return;
  }

  const nonEmptyTarget = target?.closest?.(
    ".bookmark-tile, .bookmark-tag-badge, .group-tab, .groups-dropdown-container, #stack-popover, #context-menu, .modal, .custom-search-widget, .custom-timezone-widget, button, a, input, select, textarea, label, [role='button']"
  );
  if (!nonEmptyTarget) {
    clearBookmarkSearch({ collapse: true, rerender: true });
  }
});

// ======================================================
// DELETE SEARCH TEXT & COLLAPSE SEARCH ON ESCAPE KEY
// ======================================================

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    clearBookmarkSearch({ collapse: true, rerender: true });
  }
});
// ======================================================
// RESPONSIVE GRID LAYOUT ON WINDOW RESIZE
// ======================================================

let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // Re-render groups to check if dropdown is needed
    renderGroups(true);
    // Recalculate grid layout
    calculateGridLayout();
  }, 250); // Debounce to avoid excessive recalculations
});

if (typeof ResizeObserver !== "undefined") {
  let layoutRafId = 0;
  let lastLayoutSig = "";
  const scheduleLayoutRecalc = () => {
    if (layoutRafId) return;
    layoutRafId = requestAnimationFrame(() => {
      layoutRafId = 0;
      const main = document.querySelector("main");
      const centerSpace = document.getElementById("center-space");
      const sectionsContainer = document.getElementById("sections-container");
      const centerBottomWidgets = document.getElementById("center-space-bottom-widgets");
      const sig = `${main?.clientHeight || 0}:${centerSpace?.clientWidth || 0}:${sectionsContainer?.offsetHeight || 0}:${centerBottomWidgets?.offsetHeight || 0}`;
      if (sig === lastLayoutSig) return;
      lastLayoutSig = sig;
      calculateGridLayout();
    });
  };
  const layoutObserver = new ResizeObserver(scheduleLayoutRecalc);
  for (const el of [
    document.querySelector("main"),
    document.getElementById("center-space"),
    document.getElementById("sections-container"),
    document.getElementById("center-space-bottom-widgets")
  ]) {
    if (el) layoutObserver.observe(el);
  }
}