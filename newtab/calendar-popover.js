import { loadConfig } from "./config.js";
import { getCurrentLanguage, t } from "./i18n.js";
import { buildCalendarMonthGrid, normalizeWeekStartsOn } from "./calendar-grid.js";
import {
  NOTES_STORAGE_KEY,
  formatLocalDateKey,
  indexCalendarEventsByDate,
  loadCalendarEvents,
} from "./calendar-events.js";

export { buildCalendarMonthGrid, getIsoWeekNumber, normalizeWeekStartsOn } from "./calendar-grid.js";

let popoverEl = null;
let anchorEl = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let activeWeekStartsOn = "monday";
let activeCalendarSources = [];
let rawEvents = [];
let eventsByDate = new Map();
let selectedDateKey = null;
let isPopoverOpen = false;
let listenersAttached = false;
let storageListenerAttached = false;
let viewLoadGeneration = 0;
let lastManualRefreshAt = 0;
let isManualRefreshInFlight = false;
let refreshCooldownTimerId = 0;
const MANUAL_REFRESH_COOLDOWN_MS = 30000;

function getVisibleMonthRange(year, month) {
  return {
    rangeStartMs: new Date(year, month - 1, 1).getTime(),
    rangeEndMs: new Date(year, month + 2, 1).getTime(),
  };
}

async function reloadEventsForCurrentView({ forceExternal = false } = {}) {
  const gen = ++viewLoadGeneration;
  const { rangeStartMs, rangeEndMs } = getVisibleMonthRange(viewYear, viewMonth);
  const loaded = await loadCalendarEvents({
    sources: activeCalendarSources,
    rangeStartMs,
    rangeEndMs,
    forceExternal,
  });
  if (gen !== viewLoadGeneration) return false;
  rawEvents = loaded.events;
  eventsByDate = loaded.byDate;
  return true;
}

function ensurePopoverElement() {
  if (popoverEl) return popoverEl;
  const el = document.createElement("div");
  el.id = "datetime-calendar-popover";
  el.className = "datetime-calendar-popover";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "false");
  el.hidden = true;
  document.body.appendChild(el);
  popoverEl = el;
  return el;
}

function positionPopover() {
  if (!popoverEl || !anchorEl || !isPopoverOpen) return;
  const margin = 12;
  const gap = 8;
  const rect = anchorEl.getBoundingClientRect();
  const popRect = popoverEl.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));

  let top = rect.bottom + gap;
  if (top + popRect.height > window.innerHeight - margin && rect.top - gap - popRect.height >= margin) {
    top = rect.top - gap - popRect.height;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - popRect.height - margin));

  popoverEl.style.left = `${Math.round(left)}px`;
  popoverEl.style.top = `${Math.round(top)}px`;
}

