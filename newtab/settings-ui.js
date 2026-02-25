import { state, saveState } from "./state.js";
import { loadConfig, saveConfig, getSyncIntervalMs, DEFAULT_SYNC_INTERVAL } from "./config.js";
import { testSyncConnection, requestHostPermission, syncNow, cleanupDeletedItems, checkDeadLinks, syncWrite } from "./sync.js";
import { t, getCurrentLanguage } from "./i18n.js";
import { render } from "./render.js";

// ======================================================
// SETTINGS MODAL UI
// ======================================================

// ---------- DOM Elements ----------
const settingsModal = document.getElementById("settings-modal");
const settingsBtn = document.getElementById("settings-btn");
const showDeletedBtn = document.getElementById("show-deleted-btn");
const manualSyncBtn = document.getElementById("manual-sync-btn");
const settingsSaveBtn = document.getElementById("settings-save");
const settingsCancelBtn = document.getElementById("settings-cancel");

// Sync Tab Elements
const syncUrl = document.getElementById("sync-url");
const syncTest = document.getElementById("sync-test");
const syncEnable = document.getElementById("sync-enable");
const syncStatus = document.getElementById("sync-status");
const syncImmediate = document.getElementById("sync-immediate");
const syncCustom = document.getElementById("sync-custom");
const syncCustomValue = document.getElementById("sync-interval-value");
const syncManual = document.getElementById("sync-manual");
const syncNowBtn = document.getElementById("sync-now-btn");
const lastSyncInfo = document.getElementById("last-sync-info");

// Export/Import Elements
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");

// Appearance Elements
const showDeletedToggle = document.getElementById("show-deleted-toggle");
const languageSelect = document.getElementById("language-select");

// HouseKeeper Elements
const hkRetentionDays = document.getElementById("hk-retention-days");
const hkAutoCleanup = document.getElementById("hk-auto-cleanup");
const hkManualCleanup = document.getElementById("hk-manual-cleanup");
const hkCleanupStatus = document.getElementById("hk-cleanup-status");
const hkLastCleanup = document.getElementById("hk-last-cleanup");
const hkEnableLinkCheck = document.getElementById("hk-enable-link-check");
const hkHighlightDeadLinks = document.getElementById("hk-highlight-dead-links");
const hkCheckLinks = document.getElementById("hk-check-links");
const hkLinkCheckStatus = document.getElementById("hk-link-check-status");
const hkDeadLinksCount = document.getElementById("hk-dead-links-count");
const hkClearErrors = document.getElementById("hk-clear-errors");

// Tab System
const tabButtons = document.querySelectorAll(".settings-tab-btn");
const tabContents = document.querySelectorAll(".settings-tab-content");

// ---------- Tab Switching ----------
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;

    // Remove active class from all buttons and contents
    tabButtons.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));

    // Add active class to clicked button and corresponding content
    btn.classList.add("active");
    document.getElementById(`${tabName}-tab`).classList.add("active");
  });
});

// ---------- Open Settings Modal ----------
settingsBtn.addEventListener("click", async () => {
  const config = await loadConfig();

  // Load sync settings
  syncUrl.value = config.sync.serverUrl || "";
  syncEnable.checked = config.sync.enabled;

  // Load sync interval settings
  const intervalMode = config.sync.intervalMode || "default";
  if (intervalMode === "immediate") {
    syncImmediate.checked = true;
    syncCustomValue.disabled = true;
  } else if (intervalMode === "custom") {
    syncCustom.checked = true;
    syncCustomValue.disabled = false;
    syncCustomValue.value = config.sync.customIntervalMinutes || 60;
  } else {
    syncManual.checked = true;
    syncCustomValue.disabled = true;
  }

  // Update last sync info
  updateLastSyncInfo(config);

  // Update manual sync button visibility
  updateManualSyncButtonVisibility(config);
  
  // Update HouseKeeper UI
  updateHouseKeeperInfo(config);

  // Set current language in language select
  if (languageSelect) {
    languageSelect.value = getCurrentLanguage();
  }

  syncStatus.textContent = "";
  settingsModal.classList.remove("hidden");
});

// ---------- Close Settings Modal ----------
settingsCancelBtn.addEventListener("click", () => {
  settingsModal.classList.add("hidden");
});

// ---------- Sync Interval Radio Buttons ----------
syncImmediate.addEventListener("change", () => {
  syncCustomValue.disabled = true;
});

syncCustom.addEventListener("change", () => {
  syncCustomValue.disabled = false;
  syncCustomValue.focus();
});

