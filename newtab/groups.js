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

  state.groups.forEach(group => {
    if (group.deleted && !window.showDeletedGroups) return;

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
    const name = prompt("Názov novej skupiny:");
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
