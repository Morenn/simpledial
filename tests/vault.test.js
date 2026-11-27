import test from "node:test";
import assert from "node:assert/strict";

// Stub browser/chrome session storage + minimal DOM for rest-status-widget import
const sessionStore = new Map();
globalThis.chrome = {
  i18n: { getMessage: k => k },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    },
    session: {
      get: async key => ({ [key]: sessionStore.get(key) }),
      set: async obj => {
        for (const [k, v] of Object.entries(obj)) sessionStore.set(k, v);
      },
      remove: async key => {
        sessionStore.delete(key);
      }
    }
  }
};
globalThis.document = {
  documentElement: { style: { setProperty() {} }, dataset: {} },
  createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {} }),
  getElementById: () => null,
  querySelectorAll: () => []
};

const cryptoMod = await import("../newtab/crypto.js");
const { fetchAndEvaluateRestWidget } = await import("../newtab/widgets/rest-status-widget.js");
const { fetchWeatherWidget } = await import("../newtab/widgets/weather-widget.js");
const {
  CALENDAR_CACHE_KEY,
  CALENDAR_SECRETS_KEY,
  saveWebcalSecretUrl,
  loadWebcalSecretUrl,
  deleteWebcalSecretUrl,
  fetchWebcalSource,
  normalizeCalendarSources,
  readCalendarCacheMap,
  removeCalendarSourceCache,
  updateCalendarCacheMap,
} = await import("../newtab/calendar-sources.js");
const {
  saveCaldavCredentials,
  loadCaldavCredentials,
  deleteCaldavCredentials,
} = await import("../newtab/calendar-caldav.js");
const { collectVaultEncryptedItems } = await import("../newtab/vault-items.js");

