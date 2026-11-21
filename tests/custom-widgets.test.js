import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Minimal DOM/browser stubs so newtab/theme.js can be imported in Node.
globalThis.document = {
  documentElement: { style: { setProperty() {} }, dataset: {} },
  createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {} }),
  getElementById: () => null,
  querySelectorAll: () => []
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} })
};
globalThis.chrome = {
  i18n: { getMessage: (k) => k }
};

const {
  buildCustomSearchTargetUrl,
  normalizeCustomSearchRoutePrefixes,
  resolveCustomSearchRouteEngine,
  buildCustomSearchPreview,
  isValidCustomSearchUrlTemplate,
  isValidCustomSearchJsonTemplate,
  serializeCustomWidgetsExport,
  parseImportedCustomWidgets,
  stringifyAsciiJson,
  repairUtf8Mojibake,
  fetchCustomWidgetsFromUrl,
  groupCustomSearchWidgets,
  groupRestStatusWidgets,
  isValidTimeZone,
  isValidRestEndpointUrl,
  extractJsonPath,
  evaluateRestStatusRule,
  mapRestDisplayValue,
  evaluateRestResponse,
  parseRestMetricsText,
  formatRestMetricsText,
  fetchAndEvaluateRestWidget,
  normalizeNotesWidgetData,
  computeReminderTimestamp,
  formatReminderCountdown,
  findDueNoteReminders,
  resolveDateForTimeInZone,
  isValidTimeInputValue,
  getTimeZoneDayShift,
  normalizeCustomTimeZones,
  formatTimeForTimeZone,
  resolveCustomWidgetIcon,
  applyCustomWidgetUpdate,
  revertCustomWidgetVersion,
  parseFeedResponse,
  pruneRssStorageForWidgets,
  pruneNotesStorageForWidgets,
  mapWmoWeatherCode,
  formatTemperature,
  pruneWeatherStorageForWidgets
} = await import("../newtab/custom-widgets.js");

test("simple mode replaces multiple placeholders and encodes values", () => {
  const widget = {
    mode: "simple",
    urlTemplate: "https://www.google.com/search?q={query}&lang={lang}"
  };
  assert.equal(isValidCustomSearchUrlTemplate(widget.urlTemplate), true);
  assert.equal(
    buildCustomSearchTargetUrl(widget, { query: "hello world", lang: "en" }),
    "https://www.google.com/search?q=hello%20world&lang=en"
  );
});

test("json mode recursively omits empty variables and empty parent objects", () => {
  const widget = {
    mode: "json",
    urlTemplate: "https://example.com/knowledge/search/",
    jsonTemplate: '{"q":"{query}","tab":"All","f":{"documenttype":"{types}"}}',
    variables: [
      { key: "query", type: "text", label: "Search" },
      { key: "types", type: "multi", label: "Type", optionsText: "Doc=Doc\nGuide=Guide" }
    ]
  };
  assert.equal(isValidCustomSearchJsonTemplate(widget.jsonTemplate), true);

  const urlBasic = buildCustomSearchTargetUrl(widget, { query: "renew certificate", types: [] });
  assert.equal(
    decodeURIComponent(urlBasic.replace("https://example.com/knowledge/search/", "")),
    JSON.stringify({ q: "renew certificate", tab: "All" })
  );

  const urlWithFilter = buildCustomSearchTargetUrl(widget, { query: "test", types: ["Doc", "Guide"] });
  assert.equal(
    decodeURIComponent(urlWithFilter.replace("https://example.com/knowledge/search/", "")),
    JSON.stringify({ q: "test", tab: "All", f: { documenttype: ["Doc", "Guide"] } })
  );
});

test("json mode supports list, select, multi without query and explicit {json} placeholder", () => {
  const widget = {
    mode: "json",
    urlTemplate: "https://example.com/notes/search/",
    jsonTemplate: '{"searchTerm":"{query}","componentsExact":"{components}","releasedOnPreDefined":"{released}","priority":"{priority}"}',
    variables: [
      { key: "query", type: "text", label: "Search" },
      { key: "components", type: "list", label: "Components" },
      { key: "released", type: "select", label: "Released", optionsText: "Last 7 days=Last7Days" },
      { key: "priority", type: "multi", label: "Priority", optionsText: "Critical=P1\nHigh=P2" }
    ]
  };
  const url = buildCustomSearchTargetUrl(widget, {
    query: "",
    components: ["COMP-A", "COMP-B"],
    released: "Last7Days",
    priority: ["P1", "P2"]
  });
  assert.equal(
    decodeURIComponent(url.replace("https://example.com/notes/search/", "")),
    JSON.stringify({
      componentsExact: ["COMP-A", "COMP-B"],
      releasedOnPreDefined: "Last7Days",
      priority: ["P1", "P2"]
    })
  );

  assert.equal(buildCustomSearchTargetUrl(widget, { query: "" }), "https://example.com/notes/search/%7B%7D");

  const placeholderWidget = {
    mode: "json",
    urlTemplate: "https://example.com/search?state={json}&src=dial",
    jsonTemplate: '{"q":"{query}"}'
  };
  assert.equal(
    buildCustomSearchTargetUrl(placeholderWidget, { query: "test" }),
    "https://example.com/search?state=%7B%22q%22%3A%22test%22%7D&src=dial"
  );
});

test("buildCustomSearchPreview validates templates and formats json payload", () => {
  const ok = buildCustomSearchPreview(
    { mode: "json", urlTemplate: "https://example.com/s/", jsonTemplate: '{"q":"{query}"}' },
    { query: "hello" }
  );
  assert.equal(ok.valid, true);
  assert.equal(ok.url, "https://example.com/s/%7B%22q%22%3A%22hello%22%7D");
  assert.equal(JSON.parse(ok.jsonString).q, "hello");

  const badUrl = buildCustomSearchPreview({ mode: "simple", urlTemplate: "ftp://bad" }, {});
  assert.equal(badUrl.valid, false);
  assert.equal(badUrl.error, "invalid_url");
});

