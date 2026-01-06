export function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function getOrCreateMasterKey() {
  const stored = await chrome.storage.local.get("webdavMasterKey");
  if (stored.webdavMasterKey) {
    const raw = base64ToArrayBuffer(stored.webdavMasterKey);
    return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, ["encrypt", "decrypt"]);
  await chrome.storage.local.set({ webdavMasterKey: arrayBufferToBase64(rawKey.buffer) });
  return key;
}

export async function encryptText(text) {
  const key = await getOrCreateMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);

  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    iv: arrayBufferToBase64(iv.buffer),
    data: arrayBufferToBase64(cipher)
  };
}

export async function decryptText(enc) {
  if (!enc) return null;

  const key = await getOrCreateMasterKey();
  const iv = base64ToArrayBuffer(enc.iv);
  const cipher = base64ToArrayBuffer(enc.data);

  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
