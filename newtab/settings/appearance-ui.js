import { loadConfig, defaultConfig } from "../config.js";
import { t, getCurrentLanguage, setLanguage, resetLanguageToBrowser } from "../i18n.js";
import { render, calculateGridLayout } from "../render.js";
import {
  applyBackground,
  applyBgDim,
  applyBarOpacity,
  applyTileOpacity,
  applyTileSize,
  applyGroupTileSize,
  applySideSpaces,
  applyThemeStyle,
  fetchAndCacheThemeUrl,
  fetchBackgroundImageFromUrl,
  downscaleBackgroundImage,
  isAllowedThemeUrl,
  getCustomThemeUrlCache
} from "../theme.js";
import { normalizeWidgetOrder } from "../custom-widgets.js";
import { updateUIText, updateClock } from "../main.js";
import {
  applyMassTileColorFromIcon,
  isValidFallbackBookmarkIcon,
  setCustomFallbackBookmarkIcon
} from "../bookmarks.js";
import { renderGroups } from "../groups.js";
import { settingsState, markSettingsDirty } from "./context.js";

const showDeletedBtn = document.getElementById("show-deleted-btn");
const showDeletedToggle = document.getElementById("show-deleted-toggle");
const languageSelect = document.getElementById("language-select");
const themeSelect = document.getElementById("theme-select");
const themeCustomFileRow = document.getElementById("theme-custom-file-row");
const themeCssFileInput = document.getElementById("theme-css-file-input");
const themeCssFileName = document.getElementById("theme-css-file-name");
const themeCustomUrlRow = document.getElementById("theme-custom-url-row");
const themeCssUrlInput = document.getElementById("theme-css-url-input");
const themeCssUrlApply = document.getElementById("theme-css-url-apply");
const themeStatus = document.getElementById("theme-status");
const themeBackgroundsLink = document.getElementById("theme-backgrounds-link");
const themeBackgroundsPixabayLink = document.getElementById("theme-backgrounds-pixabay-link");
const themeBackgroundsPexelsLink = document.getElementById("theme-backgrounds-pexels-link");
const bgImageInput = document.getElementById("bg-image-input");
const bgImageUrlInput = document.getElementById("bg-image-url-input");
const bgImageUrlApply = document.getElementById("bg-image-url-apply");
const bgImageUrlStatus = document.getElementById("bg-image-url-status");
const bgSizeSelect = document.getElementById("bg-size-select");
const bgDimSlider = document.getElementById("bg-dim-slider");
const bgDimValue = document.getElementById("bg-dim-value");
const bgPreview = document.getElementById("bg-preview");
const bgRemoveBtn = document.getElementById("bg-remove-btn");
const resetAppearanceBtn = document.getElementById("reset-appearance-btn");
const tileOpacitySlider = document.getElementById("tile-opacity-slider");
const tileOpacityValue = document.getElementById("tile-opacity-value");
const barOpacitySlider = document.getElementById("bar-opacity-slider");
const barOpacityValue = document.getElementById("bar-opacity-value");
const tileSizeSlider = document.getElementById("tile-size-slider");
const tileSizeValue = document.getElementById("tile-size-value");
const groupTileSizeSlider = document.getElementById("group-tile-size-slider");
const groupTileSizeValue = document.getElementById("group-tile-size-value");
const groupCountToggle = document.getElementById("group-count-toggle");
const showSideSpacesToggle = document.getElementById("show-side-spaces-toggle");
const highlightSideSpacesToggle = document.getElementById("highlight-side-spaces-toggle");
const tallBookmarkTilesToggle = document.getElementById("tall-bookmark-tiles-toggle");
const clickableTagsToggle = document.getElementById("clickable-tags-toggle");
const searchStyleSelect = document.getElementById("search-style-select");
const headerSingleRowToggle = document.getElementById("header-single-row-toggle");
const massEnableColorFromIconBtn = document.getElementById("mass-enable-color-from-icon");
const massDisableColorFromIconBtn = document.getElementById("mass-disable-color-from-icon");
const massColorFromIconStatus = document.getElementById("mass-color-from-icon-status");

const SEASONAL_BACKGROUND_THEMES = new Set(["spring", "summer", "autumn", "winter"]);

let bgPreviewGeneration = 0;

async function createDownscaledPreviewUrl(dataUrl, maxWidth = 240, maxHeight = 135) {
  if (!dataUrl || typeof createImageBitmap !== "function" || typeof fetch !== "function" || typeof document === "undefined") {
    return dataUrl;
  }
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const srcBitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, maxWidth / srcBitmap.width, maxHeight / srcBitmap.height);
      if (scale >= 1) return dataUrl;
      const targetW = Math.max(1, Math.round(srcBitmap.width * scale));
      const targetH = Math.max(1, Math.round(srcBitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUrl;
      let resized = null;
      try {
        resized = await createImageBitmap(blob, { resizeWidth: targetW, resizeHeight: targetH, resizeQuality: "medium" });
        ctx.drawImage(resized, 0, 0, targetW, targetH);
      } catch {
        ctx.drawImage(srcBitmap, 0, 0, targetW, targetH);
      } finally {
        if (resized && resized !== srcBitmap) resized.close?.();
      }
      const webp = canvas.toDataURL("image/webp", 0.7);
      return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.7);
    } finally {
      srcBitmap.close?.();
    }
  } catch {
    return dataUrl;
  }
}

