// Lightweight crypto helpers using Web Crypto API
// Functions: deriveKeyFromPassword, generateLocalKeyRaw, importRawKey, encryptWithKey, decryptWithKey

const PBKDF2_ITERATIONS = 150000;
const PBKDF2_HASH = 'SHA-256';
const AES_ALGO = 'AES-GCM';
const AES_KEY_LENGTH = 256; // bits

function toArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function deriveKeyFromPassword(password, saltBase64) {
  const salt = saltBase64 ? new Uint8Array(toArrayBuffer(saltBase64)) : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const pwKey = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH
    },
    pwKey,
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
  const saltOut = toBase64(salt.buffer);
  return { key, salt: saltOut };
}

export async function generateLocalKeyRaw() {
  const key = await crypto.subtle.generateKey({ name: AES_ALGO, length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  return toBase64(raw);
}

export async function importRawKey(base64Raw) {
  const raw = toArrayBuffer(base64Raw);
  return await crypto.subtle.importKey('raw', raw, { name: AES_ALGO, length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']);
}

export async function encryptWithKey(cryptoKey, plainText) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: AES_ALGO, iv }, cryptoKey, enc.encode(plainText));
  return {
    ciphertext: toBase64(ct),
    iv: toBase64(iv.buffer)
  };
}

export async function decryptWithKey(cryptoKey, ciphertextBase64, ivBase64) {
  try {
    const iv = new Uint8Array(toArrayBuffer(ivBase64));
    const ct = toArrayBuffer(ciphertextBase64);
    const decrypted = await crypto.subtle.decrypt({ name: AES_ALGO, iv }, cryptoKey, ct);
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (e) {
    throw e;
  }
}