test("export/import preserves full widget config including customIcon and rejects unsafe entries", () => {
  const exported = serializeCustomWidgetsExport([
    {
      id: "cw-test-1",
      type: "custom-search",
      mode: "json",
      name: "Example JSON Search",
      icon: "🔍",
      customIcon: "https://example.com/favicon.ico",
      urlTemplate: "https://example.com/search/",
      jsonTemplate: '{"q":"{query}","priority":"{priority}"}',
      openInNewTab: true,
      variables: [
        { key: "query", label: "Search", type: "text", optionsText: "" },
        { key: "priority", label: "Priority", type: "multi", optionsText: "High=P1\nMedium=P2" }
      ],
      space: "right",
      align: "top",
      newRow: true
    }
  ]);
  assert.equal(exported.format, "simple-dial-custom-widgets");
  assert.equal(exported.version, 1);

  const parsed = parseImportedCustomWidgets(exported);
  assert.equal(parsed.validFormat, true);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.widgets.length, 1);
  assert.equal(parsed.widgets[0].customIcon, "https://example.com/favicon.ico");
  assert.equal(parsed.widgets[0].align, "top");
  assert.equal(parsed.widgets[0].newRow, true);

  const invalid = parseImportedCustomWidgets([
    { name: "Bad", urlTemplate: "javascript:alert(1)" },
    { name: "BadJson", mode: "json", urlTemplate: "https://example.com/", jsonTemplate: "{invalid" }
  ]);
  assert.equal(invalid.widgets.length, 0);
  assert.equal(invalid.skipped, 2);

  const iconRes = resolveCustomWidgetIcon({ icon: "🌐", customIcon: "data:image/png;base64,iVBORw0KGgo=" });
  assert.equal(iconRes.emoji, "🌐");
  assert.equal(iconRes.customIcon, "data:image/png;base64,iVBORw0KGgo=");
});

test("applyCustomWidgetUpdate stores previousVersion and revertCustomWidgetVersion restores it", () => {
  const original = {
    id: "cw-url-1",
    type: "custom-search",
    mode: "simple",
    name: "Docs v1",
    icon: "📘",
    customIcon: null,
    urlTemplate: "https://example.com/v1?q={query}",
    jsonTemplate: "",
    openInNewTab: false,
    variables: [{ key: "query", label: "Search", type: "text", optionsText: "" }],
    space: "left",
    align: "top",
    newRow: false,
    sourceUrl: "https://example.com/widgets.json"
  };
  const incomingV2 = {
    id: "cw-url-1",
    type: "custom-search",
    mode: "simple",
    name: "Docs v2",
    icon: "📕",
    customIcon: null,
    urlTemplate: "https://example.com/v2?q={query}",
    jsonTemplate: "",
    openInNewTab: true,
    variables: [{ key: "query", label: "Search", type: "text", optionsText: "" }],
    space: "right",
    align: "auto",
    newRow: true
  };

  const updated = applyCustomWidgetUpdate(original, incomingV2, "https://example.com/widgets.json");
  assert.equal(updated.name, "Docs v2");
  assert.equal(updated.space, "left");
  assert.equal(updated.align, "top");
  assert.equal(updated.previousVersion.name, "Docs v1");

  const reverted = revertCustomWidgetVersion(updated);
  assert.equal(reverted.name, "Docs v1");
  assert.equal(reverted.urlTemplate, "https://example.com/v1?q={query}");
  assert.equal(reverted.previousVersion, null);
});

test("groupCustomSearchWidgets groups by groupName and picks isDefault representative", () => {
  const widgets = [
    { id: "cw-1", type: "custom-search", name: "Brave", groupName: "Web Search", isDefault: false, urlTemplate: "https://search.brave.com/search?q={query}" },
    { id: "cw-2", type: "custom-search", name: "Google", groupName: "Web Search", isDefault: true, urlTemplate: "https://www.google.com/search?q={query}" },
    { id: "cw-3", type: "custom-search", name: "GitHub", groupName: "", isDefault: false, urlTemplate: "https://github.com/search?q={query}" },
    { id: "cw-4", type: "custom-search", name: "DDG", groupName: "Alt", isDefault: false, urlTemplate: "https://duckduckgo.com/?q={query}" },
    { id: "cw-5", type: "custom-search", name: "Bing", groupName: "Alt", isDefault: false, urlTemplate: "https://www.bing.com/search?q={query}" }
  ];
  const groups = groupCustomSearchWidgets(widgets);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].groupName, "Web Search");
  assert.equal(groups[0].representative.id, "cw-2");
  assert.equal(groups[0].members.length, 2);
  assert.equal(groups[1].groupName, "");
  assert.equal(groups[1].representative.id, "cw-3");
  assert.equal(groups[2].groupName, "Alt");
  assert.equal(groups[2].representative.id, "cw-4");
});

test("serializeCustomWidgetsExport and parseImportedCustomWidgets preserve groupName and isDefault", () => {
  const widgets = [
    {
      id: "cw-g",
      type: "custom-search",
      mode: "simple",
      name: "Google",
      icon: "🔎",
      urlTemplate: "https://www.google.com/search?q={query}",
      groupName: "Web Search",
      isDefault: true
    }
  ];
  const exported = serializeCustomWidgetsExport(widgets);
  const parsed = parseImportedCustomWidgets(exported);
  assert.equal(parsed.validFormat, true);
  assert.equal(parsed.widgets.length, 1);
  assert.equal(parsed.widgets[0].groupName, "Web Search");
  assert.equal(parsed.widgets[0].isDefault, true);
});

function resolveWidgetExamplesDir(t, subdir) {
  const candidates = [
    path.resolve("../simple-dial-widget-examples", subdir),
    path.resolve("widget-examples", subdir)
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      // ignore inaccessible candidate
    }
  }
  t.skip(`widget examples directory not present for ${subdir}`);
  return null;
}

test("widget-examples/search/*.json presets parse cleanly", (t) => {
  const searchDir = resolveWidgetExamplesDir(t, "search");
  if (!searchDir) return;
  const expectedFiles = [
    "google.json",
    "brave.json",
    "duckduckgo.json",
    "bing.json",
    "ecosia.json",
    "servicenow.json",
    "github-code.json",
    "wikipedia.json",
    "mdn.json",
    "youtube.json",
    "npm-packages.json",
    "all-search-engines.json"
  ];
  for (const file of expectedFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(searchDir, file), "utf8"));
    const parsed = parseImportedCustomWidgets(raw);
    assert.equal(parsed.validFormat, true, `${file} should have validFormat`);
    assert.equal(parsed.skipped, 0, `${file} should have 0 skipped`);
    assert.ok(parsed.widgets.length >= 1, `${file} should parse at least 1 widget`);
  }
  const allRaw = JSON.parse(fs.readFileSync(path.join(searchDir, "all-search-engines.json"), "utf8"));
  const allParsed = parseImportedCustomWidgets(allRaw);
  assert.equal(allParsed.widgets.length, 5);
  const groups = groupCustomSearchWidgets(allParsed.widgets);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupName, "Web Search");
  assert.equal(groups[0].representative.name, "Google");
});

