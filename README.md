# SteamDB Non-Chinese Reviews (Firefox Extension)

A Firefox extension (WebExtension Manifest V3) that modifies [SteamDB.info](https://steamdb.info) app pages to calculate and display user review scores **excluding Simplified and Traditional Chinese reviews** (the "My Languages / Non-Chinese" review percentage).

## Features

- 📊 **Non-Chinese Review Score**: Displays raw positive review percentage, negative review percentage, and total non-Chinese reviews.
- 🧮 **SteamDB Rating Score**: Calculates adjusted SteamDB rating formula score for non-Chinese reviews.
- 📈 **Comparison Badge**: Highlights difference (+/-%) compared to overall Steam store rating.
- 🎨 **Native SteamDB Styling**: Blends seamlessly into SteamDB's dark theme aesthetic.
- ⚙️ **Popup Settings**: Customize excluded languages (Simplified Chinese, Traditional Chinese) or switch purchase types (All vs Steam Purchases).
- 🔒 **Privacy Friendly & No API Key Needed**: Queries public Steam store endpoints directly from your browser.

## How to Install in Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Navigate to the extension folder: `c:\temp\FirefoxSteamREviews\`
4. Select the `manifest.json` file.
5. Navigate to any SteamDB app page (e.g. `https://steamdb.info/app/3561220/charts/#reviews`).

## Extension Structure

```
FirefoxSteamREviews/
├── manifest.json         # Firefox WebExtension Manifest V3
├── content.js            # Injected script parsing App ID & querying Steam API
├── content.css           # Custom styles for SteamDB UI injection
├── popup/
│   ├── popup.html        # Extension options panel
│   ├── popup.css         # Popup dark theme styles
│   └── popup.js          # Options handler (storage sync)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
