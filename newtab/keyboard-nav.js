let keyboardNavInitialized = false;
let pendingFocusGroupId = null;
let pendingFocusDropdownBtn = false;
let lastFocusedBeforeShortcutsModal = null;

function translateKey(key) {
  return (typeof window !== "undefined" && typeof window.t === "function") ? window.t(key) : "";
}

/**
 * Compute the best spatial neighbor index for 2D keyboard navigation.
 * @param {Array<{left: number, top: number, width: number, height: number}>} rects
 * @param {number} currentIndex
 * @param {"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"} direction
 * @param {"grid"|"groups"} mode
 * @returns {number}
 */
export function findSpatialNeighbor(rects, currentIndex, direction, mode = "grid") {
  if (!Array.isArray(rects) || currentIndex < 0 || currentIndex >= rects.length) {
    return -1;
  }

  if (mode === "groups") {
    if (direction === "ArrowRight") {
      return currentIndex + 1 < rects.length ? currentIndex + 1 : -1;
    }
    if (direction === "ArrowLeft") {
      return currentIndex - 1 >= 0 ? currentIndex - 1 : -1;
    }
  }

  const normalized = rects.map((r, index) => ({
    index,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2
  }));

  const cur = normalized[currentIndex];

  if (direction === "ArrowRight" || direction === "ArrowLeft") {
    const isRight = direction === "ArrowRight";
    const threshold = Math.max(8, cur.width * 0.35);
    const candidates = normalized.filter(item =>
      item.index !== currentIndex &&
      (isRight ? item.cx > cur.cx + threshold : item.cx < cur.cx - threshold)
    );
    if (candidates.length === 0) return -1;

    const dxOf = item => (isRight ? item.cx - cur.cx : cur.cx - item.cx);
    const minDx = Math.min(...candidates.map(dxOf));
    const colTolerance = Math.max(20, cur.width * 0.5);
    const adjacentCol = candidates.filter(item => dxOf(item) <= minDx + colTolerance);

    adjacentCol.sort((a, b) => {
      const dyDiff = Math.abs(a.cy - cur.cy) - Math.abs(b.cy - cur.cy);
      if (Math.abs(dyDiff) > 1) return dyDiff;
      return dxOf(a) - dxOf(b);
    });
    return adjacentCol[0].index;
  }

  if (direction === "ArrowDown" || direction === "ArrowUp") {
    const isDown = direction === "ArrowDown";
    const threshold = mode === "groups" ? Math.max(4, cur.height * 0.35) : 4;
    const candidates = normalized.filter(item =>
      item.index !== currentIndex &&
      (isDown ? item.cy > cur.cy + threshold : item.cy < cur.cy - threshold)
    );
    if (candidates.length === 0) return -1;

    const dyOf = item => (isDown ? item.cy - cur.cy : cur.cy - item.cy);

    if (mode === "grid") {
      const sameCol = candidates.filter(item =>
        Math.abs(item.cx - cur.cx) <= Math.max(20, Math.max(cur.width, item.width) * 0.5)
      );
      if (sameCol.length > 0) {
        sameCol.sort((a, b) => {
          const dyDiff = dyOf(a) - dyOf(b);
          if (Math.abs(dyDiff) > 1) return dyDiff;
          return Math.abs(a.cx - cur.cx) - Math.abs(b.cx - cur.cx);
        });
        return sameCol[0].index;
      }
    }

    const minDy = Math.min(...candidates.map(dyOf));
    const rowTolerance = Math.max(10, cur.height * 0.5);
    const adjacentRow = candidates.filter(item => dyOf(item) <= minDy + rowTolerance);

    adjacentRow.sort((a, b) => {
      const dxDiff = Math.abs(a.cx - cur.cx) - Math.abs(b.cx - cur.cx);
      if (Math.abs(dxDiff) > 1) return dxDiff;
      return dyOf(a) - dyOf(b);
    });
    return adjacentRow[0].index;
  }

  return -1;
}

