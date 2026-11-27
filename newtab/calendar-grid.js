/**
 * Normalize the configured first day of the week to "monday" or "sunday".
 * @param {string} value
 * @returns {"monday" | "sunday"}
 */
export function normalizeWeekStartsOn(value) {
  return value === "sunday" ? "sunday" : "monday";
}

/**
 * Compute the ISO-8601 week number (1-53) for a local Date.
 * @param {Date} date
 * @returns {number}
 */
export function getIsoWeekNumber(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
}

/**
 * Build a 6-row calendar grid with ISO week numbers for a given month.
 * @param {number} year
 * @param {number} month 0-based month index (0 = January)
 * @param {"monday" | "sunday"} [weekStartsOn="monday"]
 * @param {string} [locale="en"]
 * @param {Date} [today=new Date()]
 */
export function buildCalendarMonthGrid(
  year,
  month,
  weekStartsOn = "monday",
  locale = "en",
  today = new Date(),
) {
  const normalizedStart = normalizeWeekStartsOn(weekStartsOn);
  const startDay = normalizedStart === "sunday" ? 0 : 1;
  const resolvedLocale = locale || "en";

  const weekdayFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const monthFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    month: "long",
    year: "numeric",
  });

  // 2024-01-07 is a Sunday; offset by weekday index 0..6 in UTC.
  const weekdays = [];
  for (let i = 0; i < 7; i += 1) {
    const weekdayIndex = (startDay + i) % 7;
    const sampleDate = new Date(Date.UTC(2024, 0, 7 + weekdayIndex));
    weekdays.push(weekdayFormatter.format(sampleDate));
  }

  const firstOfMonth = new Date(year, month, 1);
  const leadingDays = (firstOfMonth.getDay() - startDay + 7) % 7;
  const gridStartDate = new Date(year, month, 1 - leadingDays);

  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  const rows = [];
  for (let rowIdx = 0; rowIdx < 6; rowIdx += 1) {
    const days = [];
    for (let colIdx = 0; colIdx < 7; colIdx += 1) {
      const cellDate = new Date(
        gridStartDate.getFullYear(),
        gridStartDate.getMonth(),
        gridStartDate.getDate() + rowIdx * 7 + colIdx,
      );
      const dayOfWeek = cellDate.getDay();
      days.push({
        year: cellDate.getFullYear(),
        month: cellDate.getMonth(),
        day: cellDate.getDate(),
        isCurrentMonth: cellDate.getFullYear() === year && cellDate.getMonth() === month,
        isToday:
          cellDate.getFullYear() === todayYear &&
          cellDate.getMonth() === todayMonth &&
          cellDate.getDate() === todayDate,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      });
    }
    const rowAnchor = new Date(days[0].year, days[0].month, days[0].day);
    rows.push({
      weekNumber: getIsoWeekNumber(rowAnchor),
      days,
    });
  }

  return {
    year,
    month,
    monthLabel: monthFormatter.format(firstOfMonth),
    weekStartsOn: normalizedStart,
    weekdays,
    rows,
  };
}
