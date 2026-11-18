import { normalizeCustomIconValue, applyCachedIconImageSrc } from "../color-utils.js";

export const VALID_WIDGET_SPACES = new Set(["header", "left", "center", "right", "footer"]);
export const VALID_WIDGET_ALIGNS = new Set(["auto", "top", "bottom", "left", "right", "center"]);
export const DEFAULT_WIDGET_ORDER = [
  "groups",
  "manage",
  "search",
  "bookmarks",
  "syncStatus",
  "dateTime",
  "bookmarksCount",
  "shortcutPalette"
];
export const VALID_WIDGET_KEYS = new Set(DEFAULT_WIDGET_ORDER);

export function resolveCustomWidgetIcon(widget) {
  const rawEmoji = typeof widget?.icon === "string" && widget.icon.trim() ? widget.icon.trim() : "🔎";
  const rawCustom = typeof widget?.customIcon === "string" ? widget.customIcon.trim() : "";

  if (rawCustom) {
    const normalized = normalizeCustomIconValue(rawCustom, { allowEmoji: false });
    if (normalized) {
      return { emoji: rawEmoji, customIcon: normalized };
    }
  }

  if (rawEmoji) {
    const normalized = normalizeCustomIconValue(rawEmoji, { allowEmoji: false });
    if (normalized) {
      return { emoji: "🔎", customIcon: normalized };
    }
  }

  return { emoji: rawEmoji || "🔎", customIcon: null };
}

export function createCustomSearchIconContent(widget, iconEl) {
  const { emoji, customIcon } = resolveCustomWidgetIcon(widget);
  iconEl.innerHTML = "";
  if (customIcon) {
    const iconImg = document.createElement("img");
    iconImg.className = "custom-search-icon-img";
    applyCachedIconImageSrc(iconImg, customIcon);
    iconImg.alt = "";
    iconImg.addEventListener("error", () => {
      iconEl.textContent = emoji;
    }, { once: true });
    iconEl.appendChild(iconImg);
  } else {
    iconEl.textContent = emoji;
  }
}

export function createCustomWidgetIconElement(
  widget,
  imgClass = "custom-search-icon-img",
  emojiClass = "custom-search-icon-emoji",
  fallbackEmoji = "🔎"
) {
  const { emoji, customIcon } = resolveCustomWidgetIcon(widget);
  const resolvedEmoji = emoji || fallbackEmoji;
  const wrap = document.createElement("span");
  wrap.className = emojiClass;
  if (customIcon) {
    const iconImg = document.createElement("img");
    iconImg.className = imgClass;
    applyCachedIconImageSrc(iconImg, customIcon);
    iconImg.alt = "";
    iconImg.addEventListener("error", () => {
      wrap.textContent = resolvedEmoji;
    }, { once: true });
    wrap.appendChild(iconImg);
  } else {
    wrap.textContent = resolvedEmoji;
  }
  return wrap;
}

export function normalizeWidgetOrder(rawOrder, customWidgets = []) {
  const customIds = Array.isArray(customWidgets)
    ? customWidgets.map(w => w?.id).filter(Boolean)
    : [];
  const allowedKeys = new Set([...VALID_WIDGET_KEYS, ...customIds]);
  const result = [];
  const seen = new Set();
  if (Array.isArray(rawOrder)) {
    for (const key of rawOrder) {
      if (allowedKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
  }
  for (const key of DEFAULT_WIDGET_ORDER) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  for (const id of customIds) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
