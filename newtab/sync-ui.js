import { state, saveState } from "./state.js";
import { loadSyncConfig, saveSyncConfig, testSyncConnection, requestHostPermission } from "./sync.js";

// ---------- DOM prvky ----------
const syncModal = document.getElementById("sync-modal");
const syncUrl = document.getElementById("sync-url");
const syncTest = document.getElementById("sync-test");
const syncEnable = document.getElementById("sync-enable");
const syncStatus = document.getElementById("sync-status");
const syncSave = document.getElementById("sync-save");
const syncCancel = document.getElementById("sync-cancel");
const syncBtn = document.getElementById("sync-settings-btn");

// ---------- Otvorenie modálu ----------
syncBtn.addEventListener("click", async () => {
  const cfg = await loadSyncConfig();

  if (cfg) {
    syncUrl.value = cfg.url || "";
  } else {
    syncUrl.value = "";
  }

  syncEnable.checked = state.sync.enabled;
  syncStatus.textContent = "";

  syncModal.classList.remove("hidden");
});

// ---------- Zatvorenie modálu ----------
syncCancel.addEventListener("click", () => {
  syncModal.classList.add("hidden");
});

// ---------- Test pripojenia ----------
syncTest.addEventListener("click", async () => {
  const url = syncUrl.value.trim();

  if (!url) {
    syncStatus.textContent = "❌ Vyplň URL.";
    return;
  }

  // 1) Požiadať o povolenie
  const granted = await requestHostPermission(url);

  if (!granted) {
    syncStatus.textContent = "❌ Povolenie odmietnuté. Nie je možné otestovať spojenie.";
    return;
  }

  // 2) Test spojenia
  syncStatus.textContent = "🔍 Testujem pripojenie...";

  const ok = await testSyncConnection(url);

  if (ok) {
    syncStatus.textContent = "✅ Sync server odpovedá.";
  } else {
    syncStatus.textContent = "❌ Sync server neodpovedá.";
  }
});

// ---------- Uloženie konfigurácie ----------
syncSave.addEventListener("click", async () => {
  await saveSyncConfig({
    url: syncUrl.value.trim()
  });

  state.sync.enabled = syncEnable.checked;
  await saveState();

  syncModal.classList.add("hidden");
});