test("crypto vault setup, setSecret/getSecret with AAD, lock, session auto-unlock, wrong password, and password change", async () => {
  await cryptoMod.lockVault();
  sessionStore.clear();

  assert.equal(await cryptoMod.tryAutoUnlockVault(null), false);

  // setSecret without unlocked vault passes plaintext unless requireVault is set
  assert.equal(await cryptoMod.setSecret("plain-tok", "widget:w0:authHeaderValue"), "plain-tok");
  await assert.rejects(
    () => cryptoMod.setSecret("plain-tok", "widget:w0:authHeaderValue", { requireVault: true }),
    /VAULT_LOCKED/
  );

  // Password policy validation & expiration checks
  assert.equal(cryptoMod.validateVaultPassword("a").valid, false);
  assert.equal(cryptoMod.validateVaultPassword("12345678").valid, false);
  assert.equal(cryptoMod.validateVaultPassword("abcdefg1").valid, false);
  assert.equal(cryptoMod.validateVaultPassword("Abc123").valid, false);
  assert.equal(cryptoMod.validateVaultPassword("Abcdef12").valid, true);
  assert.equal(cryptoMod.resolveVaultKdf("PBKDF2-SHA512", 1).iterations, 210000);
  assert.equal(cryptoMod.resolveVaultKdf("PBKDF2-SHA256", 100).iterations, 600000);
  assert.equal(cryptoMod.resolveVaultKdf("PBKDF2-SHA512", 300000).iterations, 300000);
  assert.equal(cryptoMod.validateVaultPassword("a1".repeat(257)).valid, false);
  assert.equal(cryptoMod.validateVaultPassword("a1".repeat(257)).errors[0].code, "maxLength");
  await assert.rejects(() => cryptoMod.setupVault("a"), /PASSWORD_POLICY_FAILED/);
  await assert.rejects(() => cryptoMod.setupVault("a1".repeat(257)), /PASSWORD_POLICY_FAILED/);

  const header = await cryptoMod.setupVault("Correct-horse-1");
  assert.equal(header.v, 1);
  assert.equal(header.kdf, "PBKDF2-SHA512");
  assert.equal(header.iterations, 210000);
  assert.ok(Number.isFinite(header.passwordChangedAt));
  assert.equal(cryptoMod.isVaultPasswordExpired(header, header.passwordChangedAt + 1000), false);
  assert.equal(cryptoMod.isVaultPasswordExpired(header, header.passwordChangedAt + 91 * 86400 * 1000), true);
  assert.equal(cryptoMod.isVaultPasswordExpired({ check: header.check }), true);
  assert.equal(cryptoMod.isVaultPasswordExpired(header), false);
  assert.equal(cryptoMod.getVaultPasswordDaysRemaining(header, header.passwordChangedAt + 1000), 90);
  assert.equal(cryptoMod.getVaultPasswordDaysRemaining(header, header.passwordChangedAt + 91 * 86400 * 1000), 0);
  assert.equal(cryptoMod.getVaultPasswordDaysRemaining({ check: header.check }), 0);
  assert.equal(cryptoMod.isVaultUnlocked(), true);
  assert.ok(sessionStore.has("sd_vk"));

  const encToken = await cryptoMod.setSecret("PVEAPIToken=root@pam!t=secret", "widget:w1:authHeaderValue");
  assert.equal(cryptoMod.isEncryptedSecret(encToken), true);

  const got = await cryptoMod.getSecret(encToken, "widget:w1:authHeaderValue");
  assert.deepEqual(got, {
    ok: true,
    value: "PVEAPIToken=root@pam!t=secret",
    encrypted: true,
    locked: false,
    error: null
  });

  // Context mismatch (AAD) must fail decryption cleanly via getSecret
  const wrongCtx = await cryptoMod.getSecret(encToken, "widget:w2:authHeaderValue");
  assert.equal(wrongCtx.ok, false);
  assert.equal(wrongCtx.error, "DECRYPT_FAILED");

  // Locking clears both memory and session storage
  await cryptoMod.lockVault();
  assert.equal(cryptoMod.isVaultUnlocked(), false);
  assert.equal(sessionStore.has("sd_vk"), false);
  assert.equal(await cryptoMod.tryAutoUnlockVault(header), false);

  const lockedGet = await cryptoMod.getSecret(encToken, "widget:w1:authHeaderValue");
  assert.equal(lockedGet.ok, false);
  assert.equal(lockedGet.locked, true);
  assert.equal(lockedGet.error, "VAULT_LOCKED");

  // Wrong password rejected
  await assert.rejects(() => cryptoMod.unlockVault("wrong-password", header), /WRONG_PASSWORD/);

  // Unlocking restores session key and allows getSecret
  await cryptoMod.unlockVault("Correct-horse-1", header);
  assert.equal(cryptoMod.isVaultUnlocked(), true);

  // Switching KDF via changeVaultPassword (SHA-512 -> SHA-256) and unlocking with the new KDF
  const sha256Header = await cryptoMod.changeVaultPassword("Correct-horse-1", "Correct-horse-2", header, {
    kdf: "PBKDF2-SHA256"
  });
  assert.equal(sha256Header.kdf, "PBKDF2-SHA256");
  assert.equal(sha256Header.iterations, 600000);
  await cryptoMod.lockVault();
  await cryptoMod.unlockVault("Correct-horse-2", sha256Header);
  assert.deepEqual(await cryptoMod.getSecret(encToken, "widget:w1:authHeaderValue"), got);

  // Auto-lock normalization, insecure HTTP check, and session expiry
  assert.equal(cryptoMod.normalizeVaultAutoLockMinutes(-5), 0);
  assert.equal(cryptoMod.normalizeVaultAutoLockMinutes(30), 30);
  assert.equal(cryptoMod.normalizeVaultAutoLockMinutes(9999), 1440);
  assert.equal(cryptoMod.isInsecureHttpUrl("http://example.com/api"), true);
  assert.equal(cryptoMod.isInsecureHttpUrl("http://localhost:8080/api"), false);
  assert.equal(cryptoMod.isInsecureHttpUrl("http://127.0.0.1:8080/api"), false);
  assert.equal(cryptoMod.isInsecureHttpUrl("https://example.com/api"), false);

  // Simulate expired session record and verify checkVaultAutoLock locks the vault
  sessionStore.set("sd_vk", { k: sessionStore.get("sd_vk").k, exp: Date.now() - 1000 });
  assert.equal(await cryptoMod.checkVaultAutoLock(15), true);
  assert.equal(cryptoMod.isVaultUnlocked(), false);
  assert.equal(sessionStore.has("sd_vk"), false);
  await cryptoMod.unlockVault("Correct-horse-2", sha256Header);
  assert.ok(sessionStore.has("sd_vk"));

  // Change password preserves ability to decrypt existing field
  const nextHeader = await cryptoMod.changeVaultPassword("Correct-horse-1", "New-strong-pw-2", header);
  await cryptoMod.lockVault();
  await assert.rejects(() => cryptoMod.unlockVault("Correct-horse-1", nextHeader), /WRONG_PASSWORD/);
  await cryptoMod.unlockVault("New-strong-pw-2", nextHeader);
  const afterPwChange = await cryptoMod.getSecret(encToken, "widget:w1:authHeaderValue");
  assert.equal(afterPwChange.ok, true);
  assert.equal(afterPwChange.value, "PVEAPIToken=root@pam!t=secret");
});

