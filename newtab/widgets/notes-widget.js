import { t } from "../i18n.js";
import { createCustomWidgetIconElement } from "./shared.js";

const NOTES_STORAGE_KEY = "myspeeddial-widget-notes";
export const MAX_NOTE_TITLE_LENGTH = 120;
export const MAX_NOTE_BODY_LENGTH = 2000;
export const MAX_TODO_TEXT_LENGTH = 240;
const notesDataCache = new Map();
const notesWidgetElementCache = new Map();
let notesStoreLoaded = false;
let notesStoreLoadPromise = null;
let activeNotesWidgets = [];
let activeModalWidgetId = null;
let activeModalEntryId = null;
let notesReminderIntervalId = null;

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeTodoItem(item) {
  return {
    id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : makeId("nt"),
    text: String(item.text).trim().slice(0, MAX_TODO_TEXT_LENGTH),
    done: !!item.done,
    remindAt: Number.isFinite(Number(item.remindAt)) && Number(item.remindAt) > 0
      ? Number(item.remindAt)
      : null,
    notified: !!item.notified,
    createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now()
  };
}

export function normalizeNotesWidgetData(raw) {
  if (Array.isArray(raw?.entries)) {
    const entries = raw.entries
      .filter(e => e && typeof e === "object")
      .map(e => ({
        id: typeof e.id === "string" && e.id.trim() ? e.id.trim() : makeId("ne"),
        title: typeof e.title === "string" ? e.title.slice(0, MAX_NOTE_TITLE_LENGTH) : "",
        body: typeof e.body === "string" ? e.body.slice(0, MAX_NOTE_BODY_LENGTH) : "",
        todos: Array.isArray(e.todos)
          ? e.todos.filter(item => item && typeof item.text === "string" && item.text.trim()).map(normalizeTodoItem)
          : [],
        createdAt: Number.isFinite(Number(e.createdAt)) ? Number(e.createdAt) : Date.now(),
        updatedAt: Number.isFinite(Number(e.updatedAt)) ? Number(e.updatedAt) : Date.now()
      }));
    return { entries };
  }

  // Migrate legacy { text, todos } shape into entries
  const entries = [];
  const legacyText = typeof raw?.text === "string" ? raw.text.slice(0, MAX_NOTE_BODY_LENGTH) : "";
  const legacyTodos = Array.isArray(raw?.todos)
    ? raw.todos.filter(item => item && typeof item.text === "string" && item.text.trim()).map(normalizeTodoItem)
    : [];
  if (legacyText.trim() || legacyTodos.length > 0) {
    entries.push({
      id: makeId("ne"),
      title: (legacyText.trim().split(/\r?\n/)[0]?.slice(0, 60) || (t("notesDefaultName") || "Notes")).slice(0, MAX_NOTE_TITLE_LENGTH),
      body: legacyText,
      todos: legacyTodos,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  return { entries };
}

export function computeReminderTimestamp(preset, customValue = "", nowMs = Date.now()) {
  if (!preset || preset === "none") return null;
  if (preset === "custom") {
    if (typeof customValue !== "string" || !customValue.trim()) return null;
    const trimmed = customValue.trim();
    const timeOnly = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (timeOnly) {
      const hours = Number(timeOnly[1]);
      const minutes = Number(timeOnly[2]);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      const d = new Date(nowMs);
      d.setHours(hours, minutes, 0, 0);
      if (d.getTime() <= nowMs) {
        d.setDate(d.getDate() + 1);
      }
      return d.getTime();
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const mins = Number(preset);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return nowMs + Math.round(mins * 60 * 1000);
}

export function formatReminderCountdown(remindAtMs, nowMs = Date.now(), done = false) {
  if (!Number.isFinite(remindAtMs) || remindAtMs <= 0 || done) {
    return { label: "", status: done ? "done" : "none" };
  }
  const diffMs = remindAtMs - nowMs;
  if (diffMs <= 0) {
    return { label: t("notesReminderDue") || "Due!", status: "due" };
  }
  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) {
    return {
      label: `${diffMins}m`,
      status: diffMins <= 5 ? "soon" : "scheduled"
    };
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return { label: `${diffHours}h`, status: "scheduled" };
  }
  const diffDays = Math.floor(diffHours / 24);
  return { label: `${diffDays}d`, status: "scheduled" };
}

export function findDueNoteReminders(notesByWidgetId, nowMs = Date.now()) {
  const due = [];
  if (!notesByWidgetId || typeof notesByWidgetId !== "object") return due;
  const entriesList = notesByWidgetId instanceof Map
    ? notesByWidgetId.entries()
    : Object.entries(notesByWidgetId);

  for (const [widgetId, rawData] of entriesList) {
    const data = normalizeNotesWidgetData(rawData);
    for (const entry of data.entries) {
      for (const todo of entry.todos) {
        if (!todo.done && !todo.notified && todo.remindAt && todo.remindAt <= nowMs) {
          due.push({ widgetId, entryId: entry.id, entryTitle: entry.title, todo });
        }
      }
    }
  }
  return due;
}

async function ensureNotesStoreLoaded() {
  if (notesStoreLoaded) return;
  if (notesStoreLoadPromise) {
    await notesStoreLoadPromise;
    return;
  }
  notesStoreLoadPromise = (async () => {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const res = await chrome.storage.local.get([NOTES_STORAGE_KEY]);
        const stored = res?.[NOTES_STORAGE_KEY];
        if (stored && typeof stored === "object") {
          for (const [id, data] of Object.entries(stored)) {
            notesDataCache.set(id, normalizeNotesWidgetData(data));
          }
        }
      }
    } catch (err) {
      console.warn("Failed to load widget notes", err);
    } finally {
      notesStoreLoaded = true;
      notesStoreLoadPromise = null;
    }
  })();
  await notesStoreLoadPromise;
}

async function persistNotesStore() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const payload = {};
  for (const [id, data] of notesDataCache.entries()) {
    payload[id] = data;
  }
  try {
    await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: payload });
  } catch (err) {
    console.warn("Failed to save widget notes", err);
  }
}

