import { state, saveState, generateId, saveActiveGroupId, getAllGroupBookmarks } from "./state.js";
import { render, clearBookmarkSearch } from "./render.js";
import { syncWrite } from "./sync.js";
import { t } from "./i18n.js";
import { ensureHostPermission } from "./bookmarks.js";
import {
  resolveGroupIcons,
  normalizeCustomIconValue,
  isValidHexColor,
  extractDominantColorFromImageSource,
  extractDominantColorFromEmoji,
  applyTileColorStyle,
  applyCachedIconImageSrc
} from "./color-utils.js";

let lastShowGroupBookmarkCount = true;

function getEffectiveShowGroupCount(config = null) {
  if (typeof window.groupCountPreviewEnabled === "boolean") {
    return window.groupCountPreviewEnabled;
  }
  if (config && typeof config.appearance?.showGroupBookmarkCount === "boolean") {
    lastShowGroupBookmarkCount = config.appearance.showGroupBookmarkCount;
  }
  return lastShowGroupBookmarkCount;
}

function getActiveBookmarkCount(group) {
  return getAllGroupBookmarks(group, { includeDeleted: false }).filter(item => item.url).length;
}

function createGroupEmojiSpan(emojiText) {
  const emojiSpan = document.createElement("span");
  emojiSpan.className = "group-tab-emoji";
  emojiSpan.textContent = emojiText;
  return emojiSpan;
}

function setGroupElementContent(el, group, showCount) {
  el.textContent = "";
  applyTileColorStyle(el, group?.tileColor || null);

  const { iconEmoji, customIcon } = resolveGroupIcons(group);
  if (customIcon) {
    const iconImg = document.createElement("img");
    iconImg.className = "group-tab-icon";
    iconImg.alt = "";
    applyCachedIconImageSrc(iconImg, customIcon);
    iconImg.addEventListener("error", () => {
      if (iconEmoji) {
        iconImg.replaceWith(createGroupEmojiSpan(iconEmoji));
      } else {
        iconImg.remove();
      }
    });
    el.appendChild(iconImg);
  } else if (iconEmoji) {
    el.appendChild(createGroupEmojiSpan(iconEmoji));
  }

  const nameSpan = document.createElement("span");
  nameSpan.className = "group-tab-name";
  nameSpan.textContent = group.name;
  el.appendChild(nameSpan);

  if (showCount) {
    const countBadge = document.createElement("span");
    countBadge.className = "group-tab-count";
    countBadge.textContent = String(getActiveBookmarkCount(group));
    el.appendChild(countBadge);
  }
}

// ---------- Group Modal ----------
const groupModal = document.getElementById("group-modal");
const groupModalTitle = document.getElementById("group-modal-title");
const grpName = document.getElementById("grp-name");
const grpEmoji = document.getElementById("grp-emoji");
const grpIcon = document.getElementById("grp-icon");
const grpColor = document.getElementById("grp-color");
const grpColorCustom = document.getElementById("grp-color-custom");
const grpColorFromIcon = document.getElementById("grp-color-from-icon");
const grpSave = document.getElementById("grp-save");
const grpCancel = document.getElementById("grp-cancel");

let editingGroupId = null;

if (grpColor && grpColorCustom && grpColorFromIcon) {
  grpColor.addEventListener("input", () => {
    grpColorCustom.checked = true;
    grpColorFromIcon.checked = false;
  });
  grpColorCustom.addEventListener("change", () => {
    if (grpColorCustom.checked) {
      grpColorFromIcon.checked = false;
    }
  });
  grpColorFromIcon.addEventListener("change", () => {
    if (grpColorFromIcon.checked) {
      grpColorCustom.checked = false;
    }
  });
}

export function openGroupModal(group = null) {
  if (!groupModal) return;

  editingGroupId = group?.id || null;
  if (groupModalTitle) {
    groupModalTitle.textContent = group ? t("editGroupTitle") : t("newGroup");
  }

  const fallbackHex = "#4a6bff";
  const { iconEmoji, customIcon } = resolveGroupIcons(group);
  if (grpName) grpName.value = group?.name || "";
  if (grpEmoji) grpEmoji.value = iconEmoji || "";
  if (grpIcon) grpIcon.value = customIcon || "";
  if (grpColor) {
    grpColor.value = isValidHexColor(group?.tileColor) ? group.tileColor : fallbackHex;
  }
  if (grpColorFromIcon) grpColorFromIcon.checked = !!group?.colorFromIcon;
  if (grpColorCustom) grpColorCustom.checked = !!(group?.tileColor && !group?.colorFromIcon);

  groupModal.classList.remove("hidden");
  grpName?.focus();
}

