# Custom Search Widgets Guide

Custom Search Widgets let you add your own search bars—from simple query links to multi-filter JSON-encoded searches—directly into any workspace area (**Header**, **Left**, **Center**, **Right**, or **Footer**).

Open **Settings → Custom Widgets** to create, edit, delete, export, or import custom search widgets. Once created, each widget appears in **Settings → Appearance → Widgets** so you can choose its workspace area, alignment, row break, and display order.

---

## 1. Custom Icons

Every search widget supports both a fallback emoji/symbol and a custom image icon:

- **Emoji / Symbol**: Enter any emoji (e.g. `🔎`, `🌐`, `📚`) in the small icon box.
- **Custom Image URL**: Paste an `https://...` image URL (or `data:image/...`) into **Icon URL or upload (optional)**.
- **Upload Image**: Click **🖼️** to pick a local PNG, JPG, SVG, WebP, or ICO file. Raster images are automatically resized to fit cleanly (`64×64` PNG data URL), so exported widget JSON files remain self-contained and easy to share.

If a remote custom icon fails to load, the widget automatically falls back to its emoji icon.

---

## 2. Search Modes

### A. Simple String Search

Replaces `{varName}` placeholders directly inside the **URL template**.

#### Example 1: Basic Google Search
- **Mode**: `Simple string search`
- **Name**: `Google`
- **Icon**: `🌐` (or a Google favicon URL)
- **URL template**:
  ```text
  https://www.google.com/search?q={query}
  ```
- **Variables**:
  - `query` | Label: `Search` | Type: `Text`

Typing `hello world` opens:
```text
https://www.google.com/search?q=hello%20world
```

#### Example 2: Multi-Variable Search (GitHub Issues/Code)
- **Mode**: `Simple string search`
- **Name**: `GitHub`
- **URL template**:
  ```text
  https://github.com/search?q={query}&type={type}
  ```
- **Variables**:
  1. `query` | Label: `Search` | Type: `Text`
  2. `type` | Label: `Type` | Type: `Dropdown` | Options:
     ```text
     Repositories=repositories
     Code=code
     Issues=issues
     ```

The first variable (`query`) is shown as the main search box, and `Type` appears inside the **⚙** filter popover.

---

### B. JSON Search

Builds a JSON object from your **JSON template**, **automatically omits any empty variables** (including parent objects or array items that become empty), URL-encodes the resulting JSON, and appends it to the **URL template** (or replaces `{json}` if `{json}` is present in the URL template).

#### Example 3: Filtered JSON Search
- **Mode**: `JSON search`
- **Name**: `Docs Search`
- **URL template**:
  ```text
  https://example.com/search/
  ```
- **JSON template**:
  ```json
  {
    "q": "{query}",
    "filters": {
      "category": "{categories}",
      "updated": "{updated}",
      "tags": "{tags}"
    }
  }
  ```
- **Variables**:
  1. `query` | Label: `Search` | Type: `Text`
  2. `categories` | Label: `Category` | Type: `Multi-select` | Options (`Label=Value`, one per line):
     ```text
     Guides=guides
     API Reference=api
     Release Notes=releases
     ```
  3. `updated` | Label: `Updated` | Type: `Dropdown` | Options:
     ```text
     Last 7 days=7d
     Last 30 days=30d
     ```
  4. `tags` | Label: `Tags` | Type: `Comma list`

**How empty-key omission works:**
- If you only type `authentication` and leave all filters empty, `filters` is omitted completely:
  ```json
  { "q": "authentication" }
  ```
  → `https://example.com/search/%7B%22q%22%3A%22authentication%22%7D`
- If you leave `query` empty and pick **Guides** + **API Reference**, **Last 7 days**, and tags `oauth, jwt`:
  ```json
  {
    "filters": {
      "category": ["guides", "api"],
      "updated": "7d",
      "tags": ["oauth", "jwt"]
    }
  }
  ```

---

## 3. Variable Types

| Type | Input UI | Value in Simple Mode | Value in JSON Mode |
|------|----------|----------------------|--------------------|
| `Text` | Text box | Trimmed string | String (omitted if empty) |
| `Comma list` | Text box (`a, b`) | Comma-joined string | Array of strings `["a","b"]` (omitted if empty) |
| `Dropdown` | `<select>` menu | Selected value | String (omitted if empty) |
| `Multi-select` | Checkboxes | Comma-joined values | Array of selected values (omitted if empty) |

---

## 4. Export, Import & Load from URL (Widget Library)

You can back up, share, or load custom search widgets from a file or a remote JSON URL:

- **Export all widgets**: Click **📥 Export** in **Settings → Custom Widgets** or **Settings → Export/Import → Custom Search Widgets**.
- **Export one widget**: Click **📥** next to a custom widget in **Saved Custom Widgets**.
- **Import from file**: Click **📤 Import** and select a `.json` file (supports full library exports, JSON arrays, or a single widget object). Widgets with a matching `id` update in place; new widgets are added automatically.
- **Load from URL**: Paste an `https://...` JSON URL in **Settings → Custom Widgets** and click **🌐 Load from URL**. The source URL is remembered on each loaded widget.
- **Manual Update & Revert**: Widgets loaded from a URL never auto-update. You can click **🔄** on a widget (or **🔄 Update from URL** in the library header) to manually fetch updates. Before applying an update, the previous configuration is saved so you can click **↩️** to revert if the new version is broken.

> **Security note:** Only import or load custom widgets from files and URLs you trust.

Remember to click **Save** in Settings to persist changes.