export function setPendingFocusGroupId(groupId) {
  pendingFocusGroupId = groupId || null;
  pendingFocusDropdownBtn = false;
}

export function setPendingFocusDropdownBtn(enabled = true) {
  pendingFocusDropdownBtn = !!enabled;
  if (enabled) pendingFocusGroupId = null;
}

export function restorePendingKeyboardFocus() {
  if (typeof document === "undefined") return;
  syncRovingTabIndex();
  if (pendingFocusDropdownBtn) {
    pendingFocusDropdownBtn = false;
    const dropdownBtn = document.querySelector("#groups-header .groups-dropdown-btn");
    if (dropdownBtn && isVisibleElement(dropdownBtn)) {
      focusElement(dropdownBtn);
    }
    return;
  }
  if (!pendingFocusGroupId) return;
  const targetId = pendingFocusGroupId;
  pendingFocusGroupId = null;
  const tab = Array.from(document.querySelectorAll("#groups-header .group-tab[data-group-id]"))
    .find(el => el.dataset.groupId === targetId);
  if (tab) {
    focusElement(tab);
  }
}

export function syncRovingTabIndex() {
  if (typeof document === "undefined") return;
  const groupTabs = getVisibleGroupTabs();
  if (groupTabs.length > 0) {
    const activeTab = groupTabs.find(t => t.classList.contains("active")) || groupTabs[0];
    groupTabs.forEach(t => {
      t.tabIndex = t === activeTab ? 0 : -1;
    });
  }
  const bookmarkTiles = getVisibleBookmarkTiles();
  if (bookmarkTiles.length > 0) {
    const current = bookmarkTiles.find(t => t === document.activeElement) || bookmarkTiles[0];
    bookmarkTiles.forEach(t => {
      t.tabIndex = t === current ? 0 : -1;
    });
  }
}

