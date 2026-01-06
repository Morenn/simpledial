import { state, saveState, generateId } from "./state.js";
import { render } from "./render.js";

// ======================================================
// POMOCNÉ FUNKCIE
// ======================================================

function sanitizeFilename(name) {
  return name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
}

function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return "https://www.google.com/s2/favicons?domain=" + u.hostname;
  } catch {
    return "";
  }
}

// ======================================================
// EXPORT ZIP
// ======================================================

const exportBtn = document.getElementById("export-btn");

exportBtn.addEventListener("click", async () => {
  const zip = new JSZip();

  state.groups
    .filter(g => !g.deleted)
    .forEach(group => {
      const folder = zip.folder(sanitizeFilename(group.name));

      group.items
        .filter(i => !i.deleted)
        .forEach(item => {
          const iconUrl = item.customIcon
            ? item.customIcon
            : getFaviconUrl(item.url);

          const safeName = sanitizeFilename(item.title);

          const content =
            `[InternetShortcut]\n` +
            `URL=${item.url}\n` +
            `IconFile=${iconUrl}\n` +
            `IconIndex=0\n`;

          folder.file(safeName + ".url", content);
        });
    });

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    encodeFileName: name => new TextEncoder().encode(name)
  });

  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url,
    filename: "SpeedDialExport.zip",
    saveAs: true
  });
});

// ======================================================
// IMPORT ZIP
// ======================================================

const importBtn = document.getElementById("import-btn");

importBtn.addEventListener("click", async () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(data);

    // 1) Najprv vytvoríme skupiny
    Object.values(zip.files).forEach(entry => {
      if (entry.dir) {
        const rawName = entry.name.replace(/\/$/, "");
        const groupName = sanitizeFilename(rawName);

        if (!state.groups.some(g => g.name === groupName)) {
          state.groups.push({
            id: generateId("g"),
            name: groupName,
            items: [],
            updatedAt: Date.now(),
            deleted: false,
            deletedAt: null
          });
        }
      }
    });

    // 2) Načítame .url súbory
    for (const path in zip.files) {
      const entry = zip.files[path];

      if (!entry.dir && path.endsWith(".url")) {
        const parts = path.split("/");
        const groupName = sanitizeFilename(parts[0]);
        const fileName = sanitizeFilename(parts[1].replace(".url", ""));

        const group = state.groups.find(g => g.name === groupName);
        if (!group) continue;

        const text = await entry.async("text");

        const urlMatch = text.match(/URL=(.*)/);
        const iconMatch = text.match(/IconFile=(.*)/);

        const url = urlMatch ? urlMatch[1].trim() : "";
        const icon = iconMatch ? iconMatch[1].trim() : null;

        group.items.push({
          id: generateId("b"),
          title: fileName,
          url,
          customIcon: icon || null,
          updatedAt: Date.now(),
          deleted: false,
          deletedAt: null
        });
      }
    }

    await saveState();
    render();
  };

  input.click();
});
