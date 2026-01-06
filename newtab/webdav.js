import { encryptText, decryptText } from "./crypto.js";
import { state, saveState } from "./state.js";

export async function saveWebdavConfig({ url, username, password }) {
  const trimmed = url.replace(/\/+$/, "");
  const cfg = { url: trimmed, username };

  if (password) cfg.passwordEnc = await encryptText(password);

  await chrome.storage.local.set({ webdavConfig: cfg });
}

export async function loadWebdavConfig() {
  const { webdavConfig } = await chrome.storage.local.get("webdavConfig");
  if (!webdavConfig) return null;

  return {
    url: webdavConfig.url,
    username: webdavConfig.username,
    password: webdavConfig.passwordEnc ? await decryptText(webdavConfig.passwordEnc) : ""
  };
}

export async function testWebdavConnection(url, username, password) {
  try {
    const res = await fetch(url.replace(/\/+$/, ""), {
      method: "PROPFIND",
      headers: {
        "Authorization": "Basic " + btoa(username + ":" + password),
        "Depth": "0"
      }
    });

    return res.ok || res.status === 207 || res.status === 401;
  } catch {
    return false;
  }
}

export async function webdavRead() {
  const cfg = await loadWebdavConfig();
  if (!cfg) return null;

  const res = await fetch(cfg.url + "/speeddial.json", {
    method: "GET",
    headers: {
      "Authorization": "Basic " + btoa(cfg.username + ":" + cfg.password)
    }
  });

  if (res.status === 404) return null;
  if (!res.ok) return null;

  return await res.json();
}

export async function webdavWrite(state) {
  const cfg = await loadWebdavConfig();
  if (!cfg) return;

  await fetch(cfg.url + "/speeddial.json", {
    method: "PUT",
    headers: {
      "Authorization": "Basic " + btoa(cfg.username + ":" + cfg.password),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(state, null, 2)
  });
}

export function startWebdavSync() {
  setInterval(async () => {
    if (!state.sync.enabled) return;

    const cloud = await webdavRead();
    if (cloud) {
      Object.assign(state, cloud);
      await saveState();
    }

    await webdavWrite(state);
    state.sync.lastSync = Date.now();
    await saveState();
  }, 60000);
}