test("fetchAndEvaluateRestWidget returns locked badge when vault is locked and sends decrypted header when unlocked", async () => {
  await cryptoMod.lockVault();
  sessionStore.clear();

  const header = await cryptoMod.setupVault("Strong-Pw-123");
  const encToken = await cryptoMod.setSecret("Bearer tok-xyz", "widget:w-rest:authHeaderValue");
  const widget = {
    id: "w-rest",
    name: "Private API",
    endpointUrl: "https://api.internal/health",
    method: "GET",
    jsonPath: "status",
    authHeaderName: "Authorization",
    authHeaderValue: encToken
  };

  // Locked -> does NOT fetch and does NOT leak ciphertext
  await cryptoMod.lockVault();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    fetchCalled = true;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: opts.headers.Authorization === "Bearer tok-xyz" ? "ok" : "bad" })
    };
  };

  try {
    const lockedRes = await fetchAndEvaluateRestWidget(widget);
    assert.equal(fetchCalled, false);
    assert.equal(lockedRes.text, "🔐");
    assert.equal(lockedRes.vaultLocked, true);

    await cryptoMod.unlockVault("Strong-Pw-123", header);
    const unlockedRes = await fetchAndEvaluateRestWidget(widget);
    assert.equal(fetchCalled, true);
    assert.equal(unlockedRes.text, "ok");
  } finally {
    globalThis.fetch = originalFetch;
    await cryptoMod.lockVault();
  }
});

test("fetchWeatherWidget returns vaultLocked when vault is locked and sends decrypted apiKey when unlocked", async () => {
  await cryptoMod.lockVault();
  sessionStore.clear();

  const header = await cryptoMod.setupVault("Strong-Pw-123");
  const encKey = await cryptoMod.setSecret("owm-secret-key", "widget:w-weather:apiKey");
  const widget = {
    id: "w-weather",
    type: "weather",
    provider: "openweathermap",
    latitude: 50.08,
    longitude: 14.43,
    apiKey: encKey
  };

  await cryptoMod.lockVault();
  sessionStore.clear();
  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes("/data/2.5/weather")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          weather: [{ id: 800, main: "Clear" }],
          main: { temp: 20, feels_like: 19, humidity: 50 },
          wind: { speed: 2 }
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ list: [] }) };
  };

  try {
    const lockedRes = await fetchWeatherWidget(widget);
    assert.equal(lockedRes.ok, false);
    assert.equal(lockedRes.vaultLocked, true);
    assert.equal(requestedUrls.length, 0);

    await cryptoMod.unlockVault("Strong-Pw-123", header);
    const unlockedRes = await fetchWeatherWidget(widget);
    assert.equal(unlockedRes.ok, true);
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls.every(u => u.includes("appid=owm-secret-key")));
  } finally {
    globalThis.fetch = originalFetch;
    await cryptoMod.lockVault();
  }
});

