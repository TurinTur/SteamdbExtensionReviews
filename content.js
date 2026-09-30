/**
 * SteamDB Non-Chinese Reviews Extension Content Script
 * Supports App Pages & Sales / Product Tables with Custom Rating & Diff Rating Columns
 */

(function () {
  'use strict';

  if (window.__sdbNonChineseInjected) return;
  window.__sdbNonChineseInjected = true;

  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hour local cache
  const memoryCache = new Map();

  const defaultSettings = {
    enabled: true,
    purchaseType: 'all', // 'all' or 'steam'
    excludeSimplifiedChinese: true,
    excludeTraditionalChinese: true,
  };
  let settings = { ...defaultSettings };
  let settingsLoaded = false;
  let injectionGeneration = 0;

  /**
   * Extract Steam AppID from current URL (App detail pages)
   */
  function getAppIdFromUrl() {
    const match = window.location.pathname.match(/\/app\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Calculate SteamDB Rating Formula
   */
  function calculateSteamDBRating(pos, neg) {
    const total = pos + neg;
    if (total === 0) return 0;
    const score = pos / total;
    const rating = score - (score - 0.5) * Math.pow(2, -Math.log10(total + 1));
    return rating * 100;
  }

  /**
   * Get descriptive review category
   */
  function getReviewCategory(pct, total) {
    if (total < 10) return { category: total === 0 ? 'No User Reviews' : `${total} User Review${total === 1 ? '' : 's'}`, emoji: '❓' };
    if (pct >= 95 && total >= 500) return { category: 'Overwhelmingly Positive', emoji: '🤩' };
    if (pct >= 80) return { category: 'Very Positive', emoji: '😀' };
    if (pct >= 70) return { category: 'Mostly Positive', emoji: '😏' };
    if (pct >= 40) return { category: 'Mixed', emoji: '😐' };
    if (pct >= 20) return { category: 'Mostly Negative', emoji: '😒' };
    if (total >= 500 && pct < 20) return { category: 'Overwhelmingly Negative', emoji: '😡' };
    return { category: 'Negative', emoji: '😞' };
  }

  /**
   * Fetch review summary via background script
   */
  function fetchReviewSummary(appId, language, purchaseType) {
    return new Promise((resolve, reject) => {
      const message = { action: 'fetchReviews', appId, language, purchaseType };

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success && response.summary) {
            resolve(response.summary);
          } else {
            reject(new Error(response && response.error || 'Steam review request failed'));
          }
        });
      } else {
        reject(new Error('Extension background is unavailable. Reload the extension and page.'));
      }
    });
  }

  /**
   * Fetch all review data and compute non-Chinese stats (with caching)
   */
  const inFlightPromises = new Map();

  function getStatsCacheKey(appId, reviewSettings = settings) {
    return `sdb_nc_v2_${appId}_${reviewSettings.purchaseType}_${Number(reviewSettings.excludeSimplifiedChinese)}_${Number(reviewSettings.excludeTraditionalChinese)}`;
  }

  /**
   * Fetch all review data and compute non-Chinese stats (with caching)
   */
  async function computeNonChineseStats(appId) {
    const reviewSettings = { ...settings };
    const pType = reviewSettings.purchaseType || 'all';
    const cacheKey = getStatsCacheKey(appId, reviewSettings);

    if (memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
      }
    }

    if (inFlightPromises.has(cacheKey)) {
      return inFlightPromises.get(cacheKey);
    }

    const promise = (async () => {
      const stored = await getFromStorage(cacheKey);
      if (stored && (Date.now() - stored.timestamp < CACHE_TTL_MS)) {
        memoryCache.set(cacheKey, stored);
        return stored.data;
      }

      const fetches = [fetchReviewSummary(appId, 'all', pType)];

      if (reviewSettings.excludeSimplifiedChinese) {
        fetches.push(fetchReviewSummary(appId, 'schinese', pType));
      } else {
        fetches.push(Promise.resolve({ total_positive: 0, total_negative: 0, total_reviews: 0 }));
      }

      if (reviewSettings.excludeTraditionalChinese) {
        fetches.push(fetchReviewSummary(appId, 'tchinese', pType));
      } else {
        fetches.push(Promise.resolve({ total_positive: 0, total_negative: 0, total_reviews: 0 }));
      }

      const [allSummary, schSummary, tchSummary] = await Promise.all(fetches);

      const allPos = allSummary.total_positive || 0;
      const allNeg = allSummary.total_negative || 0;

      const schPos = schSummary.total_positive || 0;
      const schNeg = schSummary.total_negative || 0;

      const tchPos = tchSummary.total_positive || 0;
      const tchNeg = tchSummary.total_negative || 0;

      const nonChinesePos = allPos - schPos - tchPos;
      const nonChineseNeg = allNeg - schNeg - tchNeg;
      if (nonChinesePos < 0 || nonChineseNeg < 0) {
        throw new Error('Steam returned inconsistent review totals. Try again later.');
      }
      const nonChineseTotal = nonChinesePos + nonChineseNeg;

      const nonChinesePct = nonChineseTotal > 0 ? (nonChinesePos / nonChineseTotal) * 100 : 0;
      const nonChineseSteamDB = calculateSteamDBRating(nonChinesePos, nonChineseNeg);

      const allTotal = allPos + allNeg;
      const allPct = allTotal > 0 ? (allPos / allTotal) * 100 : 0;
      const allSteamDB = calculateSteamDBRating(allPos, allNeg);

      const resultData = {
        excludedLanguages: [
          reviewSettings.excludeSimplifiedChinese ? 'Simplified Chinese' : null,
          reviewSettings.excludeTraditionalChinese ? 'Traditional Chinese' : null
        ].filter(Boolean),
        all: { pos: allPos, neg: allNeg, total: allTotal, pct: allPct, steamdb: allSteamDB },
        chinese: {
          schPos, schNeg, tchPos, tchNeg,
          totalPos: schPos + tchPos,
          totalNeg: schNeg + tchNeg,
          total: schPos + schNeg + tchPos + tchNeg
        },
        nonChinese: {
          pos: nonChinesePos,
          neg: nonChineseNeg,
          total: nonChineseTotal,
          pct: nonChinesePct,
          steamdb: nonChineseSteamDB,
          categoryInfo: getReviewCategory(nonChinesePct, nonChineseTotal),
          diffPct: nonChineseTotal > 0 ? nonChinesePct - allPct : 0
        }
      };

      const cachePayload = { timestamp: Date.now(), data: resultData };
      memoryCache.set(cacheKey, cachePayload);
      saveToStorage(cacheKey, cachePayload);

      return resultData;
    })();

    inFlightPromises.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlightPromises.delete(cacheKey);
    }
  }

  function getFromStorage(key) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (res) => resolve(res ? res[key] : null));
      } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.get([key]).then((res) => resolve(res ? res[key] : null)).catch(() => resolve(null));
      } else {
        resolve(null);
      }
    });
  }

  function saveToStorage(key, val) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: val });
    } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      browser.storage.local.set({ [key]: val }).catch(() => {});
    }
  }

  // ==========================================
  // APP PAGE INJECTION LOGIC
  // ==========================================

  function createStatsContainer(stats, appId) {
    const nc = stats.nonChinese;
    const all = stats.all;
    const container = document.createElement('div');
    container.className = 'sdb-non-chinese-container';
    container.id = 'sdb-non-chinese-reviews-block';

    const diffFormatted = nc.total > 0 ? (nc.diffPct >= 0 ? '+' : '') + nc.diffPct.toFixed(1) + '%' : 'N/A';
    const diffClass = nc.diffPct > 0.5 ? 'sdb-diff-positive' : (nc.diffPct < -0.5 ? 'sdb-diff-negative' : 'sdb-diff-neutral');

    const posPctStr = (nc.total > 0 ? (nc.pos / nc.total * 100) : 0).toFixed(1);
    const negPctStr = (nc.total > 0 ? (nc.neg / nc.total * 100) : 0).toFixed(1);

    // Use completely static HTML to satisfy Firefox security validators
    container.innerHTML = `
      <div class="sdb-non-chinese-header">
        <div class="sdb-non-chinese-title">
          <span class="sdb-non-chinese-icon"></span>
          <span>Non-Chinese User Reviews</span>
          <span class="sdb-non-chinese-badge"></span>
        </div>
        <div class="sdb-comparison-row" style="margin: 0;">
          <span class="sdb-diff-badge-header"></span>
        </div>
      </div>

      <div class="sdb-non-chinese-grid">
        <div class="sdb-stat-card">
          <div class="sdb-stat-label">Non-Chinese Score</div>
          <div class="sdb-stat-value sdb-score-val highlight-pos"></div>
          <div class="sdb-stat-subtext">Positive Reviews</div>
        </div>

        <div class="sdb-stat-card">
          <div class="sdb-stat-label">SteamDB Rating</div>
          <div class="sdb-stat-value sdb-rating-val"></div>
          <div class="sdb-stat-subtext">Adjusted Score</div>
        </div>

        <div class="sdb-stat-card">
          <div class="sdb-stat-label">Positive</div>
          <div class="sdb-stat-value sdb-pos-val highlight-pos"></div>
          <div class="sdb-stat-subtext sdb-pos-subtext"></div>
        </div>

        <div class="sdb-stat-card">
          <div class="sdb-stat-label">Negative</div>
          <div class="sdb-stat-value sdb-neg-val highlight-neg"></div>
          <div class="sdb-stat-subtext sdb-neg-subtext"></div>
        </div>
      </div>

      <div class="sdb-bar-container">
        <div class="sdb-bar-pos"></div>
        <div class="sdb-bar-neg"></div>
      </div>

      <div class="sdb-comparison-row">
        <span class="sdb-excluded-text"></span>
        <span><a class="sdb-steam-link" target="_blank" style="color: #66c0f4; text-decoration: none;">View on Steam ↗</a></span>
      </div>
    `;

    // Safely inject dynamic values using textContent/className/style/title
    container.querySelector('.sdb-non-chinese-icon').textContent = nc.categoryInfo.emoji;
    container.querySelector('.sdb-non-chinese-badge').textContent = nc.categoryInfo.category;

    const diffBadge = container.querySelector('.sdb-diff-badge-header');
    diffBadge.className = `sdb-diff-badge ${diffClass}`;
    diffBadge.title = `Difference compared to overall Steam rating (${all.pct.toFixed(1)}%)`;
    diffBadge.textContent = nc.total > 0 ? `${diffFormatted} vs Overall` : 'No score to compare';

    container.querySelector('.sdb-score-val').textContent = nc.total > 0 ? `${posPctStr}%` : 'N/A';
    container.querySelector('.sdb-rating-val').textContent = nc.total > 0 ? `${nc.steamdb.toFixed(2)}%` : 'N/A';

    container.querySelector('.sdb-pos-val').textContent = nc.pos.toLocaleString();
    container.querySelector('.sdb-pos-subtext').textContent = `${posPctStr}% of total`;

    container.querySelector('.sdb-neg-val').textContent = nc.neg.toLocaleString();
    container.querySelector('.sdb-neg-subtext').textContent = `${negPctStr}% of total`;

    const barContainer = container.querySelector('.sdb-bar-container');
    barContainer.title = `${nc.pos.toLocaleString()} positive / ${nc.neg.toLocaleString()} negative`;
    container.querySelector('.sdb-bar-pos').style.width = `${posPctStr}%`;
    container.querySelector('.sdb-bar-neg').style.width = `${negPctStr}%`;

    container.querySelector('.sdb-excluded-text').textContent = stats.excludedLanguages.length
      ? `Excludes ${stats.excludedLanguages.join(' & ')} (${stats.chinese.total.toLocaleString()} reviews filtered)`
      : 'Includes all review languages';

    const steamLink = container.querySelector('.sdb-steam-link');
    steamLink.href = `https://store.steampowered.com/app/${appId}/#app_reviews_hash`;

    return container;
  }

  function findTargetElement() {
    const reviewsTab = document.getElementById('reviews');
    if (reviewsTab) return { target: reviewsTab, pos: 'before' };

    const appCharts = document.querySelector('.row-app-charts');
    if (appCharts) return { target: appCharts, pos: 'before' };

    const tableStats = document.querySelector('.table-stats');
    if (tableStats) return { target: tableStats.parentElement, pos: 'before' };

    const headings = document.querySelectorAll('h2, h3, div, section');
    for (const el of headings) {
      if (el.textContent.includes('User reviews history') || el.textContent.includes('SteamDB Rating')) {
        const container = el.closest('.row, .section, .block, div') || el;
        return { target: container, pos: 'before' };
      }
    }

    const main = document.querySelector('.container-app') || document.querySelector('main') || document.body;
    return { target: main, pos: 'append' };
  }

  async function injectAppPage() {
    if (!settingsLoaded || !settings.enabled) return;
    const appId = getAppIdFromUrl();
    if (!appId) return;

    const existing = document.getElementById('sdb-non-chinese-reviews-block');
    if (existing && (existing.getAttribute('data-loaded') === 'true' || existing.getAttribute('data-loading') === 'true')) return;

    const { target, pos } = findTargetElement();
    if (!target) return;

    let loadingDiv = existing;
    if (!loadingDiv) {
      loadingDiv = document.createElement('div');
      loadingDiv.className = 'sdb-non-chinese-container';
      loadingDiv.id = 'sdb-non-chinese-reviews-block';
      loadingDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; font-size: 13px;">
          <div class="sdb-loading-spinner"></div>
          <span>Calculating Non-Chinese Review Score...</span>
        </div>
      `;

      if (pos === 'before' && target.parentNode) {
        target.parentNode.insertBefore(loadingDiv, target);
      } else {
        target.appendChild(loadingDiv);
      }
    }

    loadingDiv.setAttribute('data-loading', 'true');
    const generation = injectionGeneration;
    try {
      const stats = await computeNonChineseStats(appId);
      if (!settings.enabled || generation !== injectionGeneration || !loadingDiv.isConnected) return;
      const newContainer = createStatsContainer(stats, appId);
      newContainer.setAttribute('data-loaded', 'true');
      loadingDiv.replaceWith(newContainer);
    } catch (err) {
      if (!settings.enabled || generation !== injectionGeneration || !loadingDiv.isConnected) return;
      console.error('[SteamDB Extension] Error rendering stats:', err);
      loadingDiv.setAttribute('data-loading', 'false');
      loadingDiv.setAttribute('role', 'alert');
      loadingDiv.classList.add('sdb-review-error');
      const errorSpan = document.createElement('span');
      errorSpan.style.color = '#e06c75';
      errorSpan.textContent = `Failed to calculate Non-Chinese review stats: ${err.message}`;
      const retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'sdb-review-retry';
      retryButton.textContent = 'Retry';
      retryButton.addEventListener('click', () => {
        loadingDiv.remove();
        injectAppPage();
      });
      loadingDiv.replaceChildren(errorSpan, retryButton);
    }
  }

  // ==========================================
  // SALES TABLE COLUMNS & SORTING LOGIC
  // ==========================================

  const fetchQueue = [];
  let activeFetches = 0;
  const MAX_CONCURRENT_FETCHES = 3;

  function queueRowFetch(appId, customTd, diffTd) {
    fetchQueue.push({ appId, customTd, diffTd, generation: injectionGeneration });
    processQueue();
  }

  function processQueue() {
    while (settings.enabled && activeFetches < MAX_CONCURRENT_FETCHES && fetchQueue.length > 0) {
      const { appId, customTd, diffTd, generation } = fetchQueue.shift();
      if (generation !== injectionGeneration || !customTd.isConnected || !diffTd.isConnected) continue;
      activeFetches++;
      const canRender = () => settings.enabled && generation === injectionGeneration && customTd.isConnected && diffTd.isConnected;

      computeNonChineseStats(appId)
        .then((stats) => {
          if (canRender()) renderTableCells(customTd, diffTd, stats);
        })
        .catch((err) => {
          if (!canRender()) return;
          const customSpan = document.createElement('span');
          customSpan.className = 'sdb-badge-loading';
          customSpan.style.color = '#e06c75';
          customSpan.title = err.message;
          customSpan.textContent = 'N/A';
          customTd.replaceChildren(customSpan);

          const diffSpan = document.createElement('span');
          diffSpan.className = 'sdb-badge-loading';
          diffSpan.style.color = '#e06c75';
          diffSpan.title = err.message;
          diffSpan.textContent = 'N/A';
          diffTd.replaceChildren(diffSpan);
        })
        .finally(() => {
          activeFetches--;
          processQueue();
        });
    }
  }

  function renderTableCells(customTd, diffTd, stats) {
    const nc = stats.nonChinese;
    const all = stats.all;

    if (nc.total === 0) {
      const customSpan = document.createElement('span');
      customSpan.className = 'sdb-table-rating-badge sdb-badge-mid';
      customSpan.title = 'No non-Chinese reviews found';
      customSpan.textContent = 'N/A';
      customTd.replaceChildren(customSpan);

      const diffSpan = document.createElement('span');
      diffSpan.className = 'sdb-diff-badge sdb-diff-neutral';
      diffSpan.title = 'No non-Chinese reviews found';
      diffSpan.textContent = 'N/A';
      diffTd.replaceChildren(diffSpan);
      return;
    }

    // Render Custom Rating cell
    const pct = nc.pct;
    const pctStr = pct.toFixed(1) + '%';
    let badgeClass = 'sdb-badge-high';
    if (pct < 60) badgeClass = 'sdb-badge-low';
    else if (pct < 75) badgeClass = 'sdb-badge-mid';

    const customTooltip = `Non-Chinese Score: ${pctStr} (${nc.pos.toLocaleString()} pos / ${nc.neg.toLocaleString()} neg)\nOverall: ${all.pct.toFixed(1)}%\nFiltered Chinese Reviews: ${stats.chinese.total.toLocaleString()}`;
    const customSpan = document.createElement('span');
    customSpan.className = `sdb-table-rating-badge ${badgeClass}`;
    customSpan.title = customTooltip;
    customSpan.textContent = pctStr;
    customTd.replaceChildren(customSpan);

    // Render Diff Rating cell
    const diff = nc.diffPct;
    const diffFormatted = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
    let diffClass = 'sdb-diff-neutral';
    if (diff > 0.5) diffClass = 'sdb-diff-positive';
    else if (diff < -0.5) diffClass = 'sdb-diff-negative';

    const diffTooltip = `Difference: ${diffFormatted} vs overall score (${all.pct.toFixed(1)}%)\nNon-Chinese: ${pctStr}`;
    const diffSpan = document.createElement('span');
    diffSpan.className = `sdb-diff-badge ${diffClass}`;
    diffSpan.title = diffTooltip;
    diffSpan.textContent = diffFormatted;
    diffTd.replaceChildren(diffSpan);
  }

  function parseCellValue(td, type) {
    if (!td) return type === 'diff' ? 0 : -1;
    if (type === 'custom') {
      const badge = td.querySelector('.sdb-table-rating-badge');
      if (!badge) return -1;
      const text = badge.textContent.trim().replace('%', '');
      const num = parseFloat(text);
      return isNaN(num) ? -1 : num;
    } else {
      const badge = td.querySelector('.sdb-diff-badge');
      if (!badge) return 0;
      const text = badge.textContent.trim().replace('+', '').replace('%', '');
      const num = parseFloat(text);
      return isNaN(num) ? 0 : num;
    }
  }

  function sortTableByColumn(table, thHeader, columnType) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const currentSort = thHeader.getAttribute('data-sort-dir') || 'none';
    const newSort = currentSort === 'desc' ? 'asc' : 'desc';
    thHeader.setAttribute('data-sort-dir', newSort);

    const allThs = table.querySelectorAll('th');
    allThs.forEach((th) => {
      th.classList.remove('dt-ordering-asc', 'dt-ordering-desc');
      th.removeAttribute('aria-sort');
    });

    if (newSort === 'asc') {
      thHeader.classList.add('dt-ordering-asc');
      thHeader.setAttribute('aria-sort', 'ascending');
    } else {
      thHeader.classList.add('dt-ordering-desc');
      thHeader.setAttribute('aria-sort', 'descending');
    }

    const targetClass = columnType === 'custom' ? '.sdb-custom-rating-td' : '.sdb-diff-rating-td';
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort((a, b) => {
      const tdA = a.querySelector(targetClass);
      const tdB = b.querySelector(targetClass);

      const valA = parseCellValue(tdA, columnType);
      const valB = parseCellValue(tdB, columnType);

      return newSort === 'asc' ? (valA - valB) : (valB - valA);
    });

    rows.forEach((row) => tbody.appendChild(row));
  }

  function injectSalesTables() {
    if (!settingsLoaded || !settings.enabled) return;
    const tables = document.querySelectorAll('table');
    tables.forEach((table) => {
      const thead = table.querySelector('thead');
      if (!thead) return;

      const headerRows = thead.querySelectorAll('tr');
      if (headerRows.length === 0) return;

      let targetHeaderRow = null;
      let ratingTh = null;
      let ratingColIdx = -1;

      headerRows.forEach((hRow) => {
        // Exclude extension's injected headers to always work against original SteamDB columns
        const originalThs = Array.from(hRow.children).filter(
          (th) => !th.classList.contains('sdb-custom-rating-th') && !th.classList.contains('sdb-diff-rating-th')
        );

        originalThs.forEach((th, idx) => {
          const text = th.textContent.trim();
          if (/rating/i.test(text)) {
            ratingColIdx = idx;
            ratingTh = th;
            targetHeaderRow = hRow;
          }
        });
      });

      if (ratingColIdx === -1 || !targetHeaderRow || !ratingTh) return;

      // Insert Custom Rating Header if not present
      let customTh = targetHeaderRow.querySelector('.sdb-custom-rating-th');
      if (!customTh) {
        customTh = document.createElement('th');
        customTh.className = 'dt-type-numeric dt-orderable-asc dt-orderable-desc sdb-custom-rating-th';
        customTh.tabIndex = 0;
        customTh.role = 'columnheader';
        customTh.setAttribute('aria-label', 'Custom Rating: activate to sort column');

        customTh.innerHTML = `
          <div class="dt-column-header">
            <span class="dt-column-title" title="Custom Non-Chinese Rating">Custom Rating</span>
            <span class="dt-column-order" role="button" aria-label="Custom Rating: Activate to sort" tabindex="0"></span>
          </div>
        `;

        customTh.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          sortTableByColumn(table, customTh, 'custom');
        });

        ratingTh.after(customTh);
      }

      // Insert Diff Rating Header if not present
      let diffTh = targetHeaderRow.querySelector('.sdb-diff-rating-th');
      if (!diffTh) {
        diffTh = document.createElement('th');
        diffTh.className = 'dt-type-numeric dt-orderable-asc dt-orderable-desc sdb-diff-rating-th';
        diffTh.tabIndex = 0;
        diffTh.role = 'columnheader';
        diffTh.setAttribute('aria-label', 'Diff Rating: activate to sort column');

        diffTh.innerHTML = `
          <div class="dt-column-header">
            <span class="dt-column-title" title="Difference vs Overall Rating Score">Diff Rating</span>
            <span class="dt-column-order" role="button" aria-label="Diff Rating: Activate to sort" tabindex="0"></span>
          </div>
        `;

        diffTh.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          sortTableByColumn(table, diffTh, 'diff');
        });

        customTh.after(diffTh);
      }

      // Ensure any secondary header rows also have placeholder headers
      headerRows.forEach((hRow) => {
        if (hRow === targetHeaderRow) return;
        if (hRow.querySelector('.sdb-custom-rating-th')) return;

        const origThs = Array.from(hRow.children).filter(
          (th) => !th.classList.contains('sdb-custom-rating-th') && !th.classList.contains('sdb-diff-rating-th')
        );
        if (origThs.length > ratingColIdx) {
          const targetTh = origThs[ratingColIdx];
          const placeholderCustom = document.createElement('th');
          placeholderCustom.className = 'sdb-custom-rating-th';
          const placeholderDiff = document.createElement('th');
          placeholderDiff.className = 'sdb-diff-rating-th';
          targetTh.after(placeholderCustom);
          placeholderCustom.after(placeholderDiff);
        }
      });

      // Ensure any footer rows have matching placeholders
      const tfootRows = table.querySelectorAll('tfoot tr');
      tfootRows.forEach((fRow) => {
        if (fRow.querySelector('.sdb-custom-rating-td')) return;

        const origTds = Array.from(fRow.children).filter(
          (td) => !td.classList.contains('sdb-custom-rating-td') && !td.classList.contains('sdb-diff-rating-td')
        );
        if (origTds.length > ratingColIdx) {
          const targetTd = origTds[ratingColIdx];
          const placeholderCustom = document.createElement('td');
          placeholderCustom.className = 'sdb-custom-rating-td';
          const placeholderDiff = document.createElement('td');
          placeholderDiff.className = 'sdb-diff-rating-td';
          targetTd.after(placeholderCustom);
          placeholderCustom.after(placeholderDiff);
        }
      });

      // Process tbody rows
      const tbodyRows = table.querySelectorAll('tbody tr');
      tbodyRows.forEach((row) => {
        if (row.querySelector('.sdb-custom-rating-td')) return;

        // Filter out extension td elements so original SteamDB column indices are preserved
        const originalTds = Array.from(row.children).filter(
          (td) => !td.classList.contains('sdb-custom-rating-td') && !td.classList.contains('sdb-diff-rating-td')
        );

        if (originalTds.length <= ratingColIdx) return;

        const ratingTd = originalTds[ratingColIdx];

        let appId = row.getAttribute('data-appid');
        if (!appId) {
          const appLink = row.querySelector('a[href*="/app/"]');
          if (appLink) {
            const m = appLink.href.match(/\/app\/(\d+)/);
            if (m) appId = m[1];
          }
        }

        const customTd = document.createElement('td');
        customTd.className = 'sdb-custom-rating-td';

        const diffTd = document.createElement('td');
        diffTd.className = 'sdb-diff-rating-td';

        if (appId) {
          const cacheKey = getStatsCacheKey(appId);

          // Fast-path: if data is already in memory cache, render immediately
          if (memoryCache.has(cacheKey)) {
            const cached = memoryCache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
              renderTableCells(customTd, diffTd, cached.data);
              ratingTd.after(customTd);
              customTd.after(diffTd);
              return;
            }
          }

          const customSpan = document.createElement('span');
          customSpan.className = 'sdb-badge-loading';
          customSpan.textContent = '...';
          customTd.replaceChildren(customSpan);

          const diffSpan = document.createElement('span');
          diffSpan.className = 'sdb-badge-loading';
          diffSpan.textContent = '...';
          diffTd.replaceChildren(diffSpan);

          ratingTd.after(customTd);
          customTd.after(diffTd);
          queueRowFetch(appId, customTd, diffTd);
        } else {
          customTd.textContent = '-';
          diffTd.textContent = '-';
          ratingTd.after(customTd);
          customTd.after(diffTd);
        }
      });
    });
  }

  // ==========================================
  // INITIALIZATION & OBSERVERS
  // ==========================================

  function runAllInjections() {
    if (!settingsLoaded || !settings.enabled) return;
    if (getAppIdFromUrl()) {
      injectAppPage();
    }
    injectSalesTables();
  }

  function resetInjections() {
    injectionGeneration++;
    fetchQueue.length = 0;
    document.querySelectorAll('#sdb-non-chinese-reviews-block, .sdb-custom-rating-th, .sdb-diff-rating-th, .sdb-custom-rating-td, .sdb-diff-rating-td')
      .forEach((element) => element.remove());
  }

  function loadSettings(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(settings, (res) => {
        if (res) settings = { ...settings, ...res };
        if (callback) callback();
      });
    } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      browser.storage.local.get(settings).then((res) => {
        if (res) settings = { ...settings, ...res };
        if (callback) callback();
      }).catch(() => { if (callback) callback(); });
    } else {
      if (callback) callback();
    }
  }

  loadSettings(() => {
    settingsLoaded = true;
    runAllInjections();
  });

  const storageEvents = typeof chrome !== 'undefined' && chrome.storage
    ? chrome.storage.onChanged
    : typeof browser !== 'undefined' && browser.storage ? browser.storage.onChanged : null;
  if (storageEvents) {
    storageEvents.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      let changed = false;
      for (const key of Object.keys(defaultSettings)) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        const value = changes[key].newValue ?? defaultSettings[key];
        if (value !== settings[key]) {
          settings[key] = value;
          changed = true;
        }
      }
      if (changed) {
        resetInjections();
        runAllInjections();
      }
    });
  }

  let injectTimer = null;
  function debouncedInjectSalesTables() {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectTimer = null;
      injectSalesTables();
    }, 40);
  }

  let lastPath = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastPath) {
      lastPath = window.location.href;
      resetInjections();
      setTimeout(runAllInjections, 300);
    } else {
      debouncedInjectSalesTables();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

})();
