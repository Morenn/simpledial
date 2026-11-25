import { loadConfig } from "../config.js";
import { t } from "../i18n.js";
import { getSecret, isVaultUnlocked } from "../crypto.js";
import { requestRestEndpointPermission, hasHostPermissionForUrl } from "./rest-status-widget.js";

export const WEATHER_CACHE_KEY = "myspeeddial-weather-cache";
export const WEATHER_POLL_TICK_MS = 60 * 1000;
export const DEFAULT_WEATHER_REFRESH_MINUTES = 30;

let weatherCacheByWidget = {};
let weatherCacheLoaded = false;
let weatherCacheLoadPromise = null;
let weatherPollTimer = null;
let weatherPollInFlight = false;

export function normalizeWeatherDisplaySize(value) {
  return (value === "pill" || value === "small" || value === "medium") ? value : "small";
}

export function normalizeWeatherProvider(value) {
  return value === "openweathermap" ? "openweathermap" : "open-meteo";
}

export function normalizeWeatherUnit(value) {
  return value === "F" ? "F" : "C";
}

export function normalizeWeatherRefreshMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WEATHER_REFRESH_MINUTES;
  return Math.max(10, Math.min(1440, Math.round(n)));
}

export function formatTemperature(tempC, unit = "C") {
  const n = Number(tempC);
  if (!Number.isFinite(n)) return "--";
  if (unit === "F") {
    return `${Math.round((n * 9) / 5 + 32)}°F`;
  }
  return `${Math.round(n)}°C`;
}

function tr(key, fallback) {
  const val = t(key);
  return (val && val !== key) ? val : fallback;
}

export function mapWmoWeatherCode(code, isDay = true) {
  const c = Number(code);
  const night = isDay === false;
  if (c === 0) return { icon: night ? "🌙" : "☀️", key: "weatherCondClear", label: tr("weatherCondClear", "Clear") };
  if (c === 1) return { icon: night ? "🌙" : "🌤️", key: "weatherCondMostlyClear", label: tr("weatherCondMostlyClear", "Mostly clear") };
  if (c === 2) return { icon: "⛅", key: "weatherCondPartlyCloudy", label: tr("weatherCondPartlyCloudy", "Partly cloudy") };
  if (c === 3) return { icon: "☁️", key: "weatherCondCloudy", label: tr("weatherCondCloudy", "Cloudy") };
  if (c === 45 || c === 48) return { icon: "🌫️", key: "weatherCondFog", label: tr("weatherCondFog", "Fog") };
  if (c === 51 || c === 53 || c === 55 || c === 56 || c === 57) return { icon: "🌦️", key: "weatherCondDrizzle", label: tr("weatherCondDrizzle", "Drizzle") };
  if (c === 61 || c === 63 || c === 65 || c === 66 || c === 67) return { icon: "🌧️", key: "weatherCondRain", label: tr("weatherCondRain", "Rain") };
  if (c === 71 || c === 73 || c === 75 || c === 77) return { icon: "❄️", key: "weatherCondSnow", label: tr("weatherCondSnow", "Snow") };
  if (c === 80 || c === 81 || c === 82) return { icon: "🌧️", key: "weatherCondShowers", label: tr("weatherCondShowers", "Showers") };
  if (c === 85 || c === 86) return { icon: "🌨️", key: "weatherCondSnowShowers", label: tr("weatherCondSnowShowers", "Snow showers") };
  if (c === 95 || c === 96 || c === 99) return { icon: "⛈️", key: "weatherCondThunderstorm", label: tr("weatherCondThunderstorm", "Thunderstorm") };
  return { icon: night ? "🌙" : "🌤️", key: "weatherCondWeather", label: tr("weatherCondWeather", "Weather") };
}