test("unlockVault with storeSession: false unlocks in memory without persisting session key", async () => {
  const header = await cryptoMod.setupVault("Strong-Pw-123");
  await cryptoMod.lockVault();
  assert.equal(cryptoMod.isVaultUnlocked(), false);
  assert.equal(sessionStore.size, 0);

  await cryptoMod.unlockVault("Strong-Pw-123", header, { storeSession: false });
  assert.equal(cryptoMod.isVaultUnlocked(), true);
  assert.equal(sessionStore.size, 0);

  await cryptoMod.unlockVault("Strong-Pw-123", header, { storeSession: true });
  assert.equal(cryptoMod.isVaultUnlocked(), true);
  assert.ok(sessionStore.size > 0);
  await cryptoMod.lockVault();
});

test("saveWebcalSecretUrl requires unlocked vault, encrypts URL locally, and fetchWebcalSource respects lock state", async () => {
  const localStore = new Map();
  const originalLocal = globalThis.chrome.storage.local;
  globalThis.chrome.storage.local = {
    get: async (key) => {
      if (typeof key === "string") return { [key]: localStore.get(key) };
      if (Array.isArray(key)) {
        const out = {};
        for (const k of key) out[k] = localStore.get(k);
        return out;
      }
      return Object.fromEntries(localStore.entries());
    },
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) localStore.set(k, v);
    },
    remove: async (key) => {
      localStore.delete(key);
    },
  };

  try {
    await cryptoMod.lockVault();
    await assert.rejects(
      () => saveWebcalSecretUrl("webcal_priv_1", "https://calendar.example.com/secret-token.ics"),
      /VAULT_LOCKED/,
    );

    const header = await cryptoMod.setupVault("Strong-Pw-123", { storeSession: false });
    await saveWebcalSecretUrl("webcal_priv_1", "webcal://calendar.example.com/secret-token.ics");
    const storedMap = localStore.get(CALENDAR_SECRETS_KEY);
    assert.ok(storedMap?.webcal_priv_1?.url);
    assert.equal(cryptoMod.isEncryptedSecret(storedMap.webcal_priv_1.url), true);
    assert.equal(storedMap.webcal_priv_1.url.includes("secret-token"), false);

    const loadedUnlocked = await loadWebcalSecretUrl("webcal_priv_1");
    assert.deepEqual(loadedUnlocked, {
      ok: true,
      value: "https://calendar.example.com/secret-token.ics",
    });

    await cryptoMod.lockVault();
    const loadedLocked = await loadWebcalSecretUrl("webcal_priv_1");
    assert.deepEqual(loadedLocked, { ok: false, locked: true, value: "" });

    const fetchLocked = await fetchWebcalSource({
      id: "webcal_priv_1",
      type: "webcal",
      url: "",
      privateUrl: true,
      refreshMinutes: 60,
    });
    assert.equal(fetchLocked.ok, false);
    assert.equal(fetchLocked.error, "Vault locked");

    await cryptoMod.unlockVault("Strong-Pw-123", header, { storeSession: false });
    await deleteWebcalSecretUrl("webcal_priv_1");
    const loadedAfterDelete = await loadWebcalSecretUrl("webcal_priv_1");
    assert.deepEqual(loadedAfterDelete, { ok: true, value: "" });
  } finally {
    globalThis.chrome.storage.local = originalLocal;
    await cryptoMod.lockVault();
  }
});