function isVisibleElement(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Determine where the groups container sits relative to the bookmarks area.
 * @param {{left: number, top: number, right: number, bottom: number, width: number, height: number}} groupRect
 * @param {{left: number, top: number, right: number, bottom: number, width: number, height: number}} bookmarksRect
 * @returns {"above"|"below"|"left"|"right"|null}
 */
export function getRelativeGroupPosition(groupRect, bookmarksRect) {
  if (!groupRect || !bookmarksRect) return null;
  if (groupRect.width <= 0 || groupRect.height <= 0 || bookmarksRect.width <= 0 || bookmarksRect.height <= 0) {
    return null;
  }
  if (groupRect.bottom <= bookmarksRect.top + 8) return "above";
  if (groupRect.top >= bookmarksRect.bottom - 8) return "below";
  if (groupRect.right <= bookmarksRect.left + 8) return "left";
  if (groupRect.left >= bookmarksRect.right - 8) return "right";
  const gCy = groupRect.top + groupRect.height / 2;
  const bCy = bookmarksRect.top + bookmarksRect.height / 2;
  return gCy <= bCy ? "above" : "below";
}

function detectGroupPositionRelativeToBookmarks() {
  const header = document.getElementById("groups-header");
  if (!header || !isVisibleElement(header)) return null;
  const sectionsContainer = document.getElementById("sections-container");
  const grid = document.getElementById("bookmarks-grid");
  const bookmarksArea = (sectionsContainer && !sectionsContainer.classList.contains("hidden") && isVisibleElement(sectionsContainer))
    ? sectionsContainer
    : grid;
  if (!bookmarksArea || !isVisibleElement(bookmarksArea)) return "above";
  return getRelativeGroupPosition(header.getBoundingClientRect(), bookmarksArea.getBoundingClientRect());
}

function isInputLikeTarget(target) {
  return !!(target && (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  ));
}

function isNavigationBlocked(target) {
  if (isInputLikeTarget(target)) {
    return true;
  }
  const contextMenu = document.getElementById("context-menu");
  if (contextMenu && !contextMenu.classList.contains("hidden") && contextMenu.style.display !== "none") {
    return true;
  }
  if (document.querySelector(".modal:not(.hidden)")) {
    return true;
  }
  return false;
}

function getVisibleGroupTabs() {
  const header = document.getElementById("groups-header");
  if (!header) return [];
  return Array.from(header.querySelectorAll(".group-tab")).filter(isVisibleElement);
}

function getVisibleBookmarkTiles() {
  const stackPopover = document.getElementById("stack-popover");
  if (stackPopover && !stackPopover.classList.contains("hidden")) {
    return Array.from(stackPopover.querySelectorAll(".stack-popover-grid .bookmark-tile")).filter(isVisibleElement);
  }
  const tiles = [];
  const sectionsContainer = document.getElementById("sections-container");
  if (sectionsContainer && !sectionsContainer.classList.contains("hidden")) {
    tiles.push(...sectionsContainer.querySelectorAll(".bookmark-tile"));
  }
  const grid = document.getElementById("bookmarks-grid");
  if (grid) {
    tiles.push(...grid.querySelectorAll(".bookmark-tile"));
  }
  return tiles.filter(isVisibleElement);
}

const GROUP_TO_BOOKMARKS_KEY = {
  above: "ArrowDown",
  below: "ArrowUp",
  left: "ArrowRight",
  right: "ArrowLeft"
};

const BOOKMARKS_TO_GROUP_KEY = {
  above: "ArrowUp",
  below: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight"
};

function focusElement(el) {
  if (!el) return;
  if (el.classList?.contains("group-tab")) {
    document.querySelectorAll("#groups-header .group-tab[tabindex='0']").forEach(t => {
      if (t !== el) t.tabIndex = -1;
    });
    el.tabIndex = 0;
  } else if (el.classList?.contains("bookmark-tile")) {
    const stackPopover = document.getElementById("stack-popover");
    const scope = (stackPopover && !stackPopover.classList.contains("hidden"))
      ? stackPopover
      : document;
    scope.querySelectorAll(".bookmark-tile[tabindex='0']").forEach(t => {
      if (t !== el) t.tabIndex = -1;
    });
    el.tabIndex = 0;
  }
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function getPreferredGroupFocusTarget() {
  const tabs = getVisibleGroupTabs();
  if (tabs.length === 0) {
    const dropdownBtn = document.querySelector("#groups-header .groups-dropdown-btn");
    return isVisibleElement(dropdownBtn) ? dropdownBtn : null;
  }
  return tabs.find(t => t.tabIndex === 0) || tabs.find(t => t.classList.contains("active")) || tabs[0];
}

function getPreferredBookmarkFocusTarget() {
  const tiles = getVisibleBookmarkTiles();
  if (tiles.length === 0) return null;
  return tiles.find(t => t.tabIndex === 0) || tiles[0];
}

function dispatchActivateClick(el, sourceEvent) {
  const clickEvent = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ctrlKey: !!sourceEvent.ctrlKey,
    metaKey: !!sourceEvent.metaKey,
    shiftKey: !!sourceEvent.shiftKey
  });
  el.dispatchEvent(clickEvent);
}

function navigateList(items, currentEl, key, mode) {
  if (items.length === 0) return false;
  const currentIndex = items.indexOf(currentEl);
  if (currentIndex === -1) return false;

  if (key === "Home") {
    focusElement(items[0]);
    return true;
  }
  if (key === "End") {
    focusElement(items[items.length - 1]);
    return true;
  }

  const rects = items.map(el => el.getBoundingClientRect());
  const nextIndex = findSpatialNeighbor(rects, currentIndex, key, mode);
  if (nextIndex !== -1) {
    focusElement(items[nextIndex]);
    return true;
  }
  return false;
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && (navigator.platform || "").toUpperCase().includes("MAC");
}

