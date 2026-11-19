import { t } from "../i18n.js";
import { applyCachedIconImageSrc } from "../color-utils.js";
import { resolveCustomWidgetIcon, createCustomSearchIconContent } from "./shared.js";

const validTimeZoneCache = new Map();
const tzFormatterCache = new Map();

export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz.trim()) return false;
  const trimmed = tz.trim();
  if (validTimeZoneCache.has(trimmed)) return validTimeZoneCache.get(trimmed);
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    validTimeZoneCache.set(trimmed, true);
    return true;
  } catch {
    validTimeZoneCache.set(trimmed, false);
    return false;
  }
}

export function normalizeCustomTimeZones(rawZones) {
  if (!Array.isArray(rawZones)) return [];
  const list = [];
  for (const entry of rawZones) {
    if (!entry || typeof entry !== "object") continue;
    const timeZone = typeof entry.timeZone === "string" ? entry.timeZone.trim() : "";
    if (!isValidTimeZone(timeZone)) continue;
    const rawLabel = typeof entry.label === "string" ? entry.label.trim() : "";
    const fallbackLabel = timeZone.split("/").pop()?.replace(/_/g, " ") || timeZone;
    list.push({
      label: rawLabel || fallbackLabel,
      timeZone
    });
  }
  return list;
}

export function formatTimeForTimeZone(date, timeZone, { showSeconds = false, use24Hour = true } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !isValidTimeZone(timeZone)) {
    return "--:--";
  }
  const tz = timeZone.trim();
  const cacheKey = `${tz}|${showSeconds ? 1 : 0}|${use24Hour ? 1 : 0}`;
  try {
    let fmt = tzFormatterCache.get(cacheKey);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        ...(showSeconds ? { second: "2-digit" } : {}),
        hour12: !use24Hour,
        timeZone: tz
      });
      tzFormatterCache.set(cacheKey, fmt);
    }
    return fmt.format(date);
  } catch {
    return "--:--";
  }
}

function getZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone.trim(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  if (map.hour === 24) map.hour = 0;
  return map;
}

/**
 * Resolves a "HH:MM", "HH:MM:SS", colonless ("HHMM"/"HMM"/"HHMMSS"), or 12-hour "H:MM AM/PM" wall-clock time today in `timeZone` to a UTC Date.
 */
export function resolveDateForTimeInZone(timeString, timeZone, referenceDate = new Date()) {
  if (typeof timeString !== "string" || !isValidTimeZone(timeZone)) return null;
  const trimmed = timeString.trim();

  let hStr;
  let mStr;
  let sStr;
  let meridiem = "";

  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (colonMatch) {
    [, hStr, mStr, sStr] = colonMatch;
    meridiem = colonMatch[4] ? colonMatch[4].toUpperCase() : "";
  } else {
    const compactMatch = trimmed.match(/^(\d{3,4}|\d{6})(?:\s*(AM|PM))?$/i);
    if (!compactMatch) return null;
    const digits = compactMatch[1];
    meridiem = compactMatch[2] ? compactMatch[2].toUpperCase() : "";
    if (digits.length === 3) {
      hStr = digits.slice(0, 1);
      mStr = digits.slice(1, 3);
    } else if (digits.length === 4) {
      hStr = digits.slice(0, 2);
      mStr = digits.slice(2, 4);
    } else {
      hStr = digits.slice(0, 2);
      mStr = digits.slice(2, 4);
      sStr = digits.slice(4, 6);
    }
  }

  let targetH = Number(hStr);
  const targetM = Number(mStr);
  const targetS = sStr !== undefined ? Number(sStr) : 0;

  if (meridiem) {
    if (targetH < 1 || targetH > 12) return null;
    if (meridiem === "AM") {
      if (targetH === 12) targetH = 0;
    } else if (targetH !== 12) {
      targetH += 12;
    }
  } else if (targetH < 0 || targetH > 23) {
    return null;
  }

  if (targetM < 0 || targetM > 59 || targetS < 0 || targetS > 59) {
    return null;
  }

  const tz = timeZone.trim();
  const ref = (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime()))
    ? referenceDate
    : new Date();
  const baseDate = getZoneParts(ref, tz);
  const desiredAsUtcMs = Date.UTC(baseDate.year, baseDate.month - 1, baseDate.day, targetH, targetM, targetS);

  // Two-pass offset adjustment handles DST transitions cleanly
  let candidateMs = desiredAsUtcMs;
  for (let i = 0; i < 2; i++) {
    const zp = getZoneParts(new Date(candidateMs), tz);
    const zoneAsUtcMs = Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, zp.minute, zp.second);
    candidateMs += desiredAsUtcMs - zoneAsUtcMs;
  }
  return new Date(candidateMs);
}