export function setBgPreviewImage(dataUrl) {
  if (!bgPreview) return;
  const gen = ++bgPreviewGeneration;
  if (!dataUrl) {
    bgPreview.style.backgroundImage = "";
    bgPreview.style.display = "none";
    return;
  }
  void createDownscaledPreviewUrl(dataUrl).then(previewUrl => {
    if (gen !== bgPreviewGeneration || !bgPreview) return;
    bgPreview.style.backgroundImage = `url('${previewUrl}')`;
    bgPreview.style.display = "block";
  });
}

export function updateShowDeletedButtonAppearance() {
  if (!showDeletedBtn || !showDeletedToggle) return;
  if (showDeletedToggle.checked) {
    showDeletedBtn.style.opacity = "1";
    showDeletedBtn.style.transform = "scale(1.1)";
  } else {
    showDeletedBtn.style.opacity = "0.6";
    showDeletedBtn.style.transform = "scale(1)";
  }
}

export function updateDateTimeVisibility(isVisible) {
  if (typeof window.setDateTimePreviewEnabled === "function") {
    window.setDateTimePreviewEnabled(!!isVisible);
    return;
  }

  const dateTimeDisplay = document.getElementById("date-time-display");
  if (dateTimeDisplay) {
    dateTimeDisplay.style.display = isVisible ? "block" : "none";
  }
}

export async function revertDateTimePreviewToSaved() {
  try {
    if (typeof window.clearDateTimePreview === "function") {
      window.clearDateTimePreview();
    }
  } catch (err) {
    console.warn("Failed to revert date/time preview", err);
  }
}

function getThemeBackgroundQuery(themeValue) {
  return encodeURIComponent(SEASONAL_BACKGROUND_THEMES.has(themeValue) ? themeValue : "wallpaper");
}

export function updateThemeCustomRowsVisibility(themeValue) {
  if (themeCustomFileRow) {
    themeCustomFileRow.classList.toggle("hidden", themeValue !== "custom-file");
  }
  if (themeCustomUrlRow) {
    themeCustomUrlRow.classList.toggle("hidden", themeValue !== "custom-url");
  }
  const query = getThemeBackgroundQuery(themeValue);
  if (themeBackgroundsLink) {
    themeBackgroundsLink.href = `https://unsplash.com/s/photos/${query}?license=free`;
  }
  if (themeBackgroundsPixabayLink) {
    themeBackgroundsPixabayLink.href = `https://pixabay.com/photos/search/${query}`;
  }
  if (themeBackgroundsPexelsLink) {
    themeBackgroundsPexelsLink.href = `https://www.pexels.com/search/?q=${query}&orientation=landscape`;
  }
}

export function setBackgroundUrlStatusMessage(message = "", isError = false) {
  if (!bgImageUrlStatus) return;
  bgImageUrlStatus.textContent = message;
  bgImageUrlStatus.style.color = message ? (isError ? "#e53935" : "#4caf50") : "";
}

export function setThemeStatusMessage(message = "", isError = false) {
  if (!themeStatus) return;
  themeStatus.textContent = message;
  themeStatus.style.color = message ? (isError ? "#e53935" : "#4caf50") : "";
}

export function applyThemeDraftToControls(draft) {
  if (!draft) return;
  if (themeSelect) themeSelect.value = draft.theme;
  if (themeCssFileName) themeCssFileName.textContent = draft.customThemeFileName;
  if (themeCssUrlInput) themeCssUrlInput.value = draft.customThemeUrl;
  if (themeCssFileInput) themeCssFileInput.value = "";
  setThemeStatusMessage("");
  updateThemeCustomRowsVisibility(draft.theme);
}