export function mapOpenWeatherCondition(id, main = "", isDay = true) {
  const code = Number(id);
  const night = isDay === false;
  if (code >= 200 && code < 300) return { icon: "⛈️", key: "weatherCondThunderstorm", label: tr("weatherCondThunderstorm", main || "Thunderstorm") };
  if (code >= 300 && code < 400) return { icon: "🌦️", key: "weatherCondDrizzle", label: tr("weatherCondDrizzle", main || "Drizzle") };
  if (code >= 500 && code < 600) return { icon: "🌧️", key: "weatherCondRain", label: tr("weatherCondRain", main || "Rain") };
  if (code >= 600 && code < 700) return { icon: "❄️", key: "weatherCondSnow", label: tr("weatherCondSnow", main || "Snow") };
  if (code >= 700 && code < 800) return { icon: "🌫️", key: "weatherCondFog", label: tr("weatherCondFog", main || "Fog") };
  if (code === 800) return { icon: night ? "🌙" : "☀️", key: "weatherCondClear", label: tr("weatherCondClear", main || "Clear") };
  if (code === 801) return { icon: night ? "🌙" : "🌤️", key: "weatherCondFewClouds", label: tr("weatherCondFewClouds", main || "Few clouds") };
  if (code === 802) return { icon: "⛅", key: "weatherCondPartlyCloudy", label: tr("weatherCondPartlyCloudy", main || "Partly cloudy") };
  if (code === 803 || code === 804) return { icon: "☁️", key: "weatherCondCloudy", label: tr("weatherCondCloudy", main || "Cloudy") };
  return { icon: night ? "🌙" : "🌤️", key: "weatherCondWeather", label: tr("weatherCondWeather", main || "Weather") };
}

export function getWeatherProviderEndpointUrl(provider) {
  return normalizeWeatherProvider(provider) === "openweathermap"
    ? "https://api.openweathermap.org/data/2.5/weather"
    : "https://api.open-meteo.com/v1/forecast";
}

export async function requestWeatherPermission(provider) {
  return requestRestEndpointPermission(getWeatherProviderEndpointUrl(provider));
}

export async function searchWeatherLocations(query) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const hasPerm = await hasHostPermissionForUrl(url);
  if (!hasPerm) {
    const granted = await requestRestEndpointPermission(url);
    if (!granted) {
      throw new Error("PERMISSION_REQUIRED");
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data?.results) ? data.results : [];
  return list.map(r => {
    const parts = [r.name, r.admin1, r.country_code].filter(Boolean);
    return {
      label: parts.join(", "),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude)
    };
  }).filter(r => r.label && Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
}

async function ensureWeatherCacheLoaded() {
  if (weatherCacheLoaded) return;
  if (weatherCacheLoadPromise) return weatherCacheLoadPromise;
  weatherCacheLoadPromise = (async () => {
    try {
      const res = await chrome.storage.local.get(WEATHER_CACHE_KEY);
      const raw = res?.[WEATHER_CACHE_KEY];
      weatherCacheByWidget = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
    } catch {
      weatherCacheByWidget = {};
    } finally {
      weatherCacheLoaded = true;
    }
  })();
  return weatherCacheLoadPromise;
}

async function persistWeatherCache() {
  try {
    await chrome.storage.local.set({ [WEATHER_CACHE_KEY]: weatherCacheByWidget });
  } catch (err) {
    console.warn("Failed to save weather cache", err);
  }
}

export async function pruneWeatherStorageForWidgets(activeWidgets = []) {
  await ensureWeatherCacheLoaded();
  const activeIds = new Set(
    (Array.isArray(activeWidgets) ? activeWidgets : [])
      .filter(w => w?.type === "weather" && typeof w.id === "string" && w.id)
      .map(w => w.id)
  );
  let changed = false;
  for (const id of Object.keys(weatherCacheByWidget)) {
    if (!activeIds.has(id)) {
      delete weatherCacheByWidget[id];
      changed = true;
    }
  }
  if (changed) {
    await persistWeatherCache();
  }
  return changed;
}

function formatDayName(dateStr, index) {
  if (index === 0) return t("weatherToday") || "Today";
  if (index === 1) return t("weatherTomorrow") || "Tomorrow";
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  } catch {
    return dateStr;
  }
}

