import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalendarMonthGrid,
  getIsoWeekNumber,
  normalizeWeekStartsOn,
} from "../newtab/calendar-grid.js";
import {
  extractNotesCalendarEvents,
  formatLocalDateKey,
  indexCalendarEventsByDate,
} from "../newtab/calendar-events.js";
import {
  MAX_ICS_BYTES,
  MAX_ICS_SUMMARY_LENGTH,
  parseIcsCalendar,
  serializeIcsEvent,
} from "../newtab/calendar-ics.js";
import { parseCaldavMultistatusXml } from "../newtab/calendar-caldav.js";
import {
  MAX_CALENDAR_SOURCES,
  MAX_CALENDAR_URL_LENGTH,
  normalizeCalendarSourceUrl,
  normalizeCalendarSources,
} from "../newtab/calendar-sources.js";

test("normalizeWeekStartsOn defaults to monday and accepts sunday", () => {
  assert.equal(normalizeWeekStartsOn("sunday"), "sunday");
  assert.equal(normalizeWeekStartsOn("monday"), "monday");
  assert.equal(normalizeWeekStartsOn(undefined), "monday");
  assert.equal(normalizeWeekStartsOn("friday"), "monday");
});

test("getIsoWeekNumber handles year boundaries and week 53", () => {
  assert.equal(getIsoWeekNumber(new Date(2024, 0, 1)), 1);
  assert.equal(getIsoWeekNumber(new Date(2023, 0, 1)), 52);
  assert.equal(getIsoWeekNumber(new Date(2020, 11, 31)), 53);
  assert.equal(getIsoWeekNumber(new Date(2026, 0, 1)), 1);
  assert.equal(getIsoWeekNumber(new Date(2026, 10, 26)), 48);
});

test("buildCalendarMonthGrid builds 6x7 monday-first grid with week numbers", () => {
  const today = new Date(2026, 10, 26);
  const grid = buildCalendarMonthGrid(2026, 10, "monday", "en", today);

  assert.equal(grid.weekStartsOn, "monday");
  assert.equal(grid.weekdays.length, 7);
  assert.equal(grid.rows.length, 6);

  // Nov 1, 2026 is a Sunday, so Monday-first starts on Oct 26, 2026 (ISO week 44).
  assert.equal(grid.rows[0].weekNumber, 44);
  assert.equal(grid.rows[0].days[0].month, 9);
  assert.equal(grid.rows[0].days[0].day, 26);
  assert.equal(grid.rows[0].days[0].isCurrentMonth, false);
  assert.equal(grid.rows[0].days[6].month, 10);
  assert.equal(grid.rows[0].days[6].day, 1);
  assert.equal(grid.rows[0].days[6].isCurrentMonth, true);

  const allDays = grid.rows.flatMap((row) => row.days);
  const todayCells = allDays.filter((cell) => cell.isToday);
  assert.equal(todayCells.length, 1);
  assert.equal(todayCells[0].day, 26);
  assert.equal(todayCells[0].month, 10);
});

test("buildCalendarMonthGrid supports sunday-first week start", () => {
  const gridMon = buildCalendarMonthGrid(2026, 10, "monday", "en", new Date(2026, 10, 26));
  const gridSun = buildCalendarMonthGrid(2026, 10, "sunday", "en", new Date(2026, 10, 26));

  assert.equal(gridSun.weekStartsOn, "sunday");
  assert.notEqual(gridSun.weekdays[0], gridMon.weekdays[0]);

  // Nov 1, 2026 is a Sunday, so Sunday-first starts directly on Nov 1.
  assert.equal(gridSun.rows[0].days[0].month, 10);
  assert.equal(gridSun.rows[0].days[0].day, 1);
  assert.equal(gridSun.rows[0].days[0].isCurrentMonth, true);
});

test("extractNotesCalendarEvents keeps done reminders and classifies past/future", () => {
  const nowMs = new Date(2026, 10, 26, 12, 0, 0).getTime();
  const pastDoneMs = new Date(2026, 10, 20, 9, 30, 0).getTime();
  const futureMs = new Date(2026, 10, 28, 15, 0, 0).getTime();

  const events = extractNotesCalendarEvents(
    {
      notes_1: {
        entries: [
          {
            id: "entry_a",
            title: "Work",
            todos: [
              { id: "t1", text: "Completed task", done: true, remindAt: pastDoneMs },
              { id: "t2", text: "Upcoming call", done: false, remindAt: futureMs },
              { id: "t3", text: "No reminder", done: false, remindAt: null },
            ],
          },
        ],
      },
    },
    nowMs,
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].status, "past");
  assert.equal(events[0].done, true);
  assert.equal(events[0].widgetId, "notes_1");
  assert.equal(events[0].entryId, "entry_a");
  assert.equal(events[1].status, "future");
  assert.equal(events[1].done, false);
});

