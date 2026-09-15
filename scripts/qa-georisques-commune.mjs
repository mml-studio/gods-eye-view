#!/usr/bin/env node
/**
 * Browser proof for what the Géorisques layer puts ON SCREEN.
 *
 * The complaint this answers, from a live session over the Trocadéro on
 * 2026-09-14: the layer drew one line-art triangle and nothing else, while the
 * eight hazards the same scan had already resolved were rendered by no surface
 * of the globe. Unit tests could not catch either half — the first is a
 * property of a raster, the second of the manager's key, and both live behind
 * a real scan.
 *
 * WHAT IS PROVEN HERE, and why each one needs a browser:
 *
 *   i.   the commune OUTLINE reaches the scene as clamped polylines, closed,
 *        classified onto whichever surface is drawn
 *   ii.  the outline is the commune the scan ran on — 75113, not the 75056 the
 *        report echoes for every Paris arrondissement
 *   iii. the commune is WASHED inside that outline, one ground-classified
 *        polygon per ring, in one colour, onto the same surface — and the wash
 *        is anonymous, so it can carry no card
 *   iv.  the installations are drawn with the filled plate rather than the
 *        line-art triangle, and are big enough ON SCREEN at the distance the
 *        complaint was written from, which is not what `billboard.width` says
 *   v.   the KEY carries every hazard verdict, including the two that differ
 *        between the commune and the address, and carries them with no colour
 *        swatch because nothing on the globe is painted for them
 *   vi.  above the 12 km ceiling all of it is cleared, key included
 *
 * THE SIZE CHECK IS THE ONE THAT WAS MISSING. The previous version asserted
 * `width >= 18` on the authored size and passed while the mark measured 15.9
 * px on screen: Cesium interpolates a `NearFarScalar` against SQUARED distance
 * and then raises `t` to the power 0.2, so the far value owns nearly the whole
 * band. This harness restates that curve — the source of truth is
 * `focusDeemphasis.nearFarScalarValueAtDistance`, which it cannot import into
 * a page — and asserts the product, at the altitude the layer is read at.
 *
 * NOT PROVEN, and deliberately: that any of it PAINTS. No Cesium entity ever
 * rasterises under headless Chrome in this repo — measured down to a control
 * polygon — so this asserts the model and the DOM, never a pixel.
 *
 * Run: node scripts/qa-georisques-commune.mjs --url http://localhost:4173
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { newQaPage } from './lib/qa-first-run.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');

/** Avenue de France, Paris 13e — the reference address of the storyboard. */
const ADDRESS = { lon: 2.3760, lat: 48.8300 };
const CLOSE_VIEW = { ...ADDRESS, height: 900 };
/**
 * The altitude of the complaint, to the metre, read off its own HUD: "ALT:
 * 5859M" over Bassussarry. Asserted as a NUMBER rather than flown to, because
 * the scan there is a different commune with different upstream weather and
 * the question is about the ramp, which is the same everywhere.
 */
const REPORTED_ALTITUDE_M = 5859;
/** The floor a plate has to clear to be FOUND, not merely read. See below. */
const FINDABLE_PX = 22;
/** Well above `ADDRESS_SCAN_MAX_ALTITUDE_M`, where the layer must go dormant. */
const REGION_VIEW = { ...ADDRESS, height: 60_000 };

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Cesium's own `NearFarScalar` curve: SQUARED distance, then `pow(t, 0.2)`.
 *
 * Restated here rather than imported because it has to be evaluated against
 * what the browser reports for a live billboard, and `czm_nearFarScalar` is a
 * shader. `src/data/focusDeemphasis.js` holds the version the app uses and
 * `georisques.markPixelsAtDistance` is the layer's own wrapper; if this drifts
 * from either, the drift is the bug.
 *
 * @param {{near:number,nearValue:number,far:number,farValue:number}} ramp
 * @param {number} distanceM
 * @returns {number} The multiplier applied to the authored size.
 */
function rampScale(ramp, distanceM) {
  const nearSq = ramp.near * ramp.near;
  const farSq = ramp.far * ramp.far;
  const raw = ((distanceM * distanceM) - nearSq) / (farSq - nearSq);
  return ramp.nearValue
    + (ramp.farValue - ramp.nearValue) * Math.pow(Math.min(Math.max(raw, 0), 1), 0.2);
}

const chrome = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
].filter(Boolean).find((candidate) => { try { return fs.existsSync(candidate); } catch { return false; } });