export function createAppearanceDraftFromConfig(config) {
  const appearance = config?.appearance || {};
  return {
    theme: appearance.theme || "default",
    customThemeCss: appearance.customThemeCss || "",
    customThemeFileName: appearance.customThemeFileName || "",
    customThemeUrl: appearance.customThemeUrl || "",
    backgroundImage: appearance.backgroundImage ?? null,
    backgroundImageUrl: appearance.backgroundImageUrl || "",
    backgroundSize: appearance.backgroundSize || "stretched",
    bgDim: appearance.bgDim ?? 0,
    tileOpacity: appearance.tileOpacity ?? 1,
    barOpacity: appearance.barOpacity ?? 1,
    tileSize: appearance.tileSize ?? 1,
    groupTileSize: appearance.groupTileSize ?? 1,
    showDateTime: appearance.showDateTime ?? true,
    showDeleted: appearance.showDeleted ?? false,
    showGroupBookmarkCount: appearance.showGroupBookmarkCount ?? true,
    showSideSpaces: appearance.showSideSpaces ?? false,
    highlightSideSpaces: appearance.highlightSideSpaces ?? false,
    tallBookmarkTiles: appearance.tallBookmarkTiles ?? false,
    clickableTags: appearance.clickableTags ?? true,
    dateTimeSpace: (appearance.dateTimeSpace === "disabled" || appearance.showDateTime === false)
      ? "disabled"
      : (appearance.dateTimeSpace || "footer"),
    groupsSpace: appearance.groupsSpace || "header",
    searchSpace: appearance.searchSpace || "header",
    manageSpace: appearance.manageSpace || "header",
    syncStatusSpace: appearance.syncStatusSpace || "footer",
    shortcutPaletteSpace: appearance.shortcutPaletteSpace || "footer",
    bookmarksCountSpace: appearance.bookmarksCountSpace || "footer",
    headerSingleRow: appearance.headerSingleRow !== false,
    searchStyle: appearance.searchStyle || "full",
    customWidgets: Array.isArray(appearance.customWidgets) ? appearance.customWidgets.map(w => ({ ...w })) : [],
    customSearchAutoRouteDefaults: { ...(appearance.customSearchAutoRouteDefaults || {}) },
    customSearchAutoRouteIcons: { ...(appearance.customSearchAutoRouteIcons || {}) },
    defaultBookmarkIcon: isValidFallbackBookmarkIcon(appearance.defaultBookmarkIcon) ? appearance.defaultBookmarkIcon.trim() : null,
    widgetOrder: normalizeWidgetOrder(appearance.widgetOrder, appearance.customWidgets),
    widgetAlign: { ...(appearance.widgetAlign || {}) },
    widgetNewRow: { ...(appearance.widgetNewRow || {}) }
  };
}

export async function ensureAppearanceDraft() {
  if (!settingsState.appearanceDraft) {
    const config = await loadConfig();
    settingsState.appearanceDraft = createAppearanceDraftFromConfig(config);
  }
  return settingsState.appearanceDraft;
}

export function syncAppearanceControlsFromDraft(draft) {
  applyThemeDraftToControls(draft);

  if (bgSizeSelect) bgSizeSelect.value = draft.backgroundSize;

  if (bgDimSlider) {
    const dimPercent = Math.round((draft.bgDim ?? 0) * 100);
    bgDimSlider.value = dimPercent;
    if (bgDimValue) bgDimValue.textContent = `${dimPercent}%`;
  }

  if (tileOpacitySlider) {
    const opacityPercent = Math.round((draft.tileOpacity ?? 1) * 100);
    tileOpacitySlider.value = opacityPercent;
    if (tileOpacityValue) tileOpacityValue.textContent = `${opacityPercent}%`;
  }

  if (barOpacitySlider) {
    const barOpacityPercent = Math.round((draft.barOpacity ?? 1) * 100);
    barOpacitySlider.value = barOpacityPercent;
    if (barOpacityValue) barOpacityValue.textContent = `${barOpacityPercent}%`;
  }

  if (tileSizeSlider) {
    const sizePercent = Math.round((draft.tileSize ?? 1) * 100);
    tileSizeSlider.value = sizePercent;
    if (tileSizeValue) tileSizeValue.textContent = `${sizePercent}%`;
  }

  if (groupTileSizeSlider) {
    const groupSizePercent = Math.round((draft.groupTileSize ?? 1) * 100);
    groupTileSizeSlider.value = groupSizePercent;
    if (groupTileSizeValue) groupTileSizeValue.textContent = `${groupSizePercent}%`;
  }

  if (showDeletedToggle) {
    showDeletedToggle.checked = !!draft.showDeleted;
    showDeletedToggle.dispatchEvent(new Event("change"));
    updateShowDeletedButtonAppearance();
  }

  if (groupCountToggle) {
    groupCountToggle.checked = !!draft.showGroupBookmarkCount;
  }
  if (headerSingleRowToggle) {
    headerSingleRowToggle.checked = !!draft.headerSingleRow;
  }
  window.groupCountPreviewEnabled = null;

  if (showSideSpacesToggle) {
    showSideSpacesToggle.checked = !!draft.showSideSpaces;
  }
  if (highlightSideSpacesToggle) {
    highlightSideSpacesToggle.checked = !!draft.highlightSideSpaces;
  }
  if (tallBookmarkTilesToggle) {
    tallBookmarkTilesToggle.checked = !!draft.tallBookmarkTiles;
  }
  if (clickableTagsToggle) {
    clickableTagsToggle.checked = draft.clickableTags !== false;
  }
  if (searchStyleSelect) {
    searchStyleSelect.value = draft.searchStyle || "full";
  }
  window.renderWidgetOrderList?.(draft);

  setBgPreviewImage(draft.backgroundImage || null);

  if (bgImageInput) bgImageInput.value = "";
  if (bgImageUrlInput) bgImageUrlInput.value = draft.backgroundImageUrl || "";
  setBackgroundUrlStatusMessage("");
}