test("timeZone helpers validate IANA zones and format time without date", () => {
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Invalid/Zone_Name"), false);

  const normalized = normalizeCustomTimeZones([
    { label: "UTC", timeZone: "UTC" },
    { label: "", timeZone: "America/New_York" },
    { label: "Bad", timeZone: "Not/A_Zone" }
  ]);
  assert.deepEqual(normalized, [
    { label: "UTC", timeZone: "UTC" },
    { label: "New York", timeZone: "America/New_York" }
  ]);

  const sampleDate = new Date("2026-11-15T14:05:09Z");
  const formatted24 = formatTimeForTimeZone(sampleDate, "UTC", { showSeconds: false, use24Hour: true });
  assert.equal(formatted24, "14:05");
  const formattedSec = formatTimeForTimeZone(sampleDate, "UTC", { showSeconds: true, use24Hour: true });
  assert.equal(formattedSec, "14:05:09");

  // TimeZone calculator: 22:00 in America/New_York (UTC-5 in Nov) -> 03:00 (+1d) UTC, 04:00 (+1d) Europe/Paris
  const refDate = new Date("2026-11-16T12:00:00Z");
  const resolved = resolveDateForTimeInZone("22:00", "America/New_York", refDate);
  assert.ok(resolved instanceof Date);
  assert.equal(formatTimeForTimeZone(resolved, "America/New_York", { use24Hour: true }), "22:00");
  assert.equal(formatTimeForTimeZone(resolved, "UTC", { use24Hour: true }), "03:00");
  assert.equal(formatTimeForTimeZone(resolved, "Europe/Paris", { use24Hour: true }), "04:00");
  assert.equal(getTimeZoneDayShift(resolved, "America/New_York", "America/New_York"), "");
  assert.equal(getTimeZoneDayShift(resolved, "Europe/Paris", "America/New_York"), "+1d");
  assert.equal(getTimeZoneDayShift(resolved, "America/New_York", "Europe/Paris"), "-1d");
  assert.equal(resolveDateForTimeInZone("99:99", "UTC", refDate), null);

  const resolvedPm = resolveDateForTimeInZone("2:30 PM", "UTC", refDate);
  assert.equal(formatTimeForTimeZone(resolvedPm, "UTC", { use24Hour: true }), "14:30");
  const resolvedMidnight = resolveDateForTimeInZone("12:15 AM", "UTC", refDate);
  assert.equal(formatTimeForTimeZone(resolvedMidnight, "UTC", { use24Hour: true }), "00:15");
  assert.equal(resolveDateForTimeInZone("13:00 PM", "UTC", refDate), null);

  // Colonless shorthand inputs
  const resolvedCompact = resolveDateForTimeInZone("1528", "UTC", refDate);
  assert.equal(formatTimeForTimeZone(resolvedCompact, "UTC", { use24Hour: true }), "15:28");
  const resolvedCompact3 = resolveDateForTimeInZone("930", "UTC", refDate);
  assert.equal(formatTimeForTimeZone(resolvedCompact3, "UTC", { use24Hour: true }), "09:30");
  const resolvedCompactSec = resolveDateForTimeInZone("152809", "UTC", refDate);
  assert.equal(formatTimeForTimeZone(resolvedCompactSec, "UTC", { showSeconds: true, use24Hour: true }), "15:28:09");

  // Input validation rejects >23h and >59m
  assert.equal(isValidTimeInputValue("15:28", true, false), true);
  assert.equal(isValidTimeInputValue("23:59", true, false), true);
  assert.equal(isValidTimeInputValue("15:87", true, false), false);
  assert.equal(isValidTimeInputValue("1587", true, false), false);
  assert.equal(isValidTimeInputValue("24:00", true, false), false);
  assert.equal(isValidTimeInputValue("2500", true, false), false);
  assert.equal(isValidTimeInputValue("13:00", false, false), false);
});

test("export/import preserves timezone custom widgets and skips invalid ones", () => {
  const widgets = [
    {
      id: "cw-tz-1",
      type: "timezone",
      name: "World Clocks",
      icon: "🕒",
      timeZones: [
        { label: "UTC", timeZone: "UTC" },
        { label: "Tokyo", timeZone: "Asia/Tokyo" }
      ],
      showSeconds: true,
      use24Hour: false,
      space: "left"
    }
  ];
  const exported = serializeCustomWidgetsExport(widgets);
  const parsed = parseImportedCustomWidgets(exported);
  assert.equal(parsed.validFormat, true);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.widgets.length, 1);
  assert.equal(parsed.widgets[0].type, "timezone");
  assert.equal(parsed.widgets[0].showSeconds, true);
  assert.equal(parsed.widgets[0].use24Hour, false);
  assert.deepEqual(parsed.widgets[0].timeZones, [
    { label: "UTC", timeZone: "UTC" },
    { label: "Tokyo", timeZone: "Asia/Tokyo" }
  ]);

  const invalidImport = parseImportedCustomWidgets({
    type: "timezone",
    name: "Broken",
    timeZones: [{ label: "Nope", timeZone: "Invalid/Zone" }]
  });
  assert.equal(invalidImport.widgets.length, 0);
  assert.equal(invalidImport.skipped, 1);
});

