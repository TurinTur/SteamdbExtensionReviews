# SteamDB Non-Chinese Reviews (Firefox Extension)

A Firefox extension (WebExtension Manifest V3) that modifies [SteamDB.info](https://steamdb.info) app pages to calculate and display user review scores **excluding Simplified and Traditional Chinese reviews** (the "My Languages / Non-Chinese" review percentage).

## Features

- 📊 **Non-Chinese Review Score**: Displays raw positive review percentage, negative review percentage, and total non-Chinese reviews.
- 🧮 **SteamDB Rating Score**: Calculates adjusted SteamDB rating formula score for non-Chinese reviews.
- 📈 **Comparison Badge**: Highlights difference (+/-%) compared to overall Steam store rating.
- 🏷️ **Sales Table Custom Columns**: Injects Custom Rating & Diff Rating columns directly into SteamDB sales & product tables.
- 🎨 **Native SteamDB Styling**: Blends seamlessly into SteamDB's dark theme aesthetic.
- ⚙️ **Popup Settings**: Customize excluded languages (Simplified Chinese, Traditional Chinese) or switch purchase types (All vs Steam Purchases).
- 🔒 **Privacy Friendly & No API Key Needed**: Queries public Steam store endpoints directly from your browser.

## How to Install in Firefox

### Option A: Temporary Loading (For Development)
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Navigate to this extension's folder.
4. Select the `manifest.json` file.

*Note: This gets removed every time you restart Firefox.*

### Option B: Permanent Installation (Packaged Archive)
To avoid loading it repeatedly, you need to package the extension and install it permanently.

#### 1. Package the Extension
Run [package.bat](package.bat) or `python package.py` in the extension folder. This generates unsigned archives:
* `steamdb-non-chinese-reviews.zip`
* `steamdb-non-chinese-reviews.xpi`

#### 2. Install Permanently
Because Firefox requires all extensions to be signed by default on standard releases, choose one of the following methods to install it permanently:

* **Method 1: Sign with a free Mozilla account (Recommended for Standard Firefox)**
  1. Go to the [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/).
  2. Choose **On your own (unlisted)** so your add-on is private and not published to the public store.
  3. Upload the packaged `steamdb-non-chinese-reviews.zip` file.
  4. Once Mozilla auto-signs it (takes ~2 minutes), download the signed `.xpi` file.
  5. Go to `about:addons` in Firefox, click the **Gear icon** -> **Install Add-on From File...**, and choose the signed `.xpi`.

* **Method 2: Use Firefox Developer Edition / Nightly / ESR**
  1. Open `about:config` in your browser.
  2. Search for `xpinstall.signatures.required` and set it to **`false`**.
  3. Go to `about:addons`, click the **Gear icon** -> **Install Add-on From File...**, and select `steamdb-non-chinese-reviews.xpi`.

* **Method 3: Enterprise Deployment (Signed XPI Required on Standard Firefox)**
  Enterprise policy does not bypass signature enforcement. Sign the extension first using Method 1, then use the signed XPI as the installation source.
  1. Create a folder named `distribution` inside the directory where Firefox is installed (e.g. `C:\Program Files\Mozilla Firefox\`).
  2. Inside `distribution`, create a file named `policies.json`.
  3. Add the following content to auto-install it from the local path:
     ```json
     {
       "policies": {
         "ExtensionSettings": {
           "steamdb-non-chinese-reviews@antigravity": {
             "installation_mode": "normal_installed",
             "install_url": "file:///c:/temp/FirefoxSteamReviews/steamdb-non-chinese-reviews.xpi"
           }
         }
       }
     }
     ```
  4. Restart Firefox.

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

## Review Data and Troubleshooting

- Uses Steam's public [IUserReviewsService API](https://partner.steamgames.com/doc/webapi/IUserReviewsService#GetAppReviews), not the deprecated store `/appreviews` endpoint. No API key is required.
- Counts reviews by their review language, not the reviewer's nationality. Chinese-language counts are subtracted from overall positive and negative counts using the same purchase and off-topic filters.
- Includes all purchase sources by default and follows Steam's default exclusion of off-topic activity. Steam's store rating may differ because it normally uses Steam purchases only.
- Successful results are cached locally for 24 hours per app, purchase source, and language selection. Old cache entries from before this fix are ignored automatically.
- Request failures and inconsistent totals are never cached or displayed as zero reviews. The app panel shows the error and a Retry button; table cells show `N/A` with an error tooltip.
- Popup settings apply to open SteamDB pages immediately. Disabling the extension removes its panel and columns.
- Steam API access is an optional host permission. Open the extension popup and click **Allow Steam API access** if it is not granted, accept Firefox's prompt, then refresh SteamDB or click Retry. A disabled installed copy and a temporary copy can retain the same add-on permission state; loading an XPI does not guarantee a new host grant.
- After updating a temporarily loaded add-on, load the rebuilt XPI again in `about:debugging`, then refresh existing SteamDB tabs. You can instead load the source manifest for development and use Reload after edits.
- HTTP 429 means Steam is rate limiting requests. Wait before retrying. Steam's anonymous API responses may themselves be cached for up to 10 minutes.

## Development Checks

With Node.js installed, run the focused regression suite (no dependencies required):

```powershell
node --test tests/reviews.test.cjs
```