let failures = 0;
let skipped = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
/**
 * A check that cannot run because an UPSTREAM is down, not because the app is.
 *
 * Measured 2026-09-14: `resultats_rapport_risque` refused every connection for
 * a whole session while `installations_classees` and `radon` kept answering.
 * A harness that reports that as six failures teaches its reader to ignore it,
 * and the one time the failures are real they are ignored too. So the reason
 * is named, the run still passes, and what WAS provable is still asserted.
 */
const skip = (label, why) => {
  skipped += 1;
  console.log(`  skip ${label} — ${why}`);
};

/** Draw frames by hand: the governor runs in `requestRenderMode`. */
async function pump(page, frames = 6, gapMs = 90) {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(() => { try { window.__godsEyeView?.viewer?.scene?.render(); } catch { /* stalled */ } });
    await sleep(gapMs);
  }
}

async function flyTo(page, view) {
  await page.evaluate((lon, lat, height) => {
    const gev = window.__godsEyeView;
    const scene = gev.viewer.scene;
    const ellipsoid = scene.globe?.ellipsoid || scene.ellipsoid;
    const d2r = Math.PI / 180;
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: lon * d2r, latitude: lat * d2r, height,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    scene.requestRender?.();
  }, view.lon, view.lat, view.height);
  await pump(page, 4, 80);
}

/** What the layer actually put in the scene, by kind. */
async function readDraw(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const entry = gev.dataManager.layers.get('georisques');
    const stats = entry?.module?.getStats?.() || {};
    const source = gev.viewer.dataSources._dataSources
      .find((candidate) => candidate.name === 'georisques' || candidate.entities?.id === 'georisques');
    const entities = source ? source.entities.values : [];
    const kinds = {};
    const plates = [];
    const washes = [];
    let closedRings = 0;
    let outlineRings = 0;
    for (const entity of entities) {
      const kind = entity.properties?.kind?.getValue?.() ?? 'none';
      kinds[kind] = (kinds[kind] || 0) + 1;
      if (entity.polygon) {
        const hierarchy = entity.polygon.hierarchy?.getValue?.(gev.viewer.clock.currentTime);
        const ring = hierarchy?.positions || [];
        const first = ring[0];
        const last = ring[ring.length - 1];
        washes.push({
          id: String(entity.id ?? ''),
          // `toCssColorString` on the resolved material colour: what is
          // compared is the COLOUR, and three parts of one commune must not
          // differ (batched ground primitives repaint each other by bounding
          // rectangle when they do — `qa-cadastre-highlight.mjs`).
          css: entity.polygon.material?.color?.getValue?.(gev.viewer.clock.currentTime)
            ?.toCssColorString?.() ?? null,
          classification: entity.polygon.classificationType?.getValue?.() ?? null,
          vertices: ring.length,
          // A duplicated closing vertex is a degenerate edge on a shape that
          // is closed by definition.
          repeatsFirstVertex: Boolean(first && last && first.x === last.x && first.y === last.y),
          // The decoration contract: nothing a reader could have meant.
          hasCard: Boolean(entity.name || entity.description || entity.properties),
          height: entity.polygon.height?.getValue?.() ?? null,
          perPositionHeight: entity.polygon.perPositionHeight?.getValue?.() ?? null,
        });
        continue;
      }
      if (entity.polyline) {
        outlineRings += 1;
        const positions = entity.polyline.positions?.getValue?.(gev.viewer.clock.currentTime) || [];
        const first = positions[0];
        const last = positions[positions.length - 1];
        if (first && last && first.x === last.x && first.y === last.y && first.z === last.z) closedRings += 1;
      }
      if (entity.billboard) {
        const ramp = entity.billboard.scaleByDistance?.getValue?.() ?? null;
        plates.push({
          width: entity.billboard.width?.getValue?.() ?? null,
          image: String(entity.billboard.image?.getValue?.() ?? ''),
          hasRamp: Boolean(ramp),
          // THE RAMP ITSELF, not just its presence: the size a reader sees is
          // the product of the two, and the previous version of this harness
          // asserted only the authored half.
          ramp: ramp ? {
            near: ramp.near, nearValue: ramp.nearValue, far: ramp.far, farValue: ramp.farValue,
          } : null,
        });
      }
    }
    return {
      stats,
      kinds,
      plates,
      washes,
      outlineRings,
      closedRings,
      entities: entities.length,
      // What the app itself thinks the wash needs disclosed, read from the
      // manager's own row controls rather than from the module.
      surfaceFill: entry?.module?.getRowControls?.()?.surfaceFill ?? null,
      // The key, read from the DOM the reader actually sees.
      legend: [...document.querySelectorAll('.map-legend-entry')].map((node) => ({
        label: node.querySelector('.map-legend-label')?.textContent ?? '',
        blurb: node.querySelector('.map-legend-blurb')?.textContent ?? '',
        unmapped: node.querySelector('.map-legend-swatch')?.classList.contains('is-unmapped') ?? null,
        background: node.querySelector('.map-legend-swatch')?.style.background ?? '',
      })),
      legendNote: document.querySelector('.map-legend-source')?.textContent ?? '',
      legendFootnote: document.querySelector('.map-legend-note')?.textContent ?? '',
    };
  });
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: chrome,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  protocolTimeout: 180_000,
});
// `newQaPage` takes the browser and its own options — it does NOT navigate,
// so the `goto` below is on us. It installs the first-run suppression before
// any page script runs, which is why every harness here opens its page through
// it rather than through puppeteer's own constructor.
const page = await newQaPage(browser, { photoreal: true });
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.log(`  [page error] ${error.message}`));