test("routePrefixes normalize, export/import, and route queries by longest matching prefix", () => {
  assert.deepEqual(normalizeCustomSearchRoutePrefixes(" INC, in , INC , CHG , "), ["INC", "in", "CHG"]);

  const globalEngine = {
    id: "cw-global",
    type: "custom-search",
    name: "Global Search",
    groupName: "SNOW",
    isDefault: true,
    urlTemplate: "https://snow.example/search?q={query}",
    routePrefixes: []
  };
  const incEngine = {
    id: "cw-inc",
    type: "custom-search",
    name: "Incidents",
    groupName: "SNOW",
    isDefault: false,
    urlTemplate: "https://snow.example/incident_list.do?sysparm_query=numberLIKE{query}",
    routePrefixes: ["IN", "INC"]
  };
  const chgEngine = {
    id: "cw-chg",
    type: "custom-search",
    name: "Changes",
    groupName: "SNOW",
    isDefault: false,
    urlTemplate: "https://snow.example/change_request_list.do?sysparm_query=numberLIKE{query}",
    routePrefixes: ["CHG"]
  };
  const ctaskEngine = {
    id: "cw-ctask",
    type: "custom-search",
    name: "Change Tasks",
    groupName: "SNOW",
    isDefault: false,
    urlTemplate: "https://snow.example/change_task_list.do?sysparm_query=numberLIKE{query}",
    routePrefixes: ["C", "CTASK"]
  };

  const members = [globalEngine, incEngine, chgEngine, ctaskEngine];
  assert.equal(resolveCustomSearchRouteEngine(members, "inc001234", globalEngine).id, "cw-inc");
  assert.equal(resolveCustomSearchRouteEngine(members, "in999", globalEngine).id, "cw-inc");
  assert.equal(resolveCustomSearchRouteEngine(members, "  chg0042  ", globalEngine).id, "cw-chg");
  assert.equal(resolveCustomSearchRouteEngine(members, "CTASK001", globalEngine).id, "cw-ctask");
  assert.equal(resolveCustomSearchRouteEngine(members, "something else", globalEngine).id, "cw-global");
  assert.equal(resolveCustomSearchRouteEngine(members, "", globalEngine).id, "cw-global");

  const exported = serializeCustomWidgetsExport(members);
  const imported = parseImportedCustomWidgets(exported);
  assert.equal(imported.validFormat, true);
  assert.deepEqual(imported.widgets[1].routePrefixes, ["IN", "INC"]);
  assert.deepEqual(imported.widgets[2].routePrefixes, ["CHG"]);

  const updatedFromOlder = applyCustomWidgetUpdate(incEngine, {
    ...incEngine,
    routePrefixes: []
  });
  assert.deepEqual(updatedFromOlder.routePrefixes, ["IN", "INC"]);
});

test("REST / JSON status badge helpers extract paths, evaluate rules, and export/import safely", () => {
  assert.equal(isValidRestEndpointUrl("https://homelab.local/api/health"), true);
  assert.equal(isValidRestEndpointUrl("http://192.168.1.10:8080/status"), true);
  assert.equal(isValidRestEndpointUrl("javascript:alert(1)"), false);

  const sample = {
    status: "healthy",
    data: { active_queries: 42, load: 85 },
    services: [{ state: "running" }],
    metrics: { "cpu.temp": 61 }
  };
  assert.equal(extractJsonPath(sample, "status"), "healthy");
  assert.equal(extractJsonPath(sample, "data.active_queries"), 42);
  assert.equal(extractJsonPath(sample, "services[0].state"), "running");
  assert.equal(extractJsonPath(sample, "metrics['cpu.temp']"), 61);
  assert.equal(extractJsonPath(sample, "__proto__"), undefined);
  assert.equal(extractJsonPath(sample, "missing.key"), undefined);

  assert.equal(evaluateRestStatusRule("Healthy", "ok, healthy, true"), true);
  assert.equal(evaluateRestStatusRule(75, "<80"), true);
  assert.equal(evaluateRestStatusRule(85, "<80"), false);
  assert.equal(evaluateRestStatusRule(85, ">=80"), true);

  assert.deepEqual(
    evaluateRestResponse({ ok: true, status: 200, data: sample, latencyMs: 12 }, {
      jsonPath: "data.load",
      valueSuffix: "%",
      okMatch: "<80",
      warnMatch: ">=80"
    }),
    { state: "warn", text: "85%", detail: "HTTP 200 · 12 ms" }
  );

  assert.deepEqual(
    evaluateRestResponse({ ok: true, status: 200, data: sample, latencyMs: 15 }, {
      jsonPath: "status",
      okMatch: "ok, healthy"
    }),
    { state: "ok", text: "healthy", detail: "HTTP 200 · 15 ms" }
  );

  assert.deepEqual(
    evaluateRestResponse({ ok: false, status: 502 }, { jsonPath: "status" }),
    { state: "err", text: "HTTP 502", detail: "HTTP 502" }
  );

  assert.deepEqual(
    evaluateRestResponse({ ok: true, status: 200, latencyMs: 9 }, { method: "HEAD" }),
    { state: "ok", text: "9ms", detail: "HTTP 200 · 9 ms" }
  );

  // Plain-text and HTML status page matching without jsonPath
  assert.deepEqual(
    evaluateRestResponse({ ok: true, status: 200, data: "OK", latencyMs: 7 }, { okMatch: "OK, UP" }),
    { state: "ok", text: "OK", detail: "HTTP 200 · 7 ms" }
  );
  assert.deepEqual(
    evaluateRestResponse(
      { ok: true, status: 200, data: "<html><body><h1>All Systems Operational</h1></body></html>", latencyMs: 18 },
      { okMatch: "~All Systems Operational", warnMatch: "~Degraded Performance" }
    ),
    { state: "ok", text: "18ms", detail: "HTTP 200 · 18 ms" }
  );
  assert.deepEqual(
    evaluateRestResponse(
      { ok: true, status: 200, data: "<html><body>Degraded Performance</body></html>", latencyMs: 22 },
      { okMatch: "~All Systems Operational", warnMatch: "~Degraded Performance" }
    ),
    { state: "warn", text: "22ms", detail: "HTTP 200 · 22 ms" }
  );

  const exported = serializeCustomWidgetsExport([
    {
      id: "cw-rest-1",
      type: "rest-status",
      name: "Pi-hole",
      icon: "📡",
      endpointUrl: "https://pihole.local/admin/api.php?summary",
      method: "GET",
      jsonPath: "status",
      valueSuffix: "",
      refreshSeconds: 30,
      okMatch: "enabled",
      warnMatch: "disabled",
      linkUrl: "https://pihole.local/admin",
      groupName: "Homelab",
      space: "header"
    }
  ]);
  const imported = parseImportedCustomWidgets(exported);
  assert.equal(imported.validFormat, true);
  assert.equal(imported.widgets.length, 1);
  assert.equal(imported.widgets[0].type, "rest-status");
  assert.equal(imported.widgets[0].endpointUrl, "https://pihole.local/admin/api.php?summary");
  assert.equal(imported.widgets[0].groupName, "Homelab");
  assert.equal(imported.widgets[0].refreshSeconds, 30);

  const grouped = groupRestStatusWidgets([
    { id: "r1", type: "rest-status", name: "Pi-hole", groupName: "Homelab", endpointUrl: "http://pi.hole/api" },
    { id: "r2", type: "rest-status", name: "Proxmox", groupName: "homelab", endpointUrl: "https://pve.local/api" },
    { id: "r3", type: "rest-status", name: "GitHub", groupName: "", endpointUrl: "https://www.githubstatus.com/api/v2/status.json" }
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].groupName, "Homelab");
  assert.equal(grouped[0].members.length, 2);
  assert.equal(grouped[0].representative.id, "r1");
  assert.equal(grouped[1].members.length, 1);

  // Array .length path & valueMap display mapping
  assert.equal(extractJsonPath({ incidents: [{ id: 1 }, { id: 2 }] }, "incidents.length"), 2);
  assert.equal(mapRestDisplayValue("none", "none=OK, minor=Minor"), "OK");
  assert.deepEqual(
    evaluateRestResponse(
      { ok: true, status: 200, data: { status: { indicator: "none" } }, latencyMs: 14 },
      { jsonPath: "status.indicator", okMatch: "none", valueMap: "none=OK, minor=Minor" }
    ),
    { state: "ok", text: "OK", detail: "HTTP 200 · 14 ms" }
  );

  // Redact authHeaderValue on export by default
  const redactedExport = serializeCustomWidgetsExport([
    {
      id: "r-secret",
      type: "rest-status",
      name: "SecretAPI",
      endpointUrl: "https://api.internal/health",
      authHeaderName: "Authorization",
      authHeaderValue: "Bearer super-secret-token"
    }
  ]);
  assert.equal(redactedExport.widgets[0].authHeaderValue, "");
  const withSecretsExport = serializeCustomWidgetsExport(
    [{ id: "r-secret", type: "rest-status", name: "SecretAPI", endpointUrl: "https://api.internal/health", authHeaderValue: "Bearer super-secret-token" }],
    { includeSecrets: true }
  );
  assert.equal(withSecretsExport.widgets[0].authHeaderValue, "Bearer super-secret-token");

  // Encrypted hashes (enc:v1:...) must never leave the addon on export or import
  const encExport = serializeCustomWidgetsExport(
    [{ id: "r-enc", type: "rest-status", name: "EncAPI", endpointUrl: "https://api.internal/health", authHeaderValue: "enc:v1:iv:ct" }],
    { includeSecrets: true }
  );
  assert.equal(encExport.widgets[0].authHeaderValue, "");
  const encImport = parseImportedCustomWidgets([
    { id: "r-enc", type: "rest-status", name: "EncAPI", endpointUrl: "https://api.internal/health", authHeaderValue: "enc:v1:iv:ct" }
  ]);
  assert.equal(encImport.widgets[0].authHeaderValue, "");

  const badImport = parseImportedCustomWidgets([
    { type: "rest-status", name: "Bad", endpointUrl: "javascript:alert(1)" }
  ]);
  assert.equal(badImport.widgets.length, 0);
  assert.equal(badImport.skipped, 1);
});