function renderPopover() {
  const el = ensurePopoverElement();
  const locale = getCurrentLanguage();
  const nowMs = Date.now();
  eventsByDate = indexCalendarEventsByDate(rawEvents, nowMs);
  const grid = buildCalendarMonthGrid(viewYear, viewMonth, activeWeekStartsOn, locale);

  el.setAttribute("aria-label", `${t("dateTimeCalendarTitle")}: ${grid.monthLabel}`);
  el.replaceChildren();

  const header = document.createElement("div");
  header.className = "datetime-calendar-header";

  const title = document.createElement("div");
  title.className = "datetime-calendar-month-label";
  title.textContent = grid.monthLabel;

  const nav = document.createElement("div");
  nav.className = "datetime-calendar-nav";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "datetime-calendar-nav-btn";
  prevBtn.textContent = "‹";
  prevBtn.title = t("calendarPrevMonth");
  prevBtn.setAttribute("aria-label", t("calendarPrevMonth"));
  prevBtn.addEventListener("click", () => {
    selectedDateKey = null;
    const next = new Date(viewYear, viewMonth - 1, 1);
    viewYear = next.getFullYear();
    viewMonth = next.getMonth();
    void reloadEventsForCurrentView().then((fresh) => {
      if (fresh && isPopoverOpen) {
        renderPopover();
        positionPopover();
      }
    });
  });

  const todayBtn = document.createElement("button");
  todayBtn.type = "button";
  todayBtn.className = "datetime-calendar-today-btn";
  todayBtn.textContent = t("calendarTodayBtn");
  todayBtn.addEventListener("click", () => {
    selectedDateKey = null;
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    void reloadEventsForCurrentView().then((fresh) => {
      if (fresh && isPopoverOpen) {
        renderPopover();
        positionPopover();
      }
    });
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "datetime-calendar-nav-btn";
  nextBtn.textContent = "›";
  nextBtn.title = t("calendarNextMonth");
  nextBtn.setAttribute("aria-label", t("calendarNextMonth"));
  nextBtn.addEventListener("click", () => {
    selectedDateKey = null;
    const next = new Date(viewYear, viewMonth + 1, 1);
    viewYear = next.getFullYear();
    viewMonth = next.getMonth();
    void reloadEventsForCurrentView().then((fresh) => {
      if (fresh && isPopoverOpen) {
        renderPopover();
        positionPopover();
      }
    });
  });

  nav.append(prevBtn, todayBtn, nextBtn);
  const hasActiveExternalCalendar = activeCalendarSources.some(
    (s) => s && (s.type === "webcal" || s.type === "caldav") && Boolean(s.url) && s.enabled !== false,
  );
  if (hasActiveExternalCalendar) {
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "datetime-calendar-nav-btn";
    refreshBtn.textContent = "↻";
    const remainingMs = Math.max(0, MANUAL_REFRESH_COOLDOWN_MS - (Date.now() - lastManualRefreshAt));
    const onCooldown = isManualRefreshInFlight || remainingMs > 0;
    refreshBtn.disabled = onCooldown;
    refreshBtn.title = remainingMs > 0
      ? `${t("refresh") || "Refresh"} (${Math.ceil(remainingMs / 1000)}s)`
      : (t("refresh") || "Refresh");
    refreshBtn.setAttribute("aria-label", t("refresh") || "Refresh");
    if (remainingMs > 0 && !refreshCooldownTimerId) {
      refreshCooldownTimerId = setTimeout(() => {
        refreshCooldownTimerId = 0;
        if (isPopoverOpen) {
          renderPopover();
        }
      }, remainingMs + 50);
    }
    refreshBtn.addEventListener("click", () => {
      const now = Date.now();
      if (isManualRefreshInFlight || now - lastManualRefreshAt < MANUAL_REFRESH_COOLDOWN_MS) {
        return;
      }
      isManualRefreshInFlight = true;
      lastManualRefreshAt = now;
      refreshBtn.disabled = true;
      if (refreshCooldownTimerId) {
        clearTimeout(refreshCooldownTimerId);
      }
      refreshCooldownTimerId = setTimeout(() => {
        refreshCooldownTimerId = 0;
        if (isPopoverOpen) {
          renderPopover();
        }
      }, MANUAL_REFRESH_COOLDOWN_MS + 50);
      void reloadEventsForCurrentView({ forceExternal: true }).finally(() => {
        isManualRefreshInFlight = false;
        if (isPopoverOpen) {
          renderPopover();
          positionPopover();
        }
      });
    });
    nav.appendChild(refreshBtn);
  }
  header.append(title, nav);

  const table = document.createElement("div");
  table.className = "datetime-calendar-grid";
  table.setAttribute("role", "grid");

  const weekColHeader = document.createElement("div");
  weekColHeader.className = "datetime-calendar-cell datetime-calendar-wk-header";
  weekColHeader.textContent = t("calendarWeekCol");
  table.appendChild(weekColHeader);

  for (const label of grid.weekdays) {
    const wd = document.createElement("div");
    wd.className = "datetime-calendar-cell datetime-calendar-weekday";
    wd.textContent = label;
    table.appendChild(wd);
  }

  for (const row of grid.rows) {
    const wkCell = document.createElement("div");
    wkCell.className = "datetime-calendar-cell datetime-calendar-week-num";
    wkCell.textContent = String(row.weekNumber);
    table.appendChild(wkCell);

    for (const day of row.days) {
      const dayCell = document.createElement("button");
      dayCell.type = "button";
      dayCell.className = "datetime-calendar-cell datetime-calendar-day";
      if (!day.isCurrentMonth) dayCell.classList.add("is-other-month");
      if (day.isToday) dayCell.classList.add("is-today");
      if (day.isWeekend) dayCell.classList.add("is-weekend");
      dayCell.textContent = String(day.day);

      const dateKey = formatLocalDateKey(new Date(day.year, day.month, day.day));
      const daySummary = eventsByDate.get(dateKey);
      if (daySummary && daySummary.events.length > 0) {
        if (daySummary.highlightStatus === "past") {
          dayCell.classList.add("has-reminder-past");
        } else if (daySummary.highlightStatus === "future") {
          dayCell.classList.add("has-reminder-future");
        }
        if (daySummary.externalColors?.length > 0) {
          dayCell.classList.add("has-external-events");
          const dotsWrap = document.createElement("span");
          dotsWrap.className = "datetime-calendar-dots";
          for (const color of daySummary.externalColors) {
            const dot = document.createElement("span");
            dot.className = "datetime-calendar-dot";
            dot.style.backgroundColor = color;
            dotsWrap.appendChild(dot);
          }
          dayCell.appendChild(dotsWrap);
        }
        if (selectedDateKey === dateKey) {
          dayCell.classList.add("is-selected");
        }
        dayCell.title = daySummary.events.map((ev) => ev.title).join("\n");
        dayCell.addEventListener("click", () => {
          const singleNotesOnly =
            daySummary.events.length === 1 && daySummary.events[0].source === "notes";
          if (singleNotesOnly) {
            void openCalendarEvent(daySummary.events[0]);
            return;
          }
          selectedDateKey = selectedDateKey === dateKey ? null : dateKey;
          renderPopover();
          positionPopover();
        });
      } else if (!day.isCurrentMonth) {
        dayCell.addEventListener("click", () => {
          selectedDateKey = null;
          viewYear = day.year;
          viewMonth = day.month;
          renderPopover();
          positionPopover();
        });
      }
      table.appendChild(dayCell);
    }
  }

  el.append(header, table);

  const selectedSummary = selectedDateKey ? eventsByDate.get(selectedDateKey) : null;
  if (selectedSummary && selectedSummary.events.length > 0) {
    const agenda = document.createElement("div");
    agenda.className = "datetime-calendar-agenda";

    const [y, m, d] = selectedDateKey.split("-").map(Number);
    const agendaDateLabel = new Intl.DateTimeFormat(locale || "en", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(y, m - 1, d));

    const agendaHeader = document.createElement("div");
    agendaHeader.className = "datetime-calendar-agenda-header";
    agendaHeader.textContent = agendaDateLabel;

    const agendaList = document.createElement("div");
    agendaList.className = "datetime-calendar-agenda-list";

    const timeFormatter = new Intl.DateTimeFormat(locale || "en", {
      hour: "2-digit",
      minute: "2-digit",
    });

    for (const ev of selectedSummary.events) {
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "datetime-calendar-agenda-item";

      const dot = document.createElement("span");
      const isPast = ev.startMs < nowMs;
      dot.className = "datetime-calendar-agenda-dot";
      if (ev.source === "notes") {
        dot.classList.add(isPast ? "is-past" : "is-future");
      } else if (ev.color) {
        dot.style.backgroundColor = ev.color;
      }

      const timeEl = document.createElement("span");
      timeEl.className = "datetime-calendar-agenda-time";
      timeEl.textContent = ev.allDay ? (t("calendarAllDay") || "All day") : timeFormatter.format(new Date(ev.startMs));

      const textEl = document.createElement("span");
      textEl.className = `datetime-calendar-agenda-text${ev.done ? " is-done" : ""}`;
      textEl.textContent = ev.subtitle ? `${ev.title} · ${ev.subtitle}` : ev.title;

      itemBtn.append(dot, timeEl, textEl);
      itemBtn.addEventListener("click", () => {
        void openCalendarEvent(ev);
      });
      agendaList.appendChild(itemBtn);
    }

    agenda.append(agendaHeader, agendaList);
    el.appendChild(agenda);
  }
}

async function openCalendarEvent(event) {
  if (!event) return;
  if (event.source === "notes" && event.widgetId) {
    closeDateTimeCalendarPopover();
    const { openNotesWidgetModal } = await import("./widgets/notes-widget.js");
    await openNotesWidgetModal(event.widgetId, { entryId: event.entryId || null });
  }
}

function handleDocumentPointerDown(event) {
  if (!isPopoverOpen || !popoverEl) return;
  if (popoverEl.contains(event.target)) return;
  if (anchorEl && anchorEl.contains(event.target)) return;
  closeDateTimeCalendarPopover();
}

function handleDocumentKeyDown(event) {
  if (!isPopoverOpen) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    closeDateTimeCalendarPopover({ restoreFocus: true });
  }
}

function handleViewportChange() {
  if (isPopoverOpen) {
    positionPopover();
  }
}

function attachGlobalListeners() {
  if (!listenersAttached) {
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    listenersAttached = true;
  }

  if (!storageListenerAttached && typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    storageListenerAttached = true;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes?.[NOTES_STORAGE_KEY] || !isPopoverOpen) return;
      void reloadEventsForCurrentView().then(() => {
        if (selectedDateKey && !eventsByDate.has(selectedDateKey)) {
          selectedDateKey = null;
        }
        if (isPopoverOpen) {
          renderPopover();
          positionPopover();
        }
      });
    });
  }
}

