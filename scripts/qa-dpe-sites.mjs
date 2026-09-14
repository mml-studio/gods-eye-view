#!/usr/bin/env node
/**
 * qa-dpe-sites.mjs — what a reader reported about the DPE layer on 2026-09-14,
 * asserted as numbers against the LIVE app.
 *
 *   1. « les points bougent en même temps que je bouge la carte. » The layer
 *      drew one badge per DIAGNOSTIC, and a Paris 13e scan serves 200 of them
 *      on 14 coordinates — one coordinate carrying 42. Two hundred marks never
 *      fit the 24-probes-per-pass seating budget in `renderedSurface.js`, so
 *      dozens stayed on the scan-centre fallback height, and a mark at the
 *      wrong height under a camera that is not overhead is a HORIZONTAL error
 *      on screen that changes with the camera. Measured before the fix, nadir
 *      at 420 m on a 1400 × 900 canvas: 25.2 m of height error, 25.5 px of
 *      offset, **72.6 px of slide** across a 250 m pan. This harness recomputes
 *      all three, plus the thing that caused them — how many badges share a
 *      coordinate.
 *
 *      The oracle is `scene.sampleHeight` at each badge's own coordinate — the
 *      same call `renderedSurface.js` seats with, so this is not an independent
 *      measurement of the HEIGHT. It IS an independent measurement of the two
 *      things that were wrong: that the drawn position and the surface
 *      disagree, and by how many pixels that disagreement MOVES when the camera
 *      does.
 *
 *   2. « qu'on comprenne exactement où est situé le bien qui a ce DPE. » Each
 *      site must draw the BUILDING it is about — a washed, outlined footprint
 *      clamped to whichever surface is being drawn — and the parcel under it,
 *      and the badge must stand INSIDE its own footprint rather than on the BAN
 *      street geocode it used to. None of that may require `Bâti 3D`: this runs
 *      with the DPE layer and nothing else.
 *
 *   3. One click, one card, and the card answers for the BUILDING. Clicking the
 *      footprint and clicking the badge must open the SAME card, and that card
 *      must carry the site's range, its parcel and — always — the sentence
 *      saying how the site was placed. A building the register named and a
 *      building found under a street geocode are drawn identically and are not
 *      the same claim.
 *
 * WHY THE INSTALLED CHROME AND REAL CDP INPUT. Chrome for Testing has been
 * measured picking ZERO Cesium entities out of 23 on screen here, and Cesium's
 * `ScreenSpaceEventHandler` pairs a pointerdown with a pointerup and tracks
 * pointer identity, which a hand-dispatched MouseEvent does not satisfy. Both
 * lessons are `qa-address-layers.mjs`'s, learnt the hard way.
 *
 * Screenshots are opt-in behind `--shots`: `Page.captureScreenshot` waits for a
 * new committed frame and the render governor commits nothing when the scene is
 * settled, so an unguarded shot sits there until the protocol timeout.
 *
 * Run:  node scripts/qa-dpe-sites.mjs --url http://localhost:4173
 * Exit 0 = no hard failures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots', 'dpe-sites');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const SHOTS = args.includes('--shots');
const CHROME = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => candidate && fs.existsSync(candidate));

/** Avenue de France, Paris 13e — the address the whole address lot is built on. */
const LAT = 48.8300;
const LON = 2.3760;
/** The camera in the reader's own screenshots. */
const CAMERA_M = 420;

