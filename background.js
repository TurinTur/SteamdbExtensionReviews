/**
 * SteamDB Non-Chinese Reviews Extension Background Script
 * Handles cross-origin requests to store.steampowered.com
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchReviews') {
    const { appId, language, purchaseType } = request;
    const url = `https://store.steampowered.com/appreviews/${appId}?json=1&language=${encodeURIComponent(language)}&purchase_type=${encodeURIComponent(purchaseType)}&filter=all`;

    fetch(url, { credentials: 'omit' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (data && data.success && data.query_summary) {
          sendResponse({ success: true, summary: data.query_summary });
        } else {
          console.warn('[SteamDB Extension BG] API response missing query_summary:', data);
          sendResponse({
            success: false,
            summary: { total_positive: 0, total_negative: 0, total_reviews: 0 }
          });
        }
      })
      .catch((err) => {
        console.error('[SteamDB Extension BG] Fetch error:', err);
        sendResponse({
          success: false,
          error: err.message,
          summary: { total_positive: 0, total_negative: 0, total_reviews: 0 }
        });
      });

    return true; // Asynchronous response
  }
});