export async function revertAppearancePreviewToSaved() {
  try {
    const config = await loadConfig();
    settingsState.appearanceDraft = createAppearanceDraftFromConfig(config);
    settingsState.appearancePreviewUrlCss = "";
    settingsState.appearancePreviewUrlTarget = "";

    syncAppearanceControlsFromDraft(settingsState.appearanceDraft);

    await applyThemeStyle(config);
    await applyBackground(config);
    await applyBgDim(config);
    await applyTileOpacity(config);
    await applyBarOpacity(config);
    await applyTileSize(config);
    await applyGroupTileSize(config);
    await applySideSpaces(config);
    await revertDateTimePreviewToSaved();
    if (settingsState.savedLanguageSnapshot) {
      const currentLang = getCurrentLanguage();
      if (settingsState.savedLanguageSnapshot.override) {
        if (currentLang !== settingsState.savedLanguageSnapshot.override) {
          await setLanguage(settingsState.savedLanguageSnapshot.override, { persist: true });
        }
      } else {
        await resetLanguageToBrowser({ persist: true });
      }
      if (languageSelect) {
        languageSelect.value = getCurrentLanguage();
      }
      settingsState.pendingLanguageReset = false;
      updateUIText();
      updateClock();
    }
    await render();
  } catch (err) {
    console.warn("Failed to revert appearance preview", err);
  }
}

export function populateAppearanceSettings(config) {
  if (bgSizeSelect) {
    bgSizeSelect.value = config.appearance?.backgroundSize || "stretched";
  }
  if (bgDimSlider) {
    const dimPercent = Math.round((config.appearance?.bgDim ?? 0) * 100);
    bgDimSlider.value = dimPercent;
    if (bgDimValue) bgDimValue.textContent = `${dimPercent}%`;
  }
  if (bgImageUrlInput) {
    bgImageUrlInput.value = config.appearance?.backgroundImageUrl || "";
  }
  setBackgroundUrlStatusMessage("");
  setBgPreviewImage(config.appearance?.backgroundImage || null);

  if (tileOpacitySlider) {
    const opacityPercent = Math.round((config.appearance?.tileOpacity ?? 1) * 100);
    tileOpacitySlider.value = opacityPercent;
    if (tileOpacityValue) tileOpacityValue.textContent = `${opacityPercent}%`;
  }

  if (barOpacitySlider) {
    const barOpacityPercent = Math.round((config.appearance?.barOpacity ?? 1) * 100);
    barOpacitySlider.value = barOpacityPercent;
    if (barOpacityValue) barOpacityValue.textContent = `${barOpacityPercent}%`;
  }

  if (tileSizeSlider) {
    const sizePercent = Math.round((config.appearance?.tileSize ?? 1) * 100);
    tileSizeSlider.value = sizePercent;
    if (tileSizeValue) tileSizeValue.textContent = `${sizePercent}%`;
  }

  if (groupTileSizeSlider) {
    const groupSizePercent = Math.round((config.appearance?.groupTileSize ?? 1) * 100);
    groupTileSizeSlider.value = groupSizePercent;
    if (groupTileSizeValue) groupTileSizeValue.textContent = `${groupSizePercent}%`;
  }

  if (groupCountToggle) {
    groupCountToggle.checked = config.appearance?.showGroupBookmarkCount ?? true;
  }
  if (showSideSpacesToggle) {
    showSideSpacesToggle.checked = config.appearance?.showSideSpaces ?? false;
  }
  if (highlightSideSpacesToggle) {
    highlightSideSpacesToggle.checked = config.appearance?.highlightSideSpaces ?? false;
  }
  if (tallBookmarkTilesToggle) {
    tallBookmarkTilesToggle.checked = config.appearance?.tallBookmarkTiles ?? false;
  }
  if (clickableTagsToggle) {
    clickableTagsToggle.checked = config.appearance?.clickableTags ?? true;
  }
  if (searchStyleSelect) {
    searchStyleSelect.value = config.appearance?.searchStyle || "full";
  }
  window.renderWidgetOrderList?.(config.appearance || {});

  if (showDeletedToggle) {
    showDeletedToggle.checked = config.appearance?.showDeleted ?? false;
    showDeletedToggle.dispatchEvent(new Event("change"));
    updateShowDeletedButtonAppearance();
  }

  settingsState.appearanceDraft = createAppearanceDraftFromConfig(config);
  settingsState.appearancePreviewUrlCss = "";
  settingsState.appearancePreviewUrlTarget = "";
  applyThemeDraftToControls(settingsState.appearanceDraft);
  if (massColorFromIconStatus) massColorFromIconStatus.textContent = "";
}

