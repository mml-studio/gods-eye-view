#!/usr/bin/env node
/**
 * qa-stale-build-recovery — reproduce the failure a deploy causes under an
 * open tab, and prove the app now recovers from it instead of describing it.
 *
 * THE REAL EVENT, REPRODUCED. Staging rebuilds under open tabs, so the first
 * toggle of a not-yet-loaded layer asks for a chunk name the origin no longer
 * serves. Here that is a blocked request for the IRVE module: same throw, same
 * `layerModuleUnavailable` mark, same toast path — without waiting for a
 * deploy to land mid-session.
 *
 * WHY THE TOAST IS RECORDED IN THE PAGE. The notice is a moving target: it
 * counts down and then navigates away. A harness that reads it over CDP
 * measures its own round trip as much as the app, and a `waitForFunction` here
 * has been seen to land four seconds late on a six-second countdown. So an
 * observer in the page logs every version of the notice, and Node reads the
 * log afterwards — the assertions are about what was SHOWN, not about when
 * this script managed to look.
 *
 * Three claims, one page each, because the third destroys its own page:
 *   A. the notice names the row, carries a button, and outlives the old 2 s
 *      dwell — then ANNULER stops the reload and leaves the cure in reach;
 *   B. left alone, it reloads, and the layer the reader clicked comes back ON;
 *   C. a tab that already spent its reload never reloads itself again.
 *
 * Usage: node scripts/qa-stale-build-recovery.mjs [--url http://localhost:4214]
 */
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import { STALE_BUILD_RELOAD_STORAGE_KEY } from '../src/staleBuildRecovery.js';

const argv = process.argv;
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : 'http://localhost:4214';
const LAYER_ID = 'irve-fr';
/** irve-fr's share token: what the reload has to carry back. */
const LAYER_TOKEN = '9';
/** Dev serves the module by path; a build serves it as a hashed chunk. */
const MODULE_PATTERN = '*irveFrance*';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Fail exactly the layer's own module request, and nothing else.
 *
 * `page.setRequestInterception` routes EVERY request through Node, which in
 * dev means a few thousand module fetches and a boot that never finishes.
 * CDP's own url pattern keeps the pause on the one file this harness breaks.
 *
 * `repair()` is the deploy finishing: the reloaded page asks the origin for
 * the same module and this time gets it, which is what makes the recovery a
 * recovery rather than a second failure.
 *
 * @param {import('puppeteer').Page} page Target page.
 * @returns {Promise<{count: () => number, repair: () => void}>} Controls.
 */
async function blockLayerModule(page) {
  const client = await page.createCDPSession();
  let count = 0;
  let broken = true;
  await client.send('Fetch.enable', { patterns: [{ urlPattern: MODULE_PATTERN }] });
  client.on('Fetch.requestPaused', ({ requestId }) => {
    count += 1;
    if (broken) client.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {});
    else client.send('Fetch.continueRequest', { requestId }).catch(() => {});
  });
  return { count: () => count, repair: () => { broken = false; } };
}

/** Log every version of the notice from inside the page, ahead of the click. */
const recordToast = (page) => page.evaluate(() => {
  const toast = document.getElementById('toast');
  const message = document.getElementById('toast-message');
  const action = document.getElementById('toast-action');
  window.__toastLog = [];
  const record = () => {
    const entry = {
      at: Math.round(performance.now()),
      visible: toast.classList.contains('visible'),
      hasAction: toast.classList.contains('has-action'),
      message: message.textContent,
      action: action.hidden ? '' : action.textContent,
      pointerEvents: getComputedStyle(toast).pointerEvents,
    };
    const last = window.__toastLog[window.__toastLog.length - 1];
    if (last && last.visible === entry.visible && last.message === entry.message
      && last.action === entry.action) return;
    window.__toastLog.push(entry);
  };
  new MutationObserver(record).observe(toast, {
    subtree: true, childList: true, characterData: true, attributes: true,
  });
});

const readToastLog = (page) => page.evaluate(() => window.__toastLog || []);

/**
 * Watch for a REAL reload, not a rewritten address.
 *
 * `page.waitForNavigation` also resolves on a same-document navigation, and
 * this app calls `history.replaceState` every time the share link debounces —
 * so a camera nudge reads as a reload and a passing harness starts failing on
 * whatever it was really measuring. A boot marker cannot be fooled: only a new
 * document loses it.
 *
 * @param {import('puppeteer').Page} page Marked page.
 * @param {number} timeoutMs How long to watch.
 * @returns {Promise<boolean>} True if the document was replaced.
 */
async function reloadedWithin(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const alive = await page.evaluate(() => window.__qaBootMark === 1).catch(() => false);
    if (!alive) {
      // Either the context was destroyed mid-read or the marker is gone: both
      // mean a new document. Let it finish arriving before the caller reads it.
      await page.waitForFunction(() => document.readyState !== 'loading', { timeout: 30_000 })
        .catch(() => {});
      return true;
    }
  }
  return false;
}

const markBoot = (page) => page.evaluate(() => { window.__qaBootMark = 1; });

const enableLayer = (page) => page.evaluate((layerId) => {
  // Fire and forget: the manager rejects this toggle, and the UI's own
  // `visibility-failed` handler is what we came to watch.
  window.__godsEyeView.dataManager.setEnabled(layerId, true, { origin: 'user' })
    .catch(() => {});
}, LAYER_ID);