function closeGroupModal() {
  groupModal?.classList.add("hidden");
  editingGroupId = null;
}

grpCancel?.addEventListener("click", closeGroupModal);

groupModal?.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeGroupModal();
  }

  if (e.key === "Enter" && (e.target === grpName || e.target === grpEmoji || e.target === grpIcon)) {
    e.preventDefault();
    grpSave?.click();
  }
});

grpSave?.addEventListener("click", async () => {
  const name = grpName?.value.trim() || "";
  if (!name) return;

  const rawEmoji = grpEmoji?.value.trim() || "";
  const iconEmoji = rawEmoji || null;

  const rawIconUrl = grpIcon?.value.trim() || "";
  let customIcon = null;
  if (rawIconUrl) {
    customIcon = normalizeCustomIconValue(rawIconUrl, { allowEmoji: false });
    if (!customIcon) {
      alert(t("invalidIconUrl"));
      return;
    }
  }

  const wantColorFromIcon = !!grpColorFromIcon?.checked;
  const wantCustomColor = !!grpColorCustom?.checked;
  const pickedColor = grpColor?.value || "#4a6bff";

  let colorFromIcon = false;
  let tileColor = null;

  if (wantColorFromIcon && (customIcon || iconEmoji)) {
    colorFromIcon = true;
    if (customIcon) {
      await ensureHostPermission();
      tileColor = await extractDominantColorFromImageSource(customIcon);
    }
    if (!tileColor && iconEmoji) {
      tileColor = extractDominantColorFromEmoji(iconEmoji);
    }
  } else if (wantCustomColor) {
    colorFromIcon = false;
    tileColor = pickedColor;
  }

  if (editingGroupId) {
    // Look up group by ID so background sync refreshes cannot leave a stale object reference.
    const currentGroup = state.groups.find(g => g.id === editingGroupId);
    if (currentGroup) {
      currentGroup.name = name;
      currentGroup.iconEmoji = iconEmoji;
      currentGroup.customIcon = customIcon;
      currentGroup.tileColor = tileColor;
      currentGroup.colorFromIcon = colorFromIcon;
      currentGroup.updatedAt = Date.now();
    }
  } else {
    const g = {
      id: generateId("g"),
      name,
      iconEmoji,
      customIcon,
      tileColor,
      colorFromIcon,
      items: [],
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };

    state.groups.push(g);
    window.activeGroupId = g.id;
    await saveActiveGroupId(g.id);
  }

  closeGroupModal();
  await saveState();
  await syncWrite();
  render();
});

// ---------- Render groups ----------
export function renderGroups(show = true, config = null) {
  const groupsHeader = document.getElementById("groups-header");

  if (!show) {
    groupsHeader.style.display = "none";
    return;
  }

  groupsHeader.style.display = "flex";
  groupsHeader.innerHTML = "";

  // Get visible groups count
  const showDeletedToggle = document.getElementById("show-deleted-toggle");
  const showDeleted = showDeletedToggle ? showDeletedToggle.checked : false;
  const visibleGroups = state.groups.filter(g => !(g.deleted && !showDeleted));
  const showGroupCount = getEffectiveShowGroupCount(config);
  
  // Check if we need dropdown by simulating layout
  const needsDropdown = shouldUseDropdown(visibleGroups.length + 1); // +1 for add button

  if (needsDropdown) {
    renderGroupsDropdown(groupsHeader, visibleGroups, showGroupCount);
  } else {
    renderGroupsTabs(groupsHeader, visibleGroups, showGroupCount);
  }
}

// ---------- Check if dropdown is needed ----------
function shouldUseDropdown(groupCount) {
  const groupsHeader = document.getElementById("groups-header");
  if (!groupsHeader) return false;

  if (groupsHeader.closest("#left-space, #right-space")) {
    return false;
  }

  const host = groupsHeader.parentElement || document.getElementById("top-bar");
  if (!host) return false;

  const isTopBar = host.id === "top-bar";
  const otherWidgetsWidth = isTopBar
    ? Array.from(host.children)
      .filter(el => el !== groupsHeader && !el.classList.contains("widget-row-break"))
      .reduce((sum, el) => sum + (el.offsetWidth || 0), 0)
    : 0;
  const hostWidth = host.clientWidth || document.getElementById("top-bar")?.clientWidth || 800;
  const availableWidth = Math.max(180, hostWidth - otherWidgetsWidth - 20); // Extra padding

  // Estimate how many tabs fit per line
  const groupScale = parseFloat(document.body?.style?.getPropertyValue?.("--group-tile-scale") || "") || 1;
  const avgTabWidth = Math.round(120 * groupScale); // Average tab width including gap
  const tabsPerLine = Math.max(1, Math.floor(availableWidth / avgTabWidth));

  // Calculate how many lines would be needed
  const linesNeeded = Math.ceil(groupCount / tabsPerLine);

  // Use dropdown if more than 3 lines needed
  return linesNeeded > 3;
}

