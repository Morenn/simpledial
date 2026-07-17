// i18n loader: loads language JSON files

const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;

const LANG_FILES = [
  { code: 'en', name: 'English', path: '_locales/en/messages.json' },
  { code: 'sk', name: 'Slovenčina', path: '_locales/sk/messages.json' }
];

const languages = {};
let currentLanguage = 'en';
let useNative = false; // chrome.i18n mode

// --- Translation function ---
export function t(key) {
  if (useNative && chrome?.i18n?.getMessage) {
    const msg = chrome.i18n.getMessage(key);
    if (msg) return msg;
  }

  const lang = languages[currentLanguage];
  if (lang?.texts?.[key]) return lang.texts[key];

  return key;
}

// --- Set language ---
export function setLanguage(lang) {
  if (languages[lang]) {
    currentLanguage = lang;

    // User explicitly chose a language → disable chrome.i18n
    useNative = false;

    try { localStorage.setItem('speeddial-language', lang); } catch (e) {}
    document.documentElement.lang = lang;
    return true;
  }
  return false;
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function getAvailableLanguages() {
  return LANG_FILES.map(e => ({ code: e.code, name: e.name }));
}

// --- Initialize language system ---
export async function initLanguage() {
  // Load JSON files manually (Firefox + fallback)
  for (const entry of LANG_FILES) {
    try {
      const url = runtime.getURL(entry.path);
      const res = await fetch(url);
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

    } catch (err) {
      console.warn('i18n: failed to load', entry.path, err);
    }
  }

  // 1) Saved language has priority
  try {
    const saved = localStorage.getItem('speeddial-language');
    if (saved && languages[saved]) {
      currentLanguage = saved;
      useNative = false; // user override
      document.documentElement.lang = saved;
      return;
    }
  } catch (e) {}

  // 2) Browser language detection
  const browserLang = (navigator.language || navigator.userLanguage || 'en')
    .split('-')[0]
    .toLowerCase();

  if (languages[browserLang]) {
    currentLanguage = browserLang;
  } else {
    currentLanguage = 'en';
  }

  // Only use chrome.i18n if user did NOT override language
  useNative = chrome?.i18n?.getMessage ? true : false;

  document.documentElement.lang = currentLanguage;
}

export function resetLanguageToBrowser() {
  // Get browser language (e.g., "de-DE" → "de")
  const browserLang = (navigator.language || navigator.userLanguage || 'en')
    .split('-')[0]
    .toLowerCase();

  // If we have a translation for this language → use it
  if (languages[browserLang]) {
    currentLanguage = browserLang;
  } else {
    // Otherwise fallback to English
    currentLanguage = 'en';
  }

  // Reset: enable chrome.i18n if it exists
  useNative = chrome?.i18n?.getMessage ? true : false;

  // Clear any saved override so future loads keep following the browser
  // language automatically, instead of re-pinning it as an explicit choice
  try {
    localStorage.removeItem('speeddial-language');
  } catch (e) {}

  // Set <html lang="xx">
  document.documentElement.lang = currentLanguage;
}