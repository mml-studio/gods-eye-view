#!/usr/bin/env node
/**
 * Browser proof for the zoom card (`src/zoomPrompt.js`).
 *
 * The unit tests prove the model and the markup against a stub DOM. What only a
 * real browser can answer:
 *
 *   i.   a layer switched on above its ceiling puts a card on screen, in the
 *        middle of the viewport, saying what the layer itself says
 *   ii.  the card does NOT eat clicks at the centre of a globe people drag —
 *        `elementFromPoint` at its own centre must reach the canvas
 *   iii. « Zoomer ici » actually moves the camera under the ceiling, through
 *        the layer's own `ensureViewGate()` — the three solvers this repo has
 *        carried since September with nothing calling them
 *   iv.  and the card takes itself off the screen once the camera obeyed
 *
 * No proxy interception: none of the four claims needs a loaded grid. The gate
 * verdict at 1 800 km is reached without a single request, which is the point
 * of the gate.
 *
 * Run: node scripts/qa-zoom-prompt.mjs --url http://localhost:4173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'zoom-prompt');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Above `POWER_GRID_MAX_ALTITUDE_M` (120 km) by an order of magnitude. */
const FRANCE = { lon: 2.4, lat: 46.6, height: 1_800_000 };

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Teleport the camera, then raise the stop the layers listen for. */
async function setView(page, lon, lat, height) {
  await page.evaluate((lo, la, h) => {
    const gev = window.__godsEyeView;
    const ellipsoid = gev.viewer.scene.globe?.ellipsoid || gev.viewer.scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({ longitude: lo * d2r, latitude: la * d2r, height: h }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    gev.viewer.scene.requestRender?.();
    gev.viewer.camera.moveEnd.raiseEvent();
  }, lon, lat, height);
}

/** What the card is, read off the live DOM rather than off a screenshot. */
async function cardState(page) {
  return page.evaluate(() => {
    const node = document.getElementById('zoom-prompt');
    if (!node) return { present: false };
    const styles = window.getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const visible = !node.hidden && styles.display !== 'none' && box.width > 0 && box.height > 0;
    const centreX = Math.round(box.left + box.width / 2);
    const centreY = Math.round(box.top + box.height / 2);
    return {
      present: true,
      visible,
      title: node.querySelector('.zoom-prompt-title')?.textContent || '',
      message: node.querySelector('.zoom-prompt-message')?.textContent || '',
      layer: node.querySelector('.zoom-prompt-layer')?.textContent || '',
      hasFly: Boolean(node.querySelector('.zoom-prompt-fly')),
      pointerEvents: styles.pointerEvents,
      // What a reader dragging the globe through the middle of the card would
      // actually grab. A transparent rectangle that answers here instead of the
      // canvas is a worse bug than the one the card fixes.
      hitAtCentre: document.elementFromPoint(centreX, centreY)?.tagName || null,
      centreRatio: window.innerHeight > 0 ? (box.top + box.height / 2) / window.innerHeight : null,
    };
  });
}

const cameraHeight = (page) => page.evaluate(
  () => window.__godsEyeView.viewer.camera.positionCartographic.height,
);

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    executablePath: chrome,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await newQaPage(browser);
  try {
    console.log(`[qa] booting ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000 },
    );
    await sleep(2000);

    // ── i. an orbital camera with the grid on puts a card on screen ────────
    console.log('[qa] i. a layer above its ceiling says so in the middle of the screen');
    const before = await cardState(page);
    check('nothing is announced while no gated layer is on', !before.visible, JSON.stringify(before));

    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('power-grid', true));
    await setView(page, FRANCE.lon, FRANCE.lat, FRANCE.height);
    await page.waitForFunction(
      () => {
        const node = document.getElementById('zoom-prompt');
        return Boolean(node) && !node.hidden && node.getBoundingClientRect().height > 0;
      },
      { timeout: 20000 },
    ).catch(() => {});
    const card = await cardState(page);
    check('the card is on screen', card.visible, JSON.stringify(card).slice(0, 200));
    check('it names the layer that is waiting', /électrique/i.test(card.layer), card.layer);
    check('it prints the layer own sentence, with the ceiling in it',
      /zoome/i.test(card.message) && /120/.test(card.message), card.message);
    check('it offers the flight, because this layer can solve its own view',
      card.hasFly === true);
    check('it sits above centre rather than over the subject',
      card.centreRatio !== null && card.centreRatio > 0.3 && card.centreRatio < 0.5,
      String(card.centreRatio));

    // ── ii. it does not eat the globe ─────────────────────────────────────
    console.log('[qa] ii. the middle of the globe is still draggable through it');
    check('the card itself takes no pointer events', card.pointerEvents === 'none', card.pointerEvents);
    check('and a press at its own centre reaches the canvas',
      card.hitAtCentre === 'CANVAS', String(card.hitAtCentre));

    await page.screenshot({ path: path.join(SHOTS_DIR, '01-card.png') }).catch(() => {});

    // ── iii/iv. the button flies, and the card withdraws ──────────────────
    console.log('[qa] iii. « Zoomer ici » reaches the layer own view gate');
    const heightBefore = await cameraHeight(page);
    await page.evaluate(() => document.querySelector('#zoom-prompt .zoom-prompt-fly')?.click());
    await page.waitForFunction(
      () => window.__godsEyeView.viewer.camera.positionCartographic.height < 120_000,
      { timeout: 30000 },
    ).catch(() => {});
    const heightAfter = await cameraHeight(page);
    check('the camera descended under the ceiling',
      heightAfter < 120_000, `${Math.round(heightBefore)} m → ${Math.round(heightAfter)} m`);
    check('and it zoomed in rather than out', heightAfter < heightBefore);

    console.log('[qa] iv. the card takes itself off once the camera obeyed');
    await page.waitForFunction(
      () => document.getElementById('zoom-prompt')?.hidden === true,
      { timeout: 20000 },
    ).catch(() => {});
    const settled = await cardState(page);
    check('the card is gone', !settled.visible, JSON.stringify(settled).slice(0, 200));
    await page.screenshot({ path: path.join(SHOTS_DIR, '02-after-flight.png') }).catch(() => {});

    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('power-grid', false));
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n[qa] ${failures} check(s) failed` : '\n[qa] all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('[qa] harness error:', error);
  process.exit(1);
});