syncManual.addEventListener("change", () => {
  syncCustomValue.disabled = true;
});

// ---------- Test Connection ----------
syncTest.addEventListener("click", async () => {
  const url = syncUrl.value.trim();

  if (!url) {
    syncStatus.textContent = t("fillUrl");
    return;
  }

  // Request host permission for the URL being tested
  const granted = await requestHostPermission(url);

  if (!granted) {
    syncStatus.textContent = "❌ " + t("permissionDenied");
    return;
  }

  // Test connection using the URL from input field
  syncStatus.textContent = "🔍 " + t("testingConnection");

  const ok = await testSyncConnection(url);

  if (ok) {
    syncStatus.textContent = "✅ " + t("serverResponds");
  } else {
    syncStatus.textContent = "❌ " + t("serverNotResponds");
  }
});

// ---------- Sync Now Button ----------
syncNowBtn.addEventListener("click", async () => {
  syncNowBtn.disabled = true;
  syncNowBtn.textContent = "⬆️ " + t("syncing");

  const success = await syncNow();

  if (success) {
    syncStatus.textContent = "✅ " + t("syncSuccessful");
  } else {
    syncStatus.textContent = "❌ " + t("syncFailed");
  }

  // Re-enable button after 2 seconds
  setTimeout(() => {
    syncNowBtn.disabled = false;
    syncNowBtn.textContent = "⬆️ " + t("syncNow");
    
    // Update last sync time
    loadConfig().then(config => updateLastSyncInfo(config));
  }, 2000);
});

