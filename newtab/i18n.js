// i18n loader: loads language JSON files

import { loadConfig } from "./config.js";

const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;

const LANG_FILES = [
  { code: 'en', name: 'English', path: '_locales/en/messages.json' },
  { code: 'sk', name: 'Slovenčina', path: '_locales/sk/messages.json' }
];

const languages = {};
const languageLoadPromises = {};
let currentLanguage = 'en';
let useNative = false; // Keep false: chrome.i18n can stay stale until full extension reload during development.
let i18nHotReloadEnabled = false;

function normalizeMessageText(value) {
  if (typeof value !== 'string') return value;
  // Handle both real newlines and literal "\\n" sequences consistently.
  return value.replace(/\\n/g, '\n');
}

function getLanguageEntry(code) {
  return LANG_FILES.find(entry => entry.code === code) || null;
}

async function loadLanguageFile(code) {
  const entry = getLanguageEntry(code);
  if (!entry) return false;
  if (languages[code]) return true;

  if (languageLoadPromises[code]) {
    return languageLoadPromises[code];
  }

  languageLoadPromises[code] = (async () => {
    try {
      const baseUrl = runtime.getURL(entry.path);
      const url = i18nHotReloadEnabled ? `${baseUrl}?v=${Date.now()}` : baseUrl;
      const fetchOptions = i18nHotReloadEnabled ? { cache: 'no-store' } : {};
      const res = await fetch(url, fetchOptions);
      if (!res.ok) throw new Error('Failed to load ' + entry.path);

      const json = await res.json();
      const texts = {};
      for (const key of Object.keys(json)) {
        const item = json[key];
        if (item && typeof item.message === 'string') {
          texts[key] = item.message;
        }
      }

      languages[entry.code] = {
        code: entry.code,
        name: entry.name,
        texts
      };
      return true;
    } catch (err) {
      console.warn('i18n: failed to load', entry.path, err);
      return false;
    }
  })();

  const loaded = await languageLoadPromises[code];
  if (!loaded) {
    delete languageLoadPromises[code];
  }
  return loaded;
}

// --- Translation function ---
export function t(key) {
  if (useNative && chrome?.i18n?.getMessage) {
    const msg = chrome.i18n.getMessage(key);
    if (msg) return normalizeMessageText(msg);
  }

  const lang = languages[currentLanguage];
  if (lang?.texts?.[key]) return normalizeMessageText(lang.texts[key]);

  const english = languages.en;
  if (english?.texts?.[key]) return normalizeMessageText(english.texts[key]);

  return key;
}

// --- Set language ---
export async function setLanguage(lang) {
  const loaded = await loadLanguageFile(lang);
  if (!loaded) return false;

  currentLanguage = lang;

  // User explicitly chose a language → disable chrome.i18n
  useNative = false;

  try { localStorage.setItem('speeddial-language', lang); } catch (e) {}
  document.documentElement.lang = lang;
  return true;
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function getAvailableLanguages() {
  return LANG_FILES.map(e => ({ code: e.code, name: e.name }));
}

// --- Initialize language system ---
export async function initLanguage() {
  try {
    const config = await loadConfig();
    i18nHotReloadEnabled = !!config?.advanced?.i18nHotReload;
  } catch {
    i18nHotReloadEnabled = false;
  }

  // 1) Saved language has priority
  let targetLanguage = 'en';
  let hasUserOverride = false;

  try {
    const saved = localStorage.getItem('speeddial-language');
    if (saved && getLanguageEntry(saved)) {
      targetLanguage = saved;
      hasUserOverride = true;
    }
  } catch (e) {}

  if (!hasUserOverride) {
    // 2) Browser language detection
    const browserLang = (navigator.language || navigator.userLanguage || 'en')
      .split('-')[0]
      .toLowerCase();

    targetLanguage = getLanguageEntry(browserLang) ? browserLang : 'en';
  }

  const loadedTarget = await loadLanguageFile(targetLanguage);
  if (!loadedTarget && targetLanguage !== 'en') {
    await loadLanguageFile('en');
    targetLanguage = 'en';
  }

  currentLanguage = targetLanguage;
  useNative = false;
  document.documentElement.lang = currentLanguage;

  // Keep english cached for stable fallback after first load.
  if (currentLanguage !== 'en' && !languages.en) {
    void loadLanguageFile('en');
  }
}

export async function resetLanguageToBrowser() {
  // Get browser language (e.g., "de-DE" → "de")
  const browserLang = (navigator.language || navigator.userLanguage || 'en')
    .split('-')[0]
    .toLowerCase();

  const targetLanguage = getLanguageEntry(browserLang) ? browserLang : 'en';
  const loaded = await loadLanguageFile(targetLanguage);
  if (!loaded && targetLanguage !== 'en') {
    await loadLanguageFile('en');
  }

  // If we have a translation for this language → use it
  if (languages[targetLanguage]) {
    currentLanguage = targetLanguage;
  } else {
    // Otherwise fallback to English
    currentLanguage = 'en';
  }

  // Reset: enable chrome.i18n if it exists
  useNative = false;

  // Clear any saved override so future loads keep following the browser
  // language automatically, instead of re-pinning it as an explicit choice
  try {
    localStorage.removeItem('speeddial-language');
  } catch (e) {}

  // Set <html lang="xx">
  document.documentElement.lang = currentLanguage;
}