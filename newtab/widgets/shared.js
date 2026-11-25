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
  "shortcutPalette",
  "storageUsage"
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

export function getWidgetGroupKey(widget) {
  if (!widget || typeof widget !== "object") return "";
  const gName = typeof widget.groupName === "string" ? widget.groupName.trim() : "";
  if (!gName) return "";
  return `${widget.type || "custom-search"}:${gName.toLowerCase()}`;
}

export function buildWidgetGroupMeta(customWidgets = []) {
  const membersByGroupKey = new Map();
  const groupKeyById = new Map();
  const anchorByGroupKey = new Map();

  for (const w of Array.isArray(customWidgets) ? customWidgets : []) {
    if (!w?.id) continue;
    const gKey = getWidgetGroupKey(w);
    if (!gKey) continue;
    let members = membersByGroupKey.get(gKey);
    if (!members) {
      members = [];
      membersByGroupKey.set(gKey, members);
    }
    members.push(w);
    groupKeyById.set(w.id, gKey);
  }

  for (const [gKey, members] of membersByGroupKey.entries()) {
    const anchor = members.find(m => !!m.isDefault) || members[0];
    if (anchor) anchorByGroupKey.set(gKey, anchor);
  }

  return { membersByGroupKey, groupKeyById, anchorByGroupKey };
}

export function getWidgetGroupMemberIds(key, customWidgets = []) {
  if (!key) return [];
  const { membersByGroupKey, groupKeyById } = buildWidgetGroupMeta(customWidgets);
  const gKey = groupKeyById.get(key);
  if (!gKey) return [key];
  return (membersByGroupKey.get(gKey) || []).map(m => m.id);
}

export function resolveGroupedWidgetMapValue(map, key, customWidgets = []) {
  if (!map || typeof map !== "object" || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, key) && map[key] !== undefined) {
    return map[key];
  }
  const { membersByGroupKey, anchorByGroupKey, groupKeyById } = buildWidgetGroupMeta(customWidgets);
  const gKey = groupKeyById.get(key);
  if (!gKey) return undefined;
  const anchor = anchorByGroupKey.get(gKey);
  if (anchor && Object.prototype.hasOwnProperty.call(map, anchor.id) && map[anchor.id] !== undefined) {
    return map[anchor.id];
  }
  for (const m of membersByGroupKey.get(gKey) || []) {
    if (Object.prototype.hasOwnProperty.call(map, m.id) && map[m.id] !== undefined) {
      return map[m.id];
    }
  }
  return undefined;
}

export function normalizeWidgetOrder(rawOrder, customWidgets = []) {
  const customList = Array.isArray(customWidgets) ? customWidgets.filter(w => w?.id) : [];
  const customIds = customList.map(w => w.id);
  const allowedKeys = new Set([...VALID_WIDGET_KEYS, ...customIds]);
  const baseOrder = [];
  const seen = new Set();
  if (Array.isArray(rawOrder)) {
    for (const key of rawOrder) {
      if (allowedKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        baseOrder.push(key);
      }
    }
  }
  for (const key of DEFAULT_WIDGET_ORDER) {
    if (!seen.has(key)) {
      seen.add(key);
      baseOrder.push(key);
    }
  }
  for (const id of customIds) {
    if (!seen.has(id)) {
      seen.add(id);
      baseOrder.push(id);
    }
  }

  // Keep all members of each custom widget group contiguous at the canonical anchor's slot
  // so group position is identical regardless of which member is locally disabled.
  const { membersByGroupKey, groupKeyById, anchorByGroupKey } = buildWidgetGroupMeta(customList);
  if (membersByGroupKey.size === 0) return baseOrder;

  const baseIndexById = new Map(baseOrder.map((k, idx) => [k, idx]));
  const result = [];
  const emitted = new Set();
  for (const key of baseOrder) {
    if (emitted.has(key)) continue;
    const gKey = groupKeyById.get(key);
    if (!gKey) {
      emitted.add(key);
      result.push(key);
      continue;
    }
    const anchor = anchorByGroupKey.get(gKey);
    if (!anchor || anchor.id !== key) {
      continue;
    }
    const members = [...(membersByGroupKey.get(gKey) || [])]
      .sort((a, b) => (baseIndexById.get(a.id) ?? 0) - (baseIndexById.get(b.id) ?? 0));
    for (const m of members) {
      if (!emitted.has(m.id)) {
        emitted.add(m.id);
        result.push(m.id);
      }
    }
  }
  for (const key of baseOrder) {
    if (!emitted.has(key)) {
      emitted.add(key);
      result.push(key);
    }
  }
  return result;
}

export function moveWidgetGroupInOrder(rawOrder, movingKey, targetKey, customWidgets = []) {
  const order = normalizeWidgetOrder(rawOrder, customWidgets);
  if (!movingKey || !targetKey || movingKey === targetKey) return order;
  const movingIds = getWidgetGroupMemberIds(movingKey, customWidgets);
  const targetIds = getWidgetGroupMemberIds(targetKey, customWidgets);
  const movingSet = new Set(movingIds);
  const targetSet = new Set(targetIds);

  const movingStart = order.findIndex(id => movingSet.has(id));
  const targetStart = order.findIndex(id => targetSet.has(id));
  if (movingStart === -1 || targetStart === -1 || movingStart === targetStart) return order;

  const movingBlock = order.filter(id => movingSet.has(id));
  const withoutMoving = order.filter(id => !movingSet.has(id));
  const movingDown = movingStart < targetStart;

  let insertIdx;
  if (movingDown) {
    let lastTargetIdx = -1;
    for (let i = withoutMoving.length - 1; i >= 0; i--) {
      if (targetSet.has(withoutMoving[i])) {
        lastTargetIdx = i;
        break;
      }
    }
    insertIdx = lastTargetIdx === -1 ? withoutMoving.length : lastTargetIdx + 1;
  } else {
    const firstTargetIdx = withoutMoving.findIndex(id => targetSet.has(id));
    insertIdx = firstTargetIdx === -1 ? 0 : firstTargetIdx;
  }

  withoutMoving.splice(insertIdx, 0, ...movingBlock);
  return withoutMoving;
}