test("REST status widgets support extra metrics from the same response", () => {
  const widget = {
    jsonPath: "data.version",
    metrics: [
      { label: "CPU", jsonPath: "data.cpu", valueSuffix: "%", okMatch: "<90", warnMatch: ">=90" },
      { label: "Up", jsonPath: "data.uptime", valueSuffix: "s" },
      { label: "Missing", jsonPath: "data.nope" }
    ]
  };
  const res = evaluateRestResponse({
    ok: true,
    status: 200,
    data: { data: { version: "8.2", cpu: 95, uptime: 120 } },
    latencyMs: 10
  }, widget);
  assert.equal(res.text, "8.2");
  assert.equal(res.state, "warn");
  assert.deepEqual(res.metrics, [
    { label: "CPU", text: "95%", state: "warn" },
    { label: "Up", text: "120s", state: "ok" },
    { label: "Missing", text: "N/A", state: "warn" }
  ]);

  const worst = evaluateRestResponse({
    ok: true, status: 200, data: { v: 1, cpu: 50 }, latencyMs: 5
  }, { jsonPath: "v", metrics: [{ label: "CPU", jsonPath: "cpu", okMatch: ">80" }] });
  assert.equal(worst.state, "err");

  const text = "CPU | data.cpu | % | <90 | >=90\nUptime | data.uptime | s";
  const parsed = parseRestMetricsText(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].warnMatch, ">=90");
  assert.equal(formatRestMetricsText(parsed), text);

  const scaled = evaluateRestResponse({
    ok: true, status: 200, data: { v: "x", cpu: 0.955, mem: 8589934592 }, latencyMs: 5
  }, { jsonPath: "v", metrics: [
    { label: "CPU", jsonPath: "cpu", valueSuffix: "%", warnMatch: ">=90", scale: 100 },
    { label: "RAM", jsonPath: "mem", valueSuffix: " GB", scale: 9.313225746154785e-10 }
  ] });
  assert.equal(scaled.metrics[0].text, "95.5%");
  assert.equal(scaled.metrics[0].state, "warn");
  assert.equal(scaled.metrics[1].text, "8 GB");
  assert.equal(parseRestMetricsText("CPU | cpu | % | | | | 100")[0].scale, 100);

  const imported = parseImportedCustomWidgets(serializeCustomWidgetsExport([{
    id: "r-m", type: "rest-status", name: "PVE", endpointUrl: "https://pve.local:8006/api2/json/nodes/pve/status",
    jsonPath: "data.pveversion", metrics: parsed, collapseMetrics: true
  }]));
  assert.equal(imported.widgets[0].metrics.length, 2);
  assert.equal(imported.widgets[0].collapseMetrics, true);
});

test("widget-examples/rest-status/*.json presets parse cleanly", (t) => {
  const presetsDir = resolveWidgetExamplesDir(t, "rest-status");
  if (!presetsDir) return;
  const files = fs.readdirSync(presetsDir).filter(f => f.endsWith(".json")).sort();
  assert.equal(files.length, 9);
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8"));
    const parsed = parseImportedCustomWidgets(raw);
    assert.equal(parsed.validFormat, true, `${file} should have validFormat`);
    assert.equal(parsed.skipped, 0, `${file} should have 0 skipped`);
    assert.ok(parsed.widgets.length >= 1, `${file} should contain at least 1 widget`);
    assert.ok(parsed.widgets.every(w => w.type === "rest-status"));
  }
});

