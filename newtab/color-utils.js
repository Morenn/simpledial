// Shared helpers for custom icons (URLs or emoji/text) and tile color extraction/styling.

const URL_SCHEME_REGEX = /^(https?:|data:|blob:|chrome-extension:|moz-extension:|\/)/i;
const SAFE_DATA_IMAGE_URL_REGEX = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;[^,]*)?,/i;

export function isSafeDataImageUrl(url) {
  return typeof url === "string" && SAFE_DATA_IMAGE_URL_REGEX.test(url.trim());
}
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

function decodeSvgDataUrlPayload(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return "";
  const header = dataUrl.slice(0, commaIdx);
  const rawBody = dataUrl.slice(commaIdx + 1);
  if (/;base64/i.test(header)) {
    try {
      if (typeof atob === "function") {
        const binary = atob(rawBody.replace(/\s+/g, ""));
        if (typeof TextDecoder !== "undefined") {
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        }
        return binary;
      }
      if (typeof Buffer !== "undefined") {
        return Buffer.from(rawBody, "base64").toString("utf8");
      }
    } catch {
      return "";
    }
  }
  try {
    return decodeURIComponent(rawBody);
  } catch {
    return rawBody;
  }
}

export function sanitizeSvgMarkup(svgText) {
  if (typeof svgText !== "string" || !svgText.trim()) return "";
  let cleaned = svgText;

  if (typeof DOMParser !== "undefined" && typeof XMLSerializer !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const root = doc?.documentElement;
      if (root && !doc.querySelector("parsererror") && root.tagName.toLowerCase() === "svg") {
        const blockedTags = ["script", "foreignObject", "iframe", "object", "embed", "applet", "meta", "link"];
        for (const tag of blockedTags) {
          doc.querySelectorAll(tag).forEach(node => node.remove());
        }
        const allNodes = [root, ...root.querySelectorAll("*")];
        for (const el of allNodes) {
          for (const attr of Array.from(el.attributes || [])) {
            const name = attr.name.toLowerCase();
            const val = String(attr.value || "").trim();
            if (name.startsWith("on")) {
              el.removeAttribute(attr.name);
              continue;
            }
            if ((name === "href" || name === "xlink:href" || name === "src" || name === "action" || name === "formaction")
              && /^(?:javascript:|vbscript:|data:(?!image\/(?:png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)))/i.test(val)) {
              el.removeAttribute(attr.name);
            }
          }
        }
        cleaned = new XMLSerializer().serializeToString(root);
      }
    } catch {
      // Fall back to regex sanitization below
    }
  }

  cleaned = cleaned
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript:|vbscript:|data:text\/html)[^"]*"|'\s*(?:javascript:|vbscript:|data:text\/html)[^']*')/gi, "");

  return cleaned.trim();
}

export function sanitizeSvgDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return "";
  const trimmed = dataUrl.trim();
  if (!/^data:image\/svg\+xml(?:;[^,]*)?,/i.test(trimmed)) {
    return trimmed;
  }
  const svgText = decodeSvgDataUrlPayload(trimmed);
  const sanitized = sanitizeSvgMarkup(svgText);
  if (!sanitized) return "";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
}

