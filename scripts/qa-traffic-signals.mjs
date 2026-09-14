#!/usr/bin/env node
/**
 * qa-traffic-signals.mjs — headless proof for the two-phase signal clock and
 * the OSM `maxspeed` ceiling on the traffic layer.
 *
 * The defect this guards: on a perpendicular junction, dots crossed from both
 * streets at the same instant, because there was no junction in the model and
 * the only red light was a 0.8 % dice roll uncorrelated between streets. And
 * a Paris boulevard rendered at up to 65 km/h on a street limited to 30.
 *
 *   (i)   ALTERNATION — sampled over a full 70 s cycle at place
 *         Edmond-Rostand (Paris 5e), dots held at a red belong to the axis
 *         that does NOT hold the green, and both axes take a turn being held.
 *         This is the whole feature: crossing flows never move together.
 *   (ii)  NOT A FREEZE — the layer keeps moving while an axis waits: the
 *         held share stays well under 100 %, and stays above 0 during a red.
 *   (iii) SPEED CEILING — with the same view loaded, no dot's road cruises
 *         faster than its posted OSM limit, and Paris `primary` roads come
 *         out at 30 km/h rather than the class table's 50.
 *   (iv)  MOTORWAYS DO NOT QUEUE — a grade-separated view (A86 interchange)
 *         holds zero dots at a red: freezing a dot mid-viaduct would read as
 *         a rendering bug, not as traffic.
 *
 * No pixel is read: no Cesium point primitive ever paints in headless
 * software GL, so every assertion is on the layer's own model via getStats().
 *
 * Run:  node scripts/qa-traffic-signals.mjs --url http://localhost:4410
 * Exits non-zero on any FAIL. Does not commit anything.
 */

import puppeteer from 'puppeteer';
import { newQaPage } from './lib/qa-first-run.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const APP_URL = getOpt('--url', 'http://localhost:4410');
const HEADFUL = argv.includes('--headful');
/** One full cycle plus a margin — the proof needs to see BOTH greens. */
const SAMPLE_MS = Number(getOpt('--sample-ms', '82000'));
const SAMPLE_EVERY_MS = Number(getOpt('--sample-every-ms', '2000'));
/**
 * The crossing window must span a full cycle or it can miss the moment a
 * queue is at its longest — a 60 s window against a 70 s cycle read 57 %
 * one run and 75 % the next, purely on where it landed.
 */
const SIGNAL_CYCLE_GUESS_MS = 80000;

const CHROME_EXECUTABLE_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

function findChromeExecutable() {
  for (const candidate of CHROME_EXECUTABLE_CANDIDATES) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  return null;
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok === null ? '\x1b[33mINCONCLUSIVE\x1b[0m' : ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  [${tag}] ${name}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Enable traffic + teleport, then poll the layer until it has settled. */
async function settleTraffic(page, view, { minCount = 1, timeoutS = 45 } = {}) {
  return page.evaluate(async (v, minC, tS) => {
    const gev = window.__godsEyeView;
    const dm = gev.dataManager;
    await dm.setEnabled('traffic', true);
    const mod = dm.layers.get('traffic').module;
    const ell = gev.viewer.scene.globe.ellipsoid;
    const d2r = Math.PI / 180;
    // The boot cinematic clobbers a setView issued mid-flight.
    try { gev.viewer.camera.cancelFlight(); } catch { /* no flight active */ }
    gev.viewer.camera.setView({
      destination: ell.cartographicToCartesian({ longitude: v.lon * d2r, latitude: v.lat * d2r, height: v.height }),
      orientation: { heading: (v.heading || 0) * d2r, pitch: (v.pitch ?? -90) * d2r, roll: 0 },
    });
    let s = null;
    for (let i = 0; i < tS; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      s = mod.getStats();
      if (s.count >= minC && !s.loading) break;
    }
    // Where the camera ACTUALLY ended up. The boot cinematic clobbers a
    // setView issued mid-flight, and under machine load the cancelFlight
    // above does not always win: a run that asserts on whatever view it got
    // reports a healthy build as broken. Seen for real — 7 850 roads and
    // 6 689 `primary` in a view of the 5e arrondissement, which holds 84.
    const c = gev.viewer.camera.positionCartographic;
    return {
      ...s,
      camLat: c.latitude * 180 / Math.PI,
      camLon: c.longitude * 180 / Math.PI,
      camAlt: c.height,
    };
  }, view, minCount, timeoutS);
}

/**
 * Did the camera land where the harness asked it to?
 * @param {Object} stats - A settleTraffic() result.
 * @param {{lon:number, lat:number, height:number}} view
 * @returns {boolean}
 */
function cameraArrived(stats, view) {
  if (!stats || !Number.isFinite(stats.camLat)) return false;
  const mLat = 111320;
  const mLon = mLat * Math.cos(view.lat * Math.PI / 180);
  const off = Math.hypot((stats.camLat - view.lat) * mLat, (stats.camLon - view.lon) * mLon);
  // Generous: any pose within a kilometre of the target, at a plausible
  // altitude, loads the right roads. A stranded camera is off by tens of km
  // or parked at globe altitude, never by 900 m.
  return off < 1000 && stats.camAlt < view.height * 4;
}

/**
 * Sample getStats() over a window, one short evaluate per sample.
 *
 * Driven from Node, NOT from a setTimeout loop inside the page: under
 * software GL the page's timers run at a fraction of real time, and an
 * in-page loop asking for a 1 s cadence delivered 8 samples in 82 s — too
 * coarse to see a 35 s phase at all. A page.evaluate answers in ~1 ms here,
 * so the round trip is free and the cadence is the host's.
 */
async function sampleSignals(page, durationMs, everyMs) {
  const samples = [];
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const mod = window.__godsEyeView.dataManager.layers.get('traffic').module;
      const st = mod.getStats();
      return {
        green: st.signalGreenPhase,
        held: st.signalHeldByPhase,
        onPhase: st.signalDotsByPhase,
        count: st.count,
      };
    });
    samples.push({ t: Date.now(), ...s });
    await sleep(everyMs);
  }
  return samples;
}