test("indexCalendarEventsByDate resolves mixed past+future day to past (red)", () => {
  const nowMs = new Date(2026, 10, 26, 12, 0, 0).getTime();
  const sameDayPast = new Date(2026, 10, 26, 9, 0, 0).getTime();
  const sameDayFuture = new Date(2026, 10, 26, 18, 0, 0).getTime();
  const nextDayFuture = new Date(2026, 10, 27, 10, 0, 0).getTime();

  const events = extractNotesCalendarEvents(
    {
      notes_1: {
        entries: [
          {
            id: "entry_1",
            title: "Daily",
            todos: [
              { id: "a", text: "Morning", done: false, remindAt: sameDayPast },
              { id: "b", text: "Evening", done: false, remindAt: sameDayFuture },
              { id: "c", text: "Tomorrow", done: false, remindAt: nextDayFuture },
            ],
          },
        ],
      },
    },
    nowMs,
  );

  const byDate = indexCalendarEventsByDate(events, nowMs);
  const mixedKey = formatLocalDateKey(sameDayPast);
  const futureKey = formatLocalDateKey(nextDayFuture);

  assert.equal(byDate.get(mixedKey).events.length, 2);
  assert.equal(byDate.get(mixedKey).highlightStatus, "past");
  assert.equal(byDate.get(futureKey).events.length, 1);
  assert.equal(byDate.get(futureKey).highlightStatus, "future");
});

test("parseIcsCalendar parses all-day, timed UTC, RRULE, EXDATE, and skips CANCELLED", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:holiday-1",
    "SUMMARY:Christmas\\, Day 1",
    "DTSTART;VALUE=DATE:20261225",
    "DTEND;VALUE=DATE:20261227",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly-1",
    "SUMMARY:Standup",
    "DTSTART:20261102T090000Z",
    "DURATION:PT30M",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "EXDATE:20261109T090000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:cancelled-1",
    "SUMMARY:Cancelled meeting",
    "DTSTART:20261115T100000Z",
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const rangeStartMs = new Date(2026, 10, 1).getTime();
  const rangeEndMs = new Date(2027, 0, 1).getTime();
  const events = parseIcsCalendar(ics, { rangeStartMs, rangeEndMs });

  const holiday = events.find((e) => e.uid === "holiday-1");
  assert.ok(holiday);
  assert.equal(holiday.allDay, true);
  assert.equal(holiday.title, "Christmas, Day 1");

  const standups = events.filter((e) => e.uid === "weekly-1");
  assert.equal(standups.length, 2); // Nov 2 and Nov 16 (Nov 9 excluded by EXDATE)
  assert.equal(events.some((e) => e.uid === "cancelled-1"), false);
});

test("normalizeCalendarSourceUrl and normalizeCalendarSources support webcal:// and reject unsafe URLs", () => {
  assert.equal(normalizeCalendarSourceUrl("webcal://example.com/cal.ics"), "https://example.com/cal.ics");
  assert.equal(normalizeCalendarSourceUrl("javascript:alert(1)"), "");

  const normalized = normalizeCalendarSources([
    { id: "c1", type: "webcal", name: "Holidays", url: "webcal://example.com/h.ics", color: "#22C55E" },
    { id: "c2", type: "webcal", name: "Bad", url: "data:text/plain,hi" },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].url, "https://example.com/h.ics");
  assert.equal(normalized[0].color, "#22c55e");
});

test("indexCalendarEventsByDate spans multi-day external events and preserves notes highlightStatus", () => {
  const nowMs = new Date(2026, 11, 1, 12, 0, 0).getTime();
  const holidayStart = new Date(2026, 11, 25, 0, 0, 0).getTime();
  const holidayEnd = new Date(2026, 11, 27, 0, 0, 0).getTime(); // 25th and 26th

  const byDate = indexCalendarEventsByDate(
    [
      {
        id: "webcal:h1",
        source: "webcal",
        title: "Holiday",
        startMs: holidayStart,
        endMs: holidayEnd,
        allDay: true,
        color: "#3b82f6",
      },
    ],
    nowMs,
  );

  assert.equal(byDate.get("2026-12-25").highlightStatus, "none");
  assert.deepEqual(byDate.get("2026-12-25").externalColors, ["#3b82f6"]);
  assert.equal(byDate.has("2026-12-26"), true);
  assert.equal(byDate.has("2026-12-27"), false); // DTEND is exclusive
});