// ---------- Render groups as tabs ----------
function renderGroupsTabs(groupsHeader, visibleGroups, showGroupCount) {
  visibleGroups.forEach(group => {
    const tab = document.createElement("div");
    tab.className = "group-tab";
    tab.tabIndex = 0;
    tab.draggable = true;
    tab.dataset.groupId = group.id;

    if (group.deleted) tab.classList.add("deleted");
    if (group.id === window.activeGroupId && !group.deleted) {
      tab.classList.add("active");
    }

    setGroupElementContent(tab, group, showGroupCount);

    tab.addEventListener("click", () => {
      if (group.deleted) return;
      window.activeGroupId = group.id;
      saveActiveGroupId(group.id);
      clearBookmarkSearch({ rerender: false });
      render();
    });

    groupsHeader.appendChild(tab);
  });

  // + Add group button
  const addTab = document.createElement("div");
  addTab.className = "group-tab add-group";
  addTab.tabIndex = 0;
  addTab.textContent = "+";
  addTab.addEventListener("click", () => {
    openGroupModal(null);
  });

  groupsHeader.appendChild(addTab);

  setupGroupDrag();
}

// ---------- Render groups as dropdown ----------
function renderGroupsDropdown(groupsHeader, visibleGroups, showGroupCount) {
  const dropdownContainer = document.createElement("div");
  dropdownContainer.className = "groups-dropdown-container";

  // Dropdown button showing active group
  const activeGroup = visibleGroups.find(g => g.id === window.activeGroupId && !g.deleted);
  const dropdownBtn = document.createElement("button");
  dropdownBtn.className = "groups-dropdown-btn";
  if (activeGroup) {
    setGroupElementContent(dropdownBtn, activeGroup, showGroupCount);
  } else {
    dropdownBtn.textContent = "Select Group";
  }
  dropdownBtn.title = "Select group";

  // Dropdown menu
  const dropdownMenu = document.createElement("div");
  dropdownMenu.className = "groups-dropdown-menu";

  visibleGroups.forEach(group => {
    const option = document.createElement("div");
    option.className = "groups-dropdown-option";
    option.tabIndex = 0;
    if (group.deleted) option.classList.add("deleted");
    if (group.id === window.activeGroupId && !group.deleted) {
      option.classList.add("active");
    }

    setGroupElementContent(option, group, showGroupCount);

    option.addEventListener("click", async () => {
      if (group.deleted) return;
      window.activeGroupId = group.id;
      await saveActiveGroupId(group.id);
      setGroupElementContent(dropdownBtn, group, showGroupCount);
      dropdownMenu.classList.remove("show");
      clearBookmarkSearch({ rerender: false });
      render();
    });

    // Right-click context menu for editing
    option.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showGroupContextMenu(e, group, option);
    });

    dropdownMenu.appendChild(option);
  });

  // Add group option
  const addOption = document.createElement("div");
  addOption.className = "groups-dropdown-option add-group-option";
  addOption.tabIndex = 0;
  addOption.textContent = "+ Add Group";

  addOption.addEventListener("click", () => {
    dropdownMenu.classList.remove("show");
    openGroupModal(null);
  });

  dropdownMenu.appendChild(addOption);

  // Toggle dropdown
  dropdownBtn.addEventListener("click", () => {
    dropdownMenu.classList.toggle("show");
  });

  // Close dropdown when clicking outside
  if (dropdownOutsideClickHandler) {
    document.removeEventListener("click", dropdownOutsideClickHandler);
  }
  dropdownOutsideClickHandler = (e) => {
    if (!dropdownContainer.contains(e.target)) {
      dropdownMenu.classList.remove("show");
    }
  };
  document.addEventListener("click", dropdownOutsideClickHandler);

  dropdownContainer.appendChild(dropdownBtn);
  dropdownContainer.appendChild(dropdownMenu);
  groupsHeader.appendChild(dropdownContainer);
}