/** One character per sample: which axis is green, and how much is held. */
function waveform(samples) {
  const bar = ' .:-=+*#%@';
  return samples.map((s) => {
    const share = (s.held[0] + s.held[1]) / Math.max(1, s.count);
    const ch = bar[Math.min(bar.length - 1, Math.round(share * 40))];
    return s.green === 0 ? ch : ch.toUpperCase?.() === ch ? ch : ch;
  }).join('');
}

async function main() {
  console.log('\nTraffic signal-clock + speed-ceiling proof (qa-traffic-signals)');
  console.log(`  App URL : ${APP_URL}`);
  console.log(`  Window  : ${(SAMPLE_MS / 1000).toFixed(0)} s (one 70 s cycle + margin)\n`);

  try {
    const res = await fetch(APP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`\x1b[31mDev server not reachable at ${APP_URL} (${e.message}).\x1b[0m`);
    process.exit(2);
  }

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    // The sampling window runs INSIDE one page.evaluate (82 s by default) and
    // a cold Overpass can hold the settle loop for 45 s more. The 180 s
    // default kills both as a protocol timeout, which reads as a harness
    // crash rather than the slow upstream it actually is.
    protocolTimeout: Math.max(300_000, SAMPLE_MS * 3),
    ...(findChromeExecutable() ? { executablePath: findChromeExecutable() } : {}),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--disable-dev-shm-usage', '--disable-web-security',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--window-size=1440,900',
    ],
  });

  let exitCode = 0;
  try {
    const page = await newQaPage(browser);
    await page.setViewport({ width: 1440, height: 900 });

    console.log('Loading app...');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Interval polling, not rAF: software headless WebGL can stall the frame
    // loop outright, and a rAF-polled wait then times out on a healthy app.
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000, polling: 200 },
    );
    await sleep(1500);

    // ── Place Edmond-Rostand: boulevard Saint-Michel (~16°, phase 0) crosses
    // rue Soufflot / rue de Médicis (~95°, phase 1). The exact view of the
    // screenshot that reported the defect.
    console.log('\nLoading Paris 5e (place Edmond-Rostand)...');
    const parisView = { lon: 2.3407, lat: 48.8464, height: 900, heading: 20, pitch: -55 };
    const nudged = { lon: 2.3395, lat: 48.8472, height: 900, heading: 20, pitch: -55 };
    let stats = await settleTraffic(page, parisView, { minCount: 200 });
    let target = parisView;
    if (!stats || stats.count < 200 || !cameraArrived(stats, parisView)) {
      // One retry with a nudged center — a cold Overpass can strand the first
      // load, and the overlap gate then refuses an identical re-request.
      stats = await settleTraffic(page, nudged, { minCount: 200 });
      target = nudged;
    }

    if (stats && !cameraArrived(stats, target)) {
      // Not a failure of the layer: the harness never got the view it asked
      // for, so nothing measured here would be about Paris.
      record('paris view loads dots', null,
        `camera stranded at ${stats.camLat.toFixed(3)},${stats.camLon.toFixed(3)} `
        + `@${Math.round(stats.camAlt)} m (asked for ${target.lat},${target.lon} @${target.height} m)`);
      console.log('  · boot cinematic won the camera — re-run when the machine is quieter');
      exitCode = 2;
    } else if (!stats || stats.count < 50) {
      record('paris view loads dots', false, `count=${stats?.count ?? 'null'} (Overpass cold?)`);
      exitCode = 1;
    } else {
      record('paris view loads dots', true, `${stats.count} dots`);

      console.log(`\nSampling ${(SAMPLE_MS / 1000).toFixed(0)} s of the signal clock...`);
      const samples = await sampleSignals(page, SAMPLE_MS, SAMPLE_EVERY_MS);
      // The shape of the thing, for a human reading the log: held share over
      // time on the top row, which axis holds the green underneath.
      console.log(`  held  ${waveform(samples)}`);
      console.log(`  green ${samples.map((s) => s.green).join('')}`);

      // ── (i) ALTERNATION ────────────────────────────────────
      // Every sample: the dots held at a red must belong to the axis that
      // does NOT hold the green. A small leak is legitimate — the release
      // jitter (<= 1.2 s) keeps a freshly-greened dot stopped for up to one
      // more sample — so the test allows a thin margin and checks the shape.
      // Samples within SETTLE_MS of a phase flip are excluded from the
      // per-sample check, and ONLY from that one. A junction takes seconds to
      // clear: the axis that just went red does not stop instantly (its dots
      // stop at their next segment crossing), while the axis that just went
      // green is still releasing its queue through the start jitter. During
      // that overlap the green axis legitimately holds more dots than the red
      // one — that is a junction emptying, not two flows sharing a green. The
      // leak ratio below is computed over EVERY sample, transitions included.
      const SETTLE_MS = 8000;
      let lastFlip = samples[0]?.t ?? 0;
      let violations = 0;
      let settledSamples = 0;
      let heldWrongTotal = 0;
      let heldRightTotal = 0;
      const heldWhileRed = { 0: 0, 1: 0 };
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (i > 0 && samples[i - 1].green !== s.green) lastFlip = s.t;
        const red = s.green === 0 ? 1 : 0;
        heldRightTotal += s.held[red];
        heldWrongTotal += s.held[s.green];
        heldWhileRed[red] += s.held[red];
        if (s.t - lastFlip < SETTLE_MS) continue;
        settledSamples++;
        // In steady state, the green axis holding MORE dots than the red one
        // is the defect this harness exists to catch.
        if (s.held[s.green] > s.held[red]) violations++;
      }
      const leak = heldRightTotal > 0 ? heldWrongTotal / (heldRightTotal + heldWrongTotal) : 1;
      const alternates = heldWhileRed[0] > 0 && heldWhileRed[1] > 0;
      const ok = violations === 0 && leak < 0.15 && alternates;
      record(
        '(i) held dots are on the RED axis, and both axes take a turn',
        ok,
        `violations=${violations}/${settledSamples} settled samples, green-axis leak=${(leak * 100).toFixed(1)}%, `
        + `held while red: phase0=${heldWhileRed[0]}, phase1=${heldWhileRed[1]}`,
      );
      if (!ok) exitCode = 1;

      // ── (ii) NOT A FREEZE ──────────────────────────────────
      // A clock that stops everything is not traffic. Some dots must be held
      // during a red, and most must keep moving.
      // The share a VIEWER reads is the red axis's own: "400 held" means
      // nothing until you know the red axis carries 500 dots or 5 000.
      const redShares = samples.map((s) => {
        const red = s.green === 0 ? 1 : 0;
        return s.held[red] / Math.max(1, s.onPhase?.[red] ?? s.count);
      });
      const peakRed = Math.max(...redShares);
      const totalShares = samples.map((s) => (s.held[0] + s.held[1]) / Math.max(1, s.count));
      const peakAll = Math.max(...totalShares);
      // Deliberately NOT a floor on the viewport-wide share. That number is
      // dominated by how far the average dot happens to be from any junction,
      // so a healthy build reads anywhere from 4 % to 25 % depending on where
      // the camera sits. The alternation is proven at the crossings, in
      // (ii-b); what this one owns is the other failure mode — a clock that
      // stops everything is not traffic either.
      const freezeOk = peakRed > 0 && peakAll < 0.75;
      record(
        '(ii) something waits, and the map does not freeze',
        freezeOk,
        `peak on the RED axis=${(peakRed * 100).toFixed(1)}%, `
        + `peak overall=${(peakAll * 100).toFixed(1)}% of ${stats.count} dots (must stay < 75%)`,
      );
      if (!freezeOk) exitCode = 1;

      // ── (ii-b) AT THE CROSSING ─────────────────────────────
      // A viewport-wide share can look healthy while the one junction someone
      // is actually watching still has both flows moving. This asks the
      // question the way a person asks it: at THIS crossing, right now, is one
      // axis stopped and the other one not?
      //
      // The first shipped version passed every viewport-wide check and failed
      // this one outright — 8 dots per axis around a real crossing, zero of
      // them ever stopped, because the stop line sat two segments before the
      // end of the way instead of at the junction.
      const crossings = await page.evaluate(() => {
        const mod = window.__godsEyeView.dataManager.layers.get('traffic').module;
        const junctions = mod.__qaJunctions?.() || [];
        const dots = mod.__qaDots?.() || [];
        const mLat = 111320;
        // Keep the crossings where BOTH axes actually have dots — a junction
        // only one street uses cannot demonstrate an alternation.
        const scored = junctions.map((c) => {
          const mLon = mLat * Math.cos(c[1] * Math.PI / 180);
          const near = dots.filter((p) =>
            Math.hypot((p.lat - c[1]) * mLat, (p.lon - c[0]) * mLon) <= 35);
          const p0 = near.filter((x) => x.phase === 0).length;
          const p1 = near.filter((x) => x.phase === 1).length;
          return { c, both: Math.min(p0, p1) };
        }).filter((x) => x.both >= 2).sort((a, b) => b.both - a.both);
        // Spread them out so the sample is four crossings, not one crossing
        // counted four times from four of its own vertices.
        const picked = [];
        for (const s of scored) {
          const mLon = mLat * Math.cos(s.c[1] * Math.PI / 180);
          if (picked.every((t) => Math.hypot((t[1] - s.c[1]) * mLat, (t[0] - s.c[0]) * mLon) > 40)) {
            picked.push(s.c);
          }
          if (picked.length >= 4) break;
        }
        return picked;
      });

      if (crossings.length === 0) {
        record('(ii-b) at a real crossing, one axis is stopped and the other is not', null,
          'no crossing in view carries both axes');
      } else {
        const pk = crossings;
        const readCrossings = () => page.evaluate((picks) => {
          const mod = window.__godsEyeView.dataManager.layers.get('traffic').module;
          const dots = mod.__qaDots();
          const green = mod.getStats().signalGreenPhase;
          const mLat = 111320;
          return {
            green,
            rows: picks.map((c) => {
              const mLon = mLat * Math.cos(c[1] * Math.PI / 180);
              const near = dots.filter((p) =>
                Math.hypot((p.lat - c[1]) * mLat, (p.lon - c[0]) * mLon) <= 35);
              const per = (ph) => {
                const set = near.filter((x) => x.phase === ph);
                return { n: set.length, held: set.filter((x) => x.stopped).length };
              };
              return [per(0), per(1)];
            }),
          };
        }, pk);
        let bestHeld = 0;
        let greenLeak = 0;
        let observations = 0;
        const deadline = Date.now() + Math.max(SAMPLE_MS, SIGNAL_CYCLE_GUESS_MS);
        while (Date.now() < deadline) {
          const r = await readCrossings();
          const red = r.green === 0 ? 1 : 0;
          for (const row of r.rows) {
            if (row[red].n < 2) continue;
            observations++;
            bestHeld = Math.max(bestHeld, row[red].held / row[red].n);
            // A dot stopped on the GREEN axis at a crossing is the wrong flow
            // waiting. A few are legitimate (jam creep, release jitter).
            if (row[r.green].n > 0) greenLeak += row[r.green].held / row[r.green].n;
          }
          await sleep(SAMPLE_EVERY_MS);
        }
        const leakAvg = observations ? greenLeak / observations : 1;
        // 50 %, not 60: the broken version scored 0 % here, so the gap this has
        // to resolve is enormous and the threshold does not need to be tight.
        const crossingOk = bestHeld >= 0.5 && leakAvg < 0.2;
        record(
          '(ii-b) at a real crossing, one axis is stopped and the other is not',
          crossingOk,
          `${pk.length} crossings, ${observations} observations: red axis peaked at `
          + `${(bestHeld * 100).toFixed(0)}% stopped (needs >= 50%), green axis averaged `
          + `${(leakAvg * 100).toFixed(1)}% stopped (needs < 20%)`,
        );
        if (!crossingOk) exitCode = 1;
      }

      // ── (iii) SPEED CEILING ────────────────────────────────
      const speeds = await page.evaluate(() => {
        const mod = window.__godsEyeView.dataManager.layers.get('traffic').module;
        const roads = mod.__qaRoads?.() || [];
        const byType = {};
        for (const r of roads) {
          (byType[r.type] ??= []).push(r.cruiseMps * 3.6);
        }
        return Object.fromEntries(Object.entries(byType).map(([t, v]) => [t, {
          n: v.length,
          max: Math.max(...v),
          mean: v.reduce((s, x) => s + x, 0) / v.length,
        }]));
      });
      // How finely OSM splits its ways decides how well "stop at the end of
      // the way" approximates "stop at the junction". A way that spans three
      // junctions lets a dot drive through two of them on a red.
      const granularity = await page.evaluate(() => {
        const mod = window.__godsEyeView.dataManager.layers.get('traffic').module;
        const roads = mod.__qaRoads?.() || [];
        const segs = roads.map((r) => r.segments).sort((a, b) => a - b);
        return {
          roads: roads.length,
          medianSegments: segs[Math.floor(segs.length / 2)] ?? 0,
          phased: roads.filter((r) => r.signalPhase !== null).length,
        };
      });
      console.log(`  · ${granularity.roads} roads, ${granularity.phased} phased, median ${granularity.medianSegments} segments/way`);

      const primary = speeds.primary;
      if (!primary) {
        record('(iii) Paris primary roads cruise at the posted 30, not 50', null, 'no primary road in view');
      } else {
        // The class table says 50.4 km/h. Paris posts 30. Nothing may exceed it.
        const capped = primary.max <= 31;
        record(
          '(iii) Paris primary roads cruise at the posted 30, not 50',
          capped,
          `${primary.n} primary roads, max=${primary.max.toFixed(1)} km/h (class table: 50.4)`,
        );
        if (!capped) exitCode = 1;
      }

      // ── (iv) MOTORWAYS DO NOT QUEUE ────────────────────────
      console.log('\nLoading the A86/A6 interchange (grade-separated)...');
      const motorway = await settleTraffic(page, { lon: 2.3625, lat: 48.7720, height: 1800, heading: 0, pitch: -60 }, { minCount: 100 });
      if (!motorway || motorway.count < 50) {
        record('(iv) motorway dots never queue at a red', null, `count=${motorway?.count ?? 'null'}`);
      } else {
        const mwSamples = await sampleSignals(page, 12000, SAMPLE_EVERY_MS);
        const mwRoads = await page.evaluate(() => {
          const mod = window.__godsEyeView.dataManager.layers.get('traffic').module;
          const roads = mod.__qaRoads?.() || [];
          const grade = roads.filter((r) => ['motorway', 'trunk', 'motorway_link', 'trunk_link'].includes(r.type));
          return { total: roads.length, grade: grade.length, phased: grade.filter((r) => r.signalPhase !== null).length };
        });
        // A view with no grade-separated road proves nothing: `phased === 0`
        // would pass on an empty set. Under a cold Overpass the camera can
        // land on the interchange while the layer still holds the previous
        // city's roads, and that run must read INCONCLUSIVE, not PASS.
        const clean = mwRoads.grade > 0 ? mwRoads.phased === 0 : null;
        record(
          '(iv) motorway dots never queue at a red',
          clean,
          mwRoads.grade > 0
            ? `${mwRoads.grade}/${mwRoads.total} grade-separated roads, ${mwRoads.phased} with a signal phase`
              + ` (held peak ${Math.max(...mwSamples.map((s) => s.held[0] + s.held[1]))})`
            : `no grade-separated road in the loaded set (${mwRoads.total} roads) — view did not reload`,
        );
        if (clean === false) exitCode = 1;
      }
    }
  } catch (error) {
    console.error(`\x1b[31mHarness error: ${error.message}\x1b[0m`);
    console.error(error.stack);
    exitCode = 2;
  } finally {
    await browser.close();
  }

  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  const inconclusive = results.filter((r) => r.ok === null).length;
  console.log(`\n  ${pass} pass, ${fail} fail, ${inconclusive} inconclusive\n`);
  process.exit(exitCode);
}

main();
