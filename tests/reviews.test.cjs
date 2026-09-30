const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function summary(positive, negative) {
  return { total_positive: positive, total_negative: negative, total_reviews: positive + negative };
}

function createExtension(responses, options = {}) {
  const stored = options.stored || {};
  const requests = [];
  const writes = [];
  const queries = [];
  const timers = new Map();
  let nextTimer = 0;
  let listener;
  let storageListener;
  let mutationListener;
  let apiAccess = options.apiAccess !== false;
  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      sendMessage(message, callback) { listener(message, {}, callback); },
    },
    permissions: {
      contains(permissions, callback) {
        assert.deepEqual(Array.from(permissions.origins), ['https://api.steampowered.com/*']);
        callback(apiAccess);
      },
    },
    storage: {
      onChanged: { addListener(callback) { storageListener = callback; } },
      local: {
        get(keys, callback) {
          if (Array.isArray(keys)) {
            callback(Object.fromEntries(keys.map((key) => [key, stored[key]])));
          } else {
            callback({ ...keys, enabled: false, ...options.settings });
          }
        },
        set(values) {
          writes.push(values);
          Object.assign(stored, values);
        },
      },
    },
  };
  const context = vm.createContext({
    chrome,
    ...(options.firefoxPermissions ? { browser: { permissions: { contains() { return Promise.resolve(apiAccess); } } } } : {}),
    console: { warn() {}, error() {} },
    URL,
    AbortSignal,
    fetch: async (url) => {
      requests.push(new URL(url));
      const language = JSON.parse(new URL(url).searchParams.get('input_json')).languages[0];
      const response = responses[language];
      if (response instanceof Error) throw response;
      return {
        ok: !response.status || response.status === 200,
        status: response.status || 200,
        json: async () => response.data || { response: { query_summary: response } },
      };
    },
    window: { location: { pathname: '/sales/', href: 'https://steamdb.info/sales/' } },
    document: { body: {}, querySelectorAll(selector) { queries.push(selector); return []; } },
    MutationObserver: class { constructor(callback) { mutationListener = callback; } observe() {} },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(backgroundSource, context);
  const marker = '  loadSettings(() => {';
  assert.ok(contentSource.includes(marker));
  vm.runInContext(contentSource.replace(marker,
    '  globalThis.reviewTests = { computeNonChineseStats, updateSettings(value) { settings = { ...settings, ...value }; } };\n' + marker), context);
  return {
    getStats: context.reviewTests.computeNonChineseStats,
    updateSettings: context.reviewTests.updateSettings,
    setApiAccess(value) { apiAccess = value; },
    changeStorage(changes, area = 'local') { storageListener(changes, area); },
    mutate() { mutationListener(); },
    flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); },
    requests, writes, stored, chrome, queries,
  };
}

const validResponses = {
  all: summary(1200, 300),
  schinese: summary(300, 100),
  tchinese: summary(100, 50),
};

test('subtracts both Chinese languages and caches successful summaries', async () => {
  const extension = createExtension(validResponses);
  const stats = await extension.getStats('1623730');
  assert.equal(stats.nonChinese.pos, 800);
  assert.equal(stats.nonChinese.neg, 150);
  assert.equal(stats.nonChinese.total, 950);
  assert.equal(stats.chinese.total, 550);
  assert.equal(extension.requests.length, 3);
  assert.equal(extension.writes.length, 1);
  assert.equal(await extension.getStats('1623730'), stats);
  assert.equal(extension.requests.length, 3);
});

test('HTTP failures are not reported or cached as zero reviews and can be retried', async () => {
  const responses = { ...validResponses, all: { status: 403 } };
  const extension = createExtension(responses);
  await assert.rejects(extension.getStats('1623730'), /HTTP 403/);
  assert.equal(extension.writes.length, 0);
  responses.all = validResponses.all;
  assert.equal((await extension.getStats('1623730')).nonChinese.total, 950);
  assert.equal(extension.requests.length, 6);
});

test('missing Firefox API permission is diagnosed before fetching and a grant permits retry', async () => {
  const extension = createExtension(validResponses, { apiAccess: false });
  await assert.rejects(extension.getStats('3669870'), /Steam API access is not granted.*popup/);
  assert.equal(extension.requests.length, 0);
  assert.equal(extension.writes.length, 0);
  extension.setApiAccess(true);
  assert.equal((await extension.getStats('3669870')).nonChinese.total, 950);
  assert.equal(extension.requests.length, 3);
});

