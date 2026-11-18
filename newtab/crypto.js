// Unified Web Crypto & Secrets Vault helpers for SimpleDial
// - Sync credential encryption: deriveKeyFromPassword, generateLocalKeyRaw, importRawKey, encryptWithKey, decryptWithKey
// - Vault (KEK/DEK + session key cache): setupVault, unlockVault, tryAutoUnlockVault, lockVault, changeVaultPassword
// - Field secret wrappers: setSecret, getSecret, encryptField, decryptField, isEncryptedSecret

export const VAULT_KDF_PRESETS = {
  "PBKDF2-SHA512": { hash: "SHA-512", iterations: 210000 },
  "PBKDF2-SHA256": { hash: "SHA-256", iterations: 600000 }
};
export const DEFAULT_VAULT_KDF = "PBKDF2-SHA512";

const PBKDF2_ITERATIONS = VAULT_KDF_PRESETS[DEFAULT_VAULT_KDF].iterations;
const PBKDF2_HASH = VAULT_KDF_PRESETS[DEFAULT_VAULT_KDF].hash;
const AES_ALGO = "AES-GCM";
const AES_KEY_LENGTH = 256; // bits
const AES_IV_BYTES = 12;

export const VAULT_MIN_PASSWORD_LENGTH = 6;
export const VAULT_MAX_PASSWORD_LENGTH = 512;
export const VAULT_MIN_PASSWORD_DIGITS = 1;
export const VAULT_MIN_PASSWORD_LETTERS = 1;
export const VAULT_MIN_PASSWORD_LOWERCASE = 0;
export const VAULT_MIN_PASSWORD_UPPERCASE = 0;
export const VAULT_MIN_PASSWORD_SPECIALS = 0;
export const VAULT_PASSWORD_CHANGE_INTERVAL = 90; // days
export const VAULT_MAX_AUTOLOCK_MINUTES = 1440; // 24 hours

const VAULT_CHECK_PLAINTEXT = "simpledial-vault-v1";
const FIELD_PREFIX = "enc:v1:";
const SESSION_KEY = "sd_vk";

const ext = globalThis.browser ?? globalThis.chrome;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let vaultDek = null; // Non-extractable AES-GCM CryptoKey kept in memory while unlocked

// ---- Encoding & byte helpers ----------------------------------------------

function toArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function toBase64Url(buffer) {
  return toBase64(buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(toArrayBuffer(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
}

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---- Core Web Crypto primitives -------------------------------------------

export function resolveVaultKdf(kdf = DEFAULT_VAULT_KDF, iterationsOverride = null) {
  const normalizedKdf = Object.prototype.hasOwnProperty.call(VAULT_KDF_PRESETS, kdf)
    ? kdf
    : DEFAULT_VAULT_KDF;
  const preset = VAULT_KDF_PRESETS[normalizedKdf];
  const iterations = Number.isFinite(Number(iterationsOverride)) && Number(iterationsOverride) > 0
    ? Number(iterationsOverride)
    : preset.iterations;
  return { kdf: normalizedKdf, hash: preset.hash, iterations };
}

export async function deriveKeyFromPassword(
  password,
  saltBase64,
  { iterations = PBKDF2_ITERATIONS, hash = PBKDF2_HASH, extractable = true, base64UrlSalt = false } = {}
) {
  const salt = saltBase64
    ? new Uint8Array(base64UrlSalt ? fromBase64Url(saltBase64) : toArrayBuffer(saltBase64))
    : randomBytes(16);
  const pwKey = await crypto.subtle.importKey("raw", textEncoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash
    },
    pwKey,
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    extractable,
    ["encrypt", "decrypt"]
  );
  const saltOut = base64UrlSalt ? toBase64Url(salt) : toBase64(salt.buffer);
  return { key, salt: saltOut };
}

export async function generateLocalKeyRaw() {
  const key = await crypto.subtle.generateKey({ name: AES_ALGO, length: AES_KEY_LENGTH }, true, ["encrypt", "decrypt"]);
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64(raw);
}

export async function importRawKey(base64Raw, extractable = true) {
  const raw = base64Raw instanceof Uint8Array ? base64Raw : toArrayBuffer(base64Raw);
  return crypto.subtle.importKey("raw", raw, { name: AES_ALGO, length: AES_KEY_LENGTH }, extractable, ["encrypt", "decrypt"]);
}

async function encryptBytes(cryptoKey, bytes, aad = "") {
  const iv = randomBytes(AES_IV_BYTES);
  const params = { name: AES_ALGO, iv };
  if (aad) params.additionalData = textEncoder.encode(aad);
  const ct = await crypto.subtle.encrypt(params, cryptoKey, bytes);
  return { iv, ct: new Uint8Array(ct) };
}

async function decryptBytes(cryptoKey, ctBytes, ivBytes, aad = "") {
  const params = { name: AES_ALGO, iv: ivBytes };
  if (aad) params.additionalData = textEncoder.encode(aad);
  const decrypted = await crypto.subtle.decrypt(params, cryptoKey, ctBytes);
  return new Uint8Array(decrypted);
}

export async function encryptWithKey(cryptoKey, plainText, aad = "") {
  const { iv, ct } = await encryptBytes(cryptoKey, textEncoder.encode(plainText), aad);
  return {
    ciphertext: toBase64(ct.buffer),
    iv: toBase64(iv.buffer)
  };
}

export async function decryptWithKey(cryptoKey, ciphertextBase64, ivBase64, aad = "") {
  const iv = new Uint8Array(toArrayBuffer(ivBase64));
  const ct = new Uint8Array(toArrayBuffer(ciphertextBase64));
  const plainBytes = await decryptBytes(cryptoKey, ct, iv, aad);
  return textDecoder.decode(plainBytes);
}

// ---- Vault session key cache (browser.storage.session — zero permissions) -

export function normalizeVaultAutoLockMinutes(minutes) {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, VAULT_MAX_AUTOLOCK_MINUTES);
}

export function isInsecureHttpUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:") return false;
    const host = (parsed.hostname || "").toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]";
  } catch {
    return false;
  }
}

