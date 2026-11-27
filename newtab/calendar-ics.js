const DAY_MS = 86400000;
const MAX_RRULE_OCCURRENCES = 500;
const MAX_RRULE_ITERATIONS = 5000;
export const MAX_ICS_BYTES = 2 * 1024 * 1024;
export const MAX_ICS_EVENTS = 5000;
export const MAX_ICS_SUMMARY_LENGTH = 200;
export const MAX_ICS_LOCATION_LENGTH = 200;
const MAX_ICS_UID_LENGTH = 256;
const MAX_ICS_EXDATES = 500;
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function unfoldIcsLines(icsText) {
  if (typeof icsText !== "string" || icsText.length > MAX_ICS_BYTES) return [];
  return icsText
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

function unescapeIcsText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseContentLine(line) {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = left.split(";");
  const name = parts[0].trim().toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i += 1) {
    const eqIdx = parts[i].indexOf("=");
    if (eqIdx === -1) continue;
    const pKey = parts[i].slice(0, eqIdx).trim().toUpperCase();
    const pVal = parts[i].slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
    params[pKey] = pVal;
  }
  return { name, params, value };
}

function getTimeZoneOffsetMs(utcMs, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = {};
    for (const part of fmt.formatToParts(new Date(utcMs))) {
      if (part.type !== "literal") {
        parts[part.type] = Number(part.value);
      }
    }
    const hour = parts.hour === 24 ? 0 : parts.hour;
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      hour,
      parts.minute,
      parts.second,
    );
    return asUtc - utcMs;
  } catch {
    return null;
  }
}

/**
 * Parse an ICS date or date-time value into { ms, allDay }.
 * @param {string} rawValue
 * @param {Record<string, string>} [params]
 * @returns {{ ms: number, allDay: boolean } | null}
 */
export function parseIcsDateValue(rawValue, params = {}) {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();

  const dateOnlyMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnlyMatch || params.VALUE === "DATE") {
    if (!dateOnlyMatch) return null;
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    return {
      ms: new Date(year, month, day, 0, 0, 0, 0).getTime(),
      allDay: true,
    };
  }

  const dtMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
  if (!dtMatch) return null;

  const year = Number(dtMatch[1]);
  const month = Number(dtMatch[2]) - 1;
  const day = Number(dtMatch[3]);
  const hour = Number(dtMatch[4]);
  const minute = Number(dtMatch[5]);
  const second = Number(dtMatch[6]);
  const isUtc = Boolean(dtMatch[7]);

  if (isUtc) {
    return {
      ms: Date.UTC(year, month, day, hour, minute, second, 0),
      allDay: false,
    };
  }

  if (params.TZID) {
    const approxUtc = Date.UTC(year, month, day, hour, minute, second, 0);
    const offset = getTimeZoneOffsetMs(approxUtc, params.TZID);
    if (offset !== null) {
      return { ms: approxUtc - offset, allDay: false };
    }
  }

  return {
    ms: new Date(year, month, day, hour, minute, second, 0).getTime(),
    allDay: false,
  };
}

function parseIcsDurationMs(rawDuration) {
  if (typeof rawDuration !== "string") return 0;
  const match = rawDuration.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const weeks = Number(match[2] || 0);
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const mins = Number(match[5] || 0);
  const secs = Number(match[6] || 0);
  return sign * (((weeks * 7 + days) * 24 + hours) * 3600 + mins * 60 + secs) * 1000;
}

function parseRrule(rawRrule) {
  if (typeof rawRrule !== "string" || !rawRrule.trim()) return null;
  const rule = {};
  for (const part of rawRrule.trim().split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim().toUpperCase();
    const v = part.slice(eqIdx + 1).trim().toUpperCase();
    rule[k] = v;
  }
  if (!rule.FREQ) return null;
  const parsedUntil = rule.UNTIL ? parseIcsDateValue(rule.UNTIL) : null;
  return {
    freq: rule.FREQ,
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: Number(rule.COUNT) > 0 ? Number(rule.COUNT) : null,
    untilMs: parsedUntil ? (parsedUntil.allDay ? parsedUntil.ms + DAY_MS - 1 : parsedUntil.ms) : null,
    byDay: rule.BYDAY ? rule.BYDAY.split(",").map((s) => s.trim()) : null,
  };
}