test('background checks Firefox native Promise permissions as well as callback permissions', async () => {
  const extension = createExtension(validResponses, { apiAccess: false, firefoxPermissions: true });
  await assert.rejects(extension.getStats('3669870'), /Steam API access is not granted/);
  extension.setApiAccess(true);
  assert.equal((await extension.getStats('3669870')).nonChinese.total, 950);
});

test('failure of an excluded-language request fails the entire calculation', async () => {
  const extension = createExtension({ ...validResponses, schinese: new Error('Network unavailable') });
  await assert.rejects(extension.getStats('1623730'), /Network unavailable/);
  assert.equal(extension.writes.length, 0);
});

test('rejects missing, failed, non-numeric and inconsistent API summaries', async () => {
  for (const response of [
    { data: { success: 1 } },
    { data: { success: 0, query_summary: summary(0, 0) } },
    { total_positive: '1200', total_negative: 300, total_reviews: 1500 },
    { total_positive: -1, total_negative: 300, total_reviews: 299 },
    { total_positive: 1200, total_negative: 300, total_reviews: 20 },
  ]) {
    const extension = createExtension({ ...validResponses, all: response });
    await assert.rejects(extension.getStats('1623730'), /invalid review summary/);
    assert.equal(extension.writes.length, 0);
  }
});

test('rejects language totals larger than overall counts instead of clamping them to zero', async () => {
  const extension = createExtension({ ...validResponses, all: summary(20, 10) });
  await assert.rejects(extension.getStats('1623730'), /inconsistent review totals/);
  assert.equal(extension.writes.length, 0);
});

test('preserves genuine zero-review results', async () => {
  const extension = createExtension({ all: summary(0, 0), schinese: summary(0, 0), tchinese: summary(0, 0) });
  assert.equal((await extension.getStats('1623730')).nonChinese.total, 0);
  assert.equal(extension.writes.length, 1);
});

test('ignores legacy cached results that may contain failed zero-review counts', async () => {
  const extension = createExtension(validResponses, {
    stored: { sdb_nc_1623730_all: { timestamp: Date.now(), data: { nonChinese: { total: 0 } } } },
  });
  assert.equal((await extension.getStats('1623730')).nonChinese.total, 950);
  assert.equal(extension.requests.length, 3);
});

test('keeps every language filter combination in a separate cache entry', async () => {
  const extension = createExtension(validResponses);
  for (const [simplified, traditional, total] of [
    [true, true, 950], [false, true, 1350], [true, false, 1100], [false, false, 1500],
  ]) {
    extension.updateSettings({ excludeSimplifiedChinese: simplified, excludeTraditionalChinese: traditional });
    const stats = await extension.getStats('1623730');
    assert.equal(stats.nonChinese.total, total);
    assert.equal(stats.excludedLanguages.length, Number(simplified) + Number(traditional));
  }
  assert.equal(extension.requests.length, 8);
  assert.equal(extension.writes.length, 4);
  extension.updateSettings({ excludeSimplifiedChinese: true, excludeTraditionalChinese: true });
  assert.equal((await extension.getStats('1623730')).nonChinese.total, 950);
  assert.equal(extension.requests.length, 8);
});

test('snapshots filters for in-flight requests while settings change', async () => {
  const extension = createExtension(validResponses);
  const original = extension.getStats('1623730');
  extension.updateSettings({ excludeSimplifiedChinese: false, excludeTraditionalChinese: false });
  const unfiltered = extension.getStats('1623730');
  assert.equal((await original).nonChinese.total, 950);
  assert.equal((await unfiltered).nonChinese.total, 1500);
  assert.equal(extension.requests.length, 4);
});

test('deduplicates concurrent requests for the same app and filters', async () => {
  const extension = createExtension(validResponses);
  const [first, second] = await Promise.all([extension.getStats('1623730'), extension.getStats('1623730')]);
  assert.equal(first, second);
  assert.equal(extension.requests.length, 3);
});

test('separates purchase filters and passes the selected filter to Steam', async () => {
  const extension = createExtension(validResponses);
  await extension.getStats('1623730');
  extension.updateSettings({ purchaseType: 'steam' });
  await extension.getStats('1623730');
  assert.equal(extension.requests.length, 6);
  assert.ok(extension.requests.slice(3).every((url) => JSON.parse(url.searchParams.get('input_json')).purchase_type === 0));
  assert.equal(extension.writes.length, 2);
});