/** Ceiling on the residual offset a seated badge may still show, in px. */
const MAX_OFFSET_PX = 3;
/** Ceiling on how far a badge may slide across a 250 m pan, in px. */
const MAX_SLIDE_PX = 3;
/** Ceiling on how far a badge may stand off the surface under it, in metres. */
const MAX_HEIGHT_ERROR_M = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function note(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: CHROME,
  protocolTimeout: 150_000,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await newQaPage(browser);
page.on('pageerror', (error) => console.log('  [pageerror]', String(error).slice(0, 200)));

await page.goto(`${APP_URL}/?welcome=0`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.__godsEyeView?.viewer, { timeout: 180_000 });

/**
 * Put the camera where the harness asked, and check it held.
 *
 * Repeatedly, and that is not belt-and-braces: the arrival cinematic is a
 * FLIGHT and a flight rewrites the camera every frame, so a bare `setView` is
 * overwritten. The scene director can also arm another flight later, which is
 * why every measuring section below parks again first.
 */
async function parkCamera(height = CAMERA_M, pitchDeg = -90, headingDeg = 0) {
  let carto = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(({ lat, lon, h, p, hd }) => {
      const { viewer } = window.__godsEyeView;
      viewer.camera.cancelFlight?.();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: (lon * Math.PI) / 180, latitude: (lat * Math.PI) / 180, height: h,
        }),
        orientation: { heading: (hd * Math.PI) / 180, pitch: (p * Math.PI) / 180, roll: 0 },
      });
    }, { lat: LAT, lon: LON, h: height, p: pitchDeg, hd: headingDeg });
    await sleep(700);
    carto = await page.evaluate(() => {
      const position = window.__godsEyeView.viewer.camera.positionCartographic;
      return {
        height: position.height,
        lat: (position.latitude * 180) / Math.PI,
        lon: (position.longitude * 180) / Math.PI,
      };
    });
    if (Math.abs(carto.height - height) < 40
      && Math.abs(carto.lat - LAT) < 0.002
      && Math.abs(carto.lon - LON) < 0.002) break;
  }
  return carto;
}

/** A screenshot that can never end the run. See the header. */
async function shoot(name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  try {
    await page.evaluate(() => window.__godsEyeView.viewer.scene.requestRender());
    await sleep(2000);
    await page.screenshot({ path: path.join(SHOTS_DIR, name), timeout: 120_000 });
    console.log(`  ·    ${name}`);
  } catch (error) {
    console.log(`  ·    screenshot ${name} skipped — ${String(error).slice(0, 80)}`);
  }
}

/**
 * Read the layer's own stats.
 * @returns {Promise<?object>}
 */
async function layerStats() {
  return page.evaluate(() => window.__godsEyeView.dataManager.getAll()
    .find((layer) => layer.id === 'dpe-fr')?.stats || null);
}

/** Metres between two coordinates, equirectangular — good enough for a gate. */
function metresApart(a, b) {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Park, then wait until the layer says it owes no marker a reading of its own
 * AND is answering for the block this harness is about.
 *
 * NOT a sleep, and the two halves are two different lessons.
 *
 * The SEATING half: parking fires `camera.moveEnd`, the shell rescans 450 ms
 * later, `render()` re-adds every entity at ellipsoid height and the seating
 * starts over with a 250 ms settle and a doubling backoff. A harness that
 * measured on a fixed timer landed inside that window and reported 120 m of
 * height error for a layer that was seated correctly a second later.
 *
 * The CAMERA half: the scene director can arm a flight at any time, and this
 * layer follows the camera. An earlier cut of this harness parked once,
 * measured 40 s later, and read 23 addresses over a block 1 300 diagnostics
 * wide with NOTHING on screen — a correct layer, answering for somewhere else.
 * So the park is repeated on every poll and the layer's own `scanCentre` is the
 * gate, exactly as `qa-idfm-stops.mjs` learnt to do.
 *
 * @param {number} [timeoutMs]
 * @param {object} [view] Camera to hold, defaults to the nadir reference view.
 * @returns {Promise<?object>} The layer's stats at the moment it settled.
 */
async function settle(timeoutMs = 120_000, view = {}) {
  const deadline = Date.now() + timeoutMs;
  const height = view.height ?? CAMERA_M;
  let stats = null;
  await parkCamera(height, view.pitchDeg, view.headingDeg);
  while (Date.now() < deadline) {
    // ONLY when it has actually drifted. Parking is not free: each `setView`
    // fires `camera.moveEnd`, the shell rescans, `render()` re-adds every
    // entity at ellipsoid height and the tileset starts streaming again — and
    // NOTHING may be probed until it has drained. A first cut re-parked on
    // every poll and held the layer in exactly that state for the full
    // timeout, reporting 120 m of height error for a layer it was itself
    // preventing from settling.
    const now = await page.evaluate(() => {
      const position = window.__godsEyeView.viewer.camera.positionCartographic;
      return {
        height: position.height,
        lat: (position.latitude * 180) / Math.PI,
        lon: (position.longitude * 180) / Math.PI,
      };
    });
    if (Math.abs(now.height - height) > 60
      || metresApart({ lat: LAT, lon: LON }, now) > 120) {
      await parkCamera(height, view.pitchDeg, view.headingDeg);
    }
    stats = await layerStats();
    const centre = stats?.scanCentre;
    const onTarget = centre && metresApart({ lat: LAT, lon: LON }, centre) < 400;
    if (process.env.QA_DEBUG) {
      console.log(`  ·    settle ${JSON.stringify({
        loading: stats?.loading,
        refreshing: stats?.refreshing,
        seat: stats?.seatPending,
        count: stats?.count,
        onTarget,
      })}`);
    }
    if (stats && onTarget && !stats.loading && !stats.refreshing
      && stats.seatPending === false && stats.dormant === false && stats.count > 0) {
      return stats;
    }
    await sleep(1_500);
  }
  return stats;
}

await parkCamera();
await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('dpe-fr', true));
await sleep(12_000);
// The seating backoff is ~16 s of doubling retries and the tileset has to
// drain before a single probe is allowed, so this can legitimately take a
// while. It is waited FOR, never waited OUT.
const stats = await settle();
const parked = await page.evaluate(() => {
  const position = window.__godsEyeView.viewer.camera.positionCartographic;
  return {
    height: position.height,
    lat: (position.latitude * 180) / Math.PI,
    lon: (position.longitude * 180) / Math.PI,
  };
});
note(
  Math.abs(parked.height - CAMERA_M) < 40
    && Math.abs(parked.lat - LAT) < 0.002
    && Math.abs(parked.lon - LON) < 0.002,
  'the camera held the reference view long enough to measure it',
  `${Math.round(parked.height)} m, ${parked.lat.toFixed(4)}/${parked.lon.toFixed(4)}`,
);
note(
  Number.isFinite(stats?.diagnosticsServed) && stats.diagnosticsServed > 0,
  'the layer served diagnostics to measure',
  `${stats?.diagnosticsServed} of ${stats?.diagnosticsTotal}, ${stats?.sites} adresses`,
);