export async function applyAppearanceToConfig(config, { setSyncStatusMessage }) {
  const draft = settingsState.appearanceDraft;
  const selectedTheme = themeSelect
    ? (themeSelect.value || "default")
    : (draft?.theme || config.appearance.theme || "default");
  config.appearance.theme = selectedTheme;
  if (draft) {
    config.appearance.customThemeCss = draft.customThemeCss || "";
    config.appearance.customThemeFileName = draft.customThemeFileName || "";
    config.appearance.customThemeUrl = themeCssUrlInput
      ? themeCssUrlInput.value.trim()
      : (draft.customThemeUrl || "");
  } else if (themeCssUrlInput) {
    config.appearance.customThemeUrl = themeCssUrlInput.value.trim();
  }

  let themePreviewCssForSave = "";
  if (selectedTheme === "custom-url") {
    const targetUrl = (config.appearance.customThemeUrl || "").trim();
    if (!isAllowedThemeUrl(targetUrl)) {
      setThemeStatusMessage("❌ " + t("invalidThemeUrl"), true);
      setSyncStatusMessage("❌ " + t("invalidThemeUrl"));
      return false;
    }

    if (settingsState.appearancePreviewUrlCss && settingsState.appearancePreviewUrlTarget === targetUrl) {
      themePreviewCssForSave = settingsState.appearancePreviewUrlCss;
    } else {
      const cachedEntry = await getCustomThemeUrlCache();
      if (!cachedEntry || cachedEntry.url !== targetUrl || !cachedEntry.css) {
        try {
          const fetched = await fetchAndCacheThemeUrl(targetUrl, { saveCache: true });
          config.appearance.customThemeUrl = fetched.url;
          if (draft) draft.customThemeUrl = fetched.url;
          if (themeCssUrlInput) themeCssUrlInput.value = fetched.url;
          themePreviewCssForSave = fetched.css;
        } catch (error) {
          const detail = error?.message === "INVALID_THEME_URL" || !error?.message
            ? t("invalidThemeUrl")
            : error.message;
          setThemeStatusMessage("❌ " + detail, true);
          setSyncStatusMessage("❌ " + detail);
          return false;
        }
      }
    }
  }

  await applyThemeStyle(config, {
    persistCache: true,
    previewUrlCss: themePreviewCssForSave
  });
  settingsState.appearancePreviewUrlCss = "";
  settingsState.appearancePreviewUrlTarget = "";

  if (bgSizeSelect) {
    config.appearance.backgroundSize = bgSizeSelect.value || "stretched";
  }
  if (bgDimSlider) {
    config.appearance.bgDim = (Number(bgDimSlider.value) || 0) / 100;
    await applyBgDim(config);
  }
  if (tileOpacitySlider) {
    config.appearance.tileOpacity = tileOpacitySlider.value / 100;
  }
  if (barOpacitySlider) {
    config.appearance.barOpacity = barOpacitySlider.value / 100;
    await applyBarOpacity(config);
  }
  if (tileSizeSlider) {
    config.appearance.tileSize = tileSizeSlider.value / 100;
    await applyTileSize(config);
  }
  if (groupTileSizeSlider) {
    config.appearance.groupTileSize = groupTileSizeSlider.value / 100;
    await applyGroupTileSize(config);
  }
  if (draft) {
    config.appearance.backgroundImage = draft.backgroundImage ?? null;
    config.appearance.backgroundImageUrl = draft.backgroundImageUrl || "";
  }

  if (showDeletedToggle) {
    config.appearance.showDeleted = showDeletedToggle.checked;
  }

  if (groupCountToggle) {
    config.appearance.showGroupBookmarkCount = groupCountToggle.checked;
  }
  window.groupCountPreviewEnabled = null;

  if (showSideSpacesToggle) {
    config.appearance.showSideSpaces = showSideSpacesToggle.checked;
  }
  if (highlightSideSpacesToggle) {
    config.appearance.highlightSideSpaces = highlightSideSpacesToggle.checked;
  }
  if (tallBookmarkTilesToggle) {
    config.appearance.tallBookmarkTiles = tallBookmarkTilesToggle.checked;
  }
  if (clickableTagsToggle) {
    config.appearance.clickableTags = clickableTagsToggle.checked;
  }
  if (draft) {
    config.appearance.dateTimeSpace = draft.dateTimeSpace || "footer";
    config.appearance.showDateTime = config.appearance.dateTimeSpace !== "disabled";
    config.appearance.groupsSpace = draft.groupsSpace || "header";
    config.appearance.searchSpace = draft.searchSpace || "header";
    config.appearance.manageSpace = draft.manageSpace || "header";
    config.appearance.syncStatusSpace = draft.syncStatusSpace || "footer";
    config.appearance.shortcutPaletteSpace = draft.shortcutPaletteSpace || "footer";
    config.appearance.bookmarksCountSpace = draft.bookmarksCountSpace || "footer";
    config.appearance.headerSingleRow = !!draft.headerSingleRow;
  }
  if (searchStyleSelect) {
    config.appearance.searchStyle = searchStyleSelect.value || "full";
  }
  if (draft?.customWidgets) {
    config.appearance.customWidgets = draft.customWidgets.map(w => ({ ...w }));
  }
  if (draft?.customSearchAutoRouteDefaults) {
    config.appearance.customSearchAutoRouteDefaults = { ...draft.customSearchAutoRouteDefaults };
  }
  if (draft?.customSearchAutoRouteIcons) {
    config.appearance.customSearchAutoRouteIcons = { ...draft.customSearchAutoRouteIcons };
  }
  if (draft && "defaultBookmarkIcon" in draft) {
    config.appearance.defaultBookmarkIcon = isValidFallbackBookmarkIcon(draft.defaultBookmarkIcon)
      ? draft.defaultBookmarkIcon.trim()
      : null;
    setCustomFallbackBookmarkIcon(config.appearance.defaultBookmarkIcon);
  }
  if (draft?.widgetOrder) {
    config.appearance.widgetOrder = normalizeWidgetOrder(draft.widgetOrder, config.appearance.customWidgets);
  }
  if (draft?.widgetAlign) {
    config.appearance.widgetAlign = { ...draft.widgetAlign };
  }
  if (draft?.widgetNewRow) {
    config.appearance.widgetNewRow = { ...draft.widgetNewRow };
  }
  await applyTileSize(config);
  await applySideSpaces(config);
  return true;
}