test('reuses valid persisted summaries without additional requests', async () => {
  const first = createExtension(validResponses);
  await first.getStats('1623730');
  const second = createExtension(validResponses, { stored: first.stored });
  assert.equal((await second.getStats('1623730')).nonChinese.total, 950);
  assert.equal(second.requests.length, 0);
});

test('uses the current public API with explicit all-time, purchase and review filters', async () => {
  const extension = createExtension(validResponses);
  await extension.getStats('1623730');
  const first = extension.requests[0];
  assert.equal(first.origin, 'https://api.steampowered.com');
  assert.equal(first.pathname, '/IUserReviewsService/GetAppReviews/v1/');
  assert.deepEqual(JSON.parse(first.searchParams.get('input_json')), {
    appid: 1623730,
    languages: ['all'],
    purchase_type: 1,
    filter: 1,
    review_type: 0,
    num_per_page: 1,
    filter_offtopic_activity: true,
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(manifest.optional_host_permissions.includes(`${first.origin}/*`));
});

test('explains rate limits without caching them', async () => {
  const extension = createExtension({ ...validResponses, all: { status: 429 } });
  await assert.rejects(extension.getStats('1623730'), /rate limiting.*429/);
  assert.equal(extension.writes.length, 0);
});

test('rejects invalid request parameters before fetching', async () => {
  const extension = createExtension(validResponses);
  for (const appId of ['not-an-app', '0', '-1', '4294967296']) {
    await assert.rejects(extension.getStats(appId), /Invalid review request/);
  }
  assert.equal(extension.requests.length, 0);
});

test('disabled extensions do not inject tables in response to DOM mutations', () => {
  const extension = createExtension(validResponses);
  extension.mutate();
  extension.flushTimers();
  assert.equal(extension.queries.length, 0);
});

test('settings changes refresh injections immediately and disabling stops further injection', () => {
  const extension = createExtension(validResponses);
  extension.changeStorage({ enabled: { newValue: true } });
  assert.equal(extension.queries.filter((selector) => selector === 'table').length, 1);
  extension.changeStorage({ excludeSimplifiedChinese: { newValue: false } });
  assert.equal(extension.queries.filter((selector) => selector === 'table').length, 2);
  extension.changeStorage({ enabled: { newValue: false } });
  extension.mutate();
  extension.flushTimers();
  assert.equal(extension.queries.filter((selector) => selector === 'table').length, 2);
});

test('cache writes and unrelated storage changes do not refresh page injections', () => {
  const extension = createExtension(validResponses);
  extension.changeStorage({ sdb_nc_v2_1623730_all_1_1: { newValue: {} } });
  extension.changeStorage({ enabled: { newValue: true } }, 'sync');
  assert.equal(extension.queries.length, 0);
});

test('games with a few reviews show their review count, not No User Reviews', async () => {
  const extension = createExtension({ all: summary(1, 0), schinese: summary(0, 0), tchinese: summary(0, 0) });
  assert.equal((await extension.getStats('1623730')).nonChinese.categoryInfo.category, '1 User Review');
});

test('exclusion of every review does not produce a misleading score difference', async () => {
  const extension = createExtension({ all: summary(2, 1), schinese: summary(2, 1), tchinese: summary(0, 0) });
  const stats = await extension.getStats('1623730');
  assert.equal(stats.nonChinese.total, 0);
  assert.equal(stats.nonChinese.diffPct, 0);
});

function createPopup(promiseBased, fail = false, permissionOptions = {}) {
  const elements = Object.fromEntries([
    'toggle-enabled', 'toggle-schinese', 'toggle-tchinese', 'select-purchase-type', 'status-msg', 'version',
    'steam-access-status', 'grant-steam-access',
  ].map((id) => [id, { style: {}, addEventListener(event, callback) { this[event] = callback; } }]));
  let saved;
  let apiAccess = permissionOptions.granted !== false;
  let permissionRequests = 0;
  let userAction = false;
  const items = { enabled: false, excludeSimplifiedChinese: false, excludeTraditionalChinese: true, purchaseType: 'steam' };
  const promiseStorage = {
    get(...args) { return Promise.resolve({ ...args[0], ...items }); },
    set(...args) { saved = args[0]; return fail ? Promise.reject(new Error('Write failed')) : Promise.resolve(); },
  };
  const callbackStorage = {
    get(keys) { arguments[1]({ ...keys, ...items }); },
    set(values) { saved = values; arguments[1](); },
  };
  const api = {
    runtime: { getManifest() { return { version: '1.1.3' }; } },
    storage: { local: promiseBased ? promiseStorage : callbackStorage },
    permissions: {
      contains(permissions, callback) {
        if (promiseBased) return Promise.resolve(apiAccess);
        callback(apiAccess);
      },
      request(permissions, callback) {
        assert.equal(userAction, true);
        assert.deepEqual(Array.from(permissions.origins), ['https://api.steampowered.com/*']);
        permissionRequests++;
        if (permissionOptions.fail) return Promise.reject(new Error('Permission prompt failed'));
        apiAccess = permissionOptions.deny !== true;
        if (promiseBased) return Promise.resolve(apiAccess);
        callback(apiAccess);
      },
    },
  };
  const context = vm.createContext({
    ...(promiseBased ? { browser: api, chrome: { storage: { local: {} } } } : { chrome: api }),
    document: {
      getElementById(id) { return elements[id]; },
      querySelector() { return elements.version; },
      addEventListener(event, callback) { callback(); },
    },
    setTimeout() { return 1; },
    clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'popup', 'popup.js'), 'utf8'), context);
  return {
    elements,
    saved: () => saved,
    permissionRequests: () => permissionRequests,
    requestAccess() {
      userAction = true;
      try { elements['grant-steam-access'].click(); }
      finally { userAction = false; }
    },
  };
}

for (const promiseBased of [true, false]) {
  test(`popup loads and saves ${promiseBased ? 'Firefox Promise' : 'callback'} storage without relying on function arity`, async () => {
    const popup = createPopup(promiseBased);
    await Promise.resolve();
    assert.equal(popup.elements['toggle-enabled'].checked, false);
    assert.equal(popup.elements['toggle-schinese'].checked, false);
    assert.equal(popup.elements['select-purchase-type'].value, 'steam');
    assert.equal(popup.elements.version.textContent, 'v1.1.3');
    assert.equal(popup.elements['grant-steam-access'].hidden, true);
    assert.equal(popup.permissionRequests(), 0);
    popup.elements['toggle-enabled'].checked = true;
    popup.elements['toggle-enabled'].change();
    await Promise.resolve();
    assert.equal(popup.saved().enabled, true);
    assert.equal(popup.saved().purchaseType, 'steam');
    assert.equal(popup.elements['status-msg'].textContent, 'Settings saved!');
  });

  test(`popup requests missing Steam access only on a user click (${promiseBased ? 'Promise' : 'callback'})`, async () => {
    const popup = createPopup(promiseBased, false, { granted: false });
    await Promise.resolve();
    assert.equal(popup.elements['grant-steam-access'].hidden, false);
    assert.equal(popup.permissionRequests(), 0);
    popup.requestAccess();
    await Promise.resolve();
    assert.equal(popup.permissionRequests(), 1);
    assert.equal(popup.elements['grant-steam-access'].hidden, true);
    assert.equal(popup.elements['steam-access-status'].textContent, 'Steam API access granted');
    assert.equal(popup.saved(), undefined);
  });

  test(`popup allows retry after a refused permission prompt (${promiseBased ? 'Promise' : 'callback'})`, async () => {
    const popup = createPopup(promiseBased, false, { granted: false, deny: true });
    await Promise.resolve();
    popup.requestAccess();
    await Promise.resolve();
    assert.equal(popup.elements['grant-steam-access'].hidden, false);
    assert.equal(popup.elements['grant-steam-access'].disabled, false);
    assert.equal(popup.elements['steam-access-status'].textContent, 'Steam API access not granted');
  });
}

test('popup reports rejected settings writes instead of claiming success', async () => {
  const popup = createPopup(true, true);
  await Promise.resolve();
  popup.elements['toggle-enabled'].change();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(popup.elements['status-msg'].textContent, /Write failed/);
});

test('popup reports permission request errors and leaves the request button usable', async () => {
  const popup = createPopup(true, false, { granted: false, fail: true });
  await Promise.resolve();
  popup.requestAccess();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(popup.elements['steam-access-status'].textContent, /Permission prompt failed/);
  assert.equal(popup.elements['grant-steam-access'].disabled, false);
});