// ---------------------------------------------------------------------------
// 1. Seating, and the grouping that made it reachable
// ---------------------------------------------------------------------------

console.log('\n— 1. the badges are nailed to the ground —');

const drift = await page.evaluate(() => {
  const { viewer } = window.__godsEyeView;
  const { scene, camera } = viewer;
  const source = viewer.dataSources.getByName('dpe-fr')[0];
  if (!source) return { error: 'no dpe-fr data source' };
  const ellipsoid = scene.globe.ellipsoid;
  const now = viewer.clock.currentTime;
  const width = scene.canvas.clientWidth;
  const height = scene.canvas.clientHeight;
  const toWindow = (position) => {
    const point = scene.cartesianToCanvasCoordinates(position);
    return point && Number.isFinite(point.x) ? point : null;
  };
  const rows = [];
  const coords = new Map();
  let badges = 0;
  let fills = 0;
  let outlines = 0;
  let parcels = 0;
  for (const entity of source.entities.values) {
    const id = String(entity.id);
    if (entity.polygon) fills += 1;
    else if (id.startsWith('dpe:parcelle:')) parcels += 1;
    else if (id.startsWith('dpe:bati:')) outlines += 1;
    if (!entity.billboard) continue;
    badges += 1;
    const position = entity.position?.getValue(now);
    if (!position) continue;
    const carto = ellipsoid.cartesianToCartographic(position);
    const key = `${((carto.longitude * 180) / Math.PI).toFixed(6)},`
      + `${((carto.latitude * 180) / Math.PI).toFixed(6)}`;
    coords.set(key, (coords.get(key) || 0) + 1);
    const point = toWindow(position);
    if (!point || point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
    let surfaceM = null;
    try {
      surfaceM = scene.sampleHeight({
        longitude: carto.longitude, latitude: carto.latitude, height: 0,
      });
    } catch { /* mid-teardown */ }
    if (surfaceM == null) continue;
    rows.push({
      drawnM: carto.height,
      surfaceM,
      position,
      seated: position.constructor.fromRadians(carto.longitude, carto.latitude, surfaceM),
    });
  }
  const snapshot = () => rows.map((row) => {
    const drawn = toWindow(row.position);
    const seated = toWindow(row.seated);
    return (drawn && seated) ? { dx: drawn.x - seated.x, dy: drawn.y - seated.y } : null;
  });
  const before = snapshot();
  camera.moveRight(250);
  scene.render();
  const after = snapshot();
  camera.moveLeft(250);
  scene.render();
  const offsets = [];
  const slides = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (!before[i] || !after[i]) continue;
    offsets.push(Math.hypot(before[i].dx, before[i].dy));
    slides.push(Math.hypot(after[i].dx - before[i].dx, after[i].dy - before[i].dy));
  }
  const stacked = [...coords.values()].filter((n) => n > 1);
  return {
    badges,
    fills,
    outlines,
    parcels,
    onScreen: rows.length,
    distinctCoords: coords.size,
    worstStack: stacked.length ? Math.max(...stacked) : 0,
    heightErrorM: rows.length
      ? Math.max(...rows.map((row) => Math.abs(row.drawnM - row.surfaceM))) : null,
    maxOffsetPx: offsets.length ? Math.max(...offsets) : null,
    maxSlidePx: slides.length ? Math.max(...slides) : null,
  };
});