export function normalizeCustomIconValue(rawValue, { allowEmoji = false } = {}) {
  if (!rawValue || typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (!isUrlLikeIcon(trimmed)) {
    return allowEmoji ? trimmed : null;
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  if (/^data:/i.test(trimmed)) {
    if (!SAFE_DATA_IMAGE_URL_REGEX.test(trimmed)) return null;
    if (/^data:image\/svg\+xml/i.test(trimmed)) {
      return sanitizeSvgDataUrl(trimmed) || null;
    }
    return trimmed;
  }

  if (/^(blob:|chrome-extension:|moz-extension:)/i.test(trimmed)) {
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

const ICON_URL_CACHE_PREFIX = "myspeeddial-icon-url-cache:";
const ICON_URL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ICON_EXCLUDE_DOMAINS_KEY = "myspeeddial-local-icon-exclude-domains";
const iconUrlMemoryCache = new Map();
const inFlightIconUrlFetches = new Map();
let excludedIconDomainsCache = null;

export function parseExcludedIconDomains(rawText) {
  if (typeof rawText !== "string") return [];
  const seen = new Set();
  const result = [];
  for (const part of rawText.split(/[\n,;]+/)) {
    const trimmed = part.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/:\d+$/, "");
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function getLocalExcludedIconDomainsText() {
  try {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(ICON_EXCLUDE_DOMAINS_KEY) || "";
  } catch {
    return "";
  }
}

export function getLocalExcludedIconDomains() {
  if (Array.isArray(excludedIconDomainsCache)) return excludedIconDomainsCache;
  excludedIconDomainsCache = parseExcludedIconDomains(getLocalExcludedIconDomainsText());
  return excludedIconDomainsCache;
}

export function setLocalExcludedIconDomainsText(rawText) {
  const normalized = parseExcludedIconDomains(rawText).join(", ");
  excludedIconDomainsCache = parseExcludedIconDomains(normalized);
  try {
    if (typeof localStorage !== "undefined") {
      if (normalized) {
        localStorage.setItem(ICON_EXCLUDE_DOMAINS_KEY, normalized);
      } else {
        localStorage.removeItem(ICON_EXCLUDE_DOMAINS_KEY);
      }
    }
  } catch {
    // Ignore storage errors.
  }
  return normalized;
}

export function isUrlHostExcludedFromIconRefresh(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  const patterns = getLocalExcludedIconDomains();
  if (patterns.length === 0) return false;
  let hostname = "";
  try {
    hostname = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  return patterns.some(pattern => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      return hostname === suffix || hostname.endsWith("." + suffix);
    }
    return hostname === pattern;
  });
}

const ICON_URL_FAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ICON_URL_FETCH_TIMEOUT_MS = 5000;
const EXCLUDED_ICON_URLS_KEY = "myspeeddial-excluded-icon-urls";

function isHttpIconUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function getExcludedIconUrlSet() {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(EXCLUDED_ICON_URLS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter(u => typeof u === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function isIconUrlExcluded(url) {
  if (!isHttpIconUrl(url)) return false;
  return getExcludedIconUrlSet().has(url.trim());
}

export function setIconUrlExcluded(url, excluded) {
  if (!isHttpIconUrl(url)) return;
  const key = url.trim();
  const set = getExcludedIconUrlSet();
  if (excluded) {
    set.add(key);
  } else {
    set.delete(key);
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(EXCLUDED_ICON_URLS_KEY, JSON.stringify([...set]));
    }
  } catch {
    // Ignore storage errors.
  }
}

function readIconUrlCacheEntry(key) {
  const mem = iconUrlMemoryCache.get(key);
  if (mem) return mem;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(ICON_URL_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    iconUrlMemoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeIconUrlCacheEntry(key, entry) {
  iconUrlMemoryCache.set(key, entry);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ICON_URL_CACHE_PREFIX + key, JSON.stringify(entry));
    }
  } catch {
    // Ignore storage quota errors for icon URL cache.
  }
}

function isIconUrlInCooldown(key) {
  const entry = readIconUrlCacheEntry(key);
  if (!entry?.failedAt) return false;
  if (Date.now() - Number(entry.failedAt) < ICON_URL_FAIL_COOLDOWN_MS) {
    return true;
  }
  iconUrlMemoryCache.delete(key);
  try {
    localStorage?.removeItem?.(ICON_URL_CACHE_PREFIX + key);
  } catch {
    // Ignore storage errors.
  }
  return false;
}

export function isIconUrlFailed(url) {
  if (!isHttpIconUrl(url)) return false;
  return isIconUrlInCooldown(url.trim());
}

export function clearFailedIconUrl(url) {
  if (!isHttpIconUrl(url)) return;
  const key = url.trim();
  iconUrlMemoryCache.delete(key);
  try {
    localStorage?.removeItem?.(ICON_URL_CACHE_PREFIX + key);
  } catch {
    // Ignore storage errors.
  }
  setIconUrlExcluded(key, false);
}

export function clearAllFailedIconUrls() {
  for (const [key, entry] of iconUrlMemoryCache.entries()) {
    if (entry?.failedAt) iconUrlMemoryCache.delete(key);
  }
  try {
    if (typeof localStorage !== "undefined") {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(ICON_URL_CACHE_PREFIX)) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(k) || "");
          if (parsed?.failedAt && !parsed?.dataUrl) keysToRemove.push(k);
        } catch {}
      }
      for (const k of keysToRemove) localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage errors.
  }
}

async function hasOriginPermissionForIconUrl(url) {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return await chrome.permissions.contains({ origins: [`${parsed.protocol}//${parsed.host}/*`] });
  } catch {
    return false;
  }
}

export function getCachedIconUrlDataUrl(url) {
  if (!isHttpIconUrl(url)) return null;
  const key = url.trim();
  const entry = readIconUrlCacheEntry(key);
  if (!entry?.dataUrl || typeof entry.dataUrl !== "string") return null;
  if (Date.now() - Number(entry.updatedAt || 0) >= ICON_URL_CACHE_TTL_MS) {
    iconUrlMemoryCache.delete(key);
    try {
      localStorage?.removeItem?.(ICON_URL_CACHE_PREFIX + key);
    } catch {
      // Ignore storage errors.
    }
    return null;
  }
  return entry.dataUrl;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("icon-fetch-unsupported"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("icon-cache-read-failed"));
    reader.readAsDataURL(blob);
  });
}