export function closeDateTimeCalendarPopover({ restoreFocus = false } = {}) {
  if (!isPopoverOpen || !popoverEl) return;
  isPopoverOpen = false;
  selectedDateKey = null;
  popoverEl.classList.remove("is-open");
  popoverEl.hidden = true;
  if (anchorEl) {
    anchorEl.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      anchorEl.focus();
    }
  }
}

export async function toggleDateTimeCalendarPopover(targetAnchor) {
  if (!targetAnchor) return;
  if (isPopoverOpen) {
    closeDateTimeCalendarPopover();
    return;
  }

  anchorEl = targetAnchor;
  selectedDateKey = null;
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  const config = await loadConfig();
  activeWeekStartsOn = normalizeWeekStartsOn(config?.appearance?.calendarWeekStartsOn);
  activeCalendarSources = Array.isArray(config?.appearance?.calendarSources)
    ? config.appearance.calendarSources
    : [];
  await reloadEventsForCurrentView();

  const el = ensurePopoverElement();
  attachGlobalListeners();
  isPopoverOpen = true;
  el.hidden = false;
  el.classList.add("is-open");
  anchorEl.setAttribute("aria-expanded", "true");
  renderPopover();
  positionPopover();
}

export function refreshDateTimeCalendarPopover(overrideWeekStart) {
  if (overrideWeekStart !== undefined) {
    activeWeekStartsOn = normalizeWeekStartsOn(overrideWeekStart);
  }
  if (!isPopoverOpen) return;
  if (anchorEl && anchorEl.getClientRects().length === 0) {
    closeDateTimeCalendarPopover();
    return;
  }
  renderPopover();
  positionPopover();
}

if (typeof window !== "undefined") {
  window.refreshDateTimeCalendarPopover = refreshDateTimeCalendarPopover;
}
