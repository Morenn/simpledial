# Simple SpeedDial

A clean, privacy-focused, and customizable Speed Dial new-tab browser extension with instant search, custom widgets, groups, sections, stacks, tags, seasonal themes, WebDAV/HTTP sync, an encrypted Secrets Vault, and automatic backups.

## Installation

### From store
- **Firefox Add-ons:** [Simple Dial for Firefox](https://addons.mozilla.org/en-US/firefox/addon/simple-dial/)
- **Microsoft Edge Add-ons:** [Simple SpeedDial for Edge](https://microsoftedge.microsoft.com/addons/detail/simple-speeddial/apbaccnojalophdpgohmbappaehdkljo)

### Manually
- **Chrome / Edge (Chromium):** Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, and click **Load unpacked** to select the repository root (or package it from the repository root).
- **Firefox:** Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select `manifest.json` from the repository root (or package the repository root as a `.zip`/`.xpi`).

## Features

- **Groups, Sections, Stacks & Tags** — Organize bookmarks into tabbed groups with per-group sections, folder-like bookmark stacks, and global searchable tags. Supports emojis or custom icon URLs, drag-and-drop ordering, tile lock toggle, hover notes, custom tile colors, tall tile layout, and automatic tile colors extracted from favicons.
- **Instant Search & Custom Widgets** — Search bookmarks across groups (including tags and notes) with selectable search bar styles, or build declarative custom widgets in **Settings → Custom Widgets** with JSON export/import, duplication, and manual **Load from URL** with **Update** and **Revert**:
  - **Custom Search** — Simple URL templates and multi-variable JSON templates (text, comma list, dropdown, multi-select), custom icons, grouped engine switchers, and prefix auto-routing. See [Search Widgets Guide & Examples](https://github.com/Morenn/simpledial-widget-examples/tree/main/search/README.md).
  - **TimeZone** — Multi-zone live clocks (12h/24h, optional seconds) with an interactive click-to-edit TimeZone Calculator and day-shift badges. See [TimeZone Widgets Guide & Examples](https://github.com/Morenn/simpledial-widget-examples/tree/main/timezone/README.md).
  - **REST / JSON Status** — Poll `GET`/`HEAD` JSON endpoints with dot/bracket `jsonPath` extraction, value mapping, scaling, `ok`/`warn`/`err` rule matching, up to 6 collapsible extra metrics, widget grouping, and optional Secrets Vault-encrypted auth headers. See [REST Status Widgets Guide & Examples](https://github.com/Morenn/simpledial-widget-examples/tree/main/rest-status/README.md).
  - **Simple Notes / Scratchpad** — Multi-entry notes, checkable to-do lists, timed, multi-day, relative (`days`/`hours`/`mins`), and date-time reminders with live countdowns, plus compact modal mode. See [Notes Widgets Guide & Examples](https://github.com/Morenn/simpledial-widget-examples/tree/main/notes/README.md).
  - **Weather** — Current conditions and forecasts via Open-Meteo (default) or OpenWeatherMap (optional Secrets Vault-encrypted API key), with `pill`, `small`, `medium`, and detailed modal views.
  - **RSS / Atom Feed** — Subscribe to RSS/Atom feeds with unread counters, item read/unread toggles, and widget grouping.
- **Workspace Layout & Widget Placement** — Place built-in and custom widgets across **Header**, **Left**, **Center**, **Right**, and **Footer** spaces with per-widget ordering, alignment, and row-break controls, plus a footer status bar and movable Date & Time display.
- **Keyboard Navigation & Shortcuts** — Navigate groups, tiles, and search with the keyboard and view the built-in shortcut palette.
- **Themes & Appearance** — Switch between Dark and Light modes, built-in seasonal themes (**Spring**, **Summer**, **Autumn**, **Winter**), or load custom CSS from a file or URL. Customize background images (file or URL, with automatic native WebP/JPEG downscaling up to `1920×1080` / `2 MB`), background dim overlay, header/footer and tile transparency, and independent tile/group sizes.
- **Synchronization** — Sync bookmarks via built-in browser sync, Direct HTTP/HTTPS endpoints, or WebDAV (including **WebDAV Folder Sync** for config, custom widgets, backups, and background) with optional Secrets Vault credential encryption, `ETag` `If-Match` concurrency, permanent-delete tombstones, `dbuid`/stale-device conflict detection, per-part conflict resolution, and an interactive **Merge Wizard**.
- **Secrets Vault** — Encrypt sync credentials, REST widget auth tokens, and weather API keys at rest using `AES-GCM` with `PBKDF2` (`PBKDF2-SHA512` / `PBKDF2-SHA256`), RAM-only session unlock, optional idle auto-lock, and 90-day password expiry reminders.
- **Backups & Import/Export** — Automatic scheduled local backups with retention limits, WebDAV folder remote backup indexing (`L`/`R` location badges, separate local/remote retention, and device tracking), manual bookmark & config snapshots, **Upload & Restore** from backup files, JSON and NETSCAPE HTML bookmark import/export, a **Browser Bookmarks Import Wizard** with folder depth mapping, custom widget library export/import, and optional browser bookmarks folder sync.
- **HouseKeeper** — Soft-delete recovery and automatic cleanup, dead-link checking/highlighting, and automatic favicon refreshing.
- **Localization** — Supports English, Czech, German, Finnish, French, Dutch, Slovak, and Ukrainian.

## Default Widget Placement

Widgets can be placed in **Header**, **Left**, **Center**, **Right**, or **Footer** spaces (and optional widgets can be set to **Disabled**) in **Settings → Appearance → Widgets**.

### Built-in Widgets

| Widget | Default Space | Notes |
|--------|---------------|-------|
| Group selector | `header` | Cannot be disabled |
| Manage buttons | `header` | Cannot be disabled |
| Search bar | `center` | Cannot be disabled |
| Bookmarks | `center` | Fixed placement |
| Sync status | `footer` | Can be disabled |
| Date & Time | `footer` | Can be disabled |
| Shortcut palette | `footer` | Can be disabled |
| Bookmarks count | `footer` | Can be disabled |
| Storage usage | `disabled` | Optional local/sync storage meter |

### Custom Widget Types

| Widget Type | Default Space | Groupable | Notes |
|-------------|---------------|-----------|-------|
| RSS / Atom Feed (`rss-feed`) | `left` | Yes | Inherits group space when added/joined to an existing group |
| REST / JSON Status (`rest-status`) | `left` | Yes | Inherits group space when added/joined to an existing group |
| Weather (`weather`) | `left` | No | `pill`, `small`, `medium` inline + `big` modal on click; Open-Meteo default or API-key provider |
| Time Zone (`timezone`) | `right` | No | — |
| Notes / Scratchpad (`notes`) | `right` | No | — |
| Custom Search (`custom-search`) | `right` | Yes | Inherits group space when added/joined to an existing group |

## Known Issues

- **WebDAV `HTTP 405 (Method Not Allowed)` in browser console/network logs:** When using **WebDAV Folder Sync** against a server that does not support `PROPFIND` (returning `405` or `501`), backup directory initialization falls back to `MKCOL`. If a backup folder (`backups/`, `backups/bookmarks/`, `backups/config/`) already exists on the server, `MKCOL` returns `HTTP 405 (Method Not Allowed)` per WebDAV RFC 4918. This is harmless and sync continues to work normally; servers that support `PROPFIND` (such as Nextcloud/SabreDAV) avoid these `405` responses.

---

*Co-developed with Antigravity (Gemini).*