console.log(`  ·    ${JSON.stringify(drift)}`);
note(drift.onScreen > 0, 'badges are drawn in the viewport', `${drift.onScreen} on screen`);
note(
  drift.worstStack <= 1,
  'no two badges share a coordinate',
  `${drift.badges} badges on ${drift.distinctCoords} coordinates (worst pile was 42)`,
);
note(
  drift.heightErrorM !== null && drift.heightErrorM <= MAX_HEIGHT_ERROR_M,
  'every badge stands on the surface being drawn under it',
  `worst ${drift.heightErrorM?.toFixed(2)} m (was 25.2)`,
);
note(
  drift.maxOffsetPx !== null && drift.maxOffsetPx <= MAX_OFFSET_PX,
  'every badge is drawn where its building is',
  `worst ${drift.maxOffsetPx?.toFixed(1)} px (was 25.5)`,
);
note(
  drift.maxSlidePx !== null && drift.maxSlidePx <= MAX_SLIDE_PX,
  'a 250 m pan does not slide a badge across the city',
  `worst ${drift.maxSlidePx?.toFixed(1)} px (was 72.6)`,
);
note(
  Boolean(stats?.seatPending) === false,
  'the layer owes no marker a reading of its own',
  `seatPending ${stats?.seatPending}`,
);

// ---------------------------------------------------------------------------
// 2. The ground: a building, a parcel, and a badge standing on its own outline
// ---------------------------------------------------------------------------

console.log('\n— 2. the building and the parcel are drawn, with nothing else on —');

note(
  drift.fills > 0 && drift.outlines >= drift.fills,
  'each outlined site draws a washed footprint and a stroke for it',
  `${drift.fills} washes, ${drift.outlines} outline rings`,
);
note(
  Number.isFinite(stats?.sitesOutlined) && stats.sitesOutlined > 0,
  'the RNB placed buildings for these addresses',
  `${stats?.sitesOutlined} of ${stats?.sites} addresses outlined`,
);
note(
  drift.parcels > 0 && Number.isFinite(stats?.sitesParcelled) && stats.sitesParcelled > 0,
  'the cadastre placed the parcels under them',
  `${stats?.sitesParcelled} parcelles, ${drift.parcels} rings drawn`,
);
note(
  typeof stats?.coverage === 'string' && /adresses? · \d+ avec emprise bâtie/.test(stats.coverage),
  'the row says how many addresses got an outline, rather than implying all did',
  stats?.coverage ?? '(none)',
);

/**
 * Whether each badge stands INSIDE the footprint its own site drew.
 *
 * This is the check that "où est le bien" actually answers: a badge on the BAN
 * geocode sits on the street, and a street is not a building.
 */
