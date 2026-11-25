let autoBackupQueue = Promise.resolve();

export async function withAutoBackupLock(task) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  if (locks && typeof locks.request === "function") {
    return locks.request("simple-dial-auto-backup", { mode: "exclusive" }, async () => await task());
  }
  const next = autoBackupQueue.then(task, task);
  autoBackupQueue = next.catch(() => {});
  return next;
}