test("cross-tab lock broadcast clears in-memory vaultDek", async () => {
  const header = await cryptoMod.setupVault("Strong-Pw-123", { storeSession: false });
  assert.equal(cryptoMod.isVaultUnlocked(), true);

  const otherTabChannel = new BroadcastChannel("myspeeddial-vault-lock");
  otherTabChannel.postMessage({ type: "lock" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(cryptoMod.isVaultUnlocked(), false);

  otherTabChannel.close();
  await cryptoMod.unlockVault("Strong-Pw-123", header, { storeSession: false });
  await cryptoMod.lockVault();
});

test("collectVaultEncryptedItems lists sync, widgets, and calendar secrets with owner jump flags", () => {
  const items = collectVaultEncryptedItems({
    cfg: {
      sync: { type: "webdav", enc: "enc:v1:iv:ct" },
    },
    widgets: [
      { id: "w_rest", type: "rest-status", name: "API Health", authHeaderValue: "enc:v1:iv:ct" },
      { id: "w_plain", type: "rest-status", name: "Plain", authHeaderValue: "Bearer abc" },
      { id: "w_wx", type: "weather", name: "Local Weather", apiKey: "enc:v1:iv:ct" },
    ],
    calendarSources: [
      { id: "cal_1", type: "caldav", name: "Work CalDAV" },
      { id: "cal_2", type: "webcal", name: "Private Feed", privateUrl: true },
    ],
    calendarSecretsMap: {
      cal_1: { username: "enc:v1:iv:ct", password: "enc:v1:iv:ct" },
      cal_2: { url: "enc:v1:iv:ct" },
      cal_orphan: { url: "enc:v1:iv:ct" },
    },
  });

  assert.equal(items.length, 6);
  assert.deepEqual(
    items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, canJump: i.canJump })),
    [
      { id: "sync:credentials", kind: "sync", name: "synchronization", canJump: true },
      { id: "widget:w_rest:authHeaderValue", kind: "widget", name: "API Health", canJump: true },
      { id: "widget:w_wx:apiKey", kind: "widget", name: "Local Weather", canJump: true },
      { id: "calendar:cal_1:caldav", kind: "calendar", name: "Work CalDAV", canJump: true },
      { id: "calendar:cal_2:url", kind: "calendar", name: "Private Feed", canJump: true },
      { id: "calendar:cal_orphan:url", kind: "calendar", name: "cal_orphan", canJump: false },
    ],
  );
});

test("saveCaldavCredentials encrypts both username and password and respects lock state", async () => {
  const localStore = new Map();
  const originalLocal = globalThis.chrome.storage.local;
  globalThis.chrome.storage.local = {
    get: async (key) => (typeof key === "string" ? { [key]: localStore.get(key) } : {}),
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) localStore.set(k, v);
    },
    remove: async (key) => {
      localStore.delete(key);
    },
  };

  try {
    const header = await cryptoMod.setupVault("Strong-Pw-123", { storeSession: false });
    await saveCaldavCredentials("caldav_1", { username: "alice@example.com", password: "app-password-99" });

    const storedMap = localStore.get(CALENDAR_SECRETS_KEY);
    assert.equal(cryptoMod.isEncryptedSecret(storedMap.caldav_1.username), true);
    assert.equal(cryptoMod.isEncryptedSecret(storedMap.caldav_1.password), true);
    assert.equal(storedMap.caldav_1.username.includes("alice"), false);
    assert.equal(storedMap.caldav_1.password.includes("app-password"), false);

    const unlocked = await loadCaldavCredentials("caldav_1");
    assert.deepEqual(unlocked, { ok: true, username: "alice@example.com", password: "app-password-99" });

    await cryptoMod.lockVault();
    const locked = await loadCaldavCredentials("caldav_1");
    assert.deepEqual(locked, { ok: false, locked: true, username: "", password: "" });

    await cryptoMod.unlockVault("Strong-Pw-123", header, { storeSession: false });
    await deleteCaldavCredentials("caldav_1");
    const afterDelete = await loadCaldavCredentials("caldav_1");
    assert.deepEqual(afterDelete, { ok: true, username: "", password: "" });
  } finally {
    globalThis.chrome.storage.local = originalLocal;
    await cryptoMod.lockVault();
  }
});