function getNotesDataSync(widgetId) {
  if (!notesDataCache.has(widgetId)) {
    notesDataCache.set(widgetId, { entries: [] });
  }
  return notesDataCache.get(widgetId);
}

async function updateNotesData(widgetId, updater) {
  await ensureNotesStoreLoaded();
  const current = normalizeNotesWidgetData(getNotesDataSync(widgetId));
  const next = normalizeNotesWidgetData(updater(current));
  notesDataCache.set(widgetId, next);
  await persistNotesStore();
  refreshNotesWidgetDom(widgetId);
  if (activeModalWidgetId === widgetId) {
    renderNotesModalContent(widgetId);
  }
  return next;
}

function mutateTodoInEntry(data, entryId, todoId, mutator) {
  return {
    ...data,
    entries: data.entries.map(entry => {
      if (entry.id !== entryId) return entry;
      return {
        ...entry,
        updatedAt: Date.now(),
        todos: entry.todos.map(item => item.id === todoId ? mutator(item) : item)
      };
    })
  };
}

function showDueReminderToast(widget, entryId, entryTitle, todo) {
  if (typeof document === "undefined") return;
  let host = document.getElementById("notes-reminder-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "notes-reminder-toast-host";
    host.className = "notes-reminder-toast-host";
    document.body.appendChild(host);
  }

  const toast = document.createElement("div");
  toast.className = "notes-reminder-toast";

  const title = document.createElement("div");
  title.className = "notes-reminder-toast-title";
  const prefix = widget?.name || (t("notesDefaultName") || "Notes");
  title.textContent = entryTitle ? `⏰ ${prefix} · ${entryTitle}` : `⏰ ${prefix}`;

  const body = document.createElement("div");
  body.className = "notes-reminder-toast-body";
  body.textContent = todo.text;

  const actions = document.createElement("div");
  actions.className = "notes-reminder-toast-actions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "icon-btn";
  openBtn.textContent = t("open") || "Open";
  openBtn.addEventListener("click", () => {
    void openNotesWidgetModal(widget.id, { entryId });
  });

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "icon-btn primary";
  doneBtn.textContent = `✓ ${t("notesDoneBtn") || "Done"}`;
  doneBtn.addEventListener("click", async () => {
    await updateNotesData(widget.id, data =>
      mutateTodoInEntry(data, entryId, todo.id, item => ({ ...item, done: true }))
    );
    toast.remove();
  });

  const snoozeBtn = document.createElement("button");
  snoozeBtn.type = "button";
  snoozeBtn.className = "icon-btn";
  snoozeBtn.textContent = "+10m";
  snoozeBtn.addEventListener("click", async () => {
    await updateNotesData(widget.id, data =>
      mutateTodoInEntry(data, entryId, todo.id, item => ({
        ...item,
        remindAt: Date.now() + 10 * 60 * 1000,
        notified: false
      }))
    );
    toast.remove();
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "icon-btn";
  dismissBtn.textContent = "✕";
  dismissBtn.addEventListener("click", () => toast.remove());

  actions.append(openBtn, doneBtn, snoozeBtn, dismissBtn);
  toast.append(title, body, actions);
  host.appendChild(toast);
}

export async function checkDueNoteReminders() {
  await ensureNotesStoreLoaded();
  const dueList = findDueNoteReminders(notesDataCache, Date.now());
  if (dueList.length === 0) return;

  const byWidgetId = new Map(activeNotesWidgets.map(w => [w.id, w]));
  const dueTodoIdsByWidget = new Map();
  for (const { widgetId, entryId, entryTitle, todo } of dueList) {
    if (!dueTodoIdsByWidget.has(widgetId)) dueTodoIdsByWidget.set(widgetId, new Set());
    dueTodoIdsByWidget.get(widgetId).add(todo.id);
    const widget = byWidgetId.get(widgetId);
    if (widget && widget.space !== "disabled") {
      showDueReminderToast(widget, entryId, entryTitle, todo);
    }
  }

  for (const [widgetId, todoIds] of dueTodoIdsByWidget.entries()) {
    const data = getNotesDataSync(widgetId);
    data.entries = data.entries.map(entry => ({
      ...entry,
      todos: entry.todos.map(item => todoIds.has(item.id) ? { ...item, notified: true } : item)
    }));
    refreshNotesWidgetDom(widgetId);
    if (activeModalWidgetId === widgetId) {
      renderNotesModalContent(widgetId);
    }
  }
  await persistNotesStore();
}

export function startNotesReminderPolling() {
  if (notesReminderIntervalId || typeof setInterval === "undefined") return;
  void ensureNotesStoreLoaded().then(() => {
    for (const w of activeNotesWidgets) refreshNotesWidgetDom(w.id);
    return checkDueNoteReminders();
  });
  notesReminderIntervalId = setInterval(() => {
    for (const w of activeNotesWidgets) refreshNotesWidgetDom(w.id);
    void checkDueNoteReminders();
  }, 10000);
}

function getEntryDisplayTitle(entry) {
  const title = (entry?.title || "").trim();
  if (title) return title;
  const firstLine = (entry?.body || "").trim().split(/\r?\n/)[0]?.trim();
  if (firstLine) return firstLine.slice(0, 48);
  const firstTodo = entry?.todos?.[0]?.text;
  if (firstTodo) return firstTodo;
  return t("notesUntitledEntry") || "Untitled";
}

function getEntryNextReminder(entry, nowMs) {
  let best = null;
  for (const todo of (entry?.todos || [])) {
    if (todo.done || !todo.remindAt) continue;
    if (!best || todo.remindAt < best.remindAt) {
      best = todo;
    }
  }
  return best ? formatReminderCountdown(best.remindAt, nowMs, false) : { label: "", status: "none" };
}

function renderNotesModalContent(widgetId) {
  const widget = activeNotesWidgets.find(w => w.id === widgetId);
  const titleEl = document.getElementById("notes-modal-title");
  const entriesListEl = document.getElementById("notes-modal-entries-list");
  const editorPane = document.getElementById("notes-entry-editor");
  const emptyPane = document.getElementById("notes-entry-empty");
  const entryTitleInput = document.getElementById("notes-entry-title");
  const textarea = document.getElementById("notes-modal-textarea");
  const todoListEl = document.getElementById("notes-modal-todo-list");
  if (!entriesListEl || !todoListEl) return;

  if (titleEl) {
    titleEl.textContent = `📝 ${widget?.name || (t("notesDefaultName") || "Notes")}`;
  }

  const data = normalizeNotesWidgetData(getNotesDataSync(widgetId));
  if (data.entries.length > 0 && (!activeModalEntryId || !data.entries.some(e => e.id === activeModalEntryId))) {
    activeModalEntryId = data.entries[0].id;
  } else if (data.entries.length === 0) {
    activeModalEntryId = null;
  }

  const now = Date.now();
  entriesListEl.innerHTML = "";
  for (const entry of data.entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `notes-entry-list-item${entry.id === activeModalEntryId ? " active" : ""}`;
    btn.addEventListener("click", () => {
      activeModalEntryId = entry.id;
      renderNotesModalContent(widgetId);
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "notes-entry-list-title";
    nameSpan.textContent = getEntryDisplayTitle(entry);
    btn.appendChild(nameSpan);

    const pendingCount = entry.todos.filter(x => !x.done).length;
    const rem = getEntryNextReminder(entry, now);
    if (rem.label) {
      const remBadge = document.createElement("span");
      remBadge.className = `notes-reminder-badge status-${rem.status}`;
      remBadge.textContent = rem.label;
      btn.appendChild(remBadge);
    } else if (pendingCount > 0) {
      const countSpan = document.createElement("span");
      countSpan.className = "notes-entry-list-count";
      countSpan.textContent = String(pendingCount);
      btn.appendChild(countSpan);
    }

    entriesListEl.appendChild(btn);
  }

  const activeEntry = data.entries.find(e => e.id === activeModalEntryId) || null;
  if (!activeEntry) {
    editorPane?.classList.add("hidden");
    emptyPane?.classList.remove("hidden");
    return;
  }

  editorPane?.classList.remove("hidden");
  emptyPane?.classList.add("hidden");

  if (entryTitleInput && document.activeElement !== entryTitleInput) {
    entryTitleInput.value = activeEntry.title;
  }
  if (textarea && document.activeElement !== textarea) {
    textarea.value = activeEntry.body;
  }
  updateBodyCharCounter(activeEntry.body.length);

  todoListEl.innerHTML = "";
  if (activeEntry.todos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "notes-todo-empty";
    empty.textContent = t("notesTodoEmpty") || "No todos yet.";
    todoListEl.appendChild(empty);
    return;
  }

  for (const todo of activeEntry.todos) {
    const row = document.createElement("div");
    row.className = `notes-todo-item${todo.done ? " is-done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.done;
    checkbox.addEventListener("change", () => {
      void updateNotesData(widgetId, cur =>
        mutateTodoInEntry(cur, activeEntry.id, todo.id, item => ({ ...item, done: checkbox.checked }))
      );
    });

    const textSpan = document.createElement("span");
    textSpan.className = "notes-todo-text";
    textSpan.textContent = todo.text;

    row.append(checkbox, textSpan);

    const rem = formatReminderCountdown(todo.remindAt, now, todo.done);
    if (rem.label) {
      const remBadge = document.createElement("span");
      remBadge.className = `notes-reminder-badge status-${rem.status}`;
      remBadge.textContent = `⏰ ${rem.label}`;
      if (todo.remindAt) {
        remBadge.title = new Date(todo.remindAt).toLocaleString();
      }
      row.appendChild(remBadge);
    }

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "notes-todo-del-btn";
    delBtn.textContent = "×";
    delBtn.title = t("delete") || "Delete";
    delBtn.addEventListener("click", () => {
      void updateNotesData(widgetId, cur => ({
        ...cur,
        entries: cur.entries.map(e =>
          e.id === activeEntry.id
            ? { ...e, updatedAt: Date.now(), todos: e.todos.filter(x => x.id !== todo.id) }
            : e
        )
      }));
    });

    row.appendChild(delBtn);
    todoListEl.appendChild(row);
  }
}

let notesModalListenersBound = false;

function updateBodyCharCounter(length) {
  if (typeof document === "undefined") return;
  const counterEl = document.getElementById("notes-body-char-count");
  if (!counterEl) return;
  const safeLen = Math.min(MAX_NOTE_BODY_LENGTH, Math.max(0, Number(length) || 0));
  counterEl.textContent = `${safeLen} / ${MAX_NOTE_BODY_LENGTH}`;
  counterEl.classList.toggle("is-near-limit", safeLen >= Math.floor(MAX_NOTE_BODY_LENGTH * 0.9));
}

function ensureNotesModalListeners() {
  if (notesModalListenersBound || typeof document === "undefined") return;
  notesModalListenersBound = true;

  const modal = document.getElementById("notes-widget-modal");
  const closeBtn = document.getElementById("notes-modal-close");
  const newEntryBtn = document.getElementById("notes-new-entry-btn");
  const deleteEntryBtn = document.getElementById("notes-entry-delete-btn");
  const entryTitleInput = document.getElementById("notes-entry-title");
  const textarea = document.getElementById("notes-modal-textarea");
  const todoInput = document.getElementById("notes-todo-input");
  const remindSelect = document.getElementById("notes-todo-remind-select");
  const remindCustom = document.getElementById("notes-todo-remind-custom");
  const addTodoBtn = document.getElementById("notes-todo-add-btn");

  const closeModal = () => {
    modal?.classList.add("hidden");
    activeModalWidgetId = null;
    activeModalEntryId = null;
  };

  closeBtn?.addEventListener("click", closeModal);
  modal?.addEventListener("click", e => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });

  const createNewEntry = async () => {
    if (!activeModalWidgetId) return;
    const newEntry = {
      id: makeId("ne"),
      title: "",
      body: "",
      todos: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    activeModalEntryId = newEntry.id;
    await updateNotesData(activeModalWidgetId, cur => ({
      ...cur,
      entries: [newEntry, ...cur.entries]
    }));
    entryTitleInput?.focus();
  };

  newEntryBtn?.addEventListener("click", () => { void createNewEntry(); });

  deleteEntryBtn?.addEventListener("click", async () => {
    if (!activeModalWidgetId || !activeModalEntryId) return;
    const deletingId = activeModalEntryId;
    activeModalEntryId = null;
    await updateNotesData(activeModalWidgetId, cur => ({
      ...cur,
      entries: cur.entries.filter(e => e.id !== deletingId)
    }));
  });

  let saveTimer = null;
  const scheduleEntryTextSave = () => {
    if (!activeModalWidgetId || !activeModalEntryId) return;
    const targetWidgetId = activeModalWidgetId;
    const targetEntryId = activeModalEntryId;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void updateNotesData(targetWidgetId, cur => ({
        ...cur,
        entries: cur.entries.map(e =>
          e.id === targetEntryId
            ? {
                ...e,
                title: entryTitleInput?.value ?? e.title,
                body: textarea?.value ?? e.body,
                updatedAt: Date.now()
              }
            : e
        )
      }));
    }, 200);
  };

  const flushEntryTextSave = () => {
    if (!activeModalWidgetId || !activeModalEntryId) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const targetWidgetId = activeModalWidgetId;
    const targetEntryId = activeModalEntryId;
    void updateNotesData(targetWidgetId, cur => ({
      ...cur,
      entries: cur.entries.map(e =>
        e.id === targetEntryId
          ? {
              ...e,
              title: entryTitleInput?.value ?? e.title,
              body: textarea?.value ?? e.body,
              updatedAt: Date.now()
            }
          : e
      )
    }));
  };

  entryTitleInput?.addEventListener("input", scheduleEntryTextSave);
  entryTitleInput?.addEventListener("blur", flushEntryTextSave);
  textarea?.addEventListener("input", () => {
    updateBodyCharCounter(textarea.value.length);
    scheduleEntryTextSave();
  });
  textarea?.addEventListener("blur", flushEntryTextSave);

  remindSelect?.addEventListener("change", () => {
    if (remindCustom) {
      const isCustom = remindSelect.value === "custom";
      remindCustom.classList.toggle("hidden", !isCustom);
      if (isCustom && !remindCustom.value) {
        const d = new Date(Date.now() + 15 * 60 * 1000);
        const pad = n => String(n).padStart(2, "0");
        remindCustom.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
  });

  const submitTodo = async () => {
    if (!activeModalWidgetId || !todoInput) return;
    const text = todoInput.value.trim();
    if (!text) return;
    const remindAt = computeReminderTimestamp(
      remindSelect?.value || "none",
      remindCustom?.value || ""
    );
    const newTodo = {
      id: makeId("nt"),
      text,
      done: false,
      remindAt,
      notified: false,
      createdAt: Date.now()
    };
    todoInput.value = "";
    if (remindSelect) remindSelect.value = "none";
    if (remindCustom) remindCustom.classList.add("hidden");

    let targetEntryId = activeModalEntryId;
    if (!targetEntryId) {
      const createdEntry = {
        id: makeId("ne"),
        title: text,
        body: "",
        todos: [newTodo],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      activeModalEntryId = createdEntry.id;
      await updateNotesData(activeModalWidgetId, cur => ({
        ...cur,
        entries: [createdEntry, ...cur.entries]
      }));
      return;
    }

    await updateNotesData(activeModalWidgetId, cur => ({
      ...cur,
      entries: cur.entries.map(e =>
        e.id === targetEntryId
          ? { ...e, updatedAt: Date.now(), todos: [newTodo, ...e.todos] }
          : e
      )
    }));
  };

  addTodoBtn?.addEventListener("click", () => { void submitTodo(); });
  todoInput?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submitTodo();
    }
  });
}

export async function openNotesWidgetModal(widgetId, { entryId = null, createNew = false } = {}) {
  if (typeof document === "undefined") return;
  ensureNotesModalListeners();
  await ensureNotesStoreLoaded();
  const modal = document.getElementById("notes-widget-modal");
  if (!modal) return;
  activeModalWidgetId = widgetId;

  if (createNew) {
    const newEntry = {
      id: makeId("ne"),
      title: "",
      body: "",
      todos: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    activeModalEntryId = newEntry.id;
    await updateNotesData(widgetId, cur => ({
      ...cur,
      entries: [newEntry, ...cur.entries]
    }));
  } else {
    activeModalEntryId = entryId;
    renderNotesModalContent(widgetId);
  }

  modal.classList.remove("hidden");
  if (createNew) {
    document.getElementById("notes-entry-title")?.focus();
  } else {
    document.getElementById("notes-modal-textarea")?.focus();
  }
}

function refreshNotesWidgetDom(widgetId) {
  const container = notesWidgetElementCache.get(widgetId);
  const widget = activeNotesWidgets.find(w => w.id === widgetId);
  if (!container || !widget) return;

  const data = normalizeNotesWidgetData(getNotesDataSync(widgetId));
  const now = Date.now();
  let pendingTotal = 0;
  let dueTotal = 0;
  for (const entry of data.entries) {
    for (const todo of entry.todos) {
      if (!todo.done) {
        pendingTotal++;
        if (todo.remindAt && todo.remindAt <= now) dueTotal++;
      }
    }
  }

  const badgeEl = container.querySelector(".notes-widget-count");
  if (badgeEl) {
    const label = dueTotal > 0 ? `⏰ ${dueTotal}` : (pendingTotal > 0 ? String(pendingTotal) : String(data.entries.length));
    badgeEl.textContent = label;
    badgeEl.classList.toggle("has-due", dueTotal > 0);
    badgeEl.classList.toggle("hidden", data.entries.length === 0);
  }

  const previewEl = container.querySelector(".notes-widget-preview");
  if (!previewEl) return;
  previewEl.innerHTML = "";

  if (widget.compactMode || data.entries.length === 0) {
    previewEl.classList.add("hidden");
    return;
  }

  previewEl.classList.remove("hidden");

  const shownEntries = data.entries.slice(0, 3);
  for (const entry of shownEntries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "notes-compact-entry";
    row.addEventListener("click", e => {
      e.stopPropagation();
      void openNotesWidgetModal(widgetId, { entryId: entry.id });
    });

    const titleSpan = document.createElement("span");
    titleSpan.className = "notes-compact-todo-text";
    titleSpan.textContent = getEntryDisplayTitle(entry);
    row.appendChild(titleSpan);

    const rem = getEntryNextReminder(entry, now);
    const pendingInEntry = entry.todos.filter(x => !x.done).length;
    if (rem.label) {
      const remSpan = document.createElement("span");
      remSpan.className = `notes-reminder-badge status-${rem.status}`;
      remSpan.textContent = rem.label;
      row.appendChild(remSpan);
    } else if (pendingInEntry > 0) {
      const cnt = document.createElement("span");
      cnt.className = "notes-entry-list-count";
      cnt.textContent = String(pendingInEntry);
      row.appendChild(cnt);
    }

    previewEl.appendChild(row);
  }

  if (data.entries.length > 3) {
    const moreEl = document.createElement("div");
    moreEl.className = "notes-compact-more";
    moreEl.textContent = `+${data.entries.length - 3}`;
    previewEl.appendChild(moreEl);
  }
}

export function syncCustomNotesWidgetElements(customWidgets = []) {
  const notesWidgets = (Array.isArray(customWidgets) ? customWidgets : [])
    .filter(w => w?.type === "notes" && w?.id);
  activeNotesWidgets = notesWidgets;
  const activeIds = new Set(notesWidgets.map(w => w.id));

  for (const [id, el] of notesWidgetElementCache.entries()) {
    if (!activeIds.has(id)) {
      el.remove();
      notesWidgetElementCache.delete(id);
    }
  }

  const elementMap = {};
  for (const w of notesWidgets) {
    let container = notesWidgetElementCache.get(w.id);
    if (!container) {
      container = document.createElement("div");
      container.className = "custom-notes-widget";
      container.dataset.widgetId = w.id;
      notesWidgetElementCache.set(w.id, container);
    }
    container.classList.toggle("is-compact", !!w.compactMode);
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "notes-widget-header";

    const iconEl = createCustomWidgetIconElement(w, "custom-search-icon-img", "custom-search-icon-emoji", "📝");

    const nameEl = document.createElement("span");
    nameEl.className = "notes-widget-name";
    nameEl.textContent = w.name || t("notesDefaultName") || "Notes";

    const countBadge = document.createElement("span");
    countBadge.className = "notes-widget-count hidden";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "notes-widget-action-btn";
    addBtn.textContent = "+";
    addBtn.title = t("notesNewEntryBtn") || "New entry";
    addBtn.addEventListener("click", e => {
      e.stopPropagation();
      void openNotesWidgetModal(w.id, { createNew: true });
    });

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "notes-widget-action-btn";
    expandBtn.textContent = "⤢";
    expandBtn.title = t("notesOpenModalTitle") || "Open notes";
    expandBtn.addEventListener("click", e => {
      e.stopPropagation();
      void openNotesWidgetModal(w.id, {});
    });

    header.append(iconEl, nameEl, countBadge, addBtn, expandBtn);

    const preview = document.createElement("div");
    preview.className = "notes-widget-preview hidden";

    container.onclick = () => {
      void openNotesWidgetModal(w.id, {});
    };

    container.append(header, preview);
    refreshNotesWidgetDom(w.id);
    elementMap[w.id] = container;
  }

  void ensureNotesStoreLoaded().then(() => {
    for (const w of notesWidgets) refreshNotesWidgetDom(w.id);
  });

  return elementMap;
}