let dropdownOutsideClickHandler = null;

// ---------- Group context menu ----------
function showGroupContextMenu(e, group, optionElement) {
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  const editBtn = document.createElement("div");
  editBtn.textContent = t("edit");
  editBtn.addEventListener("click", () => {
    if (menu.parentNode) document.body.removeChild(menu);
    openGroupModal(group);
  });

  const deleteBtn = document.createElement("div");
  deleteBtn.textContent = t("delete");
  deleteBtn.addEventListener("click", async () => {
    softDeleteGroupRecords(group);

    if (window.activeGroupId === group.id) {
      const firstActive = state.groups.find(g => !g.deleted);
      window.activeGroupId = firstActive ? firstActive.id : null;
      await saveActiveGroupId(window.activeGroupId);
    }

    await saveState();
    await syncWrite();
    render();
    if (menu.parentNode) document.body.removeChild(menu);
  });

  const restoreBtn = document.createElement("div");
  restoreBtn.textContent = t("restore");
  restoreBtn.addEventListener("click", async () => {
    restoreSoftDeletedGroupRecords(group);

    await saveState();
    await syncWrite();
    render();
    if (menu.parentNode) document.body.removeChild(menu);
  });

  const deletePermanentBtn = document.createElement("div");
  deletePermanentBtn.textContent = t("deletePermanent");
  deletePermanentBtn.addEventListener("click", async () => {
    const confirmMsg = t("confirmDeletePermanentGroup").replace("{0}", group.name);
    if (!confirm(confirmMsg)) return;

    const purgedIds = collectGroupPurgedIds(group);
    const groupIndex = state.groups.findIndex(g => g.id === group.id);
    if (groupIndex > -1) {
      state.groups.splice(groupIndex, 1);
    }

    ensureActiveGroupAfterPermanentDelete(group.id);
    await saveActiveGroupId(window.activeGroupId);

    await saveState();
    await syncWrite(state, { purgedIds });
    render();
    if (menu.parentNode) menu.parentNode.removeChild(menu);
  });

  // Show/hide buttons based on deleted status
  if (group.deleted) {
    menu.appendChild(restoreBtn);
    menu.appendChild(deletePermanentBtn);
  } else {
    menu.appendChild(editBtn);
    menu.appendChild(deleteBtn);
  }

  document.body.appendChild(menu);

  setTimeout(() => {
    if (document.body.contains(menu)) {
      document.body.removeChild(menu);
    }
  }, 5000);
}

function softDeleteGroupRecords(group, now = Date.now()) {
  if (!group) return;
  group.deleted = true;
  group.deletedAt = now;
  group.updatedAt = now;

  for (const item of (group.items || [])) {
    if (!item) continue;
    if (!item.deleted) {
      item.deleted = true;
      item.deletedAt = now;
      item.updatedAt = now;
    }
    if (Array.isArray(item.children)) {
      for (const child of item.children) {
        if (child && !child.deleted) {
          child.deleted = true;
          child.deletedAt = now;
          child.updatedAt = now;
        }
      }
    }
  }
}

function restoreSoftDeletedGroupRecords(group, now = Date.now()) {
  if (!group) return;
  const groupDeletedAt = group.deletedAt;
  group.deleted = false;
  group.deletedAt = null;
  group.updatedAt = now;

  if (!groupDeletedAt) return;
  for (const item of (group.items || [])) {
    if (!item) continue;
    if (item.deleted && item.deletedAt === groupDeletedAt) {
      item.deleted = false;
      item.deletedAt = null;
      item.updatedAt = now;
    }
    if (Array.isArray(item.children)) {
      for (const child of item.children) {
        if (child && child.deleted && child.deletedAt === groupDeletedAt) {
          child.deleted = false;
          child.deletedAt = null;
          child.updatedAt = now;
        }
      }
    }
  }
}

function collectGroupPurgedIds(group) {
  const ids = [];
  if (!group) return ids;
  if (group.id) ids.push(group.id);
  for (const sec of (group.sections || [])) {
    if (sec?.id) ids.push(sec.id);
  }
  for (const item of (group.items || [])) {
    if (!item) continue;
    if (item.id) ids.push(item.id);
    if (Array.isArray(item.children)) {
      for (const child of item.children) {
        if (child?.id) ids.push(child.id);
      }
    }
  }
  return ids;
}