/**
 * Returns "+1d", "-1d", or "" when `targetZone`'s calendar date differs from `baseZone` at `date`.
 */
export function getTimeZoneDayShift(date, targetZone, baseZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (!isValidTimeZone(targetZone) || !isValidTimeZone(baseZone)) return "";
  const targetParts = getZoneParts(date, targetZone);
  const baseParts = getZoneParts(date, baseZone);
  const targetDayMs = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
  const baseDayMs = Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day);
  const diffDays = Math.round((targetDayMs - baseDayMs) / 86400000);
  if (diffDays === 0) return "";
  return diffDays > 0 ? `+${diffDays}d` : `${diffDays}d`;
}


/**
 * Validates whether `raw` is a valid partial or complete time string for the given format.
 */
export function isValidTimeInputValue(raw, use24Hour = true, showSeconds = false) {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;

  const maxHour = use24Hour ? 23 : 12;
  let core = trimmed;
  if (!use24Hour) {
    const meridiemMatch = trimmed.match(/^(.*?)(?:\s+(A|P|AM|PM))?$/i);
    if (!meridiemMatch) return false;
    core = meridiemMatch[1].trim();
  }

  const parts = core.split(":");
  const maxParts = showSeconds ? 3 : 2;
  if (parts.length > maxParts) return false;

  if (parts.length === 1) {
    const digits = parts[0];
    if (!/^\d*$/.test(digits)) return false;
    const maxDigits = showSeconds ? 6 : 4;
    if (digits.length > maxDigits) return false;
    if (digits.length <= 1) return use24Hour || digits === "" || Number(digits) >= 0;
    const h2 = Number(digits.slice(0, 2));
    const h2Valid = use24Hour ? h2 <= maxHour : (h2 >= 1 && h2 <= maxHour);
    if (digits.length === 2) {
      return h2Valid || Number(digits[1]) <= 5;
    }
    if (digits.length === 3) {
      const h1 = Number(digits[0]);
      const h1Valid = use24Hour ? h1 <= maxHour : h1 >= 1;
      return (h2Valid && Number(digits[2]) <= 5) || (h1Valid && Number(digits.slice(1, 3)) <= 59);
    }
    if (!h2Valid || Number(digits.slice(2, 4)) > 59) return false;
    if (digits.length === 5) return Number(digits[4]) <= 5;
    if (digits.length === 6) return Number(digits.slice(4, 6)) <= 59;
    return true;
  }

  const [hStr, mStr, sStr] = parts;
  if (!/^\d{0,2}$/.test(hStr)) return false;
  if (hStr.length > 0) {
    const h = Number(hStr);
    if (h > maxHour) return false;
    if (!use24Hour && hStr.length === 2 && h < 1) return false;
  }
  if (!/^\d{0,2}$/.test(mStr)) return false;
  if (mStr.length === 1 && Number(mStr) > 5) return false;
  if (mStr.length === 2 && Number(mStr) > 59) return false;
  if (sStr !== undefined) {
    if (!/^\d{0,2}$/.test(sStr)) return false;
    if (sStr.length === 1 && Number(sStr) > 5) return false;
    if (sStr.length === 2 && Number(sStr) > 59) return false;
  }
  return true;
}

