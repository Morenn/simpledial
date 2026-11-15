# Install & Build

## Store Releases

- **Firefox Add-ons:** [Simple Dial for Firefox](https://addons.mozilla.org/en-US/firefox/addon/simple-dial/)
- **Microsoft Edge Add-ons:** [Simple SpeedDial for Edge](https://microsoftedge.microsoft.com/addons/detail/simple-speeddial/apbaccnojalophdpgohmbappaehdkljo)

---

## Building Release Packages from Source

### Prerequisites

- **Node.js** (uses built-in Node.js modules only; no `npm install` required).
- If `node` is not in your `PATH`, set `NODE_BIN` to the `node` / `node.exe` executable path before running the build script.

### Windows (Command Prompt / PowerShell)

Use `scripts\build.bat` or `.\scripts\build.bat` (do **not** use `./scripts/build.bat` in Windows Command Prompt):

```bat
:: Build both Gecko and Chromium packages
scripts\build.bat

:: Build only Gecko (Firefox)
scripts\build.bat gecko

:: Build only Chromium (Chrome / Edge / Brave)
scripts\build.bat chromium
```

If `node.exe` is not in `PATH`, `scripts\build.bat` also checks `NODE_BIN`, `C:\Program Files\nodejs\node.exe`, and `C:\Program Files\AMD\AI_Bundle\LMStudio\resources\app\.webpack\bin\node.exe`.

### Linux / macOS

```bash
# Build both Gecko and Chromium packages
./scripts/build.sh

# Build only Gecko (Firefox)
./scripts/build.sh gecko

# Build only Chromium (Chrome / Edge / Brave)
./scripts/build.sh chromium
```

### Direct Node.js

```bash
node scripts/build.mjs
node scripts/build.mjs gecko
node scripts/build.mjs chromium
```

### Build Output

Packages are written to `dist/`:

- `dist/simple-dial-<version>-gecko.zip`
- `dist/simple-dial-<version>-chromium.zip`

Each archive contains only the required runtime extension files (`newtab.html`, `style.css`, `_locales/`, `icons/`, `newtab/`, `themes/`), the target `manifest.json` (`manifest.json.gecko` or `manifest.json.chromium`), and a generated `version.json` with `"commit": "rel"` and the build date.

---

## Loading Locally for Development

- **Firefox (Gecko):** Copy `manifest.json.gecko` to `manifest.json`, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and select `manifest.json`.
- **Chrome / Edge (Chromium):** Copy `manifest.json.chromium` to `manifest.json`, open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, click **Load unpacked**, and select the repository folder (or extract `dist/simple-dial-<version>-chromium.zip` and load the extracted folder).