let lastActivityTouchMs = 0;

async function storeSessionKey(rawDek, autoLockMinutes = 0) {
  if (!ext?.storage?.session?.set) return;
  try {
    const mins = normalizeVaultAutoLockMinutes(autoLockMinutes);
    const exp = mins > 0 ? Date.now() + mins * 60000 : 0;
    await ext.storage.session.set({ [SESSION_KEY]: { k: toBase64Url(rawDek), exp } });
  } catch {
    // Session storage unavailable — keep DEK in memory for this tab only
  }
}

async function readSessionRecord() {
  if (!ext?.storage?.session?.get) return null;
  try {
    const res = await ext.storage.session.get(SESSION_KEY);
    const val = res?.[SESSION_KEY];
    if (typeof val === "string" && val) {
      return { k: val, exp: 0 };
    }
    if (val && typeof val === "object" && typeof val.k === "string" && val.k) {
      return { k: val.k, exp: Number(val.exp) || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

async function readSessionKey() {
  const rec = await readSessionRecord();
  if (!rec) return null;
  if (rec.exp > 0 && Date.now() >= rec.exp) {
    await clearSessionKey();
    return null;
  }
  try {
    return fromBase64Url(rec.k);
  } catch {
    return null;
  }
}

export async function touchVaultActivity(autoLockMinutes = 0, { force = false } = {}) {
  if (!vaultDek || !ext?.storage?.session?.set) return;
  const now = Date.now();
  if (!force && now - lastActivityTouchMs < 15000) return;
  lastActivityTouchMs = now;
  const rec = await readSessionRecord();
  if (!rec) return;
  if (rec.exp > 0 && now >= rec.exp) {
    await lockVault();
    return;
  }
  const mins = normalizeVaultAutoLockMinutes(autoLockMinutes);
  const nextExp = mins > 0 ? now + mins * 60000 : 0;
  try {
    await ext.storage.session.set({ [SESSION_KEY]: { k: rec.k, exp: nextExp } });
  } catch {
    // ignore
  }
}

export async function checkVaultAutoLock(autoLockMinutes = 0) {
  if (!vaultDek) return false;
  const mins = normalizeVaultAutoLockMinutes(autoLockMinutes);
  if (mins <= 0) return false;
  const rec = await readSessionRecord();
  if (!rec || (rec.exp > 0 && Date.now() >= rec.exp)) {
    await lockVault();
    return true;
  }
  return false;
}

async function clearSessionKey() {
  if (!ext?.storage?.session?.remove) return;
  try {
    await ext.storage.session.remove(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ---- Vault KEK/DEK lifecycle ----------------------------------------------

async function encryptVaultBlock(key, bytes, aad = "") {
  const { iv, ct } = await encryptBytes(key, bytes, aad);
  return { iv: toBase64Url(iv), ct: toBase64Url(ct) };
}

async function decryptVaultBlock(key, block, aad = "") {
  return decryptBytes(key, fromBase64Url(block.ct), fromBase64Url(block.iv), aad);
}

async function verifyVaultCheck(key, check) {
  try {
    const out = await decryptVaultBlock(key, check);
    return textDecoder.decode(out) === VAULT_CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

export function validateVaultPassword(password) {
  const pw = typeof password === "string" ? password : "";
  const errors = [];
  if (pw.length < VAULT_MIN_PASSWORD_LENGTH) {
    errors.push({ code: "length", min: VAULT_MIN_PASSWORD_LENGTH });
  }
  if (pw.length > VAULT_MAX_PASSWORD_LENGTH) {
    errors.push({ code: "maxLength", max: VAULT_MAX_PASSWORD_LENGTH });
  }
  const digits = (pw.match(/\p{Nd}/gu) || []).length;
  if (digits < VAULT_MIN_PASSWORD_DIGITS) {
    errors.push({ code: "digits", min: VAULT_MIN_PASSWORD_DIGITS });
  }
  const letters = (pw.match(/\p{L}/gu) || []).length;
  if (letters < VAULT_MIN_PASSWORD_LETTERS) {
    errors.push({ code: "letters", min: VAULT_MIN_PASSWORD_LETTERS });
  }
  const lowercase = (pw.match(/\p{Ll}/gu) || []).length;
  if (lowercase < VAULT_MIN_PASSWORD_LOWERCASE) {
    errors.push({ code: "lowercase", min: VAULT_MIN_PASSWORD_LOWERCASE });
  }
  const uppercase = (pw.match(/\p{Lu}/gu) || []).length;
  if (uppercase < VAULT_MIN_PASSWORD_UPPERCASE) {
    errors.push({ code: "uppercase", min: VAULT_MIN_PASSWORD_UPPERCASE });
  }
  const specials = (pw.match(/[^\p{L}\p{N}\s]/gu) || []).length;
  if (specials < VAULT_MIN_PASSWORD_SPECIALS) {
    errors.push({ code: "specials", min: VAULT_MIN_PASSWORD_SPECIALS });
  }
  return { valid: errors.length === 0, errors };
}

export function isVaultPasswordExpired(header, nowMs = Date.now()) {
  if (!header?.check || VAULT_PASSWORD_CHANGE_INTERVAL <= 0) return false;
  const changedAt = Number(header.passwordChangedAt);
  if (!Number.isFinite(changedAt) || changedAt <= 0) return true;
  return (nowMs - changedAt) >= VAULT_PASSWORD_CHANGE_INTERVAL * 86400 * 1000;
}

export function getVaultPasswordDaysRemaining(header, nowMs = Date.now()) {
  if (!header?.check || VAULT_PASSWORD_CHANGE_INTERVAL <= 0) return null;
  const changedAt = Number(header.passwordChangedAt);
  if (!Number.isFinite(changedAt) || changedAt <= 0) return 0;
  const remainingMs = changedAt + VAULT_PASSWORD_CHANGE_INTERVAL * 86400 * 1000 - nowMs;
  return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 86400000);
}

async function wrapDek(password, rawDek, dekKey, kdf = DEFAULT_VAULT_KDF) {
  const resolved = resolveVaultKdf(kdf);
  const { key: kek, salt } = await deriveKeyFromPassword(password, null, {
    iterations: resolved.iterations,
    hash: resolved.hash,
    extractable: false,
    base64UrlSalt: true
  });
  return {
    v: 1,
    kdf: resolved.kdf,
    iterations: resolved.iterations,
    salt,
    wrappedKey: await encryptVaultBlock(kek, rawDek),
    check: await encryptVaultBlock(dekKey, textEncoder.encode(VAULT_CHECK_PLAINTEXT)),
    passwordChangedAt: Date.now()
  };
}

export const isVaultUnlocked = () => vaultDek !== null;
export const isEncryptedSecret = (v) => typeof v === "string" && v.startsWith(FIELD_PREFIX);

export async function setupVault(password, { kdf = DEFAULT_VAULT_KDF, autoLockMinutes = 0 } = {}) {
  const check = validateVaultPassword(password);
  if (!check.valid) {
    const err = new Error("PASSWORD_POLICY_FAILED");
    err.policyErrors = check.errors;
    throw err;
  }
  const rawDek = randomBytes(32);
  const key = await importRawKey(rawDek, false);
  const header = await wrapDek(password, rawDek, key, kdf);
  vaultDek = key;
  await storeSessionKey(rawDek, autoLockMinutes);
  return header;
}

export async function unlockVault(password, header, { autoLockMinutes = 0 } = {}) {
  if (!header?.salt || !header?.wrappedKey || !header?.check) {
    throw new Error("WRONG_PASSWORD");
  }
  const resolved = resolveVaultKdf(header.kdf || "PBKDF2-SHA256", header.iterations);
  const { key: kek } = await deriveKeyFromPassword(password, header.salt, {
    iterations: resolved.iterations,
    hash: resolved.hash,
    extractable: false,
    base64UrlSalt: true
  });
  let rawDek;
  try {
    rawDek = await decryptVaultBlock(kek, header.wrappedKey);
  } catch {
    throw new Error("WRONG_PASSWORD");
  }
  const key = await importRawKey(rawDek, false);
  if (!(await verifyVaultCheck(key, header.check))) {
    throw new Error("WRONG_PASSWORD");
  }
  vaultDek = key;
  await storeSessionKey(rawDek, autoLockMinutes);
}

export async function tryAutoUnlockVault(header, { autoLockMinutes = 0 } = {}) {
  if (vaultDek) {
    if (await checkVaultAutoLock(autoLockMinutes)) return false;
    return true;
  }
  if (!header?.check) return false;
  try {
    const raw = await readSessionKey();
    if (!raw || raw.length !== 32) return false;
    const key = await importRawKey(raw, false);
    if (!(await verifyVaultCheck(key, header.check))) {
      await clearSessionKey();
      return false;
    }
    vaultDek = key;
    return true;
  } catch {
    return false;
  }
}

export async function lockVault() {
  vaultDek = null;
  await clearSessionKey();
}

export async function changeVaultPassword(oldPassword, newPassword, header, { kdf } = {}) {
  const check = validateVaultPassword(newPassword);
  if (!check.valid) {
    const err = new Error("PASSWORD_POLICY_FAILED");
    err.policyErrors = check.errors;
    throw err;
  }
  await unlockVault(oldPassword, header);
  const resolved = resolveVaultKdf(header.kdf || "PBKDF2-SHA256", header.iterations);
  const { key: kek } = await deriveKeyFromPassword(oldPassword, header.salt, {
    iterations: resolved.iterations,
    hash: resolved.hash,
    extractable: false,
    base64UrlSalt: true
  });
  const rawDek = await decryptVaultBlock(kek, header.wrappedKey);
  const targetKdf = kdf || header.kdf || DEFAULT_VAULT_KDF;
  return wrapDek(newPassword, rawDek, vaultDek, targetKdf);
}

export async function encryptField(plaintext, context = "") {
  if (!vaultDek) throw new Error("VAULT_LOCKED");
  if (plaintext === "" || plaintext == null) return plaintext;
  const { iv, ct } = await encryptVaultBlock(vaultDek, textEncoder.encode(plaintext), context);
  return `${FIELD_PREFIX}${iv}:${ct}`;
}

export async function decryptField(value, context = "") {
  if (!isEncryptedSecret(value)) return value;
  if (!vaultDek) throw new Error("VAULT_LOCKED");
  const [iv, ct] = value.slice(FIELD_PREFIX.length).split(":");
  try {
    const out = await decryptVaultBlock(vaultDek, { iv, ct }, context);
    return textDecoder.decode(out);
  } catch {
    throw new Error("DECRYPT_FAILED");
  }
}

// ---- High-level setSecret / getSecret wrappers ----------------------------

/**
 * Encrypts a secret value when the vault is unlocked (or can auto-unlock via vaultHeader).
 * Returns plaintext unchanged when no vault is unlocked unless `requireVault` is true.
 */
export async function setSecret(plaintext, context = "", { vaultHeader = null, requireVault = false } = {}) {
  if (plaintext === "" || plaintext == null) return plaintext ?? "";
  if (!vaultDek && vaultHeader) {
    await tryAutoUnlockVault(vaultHeader);
  }
  if (!vaultDek) {
    if (requireVault) throw new Error("VAULT_LOCKED");
    return String(plaintext);
  }
  return encryptField(String(plaintext), context);
}

/**
 * Reads a stored secret (plaintext or `enc:v1:...`), attempting session auto-unlock if `vaultHeader` is given.
 * Never throws; returns `{ ok, value, encrypted, locked, error }`.
 */
export async function getSecret(storedValue, context = "", { vaultHeader = null } = {}) {
  if (storedValue === "" || storedValue == null) {
    return { ok: true, value: "", encrypted: false, locked: false, error: null };
  }
  if (!isEncryptedSecret(storedValue)) {
    return { ok: true, value: String(storedValue), encrypted: false, locked: false, error: null };
  }
  if (!vaultDek && vaultHeader) {
    await tryAutoUnlockVault(vaultHeader);
  }
  if (!vaultDek) {
    return { ok: false, value: null, encrypted: true, locked: true, error: "VAULT_LOCKED" };
  }
  try {
    const value = await decryptField(storedValue, context);
    return { ok: true, value, encrypted: true, locked: false, error: null };
  } catch {
    return { ok: false, value: null, encrypted: true, locked: true, error: "DECRYPT_FAILED" };
  }
}
