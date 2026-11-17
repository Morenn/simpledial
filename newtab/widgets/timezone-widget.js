import { t } from "../i18n.js";
import { applyCachedIconImageSrc } from "../color-utils.js";
import { resolveCustomWidgetIcon, createCustomSearchIconContent } from "./shared.js";

export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
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
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      ...(showSeconds ? { second: "2-digit" } : {}),
      hour12: !use24Hour,
      timeZone: timeZone.trim()
    }).format(date);
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
 * Resolves a "HH:MM" or "HH:MM:SS" wall-clock time today in `timeZone` to a UTC Date.
 */
export function resolveDateForTimeInZone(timeString, timeZone, referenceDate = new Date()) {
  if (typeof timeString !== "string" || !isValidTimeZone(timeZone)) return null;
  const match = timeString.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const targetH = Number(match[1]);
  const targetM = Number(match[2]);
  const targetS = match[3] !== undefined ? Number(match[3]) : 0;
  if (targetH < 0 || targetH > 23 || targetM < 0 || targetM > 59 || targetS < 0 || targetS > 59) {
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


function formatTimeInput24h(date, timeZone, showSeconds = false) {
  const parts = getZoneParts(date, timeZone);
  const pad = n => String(n).padStart(2, "0");
  return showSeconds
    ? `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
    : `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function updateCustomTimeZoneWidgets(now = new Date()) {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".custom-timezone-widget[data-custom-widget-id]").forEach(container => {
    const pinnedMs = container.dataset.pinnedTimeMs ? Number(container.dataset.pinnedTimeMs) : NaN;
    const isPinned = Number.isFinite(pinnedMs);
    const effectiveNow = isPinned ? new Date(pinnedMs) : now;
    const baseTz = isPinned ? (container.dataset.pinnedBaseTz || "") : "";

    container.classList.toggle("is-calculator", isPinned);
    const headerEl = container.querySelector(".custom-timezone-header");
    if (headerEl) {
      headerEl.classList.toggle("hidden", !isPinned && headerEl.dataset.hasTitleOrIcon !== "true");
    }
    const resetBtn = container.querySelector(".custom-timezone-reset-btn");
    if (resetBtn) {
      resetBtn.classList.toggle("hidden", !isPinned);
    }

    container.querySelectorAll(".custom-timezone-time[data-tz]").forEach(el => {
      if (el.dataset.editing === "true") return;
      const tz = el.dataset.tz;
      const showSeconds = el.dataset.showSeconds === "true";
      const use24Hour = el.dataset.use24h !== "false";
      const formatted = formatTimeForTimeZone(effectiveNow, tz, { showSeconds, use24Hour });
      const dayShift = isPinned && baseTz ? getTimeZoneDayShift(effectiveNow, tz, baseTz) : "";

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
      delete container.dataset.pinnedTimeMs;
      delete container.dataset.pinnedBaseTz;
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
        container.querySelectorAll(".custom-timezone-item.is-pinned").forEach(row => row.classList.remove("is-pinned"));
        updateCustomTimeZoneWidgets();
      });
      header.appendChild(resetBtn);
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

          const input = document.createElement("input");
          input.type = "time";
          input.name = "tz-calc-time";
          input.className = "custom-timezone-time-input";
          input.step = showSeconds ? "1" : "60";
          input.value = formatTimeInput24h(baseDate, z.timeZone, showSeconds);

          const applyCalculatedTime = () => {
            const resolved = resolveDateForTimeInZone(input.value, z.timeZone, baseDate);
            if (!resolved) return;
            container.dataset.pinnedTimeMs = String(resolved.getTime());
            container.dataset.pinnedBaseTz = z.timeZone;
            listEl.querySelectorAll(".custom-timezone-item.is-pinned").forEach(row => row.classList.remove("is-pinned"));
            itemEl.classList.add("is-pinned");
            updateCustomTimeZoneWidgets();
          };

          const closeTimeEditor = () => {
            if (timeEl.dataset.editing !== "true") return;
            delete timeEl.dataset.editing;
            updateCustomTimeZoneWidgets();
          };

          input.addEventListener("input", applyCalculatedTime);
          input.addEventListener("change", applyCalculatedTime);
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              applyCalculatedTime();
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
        };

        timeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          openTimeEditor();
        });
        timeEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
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