const anchored = await page.evaluate(() => {
  const { viewer } = window.__godsEyeView;
  const source = viewer.dataSources.getByName('dpe-fr')[0];
  const now = viewer.clock.currentTime;
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const Cartographic = ellipsoid.cartesianToCartographic(
    source.entities.values.find((e) => e.position)?.position?.getValue(now),
  ).constructor;
  const inRing = (ring, lon, lat) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) === (yj > lat)) continue;
      if (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // The drawn rings, read back off the entities rather than off the payload:
  // the question is whether the badge is inside what is ON SCREEN.
  const ringsBySite = new Map();
  for (const entity of source.entities.values) {
    const id = String(entity.id);
    if (!id.startsWith('dpe:bati:') || !entity.polygon) continue;
    const key = id.slice('dpe:bati:'.length).replace(/:\d+$/, '');
    const hierarchy = entity.polygon.hierarchy?.getValue?.(now);
    const positions = hierarchy?.positions || [];
    const ring = positions.map((position) => {
      const carto = ellipsoid.cartesianToCartographic(position, new Cartographic());
      return [(carto.longitude * 180) / Math.PI, (carto.latitude * 180) / Math.PI];
    });
    if (ring.length >= 3) ringsBySite.set(key, [...(ringsBySite.get(key) || []), ring]);
  }
  let checked = 0;
  let inside = 0;
  for (const entity of source.entities.values) {
    const id = String(entity.id);
    if (!entity.billboard || id.startsWith('dpe:bati:') || id.startsWith('dpe:parcelle:')) continue;
    const key = id.slice('dpe:'.length);
    const rings = ringsBySite.get(key);
    if (!rings) continue;
    const position = entity.position?.getValue(now);
    if (!position) continue;
    const carto = ellipsoid.cartesianToCartographic(position, new Cartographic());
    const lon = (carto.longitude * 180) / Math.PI;
    const lat = (carto.latitude * 180) / Math.PI;
    checked += 1;
    if (rings.some((ring) => inRing(ring, lon, lat))) inside += 1;
  }
  return { checked, inside };
});
note(
  anchored.checked > 0 && anchored.inside === anchored.checked,
  'every badge of an outlined site stands inside its own building',
  `${anchored.inside} of ${anchored.checked}`,
);

await shoot('nadir-420.png');
await settle(60_000, { height: 320, pitchDeg: -35, headingDeg: 20 });
await shoot('oblique-320.png');
await settle(60_000);

// ---------------------------------------------------------------------------
// 3. One click, one card, and the card is about the building
// ---------------------------------------------------------------------------

console.log('\n— 3. clicking the building opens the building’s card —');

/** Aim at one entity of this layer that owns its own pixel. */
async function aim(prefix) {
  return page.evaluate((wanted) => {
    const { viewer } = window.__godsEyeView;
    const { scene } = viewer;
    const source = viewer.dataSources.getByName('dpe-fr')[0];
    const now = viewer.clock.currentTime;
    const rect = scene.canvas.getBoundingClientRect();
    const onScreen = (position) => {
      const screen = scene.cartesianToCanvasCoordinates(position);
      if (!screen || !Number.isFinite(screen.x)) return null;
      if (screen.x < 40 || screen.y < 40) return null;
      if (screen.x > scene.canvas.clientWidth - 40) return null;
      if (screen.y > scene.canvas.clientHeight - 40) return null;
      return screen;
    };
    const owns = (screen) => {
      const picked = scene.pick({ x: screen.x, y: screen.y });
      const id = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
      return typeof id === 'string' && String(id).startsWith(wanted);
    };
    for (const entity of source?.entities?.values || []) {
      if (!String(entity.id).startsWith(wanted)) continue;
      // The anchor FIRST, then the outline\'s own vertices — and the vertices
      // are tried even when the anchor exists. A footprint carries a position
      // so that it can open a card, and that position is the badge\'s too, so
      // the pick there answers `dpe:<key>` and never `dpe:bati:<key>`. An
      // earlier cut stopped at the anchor and reported the footprint as
      // unclickable while every pixel of it was pickable.
      const candidates = [];
      const position = entity.position?.getValue?.(now);
      if (position) candidates.push(position);
      const hierarchy = entity.polygon?.hierarchy?.getValue?.(now);
      for (const vertex of hierarchy?.positions || []) candidates.push(vertex);
      for (const candidate of candidates) {
        const screen = onScreen(candidate);
        if (screen && owns(screen)) {
          return { entityId: String(entity.id), x: rect.left + screen.x, y: rect.top + screen.y };
        }
      }
    }
    return null;
  }, prefix);
}