test("widget-examples/timezone/*.json presets parse cleanly", (t) => {
  const presetsDir = resolveWidgetExamplesDir(t, "timezone");
  if (!presetsDir) return;
  const files = fs.readdirSync(presetsDir).filter(f => f.endsWith(".json")).sort();
  assert.equal(files.length, 3);
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8"));
    const parsed = parseImportedCustomWidgets(raw);
    assert.equal(parsed.validFormat, true, `${file} should have validFormat`);
    assert.equal(parsed.skipped, 0, `${file} should have 0 skipped`);
    assert.equal(parsed.widgets.length, 1, `${file} should contain 1 widget`);
    assert.equal(parsed.widgets[0].type, "timezone");
  }
});

test("widget-examples/notes/*.json presets parse cleanly", (t) => {
  const presetsDir = resolveWidgetExamplesDir(t, "notes");
  if (!presetsDir) return;
  const files = fs.readdirSync(presetsDir).filter(f => f.endsWith(".json")).sort();
  assert.equal(files.length, 3);
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8"));
    const parsed = parseImportedCustomWidgets(raw);
    assert.equal(parsed.validFormat, true, `${file} should have validFormat`);
    assert.equal(parsed.skipped, 0, `${file} should have 0 skipped`);
    assert.equal(parsed.widgets.length, 1, `${file} should contain 1 widget`);
    assert.equal(parsed.widgets[0].type, "notes");
  }
});

test("resolveCustomWidgetIcon keeps emoji icons as emoji without converting to punycode URLs", () => {
  assert.deepEqual(resolveCustomWidgetIcon({ icon: "🕒" }), { emoji: "🕒", customIcon: null });
  assert.deepEqual(resolveCustomWidgetIcon({ icon: "📡" }), { emoji: "📡", customIcon: null });
  assert.deepEqual(
    resolveCustomWidgetIcon({ icon: "📡", customIcon: "example.com/icon.png" }),
    { emoji: "📡", customIcon: "https://example.com/icon.png" }
  );
});

test("fetchAndEvaluateRestWidget handles AbortError timeouts cleanly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  };
  try {
    const res = await fetchAndEvaluateRestWidget({ endpointUrl: "https://homelab.local/api/health" });
    assert.equal(res.state, "err");
    assert.equal(res.text, "TIMEOUT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Notes / Scratchpad widget helpers compute reminders, detect due todos, and export/import", () => {
  const baseMs = new Date("2026-11-17T10:00:00").getTime();
  assert.equal(computeReminderTimestamp("none", "", baseMs), null);
  assert.equal(computeReminderTimestamp("15", "", baseMs), baseMs + 15 * 60 * 1000);

  const at1030 = computeReminderTimestamp("custom", "10:30", baseMs);
  assert.equal(at1030, new Date("2026-11-17T10:30:00").getTime());

  // Time earlier than now rolls over to next day
  const at0900 = computeReminderTimestamp("custom", "09:00", baseMs);
  assert.equal(at0900, new Date("2026-11-18T09:00:00").getTime());

  assert.equal(formatReminderCountdown(baseMs + 10 * 60000, baseMs, false).label, "10m");
  assert.equal(formatReminderCountdown(baseMs + 3 * 60000, baseMs, false).status, "soon");
  assert.equal(formatReminderCountdown(baseMs - 1000, baseMs, false).status, "due");
  assert.equal(formatReminderCountdown(baseMs - 1000, baseMs, true).status, "done");

  // Legacy { text, todos } format auto-migrates to { entries: [...] }
  const migrated = normalizeNotesWidgetData({
    text: "Scratchpad",
    todos: [
      { id: "t1", text: "Due task", done: false, remindAt: baseMs - 5000, notified: false },
      { id: "t2", text: "Already notified", done: false, remindAt: baseMs - 5000, notified: true },
      { id: "t3", text: "Completed", done: true, remindAt: baseMs - 5000, notified: false },
      { id: "t4", text: "Future", done: false, remindAt: baseMs + 60000, notified: false }
    ]
  });
  assert.equal(migrated.entries.length, 1);
  assert.equal(migrated.entries[0].body, "Scratchpad");
  assert.equal(migrated.entries[0].todos.length, 4);

  // Multi-entry format preserves entries and reports entryId & entryTitle on due reminders
  const multi = normalizeNotesWidgetData({
    entries: [
      {
        id: "entry-1",
        title: "Deploy checklist",
        body: "Run smoke tests before release",
        todos: [
          { id: "e1t1", text: "Tag release", done: false, remindAt: baseMs + 60000, notified: false }
        ]
      },
      {
        id: "entry-2",
        title: "",
        body: "",
        todos: [
          { id: "e2t1", text: "Call dentist", done: false, remindAt: baseMs - 2000, notified: false }
        ]
      }
    ]
  });
  assert.equal(multi.entries.length, 2);
  assert.equal(multi.entries[0].title, "Deploy checklist");

  const due = findDueNoteReminders({
    "cw-notes-1": migrated,
    "cw-notes-2": multi
  }, baseMs);
  assert.equal(due.length, 2);
  assert.equal(due[0].widgetId, "cw-notes-1");
  assert.equal(due[0].todo.id, "t1");
  assert.equal(due[1].widgetId, "cw-notes-2");
  assert.equal(due[1].entryId, "entry-2");
  assert.equal(due[1].entryTitle, "");
  assert.equal(due[1].todo.id, "e2t1");

  const exported = serializeCustomWidgetsExport([
    { id: "cw-notes-1", type: "notes", name: "Work Notes", icon: "📝", compactMode: true, space: "left" }
  ]);
  const imported = parseImportedCustomWidgets(exported);
  assert.equal(imported.validFormat, true);
  assert.equal(imported.widgets.length, 1);
  assert.equal(imported.widgets[0].type, "notes");
  assert.equal(imported.widgets[0].compactMode, true);

  // Character limits are enforced on title, body, and todo text
  const bounded = normalizeNotesWidgetData({
    entries: [{
      id: "long-1",
      title: "T".repeat(300),
      body: "B".repeat(5000),
      todos: [{ id: "lt1", text: "X".repeat(500), done: false }]
    }]
  });
  assert.equal(bounded.entries[0].title.length, 120);
  assert.equal(bounded.entries[0].body.length, 2000);
  assert.equal(bounded.entries[0].todos[0].text.length, 240);
});

test("repairUtf8Mojibake and fetchCustomWidgetsFromUrl decode UTF-8 and fix Windows-1252/1250 mojibake", async () => {
  assert.equal(repairUtf8Mojibake("ðŸ”Ž SNOW Global Search"), "🔎 SNOW Global Search");
  assert.equal(repairUtf8Mojibake("đź”Ž SNOW Global Search"), "🔎 SNOW Global Search");
  assert.equal(repairUtf8Mojibake("đźŽ« SNOW Incidents"), "🎫 SNOW Incidents");
  assert.equal(repairUtf8Mojibake("đź”„ SNOW Changes"), "🔄 SNOW Changes");
  assert.equal(repairUtf8Mojibake("đź“‹ SNOW Change Tasks"), "📋 SNOW Change Tasks");
  assert.equal(repairUtf8Mojibake("AutomatickÃ© smerovanie"), "Automatické smerovanie");
  assert.equal(repairUtf8Mojibake("Automatické smerovanie 🔎"), "Automatické smerovanie 🔎");

  const asciiJson = stringifyAsciiJson({ name: "Automatické smerovanie", icon: "🔎" });
  assert.equal(/[^\x00-\x7f]/.test(asciiJson), false);
  assert.deepEqual(JSON.parse(asciiJson), { name: "Automatické smerovanie", icon: "🔎" });

  const payload = JSON.stringify({
    version: 1,
    widgets: [
      {
        id: "cw-utf8-1",
        type: "custom-search",
        mode: "simple",
        name: "SNOW Global Search",
        icon: "ðŸ”Ž",
        urlTemplate: "https://example.com/search?q={query}",
        variables: [{ key: "query", label: "Query", type: "text" }]
      }
    ]
  });
  const bomBytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(payload, "utf8")]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async arrayBuffer() {
      return bomBytes.buffer.slice(bomBytes.byteOffset, bomBytes.byteOffset + bomBytes.byteLength);
    }
  });
  try {
    const res = await fetchCustomWidgetsFromUrl("https://example.com/widgets.json");
    assert.equal(res.widgets.length, 1);
    assert.equal(res.widgets[0].icon, "🔎");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serializeCustomWidgetsExport and parseImportedCustomWidgets preserve auto-route custom icons and defaults", () => {
  const exported = serializeCustomWidgetsExport(
    [
      {
        id: "cw-snow-1",
        type: "custom-search",
        mode: "simple",
        name: "SNOW Incidents",
        groupName: "Automatické smerovanie",
        urlTemplate: "https://example.com/snow?q={query}",
        routePrefixes: ["INC"]
      }
    ],
    {
      autoRouteIcons: {
        "automatické smerovanie": "data:image/png;base64,iVBORw0KGgo=",
        "unused group": "https://example.com/ignored.png",
        "bad-proto": "javascript:alert(1)"
      },
      autoRouteDefaults: {
        "automatické smerovanie": true,
        "unused group": false
      }
    }
  );
  assert.deepEqual(exported.customSearchAutoRouteIcons, {
    "automatické smerovanie": "data:image/png;base64,iVBORw0KGgo="
  });
  assert.deepEqual(exported.customSearchAutoRouteDefaults, {
    "automatické smerovanie": true
  });

  const imported = parseImportedCustomWidgets(exported);
  assert.equal(imported.validFormat, true);
  assert.deepEqual(imported.autoRouteIcons, {
    "automatické smerovanie": "data:image/png;base64,iVBORw0KGgo="
  });
  assert.deepEqual(imported.autoRouteDefaults, {
    "automatické smerovanie": true
  });
});

