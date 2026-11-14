import { state, saveState, generateId, saveActiveGroupId } from "./state.js";
import { render } from "./render.js";
import { syncWrite } from "./sync.js";
import { t } from "./i18n.js";
import { ensureHostPermission } from "./bookmarks.js";
import {
  resolveGroupIcons,
  normalizeCustomIconValue,
  isValidHexColor,
  extractDominantColorFromImageSource,
  extractDominantColorFromEmoji,
  applyTileColorStyle
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
  if (!group || !Array.isArray(group.items)) return 0;
  return group.items.filter(item => !item.deleted && item.url).length;
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
    iconImg.src = customIcon;
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
  const topBar = document.getElementById("top-bar");
  if (!topBar) return false;
  
  // Available width for groups (accounting for search box and settings)
  const managePart = document.getElementById("manage");
  const manageWidth = managePart ? managePart.offsetWidth : 300;
  const availableWidth = topBar.clientWidth - manageWidth - 20; // Extra padding
  
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
      render();
    });

    groupsHeader.appendChild(tab);
  });

  // + Add group button
  const addTab = document.createElement("div");
  addTab.className = "group-tab add-group";
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
  document.addEventListener("click", (e) => {
    if (!dropdownContainer.contains(e.target)) {
      dropdownMenu.classList.remove("show");
    }
  });

  dropdownContainer.appendChild(dropdownBtn);
  dropdownContainer.appendChild(dropdownMenu);
  groupsHeader.appendChild(dropdownContainer);
}

// ---------- Group context menu ----------
function showGroupContextMenu(e, group, optionElement) {
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  const editBtn = document.createElement("div");
  editBtn.textContent = t("edit");
  editBtn.addEventListener("click", () => {
    document.body.removeChild(menu);
    openGroupModal(group);
  });

  const deleteBtn = document.createElement("div");
  deleteBtn.textContent = t("delete");
  deleteBtn.addEventListener("click", async () => {
    group.deleted = true;
    group.deletedAt = Date.now();
    group.updatedAt = Date.now();

    if (window.activeGroupId === group.id) {
      const firstActive = state.groups.find(g => !g.deleted);
      window.activeGroupId = firstActive ? firstActive.id : null;
      await saveActiveGroupId(window.activeGroupId);
    }

    await saveState();
    await syncWrite();
    render();
    document.body.removeChild(menu);
  });

  const restoreBtn = document.createElement("div");
  restoreBtn.textContent = t("restore");
  restoreBtn.addEventListener("click", async () => {
    group.deleted = false;
    group.deletedAt = null;
    group.updatedAt = Date.now();

    await saveState();
    await syncWrite();
    render();
    document.body.removeChild(menu);
  });

  const deletePermanentBtn = document.createElement("div");
  deletePermanentBtn.textContent = t("deletePermanent");
  deletePermanentBtn.addEventListener("click", async () => {
    const confirmMsg = t("confirmDeletePermanentGroup").replace("{0}", group.name);
    if (!confirm(confirmMsg)) return;

    const groupIndex = state.groups.findIndex(g => g.id === group.id);
    if (groupIndex > -1) {
      state.groups.splice(groupIndex, 1);
    }

    if (window.activeGroupId === group.id) {
      const firstActive = state.groups.find(g => !g.deleted);
      window.activeGroupId = firstActive ? firstActive.id : null;
      await saveActiveGroupId(window.activeGroupId);
    }

    await saveState();
    await syncWrite();
    render();
    document.body.removeChild(menu);
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

// ---------- Group Drag & drop ----------
function setupGroupDrag() {
  const groupsHeader = document.getElementById("groups-header");
  let dragged = null;

  groupsHeader.querySelectorAll(".group-tab").forEach(tab => {
    if (tab.classList.contains("add-group")) return;

    tab.addEventListener("dragstart", e => {
      dragged = tab;
      tab.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    tab.addEventListener("dragend", async () => {
      if (!dragged) return;
      dragged.classList.remove("dragging");
      dragged = null;

      const ids = [...groupsHeader.querySelectorAll(".group-tab")]
        .filter(el => !el.classList.contains("add-group"))
        .map(el => el.dataset.groupId);

      state.groups.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

      await saveState();
      await syncWrite();
      render();
    });
  });

  groupsHeader.addEventListener("dragover", e => {
    e.preventDefault();
    if (!dragged) return;

    const after = getAfterElementHorizontal(groupsHeader, e.clientX);
    const addBtn = groupsHeader.querySelector(".add-group");

    if (!after) {
      groupsHeader.insertBefore(dragged, addBtn);
    } else {
      groupsHeader.insertBefore(dragged, after);
    }
  });
}

function getAfterElementHorizontal(container, mouseX) {
  const els = [...container.querySelectorAll(".group-tab:not(.dragging):not(.add-group)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

  els.forEach(el => {
    const box = el.getBoundingClientRect();
    const offset = mouseX - (box.left + box.width / 2);
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
    group.deleted = true;
    group.deletedAt = Date.now();
    group.updatedAt = Date.now();

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
    group.deleted = false;
    group.deletedAt = null;
    group.updatedAt = Date.now();

    await saveState();
    await syncWrite();
    render();
  }

  if (action === "delete-permanent") {
    const confirmMsg = t("confirmDeletePermanentGroup").replace("{0}", group.name);
    if (!confirm(confirmMsg)) return;

    const groupIndex = state.groups.findIndex(g => g.id === id);
    if (groupIndex > -1) {
      state.groups.splice(groupIndex, 1);
    }

    if (window.activeGroupId === id) {
      const firstActive = state.groups.find(g => !g.deleted);
      window.activeGroupId = firstActive ? firstActive.id : null;
      await saveActiveGroupId(window.activeGroupId);
    }

    await saveState();
    await syncWrite();
    render();
  }
}