// ---------- Export ----------
exportBtn.addEventListener("click", async () => {
  // Export a clean copy of state ensuring hasError flag is present on items
  const exportData = {
    groups: state.groups.map(g => ({
      id: g.id,
      name: g.name,
      updatedAt: g.updatedAt,
      deleted: g.deleted,
      deletedAt: g.deletedAt,
      items: (g.items || []).map(i => ({
        id: i.id,
        title: i.title,
        url: i.url,
        customIcon: i.customIcon || null,
        updatedAt: i.updatedAt,
        deleted: i.deleted || false,
        deletedAt: i.deletedAt || null,
        hasError: !!i.hasError
      }))
    }))
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `speeddial-backup-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

// ---------- Import ----------
importBtn.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const imported = JSON.parse(event.target.result);

      if (!imported.groups || !Array.isArray(imported.groups)) {
        alert("Invalid file format");
        return;
      }

      state.groups = imported.groups;
      await saveState();

      alert("Data imported successfully!");
      settingsModal.classList.add("hidden");
      // Re-render UI to show imported data
      window.location.reload();
    } catch (error) {
      alert("Failed to parse file: " + error.message);
    }
  };

  reader.readAsText(file);
});

// ---------- Save Settings ----------
settingsSaveBtn.addEventListener("click", async () => {
  const config = await loadConfig();

  // Save sync URL directly to config
  if (syncUrl.value.trim()) {
    config.sync.serverUrl = syncUrl.value.trim().replace(/\/$/, ""); // Remove trailing slash
  }

  // Save enable/disable state
  config.sync.enabled = syncEnable.checked;

  // Save sync interval mode
  if (syncImmediate.checked) {
    config.sync.intervalMode = "immediate";
  } else if (syncCustom.checked) {
    config.sync.intervalMode = "custom";
    config.sync.customIntervalMinutes = parseInt(syncCustomValue.value) || 60;
  } else {
    config.sync.intervalMode = "manual";
  }

  // Save HouseKeeper config
  config.housekeeper.retentionDays = parseInt(hkRetentionDays.value) || 30;
  config.housekeeper.autoCleanupEnabled = hkAutoCleanup.checked;
  config.housekeeper.enableLinkCheck = hkEnableLinkCheck.checked;
  config.housekeeper.highlightDeadLinks = hkHighlightDeadLinks ? !!hkHighlightDeadLinks.checked : true;

  // Single save operation
  await saveConfig(config);

  // Update manual sync button visibility based on new settings
  updateManualSyncButtonVisibility(config);

  // Apply highlight setting immediately
  try {
    render();
  } catch (e) {}

  settingsModal.classList.add("hidden");
});

// ---------- Show Deleted Button ----------
showDeletedBtn.addEventListener("click", () => {
  showDeletedToggle.checked = !showDeletedToggle.checked;
  showDeletedToggle.dispatchEvent(new Event("change"));
  
  // Update button appearance
  updateShowDeletedButtonAppearance();
});

function updateShowDeletedButtonAppearance() {
  if (showDeletedToggle.checked) {
    showDeletedBtn.style.opacity = "1";
    showDeletedBtn.style.transform = "scale(1.1)";
  } else {
    showDeletedBtn.style.opacity = "0.6";
    showDeletedBtn.style.transform = "scale(1)";
  }
}

// Initialize button appearance
updateShowDeletedButtonAppearance();

// ---------- HouseKeeper - Manual Cleanup ----------
if (hkManualCleanup) {
  hkManualCleanup.addEventListener("click", async () => {
    hkManualCleanup.disabled = true;
    hkCleanupStatus.textContent = "🔍 Cleaning...";
    hkCleanupStatus.style.color = "#999";

    try {
      const config = await loadConfig();
      const deletedCount = await cleanupDeletedItems(config.housekeeper.retentionDays);

      config.housekeeper.lastCleanup = Date.now();
      await saveConfig(config);

      hkCleanupStatus.textContent = `✅ Cleanup completed - ${deletedCount} records permanently deleted.`;
      hkCleanupStatus.style.color = "#4caf50";

      updateHouseKeeperInfo(config);
      render();
    } catch (error) {
      hkCleanupStatus.textContent = "❌ Cleanup failed";
      hkCleanupStatus.style.color = "#f44336";
      console.error("Cleanup error:", error);
    } finally {
      hkManualCleanup.disabled = false;
    }
  });
}

// ---------- HouseKeeper - Check Links ----------
if (hkCheckLinks) {
  hkCheckLinks.addEventListener("click", async () => {
    hkCheckLinks.disabled = true;
    hkLinkCheckStatus.textContent = "🔍 Checking links...";
    hkLinkCheckStatus.style.color = "#999";

    try {
      const config = await loadConfig();
      const deadLinkCount = await checkDeadLinks();

      config.housekeeper.lastLinkCheck = Date.now();
      await saveConfig(config);

      hkLinkCheckStatus.textContent = `✅ Link check completed.`;
      hkLinkCheckStatus.style.color = "#4caf50";
      hkDeadLinksCount.textContent = `Dead links found: ${deadLinkCount}`;

      render();
    } catch (error) {
      hkLinkCheckStatus.textContent = "❌ Link check failed";
      hkLinkCheckStatus.style.color = "#f44336";
      console.error("Link check error:", error);
    } finally {
      hkCheckLinks.disabled = false;
    }
  });
}

  // ---------- HouseKeeper - Clear Dead-Link Flags ----------
  if (hkClearErrors) {
    hkClearErrors.addEventListener('click', async () => {
      hkClearErrors.disabled = true;
      hkLinkCheckStatus.textContent = "🔄 Clearing dead-link flags...";
      hkLinkCheckStatus.style.color = "#999";

      try {
        let cleared = 0;
        let changed = false;

        for (const group of state.groups) {
          for (const item of group.items) {
            if (item.hasError) {
              item.hasError = false;
              item.updatedAt = Date.now();
              cleared++;
              changed = true;
            }
          }

          if (changed) {
            group.updatedAt = Date.now();
          }
        }

        if (changed) {
          await saveState();
          try { await syncWrite(); } catch (e) { console.warn('syncWrite failed', e); }
        }

        hkLinkCheckStatus.textContent = `✅ Cleared ${cleared} dead-link flags.`;
        hkLinkCheckStatus.style.color = "#4caf50";
        hkDeadLinksCount.textContent = `Dead links found: 0`;

        try { render(); } catch (e) {}
      } catch (error) {
        hkLinkCheckStatus.textContent = "❌ Clearing failed";
        hkLinkCheckStatus.style.color = "#f44336";
        console.error("Clear dead-link flags error:", error);
      } finally {
        hkClearErrors.disabled = false;
      }
    });
  }

// ---------- Manual Sync Button ----------
manualSyncBtn.addEventListener("click", async () => {
  manualSyncBtn.disabled = true;
  manualSyncBtn.textContent = "⬆️";
  manualSyncBtn.style.opacity = "0.5";

  const success = await syncNow();

  if (success) {
    manualSyncBtn.style.opacity = "1";
  }

  // Re-enable button after 2 seconds
  setTimeout(() => {
    manualSyncBtn.disabled = false;
    manualSyncBtn.style.opacity = "1";
  }, 2000);
});

function updateManualSyncButtonVisibility(config) {
  if (!manualSyncBtn) return;
  
  // Get current settings
  const isSyncEnabled = config && config.sync && config.sync.enabled;
  const intervalMode = config && config.sync ? (config.sync.intervalMode || "default") : "default";
  
  // Show button only if sync is enabled AND interval mode is "manual"
  const isManualMode = isSyncEnabled && intervalMode === "manual";
  
  console.log(`[Manual Sync] Enabled: ${isSyncEnabled}, Mode: ${intervalMode}, Show: ${isManualMode}`);
  
  if (isManualMode) {
    manualSyncBtn.classList.remove("hidden");
    console.log("[Manual Sync] Button shown");
  } else {
    manualSyncBtn.classList.add("hidden");
    console.log("[Manual Sync] Button hidden");
  }
}

// ---------- Helper Function ----------
function updateLastSyncInfo(config) {
  if (!config.sync.lastSync) {
    lastSyncInfo.textContent = "Never synced";
    return;
  }

  const lastSyncDate = new Date(config.sync.lastSync);
  const now = Date.now();
  const diffMs = now - config.sync.lastSync;
  const diffMins = Math.floor(diffMs / 60000);

  let timeStr = "";
  if (diffMins === 0) {
    timeStr = "just now";
  } else if (diffMins === 1) {
    timeStr = "1 minute ago";
  } else if (diffMins < 60) {
    timeStr = `${diffMins} minutes ago`;
  } else {
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) {
      timeStr = "1 hour ago";
    } else if (diffHours < 24) {
      timeStr = `${diffHours} hours ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) {
        timeStr = "1 day ago";
      } else {
        timeStr = `${diffDays} days ago`;
      }
    }
  }

  lastSyncInfo.textContent = `Last sync: ${timeStr}`;
}