function advanceDateByFreq(date, freq, interval) {
  const next = new Date(date.getTime());
  if (freq === "DAILY") {
    next.setDate(next.getDate() + interval);
  } else if (freq === "WEEKLY") {
    next.setDate(next.getDate() + interval * 7);
  } else if (freq === "MONTHLY") {
    next.setMonth(next.getMonth() + interval);
  } else if (freq === "YEARLY") {
    next.setFullYear(next.getFullYear() + interval);
  } else {
    return null;
  }
  return next;
}

function expandEventOccurrences(baseEvent, rangeStartMs, rangeEndMs) {
  const durationMs = Math.max(0, baseEvent.endMs - baseEvent.startMs);
  const exdateSet = new Set(baseEvent.exdates);

  if (!baseEvent.rrule) {
    if (exdateSet.has(baseEvent.startMs)) return [];
    const effectiveEnd = Math.max(baseEvent.startMs + 1, baseEvent.endMs);
    if (effectiveEnd <= rangeStartMs || baseEvent.startMs >= rangeEndMs) {
      return [];
    }
    return [baseEvent];
  }

  const rule = baseEvent.rrule;
  const results = [];
  const untilMs = rule.untilMs !== null ? Math.min(rule.untilMs, rangeEndMs) : rangeEndMs;

  if (rule.freq === "WEEKLY" && Array.isArray(rule.byDay) && rule.byDay.length > 0) {
    const targetDays = new Set(
      rule.byDay
        .map((token) => WEEKDAY_CODES.indexOf(token.slice(-2)))
        .filter((idx) => idx >= 0),
    );
    const startDate = new Date(baseEvent.startMs);
    const weekStart = new Date(startDate.getTime());
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    let scanned = 0;
    for (let weekIdx = 0; scanned < MAX_RRULE_ITERATIONS && results.length < MAX_RRULE_OCCURRENCES; weekIdx += rule.interval) {
      const baseWeek = new Date(weekStart.getTime());
      baseWeek.setDate(baseWeek.getDate() + weekIdx * 7);
      if (baseWeek.getTime() > untilMs) break;

      for (let dow = 0; dow < 7; dow += 1) {
        if (!targetDays.has(dow)) continue;
        const occ = new Date(baseWeek.getTime());
        occ.setDate(occ.getDate() + dow);
        occ.setHours(
          startDate.getHours(),
          startDate.getMinutes(),
          startDate.getSeconds(),
          startDate.getMilliseconds(),
        );
        const occStartMs = occ.getTime();
        if (occStartMs < baseEvent.startMs) continue;
        if (occStartMs > untilMs) break;
        if (rule.count !== null && scanned >= rule.count) break;
        scanned += 1;
        if (!exdateSet.has(occStartMs) && occStartMs + Math.max(1, durationMs) > rangeStartMs && occStartMs < rangeEndMs) {
          results.push({ ...baseEvent, startMs: occStartMs, endMs: occStartMs + durationMs });
        }
        if (scanned >= MAX_RRULE_ITERATIONS || results.length >= MAX_RRULE_OCCURRENCES) break;
      }
      if (rule.count !== null && scanned >= rule.count) break;
    }
    return results;
  }

  let cursor = new Date(baseEvent.startMs);
  let scanned = 0;
  while (scanned < MAX_RRULE_ITERATIONS && results.length < MAX_RRULE_OCCURRENCES) {
    const occStartMs = cursor.getTime();
    if (occStartMs > untilMs) break;
    if (rule.count !== null && scanned >= rule.count) break;
    scanned += 1;
    if (!exdateSet.has(occStartMs) && occStartMs + Math.max(1, durationMs) > rangeStartMs && occStartMs < rangeEndMs) {
      results.push({ ...baseEvent, startMs: occStartMs, endMs: occStartMs + durationMs });
    }
    const next = advanceDateByFreq(cursor, rule.freq, rule.interval);
    if (!next || next.getTime() <= occStartMs) break;
    cursor = next;
  }

  return results;
}

