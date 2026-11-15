import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const javascriptFiles = [];

async function collectJavaScript(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectJavaScript(entryPath);
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) {
      javascriptFiles.push(entryPath);
    }
  }
}

for (const directory of ["newtab", "scripts", "tests"]) {
  await collectJavaScript(path.join(root, directory));
}

for (const file of javascriptFiles) {
  const source = await readFile(file, "utf8");
  const result = spawnSync(
    process.execPath,
    ["--check", "--input-type=module"],
    { input: source, encoding: "utf8" }
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exitCode = result.status || 1;
    throw new Error(`JavaScript syntax check failed: ${path.relative(root, file)}`);
  }
}

const manifests = ["manifest.json", "manifest.json.chromium", "manifest.json.gecko"];
for (const file of manifests) {
  const manifest = JSON.parse(await readFile(path.join(root, file), "utf8"));
  const newTabPage = manifest.chrome_url_overrides?.newtab;
  if (!newTabPage || !(await stat(path.join(root, newTabPage))).isFile()) {
    throw new Error(`${file} references a missing new-tab page`);
  }
  for (const iconPath of Object.values(manifest.icons || {})) {
    if (!(await stat(path.join(root, iconPath))).isFile()) {
      throw new Error(`${file} references a missing icon: ${iconPath}`);
    }
  }
}

for (const localeEntry of await readdir(path.join(root, "_locales"), { withFileTypes: true })) {
  if (!localeEntry.isDirectory()) continue;
  const localeFile = path.join(root, "_locales", localeEntry.name, "messages.json");
  JSON.parse(await readFile(localeFile, "utf8"));
}

const themeFiles = ["themes/spring.css", "themes/summer.css", "themes/autumn.css", "themes/winter.css"];
for (const file of themeFiles) {
  if (!(await stat(path.join(root, file))).isFile()) {
    throw new Error(`Missing built-in theme stylesheet: ${file}`);
  }
}

console.log(`Addon checks passed (${javascriptFiles.length} JavaScript files, ${manifests.length} manifests, ${themeFiles.length} themes, locale JSON).`);