test("privateUrl supports CalDAV without clobbering credentials and encryptCalendarCache encrypts cache at rest", async () => {
  const caldavNorm = normalizeCalendarSources([
    { id: "cd1", type: "caldav", name: "Private CalDAV", url: "https://dav.example.com/secret/", privateUrl: true },
  ]);
  assert.equal(caldavNorm.length, 1);
  assert.equal(caldavNorm[0].type, "caldav");
  assert.equal(caldavNorm[0].privateUrl, true);
  assert.equal(caldavNorm[0].url, "");

  const localStore = new Map();
  const originalLocal = globalThis.chrome.storage.local;
  globalThis.chrome.storage.local = {
    get: async (key) => (typeof key === "string" ? { [key]: localStore.get(key) } : {}),
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) localStore.set(k, v);
    },
    remove: async (key) => {
      localStore.delete(key);
    },
  };

  try {
    const header = await cryptoMod.setupVault("Strong-Pw-123", { storeSession: false });
    await saveCaldavCredentials("cd1", { username: "bob", password: "secret" });
    await saveWebcalSecretUrl("cd1", "https://dav.example.com/secret/");
    await deleteWebcalSecretUrl("cd1");
    const credsAfterUrlDelete = await loadCaldavCredentials("cd1");
    assert.deepEqual(credsAfterUrlDelete, { ok: true, username: "bob", password: "secret" });

    localStore.set("myspeeddial-config", {
      vaultHeader: header,
      appearance: {
        calendarSources: [
          { id: "cd1", type: "caldav", name: "Private CalDAV", url: "", privateUrl: true, encryptCache: true },
          { id: "pub1", type: "webcal", name: "Holidays", url: "https://holidays.example.com/cal.ics", encryptCache: false },
        ],
      },
    });
    await updateCalendarCacheMap((map) => {
      map.cd1 = { icsText: "BEGIN:VCALENDAR\nSUMMARY:Top Secret Meeting\nEND:VCALENDAR", fetchedAt: 12345 };
      map.pub1 = { icsText: "BEGIN:VCALENDAR\nSUMMARY:Public Holiday\nEND:VCALENDAR", fetchedAt: 67890 };
    });

    const rawStoredCache = localStore.get(CALENDAR_CACHE_KEY);
    assert.equal(cryptoMod.isEncryptedSecret(rawStoredCache.cd1), true);
    assert.equal(rawStoredCache.cd1.includes("Top Secret Meeting"), false);
    assert.equal(typeof rawStoredCache.pub1, "object");
    assert.equal(rawStoredCache.pub1.fetchedAt, 67890);

    const decryptedCache = await readCalendarCacheMap();
    assert.equal(decryptedCache.cd1.fetchedAt, 12345);
    assert.ok(decryptedCache.cd1.icsText.includes("Top Secret Meeting"));
    assert.equal(decryptedCache.pub1.fetchedAt, 67890);

    await cryptoMod.lockVault();
    const lockedCache = await readCalendarCacheMap();
    assert.equal(lockedCache.cd1, undefined);
    assert.equal(lockedCache.pub1.fetchedAt, 67890);

    // Deleting a calendar while Vault is locked must still remove its encrypted cache entry.
    await removeCalendarSourceCache("cd1");
    assert.equal(Object.prototype.hasOwnProperty.call(localStore.get(CALENDAR_CACHE_KEY), "cd1"), false);
    assert.equal(localStore.get(CALENDAR_CACHE_KEY).pub1.fetchedAt, 67890);
  } finally {
    globalThis.chrome.storage.local = originalLocal;
    await cryptoMod.lockVault();
  }
});

test("checkVaultAutoLock does not wipe in-memory storeSession: false unlock", async () => {
  const header = await cryptoMod.setupVault("Strong-Pw-123", { storeSession: false });
  await cryptoMod.lockVault();
  await cryptoMod.unlockVault("Strong-Pw-123", header, { storeSession: false });
  assert.equal(cryptoMod.isVaultUnlocked(), true);
  assert.equal(await cryptoMod.checkVaultAutoLock(30), false);
  assert.equal(cryptoMod.isVaultUnlocked(), true);
  await cryptoMod.lockVault();
});
