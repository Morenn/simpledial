import { state, saveState } from "./state.js";
import { loadWebdavConfig, saveWebdavConfig, testWebdavConnection } from "./webdav.js";

// ---------- DOM prvky ----------
const webdavModal = document.getElementById("webdav-modal");
const webdavUrl = document.getElementById("webdav-url");
const webdavUser = document.getElementById("webdav-username");
const webdavPass = document.getElementById("webdav-password");
const webdavTest = document.getElementById("webdav-test");
const webdavEnable = document.getElementById("webdav-enable");
const webdavStatus = document.getElementById("webdav-status");
const webdavSave = document.getElementById("webdav-save");
const webdavCancel = document.getElementById("webdav-cancel");
const webdavBtn = document.getElementById("webdav-settings-btn");

// ---------- Otvorenie modálu ----------
webdavBtn.addEventListener("click", async () => {
  const cfg = await loadWebdavConfig();

  if (cfg) {
    webdavUrl.value = cfg.url || "";
    webdavUser.value = cfg.username || "";
    webdavPass.value = ""; // heslo nikdy nezobrazujeme
  } else {
    webdavUrl.value = "";
    webdavUser.value = "";
    webdavPass.value = "";
  }

  webdavEnable.checked = state.sync.enabled;
  webdavStatus.textContent = "";

  webdavModal.classList.remove("hidden");
});

// ---------- Zatvorenie modálu ----------
webdavCancel.addEventListener("click", () => {
  webdavModal.classList.add("hidden");
});

// ---------- Test pripojenia ----------
webdavTest.addEventListener("click", async () => {
  const url = webdavUrl.value.trim();
  const user = webdavUser.value.trim();
  const pass = webdavPass.value;

  // 🔥 VALIDÁCIA – ak chýbajú údaje, test sa ani nespustí
  if (!url || !user || !pass) {
    webdavStatus.textContent = "❌ Vyplň URL, používateľa aj heslo.";
    return;
  }

  webdavStatus.textContent = "🔍 Testujem pripojenie...";

  const ok = await testWebdavConnection(url, user, pass);

  if (ok) {
    webdavStatus.textContent = "✅ WebDAV pripojenie OK.";
  } else {
    webdavStatus.textContent = "❌ WebDAV server neodpovedá alebo údaje nesedia.";
  }
});

// ---------- Uloženie konfigurácie ----------
webdavSave.addEventListener("click", async () => {
  await saveWebdavConfig({
    url: webdavUrl.value.trim(),
    username: webdavUser.value.trim(),
    password: webdavPass.value || null
  });

  state.sync.enabled = webdavEnable.checked;
  await saveState();

  webdavModal.classList.add("hidden");
});