async function fetchOpenMeteo(widget) {
  const lat = Number(widget.latitude);
  const lon = Number(widget.longitude);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,weather_code,precipitation_probability,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const cur = data?.current || {};
    const curIsDay = cur.is_day === undefined ? true : Number(cur.is_day) !== 0;
    const mapped = mapWmoWeatherCode(cur.weather_code, curIsDay);
    const current = {
      tempC: Number(cur.temperature_2m),
      apparentTempC: Number(cur.apparent_temperature),
      humidity: Number(cur.relative_humidity_2m),
      windKmh: Number(cur.wind_speed_10m),
      icon: mapped.icon,
      condKey: mapped.key,
      condition: mapped.label
    };

    const dailyTimes = Array.isArray(data?.daily?.time) ? data.daily.time : [];
    const daily = dailyTimes.slice(0, 7).map((dateStr, idx) => {
      const m = mapWmoWeatherCode(data.daily.weather_code?.[idx]);
      return {
        date: dateStr,
        label: formatDayName(dateStr, idx),
        icon: m.icon,
        condKey: m.key,
        condition: m.label,
        minC: Number(data.daily.temperature_2m_min?.[idx]),
        maxC: Number(data.daily.temperature_2m_max?.[idx]),
        precipPct: Number(data.daily.precipitation_probability_max?.[idx] ?? 0)
      };
    });

    const hourlyTimes = Array.isArray(data?.hourly?.time) ? data.hourly.time : [];
    const nowMs = Date.now();
    const hourly = [];
    for (let i = 0; i < hourlyTimes.length && hourly.length < 8; i += 3) {
      const ts = Date.parse(hourlyTimes[i]);
      if (Number.isFinite(ts) && ts + 3600000 < nowMs) continue;
      const slotIsDay = data.hourly?.is_day?.[i] === undefined ? true : Number(data.hourly.is_day[i]) !== 0;
      const m = mapWmoWeatherCode(data.hourly.weather_code?.[i], slotIsDay);
      hourly.push({
        time: hourlyTimes[i].slice(11, 16),
        tempC: Number(data.hourly.temperature_2m?.[i]),
        icon: m.icon,
        precipPct: Number(data.hourly.precipitation_probability?.[i] ?? 0)
      });
    }

    return { ok: true, current, daily, hourly };
  } catch (err) {
    return { ok: false, error: err?.name === "AbortError" ? "Timeout" : (err?.message || "Fetch error") };
  } finally {
    clearTimeout(timer);
  }
}

function isOwmDaytime(entry, fallbackSys = null) {
  const iconCode = entry?.weather?.[0]?.icon;
  if (typeof iconCode === "string") {
    if (iconCode.endsWith("n")) return false;
    if (iconCode.endsWith("d")) return true;
  }
  if (entry?.sys?.pod === "n") return false;
  if (entry?.sys?.pod === "d") return true;
  const dt = Number(entry?.dt);
  const sunrise = Number(fallbackSys?.sunrise);
  const sunset = Number(fallbackSys?.sunset);
  if (Number.isFinite(dt) && Number.isFinite(sunrise) && Number.isFinite(sunset)) {
    return dt >= sunrise && dt < sunset;
  }
  return true;
}

