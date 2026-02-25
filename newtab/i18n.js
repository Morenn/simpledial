// i18n loader: loads language JSON files from newtab/lang

const LANG_FILES = [
  { code: 'sk', name: 'Slovenčina', path: 'newtab/lang/sk.json' },
  { code: 'en', name: 'English', path: 'newtab/lang/en.json' }
];

const languages = {}; // keyed by code -> { code, name, texts }
let currentLanguage = 'en';

export function t(key) {
  const lang = languages[currentLanguage];
  if (lang && lang.texts && key in lang.texts) return lang.texts[key];
  return key;
}

export function setLanguage(lang) {
  if (languages[lang]) {
    currentLanguage = lang;
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

export async function initLanguage() {
  // Load all language files listed in LANG_FILES
  for (const entry of LANG_FILES) {
    try {
      const url = chrome && chrome.runtime ? chrome.runtime.getURL(entry.path) : entry.path;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load ' + entry.path);
      const json = await res.json();
      if (json && json.code) {
        languages[json.code] = json;
      } else if (entry.code) {
        // fallback
        languages[entry.code] = { code: entry.code, name: json.name || entry.code, texts: json.texts || json };
      }
    } catch (err) {
      console.warn('i18n: failed to load', entry.path, err);
    }
  }

  // Pick initial language from localStorage if available
  try {
    const saved = localStorage.getItem('speeddial-language');
    if (saved && languages[saved]) {
      currentLanguage = saved;
      document.documentElement.lang = saved;
      return;
    }
  } catch (e) {}

  // Ensure default exists
  if (!languages[currentLanguage] && Object.keys(languages).length > 0) {
    currentLanguage = Object.keys(languages)[0];
    document.documentElement.lang = currentLanguage;
  }
}