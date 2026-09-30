/**
 * SteamDB Extension Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleSchinese = document.getElementById('toggle-schinese');
  const toggleTchinese = document.getElementById('toggle-tchinese');
  const selectPurchaseType = document.getElementById('select-purchase-type');
  const statusMsg = document.getElementById('status-msg');
  const steamAccessStatus = document.getElementById('steam-access-status');
  const grantSteamAccess = document.getElementById('grant-steam-access');
  const usesPromises = typeof browser !== 'undefined' && browser.storage && browser.storage.local;
  const extensionApi = usesPromises ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  let statusTimer = null;

  const versionTag = document.querySelector('.version-tag');
  if (versionTag && extensionApi && extensionApi.runtime && extensionApi.runtime.getManifest) {
    versionTag.textContent = `v${extensionApi.runtime.getManifest().version}`;
  }

  const defaultSettings = {
    enabled: true,
    excludeSimplifiedChinese: true,
    excludeTraditionalChinese: true,
    purchaseType: 'all'
  };

  function getStorage() {
    if (usesPromises) return browser.storage.local;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  const storage = getStorage();

  function loadSavedSettings() {
    if (!storage) {
      showStorageError(new Error('Extension storage is unavailable'));
      return;
    }

    if (usesPromises) {
      storage.get(defaultSettings).then(applySettings).catch(showStorageError);
    } else {
      storage.get(defaultSettings, (items) => {
        if (extensionApi.runtime.lastError) showStorageError(extensionApi.runtime.lastError);
        else applySettings(items);
      });
    }
  }

  function applySettings(items) {
    const settings = { ...defaultSettings, ...items };
    toggleEnabled.checked = settings.enabled;
    toggleSchinese.checked = settings.excludeSimplifiedChinese;
    toggleTchinese.checked = settings.excludeTraditionalChinese;
    selectPurchaseType.value = settings.purchaseType;
  }

  function saveSettings() {
    const newSettings = {
      enabled: toggleEnabled.checked,
      excludeSimplifiedChinese: toggleSchinese.checked,
      excludeTraditionalChinese: toggleTchinese.checked,
      purchaseType: selectPurchaseType.value
    };

    if (storage) {
      if (usesPromises) {
        storage.set(newSettings).then(showSavedStatus).catch(showStorageError);
      } else {
        storage.set(newSettings, () => {
          if (extensionApi.runtime.lastError) showStorageError(extensionApi.runtime.lastError);
          else showSavedStatus();
        });
      }
    }
  }

  function showStorageError(error) {
    if (statusTimer) clearTimeout(statusTimer);
    statusMsg.textContent = `Settings unavailable: ${error.message}`;
    statusMsg.style.color = '#e06c75';
  }

  function showSavedStatus() {
    if (statusTimer) clearTimeout(statusTimer);
    statusMsg.textContent = 'Settings saved!';
    statusMsg.style.color = '#66c0f4';
    statusTimer = setTimeout(() => {
      statusMsg.textContent = 'Settings saved automatically';
      statusMsg.style.color = '#8f98a0';
    }, 1500);
  }

  function steamPermissionOperation(method) {
    const permissions = { origins: ['https://api.steampowered.com/*'] };
    if (!extensionApi || !extensionApi.permissions) {
      return Promise.reject(new Error('Firefox permissions API is unavailable'));
    }
    if (usesPromises) return extensionApi.permissions[method](permissions);
    return new Promise((resolve, reject) => {
      extensionApi.permissions[method](permissions, (granted) => {
        if (extensionApi.runtime.lastError) reject(new Error(extensionApi.runtime.lastError.message));
        else resolve(granted);
      });
    });
  }

  function applySteamAccess(granted) {
    grantSteamAccess.hidden = granted;
    grantSteamAccess.disabled = false;
    steamAccessStatus.textContent = granted ? 'Steam API access granted' : 'Steam API access not granted';
    steamAccessStatus.style.color = granted ? '#8f98a0' : '#e06c75';
  }

  function showSteamAccessError(error) {
    grantSteamAccess.hidden = false;
    grantSteamAccess.disabled = false;
    steamAccessStatus.textContent = `Steam API access: ${error.message}`;
    steamAccessStatus.style.color = '#e06c75';
  }

  grantSteamAccess.addEventListener('click', () => {
    grantSteamAccess.disabled = true;
    steamPermissionOperation('request').then(applySteamAccess).catch(showSteamAccessError);
  });

  toggleEnabled.addEventListener('change', saveSettings);
  toggleSchinese.addEventListener('change', saveSettings);
  toggleTchinese.addEventListener('change', saveSettings);
  selectPurchaseType.addEventListener('change', saveSettings);

  loadSavedSettings();
  steamPermissionOperation('contains').then(applySteamAccess).catch(showSteamAccessError);
});
