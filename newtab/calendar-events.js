import { loadExternalCalendarEvents } from "./calendar-sources.js";

export const NOTES_STORAGE_KEY = "myspeeddial-widget-notes";

/**
 * Format a Date or epoch ms as a local YYYY-MM-DD key.
 * @param {Date | number} dateOrMs
 * @returns {string}
 */
export function formatLocalDateKey(dateOrMs) {
  const date = dateOrMs instanceof Date ? dateOrMs : new Date(dateOrMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Extract normalized calendar events from stored Notepad widget data.
 * Includes both active and completed (done) reminders so past days remain visible.
 * @param {Map<string, any> | Record<string, any> | null | undefined} notesByWidgetId
 * @param {number} [nowMs=Date.now()]
 */
export function extractNotesCalendarEvents(notesByWidgetId, nowMs = Date.now()) {
  const events = [];
  if (!notesByWidgetId || typeof notesByWidgetId !== "object") {
    return events;
  }

  const entriesList =
    notesByWidgetId instanceof Map
      ? notesByWidgetId.entries()
      : Object.entries(notesByWidgetId);

  for (const [widgetId, rawData] of entriesList) {
    if (!rawData || typeof rawData !== "object") continue;

    const noteEntries = Array.isArray(rawData.entries)
      ? rawData.entries
      : Array.isArray(rawData.todos)
        ? [{ id: null, title: "", todos: rawData.todos }]
        : [];

    for (const entry of noteEntries) {
      if (!entry || !Array.isArray(entry.todos)) continue;
      const entryId = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null;
      const entryTitle = typeof entry.title === "string" ? entry.title.trim() : "";

      for (const todo of entry.todos) {
        const remindAt = Number(todo?.remindAt);
        if (!Number.isFinite(remindAt) || remindAt <= 0) continue;
        const text = typeof todo?.text === "string" ? todo.text.trim() : "";
        if (!text) continue;

        const todoId = typeof todo.id === "string" && todo.id.trim() ? todo.id.trim() : null;
        events.push({
          id: `notes:${widgetId}:${entryId || "legacy"}:${todoId || remindAt}`,
          source: "notes",
          title: text,
          subtitle: entryTitle,
          startMs: remindAt,
          endMs: remindAt,
          allDay: false,
          done: !!todo.done,
          status: remindAt < nowMs ? "past" : "future",
          widgetId,
          entryId,
          todoId,
        });
      }
    }
  }

  return events;
}

/**
 * Group normalized calendar events by local YYYY-MM-DD key.
 * Notes reminders drive highlightStatus ("past" red / "future" green);
 * external events (WebCAL/CalDAV) span multi-day ranges and supply dot colors.
 * @param {Array<{ startMs: number, endMs?: number, source?: string, color?: string }>} events
 * @param {number} [nowMs=Date.now()]
 */
export function indexCalendarEventsByDate(events, nowMs = Date.now()) {
  const byDate = new Map();
  if (!Array.isArray(events)) return byDate;

  const ensureBucket = (dateKey) => {
    let bucket = byDate.get(dateKey);
    if (!bucket) {
      bucket = {
        dateKey,
        events: [],
        hasPast: false,
        hasFuture: false,
        highlightStatus: "none",
        externalColors: [],
      };
      byDate.set(dateKey, bucket);
    }
    return bucket;
  };

  for (const event of events) {
    if (!event || !Number.isFinite(Number(event.startMs))) continue;
    const startMs = Number(event.startMs);
    const endMs = Number.isFinite(Number(event.endMs)) ? Number(event.endMs) : startMs;
    const isNotes = event.source === "notes" || !event.source;

    const startDate = new Date(startMs);
    const endBoundaryMs = endMs > startMs ? endMs - 1 : startMs;
    const endDate = new Date(endBoundaryMs);
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const lastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    let dayGuard = 0;
    while (cursor.getTime() <= lastDay.getTime() && dayGuard < 366) {
      dayGuard += 1;
      const dateKey = formatLocalDateKey(cursor);
      const bucket = ensureBucket(dateKey);
      bucket.events.push(event);

      if (isNotes) {
        if (startMs < nowMs) {
          bucket.hasPast = true;
        } else {
          bucket.hasFuture = true;
        }
      } else if (event.color && !bucket.externalColors.includes(event.color) && bucket.externalColors.length < 3) {
        bucket.externalColors.push(event.color);
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const bucket of byDate.values()) {
    bucket.events.sort((a, b) => {
      if (Boolean(a.allDay) !== Boolean(b.allDay)) return a.allDay ? -1 : 1;
      return a.startMs - b.startMs;
    });
    bucket.highlightStatus = bucket.hasPast ? "past" : bucket.hasFuture ? "future" : "none";
  }

  return byDate;
}

async function readStoredNotesEvents(nowMs) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return [];
  }
  const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
  return extractNotesCalendarEvents(result?.[NOTES_STORAGE_KEY], nowMs);
}

/**
 * Load and index calendar events from all registered providers (Notes + WebCAL, CalDAV-ready).
 * @param {{
 *   nowMs?: number,
 *   sources?: Array<any>,
 *   rangeStartMs?: number,
 *   rangeEndMs?: number,
 *   forceExternal?: boolean,
 *   extraProviders?: Array<(nowMs: number) => Promise<Array<any>>>,
 * }} [options]
 */
export async function loadCalendarEvents({
  nowMs = Date.now(),
  sources = [],
  rangeStartMs = -Infinity,
  rangeEndMs = Infinity,
  forceExternal = false,
  extraProviders = [],
} = {}) {
  const providerResults = await Promise.all([
    readStoredNotesEvents(nowMs),
    loadExternalCalendarEvents({
      sources,
      rangeStartMs,
      rangeEndMs,
      nowMs,
      force: forceExternal,
    }),
    ...extraProviders.map((provider) =>
      Promise.resolve()
        .then(() => provider(nowMs))
        .catch(() => []),
    ),
  ]);

  const events = providerResults.flat();
  return {
    events,
    byDate: indexCalendarEventsByDate(events, nowMs),
  };
}
