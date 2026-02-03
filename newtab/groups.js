import { state, saveState, generateId } from "./state.js";
import { render } from "./render.js";
import { syncWrite } from "./sync.js";

// ---------- Render skupín ----------
export function renderGroups(show = true) {
  const groupsHeader = document.getElementById("groups-header");

  if (!show) {
    groupsHeader.style.display = "none";
    return;
  }

  groupsHeader.style.display = "flex";
  groupsHeader.innerHTML = "";

  // Get visible groups count
  const visibleGroups = state.groups.filter(g => !(g.deleted && !window.showDeletedGroups));
  
  // Check if we need dropdown by simulating layout
  const needsDropdown = shouldUseDropdown(visibleGroups.length + 1); // +1 for add button

  if (needsDropdown) {
    renderGroupsDropdown(groupsHeader, visibleGroups);
  } else {
    renderGroupsTabs(groupsHeader, visibleGroups);
  }
}

// ---------- Check if dropdown is needed ----------
function shouldUseDropdown(groupCount) {
  const groupsHeader = document.getElementById("groups-header");
  const topBar = document.getElementById("top-bar");
  if (!topBar) return false;
  
  // Available width for groups (accounting for search box and settings)
  const managePart = document.getElementById("manage");
  const manageWidth = managePart ? managePart.offsetWidth : 300;
  const availableWidth = topBar.clientWidth - manageWidth - 20; // Extra padding
  
  // Estimate how many tabs fit per line
  const avgTabWidth = 120; // Average tab width including gap
  const tabsPerLine = Math.max(1, Math.floor(availableWidth / avgTabWidth));
  
  // Calculate how many lines would be needed
  const linesNeeded = Math.ceil(groupCount / tabsPerLine);
  
  // Use dropdown if more than 3 lines needed
  return linesNeeded > 3;
}

// ---------- Render groups as tabs ----------
function renderGroupsTabs(groupsHeader, visibleGroups) {
  visibleGroups.forEach(group => {
    const tab = document.createElement("div");
    tab.className = "group-tab";
    tab.draggable = true;
    tab.dataset.groupId = group.id;

    if (group.deleted) tab.classList.add("deleted");
    if (group.id === window.activeGroupId && !group.deleted) {
      tab.classList.add("active");
    }

    tab.textContent = group.name;

    tab.addEventListener("click", () => {
      if (group.deleted) return;
      window.activeGroupId = group.id;
      render();
    });

    groupsHeader.appendChild(tab);
  });

  // + Pridať skupinu
  const addTab = document.createElement("div");
  addTab.className = "group-tab add-group";
  addTab.textContent = "+";
  addTab.addEventListener("click", async () => {
    const name = prompt(window.t("newGroupName"));
    if (!name) return;

    const g = {
      id: generateId("g"),
      name: name.trim(),
      items: [],
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };

    state.groups.push(g);
    window.activeGroupId = g.id;

    await saveState();
    await syncWrite();
    render();
  });

  groupsHeader.appendChild(addTab);

  setupGroupDrag();
}

// ---------- Render groups as dropdown ----------
function renderGroupsDropdown(groupsHeader, visibleGroups) {
  const dropdownContainer = document.createElement("div");
  dropdownContainer.className = "groups-dropdown-container";

  // Dropdown button showing active group
  const activeGroup = visibleGroups.find(g => g.id === window.activeGroupId && !g.deleted);
  const dropdownBtn = document.createElement("button");
  dropdownBtn.className = "groups-dropdown-btn";
  dropdownBtn.textContent = activeGroup ? activeGroup.name : "Select Group";
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

    option.textContent = group.name;

    option.addEventListener("click", async () => {
      if (group.deleted) return;
      window.activeGroupId = group.id;
      dropdownBtn.textContent = group.name;
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

  addOption.addEventListener("click", async () => {
    const name = prompt(window.t("newGroupName"));
    if (!name) return;

    const g = {
      id: generateId("g"),
      name: name.trim(),
      items: [],
      updatedAt: Date.now(),
      deleted: false,
      deletedAt: null
    };

    state.groups.push(g);
    window.activeGroupId = g.id;

    await saveState();
    await syncWrite();
    render();
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
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", async () => {
    const newName = prompt("New group name:", group.name);
    if (newName && newName.trim()) {
      group.name = newName.trim();
      group.updatedAt = Date.now();
      await saveState();
      await syncWrite();
      render();
    }
    document.body.removeChild(menu);
  });

  const deleteBtn = document.createElement("div");
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete group "${group.name}"?`)) return;

    group.deleted = true;
    group.deletedAt = Date.now();
    group.updatedAt = Date.now();

    if (window.activeGroupId === group.id) {
      const firstActive = state.groups.find(g => !g.deleted);
      window.activeGroupId = firstActive ? firstActive.id : null;
    }

    await saveState();
    await syncWrite();
    render();
    document.body.removeChild(menu);
  });

  menu.appendChild(editBtn);
  menu.appendChild(deleteBtn);
  document.body.appendChild(menu);

  setTimeout(() => {
    document.body.removeChild(menu);
  }, 5000);
}

// ---------- Drag & drop skupiny ----------
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

// ---------- Kontextové menu – skupiny ----------
export async function handleGroupContext(action, el) {
  const id = el.dataset.groupId;
  const group = state.groups.find(g => g.id === id);
  if (!group) return;

  if (action === "edit") {
    const newName = prompt("Nový názov skupiny:", group.name);
    if (newName && newName.trim()) {
      group.name = newName.trim();
      group.updatedAt = Date.now();
      await saveState();
      await syncWrite();
      render();
    }
  }

  if (action === "delete") {
    if (!confirm(`Vymazať skupinu "${group.name}"?`)) return;

    group.deleted = true;
    group.deletedAt = Date.now();
    group.updatedAt = Date.now();

    if (window.activeGroupId === id) {
      const firstActive = state.groups.find(g => !g.deleted);
      window.activeGroupId = firstActive ? firstActive.id : null;
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
}
