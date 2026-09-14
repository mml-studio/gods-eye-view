#!/usr/bin/env node
/**
 * QA the dams layer in a real browser.
 *
 *   local-dams  OpenStreetMap, bundled pack (6,189 ouvrages, 5,529 in France)
 *
 * The regression this harness exists to catch is the one the layer shipped with
 * for a year: a France fork where "Barrages" switched on and drew 44 objects.
 * So the checks are, in order:
 *
 *   1. FRANCE IS ACTUALLY THERE. A count alone cannot say that — the old pack
 *      also reported a healthy 704 — so the French features are counted inside
 *      a metropolitan box, and Serre-Ponçon is looked up by name.
 *   2. THE PROPERTIES SURVIVE the pack → GeoJSON → Cesium round trip, because
 *      the card is written from them and a dropped field reads as a blank line.
 *   3. THE MARKS ARE READABLE: the dot follows the measured span, the key names
 *      the structures and rings what was never measured — and prints no metre
 *      band, because the card already gives the metre count — and a floor
 *      removes markers from the globe and gives them back.
 *
 * Usage: node scripts/qa-dams.mjs [--url http://localhost:4174] [--headful]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { firstRunLauncherSuppressed, newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const getOpt = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = getOpt('--url', 'http://localhost:4174').replace(/\/$/, '');
const HEADFUL = args.includes('--headful');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = path.join(ROOT, 'qa-shots', 'dams');

/** Rebuilt 2026-09-01. Floors, not equalities — see the pack's README. */
const MIN_FEATURES = 5800;
const MIN_FRENCH = 5000;

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Poll until `check` returns truthy or the budget runs out. */
async function waitFor(page, check, { timeoutMs = 60_000, everyMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(check);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const executablePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage', '--window-size=1440,900',
    ],
  });

  const consoleErrors = [];
  try {
    const page = await newQaPage(browser);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));

    console.log(`\nOpening ${APP_URL} …`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    const ready = await waitFor(page, () => !!window.__godsEyeView?.dataManager);
    record('app boots and exposes the data manager', !!ready);
    if (!ready) return;

    const registered = await page.evaluate(() => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const entry = all.find((layer) => layer.id === 'local-dams') || null;
      return entry ? { name: entry.name, source: entry.source ?? null } : null;
    });
    record('local-dams is registered', !!registered,
      registered ? `name="${registered.name}" source=${registered.source}` : 'absent');
    record('the row is named in French and credits OpenStreetMap',
      registered?.name === 'Barrages & digues' && registered?.source === 'OpenStreetMap',
      `name=${registered?.name} source=${registered?.source}`);

    await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled('local-dams', true, { origin: 'user' });
      await dm.waitForLayerSettled?.('local-dams');
    });

    const stats = await waitFor(page, () => {
      const all = window.__godsEyeView.dataManager.getAll() || [];
      const entry = all.find((layer) => layer.id === 'local-dams');
      const s = entry?.stats ?? null;
      return s && (Number(s.count) > 0 || s.error) ? s : null;
    }, { timeoutMs: 90_000 });

    if (!stats) {
      record('the layer settles within 90 s', false, 'timed out');
      return;
    }

    record('layer reports no error', !stats.error, stats.error || 'clean');
    record('the pack loads every bundled feature', stats.count >= MIN_FEATURES,
      `count=${stats.count} (floor ${MIN_FEATURES})`);

    // ── What actually reached the globe ──────────────────────────────────
    const sample = await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const source = viewer?.dataSources?.getByName?.('Barrages & digues')?.[0];
      const entities = source?.entities?.values ?? [];
      if (!entities.length) return null;
      const props = entities.map((entity) => entity.__localProperties ?? {});
      const byName = new Map(props.filter((p) => p.name).map((p) => [p.name, p]));

      // Positions, so "is France populated?" is answered by geography rather
      // than by a field that could be right while the pack is empty. The layer
      // parks each feature's base Cartographic (radians) on the entity when it
      // builds the stem; the app does not expose Cesium on `window`, so that
      // stash is the only way to read a coordinate back from here.
      const DEG = 180 / Math.PI;
      let french = 0;
      let located = 0;
      for (const entity of entities) {
        const carto = entity.__localBaseCarto;
        if (!carto) continue;
        located += 1;
        const lon = carto.longitude * DEG;
        const lat = carto.latitude * DEG;
        if (lon >= -5.5 && lon <= 9.8 && lat >= 41.2 && lat <= 51.5) french += 1;
      }

      return {
        entities: entities.length,
        french,
        located,
        named: props.filter((p) => p.name).length,
        hydro: props.filter((p) => p.hydro === true).length,
        withSpan: props.filter((p) => Number.isFinite(p.spanM)).length,
        // The allowlist is the privacy transform; a raw tag bag reaching the
        // browser means the build stopped projecting.
        withRawTags: props.filter((p) => p.tags).length,
        serrePoncon: byName.get('Barrage de Serre-Ponçon') || null,
        roselend: byName.get('Barrage de Roselend') || null,
        vouglans: byName.get('Barrage de Vouglans') || null,
      };
    });

    record('dams render as globe entities',
      !!sample && sample.entities >= MIN_FEATURES,
      sample ? `${sample.entities} entities` : 'no data source named "Barrages & digues"');
    if (!sample) return;

    // (1) The regression this layer shipped with: France was 44 features.
    record('France is actually populated', sample.french >= MIN_FRENCH,
      `${sample.french} inside the metropolitan box (floor ${MIN_FRENCH})`);
    // The world tail, and the floor is 100 rather than 400 since 2026-09-14:
    // 592 of the 661 carried-over features were generating stations, and they
    // moved to `world_hydro`. What is left outside the metropolitan box is the
    // 69 unclassified structures PLUS the outre-mer — Réunion, Guyane, les
    // Antilles, Mayotte, la Nouvelle-Calédonie and la Polynésie are France and
    // are in this pack, they are simply not inside a metropolitan bounding box.
    record('the world tail and the outre-mer survived the split',
      sample.located - sample.french > 100,
      `${sample.located - sample.french} of ${sample.located} outside the metropolitan box`);

    // (2) Properties survive the round trip, and nothing else rides along.
    const serre = sample.serrePoncon;
    record('Serre-Ponçon keeps its measurements through the round trip',
      serre?.heightM === 124 && serre?.operator === 'EDF' && serre?.hydro === true,
      serre ? `heightM=${serre.heightM} operator=${serre.operator} hydro=${serre.hydro}` : 'absent');
    record('Roselend keeps its material family',
      sample.roselend?.material === 'béton' && sample.roselend?.heightM === 150,
      sample.roselend ? `${sample.roselend.heightM} m ${sample.roselend.material}` : 'absent');
    record('the allowlist held — no raw OSM tag bag reached the browser',
      sample.withRawTags === 0, `${sample.withRawTags} features carrying tags`);
    record('most features carry a measured span',
      sample.withSpan / sample.entities > 0.6,
      `${sample.withSpan} of ${sample.entities}`);

    // ── Importance is visible, and the one chip row works ────────────────
    const tiers = await page.evaluate(() => {
      const dm = window.__godsEyeView.dataManager;
      const module = dm.layers?.get?.('local-dams')?.module;
      const controls = module?.getRowControls?.() || null;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Barrages & digues')?.[0]?.entities?.values ?? [];
      const now = window.__godsEyeView?.viewer?.clock?.currentTime;
      const sizes = new Map();
      // The size channel left the importance floor and went to the MEASURED
      // SPAN, so the probe now reads both: `sizes` keyed by display tier tells
      // us the size no longer follows importance, `spans` keyed by length band
      // tells us what it follows instead.
      const spans = new Map();
      const band = (m) => (!Number.isFinite(m) || m <= 0 ? 'unmeasured'
        : m >= 1000 ? '1000+' : m >= 300 ? '300-999' : m >= 100 ? '100-299' : '25-99');
      for (const entity of entities) {
        const p = entity.__localProperties ?? {};
        const tier = (p.heightM >= 15 || p.hydro === true
          || (p.name && p.spanM >= 300)) ? 'major' : p.name ? 'named' : 'minor';
        const size = Number(entity.point?.pixelSize?.getValue?.(now) ?? entity.point?.pixelSize);
        if (!sizes.has(tier)) sizes.set(tier, new Set());
        sizes.get(tier).add(size);
        const key = band(Number(p.spanM));
        if (!spans.has(key)) spans.set(key, new Set());
        spans.get(key).add(size);
      }
      return {
        chips: (controls?.chips || []).map((chip) => chip.id),
        legend: (controls?.legend || []).map((item) => ({ label: item.label, count: item.count })),
        sizes: [...sizes.entries()].map(([tier, set]) => [tier, [...set]]),
        spans: [...spans.entries()].map(([key, set]) => [key, [...set]]),
      };
    });

    // ONE chip group, three words, and nothing else. The importance row —
    // TOUS / NOMMÉS / GRANDS — was removed on 2026-09-14: it named a size and
    // filtered on something else (only 65 of GRANDS' 494 French features carry
    // a height at all), and the thinning it did is the zoom's job now.
    record('the row offers the kind filter and NOTHING else',
      ['kinds:all', 'kinds:dams', 'kinds:dykes'].every((id) => tiers.chips.includes(id))
      && tiers.chips.length === 3,
      tiers.chips.join(','));
    record('the importance chips are gone, not merely relabelled',
      !tiers.chips.some((id) => ['all', 'named', 'major'].includes(id)),
      tiers.chips.join(','));
    // The key names the STRUCTURES — the one thing colour says and no shape
    // does — plus the hollow ring for a span nobody published, which must not
    // read as the bottom of a ladder (A1). The four metre bands it used to
    // print are gone: the card gives `1 247 m de long` beside the mark, so a
    // bracket in the key was a coarser second copy of the same number, and the
    // key was 9 rows and 192 words for a 216 px panel.
    record('the key names the kinds and rings what was never measured',
      tiers.legend.length >= 2 && tiers.legend.length <= 5
      && tiers.legend.some((item) => /barrage/i.test(item.label))
      && tiers.legend.some((item) => /longueur inconnue/i.test(item.label)),
      tiers.legend.map((item) => `${item.label}=${item.count}`).join(' · '));
    record('and prints no metre band a reader would have to decode',
      tiers.legend.every((item) => !/\d/.test(item.label)),
      tiers.legend.map((item) => item.label).join(' · '));

    // THE CHANTIER'S REVERSAL, and it is what this pair of checks now pins.
    // The dot size used to encode the DISPLAY FLOOR — a qualitative importance
    // bucket — which is the one thing Bertin's size channel must not carry. It
    // now encodes the measured SPAN. So a display floor no longer has one
    // size (its dams have many lengths), and a length band does.
    const sizeOf = new Map(tiers.sizes.map(([tier, set]) => [tier, set]));
    record('the size no longer follows the importance floor',
      [...sizeOf.values()].some((set) => set.length > 1),
      tiers.sizes.map(([tier, set]) => `${tier}=[${set}]`).join(' '));
    const spanOf = new Map(tiers.spans.map(([key, set]) => [key, set]));
    record('it follows the measured span — one size per length band',
      [...spanOf.entries()].every(([, set]) => set.length === 1),
      tiers.spans.map(([key, set]) => `${key}=[${set}]`).join(' '));
    const ladder = ['1000+', '300-999', '100-299', '25-99'].map((key) => spanOf.get(key)?.[0]);
    record('and the ladder descends with length',
      ladder.filter(Number.isFinite).every((size, index, kept) => index === 0 || size < kept[index - 1]),
      ladder.join(' > '));

    // ── Fly to the dams BEFORE measuring what a chip draws ───────────────
    // `entity.show` is written by the pre-render walk, which is also where
    // horizon occlusion lands: measured over the default view, every count
    // below would be zero whatever a chip does. `window.Cesium` is not
    // exposed by the app, so the camera is moved through the viewer's own API.
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      if (!viewer) return;
      viewer.camera.cancelFlight?.();
      // The Alps between Grenoble and the Maurienne: Grand'Maison, Monteynard,
      // Le Chevril and the storage lakes above them in one frame.
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: 6.2 * Math.PI / 180,
          latitude: 45.3 * Math.PI / 180,
          height: 220_000,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      viewer.scene.requestRender();
      viewer.scene.render();
    });
    await sleep(4000);

    const filtered = await page.evaluate(async () => {
      const dm = window.__godsEyeView.dataManager;
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Barrages & digues')?.[0]?.entities?.values ?? [];
      const shown = () => entities.filter((entity) => entity.show !== false).length;
      const module = dm.layers?.get?.('local-dams')?.module;
      const legendCounts = () => (module?.getRowControls?.()?.legend || [])
        .map((item) => `${item.label}=${item.count}`);
      viewer.scene.render();
      const before = shown();
      const legendBefore = legendCounts();
      dm.setLayerParams('local-dams', { kinds: 'dykes' }, { origin: 'user' });
      viewer.scene.render();
      const afterChip = shown();
      const legendAtChip = legendCounts();
      const statsAtChip = dm.getAll().find((l) => l.id === 'local-dams')?.stats?.count;
      dm.setLayerParams('local-dams', { kinds: 'all' }, { origin: 'user' });
      viewer.scene.render();
      return { before, afterChip, restored: shown(), legendBefore, legendAtChip, statsAtChip };
    });

    record('the DIGUES chip hides every structure that is not one',
      filtered.before > 0 && filtered.afterChip > 0 && filtered.afterChip < filtered.before,
      `${filtered.before} markers drawn in view → ${filtered.afterChip} under DIGUES`);
    const keyTotal = (rows) => rows.reduce((sum, entry) => sum + Number(entry.split('=').pop() || 0), 0);
    record('the legend follows the chip instead of claiming the whole pack',
      keyTotal(filtered.legendAtChip) < keyTotal(filtered.legendBefore),
      `${keyTotal(filtered.legendBefore)} → ${keyTotal(filtered.legendAtChip)} · ${filtered.legendAtChip.join(' · ')}`);
    record('a chip hides markers WITHOUT losing them',
      filtered.statsAtChip === stats.count,
      `stats.count=${filtered.statsAtChip} while ${filtered.afterChip} were drawn`);
    record('clearing the chip gives every marker back',
      filtered.restored === filtered.before,
      `${filtered.afterChip} → ${filtered.restored} (was ${filtered.before})`);

    // ── The bottom rung waits for the zoom, and that is what replaced the
    // chip. At 220 km the nameless ouvrages are drawn; from 3 000 km they are
    // not, because `minor` carries `markerMaxDistance: 900_000`.
    const byAltitude = await page.evaluate(async () => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      const entities = viewer?.dataSources?.getByName?.('Barrages & digues')?.[0]?.entities?.values ?? [];
      const shownMinor = () => entities.filter((entity) => {
        if (entity.show === false) return false;
        const p = entity.__localProperties ?? {};
        return !p.name && !(p.heightM >= 15) && p.hydro !== true;
      }).length;
      const fly = (height) => new Promise((resolve) => {
        viewer.camera.cancelFlight?.();
        viewer.camera.setView({
          destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
            longitude: 6.2 * Math.PI / 180,
            latitude: 45.3 * Math.PI / 180,
            height,
          }),
          orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        });
        viewer.scene.requestRender();
        viewer.scene.render();
        setTimeout(resolve, 2500);
      });
      await fly(220_000);
      const near = shownMinor();
      await fly(3_000_000);
      const far = shownMinor();
      await fly(220_000);
      return { near, far, back: shownMinor() };
    });
    record('the nameless ouvrages thin out with altitude, no chip pressed',
      byAltitude.near > 0 && byAltitude.far < byAltitude.near,
      `${byAltitude.near} at 220 km → ${byAltitude.far} at 3 000 km`);
    record('and come back when the camera does',
      byAltitude.back > byAltitude.far,
      `${byAltitude.far} → ${byAltitude.back}`);

    // ── Shot ──────────────────────────────────────────────────────────────
    record('first-run launcher stays suppressed for the shot',
      await firstRunLauncherSuppressed(page));
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.styleManager?.viewer;
      viewer?.scene?.requestRender?.();
      viewer?.scene?.render?.();
    });
    await sleep(4000);
    await page.screenshot({ path: path.join(SHOT_DIR, 'dams-alpes.png') });
    console.log(`\n  shot → ${path.join(SHOT_DIR, 'dams-alpes.png')}`);

    const relevantErrors = consoleErrors.filter((text) => /dam|barrage/i.test(text));
    record('no console errors mentioning the layer', relevantErrors.length === 0,
      relevantErrors[0] || 'clean');
  } finally {
    await browser.close();
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const entry of failed) console.log(`  - ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