export async function fetchIconAsDataUrl(iconUrl, force = false, { requireImageType = false, timeoutMs = 0 } = {}) {
  if (typeof fetch !== "function" || typeof FileReader === "undefined") {
    throw new Error("icon-fetch-unsupported");
  }
  if (typeof iconUrl !== "string" || !iconUrl.trim()) {
    throw new Error("icon-url-invalid");
  }
  const trimmedUrl = iconUrl.trim();
  const isSafeFetchTarget = isHttpIconUrl(trimmedUrl)
    || SAFE_DATA_IMAGE_URL_REGEX.test(trimmedUrl)
    || trimmedUrl.startsWith("/");
  if (!isSafeFetchTarget) {
    throw new Error("icon-url-disallowed-scheme");
  }
  const controller = timeoutMs > 0 && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(iconUrl, {
      cache: force ? "reload" : "default",
      ...(controller ? { signal: controller.signal } : {})
    });
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
  if (!response.ok) {
    throw new Error(`icon-fetch-failed:${response.status}`);
  }
  const iconBlob = await response.blob();
  if (!iconBlob || iconBlob.size === 0) {
    throw new Error("icon-blob-empty");
  }
  if (requireImageType && iconBlob.type && !iconBlob.type.startsWith("image/")) {
    throw new Error("icon-blob-not-image");
  }
  return await blobToDataUrl(iconBlob);
}

export async function cacheIconUrlIfNeeded(url) {
  if (!isHttpIconUrl(url) || typeof fetch !== "function") return null;
  const key = url.trim();
  if (isUrlHostExcludedFromIconRefresh(key) || isIconUrlInCooldown(key)) {
    return null;
  }
  const existing = getCachedIconUrlDataUrl(key);
  if (existing) return existing;
  if (inFlightIconUrlFetches.has(key)) {
    return inFlightIconUrlFetches.get(key);
  }

  const task = (async () => {
    try {
      if (!(await hasOriginPermissionForIconUrl(key))) {
        return null;
      }
      const dataUrl = await fetchIconAsDataUrl(key, false, {
        requireImageType: true,
        timeoutMs: ICON_URL_FETCH_TIMEOUT_MS
      });
      if (!dataUrl) return null;

      if (dataUrl.length <= 64000) {
        writeIconUrlCacheEntry(key, { dataUrl, updatedAt: Date.now() });
      } else {
        iconUrlMemoryCache.set(key, { dataUrl, updatedAt: Date.now() });
      }
      return dataUrl;
    } catch {
      return null;
    } finally {
      inFlightIconUrlFetches.delete(key);
    }
  })();

  inFlightIconUrlFetches.set(key, task);
  return task;
}

function scheduleRemoteIconLoadAfterPaint(task) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => setTimeout(task, 0));
  } else {
    setTimeout(task, 0);
  }
}

export function applyCachedIconImageSrc(imgEl, iconUrl) {
  if (!imgEl || !iconUrl) return;
  const cached = getCachedIconUrlDataUrl(iconUrl);
  if (cached) {
    delete imgEl.dataset.pendingRemoteIcon;
    imgEl.src = cached;
    return;
  }
  if (isHttpIconUrl(iconUrl) && (isUrlHostExcludedFromIconRefresh(iconUrl) || isIconUrlExcluded(iconUrl))) {
    delete imgEl.dataset.pendingRemoteIcon;
    queueMicrotask(() => {
      if (imgEl.isConnected) {
        imgEl.dispatchEvent(new Event("error"));
      }
    });
    return;
  }
  if (isHttpIconUrl(iconUrl)) {
    imgEl.dataset.pendingRemoteIcon = iconUrl;
    scheduleRemoteIconLoadAfterPaint(() => {
      if (!imgEl.isConnected || imgEl.dataset.pendingRemoteIcon !== iconUrl) return;
      delete imgEl.dataset.pendingRemoteIcon;
      imgEl.addEventListener("error", () => {
        writeIconUrlCacheEntry(iconUrl.trim(), { failedAt: Date.now() });
      }, { once: true });
      imgEl.src = iconUrl;
      void cacheIconUrlIfNeeded(iconUrl);
    });
    return;
  }
  delete imgEl.dataset.pendingRemoteIcon;
  imgEl.src = iconUrl;
}

export function isAllowedThemeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("//")) return false;

  try {
    const baseHref = typeof window !== "undefined" && window.location?.href ? window.location.href : undefined;
    const parsed = new URL(trimmed, baseHref);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "chrome-extension:" ||
      parsed.protocol === "moz-extension:"
    );
  } catch {
    return false;
  }
}
