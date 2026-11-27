import { isEncryptedSecret } from "./crypto.js";
import { t } from "./i18n.js";

/**
 * Collect metadata (never secret values) for all Vault-encrypted items across Sync, Widgets, and Calendars.
 */
export function collectVaultEncryptedItems({
  cfg = null,
  widgets = [],
  calendarSources = [],
  calendarSecretsMap = {},
} = {}) {
  const items = [];
  if (isEncryptedSecret(cfg?.sync?.enc)) {
    const syncType = cfg.sync?.type || "";
    items.push({
      id: "sync:credentials",
      kind: "sync",
      name: t("synchronization") || "Synchronization",
      detail: syncType
        ? `${t("securityVaultItemSync") || "Sync credentials"} (${syncType})`
        : (t("securityVaultItemSync") || "Sync credentials"),
      canJump: true,
    });
  }

  for (const w of Array.isArray(widgets) ? widgets : []) {
    if (!w || typeof w !== "object") continue;
    if (w.type === "rest-status" && isEncryptedSecret(w.authHeaderValue)) {
      items.push({
        id: `widget:${w.id}:authHeaderValue`,
        kind: "widget",
        widgetId: w.id,
        name: w.name || w.id,
        detail: t("securityVaultItemRestToken") || "REST Status auth token",
        canJump: true,
      });
    } else if (w.type === "weather" && isEncryptedSecret(w.apiKey)) {
      items.push({
        id: `widget:${w.id}:apiKey`,
        kind: "widget",
        widgetId: w.id,
        name: w.name || w.id,
        detail: t("securityVaultItemWeatherKey") || "Weather API key",
        canJump: true,
      });
    }
  }

  const calMap = new Map(
    (Array.isArray(calendarSources) ? calendarSources : [])
      .filter((s) => s && typeof s === "object" && s.id)
      .map((s) => [s.id, s]),
  );
  if (calendarSecretsMap && typeof calendarSecretsMap === "object") {
    for (const [sourceId, entry] of Object.entries(calendarSecretsMap)) {
      if (!entry || typeof entry !== "object") continue;
      const src = calMap.get(sourceId) || null;
      const label = src?.name || sourceId;
      if (isEncryptedSecret(entry.username) || isEncryptedSecret(entry.password)) {
        items.push({
          id: `calendar:${sourceId}:caldav`,
          kind: "calendar",
          sourceId,
          name: label,
          detail: t("securityVaultItemCaldavPass") || "CalDAV credentials",
          canJump: Boolean(src),
        });
      }
      if (isEncryptedSecret(entry.url)) {
        items.push({
          id: `calendar:${sourceId}:url`,
          kind: "calendar",
          sourceId,
          name: label,
          detail: t("securityVaultItemWebcalUrl") || "Private calendar URL",
          canJump: Boolean(src),
        });
      }
    }
  }
  return items;
}