export function updateShortcutPaletteButton() {
  if (typeof document === "undefined") return;
  const isMac = isMacPlatform();
  const modLabel = isMac ? "⌘" : "Ctrl";
  document.querySelectorAll("#shortcuts-modal .shortcut-mod-key").forEach(el => {
    el.textContent = modLabel;
  });
  const btn = document.getElementById("footer-shortcut-palette");
  if (!btn) return;
  const keyLabel = isMac ? "⌘K" : "Ctrl+K";
  const template = translateKey("shortcutPalettePrompt") || "Press {0} for Shortcut Palette";
  btn.textContent = template.replace("{0}", keyLabel);
  btn.title = translateKey("shortcutsModalTitle") || "Keyboard Shortcuts";
}

export function openShortcutsModal() {
  if (typeof document === "undefined") return;
  const modal = document.getElementById("shortcuts-modal");
  if (!modal) return;
  lastFocusedBeforeShortcutsModal = document.activeElement;
  modal.classList.remove("hidden");
  document.getElementById("shortcuts-close")?.focus({ preventScroll: true });
}

export function closeShortcutsModal() {
  if (typeof document === "undefined") return;
  const modal = document.getElementById("shortcuts-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (lastFocusedBeforeShortcutsModal && lastFocusedBeforeShortcutsModal.isConnected) {
    lastFocusedBeforeShortcutsModal.focus({ preventScroll: true });
  }
  lastFocusedBeforeShortcutsModal = null;
}

export function toggleShortcutsModal() {
  if (typeof document === "undefined") return;
  const modal = document.getElementById("shortcuts-modal");
  if (!modal) return;
  if (modal.classList.contains("hidden")) {
    openShortcutsModal();
  } else {
    closeShortcutsModal();
  }
}