async function applyBackgroundFromUrlInput() {
  if (!bgImageUrlInput) return;
  const rawUrl = bgImageUrlInput.value.trim();
  if (!isAllowedThemeUrl(rawUrl)) {
    setBackgroundUrlStatusMessage(t("invalidBackgroundUrl") || "Please enter a valid image URL.", true);
    return;
  }

  try {
    setBackgroundUrlStatusMessage("...");
    const { url, dataUrl } = await fetchBackgroundImageFromUrl(rawUrl);
    const draft = await ensureAppearanceDraft();
    draft.backgroundImage = dataUrl;
    draft.backgroundImageUrl = url;
    bgImageUrlInput.value = url;
    if (bgImageInput) bgImageInput.value = "";

    setBgPreviewImage(dataUrl);

    await applyBackground({ appearance: { ...draft } });
    setBackgroundUrlStatusMessage("✅");
    markSettingsDirty();
  } catch (err) {
    setBackgroundUrlStatusMessage(err?.message || t("invalidBackgroundUrl") || "Failed to load image URL.", true);
  }
}

async function handleApplyThemeUrlPreview() {
  const rawUrl = themeCssUrlInput ? themeCssUrlInput.value.trim() : "";
  if (!isAllowedThemeUrl(rawUrl)) {
    setThemeStatusMessage("❌ " + t("invalidThemeUrl"), true);
    return false;
  }

  if (themeCssUrlApply) {
    themeCssUrlApply.disabled = true;
  }
  const confirmed = window.confirm(
    t("appearanceCustomCssTrustConfirm")
      || "Only load custom CSS from URLs you trust. Untrusted CSS can alter or spoof interface elements. Continue?"
  );
  if (!confirmed) {
    if (themeCssUrlApply) themeCssUrlApply.disabled = false;
    return false;
  }
  setThemeStatusMessage("⏳ ...");

  try {
    const fetched = await fetchAndCacheThemeUrl(rawUrl, { saveCache: false });
    const draft = await ensureAppearanceDraft();
    draft.theme = "custom-url";
    draft.customThemeUrl = fetched.url;
    settingsState.appearancePreviewUrlCss = fetched.css;
    settingsState.appearancePreviewUrlTarget = fetched.url;

    if (themeSelect) {
      themeSelect.value = "custom-url";
    }
    if (themeCssUrlInput) {
      themeCssUrlInput.value = fetched.url;
    }
    updateThemeCustomRowsVisibility("custom-url");

    await applyThemeStyle(
      { appearance: { ...draft } },
      { persistCache: false, previewUrlCss: fetched.css }
    );
    setThemeStatusMessage(`✅ ${fetched.url}`);
    markSettingsDirty();
    return true;
  } catch (error) {
    const detail = error?.message === "INVALID_THEME_URL" || !error?.message
      ? t("invalidThemeUrl")
      : error.message;
    setThemeStatusMessage("❌ " + detail, true);
    return false;
  } finally {
    if (themeCssUrlApply) {
      themeCssUrlApply.disabled = false;
    }
  }
}

async function handleMassColorFromIconAction(enable) {
  if (massEnableColorFromIconBtn) massEnableColorFromIconBtn.disabled = true;
  if (massDisableColorFromIconBtn) massDisableColorFromIconBtn.disabled = true;
  if (massColorFromIconStatus) {
    massColorFromIconStatus.textContent = "";
    massColorFromIconStatus.style.color = "";
  }

  try {
    const result = await applyMassTileColorFromIcon(enable);
    const totalUpdated = (result?.groupsUpdated || 0) + (result?.bookmarksUpdated || 0);
    if (massColorFromIconStatus) {
      const msgKey = enable ? "massColorFromIconActivated" : "massColorFromIconDeactivated";
      massColorFromIconStatus.textContent = `✅ ${t(msgKey)} (${totalUpdated})`;
    }
  } catch (err) {
    console.error("Mass color from icon action failed", err);
    if (massColorFromIconStatus) {
      massColorFromIconStatus.textContent = `❌ ${err?.message || "Error"}`;
    }
  } finally {
    if (massEnableColorFromIconBtn) massEnableColorFromIconBtn.disabled = false;
    if (massDisableColorFromIconBtn) massDisableColorFromIconBtn.disabled = false;
  }
}