test("calendar bounds enforce combined source limit, single notes-sync target, URL length, summary truncation, and max ICS size", () => {
  const longUrl = `https://example.com/${"a".repeat(MAX_CALENDAR_URL_LENGTH)}`;
  assert.equal(normalizeCalendarSourceUrl(longUrl), "");

  const manyWebcals = Array.from({ length: 7 }, (_, i) => ({
    id: `w_${i}`,
    type: "webcal",
    name: `WebCAL ${i}`,
    url: `https://example.com/${i}.ics`,
  }));
  const manyCaldavs = Array.from({ length: 6 }, (_, i) => ({
    id: `d_${i}`,
    type: "caldav",
    name: `CalDAV ${i}`,
    url: `https://caldav.example.com/${i}/`,
    syncNotesReminders: true,
  }));
  const normalized = normalizeCalendarSources([...manyWebcals, ...manyCaldavs]);
  assert.equal(normalized.length, MAX_CALENDAR_SOURCES);
  assert.equal(normalized.filter((s) => s.syncNotesReminders).length, 1);

  const longSummary = "X".repeat(MAX_ICS_SUMMARY_LENGTH + 50);
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:long-1",
    `SUMMARY:${longSummary}`,
    "DTSTART;VALUE=DATE:20261201",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const parsed = parseIcsCalendar(ics);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title.length, MAX_ICS_SUMMARY_LENGTH);

  const oversized = "A".repeat(MAX_ICS_BYTES + 1);
  assert.deepEqual(parseIcsCalendar(oversized), []);
});

test("parseIcsCalendar includes date-only UNTIL day and expands long-running weekly RRULE", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:until-inclusive",
    "SUMMARY:Last day event",
    "DTSTART:20261110T100000Z",
    "RRULE:FREQ=DAILY;UNTIL=20261112",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:old-weekly",
    "SUMMARY:Weekly sync",
    "DTSTART:20150105T090000Z",
    "RRULE:FREQ=WEEKLY",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const untilEvents = parseIcsCalendar(ics, {
    rangeStartMs: new Date(2026, 10, 1).getTime(),
    rangeEndMs: new Date(2026, 11, 1).getTime(),
  });
  assert.equal(untilEvents.filter((e) => e.uid === "until-inclusive").length, 3);
  assert.ok(untilEvents.some((e) => e.uid === "old-weekly"));
});

test("serializeIcsEvent and parseCaldavMultistatusXml round-trip VEVENTs", () => {
  const startMs = Date.UTC(2026, 10, 27, 14, 30, 0);
  const ics = serializeIcsEvent({
    uid: "simpledial-note-nt1",
    summary: "Pay bills, check mail",
    description: "Finance",
    startMs,
    done: false,
  });

  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">',
    "  <d:response>",
    "    <d:href>/calendars/user/personal/simpledial-note-nt1.ics</d:href>",
    "    <d:propstat>",
    "      <d:prop>",
    '        <d:getetag>"abc-123"</d:getetag>',
    `        <cal:calendar-data>${ics.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</cal:calendar-data>`,
    "      </d:prop>",
    "    </d:propstat>",
    "  </d:response>",
    "</d:multistatus>",
  ].join("\n");

  const items = parseCaldavMultistatusXml(xml, "https://dav.example.com/calendars/user/personal/");
  assert.equal(items.length, 1);
  assert.equal(items[0].href, "https://dav.example.com/calendars/user/personal/simpledial-note-nt1.ics");
  assert.equal(items[0].etag, '"abc-123"');

  const parsed = parseIcsCalendar(items[0].icsText);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].uid, "simpledial-note-nt1");
  assert.equal(parsed[0].title, "Pay bills, check mail");
  assert.equal(parsed[0].startMs, startMs);

  // Security: UID newlines are stripped and cross-origin <href> is rejected.
  const injectedIcs = serializeIcsEvent({
    uid: "id-1\r\nATTENDEE:mailto:evil@example.com",
    summary: "Safe",
    startMs,
  });
  assert.equal(injectedIcs.includes("\r\nATTENDEE:"), false);

  const crossOriginXml = [
    '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">',
    "  <d:response>",
    "    <d:href>https://evil.example.com/steal.ics</d:href>",
    `    <d:propstat><d:prop><cal:calendar-data>${ics.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</cal:calendar-data></d:prop></d:propstat>`,
    "  </d:response>",
    "</d:multistatus>",
  ].join("\n");
  assert.equal(parseCaldavMultistatusXml(crossOriginXml, "https://dav.example.com/cal/").length, 0);
});
