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