export function initKeyboardNavigation() {
  if (keyboardNavInitialized || typeof document === "undefined") return;
  keyboardNavInitialized = true;

  updateShortcutPaletteButton();

  document.getElementById("footer-shortcut-palette")?.addEventListener("click", () => {
    openShortcutsModal();
  });
  document.getElementById("shortcuts-close")?.addEventListener("click", () => {
    closeShortcutsModal();
  });
  document.getElementById("shortcuts-modal")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) {
      closeShortcutsModal();
    }
  });

  document.addEventListener("keydown", e => {
    if (e.isComposing) return;
    const key = e.key;
    const mod = isMacPlatform() ? e.metaKey : e.ctrlKey;

    const isShortcutPaletteKey = (mod && !e.altKey && !e.shiftKey && key.toLowerCase() === "k") ||
      (key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputLikeTarget(e.target));

    if (isShortcutPaletteKey) {
      const shortcutsModal = document.getElementById("shortcuts-modal");
      const otherOpenModal = Array.from(document.querySelectorAll(".modal:not(.hidden)"))
        .some(m => m !== shortcutsModal);
      if (!otherOpenModal) {
        e.preventDefault();
        toggleShortcutsModal();
      }
      return;
    }

    if (key === "Escape") {
      const shortcutsModal = document.getElementById("shortcuts-modal");
      if (shortcutsModal && !shortcutsModal.classList.contains("hidden")) {
        e.preventDefault();
        closeShortcutsModal();
        return;
      }
    }
    const isArrow = key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
    const isJump = key === "Home" || key === "End";
    const isSectionSwitch = key === "PageUp" || key === "PageDown";
    const isActivate = key === "Enter" || key === " ";
    const isEscape = key === "Escape";

    if (!isArrow && !isJump && !isSectionSwitch && !isActivate && !isEscape) return;
    if (isNavigationBlocked(e.target)) return;

    if (isSectionSwitch) {
      const stackPopover = document.getElementById("stack-popover");
      if (stackPopover && !stackPopover.classList.contains("hidden")) return;
      const target = key === "PageUp"
        ? getPreferredGroupFocusTarget()
        : getPreferredBookmarkFocusTarget();
      if (target) {
        e.preventDefault();
        focusElement(target);
      }
      return;
    }

    const activeEl = document.activeElement;

    // 1) Open groups dropdown menu navigation
    const openDropdownMenu = document.querySelector("#groups-header .groups-dropdown-menu.show");
    if (openDropdownMenu && (activeEl?.closest(".groups-dropdown-container") === openDropdownMenu.closest(".groups-dropdown-container"))) {
      if (isEscape) {
        e.preventDefault();
        openDropdownMenu.classList.remove("show");
        const btn = openDropdownMenu.closest(".groups-dropdown-container")?.querySelector(".groups-dropdown-btn");
        btn?.focus({ preventScroll: true });
        return;
      }
      const options = Array.from(openDropdownMenu.querySelectorAll(".groups-dropdown-option")).filter(isVisibleElement);
      if (isJump && options.length > 0) {
        e.preventDefault();
        focusElement(key === "Home" ? options[0] : options[options.length - 1]);
        return;
      }
      if (isArrow && (key === "ArrowDown" || key === "ArrowUp")) {
        e.preventDefault();
        const idx = options.indexOf(activeEl);
        const nextIdx = idx === -1
          ? (key === "ArrowDown" ? 0 : options.length - 1)
          : (key === "ArrowDown" ? Math.min(options.length - 1, idx + 1) : Math.max(0, idx - 1));
        focusElement(options[nextIdx]);
        return;
      }
      if (isActivate && activeEl?.classList.contains("groups-dropdown-option")) {
        e.preventDefault();
        if (!activeEl.classList.contains("add-group-option")) {
          setPendingFocusDropdownBtn(true);
        }
        dispatchActivateClick(activeEl, e);
        return;
      }
    }

    if (isEscape) return;

    // 2) Group tabs navigation
    const groupTab = activeEl?.closest?.("#groups-header .group-tab");
    if (groupTab) {
      if (isArrow || isJump) {
        e.preventDefault();
        const pos = detectGroupPositionRelativeToBookmarks();
        const isVerticalGroups = pos === "left" || pos === "right" || !!groupTab.closest(".workspace-side-space");
        const moved = navigateList(getVisibleGroupTabs(), groupTab, key, isVerticalGroups ? "grid" : "groups");
        if (!moved && GROUP_TO_BOOKMARKS_KEY[pos] === key) {
          focusElement(getPreferredBookmarkFocusTarget());
        }
        return;
      }
      if (isActivate) {
        e.preventDefault();
        if (groupTab.dataset.groupId) {
          setPendingFocusGroupId(groupTab.dataset.groupId);
        }
        dispatchActivateClick(groupTab, e);
        return;
      }
    }

    // 2b) Groups dropdown button -> boundary arrow into bookmarks when closed
    const dropdownBtn = activeEl?.closest?.("#groups-header .groups-dropdown-btn");
    if (dropdownBtn && !openDropdownMenu && isArrow) {
      const pos = detectGroupPositionRelativeToBookmarks();
      if (GROUP_TO_BOOKMARKS_KEY[pos] === key) {
        e.preventDefault();
        focusElement(getPreferredBookmarkFocusTarget());
        return;
      }
    }

    // 3) Bookmark & stack tiles navigation (scoped to #stack-popover when open)
    const bookmarkTile = activeEl?.closest?.(".bookmark-tile");
    if (bookmarkTile) {
      if (isArrow || isJump) {
        e.preventDefault();
        const moved = navigateList(getVisibleBookmarkTiles(), bookmarkTile, key, "grid");
        const stackPopover = document.getElementById("stack-popover");
        const popoverOpen = stackPopover && !stackPopover.classList.contains("hidden");
        if (!moved && !popoverOpen) {
          const pos = detectGroupPositionRelativeToBookmarks();
          if (BOOKMARKS_TO_GROUP_KEY[pos] === key) {
            focusElement(getPreferredGroupFocusTarget());
          }
        }
        return;
      }
      if (isActivate) {
        e.preventDefault();
        dispatchActivateClick(bookmarkTile, e);
        return;
      }
    }

    // 4) Initial entry from document body using arrow keys
    if (isArrow && (activeEl === document.body || activeEl === document.documentElement)) {
      const target = getPreferredBookmarkFocusTarget() || getPreferredGroupFocusTarget();
      if (target) {
        e.preventDefault();
        focusElement(target);
      }
    }
  });
}