/**
 * Parse an iCalendar (.ics) string into event occurrences within [rangeStartMs, rangeEndMs].
 * @param {string} icsText
 * @param {{ rangeStartMs?: number, rangeEndMs?: number }} [options]
 */
export function parseIcsCalendar(icsText, { rangeStartMs = -Infinity, rangeEndMs = Infinity } = {}) {
  const lines = unfoldIcsLines(icsText);
  const events = [];
  let current = null;
  let depth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const upper = line.toUpperCase();

    if (upper === "BEGIN:VEVENT") {
      current = {
        uid: "",
        title: "",
        location: "",
        startMs: null,
        endMs: null,
        durationMs: 0,
        allDay: false,
        status: "",
        rrule: null,
        exdates: [],
      };
      depth = 1;
      continue;
    }

    if (!current) continue;

    if (upper.startsWith("BEGIN:")) {
      depth += 1;
      continue;
    }

    if (upper.startsWith("END:")) {
      depth -= 1;
      if (upper === "END:VEVENT" && depth === 0) {
        if (current.status !== "CANCELLED" && Number.isFinite(current.startMs) && current.title) {
          const endMs = Number.isFinite(current.endMs)
            ? current.endMs
            : current.durationMs > 0
              ? current.startMs + current.durationMs
              : current.allDay
                ? current.startMs + DAY_MS
                : current.startMs;

          const remaining = MAX_ICS_EVENTS - events.length;
          if (remaining <= 0) break;
          const expanded = expandEventOccurrences(
            {
              uid: (current.uid || `${current.startMs}:${current.title}`).slice(0, MAX_ICS_UID_LENGTH),
              title: current.title.slice(0, MAX_ICS_SUMMARY_LENGTH),
              location: current.location.slice(0, MAX_ICS_LOCATION_LENGTH),
              startMs: current.startMs,
              endMs,
              allDay: current.allDay,
              status: current.status,
              rrule: current.rrule,
              exdates: current.exdates,
            },
            rangeStartMs,
            rangeEndMs,
          );
          events.push(...expanded.slice(0, remaining));
          if (events.length >= MAX_ICS_EVENTS) {
            current = null;
            break;
          }
        }
        current = null;
      }
      continue;
    }

    if (depth !== 1) continue;

    const parsed = parseContentLine(line);
    if (!parsed) continue;

    switch (parsed.name) {
      case "UID":
        current.uid = parsed.value.trim().slice(0, MAX_ICS_UID_LENGTH);
        break;
      case "SUMMARY":
        current.title = unescapeIcsText(parsed.value).slice(0, MAX_ICS_SUMMARY_LENGTH);
        break;
      case "LOCATION":
        current.location = unescapeIcsText(parsed.value).slice(0, MAX_ICS_LOCATION_LENGTH);
        break;
      case "STATUS":
        current.status = parsed.value.trim().toUpperCase();
        break;
      case "DTSTART": {
        const dt = parseIcsDateValue(parsed.value, parsed.params);
        if (dt) {
          current.startMs = dt.ms;
          current.allDay = dt.allDay;
        }
        break;
      }
      case "DTEND": {
        const dt = parseIcsDateValue(parsed.value, parsed.params);
        if (dt) {
          current.endMs = dt.ms;
        }
        break;
      }
      case "DURATION":
        current.durationMs = parseIcsDurationMs(parsed.value);
        break;
      case "RRULE":
        current.rrule = parseRrule(parsed.value);
        break;
      case "EXDATE":
        for (const token of parsed.value.split(",")) {
          if (current.exdates.length >= MAX_ICS_EXDATES) break;
          const dt = parseIcsDateValue(token, parsed.params);
          if (dt) current.exdates.push(dt.ms);
        }
        break;
      default:
        break;
    }
  }

  return events;
}
