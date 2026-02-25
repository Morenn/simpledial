// ======================================================
// LANGUAGE SYSTEM
// ======================================================

const languages = {
  sk: {
    // UI Elements
    searchPlaceholder: "Hľadať...",
    themeToggle: "Prepnúť tému",
    settings: "⚙️ Nastavenia",
    showDeleted: "Zobraziť zmazané",
    newGroupName: "Názov novej skupiny:",

    // Context Menu
    edit: "Upraviť",
    delete: "Zmazať",
    restore: "Obnoviť",
    refreshIcon: "Obnoviť ikonu",

    // Modals
    newBookmark: "Nová záložka",
    editBookmark: "Upraviť záložku",
    bookmarkTitle: "Názov",
    bookmarkUrl: "URL",
    bookmarkIcon: "URL ikony (voliteľné)",
    save: "Uložiť",
    cancel: "Zrušiť",

    // Sync Modal
    syncServer: "Sync Server",
    serverUrl: "Server URL",
    testConnection: "🔍 Testovať pripojenie",
    enableSync: "🔄 Zapnúť synchronizáciu",
    saveSettings: "💾 Uložiť",
    close: "❌ Zavrieť",

    // Sync Status Messages
    fillUrl: "❌ Vyplň URL.",
    permissionDenied: "❌ Povolenie odmietnuté. Nie je možné otestovať spojenie.",
    testingConnection: "🔍 Testujem pripojenie...",
    serverResponds: "✅ Sync server odpovedá.",
    serverNotResponds: "❌ Sync server neodpovedá.",
    syncServerUnavailable: "⚠️ Sync server nie je dostupný. Používam lokálne údaje.",

    // Settings Modal
    synchronization: "🔄 Synchronizácia",
    exportImport: "📤 Export/Import",
    syncConfiguration: "Nastavenie synchronizácie",
    syncInterval: "Interval synchronizácie",
    immediateSyncWarning: "Okamžitá synchronizácia (po každej zmene)",
    customInterval: "Vlastný interval (minúty):",
    manualSyncOnly: "Iba manuálna synchronizácia",
    syncNow: "⬆️ Syncovať teraz",
    lastSync: "Posledná synchronizácia:",
    syncSuccessful: "✅ Synchronizované úspešne!",
    syncFailed: "❌ Synchronizácia zlyhala",
    exportDescription: "Exportovať záložky ako JSON súbor",
    importDescription: "Importovať záložky z JSON súboru",
    importedSuccessfully: "Údaje boli importované úspešne!",
    invalidFileFormat: "Neplatný formát súboru",
    failedToParse: "Nepodarilo sa spracovať súbor:",

    // Empty States
    noActiveGroup: "Žiadna skupina nie je aktívna.",

    // Language
    language: "Jazyk",
    slovak: "Slovenčina",
    english: "English"
  },

  en: {
    // UI Elements
    searchPlaceholder: "Search...",
    themeToggle: "Toggle theme",
    settings: "⚙️ Settings",
    showDeleted: "Show deleted",
    newGroupName: "New group name:",

    // Context Menu
    edit: "Edit",
    delete: "Delete",
    restore: "Restore",
    refreshIcon: "Refresh icon",

    // Modals
    newBookmark: "New bookmark",
    editBookmark: "Edit bookmark",
    bookmarkTitle: "Title",
    bookmarkUrl: "URL",
    bookmarkIcon: "Icon URL (optional)",
    save: "Save",
    cancel: "Cancel",

    // Sync Modal
    syncServer: "Sync Server",
    serverUrl: "Server URL",
    testConnection: "🔍 Test connection",
    enableSync: "🔄 Enable synchronization",
    saveSettings: "💾 Save",
    close: "❌ Close",

    // Sync Status Messages
    fillUrl: "❌ Fill in URL.",
    permissionDenied: "❌ Permission denied. Cannot test connection.",
    testingConnection: "🔍 Testing connection...",
    serverResponds: "✅ Sync server responds.",
    serverNotResponds: "❌ Sync server does not respond.",
    syncServerUnavailable: "⚠️ Sync server is unavailable. Using local data.",

    // Settings Modal
    synchronization: "🔄 Synchronization",
    exportImport: "📤 Export/Import",
    syncConfiguration: "Sync Configuration",
    syncInterval: "Sync Interval",
    immediateSyncWarning: "Immediate sync (not recommended - can wear out SSD)",
    customInterval: "Custom interval (minutes):",
    manualSyncOnly: "Manual sync only",
    syncNow: "⬆️ Sync now",
    lastSync: "Last sync:",
    syncSuccessful: "✅ Synced successfully!",
    syncFailed: "❌ Sync failed",
    exportDescription: "Export bookmarks as JSON file",
    importDescription: "Import bookmarks from JSON file",
    importedSuccessfully: "Data imported successfully!",
    invalidFileFormat: "Invalid file format",
    failedToParse: "Failed to parse file:",

    // Empty States
    noActiveGroup: "No group is active.",

    // Language
    language: "Language",
    slovak: "Slovenčina",
    english: "English"
  }
};

// Current language
let currentLanguage = 'sk';

// Get translation
export function t(key) {
  return languages[currentLanguage][key] || key;
}

// Set language
export function setLanguage(lang) {
  if (languages[lang]) {
    currentLanguage = lang;
    // Save to localStorage
    localStorage.setItem('speeddial-language', lang);
    // Update document language
    document.documentElement.lang = lang;
    return true;
  }
  return false;
}

// Get current language
export function getCurrentLanguage() {
  return currentLanguage;
}

// Initialize language from localStorage
export function initLanguage() {
  const saved = localStorage.getItem('speeddial-language');
  if (saved && languages[saved]) {
    currentLanguage = saved;
    document.documentElement.lang = saved;
  }
}

// Get available languages
export function getAvailableLanguages() {
  return Object.keys(languages);
}