try {
  console.log(`\n— booting ${APP_URL} —`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  let booted = false;
  for (let attempt = 0; attempt < 120 && !booted; attempt += 1) {
    booted = await page.evaluate(() => Boolean(window.__godsEyeView?.dataManager));
    if (!booted) await sleep(500);
  }
  check(booted, 'the app booted and published its data manager');
  if (!booted) throw new Error('no boot');

  await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('georisques', true));
  await flyTo(page, CLOSE_VIEW);

  console.log('\n— the scan over avenue de France —');
  // WAIT FOR THE SCAN TO BE THIS ONE, not merely for a scan to exist. The
  // layer is switched on before the camera moves, so its first answer is about
  // the boot view — the 16e, measured — and a harness that stops at the first
  // non-empty draw asserts against the wrong commune while everything works.
  let draw = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    draw = await readDraw(page);
    // Keyed on the OUTLINE's own commune, which is fetched from the
    // BAN-resolved code and survives the report being down — unlike
    // `scanCommuneInsee`, which is read off the report itself.
    const outlined = draw.legend.some((entry) => entry.label.startsWith('Commune de Paris 13e'));
    if (outlined && draw.entities > 0) break;
    await pump(page, 2, 120);
  }

  check(draw.outlineRings > 0, 'the commune outline reached the scene',
    `${draw.outlineRings} ring(s), ${draw.entities} entities`);
  check(draw.outlineRings === draw.closedRings,
    'every outline ring is closed, so no gash crosses the commune',
    `${draw.closedRings}/${draw.outlineRings}`);
  check(draw.kinds['commune-outline-label'] === 1,
    'the commune is named on the ground, once');
  check(draw.stats.communeOutlined === true, 'the layer reports the outline it drew');
  // Both codes are read off the REPORT, so this is only provable when the
  // report answered — the outline itself is fetched from the BAN-resolved code
  // and is drawn either way, which the previous check already proved.
  if (draw.stats.available?.report === false) {
    skip('the outline is the ARRONDISSEMENT the scan ran on',
      'resultats_rapport_risque did not answer, and both codes are read off it');
  } else {
    check(draw.stats.scanCommuneInsee === '75113',
      'the outline is the ARRONDISSEMENT the scan ran on, not Paris-whole',
      `scan=${draw.stats.scanCommuneInsee} report=${draw.stats.communeInsee}`);
  }

  console.log('\n— the highlight inside the outline —');
  check(draw.washes.length === draw.outlineRings,
    'every outlined ring is also washed, so the commune reads as an area',
    `${draw.washes.length} wash(es) / ${draw.outlineRings} ring(s)`);
  // ONE COLOUR. Honest cartography first — no composite score exists to ramp a
  // commune by — and separately what keeps a batched GroundPrimitive correct:
  // instances of one batch with different colours repaint each other along
  // bounding-RECTANGLE edges. `qa-cadastre-highlight.mjs` measured that.
  const washColours = new Set(draw.washes.map((wash) => wash.css));
  check(draw.washes.length > 0 && washColours.size === 1,
    'the wash carries one colour for every part of the commune',
    [...washColours].join(' | '));
  // The same surface as the stroke over it. A fill classified onto TERRAIN
  // while the photorealistic mesh is the only surface drawn paints NOTHING,
  // and nothing on screen tells that apart from a layer that fetched nothing.
  const strokeClassification = await page.evaluate(() => {
    const gev = window.__godsEyeView;
    const source = gev.viewer.dataSources._dataSources
      .find((candidate) => candidate.name === 'georisques');
    const stroke = (source?.entities?.values || []).find((entity) => entity.polyline);
    return stroke?.polyline?.classificationType?.getValue?.() ?? null;
  });
  check(draw.washes.length > 0
    && draw.washes.every((wash) => wash.classification === strokeClassification),
    'and classifies onto the same surface the stroke does',
    `wash=${draw.washes[0]?.classification} stroke=${strokeClassification}`);
  // Ground classification at all: a `height` or a `perPositionHeight` makes
  // Cesium build an ordinary primitive that then ignores `classificationType`
  // in silence — the trap `franceEnergy.js` records for its prisms.
  check(draw.washes.every((wash) => wash.height === null && wash.perPositionHeight === null),
    'the wash is ground geometry, not a polygon floating at a height');
  check(draw.washes.every((wash) => !wash.repeatsFirstVertex),
    'no ring hands Cesium a duplicated closing vertex');
  // THE DECORATION CONTRACT. A ground fill IS pickable, so a wash with a card
  // would answer for every click inside the commune — and a wash without one,
  // unless it is declared, would make those clicks answer for NOBODY. Both
  // halves are checked: no card here, and `isWorldPick` true over there.
  check(draw.washes.every((wash) => !wash.hasCard),
    'the wash carries no card, so it is decoration rather than an object');
  const washPick = await page.evaluate((id) => {
    const gev = window.__godsEyeView;
    const probe = gev.pickRegistry?.isWorldPick;
    if (typeof probe !== 'function') return null;
    return probe({ id: { id } });
  }, draw.washes[0]?.id || '');
  if (washPick === null) {
    // The app does not publish the registry, and adding it to the debug
    // surface would put `pickRegistry` in the entry chunk for a probe. The
    // proof lives in `georisques.test.mjs` instead, which imports the real
    // module and therefore exercises the real module-scope registration.
    skip('a click on the wash resolves as the MAP',
      'pickRegistry is not on the debug surface — proven in georisques.test.mjs');
  } else {
    check(washPick === true,
      'a click on the wash resolves as the MAP, so sibling ground clicks survive',
      draw.washes[0]?.id || '(none)');
  }
  check(draw.surfaceFill === true,
    'the layer declares its surface fill, which is what mounts the drape note',
    `surfaceFill=${draw.surfaceFill}`);

  console.log('\n— the installations —');
  check(draw.plates.length > 0, 'installations are drawn', `${draw.plates.length}`);
  const svgs = draw.plates.map((plate) => Buffer.from(plate.image.split(',')[1] || '', 'base64').toString('utf8'));
  check(svgs.every((svg) => svg.includes('mask="url(#m)"')),
    'every mark is the filled plate, not the line-art triangle');
  check(svgs.every((svg) => !svg.includes('fill="none"')),
    'no mark is drawn as an unfilled stroke');
  check(draw.plates.every((plate) => plate.hasRamp), 'every mark rides the distance ramp');

  // ── THE SIZE, WHERE IT IS ACTUALLY READ ──────────────────────────────────
  //
  // The check this harness was missing. `width >= 18` passed on every build
  // while the mark measured 15.9 px on screen, because the authored size is
  // the value at the NEAR end of a curve that reaches its far value almost at
  // once. What follows is the product of the two, at three distances: the
  // camera's own, the altitude the complaint was written from, and the
  // dormancy ceiling where the mark is smallest and the layer still draws.
  const onScreen = (distanceM) => draw.plates
    .map((plate) => (plate.ramp ? plate.width * rampScale(plate.ramp, distanceM) : plate.width));
  const here = onScreen(CLOSE_VIEW.height);
  check(Math.min(...here) >= 24,
    'every mark clears 24 px on screen from the scan altitude',
    `min=${Math.min(...here).toFixed(1)} px at ${CLOSE_VIEW.height} m`);
  const reported = onScreen(REPORTED_ALTITUDE_M);
  check(Math.min(...reported) >= FINDABLE_PX,
    `every mark clears ${FINDABLE_PX} px at the altitude the complaint came from`,
    `min=${Math.min(...reported).toFixed(1)} px at ${REPORTED_ALTITUDE_M} m `
    + '(15.9 px before)');
  const ceiling = onScreen(12_000);
  check(Math.min(...ceiling) >= 20,
    'and stays findable at the 12 km ceiling instead of bottoming out early',
    `min=${Math.min(...ceiling).toFixed(1)} px`);
  // The authored floor still holds on its own, so a future change cannot buy
  // the numbers above by flattening the ramp to nothing.
  check(draw.plates.every((plate) => plate.width >= 28),
    'no mark is authored below the size a plate can be found at',
    `min=${Math.min(...draw.plates.map((plate) => plate.width))}`);

  console.log('\n— the key, which is where the verdicts live —');
  const labels = draw.legend.map((entry) => entry.label);
  check(labels.some((label) => label.startsWith('Commune de Paris 13e')),
    'the key names the commune the highlight belongs to', labels[0]);
  const communeEntry = draw.legend.find((entry) => entry.label.startsWith('Commune de'));
  // WHAT THE TINT IS, AND WHAT IT IS NOT. A filled commune sitting three lines
  // above "inondation — concerné" is one glance from being read as the water,
  // and the key is the only place that can head that off.
  check(/périmètre administratif/.test(communeEntry?.blurb || '')
    && /pas l’étendue d’un risque/.test(communeEntry?.blurb || ''),
    'and says the highlight is a jurisdiction rather than a hazard extent',
    communeEntry?.blurb || '(none)');

  // THE HAZARD CHECKS NEED THE HAZARD REGISTER, and it is the one upstream of
  // the four that goes down on its own. When it does, what must still hold is
  // the opposite assertion: that the key SAYS so rather than showing a clean
  // address. That one is not skipped.
  const reportAnswered = draw.stats.available?.report !== false;
  if (!reportAnswered) {
    check(labels.includes('Aléas indisponibles'),
      'a silent hazard register is named, not shown as a clear address');
    skip('the hazards are keyed', 'resultats_rapport_risque did not answer this run');
    skip('a verdict that differs between commune and address says so', 'same outage');
  } else {
    const hazardLines = draw.legend.filter((entry) => entry.label.includes('—') && !entry.label.startsWith('Limite'));
    check(hazardLines.length >= 6, 'the hazards are keyed', `${hazardLines.length} lines`);
    check(hazardLines.every((entry) => entry.unmapped === true),
      'no hazard carries a colour swatch, because none of them is painted');
    check(labels.some((label) => label.includes('diffère de la commune')),
      'a verdict that differs between commune and address says so in the key');
    const varying = draw.legend.find((entry) => entry.label.includes('diffère de la commune'));
    check(/commune : .+ · à cette adresse : /.test(varying?.blurb || ''),
      'and prints BOTH verdicts under it', varying?.blurb || '(none)');
    check(!labels.includes('Aléas indisponibles'),
      'and no outage line, because there was no outage');
  }
  check(/Géorisques — BRGM \/ MTE/.test(draw.legendNote),
    'the key carries its provenance', draw.legendNote);
  check(/pas de géométrie/.test(draw.legendFootnote),
    'and says out loud that the hazards are not drawn', draw.legendFootnote);

  console.log('\n— above the ceiling —');
  await flyTo(page, REGION_VIEW);
  let dormant = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    dormant = await readDraw(page);
    if (dormant.stats.dormant === true) break;
    await pump(page, 2, 120);
  }
  check(dormant.stats.dormant === true, 'the layer goes dormant above 12 km');
  check(dormant.outlineRings === 0 && dormant.plates.length === 0
    && dormant.washes.length === 0,
    'and clears its draw rather than leaving a block-scale answer at region scale',
    `${dormant.entities} entities`);
  check(dormant.surfaceFill !== true,
    'the drape note goes with the wash that justified it');
  check(dormant.legend.length === 0,
    'the key goes with it — a key for a draw that is gone is a lie');
} finally {
  await browser.close();
}

// NOT "an upstream was down" any more: the skips now have two causes — a
// silent hazard register, and a probe the app does not expose — and a tail
// that names the wrong one sends its reader to look at the wrong thing.
const tail = skipped ? ` (${skipped} skipped — reason printed above)` : '';
console.log(`\n${failures === 0 ? `PASS${tail}` : `FAIL — ${failures} check(s)${tail}`}\n`);
process.exit(failures === 0 ? 0 : 1);
