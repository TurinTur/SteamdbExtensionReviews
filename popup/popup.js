/**
 * SteamDB Extension Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleSchinese = document.getElementById('toggle-schinese');
  const toggleTchinese = document.getElementById('toggle-tchinese');
  const selectPurchaseType = document.getElementById('select-purchase-type');
  const statusMsg = document.getElementById('status-msg');

  const defaultSettings = {
    enabled: true,
    excludeSimplifiedChinese: true,
    excludeTraditionalChinese: true,
    purchaseType: 'all'
  };

  function getStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      return browser.storage.local;
    }
    return null;
  }

  const storage = getStorage();

  function loadSavedSettings() {
    if (!storage) return;

    if (storage.get.length === 1) { // Promise-based API (Firefox browser.storage)
      storage.get(defaultSettings).then(applySettings);
    } else { // Callback-based API (Chrome/WebExtension compatibility)
      storage.get(defaultSettings, applySettings);
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
      if (storage.set.length === 1) {
        storage.set(newSettings).then(showSavedStatus);
      } else {
        storage.set(newSettings, showSavedStatus);
      }
    }
  }

  function showSavedStatus() {
    statusMsg.textContent = 'Settings saved!';
    statusMsg.style.color = '#66c0f4';
    setTimeout(() => {
      statusMsg.textContent = 'Settings saved automatically';
      statusMsg.style.color = '#8f98a0';
    }, 1500);
  }

  toggleEnabled.addEventListener('change', saveSettings);
  toggleSchinese.addEventListener('change', saveSettings);
  toggleTchinese.addEventListener('change', saveSettings);
  selectPurchaseType.addEventListener('change', saveSettings);

  loadSavedSettings();
});