test("parseImportedCustomWidgets resolves legacy timezone abbreviations like IST", () => {
  const imported = parseImportedCustomWidgets({
    version: 1,
    widgets: [
      {
        id: "cw-tz-ist",
        type: "timezone",
        name: "World Clocks",
        timeZones: [
          { label: "UTC", timeZone: "UTC" },
          { label: "India", timeZone: "IST" },
          { timeZone: "IST" }
        ]
      }
    ]
  });
  assert.equal(imported.validFormat, true);
  assert.equal(imported.widgets.length, 1);
  assert.equal(imported.widgets[0].timeZones.length, 3);
  assert.equal(imported.widgets[0].timeZones[0].timeZone, "UTC");
  assert.equal(imported.widgets[0].timeZones[1].label, "India");
  assert.ok(["IST", "Asia/Kolkata"].includes(imported.widgets[0].timeZones[1].timeZone));
  assert.equal(imported.widgets[0].timeZones[2].label, "IST");
});

test("parseFeedResponse parses RSS 2.0, Atom, JSON Feed, and rejects unsafe links", () => {
  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Tech News</title>
        <item>
          <title><![CDATA[Hello <b>World</b> &amp; Friends]]></title>
          <link>https://news.example/post-1</link>
          <guid>post-1</guid>
          <pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Bad XSS</title>
          <link>javascript:alert(1)</link>
        </item>
      </channel>
    </rss>`;
  const rssParsed = parseFeedResponse(rssXml, "https://news.example/rss.xml");
  assert.equal(rssParsed.feedTitle, "Tech News");
  assert.equal(rssParsed.items.length, 1);
  assert.equal(rssParsed.items[0].title, "Hello World & Friends");
  assert.equal(rssParsed.items[0].link, "https://news.example/post-1");

  const atomXml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Updates</title>
      <entry>
        <title>Release v2</title>
        <link rel="alternate" href="/releases/v2"/>
        <id>tag:example,2026:v2</id>
        <updated>2026-11-20T12:00:00Z</updated>
      </entry>
    </feed>`;
  const atomParsed = parseFeedResponse(atomXml, "https://atom.example/feed.atom");
  assert.equal(atomParsed.items.length, 1);
  assert.equal(atomParsed.items[0].link, "https://atom.example/releases/v2");

  const jsonFeed = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "JSON Feed",
    items: [
      { id: "jf-1", title: "JSON Item", url: "https://jf.example/1", date_published: "2026-11-20T09:00:00Z" }
    ]
  });
  const jsonParsed = parseFeedResponse(jsonFeed, "https://jf.example/feed.json");
  assert.equal(jsonParsed.items.length, 1);
  assert.equal(jsonParsed.items[0].title, "JSON Item");

  const exported = serializeCustomWidgetsExport([
    {
      id: "cw-rss-1",
      type: "rss-feed",
      name: "HN",
      icon: "📰",
      feedUrl: "https://news.ycombinator.com/rss",
      refreshMinutes: 15,
      maxItems: 10,
      groupName: "News",
      space: "header"
    }
  ]);
  const imported = parseImportedCustomWidgets(exported);
  assert.equal(imported.validFormat, true);
  assert.equal(imported.widgets.length, 1);
  assert.equal(imported.widgets[0].type, "rss-feed");
  assert.equal(imported.widgets[0].feedUrl, "https://news.ycombinator.com/rss");
  assert.equal(imported.widgets[0].refreshMinutes, 15);
  assert.equal(imported.widgets[0].maxItems, 10);
  assert.equal(imported.widgets[0].groupName, "News");
});

