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
  groupCustomSearchWidgets,
  isValidTimeZone,
  resolveDateForTimeInZone,
  getTimeZoneDayShift,
  normalizeCustomTimeZones,
  formatTimeForTimeZone,
  resolveCustomWidgetIcon,
  applyCustomWidgetUpdate,
  revertCustomWidgetVersion
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

test("widget-examples/search/*.json presets parse cleanly", () => {
  const searchDir = path.resolve("widget-examples/search");
  const expectedFiles = [
    "google.json",
    "brave.json",
    "duckduckgo.json",
    "bing.json",
    "ecosia.json",
    "servicenow.json",
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