function formatTimeInput(date, timeZone, showSeconds = false, use24Hour = true) {
  const parts = getZoneParts(date, timeZone);
  const pad = n => String(n).padStart(2, "0");
  if (use24Hour) {
    return showSeconds
      ? `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
      : `${pad(parts.hour)}:${pad(parts.minute)}`;
  }
  const suffix = parts.hour >= 12 ? "PM" : "AM";
  const h12 = (parts.hour % 12) || 12;
  return showSeconds
    ? `${h12}:${pad(parts.minute)}:${pad(parts.second)} ${suffix}`
    : `${h12}:${pad(parts.minute)} ${suffix}`;
}

export function updateCustomTimeZoneWidgets(now = new Date()) {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".custom-timezone-widget[data-custom-widget-id]").forEach(container => {
    const pinnedMs = container.dataset.pinnedTimeMs ? Number(container.dataset.pinnedTimeMs) : NaN;
    const isPinned = Number.isFinite(pinnedMs);
    const effectiveNow = isPinned ? new Date(pinnedMs) : now;
    const baseTz = isPinned ? (container.dataset.pinnedBaseTz || "") : "";
    const defaultUse24Hour = container.dataset.defaultUse24h !== "false";
    const effectiveUse24Hour = container.dataset.tempUse24h !== undefined
      ? container.dataset.tempUse24h !== "false"
      : defaultUse24Hour;
    const hasTempFormatOverride = container.dataset.tempUse24h !== undefined
      && (container.dataset.tempUse24h !== "false") !== defaultUse24Hour;

    container.classList.toggle("is-calculator", isPinned);
    const headerEl = container.querySelector(".custom-timezone-header");
    if (headerEl) {
      headerEl.classList.toggle("hidden", !isPinned && !hasTempFormatOverride && headerEl.dataset.hasTitleOrIcon !== "true");
    }
    const formatBtn = container.querySelector(".custom-timezone-format-btn");
    if (formatBtn) {
      formatBtn.textContent = effectiveUse24Hour ? "12H" : "24H";
      formatBtn.classList.toggle("is-active", hasTempFormatOverride);
      formatBtn.setAttribute("aria-pressed", String(hasTempFormatOverride));
      const label = effectiveUse24Hour
        ? (t("customTzSwitchTo12h") || "Temporarily switch to 12-hour format")
        : (t("customTzSwitchTo24h") || "Switch to 24-hour format");
      formatBtn.title = label;
      formatBtn.setAttribute("aria-label", label);
    }
    const resetBtn = container.querySelector(".custom-timezone-reset-btn");
    if (resetBtn) {
      resetBtn.classList.toggle("hidden", !isPinned && !hasTempFormatOverride);
    }

    container.querySelectorAll(".custom-timezone-time[data-tz]").forEach(el => {
      if (el.dataset.editing === "true") return;
      const tz = el.dataset.tz;
      const showSeconds = el.dataset.showSeconds === "true";
      const formatted = formatTimeForTimeZone(effectiveNow, tz, { showSeconds, use24Hour: effectiveUse24Hour });
      const dayShift = isPinned && baseTz ? getTimeZoneDayShift(effectiveNow, tz, baseTz) : "";

      if (el.dataset.lastFormatted === formatted && (el.dataset.lastDayShift || "") === dayShift) {
        return;
      }
      el.dataset.lastFormatted = formatted;
      el.dataset.lastDayShift = dayShift;

      if (dayShift) {
        el.textContent = "";
        el.append(document.createTextNode(formatted));
        const shiftSpan = document.createElement("span");
        shiftSpan.className = "custom-timezone-day-shift";
        shiftSpan.textContent = dayShift;
        el.appendChild(shiftSpan);
      } else {
        el.textContent = formatted;
      }
    });
  });
}

export function syncCustomTimeZoneWidgetElements(customWidgets = []) {
  const tzWidgets = Array.isArray(customWidgets)
    ? customWidgets.filter(w => w && w.id && w.type === "timezone" && normalizeCustomTimeZones(w.timeZones).length > 0)
    : [];
  const validIds = new Set(tzWidgets.map(w => w.id));

  document.querySelectorAll(".custom-timezone-widget[data-custom-widget-id]").forEach(el => {
    if (!validIds.has(el.dataset.customWidgetId)) {
      el.remove();
    }
  });

  const elementMap = {};
  for (const w of tzWidgets) {
    const zones = normalizeCustomTimeZones(w.timeZones);
    const { emoji, customIcon } = resolveCustomWidgetIcon(w);
    const showSeconds = !!w.showSeconds;
    const use24Hour = w.use24Hour !== false;
    const configSig = JSON.stringify({
      name: w.name || "",
      icon: emoji,
      customIcon: customIcon || "",
      timeZones: zones,
      showSeconds,
      use24Hour
    });

    let container = document.querySelector(`.custom-timezone-widget[data-custom-widget-id="${CSS.escape(w.id)}"]`);
    if (!container) {
      container = document.createElement("div");
      container.className = "custom-timezone-widget";
      container.dataset.customWidgetId = w.id;
    }

    if (container.dataset.configSig !== configSig) {
      container.dataset.configSig = configSig;
      container.dataset.defaultUse24h = String(use24Hour);
      delete container.dataset.pinnedTimeMs;
      delete container.dataset.pinnedBaseTz;
      delete container.dataset.tempUse24h;
      container.classList.remove("is-calculator");
      container.innerHTML = "";

      const hasTitleOrIcon = Boolean(w.name || emoji || customIcon);
      const header = document.createElement("div");
      header.className = `custom-timezone-header${hasTitleOrIcon ? "" : " hidden"}`;
      header.dataset.hasTitleOrIcon = String(hasTitleOrIcon);
      if (hasTitleOrIcon) {
        const iconSpan = document.createElement("span");
        iconSpan.className = "custom-search-icon";
        createCustomSearchIconContent(w, iconSpan);
        header.appendChild(iconSpan);
        if (w.name) {
          const titleSpan = document.createElement("span");
          titleSpan.className = "custom-timezone-title";
          titleSpan.textContent = w.name;
          header.appendChild(titleSpan);
        }
      }

      const headerActions = document.createElement("div");
      headerActions.className = "custom-timezone-header-actions";

      const formatBtn = document.createElement("button");
      formatBtn.type = "button";
      formatBtn.className = "custom-timezone-format-btn";
      formatBtn.textContent = use24Hour ? "12H" : "24H";
      formatBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const currentUse24h = container.dataset.tempUse24h !== undefined
          ? container.dataset.tempUse24h !== "false"
          : use24Hour;
        const nextUse24h = !currentUse24h;
        if (nextUse24h === use24Hour) {
          delete container.dataset.tempUse24h;
        } else {
          container.dataset.tempUse24h = String(nextUse24h);
        }
        updateCustomTimeZoneWidgets();
      });

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "custom-timezone-reset-btn hidden";
      resetBtn.textContent = "✕";
      resetBtn.title = t("customTzResetLive") || "Reset to live time";
      resetBtn.setAttribute("aria-label", t("customTzResetLive") || "Reset to live time");
      resetBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        delete container.dataset.pinnedTimeMs;
        delete container.dataset.pinnedBaseTz;
        delete container.dataset.tempUse24h;
        container.querySelectorAll(".custom-timezone-item.is-pinned").forEach(row => row.classList.remove("is-pinned"));
        updateCustomTimeZoneWidgets();
      });
      headerActions.appendChild(formatBtn);
      headerActions.appendChild(resetBtn);
      header.appendChild(headerActions);
      container.appendChild(header);

      const listEl = document.createElement("div");
      listEl.className = "custom-timezone-list";
      for (const z of zones) {
        const itemEl = document.createElement("div");
        itemEl.className = "custom-timezone-item";
        itemEl.title = z.timeZone;

        const labelEl = document.createElement("span");
        labelEl.className = "custom-timezone-label";
        labelEl.textContent = z.label;

        const timeEl = document.createElement("span");
        timeEl.className = "custom-timezone-time";
        timeEl.dataset.tz = z.timeZone;
        timeEl.dataset.showSeconds = String(showSeconds);
        timeEl.dataset.use24h = String(use24Hour);
        timeEl.tabIndex = 0;
        timeEl.setAttribute("role", "button");
        timeEl.title = t("customTzClickToCalculate") || "Click to calculate time in other zones";

        const openTimeEditor = () => {
          if (timeEl.dataset.editing === "true") return;
          timeEl.dataset.editing = "true";

          const currentPinnedMs = container.dataset.pinnedTimeMs ? Number(container.dataset.pinnedTimeMs) : NaN;
          const baseDate = Number.isFinite(currentPinnedMs) ? new Date(currentPinnedMs) : new Date();
          const activeUse24Hour = container.dataset.tempUse24h !== undefined
            ? container.dataset.tempUse24h !== "false"
            : use24Hour;

          const input = document.createElement("input");
          input.type = "text";
          input.name = "tz-calc-time";
          input.autocomplete = "off";
          input.spellcheck = false;
          input.inputMode = "numeric";
          input.className = "custom-timezone-time-input";
          input.size = showSeconds ? (activeUse24Hour ? 8 : 11) : (activeUse24Hour ? 5 : 8);
          input.placeholder = activeUse24Hour
            ? (showSeconds ? "HH:MM:SS" : "HH:MM")
            : (showSeconds ? "H:MM:SS AM" : "H:MM AM");
          input.value = formatTimeInput(baseDate, z.timeZone, showSeconds, activeUse24Hour);
          let lastValidInputValue = input.value;

          const applyCalculatedTime = (allowCompact3Digit = false) => {
            const val = input.value.trim();
            if (!allowCompact3Digit && /^\d{1,3}$/.test(val)) return;
            const resolved = resolveDateForTimeInZone(val, z.timeZone, baseDate);
            if (!resolved) return;
            container.dataset.pinnedTimeMs = String(resolved.getTime());
            container.dataset.pinnedBaseTz = z.timeZone;
            listEl.querySelectorAll(".custom-timezone-item.is-pinned").forEach(row => row.classList.remove("is-pinned"));
            itemEl.classList.add("is-pinned");
            updateCustomTimeZoneWidgets();
          };

          const closeTimeEditor = () => {
            if (timeEl.dataset.editing !== "true") return;
            applyCalculatedTime(true);
            delete timeEl.dataset.editing;
            delete timeEl.dataset.lastFormatted;
            delete timeEl.dataset.lastDayShift;
            input.blur();
            updateCustomTimeZoneWidgets();
            timeEl.blur();
          };

          const formatCompactTimeInput = (ev) => {
            if (ev?.inputType && ev.inputType.startsWith("delete")) return;
            const raw = input.value;
            const compactMatch = raw.match(/^(\d{4})(\s*(?:AM|PM))?$/i);
            if (compactMatch) {
              input.value = `${compactMatch[1].slice(0, 2)}:${compactMatch[1].slice(2, 4)}${compactMatch[2] || ""}`;
              return;
            }
            if (showSeconds) {
              const secMatch = raw.match(/^(\d{2}:\d{2})(\d{2})(\s*(?:AM|PM))?$/i);
              if (secMatch) {
                input.value = `${secMatch[1]}:${secMatch[2]}${secMatch[3] || ""}`;
              }
            }
          };

          input.addEventListener("input", (ev) => {
            formatCompactTimeInput(ev);
            if (!isValidTimeInputValue(input.value, activeUse24Hour, showSeconds)) {
              input.value = lastValidInputValue;
              input.setAttribute("aria-invalid", "true");
              return;
            }
            input.removeAttribute("aria-invalid");
            lastValidInputValue = input.value;
            applyCalculatedTime(false);
          });
          input.addEventListener("change", () => applyCalculatedTime(true));
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              ev.stopPropagation();
              applyCalculatedTime(true);
              closeTimeEditor();
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              ev.stopPropagation();
              closeTimeEditor();
            }
          });
          input.addEventListener("blur", closeTimeEditor);

          timeEl.textContent = "";
          timeEl.appendChild(input);
          input.focus();
          input.select();
        };

        timeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          openTimeEditor();
        });
        timeEl.addEventListener("keydown", (e) => {
          if (e.target !== timeEl || timeEl.dataset.editing === "true") return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            openTimeEditor();
          }
        });

        itemEl.append(labelEl, timeEl);
        listEl.appendChild(itemEl);
      }
      container.appendChild(listEl);
    }

    elementMap[w.id] = container;
  }

  updateCustomTimeZoneWidgets();
  return elementMap;
}