/** A booted page with the layer's module already unreachable. */
async function openBrokenPage(browser) {
  const page = await newQaPage(browser);
  await page.setViewport({ width: 1440, height: 860 });
  // An unfocused tab reads `hidden`, and a hidden tab is deliberately refused
  // the automatic reload — so a background harness page would measure the
  // manual path and call it a regression.
  await page.bringToFront();
  const blocked = await blockLayerModule(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__godsEyeView?.dataManager, { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 4_000));
  await recordToast(page);
  await markBoot(page);
  return { page, blocked };
}

const browser = await puppeteer.launch({
  headless: 'new',
  protocolTimeout: 300_000,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});
try {
  // ── A. What the notice says, how long it stays, and what ANNULER does ──
  const { page } = await openBrokenPage(browser);
  await enableLayer(page);
  // Past the old two-second dwell, well short of the six-second countdown.
  await new Promise((r) => setTimeout(r, 3_200));
  const stillUp = await page.evaluate(() => ({
    visible: document.getElementById('toast')?.classList.contains('visible') === true,
    message: document.getElementById('toast-message')?.textContent || '',
  }));
  check('the notice outlives the old 2 s dwell', stillUp.visible, stillUp.message);

  await page.evaluate(() => document.getElementById('toast-action')?.click());
  await new Promise((r) => setTimeout(r, 6_000));
  const log = await readToastLog(page);
  const first = log.find((entry) => entry.visible && entry.message);
  check('the notice names the row that failed', /Bornes de recharge/i.test(first?.message || ''), first?.message);
  check('the notice counts down to a reload', /rechargement dans \d+ s/.test(first?.message || ''), first?.message);
  check('the notice carries its cure', first?.action === 'ANNULER', first?.action);
  check('the acting toast is clickable', first?.pointerEvents === 'auto', String(first?.pointerEvents));
  const seconds = log.map((entry) => /rechargement dans (\d+) s/.exec(entry.message)?.[1])
    .filter(Boolean);
  check('the countdown is visibly running', new Set(seconds).size >= 2, seconds.join(' → '));

  const afterCancel = await page.evaluate(() => ({
    booted: window.__qaBootMark === 1,
    visible: document.getElementById('toast')?.classList.contains('visible') === true,
    message: document.getElementById('toast-message')?.textContent || '',
    action: document.getElementById('toast-action')?.textContent || '',
  }));
  check('ANNULER stops the reload', afterCancel.booted && afterCancel.visible, afterCancel.message);
  check(
    'the cure stays in reach after ANNULER',
    afterCancel.action === 'RECHARGER' && /recharge la page/.test(afterCancel.message),
    `${afterCancel.action} · ${afterCancel.message}`,
  );
  await page.close();

  // ── B. Left alone, it reloads — and the click finishes on the new build ──
  const second = await openBrokenPage(browser);
  await enableLayer(second.page);
  // Repair only once the failure is ON SCREEN. Released any earlier and the
  // very first import succeeds, so there is no failure left to recover from.
  await second.page.waitForFunction(
    () => /rechargement dans/.test(document.getElementById('toast-message')?.textContent || ''),
    { timeout: 30_000 },
  );
  // The deploy that broke this tab is finished; the reload gets the module.
  second.blocked.repair();
  const navigated = await reloadedWithin(second.page, 30_000);
  check('the page reloads on its own', navigated, navigated ? 'reloaded' : 'no navigation');
  if (navigated) {
    await second.page.waitForFunction(() => !!window.__godsEyeView?.dataManager, { timeout: 90_000 });
    // The point of carrying it: the click the reader made is finished FOR
    // them. Assert the STATE, not the address — the app rewrites the hash
    // while the restore is still in flight, so a hash read timed against the
    // boot can catch it mid-sentence.
    const settled = await second.page.waitForFunction(
      (layerId) => window.__godsEyeView?.dataManager?.isEnabled?.(layerId) === true,
      { timeout: 60_000 },
      LAYER_ID,
    ).then(() => true).catch(() => false);
    check('the layer the reader clicked is ON after the reload', settled);
    const hash = await second.page.evaluate(() => window.location.hash);
    const tokens = (new URLSearchParams(hash.replace(/^#/, '')).get('l') || '').split('.');
    check('the reload carries the clicked layer back ON', tokens.includes(LAYER_TOKEN), `l=${tokens.join('.')}`);
  }
  await second.page.close();

  // ── C. A tab that already spent its reload never reloads itself again ──
  // The mark is pre-written rather than earned by a first reload: this is the
  // state a looping tab would be in, tested directly.
  const third = await newQaPage(browser);
  await third.setViewport({ width: 1440, height: 860 });
  await third.bringToFront();
  await blockLayerModule(third);
  await third.evaluateOnNewDocument((key) => {
    try { window.sessionStorage.setItem(key, String(Date.now())); } catch { /* no storage */ }
  }, STALE_BUILD_RELOAD_STORAGE_KEY);
  await third.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await third.waitForFunction(() => !!window.__godsEyeView?.dataManager, { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 4_000));
  const mark = await third.evaluate((key) => window.sessionStorage.getItem(key), STALE_BUILD_RELOAD_STORAGE_KEY);
  check('the spent mark is in place before the click', Boolean(mark), String(mark));
  await markBoot(third);
  await enableLayer(third);
  const looped = await reloadedWithin(third, 15_000);
  check('a spent tab never reloads itself again', !looped, looped ? 'looped' : 'held');
  if (!looped) {
    const manual = await third.evaluate(() => ({
      message: document.getElementById('toast-message')?.textContent || '',
      action: document.getElementById('toast-action')?.textContent || '',
      visible: document.getElementById('toast')?.classList.contains('visible') === true,
    }));
    check(
      'the spent tab still offers the button',
      manual.visible && manual.action === 'RECHARGER' && /recharge la page/.test(manual.message),
      `${manual.action} · ${manual.message}`,
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
