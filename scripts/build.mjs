import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, "..");
const configPath = path.join(scriptsDir, "build.config.json");

async function resolveDistDir() {
  try {
    const raw = await readFile(configPath, "utf8");
    const cfg = JSON.parse(raw);
    if (typeof cfg?.distDir === "string" && cfg.distDir.trim()) {
      return path.resolve(root, cfg.distDir.trim());
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw new Error(`Invalid build config at ${configPath}: ${err.message}`);
    }
  }
  return path.join(root, "dist");
}

const distDir = await resolveDistDir();

const TARGETS = {
  gecko: "manifest.json.gecko",
  chromium: "manifest.json.chromium"
};

const REQUIRED_FILES = ["newtab.html", "style.css"];
const REQUIRED_DIRS = ["_locales", "icons", "newtab", "themes"];

// Precomputed CRC-32 lookup table for ZIP entries
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | ((date.getSeconds() >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9)
    | (((date.getMonth() + 1) & 0x0f) << 5)
    | (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function createZipBuffer(entries, mtime = new Date()) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const { dosTime, dosDate } = toDosTimeDate(mtime);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const raw = entry.data;
    const compressed = deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirSize = centralChunks.reduce((sum, buf) => sum + buf.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

async function collectDirectoryFiles(dirRel, out) {
  const fullDir = path.join(root, dirRel);
  const items = await readdir(fullDir, { withFileTypes: true });
  items.sort((a, b) => a.name.localeCompare(b.name));

  for (const item of items) {
    const rel = `${dirRel}/${item.name}`;
    if (item.isDirectory()) {
      await collectDirectoryFiles(rel, out);
    } else if (item.isFile()) {
      out.push({ name: rel, data: await readFile(path.join(root, rel)) });
    }
  }
}

async function buildTarget(target, now) {
  const manifestSourceName = TARGETS[target];
  if (!manifestSourceName) {
    throw new Error(`Unknown target "${target}". Expected one of: ${Object.keys(TARGETS).join(", ")}`);
  }

  const manifestRaw = await readFile(path.join(root, manifestSourceName), "utf8");
  const manifest = JSON.parse(manifestRaw);
  const version = manifest.version || "0.0.0";

  const entries = [
    { name: "manifest.json", data: Buffer.from(manifestRaw, "utf8") },
    {
      name: "version.json",
      data: Buffer.from(
        `${JSON.stringify({ commit: "rel", date: now.toISOString().slice(0, 10) }, null, 2)}\n`,
        "utf8"
      )
    }
  ];

  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(root, file);
    if (!(await stat(fullPath)).isFile()) {
      throw new Error(`Missing required file: ${file}`);
    }
    entries.push({ name: file, data: await readFile(fullPath) });
  }

  for (const dir of REQUIRED_DIRS) {
    await collectDirectoryFiles(dir, entries);
  }

  await mkdir(distDir, { recursive: true });
  const zipName = `simple-dial-${version}-${target}.zip`;
  const zipPath = path.join(distDir, zipName);
  await writeFile(zipPath, createZipBuffer(entries, now));

  const unpackedDir = path.join(distDir, target);
  await rm(unpackedDir, { recursive: true, force: true });
  for (const entry of entries) {
    const destPath = path.join(unpackedDir, entry.name);
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, entry.data);
  }

  console.log(`Built ${path.relative(root, zipPath)} & ${path.relative(root, unpackedDir)} (${entries.length} files)`);
  return zipPath;
}

const args = process.argv.slice(2).map(arg => arg.toLowerCase());
const selectedTargets = args.length > 0 ? args : Object.keys(TARGETS);
const now = new Date();

for (const target of selectedTargets) {
  await buildTarget(target, now);
}
