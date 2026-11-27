import { loadConfig } from "./config.js";
import { getCurrentLanguage, t } from "./i18n.js";
import {
  EXTERNAL_REMINDER_FUTURE_MS,
  EXTERNAL_REMINDER_PAST_MS,
  findDueExternalCalendarReminders,
} from "./calendar-ics.js";
import { loadExternalCalendarEvents } from "./calendar-sources.js";

export const CALDAV_NOTIFIED_KEY = "myspeeddial-caldav-notified";
const POLL_INTERVAL_MS = 60000;

let reminderIntervalId = 0;
let checkInFlight = false;
let storageListenerBound = false;
let notifiedWriteQueue = Promise.resolve();

function updateNotifiedStorage(mutator) {
  const run = notifiedWriteQueue.then(async () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const stored = await chrome.storage.local.get(CALDAV_NOTIFIED_KEY);
    const current = stored?.[CALDAV_NOTIFIED_KEY] && typeof stored[CALDAV_NOTIFIED_KEY] === "object"
      ? { ...stored[CALDAV_NOTIFIED_KEY] }
      : {};
    const changed = mutator(current);
    if (changed !== false) {
      await chrome.storage.local.set({ [CALDAV_NOTIFIED_KEY]: current });
    }
  });
  notifiedWriteQueue = run.catch(() => {});
  return run;
}

async function dismissCalendarReminder(reminder) {
  if (!reminder?.key) return;
  await updateNotifiedStorage((current) => {
    current[reminder.key] = reminder.triggerMs;
    return true;
  });
}

function showCalendarReminderToast(reminder) {
  if (typeof document === "undefined") return;
  const ev = reminder?.event;
  if (!ev) return;

  let host = document.getElementById("notes-reminder-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "notes-reminder-toast-host";
    host.className = "notes-reminder-toast-host";
    document.body.appendChild(host);
  }

  const existing = Array.from(host.children).find(
    (node) => node?.dataset?.calendarReminderKey === reminder.key,
  );
  if (existing) return;

  const toast = document.createElement("div");
  toast.className = "notes-reminder-toast";
  toast.dataset.calendarReminderKey = reminder.key;

  const title = document.createElement("div");
  title.className = "notes-reminder-toast-title";
  title.textContent = `📅 ${ev.calendarName || (ev.source === "caldav" ? "CalDAV" : "WebCAL")}`;

  const body = document.createElement("div");
  body.className = "notes-reminder-toast-body";
  const locale = getCurrentLanguage();
  const timeLabel = ev.allDay
    ? (t("calendarAllDay") || "All day")
    : new Intl.DateTimeFormat(locale || "en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ev.startMs));
  body.textContent = `${timeLabel} · ${ev.title}`;

  const actions = document.createElement("div");
  actions.className = "notes-reminder-toast-actions";

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "icon-btn";
  dismissBtn.textContent = t("dismiss") || "Dismiss";
  dismissBtn.addEventListener("click", () => {
    toast.remove();
    void dismissCalendarReminder(reminder);
  });

  actions.appendChild(dismissBtn);
  toast.append(title, body, actions);
  host.appendChild(toast);
}

/**
 * Pull CalDAV events in [-1 day, +7 days], show bottom-right toast notifications for any due
 * or missed reminders within that window, and prune older entries from storage.
 */
export async function checkDueCalendarReminders() {
  if (checkInFlight || typeof chrome === "undefined" || !chrome.storage?.local) return;
  checkInFlight = true;
  try {
    const config = await loadConfig();
    const sources = Array.isArray(config?.appearance?.calendarSources)
      ? config.appearance.calendarSources
      : [];
    const reminderSources = sources.filter(
      (s) =>
        s &&
        (s.type === "caldav" || s.type === "webcal") &&
        (Boolean(s.url) || Boolean(s.privateUrl)) &&
        s.enabled !== false &&
        (s.enableReminders !== undefined ? Boolean(s.enableReminders) : s.type === "caldav"),
    );
    if (reminderSources.length === 0) return;

    const nowMs = Date.now();
    const rangeStartMs = nowMs - EXTERNAL_REMINDER_PAST_MS;
    const rangeEndMs = nowMs + EXTERNAL_REMINDER_FUTURE_MS;

    const [events, storedNotified] = await Promise.all([
      loadExternalCalendarEvents({
        sources: reminderSources,
        rangeStartMs,
        rangeEndMs,
        nowMs,
      }),
      chrome.storage.local.get(CALDAV_NOTIFIED_KEY),
    ]);

    const notifiedMap = storedNotified?.[CALDAV_NOTIFIED_KEY] || {};
    const { dueReminders, prunedNotifiedMap, changed } = findDueExternalCalendarReminders(
      events,
      notifiedMap,
      nowMs,
    );

    for (const reminder of dueReminders) {
      showCalendarReminderToast(reminder);
    }
    if (changed) {
      await updateNotifiedStorage((current) => {
        const minTriggerMs = nowMs - EXTERNAL_REMINDER_PAST_MS;
        let mutated = false;
        for (const [key, ts] of Object.entries(current)) {
          if (!Number.isFinite(Number(ts)) || Number(ts) < minTriggerMs) {
            delete current[key];
            mutated = true;
          }
        }
        return mutated;
      });
    }
  } finally {
    checkInFlight = false;
  }
}

export function startCalendarReminderPolling() {
  if (!storageListenerBound && typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    storageListenerBound = true;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes?.[CALDAV_NOTIFIED_KEY] || typeof document === "undefined") return;
      const dismissedMap = changes[CALDAV_NOTIFIED_KEY].newValue || {};
      const host = document.getElementById("notes-reminder-toast-host");
      if (!host) return;
      for (const node of Array.from(host.children)) {
        const key = node?.dataset?.calendarReminderKey;
        if (key && Object.prototype.hasOwnProperty.call(dismissedMap, key)) {
          node.remove();
        }
      }
    });
  }
  if (reminderIntervalId || typeof setInterval === "undefined") return;
  void checkDueCalendarReminders();
  reminderIntervalId = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void checkDueCalendarReminders();
  }, POLL_INTERVAL_MS);

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void checkDueCalendarReminders();
      }
    });
  }
}