async function fetchOpenWeatherMap(widget) {
  const rawKey = typeof widget.apiKey === "string" ? widget.apiKey.trim() : "";
  if (!rawKey) return { ok: false, error: "API key required" };
  let apiKey = rawKey;
  if (rawKey.startsWith("enc:v1:")) {
    let vaultHeader = null;
    try {
      vaultHeader = (await loadConfig())?.vaultHeader || null;
    } catch {
      // ignore
    }
    const secret = await getSecret(rawKey, `widget:${widget.id}:apiKey`, { vaultHeader });
    if (!secret.ok) {
      return {
        ok: false,
        error: secret.error === "DECRYPT_FAILED"
          ? (t("vaultDecryptFailed") || "Failed to decrypt API key")
          : (t("vaultLockedClickToUnlock") || "Vault locked"),
        vaultLocked: true
      };
    }
    apiKey = typeof secret.value === "string" ? secret.value.trim() : "";
  }
  if (!apiKey) return { ok: false, error: "API key required" };

  const lat = Number(widget.latitude);
  const lon = Number(widget.longitude);
  const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${encodeURIComponent(apiKey)}&units=metric`;
  const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${encodeURIComponent(apiKey)}&units=metric`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const [curRes, fcRes] = await Promise.all([
      fetch(currentUrl, { signal: controller.signal }),
      fetch(forecastUrl, { signal: controller.signal })
    ]);
    if (!curRes.ok) return { ok: false, error: `HTTP ${curRes.status}` };
    const curData = await curRes.json();
    const w0 = curData?.weather?.[0] || {};
    const mapped = mapOpenWeatherCondition(w0.id, w0.main, isOwmDaytime(curData, curData?.sys));
    const current = {
      tempC: Number(curData?.main?.temp),
      apparentTempC: Number(curData?.main?.feels_like),
      humidity: Number(curData?.main?.humidity),
      windKmh: Math.round(Number(curData?.wind?.speed || 0) * 3.6),
      icon: mapped.icon,
      condKey: mapped.key,
      condition: mapped.label
    };

    const fcData = fcRes.ok ? await fcRes.json() : null;
    const fcList = Array.isArray(fcData?.list) ? fcData.list : [];
    const hourly = fcList.slice(0, 8).map(entry => {
      const m = mapOpenWeatherCondition(entry?.weather?.[0]?.id, entry?.weather?.[0]?.main, isOwmDaytime(entry));
      return {
        time: String(entry.dt_txt || "").slice(11, 16),
        tempC: Number(entry?.main?.temp),
        icon: m.icon,
        precipPct: Math.round(Number(entry?.pop || 0) * 100)
      };
    });

    const byDate = new Map();
    for (const entry of fcList) {
      const dateStr = String(entry.dt_txt || "").slice(0, 10);
      if (!dateStr) continue;
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr).push(entry);
    }
    const daily = Array.from(byDate.entries()).slice(0, 5).map(([dateStr, entries], idx) => {
      const temps = entries.map(e => Number(e?.main?.temp)).filter(Number.isFinite);
      const mid = entries[Math.floor(entries.length / 2)] || entries[0];
      const m = mapOpenWeatherCondition(mid?.weather?.[0]?.id, mid?.weather?.[0]?.main);
      const maxPop = Math.max(0, ...entries.map(e => Math.round(Number(e?.pop || 0) * 100)));
      return {
        date: dateStr,
        label: formatDayName(dateStr, idx),
        icon: m.icon,
        condKey: m.key,
        condition: m.label,
        minC: temps.length ? Math.min(...temps) : current.tempC,
        maxC: temps.length ? Math.max(...temps) : current.tempC,
        precipPct: maxPop
      };
    });

    return { ok: true, current, daily, hourly };
  } catch (err) {
    return { ok: false, error: err?.name === "AbortError" ? "Timeout" : (err?.message || "Fetch error") };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeatherWidget(widget) {
  if (!widget || !Number.isFinite(Number(widget.latitude)) || !Number.isFinite(Number(widget.longitude))) {
    return { ok: false, error: "Location not set" };
  }
  const provider = normalizeWeatherProvider(widget.provider);
  const endpointUrl = getWeatherProviderEndpointUrl(provider);
  const hasPerm = await hasHostPermissionForUrl(endpointUrl);
  if (!hasPerm) {
    return { ok: false, error: "Permission required" };
  }
  if (provider === "openweathermap") {
    return fetchOpenWeatherMap(widget);
  }
  return fetchOpenMeteo(widget);
}

function renderWeatherBarDom(el, widget) {
  if (!el) return;
  const size = normalizeWeatherDisplaySize(widget.displaySize);
  const unit = normalizeWeatherUnit(widget.unit);
  el.className = `custom-weather-widget is-${size}`;
  el.dataset.widgetId = widget.id;

  const cache = weatherCacheByWidget[widget.id];
  const cur = cache?.current;
  const today = Array.isArray(cache?.daily) ? cache.daily[0] : null;
  const loc = widget.locationName || widget.name || "Weather";

  el.innerHTML = "";
  if (!cur) {
    const errText = cache?.error === "Permission required"
      ? (t("weatherPermissionRequiredBar") || "🔒 Permission required — open & refresh")
      : (cache?.error || (t("weatherLoading") || "Loading weather..."));
    const span = document.createElement("span");
    span.className = "custom-weather-status-text";
    span.textContent = `${widget.icon || "🌤️"} ${errText}`;
    el.title = cache?.error === "Permission required"
      ? (t("weatherPermissionRequiredBarTitle") || "Open widget and click Refresh (↻) to grant permission")
      : loc;
    el.appendChild(span);
    return;
  }

  const tempStr = formatTemperature(cur.tempC, unit);
  const curCondLabel = cur.condKey ? tr(cur.condKey, cur.condition) : cur.condition;
  if (size === "pill") {
    const pillText = document.createElement("span");
    pillText.className = "custom-weather-pill-text";
    pillText.textContent = `${cur.icon} ${curCondLabel} ${tempStr}`;
    el.title = today
      ? `${loc} • H: ${formatTemperature(today.maxC, unit)} / L: ${formatTemperature(today.minC, unit)}`
      : loc;
    el.appendChild(pillText);
    return;
  }

  const header = document.createElement("div");
  header.className = "custom-weather-card-header";
  const locSpan = document.createElement("span");
  locSpan.className = "custom-weather-location";
  locSpan.textContent = `📍 ${loc}`;
  header.appendChild(locSpan);

  const mainRow = document.createElement("div");
  mainRow.className = "custom-weather-main-row";
  const iconSpan = document.createElement("span");
  iconSpan.className = "custom-weather-icon";
  iconSpan.textContent = cur.icon;
  const tempSpan = document.createElement("span");
  tempSpan.className = "custom-weather-temp";
  tempSpan.textContent = tempStr;
  const condSpan = document.createElement("span");
  condSpan.className = "custom-weather-cond";
  condSpan.textContent = curCondLabel;
  mainRow.append(iconSpan, tempSpan, condSpan);

  el.append(header, mainRow);

  if (today) {
    const todayRow = document.createElement("div");
    todayRow.className = "custom-weather-today-row";
    todayRow.textContent = `H: ${formatTemperature(today.maxC, unit)} · L: ${formatTemperature(today.minC, unit)} · 💧 ${today.precipPct}%`;
    el.appendChild(todayRow);
  }

  if (size === "medium" && Array.isArray(cache?.daily) && cache.daily.length > 0) {
    const forecastList = document.createElement("div");
    forecastList.className = "custom-weather-forecast-list";
    for (const day of cache.daily.slice(0, 3)) {
      const row = document.createElement("div");
      row.className = "custom-weather-forecast-row";
      const dLabel = document.createElement("span");
      dLabel.className = "custom-weather-forecast-day";
      dLabel.textContent = day.label;
      const dIcon = document.createElement("span");
      dIcon.textContent = day.icon;
      const dTemps = document.createElement("span");
      dTemps.className = "custom-weather-forecast-temps";
      dTemps.textContent = `${formatTemperature(day.minC, unit)} / ${formatTemperature(day.maxC, unit)}`;
      row.append(dLabel, dIcon, dTemps);
      forecastList.appendChild(row);
    }
    el.appendChild(forecastList);
  }
}

function ensureWeatherModalElement() {
  let modal = document.getElementById("weather-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "weather-modal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content weather-modal-content">
      <div class="weather-modal-header">
        <div class="weather-modal-title-wrap">
          <span class="weather-modal-icon">🌤️</span>
          <h3 class="weather-modal-title"></h3>
        </div>
        <div class="weather-modal-actions">
          <button type="button" class="icon-btn weather-unit-btn" title="Toggle °C / °F">°C</button>
          <button type="button" class="icon-btn weather-refresh-btn" title="Refresh">↻</button>
          <button type="button" class="icon-btn weather-close-btn" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="weather-modal-body"></div>
    </div>
  `;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  modal.querySelector(".weather-close-btn")?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      modal.classList.add("hidden");
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function openWeatherModal(el, widget) {
  const modal = ensureWeatherModalElement();
  const titleEl = modal.querySelector(".weather-modal-title");
  const iconEl = modal.querySelector(".weather-modal-icon");
  const unitBtn = modal.querySelector(".weather-unit-btn");
  const refreshBtn = modal.querySelector(".weather-refresh-btn");
  const bodyEl = modal.querySelector(".weather-modal-body");

  let activeUnit = normalizeWeatherUnit(widget.unit);
  if (titleEl) titleEl.textContent = widget.locationName || widget.name || "Weather";

  const renderBody = () => {
    if (unitBtn) unitBtn.textContent = `°${activeUnit}`;
    if (!bodyEl) return;
    bodyEl.innerHTML = "";

    const cache = weatherCacheByWidget[widget.id];
    const cur = cache?.current;
    if (iconEl) iconEl.textContent = cur?.icon || widget.icon || "🌤️";

    if (cache?.error === "Permission required") {
      const notice = document.createElement("div");
      notice.className = "rss-modal-permission-notice";
      const msg = document.createElement("span");
      msg.textContent = t("weatherPermissionRequiredNotice")
        || "Host permission is required to fetch weather data. Click Refresh (↻) or Grant permission & Refresh.";
      const grantBtn = document.createElement("button");
      grantBtn.type = "button";
      grantBtn.className = "icon-btn primary";
      grantBtn.textContent = t("rssGrantPermissionAndRefresh") || "Grant permission & Refresh";
      grantBtn.addEventListener("click", () => void handleRefresh(grantBtn));
      notice.append(msg, grantBtn);
      bodyEl.appendChild(notice);
    } else if (cache?.error && !cur) {
      const errBox = document.createElement("div");
      errBox.className = "rss-modal-empty";
      errBox.textContent = cache.error;
      bodyEl.appendChild(errBox);
      return;
    }

    if (!cur) return;

    const hero = document.createElement("div");
    hero.className = "weather-modal-hero";
    const tempEl = document.createElement("div");
    tempEl.className = "weather-modal-hero-temp";
    tempEl.textContent = `${cur.icon} ${formatTemperature(cur.tempC, activeUnit)}`;
    const metaEl = document.createElement("div");
    metaEl.className = "weather-modal-hero-meta";
    const curCondLabel = cur.condKey ? tr(cur.condKey, cur.condition) : cur.condition;
    const feels = Number.isFinite(cur.apparentTempC)
      ? tr("weatherFeelsLike", "Feels like {0}").replace("{0}", formatTemperature(cur.apparentTempC, activeUnit))
      : "";
    const hum = Number.isFinite(cur.humidity) ? `💧 ${cur.humidity}%` : "";
    const wind = Number.isFinite(cur.windKmh) ? `💨 ${Math.round(cur.windKmh)} km/h` : "";
    metaEl.textContent = [curCondLabel, feels, hum, wind].filter(Boolean).join(" • ");
    hero.append(tempEl, metaEl);
    bodyEl.appendChild(hero);

    if (Array.isArray(cache.hourly) && cache.hourly.length > 0) {
      const hStrip = document.createElement("div");
      hStrip.className = "weather-modal-hourly";
      for (const slot of cache.hourly) {
        const cell = document.createElement("div");
        cell.className = "weather-modal-hour-cell";
        const tSpan = document.createElement("span");
        tSpan.textContent = slot.time;
        const iSpan = document.createElement("span");
        iSpan.textContent = slot.icon;
        const vSpan = document.createElement("strong");
        vSpan.textContent = formatTemperature(slot.tempC, activeUnit);
        cell.append(tSpan, iSpan, vSpan);
        hStrip.appendChild(cell);
      }
      bodyEl.appendChild(hStrip);
    }

    if (Array.isArray(cache.daily) && cache.daily.length > 0) {
      const dList = document.createElement("div");
      dList.className = "weather-modal-daily";
      for (const day of cache.daily) {
        const row = document.createElement("div");
        row.className = "weather-modal-day-row";
        const nameSpan = document.createElement("span");
        nameSpan.className = "weather-modal-day-name";
        nameSpan.textContent = day.label;
        const condSpan = document.createElement("span");
        const dayCondLabel = day.condKey ? tr(day.condKey, day.condition) : day.condition;
        condSpan.textContent = `${day.icon} ${dayCondLabel}`;
        const precipSpan = document.createElement("span");
        precipSpan.className = "weather-modal-day-precip";
        precipSpan.textContent = `💧 ${day.precipPct}%`;
        const rangeSpan = document.createElement("strong");
        rangeSpan.textContent = `${formatTemperature(day.minC, activeUnit)} / ${formatTemperature(day.maxC, activeUnit)}`;
        row.append(nameSpan, condSpan, precipSpan, rangeSpan);
        dList.appendChild(row);
      }
      bodyEl.appendChild(dList);
    }
  };

  const handleRefresh = async (triggerBtn = null) => {
    if (refreshBtn) refreshBtn.disabled = true;
    if (triggerBtn && triggerBtn !== refreshBtn) triggerBtn.disabled = true;
    try {
      await requestWeatherPermission(widget.provider);
      const res = await fetchWeatherWidget(widget);
      const prev = weatherCacheByWidget[widget.id] || {};
      const locKey = getWeatherLocKey(widget);
      weatherCacheByWidget[widget.id] = res.ok
        ? { fetchedAt: Date.now(), locKey, current: res.current, daily: res.daily, hourly: res.hourly, error: null, vaultLocked: false }
        : { ...prev, fetchedAt: Date.now(), locKey, error: res.error, vaultLocked: Boolean(res.vaultLocked) };
      await persistWeatherCache();
      renderWeatherBarDom(el, widget);
      renderBody();
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
      if (triggerBtn && triggerBtn !== refreshBtn) triggerBtn.disabled = false;
    }
  };

  if (unitBtn) {
    unitBtn.onclick = () => {
      activeUnit = activeUnit === "C" ? "F" : "C";
      renderBody();
    };
  }
  if (refreshBtn) {
    refreshBtn.onclick = () => handleRefresh(refreshBtn);
  }

  renderBody();
  modal.classList.remove("hidden");
}

export function syncCustomWeatherWidgetElements(customWidgets = []) {
  const list = Array.isArray(customWidgets) ? customWidgets : [];
  const weatherWidgets = list.filter(w => w?.type === "weather" && w.id);
  const validIds = new Set(weatherWidgets.map(w => w.id));

  document.querySelectorAll(".custom-weather-widget[data-widget-id]").forEach(el => {
    if (!validIds.has(el.dataset.widgetId)) el.remove();
  });

  const elements = {};
  for (const w of weatherWidgets) {
    let el = document.querySelector(`.custom-weather-widget[data-widget-id="${CSS.escape(w.id)}"]`);
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "custom-weather-widget";
      el.dataset.widgetId = w.id;
    }
    el.onclick = () => openWeatherModal(el, w);
    renderWeatherBarDom(el, w);
    elements[w.id] = el;
  }

  void ensureWeatherCacheLoaded().then(() => {
    for (const w of weatherWidgets) {
      const el = elements[w.id];
      if (el) renderWeatherBarDom(el, w);
    }
  });

  return elements;
}

function getWeatherLocKey(widget) {
  return `${normalizeWeatherProvider(widget?.provider)}:${Number(widget?.latitude)},${Number(widget?.longitude)}`;
}

export async function pollAllWeatherWidgets({ force = false } = {}) {
  if (weatherPollInFlight) return;
  weatherPollInFlight = true;
  try {
    await ensureWeatherCacheLoaded();
    const config = await loadConfig();
    const customWidgets = Array.isArray(config?.appearance?.customWidgets) ? config.appearance.customWidgets : [];
    const active = customWidgets.filter(w => w?.type === "weather" && w.space !== "disabled");
    await pruneWeatherStorageForWidgets(customWidgets);
    if (active.length === 0) return;

    const now = Date.now();
    const staleEntries = active
      .map(w => ({ w, locKey: getWeatherLocKey(w), cache: weatherCacheByWidget[w.id] }))
      .filter(({ w, locKey, cache }) => {
        const refreshMs = normalizeWeatherRefreshMinutes(w.refreshMinutes) * 60 * 1000;
        return force || !cache?.fetchedAt || cache?.locKey !== locKey || (cache.vaultLocked && isVaultUnlocked()) || (now - cache.fetchedAt) >= refreshMs;
      });

    let changed = false;
    const WEATHER_FETCH_CONCURRENCY = 4;
    let nextIdx = 0;
    await Promise.all(
      Array.from({ length: Math.min(WEATHER_FETCH_CONCURRENCY, staleEntries.length) }, async () => {
        while (nextIdx < staleEntries.length) {
          const { w, locKey, cache } = staleEntries[nextIdx++];
          const res = await fetchWeatherWidget(w);
          weatherCacheByWidget[w.id] = res.ok
            ? { fetchedAt: now, locKey, current: res.current, daily: res.daily, hourly: res.hourly, error: null, vaultLocked: false }
            : { ...(cache || {}), fetchedAt: now, locKey, error: res.error, vaultLocked: Boolean(res.vaultLocked) };
          changed = true;
          const el = document.querySelector(`.custom-weather-widget[data-widget-id="${CSS.escape(w.id)}"]`);
          if (el) renderWeatherBarDom(el, w);
        }
      })
    );

    if (changed) {
      await persistWeatherCache();
    }
  } finally {
    weatherPollInFlight = false;
  }
}

export function startWeatherPolling() {
  if (weatherPollTimer) return;
  weatherPollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void pollAllWeatherWidgets({ force: false });
  }, WEATHER_POLL_TICK_MS);
}