function ensureActiveGroupAfterPermanentDelete(deletedGroupId) {
  if (state.groups.length === 0) {
    const localizedDefault = t("defaultGroupName");
    const defaultName = (localizedDefault && localizedDefault !== "defaultGroupName")
      ? localizedDefault
      : "SimpleDial";
    const defaultGroup = {
      id: generateId("g"),
      name: defaultName,
      sections: [],
      items: [],
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };
    state.groups.push(defaultGroup);
    window.activeGroupId = defaultGroup.id;
    return;
  }

  if (window.activeGroupId === deletedGroupId || !state.groups.some(g => g.id === window.activeGroupId && !g.deleted)) {
    const firstActive = state.groups.find(g => !g.deleted);
    window.activeGroupId = firstActive ? firstActive.id : null;
  }
}

// ---------- Group Drag & drop ----------
let draggedGroupTab = null;

function setupGroupDrag() {
  const groupsHeader = document.getElementById("groups-header");
  if (!groupsHeader) return;

  groupsHeader.querySelectorAll(".group-tab").forEach(tab => {
    if (tab.classList.contains("add-group")) return;

    tab.addEventListener("dragstart", e => {
      if (document.body?.classList.contains("tiles-locked")) {
        e.preventDefault();
        return;
      }
      draggedGroupTab = tab;
      tab.classList.add("dragging");
      document.body?.classList.add("is-dragging-group");
      e.dataTransfer.effectAllowed = "move";
    });

    tab.addEventListener("dragend", async e => {
      document.body?.classList.remove("is-dragging-group");
      if (!draggedGroupTab) return;
      draggedGroupTab.classList.remove("dragging");
      draggedGroupTab = null;

      if (e.dataTransfer?.dropEffect === "none") {
        render();
        return;
      }

      const ids = [...groupsHeader.querySelectorAll(".group-tab")]
        .filter(el => !el.classList.contains("add-group"))
        .map(el => el.dataset.groupId);

      state.groups.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

      await saveState();
      await syncWrite();
      render();
    });
  });

  if (groupsHeader.dataset.groupDragBound !== "true") {
    groupsHeader.dataset.groupDragBound = "true";
    groupsHeader.addEventListener("dragover", e => {
      if (!draggedGroupTab) return;
      e.preventDefault();

      const isVertical = !!groupsHeader.closest("#left-space, #right-space");
      const after = getAfterGroupTab(groupsHeader, e.clientX, e.clientY, isVertical);
      const addBtn = groupsHeader.querySelector(".add-group");

      if (!after) {
        groupsHeader.insertBefore(draggedGroupTab, addBtn);
      } else {
        groupsHeader.insertBefore(draggedGroupTab, after);
      }
    });
  }
}

function getAfterGroupTab(container, mouseX, mouseY, isVertical = false) {
  const els = [...container.querySelectorAll(".group-tab:not(.dragging):not(.add-group)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

  els.forEach(el => {
    const box = el.getBoundingClientRect();
    if (!isVertical && (mouseY < box.top || mouseY > box.bottom)) {
      return;
    }
    const offset = isVertical
      ? mouseY - (box.top + box.height / 2)
      : mouseX - (box.left + box.width / 2);
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: el };
    }
  });

  return closest.element;
}

// ---------- Context menu – Groups ----------
export async function handleGroupContext(action, el) {
  const id = el.dataset.groupId;
  const group = state.groups.find(g => g.id === id);
  if (!group) return;

  if (action === "edit") {
    openGroupModal(group);
  }

  if (action === "delete") {
    softDeleteGroupRecords(group);

    if (window.activeGroupId === id) {
      const firstActive = state.groups.find(g => !g.deleted);
      window.activeGroupId = firstActive ? firstActive.id : null;
      await saveActiveGroupId(window.activeGroupId);
    }

    await saveState();
    await syncWrite();
    render();
  }

  if (action === "restore") {
    restoreSoftDeletedGroupRecords(group);

    await saveState();
    await syncWrite();
    render();
  }

  if (action === "delete-permanent") {
    const confirmMsg = t("confirmDeletePermanentGroup").replace("{0}", group.name);
    if (!confirm(confirmMsg)) return;

    const purgedIds = collectGroupPurgedIds(group);
    const groupIndex = state.groups.findIndex(g => g.id === id);
    if (groupIndex > -1) {
      state.groups.splice(groupIndex, 1);
    }

    ensureActiveGroupAfterPermanentDelete(id);
    await saveActiveGroupId(window.activeGroupId);

    await saveState();
    await syncWrite(state, { purgedIds });
    render();
  }
}
