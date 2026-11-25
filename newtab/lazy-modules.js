// Shared lazy loaders for heavy modules (sync.js and crypto.js) kept off the initial startup parse path.
let syncModulePromise = null;
let loadedSyncModule = null;

let cryptoModulePromise = null;
let loadedCryptoModule = null;

export function getLoadedSyncModule() {
  return loadedSyncModule;
}

export function loadSyncModule() {
  if (loadedSyncModule) {
    return Promise.resolve(loadedSyncModule);
  }
  if (!syncModulePromise) {
    syncModulePromise = import("./sync.js")
      .then(mod => {
        loadedSyncModule = mod;
        return mod;
      })
      .catch(err => {
        syncModulePromise = null;
        throw err;
      });
  }
  return syncModulePromise;
}

export function getLoadedCryptoModule() {
  return loadedCryptoModule;
}

export function loadCryptoModule() {
  if (loadedCryptoModule) {
    return Promise.resolve(loadedCryptoModule);
  }
  if (!cryptoModulePromise) {
    cryptoModulePromise = import("./crypto.js")
      .then(mod => {
        loadedCryptoModule = mod;
        return mod;
      })
      .catch(err => {
        cryptoModulePromise = null;
        throw err;
      });
  }
  return cryptoModulePromise;
}
