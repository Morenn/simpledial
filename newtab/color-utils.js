// Shared helpers for custom icons (URLs or emoji/text) and tile color extraction/styling.

const URL_SCHEME_REGEX = /^(https?:|data:|blob:|chrome-extension:|moz-extension:|\/)/i;
const DOMAIN_OR_FILE_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i;
const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

export function isUrlLikeIcon(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (URL_SCHEME_REGEX.test(trimmed)) return true;
  if (!/\s/.test(trimmed) && DOMAIN_OR_FILE_REGEX.test(trimmed)) return true;
  return false;
}

export function normalizeCustomIconValue(rawValue, { allowEmoji = false } = {}) {
  if (!rawValue || typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (allowEmoji && !isUrlLikeIcon(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  if (/^(data:|blob:|chrome-extension:|moz-extension:)/i.test(trimmed)) {
    return trimmed;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

export function isValidHexColor(value) {
  return typeof value === "string" && HEX_COLOR_REGEX.test(value.trim());
}

export function resolveGroupIcons(group) {
  const rawEmoji = typeof group?.iconEmoji === "string" ? group.iconEmoji.trim() : "";
  const rawCustomIcon = typeof group?.customIcon === "string" ? group.customIcon.trim() : "";

  let iconEmoji = rawEmoji || null;
  let customIcon = rawCustomIcon || null;

  // Backwards compatibility: older groups could hold an emoji/text symbol inside customIcon.
  if (customIcon && !isUrlLikeIcon(customIcon)) {
    if (!iconEmoji) {
      iconEmoji = customIcon;
    }
    customIcon = null;
  }

  return { iconEmoji, customIcon };
}

export function formatGroupFolderTitle(group) {
  const baseName = (group?.name || "").trim() || "Group";
  const { iconEmoji } = resolveGroupIcons(group);
  if (iconEmoji) {
    if (baseName.startsWith(iconEmoji)) {
      return baseName;
    }
    return `${iconEmoji} ${baseName}`;
  }
  return baseName;
}

export function applyTileColorStyle(element, colorHex) {
  if (!element) return;

  if (isValidHexColor(colorHex)) {
    element.style.setProperty("--custom-tile-color", colorHex.trim());
    element.classList.add("has-custom-color");
  } else {
    element.style.removeProperty("--custom-tile-color");
    element.classList.remove("has-custom-color");
  }
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return { s, l };
}

function toHexComponent(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function formatHexColor(r, g, b) {
  return `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`;
}

export function sampleDominantColorFromCanvas(ctx, width, height) {
  if (!ctx) return null;

  let data;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }

  let vibrantR = 0;
  let vibrantG = 0;
  let vibrantB = 0;
  let vibrantWeight = 0;

  let neutralR = 0;
  let neutralG = 0;
  let neutralB = 0;
  let neutralWeight = 0;

  let anyR = 0;
  let anyG = 0;
  let anyB = 0;
  let anyWeight = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 64) continue;

    const alphaWeight = a / 255;
    const { s, l } = rgbToHsl(r, g, b);

    anyR += r * alphaWeight;
    anyG += g * alphaWeight;
    anyB += b * alphaWeight;
    anyWeight += alphaWeight;

    if (l >= 0.08 && l <= 0.94) {
      neutralR += r * alphaWeight;
      neutralG += g * alphaWeight;
      neutralB += b * alphaWeight;
      neutralWeight += alphaWeight;
    }

    if (s >= 0.15 && l >= 0.12 && l <= 0.88) {
      const weight = alphaWeight * (0.5 + s);
      vibrantR += r * weight;
      vibrantG += g * weight;
      vibrantB += b * weight;
      vibrantWeight += weight;
    }
  }

  if (vibrantWeight > 0) {
    return formatHexColor(vibrantR / vibrantWeight, vibrantG / vibrantWeight, vibrantB / vibrantWeight);
  }
  if (neutralWeight > 0) {
    return formatHexColor(neutralR / neutralWeight, neutralG / neutralWeight, neutralB / neutralWeight);
  }
  if (anyWeight > 0) {
    return formatHexColor(anyR / anyWeight, anyG / anyWeight, anyB / anyWeight);
  }

  return null;
}

function loadImageElement(url, useCrossOrigin = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCrossOrigin) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-load-failed"));
    img.src = url;
  });
}

function extractColorFromLoadedImage(img, size = 24) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return sampleDominantColorFromCanvas(ctx, size, size);
}

export async function extractDominantColorFromImageSource(src) {
  if (!src || typeof document === "undefined") return null;

  const isRemote = /^https?:\/\//i.test(src);

  if (isRemote && typeof fetch === "function") {
    try {
      const response = await fetch(src, { cache: "force-cache" });
      if (response.ok) {
        const blob = await response.blob();
        if (blob && blob.size > 0) {
          const objectUrl = URL.createObjectURL(blob);
          try {
            const img = await loadImageElement(objectUrl, false);
            return extractColorFromLoadedImage(img);
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        }
      }
    } catch {
      // Fall back to direct image load with CORS enabled.
    }
  }

  try {
    const img = await loadImageElement(src, isRemote);
    return extractColorFromLoadedImage(img);
  } catch {
    return null;
  }
}

export function extractDominantColorFromEmoji(emojiText) {
  if (!emojiText || typeof document === "undefined") return null;

  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  try {
    const bodyColor = document.body ? getComputedStyle(document.body).color : "";
    if (bodyColor) ctx.fillStyle = bodyColor;
  } catch {
    // Use default canvas fillStyle when computed style is unavailable.
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "24px sans-serif";
  ctx.fillText(emojiText, size / 2, size / 2);

  return sampleDominantColorFromCanvas(ctx, size, size);
}