/** The card the layer currently holds open, as its lines. */
async function openCard() {
  return page.evaluate(() => {
    const module = window.__godsEyeView.dataManager.layers.get('dpe-fr')?.module;
    const selectedId = module?.getStats?.()?.selectedId ?? null;
    const painted = window.__gevWorldOverlay?.getDiagnostics?.()?.paintedBySource || {};
    const source = window.__godsEyeView.viewer.dataSources.getByName('dpe-fr')[0];
    const entity = selectedId ? source?.entities?.getById?.(selectedId) : null;
    const now = window.__godsEyeView.viewer.clock.currentTime;
    const colour = entity?.billboard?.color?.getValue?.(now) ?? entity?.billboard?.color;
    const badgeColor = colour ? `${colour.red?.toFixed?.(2)},${colour.green?.toFixed?.(2)},${colour.blue?.toFixed?.(2)}` : null;
    return {
      selectedId,
      painted: Object.keys(painted),
      badgeColor,
      // `ADDRESS_SCAN_SELECTED_COLOR` is #7fd7ff — the cyan every one of these
      // layers raises a selection to.
      emphasised: Boolean(colour && colour.blue > 0.9 && colour.green > 0.7 && colour.red < 0.6),
    };
  });
}

const target = await aim('dpe:bati:');
note(Boolean(target), 'a footprint owns a pixel to click', target?.entityId ?? 'none found');
let selected = null;
if (target) {
  await page.mouse.click(target.x, target.y);
  await sleep(700);
  const opened = await openCard();
  selected = opened.selectedId;
  // THE BADGE, not the footprint that was clicked. Three marks, one subject:
  // a clamped wash has no size to grow and no colour to take, so a layer that
  // let the click select the polygon gave the reader the right card and no
  // visible selection at all.
  const siteKey = target.entityId.slice('dpe:bati:'.length).replace(/(:\d+)+$/, '');
  note(
    selected === `dpe:${siteKey}`,
    'clicking the building selects that building’s own badge',
    `${selected ?? 'nothing'} (clicked ${target.entityId})`,
  );
  note(
    opened.painted.length > 0,
    'and the card reaches the screen, not just the layer state',
    JSON.stringify(opened.painted),
  );
  note(
    opened.emphasised === true,
    'the selected badge is visibly raised, so the reader can see what they opened',
    `badge colour ${opened.badgeColor ?? 'unreadable'}`,
  );
}

const card = await page.evaluate((entityId) => {
  const source = window.__godsEyeView.viewer.dataSources.getByName('dpe-fr')[0];
  const entity = source?.entities?.getById?.(entityId);
  const now = window.__godsEyeView.viewer.clock.currentTime;
  return {
    name: entity?.name ?? null,
    description: entity?.description?.getValue?.(now) ?? null,
  };
}, selected ?? target?.entityId ?? '');

console.log(`  ·    ${card.name} — ${card.description}`);
note(
  typeof card.description === 'string' && /^\d+ DPE, /.test(card.description),
  'the card leads with the site’s range, not with one flat’s letter',
  card.description?.split(' · ')[0] ?? '(none)',
);
note(
  typeof card.description === 'string' && /parcelle \d{5,}/.test(card.description),
  'the card names the parcel the building stands on',
);
note(
  typeof card.description === 'string'
    && /(nommé par le diagnostic|retrouvé sous le point BAN|le plus proche du point BAN|position BAN)/
      .test(card.description),
  'the card always says HOW the site was placed — a record and a deduction read differently',
);

// The parcel line under the same building is the third mark, and it must land
// on the same badge rather than opening a card of its own.
const parcelTarget = await aim('dpe:parcelle:');
if (parcelTarget) {
  await page.mouse.click(parcelTarget.x, parcelTarget.y);
  await sleep(700);
  const opened = await openCard();
  const siteKey = parcelTarget.entityId.slice('dpe:parcelle:'.length).replace(/(:\d+)+$/, '');
  note(
    opened.selectedId === `dpe:${siteKey}`,
    'clicking the parcel line opens its building’s card too',
    `${opened.selectedId ?? 'nothing'} (clicked ${parcelTarget.entityId})`,
  );
} else {
  console.log('  ·    no parcel line owns a pixel of its own at this zoom — skipped');
}

console.log(`\n${failures === 0 ? 'OK' : `${failures} FAILURE(S)`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