test("pruneRssStorageForWidgets removes stale RSS cache and read state for deleted widgets", async () => {
  const store = new Map([
    ["myspeeddial-rss-cache", {
      "cw-rss-keep": { fetchedAt: 100, items: [] },
      "cw-rss-deleted": { fetchedAt: 100, items: [{ id: "1", title: "Old" }] }
    }],
    ["myspeeddial-rss-read", {
      "cw-rss-keep": ["a"],
      "cw-rss-deleted": ["b"]
    }]
  ]);
  const prevChrome = globalThis.chrome;
  globalThis.chrome = {
    ...prevChrome,
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (store.has(k)) out[k] = structuredClone(store.get(k));
          }
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v));
        }
      }
    }
  };
  try {
    const pruned = await pruneRssStorageForWidgets([{ id: "cw-rss-keep", type: "rss-feed" }]);
    assert.equal(pruned, true);
    assert.deepEqual(Object.keys(store.get("myspeeddial-rss-cache")), ["cw-rss-keep"]);
    assert.deepEqual(Object.keys(store.get("myspeeddial-rss-read")), ["cw-rss-keep"]);
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test("pruneNotesStorageForWidgets removes stale Notes data for deleted widgets", async () => {
  const store = new Map([
    ["myspeeddial-widget-notes", {
      "cw-notes-keep": { entries: [{ id: "e1", title: "Keep", body: "", todos: [] }] },
      "cw-notes-deleted": { entries: [{ id: "e2", title: "Old", body: "", todos: [] }] }
    }]
  ]);
  const prevChrome = globalThis.chrome;
  globalThis.chrome = {
    ...prevChrome,
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (store.has(k)) out[k] = structuredClone(store.get(k));
          }
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v));
        }
      }
    }
  };
  try {
    const pruned = await pruneNotesStorageForWidgets([{ id: "cw-notes-keep", type: "notes" }]);
    assert.equal(pruned, true);
    assert.deepEqual(Object.keys(store.get("myspeeddial-widget-notes")), ["cw-notes-keep"]);
  } finally {
    globalThis.chrome = prevChrome;
  }
});


test("weather helpers format temperatures, map WMO codes, strip apiKey on export, and prune stale cache", async () => {
  assert.equal(formatTemperature(24.4, "C"), "24°C");
  assert.equal(formatTemperature(0, "F"), "32°F");
  assert.deepEqual(mapWmoWeatherCode(3), { icon: "☁️", key: "weatherCondCloudy", label: "Cloudy" });

  const exported = serializeCustomWidgetsExport([
    {
      id: "cw-weather-1",
      type: "weather",
      name: "Prague",
      provider: "openweathermap",
      locationName: "Prague, CZ",
      latitude: 50.0755,
      longitude: 14.4378,
      displaySize: "medium",
      unit: "C",
      refreshMinutes: 30,
      apiKey: "secret-owm-key"
    }
  ]);
  assert.equal(exported.widgets[0].apiKey, "");
  assert.equal(exported.widgets[0].hadSecret, true);
  assert.equal(exported.widgets[0].space, "left");

  const imported = parseImportedCustomWidgets(exported);
  assert.equal(imported.validFormat, true);
  assert.equal(imported.widgets.length, 1);
  assert.equal(imported.widgets[0].displaySize, "medium");
  assert.equal(imported.widgets[0].space, "left");

  const store = new Map([
    ["myspeeddial-weather-cache", {
      "cw-weather-keep": { fetchedAt: 1000, current: { tempC: 20 } },
      "cw-weather-del": { fetchedAt: 1000, current: { tempC: 10 } }
    }]
  ]);
  const prevChrome = globalThis.chrome;
  globalThis.chrome = {
    ...prevChrome,
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (store.has(k)) out[k] = structuredClone(store.get(k));
          }
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v));
        }
      }
    }
  };
  try {
    const pruned = await pruneWeatherStorageForWidgets([{ id: "cw-weather-keep", type: "weather" }]);
    assert.equal(pruned, true);
    assert.deepEqual(Object.keys(store.get("myspeeddial-weather-cache")), ["cw-weather-keep"]);
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test("markAllRssItemsRead persists new read IDs even when stored read list is already at max capacity", async () => {
  const fullReadList = Array.from({ length: 120 }, (_, i) => `old_${i}`);
  const store = new Map([
    ["myspeeddial-rss-cache", {
      "cw-rss-full": { fetchedAt: 1000, items: [{ id: "new_1", title: "New 1" }, { id: "new_2", title: "New 2" }] }
    }],
    ["myspeeddial-rss-read", {
      "cw-rss-full": fullReadList
    }]
  ]);
  const prevChrome = globalThis.chrome;
  globalThis.chrome = {
    ...prevChrome,
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (store.has(k)) out[k] = structuredClone(store.get(k));
          }
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v));
        }
      }
    }
  };
  try {
    const { markAllRssItemsRead } = await import("../newtab/widgets/rss-widget.js");
    await markAllRssItemsRead([{ id: "cw-rss-full", type: "rss-feed" }]);
    const saved = store.get("myspeeddial-rss-read")["cw-rss-full"];
    assert.equal(saved.length, 120);
    assert.equal(saved[0], "new_1");
    assert.equal(saved[1], "new_2");
  } finally {
    globalThis.chrome = prevChrome;
  }
});