function updateHouseKeeperInfo(config) {
  if (!hkRetentionDays) return;

  // Update retention days display
  hkRetentionDays.value = config.housekeeper.retentionDays || 30;

  // Update auto-cleanup checkbox
  if (hkAutoCleanup) {
    hkAutoCleanup.checked = config.housekeeper.autoCleanupEnabled || false;
  }

  // Update link check checkbox
  if (hkEnableLinkCheck) {
    hkEnableLinkCheck.checked = config.housekeeper.enableLinkCheck || false;
  }

  // Update highlight dead links checkbox
  if (hkHighlightDeadLinks) {
    // default to true when not present
    if (typeof config.housekeeper.highlightDeadLinks === 'boolean') {
      hkHighlightDeadLinks.checked = config.housekeeper.highlightDeadLinks;
    } else {
      hkHighlightDeadLinks.checked = true;
    }
  }

  // Update last cleanup timestamp
  if (config.housekeeper.lastCleanup) {
    const lastCleanupDate = new Date(config.housekeeper.lastCleanup);
    const now = Date.now();
    const diffMs = now - config.housekeeper.lastCleanup;
    const diffMins = Math.floor(diffMs / 60000);

    let timeStr = "";
    if (diffMins === 0) {
      timeStr = "just now";
    } else if (diffMins === 1) {
      timeStr = "1 minute ago";
    } else if (diffMins < 60) {
      timeStr = `${diffMins} minutes ago`;
    } else {
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours === 1) {
        timeStr = "1 hour ago";
      } else if (diffHours < 24) {
        timeStr = `${diffHours} hours ago`;
      } else {
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays === 1) {
          timeStr = "1 day ago";
        } else {
          timeStr = `${diffDays} days ago`;
        }
      }
    }

    if (hkLastCleanup) {
      hkLastCleanup.textContent = `Last cleanup: ${timeStr}`;
    }
  } else {
    if (hkLastCleanup) {
      hkLastCleanup.textContent = "Last cleanup: Never";
    }
  }
}

// ---------- Initialization ----------
async function initializeManualSyncButton() {
  if (!manualSyncBtn) {
    console.warn("Manual sync button not found in DOM");
    return;
  }
  
  const config = await loadConfig();
  updateManualSyncButtonVisibility(config);
  updateHouseKeeperInfo(config);
}

// Run initialization after a small delay to ensure DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeManualSyncButton);
} else {
  // DOM already loaded
  setTimeout(initializeManualSyncButton, 0);
}

// Re-render when highlight checkbox toggles so indicators show/hide immediately
if (hkHighlightDeadLinks) {
  hkHighlightDeadLinks.addEventListener('change', () => {
    try { render(); } catch (e) {}
  });
}

