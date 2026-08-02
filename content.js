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

  let settings = {
    enabled: true,
    purchaseType: 'all', // 'all' or 'steam'
    excludeSimplifiedChinese: true,
    excludeTraditionalChinese: true,
  };

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
    if (total < 10) return { category: 'No User Reviews', emoji: '❓' };
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
    return new Promise((resolve) => {
      const message = { action: 'fetchReviews', appId, language, purchaseType };

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[SteamDB Extension] Message error, fallback to direct fetch:', chrome.runtime.lastError);
            directFetchReviewSummary(appId, language, purchaseType).then(resolve);
          } else if (response && response.summary) {
            resolve(response.summary);
          } else {
            directFetchReviewSummary(appId, language, purchaseType).then(resolve);
          }
        });
      } else {
        directFetchReviewSummary(appId, language, purchaseType).then(resolve);
      }
    });
  }

  /**
   * Direct fetch fallback
   */
  async function directFetchReviewSummary(appId, language, purchaseType) {
    const url = `https://store.steampowered.com/appreviews/${appId}?json=1&language=${encodeURIComponent(language)}&purchase_type=${encodeURIComponent(purchaseType)}&filter=all`;
    try {
      const resp = await fetch(url, { credentials: 'omit' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data && data.success && data.query_summary) {
        return data.query_summary;
      }
      return { total_positive: 0, total_negative: 0, total_reviews: 0 };
    } catch (err) {
      console.warn(`[SteamDB Extension] Direct fetch failed for ${language}:`, err);
      return { total_positive: 0, total_negative: 0, total_reviews: 0 };
    }
  }

  /**
   * Fetch all review data and compute non-Chinese stats (with caching)
   */
  async function computeNonChineseStats(appId) {
    const pType = settings.purchaseType || 'all';
    const cacheKey = `sdb_nc_${appId}_${pType}`;

    if (memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
      }
    }

    const stored = await getFromStorage(cacheKey);
    if (stored && (Date.now() - stored.timestamp < CACHE_TTL_MS)) {
      memoryCache.set(cacheKey, stored);
      return stored.data;
    }

    const fetches = [fetchReviewSummary(appId, 'all', pType)];

    if (settings.excludeSimplifiedChinese) {
      fetches.push(fetchReviewSummary(appId, 'schinese', pType));
    } else {
      fetches.push(Promise.resolve({ total_positive: 0, total_negative: 0, total_reviews: 0 }));
    }

    if (settings.excludeTraditionalChinese) {
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

    const nonChinesePos = Math.max(0, allPos - schPos - tchPos);
    const nonChineseNeg = Math.max(0, allNeg - schNeg - tchNeg);
    const nonChineseTotal = nonChinesePos + nonChineseNeg;

    const nonChinesePct = nonChineseTotal > 0 ? (nonChinesePos / nonChineseTotal) * 100 : 0;
    const nonChineseSteamDB = calculateSteamDBRating(nonChinesePos, nonChineseNeg);

    const allTotal = allPos + allNeg;
    const allPct = allTotal > 0 ? (allPos / allTotal) * 100 : 0;
    const allSteamDB = calculateSteamDBRating(allPos, allNeg);

    const resultData = {
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
        diffPct: nonChinesePct - allPct
      }
    };

    const cachePayload = { timestamp: Date.now(), data: resultData };
    memoryCache.set(cacheKey, cachePayload);
    saveToStorage(cacheKey, cachePayload);

    return resultData;
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

    const diffFormatted = (nc.diffPct >= 0 ? '+' : '') + nc.diffPct.toFixed(1) + '%';
    const diffClass = nc.diffPct > 0.5 ? 'sdb-diff-positive' : (nc.diffPct < -0.5 ? 'sdb-diff-negative' : 'sdb-diff-neutral');

    const posPctStr = (nc.total > 0 ? (nc.pos / nc.total * 100) : 0).toFixed(1);
    const negPctStr = (nc.total > 0 ? (nc.neg / nc.total * 100) : 0).toFixed(1);

    container.innerHTML = `
      <div class="sdb-non-chinese-header">
        <div class="sdb-non-chinese-title">
          <span class="sdb-non-chinese-icon">${nc.categoryInfo.emoji}</span>
          <span>Non-Chinese User Reviews</span>
          <span class="sdb-non-chinese-badge">${nc.categoryInfo.category}</span>
        </div>
        <div class="sdb-comparison-row" style="margin: 0;">
          <span class="sdb-diff-badge ${diffClass}" title="Difference compared to overall Steam rating (${all.pct.toFixed(1)}%)">
            ${diffFormatted} vs Overall
          </span>
        </div>
      </div>

      <div class="sdb-non-chinese-grid">
        <div class="sdb-stat-card">
          <div class="sdb-stat-label">Non-Chinese Score</div>
          <div class="sdb-stat-value highlight-pos">${posPctStr}%</div>
          <div class="sdb-stat-subtext">Positive Reviews</div>
        </div>

        <div class="sdb-stat-card">
          <div class="sdb-stat-label">SteamDB Rating</div>
          <div class="sdb-stat-value">${nc.steamdb.toFixed(2)}%</div>
          <div class="sdb-stat-subtext">Adjusted Score</div>
        </div>

        <div class="sdb-stat-card">
          <div class="sdb-stat-label">Positive</div>
          <div class="sdb-stat-value highlight-pos">${nc.pos.toLocaleString()}</div>
          <div class="sdb-stat-subtext">${posPctStr}% of total</div>
        </div>

        <div class="sdb-stat-card">
          <div class="sdb-stat-label">Negative</div>
          <div class="sdb-stat-value highlight-neg">${nc.neg.toLocaleString()}</div>
          <div class="sdb-stat-subtext">${negPctStr}% of total</div>
        </div>
      </div>

      <div class="sdb-bar-container" title="${nc.pos.toLocaleString()} positive / ${nc.neg.toLocaleString()} negative">
        <div class="sdb-bar-pos" style="width: ${posPctStr}%"></div>
        <div class="sdb-bar-neg" style="width: ${negPctStr}%"></div>
      </div>

      <div class="sdb-comparison-row">
        <span>Excludes Simplified & Traditional Chinese (${stats.chinese.total.toLocaleString()} reviews filtered)</span>
        <span><a href="https://store.steampowered.com/app/${appId}/#app_reviews_hash" target="_blank" style="color: #66c0f4; text-decoration: none;">View on Steam ↗</a></span>
      </div>
    `;

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
    const appId = getAppIdFromUrl();
    if (!appId) return;

    const existing = document.getElementById('sdb-non-chinese-reviews-block');
    if (existing && existing.getAttribute('data-loaded') === 'true') return;

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

    try {
      const stats = await computeNonChineseStats(appId);
      const newContainer = createStatsContainer(stats, appId);
      newContainer.setAttribute('data-loaded', 'true');
      loadingDiv.replaceWith(newContainer);
    } catch (err) {
      console.error('[SteamDB Extension] Error rendering stats:', err);
      loadingDiv.innerHTML = `<span style="color: #e06c75;">Failed to calculate Non-Chinese review stats: ${err.message}</span>`;
    }
  }

  // ==========================================
  // SALES TABLE COLUMNS & SORTING LOGIC
  // ==========================================

  const fetchQueue = [];
  let activeFetches = 0;
  const MAX_CONCURRENT_FETCHES = 3;

  function queueRowFetch(appId, customTd, diffTd) {
    fetchQueue.push({ appId, customTd, diffTd });
    processQueue();
  }

  function processQueue() {
    if (activeFetches >= MAX_CONCURRENT_FETCHES || fetchQueue.length === 0) return;
    const { appId, customTd, diffTd } = fetchQueue.shift();
    activeFetches++;

    computeNonChineseStats(appId)
      .then((stats) => {
        renderTableCells(customTd, diffTd, stats);
      })
      .catch(() => {
        customTd.innerHTML = `<span class="sdb-badge-loading" style="color: #e06c75;">N/A</span>`;
        diffTd.innerHTML = `<span class="sdb-badge-loading" style="color: #e06c75;">N/A</span>`;
      })
      .finally(() => {
        activeFetches--;
        processQueue();
      });
  }

  function renderTableCells(customTd, diffTd, stats) {
    const nc = stats.nonChinese;
    const all = stats.all;

    if (nc.total === 0) {
      customTd.innerHTML = `<span class="sdb-table-rating-badge sdb-badge-mid" title="No non-Chinese reviews found">N/A</span>`;
      diffTd.innerHTML = `<span class="sdb-diff-badge sdb-diff-neutral" title="No non-Chinese reviews found">+0.0%</span>`;
      return;
    }

    // Render Custom Rating cell
    const pct = nc.pct;
    const pctStr = pct.toFixed(1) + '%';
    let badgeClass = 'sdb-badge-high';
    if (pct < 60) badgeClass = 'sdb-badge-low';
    else if (pct < 75) badgeClass = 'sdb-badge-mid';

    const customTooltip = `Non-Chinese Score: ${pctStr} (${nc.pos.toLocaleString()} pos / ${nc.neg.toLocaleString()} neg)\nOverall: ${all.pct.toFixed(1)}%\nFiltered Chinese Reviews: ${stats.chinese.total.toLocaleString()}`;
    customTd.innerHTML = `<span class="sdb-table-rating-badge ${badgeClass}" title="${customTooltip}">${pctStr}</span>`;

    // Render Diff Rating cell
    const diff = nc.diffPct;
    const diffFormatted = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
    let diffClass = 'sdb-diff-neutral';
    if (diff > 0.5) diffClass = 'sdb-diff-positive';
    else if (diff < -0.5) diffClass = 'sdb-diff-negative';

    const diffTooltip = `Difference: ${diffFormatted} vs overall score (${all.pct.toFixed(1)}%)\nNon-Chinese: ${pctStr}`;
    diffTd.innerHTML = `<span class="sdb-diff-badge ${diffClass}" title="${diffTooltip}">${diffFormatted}</span>`;
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
    const tables = document.querySelectorAll('table');
    tables.forEach((table) => {
      const thead = table.querySelector('thead');
      if (!thead) return;

      const headerRows = thead.querySelectorAll('tr');
      if (headerRows.length === 0) return;

      let targetHeaderRow = null;
      let ratingColIdx = -1;

      headerRows.forEach((hRow) => {
        const ths = Array.from(hRow.children);
        ths.forEach((th, idx) => {
          const text = th.textContent.trim();
          if (text === 'Rating' || text === '%' || text.includes('Rating')) {
            ratingColIdx = idx;
            targetHeaderRow = hRow;
          }
        });
      });

      if (ratingColIdx === -1 || !targetHeaderRow) return;

      const ratingTh = targetHeaderRow.children[ratingColIdx];

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

      // Process tbody rows
      const tbodyRows = table.querySelectorAll('tbody tr');
      tbodyRows.forEach((row) => {
        if (row.querySelector('.sdb-custom-rating-td')) return;

        const tds = row.children;
        if (tds.length <= ratingColIdx) return;

        const ratingTd = tds[ratingColIdx];

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
          customTd.innerHTML = `<span class="sdb-badge-loading">...</span>`;
          diffTd.innerHTML = `<span class="sdb-badge-loading">...</span>`;
          ratingTd.after(customTd);
          customTd.after(diffTd);
          queueRowFetch(appId, customTd, diffTd);
        } else {
          customTd.innerHTML = `-`;
          diffTd.innerHTML = `-`;
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
    if (!settings.enabled) return;
    if (getAppIdFromUrl()) {
      injectAppPage();
    }
    injectSalesTables();
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
    runAllInjections();
  });

  let lastPath = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastPath) {
      lastPath = window.location.href;
      setTimeout(runAllInjections, 300);
    } else {
      injectSalesTables();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

})();