export function initAppearanceSettings() {
  if (bgImageInput) {
    bgImageInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const base64Data = await downscaleBackgroundImage(file);
        const draft = await ensureAppearanceDraft();
        draft.backgroundImage = base64Data;
        draft.backgroundImageUrl = "";
        if (bgImageUrlInput) bgImageUrlInput.value = "";
        setBackgroundUrlStatusMessage("");

        setBgPreviewImage(base64Data);

        await applyBackground({ appearance: { ...draft } });
        markSettingsDirty();
      } catch (error) {
        alert("Failed to load image: " + (error?.message || "Invalid image"));
        console.error("Image load error", error);
      } finally {
        bgImageInput.value = "";
      }
    });
  }

  if (bgImageUrlApply) {
    bgImageUrlApply.addEventListener("click", () => {
      void applyBackgroundFromUrlInput();
    });
  }

  if (bgImageUrlInput) {
    bgImageUrlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void applyBackgroundFromUrlInput();
      }
    });
  }

  if (bgRemoveBtn) {
    bgRemoveBtn.addEventListener("click", async () => {
      if (!confirm(t("confirmRemoveBackgroundImage") || "Are you sure you want to remove the background image?")) {
        return;
      }

      const draft = await ensureAppearanceDraft();
      draft.backgroundImage = null;
      draft.backgroundImageUrl = "";

      setBgPreviewImage(null);
      if (bgImageInput) bgImageInput.value = "";
      if (bgImageUrlInput) bgImageUrlInput.value = "";
      setBackgroundUrlStatusMessage("");

      await applyBackground({ appearance: { ...draft } });
      markSettingsDirty();
    });
  }

  if (bgDimSlider) {
    bgDimSlider.addEventListener("input", async (e) => {
      const value = Number(e.target.value) || 0;
      if (bgDimValue) bgDimValue.textContent = `${value}%`;
      const dimValue = value / 100;
      document.body.style.setProperty("--bg-dim", dimValue);

      const draft = await ensureAppearanceDraft();
      draft.bgDim = dimValue;
      markSettingsDirty();
    });
  }

  if (resetAppearanceBtn) {
    resetAppearanceBtn.addEventListener("click", async () => {
      if (!confirm(t("confirmResetAppearance") || "Reset all appearance settings to defaults?")) {
        return;
      }

      const existingCustomWidgets = Array.isArray(settingsState.appearanceDraft?.customWidgets)
        ? settingsState.appearanceDraft.customWidgets
        : ((await loadConfig()).appearance?.customWidgets || []);
      const disabledCustomWidgets = existingCustomWidgets.map(w => ({ ...w, space: "disabled" }));

      settingsState.appearanceDraft = createAppearanceDraftFromConfig({
        appearance: {
          ...defaultConfig.appearance,
          customWidgets: disabledCustomWidgets,
          widgetOrder: normalizeWidgetOrder(defaultConfig.appearance.widgetOrder, disabledCustomWidgets)
        }
      });
      settingsState.appearancePreviewUrlCss = "";
      settingsState.appearancePreviewUrlTarget = "";
      setThemeStatusMessage("");

      syncAppearanceControlsFromDraft(settingsState.appearanceDraft);

      const previewConfig = { appearance: { ...settingsState.appearanceDraft } };
      await applyThemeStyle(previewConfig);
      await applyBackground(previewConfig);
      await applyBgDim(previewConfig);
      await applyTileOpacity(previewConfig);
      await applyBarOpacity(previewConfig);
      await applyTileSize(previewConfig);
      await applyGroupTileSize(previewConfig);
      await applySideSpaces(previewConfig);
      updateDateTimeVisibility(true);
      await render();
      calculateGridLayout();
      markSettingsDirty();
    });
  }

  if (bgSizeSelect) {
    bgSizeSelect.addEventListener("change", async () => {
      if (!settingsState.appearanceDraft) {
        const config = await loadConfig();
        settingsState.appearanceDraft = {
          backgroundImage: config.appearance?.backgroundImage ?? null,
          backgroundSize: config.appearance?.backgroundSize || "stretched",
          tileOpacity: config.appearance?.tileOpacity ?? 1,
          showDateTime: config.appearance?.showDateTime ?? true,
          showDeleted: config.appearance?.showDeleted ?? false
        };
      }
      settingsState.appearanceDraft.backgroundSize = bgSizeSelect.value || "stretched";

      await applyBackground({ appearance: { ...settingsState.appearanceDraft } });
      markSettingsDirty();
    });
  }

  if (themeSelect) {
    themeSelect.addEventListener("change", async () => {
      const draft = await ensureAppearanceDraft();
      draft.theme = themeSelect.value || "default";
      updateThemeCustomRowsVisibility(draft.theme);
      setThemeStatusMessage("");

      const previewOptions = { persistCache: false };
      const currentUrl = (draft.customThemeUrl || "").trim();
      if (draft.theme === "custom-url" && settingsState.appearancePreviewUrlCss && settingsState.appearancePreviewUrlTarget === currentUrl) {
        previewOptions.previewUrlCss = settingsState.appearancePreviewUrlCss;
      }

      await applyThemeStyle({ appearance: { ...draft } }, previewOptions);
      markSettingsDirty();
    });
  }

  if (themeCssFileInput) {
    themeCssFileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const cssText = typeof ev.target?.result === "string" ? ev.target.result : "";
          if (!cssText.trim()) {
            setThemeStatusMessage("❌ Theme CSS file is empty", true);
            return;
          }

          const draft = await ensureAppearanceDraft();
          draft.theme = "custom-file";
          draft.customThemeCss = cssText;
          draft.customThemeFileName = file.name || "custom.css";

          if (themeSelect) themeSelect.value = "custom-file";
          if (themeCssFileName) themeCssFileName.textContent = draft.customThemeFileName;
          updateThemeCustomRowsVisibility("custom-file");

          await applyThemeStyle({ appearance: { ...draft } }, { persistCache: false });
          setThemeStatusMessage(`✅ ${draft.customThemeFileName}`);
          markSettingsDirty();
        } catch (error) {
          setThemeStatusMessage("❌ " + (error?.message || "Failed to load CSS file"), true);
          console.error("Theme CSS load error", error);
        } finally {
          themeCssFileInput.value = "";
        }
      };

      reader.onerror = () => {
        setThemeStatusMessage("❌ Failed to read CSS file", true);
        themeCssFileInput.value = "";
      };

      reader.readAsText(file);
    });
  }

  if (themeCssUrlApply) {
    themeCssUrlApply.addEventListener("click", () => {
      void handleApplyThemeUrlPreview();
    });
  }

  if (themeCssUrlInput) {
    themeCssUrlInput.addEventListener("input", () => {
      const enteredUrl = themeCssUrlInput.value.trim();
      if (settingsState.appearanceDraft) {
        settingsState.appearanceDraft.customThemeUrl = enteredUrl;
      }
      if (settingsState.appearancePreviewUrlTarget !== enteredUrl) {
        settingsState.appearancePreviewUrlCss = "";
      }
    });
    themeCssUrlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleApplyThemeUrlPreview();
      }
    });
  }

  if (tileOpacitySlider) {
    tileOpacitySlider.addEventListener("input", (e) => {
      const value = e.target.value;
      if (tileOpacityValue) tileOpacityValue.textContent = `${value}%`;
      const opacityValue = value / 100;
      document.body.style.setProperty("--tile-opacity", opacityValue);

      if (settingsState.appearanceDraft) {
        settingsState.appearanceDraft.tileOpacity = opacityValue;
      }
      markSettingsDirty();
    });
  }

  if (barOpacitySlider) {
    barOpacitySlider.addEventListener("input", (e) => {
      const value = e.target.value;
      if (barOpacityValue) barOpacityValue.textContent = `${value}%`;
      const opacityValue = value / 100;
      document.body.style.setProperty("--bar-opacity", opacityValue);

      if (settingsState.appearanceDraft) {
        settingsState.appearanceDraft.barOpacity = opacityValue;
      }
      markSettingsDirty();
    });
  }

  if (tileSizeSlider) {
    tileSizeSlider.addEventListener("input", (e) => {
      const value = e.target.value;
      if (tileSizeValue) tileSizeValue.textContent = `${value}%`;
      const sizeValue = value / 100;
      document.body.style.setProperty("--tile-scale", sizeValue);
      calculateGridLayout();

      if (settingsState.appearanceDraft) {
        settingsState.appearanceDraft.tileSize = sizeValue;
      }
      markSettingsDirty();
    });
  }

  if (groupTileSizeSlider) {
    groupTileSizeSlider.addEventListener("input", (e) => {
      const value = e.target.value;
      if (groupTileSizeValue) groupTileSizeValue.textContent = `${value}%`;
      const sizeValue = value / 100;
      document.body.style.setProperty("--group-tile-scale", sizeValue);
      renderGroups(true);
      calculateGridLayout();

      if (settingsState.appearanceDraft) {
        settingsState.appearanceDraft.groupTileSize = sizeValue;
      }
      markSettingsDirty();
    });
  }

  if (massEnableColorFromIconBtn) {
    massEnableColorFromIconBtn.addEventListener("click", () => {
      void handleMassColorFromIconAction(true);
    });
  }

  if (massDisableColorFromIconBtn) {
    massDisableColorFromIconBtn.addEventListener("click", () => {
      void handleMassColorFromIconAction(false);
    });
  }

  if (showDeletedBtn && showDeletedToggle) {
    showDeletedBtn.addEventListener("click", () => {
      showDeletedToggle.checked = !showDeletedToggle.checked;
      showDeletedToggle.dispatchEvent(new Event("change"));
      updateShowDeletedButtonAppearance();
    });
  }

  if (showDeletedToggle) {
    showDeletedToggle.addEventListener("change", () => {
      updateShowDeletedButtonAppearance();
    });
  }

  updateShowDeletedButtonAppearance();
}
