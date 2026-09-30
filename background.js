/**
 * SteamDB Non-Chinese Reviews Extension Background Script
 * Handles cross-origin requests to the public Steam reviews API
 */

function hasSteamApiAccess() {
  const permissions = { origins: ['https://api.steampowered.com/*'] };
  if (typeof browser !== 'undefined' && browser.permissions) {
    return browser.permissions.contains(permissions);
  }
  return new Promise((resolve, reject) => {
    chrome.permissions.contains(permissions, (granted) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(granted);
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchReviews') {
    const { appId, language, purchaseType } = request;
    const numericAppId = Number(appId);
    if (!Number.isInteger(numericAppId) || numericAppId <= 0 || numericAppId > 4294967295 ||
        !['all', 'schinese', 'tchinese'].includes(language) || !['all', 'steam'].includes(purchaseType)) {
      sendResponse({ success: false, error: 'Invalid review request' });
      return false;
    }

    const url = new URL('https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/');
    url.searchParams.set('input_json', JSON.stringify({
      appid: numericAppId,
      languages: [language],
      purchase_type: purchaseType === 'steam' ? 0 : 1,
      filter: 1,
      review_type: 0,
      num_per_page: 1,
      filter_offtopic_activity: true
    }));

    hasSteamApiAccess()
      .then((granted) => {
        if (!granted) {
          throw new Error("Steam API access is not granted. Open this extension's popup and allow Steam API access, then retry.");
        }
        return fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
      })
      .then((response) => {
        if (response.status === 429) throw new Error('Steam is rate limiting review requests (HTTP 429). Try again later.');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const summary = data && (data.response || data).query_summary;
        if (!data || data.success === 0 || !summary ||
            !['total_positive', 'total_negative', 'total_reviews'].every(
              (key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0
            ) || summary.total_positive + summary.total_negative !== summary.total_reviews) {
          throw new Error('Steam returned an invalid review summary');
        }
        sendResponse({ success: true, summary });
      })
      .catch((err) => {
        console.error('[SteamDB Extension BG] Fetch error:', err);
        sendResponse({
          success: false,
          error: err.name === 'TimeoutError' ? 'Steam review request timed out. Try again.' : err.message
        });
      });

    return true; // Asynchronous response
  }
});
