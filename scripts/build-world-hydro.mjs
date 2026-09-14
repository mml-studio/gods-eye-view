#!/usr/bin/env node
/**
 * WORLD HYDRO — the 592 hydroelectric stations that used to ship as "barrages".
 *
 * Writes `src/data/local_data/world_hydro/plants.json`, the second register the
 * hydro layer draws beside France's own.
 *
 * WHY THIS PACK EXISTS
 * --------------------
 * The dams pack had two halves that were never the same object. France is a
 * direct OpenStreetMap extraction of dam STRUCTURES — walls across a river,
 * embankments beside one, 6 771 of them, 94 % of which generate nothing. The
 * rest of the world was the old Open Infrastructure Map POWER-PLANT layer,
 * filtered on a dam tag: 661 features, 592 of them generating stations.
 *
 * So one row called "Barrages" answered a click with a civil-engineering
 * structure in France and with a power station everywhere else, and the
 * divergence was loudest exactly where a reader looks first — on the top tier,
 * 592 world features against 494 French ones, because the tier promotes
 * anything hydroelectric. This pack ends that by moving the 592 to the layer
 * whose subject they have always been. The 69 that generate nothing — pumping
 * stations, reservoirs, unpowered barrages — stay in the dams pack.
 *
 * WHAT THIS IS NOT
 * ----------------
 * **It is not a world hydro register.** 592 stations is what one snapshot of
 * one OSM-derived map happened to hold; the real number is in the tens of
 * thousands. The layer says so rather than implying a coverage: France is
 * complete from ODRÉ, the world is a sample, and the two are drawn as
 * different things.
 *
 * IDEMPOTENCE
 * -----------
 * Same contract as `carryOverWorld` in build-osm-dams.mjs: THE FILE IS ITS OWN
 * SOURCE. A plain run re-reads `plants.json`, re-normalises it and writes the
 * same bytes — records sorted by OSM id, coordinates at 6 decimals, nothing
 * emitted empty. Pass a `dams.geojsonl` from before the 2026-09-14 split to
 * regenerate from scratch:
 *
 *     node scripts/build-world-hydro.mjs                    # normalise in place
 *     node scripts/build-world-hydro.mjs old-dams.geojsonl  # re-extract
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'src', 'data', 'local_data', 'world_hydro');
const OUT_JSON = path.join(OUT_DIR, 'plants.json');

/** Coordinates are rounded here and nowhere else, so two runs agree byte for byte. */
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;

/**
 * One position per station, because the layer draws one disc, one label and one
 * card off it.
 *
 * The source geometry is a power-plant OUTLINE for 645 of the 592 kept features
 * (some carry several rings), and the ring average is the honest reduction: a
 * plant's site is what was mapped, and its centre is inside it. This is NOT a
 * dam crest midpoint — the dams pack's rule — because these objects are not
 * crests.
 */
function centroid(geometry) {
  if (geometry?.type === 'Point') return geometry.coordinates;
  const rings = geometry?.type === 'Polygon'
    ? [geometry.coordinates[0]]
    : (geometry?.coordinates || []).map((polygon) => polygon[0]);
  let x = 0;
  let y = 0;
  let n = 0;
  for (const ring of rings) {
    for (const point of ring || []) { x += point[0]; y += point[1]; n += 1; }
  }
  if (!n) return null;
  return [x / n, y / n];
}

/**
 * The shipped record. An allowlist, and nothing is emitted empty: an absent
 * field is absent, so the card omits a line rather than printing a placeholder.
 *
 * `kw` rather than `outputMw` because that is the unit the hydro register
 * publishes and the layer's size channel already reads. 273 of the 592 carry
 * one; the rest are drawn as "puissance non publiée" and say so.
 */
function record({ osm, lat, lon, name, operator, kw, builtYear }) {
  const out = { osm: String(osm), lat: round(lat), lon: round(lon) };
  if (name) out.name = String(name);
  if (operator) out.operator = String(operator);
  if (Number.isFinite(kw) && kw > 0) out.kw = Math.round(kw);
  if (Number.isFinite(builtYear) && builtYear > 0) out.builtYear = Math.round(builtYear);
  return out;
}

/** Re-extract from a pre-split dams pack: `hydro === true` and no `kind`. */
function fromDamsPack(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
  const rows = [];
  for (const line of lines) {
    const feature = JSON.parse(line);
    const props = feature.properties || {};
    if (props.hydro !== true || props.kind) continue;
    const position = centroid(feature.geometry);
    if (!position) continue;
    rows.push(record({
      osm: props.osm,
      lon: position[0],
      lat: position[1],
      name: props.name,
      operator: props.operator,
      kw: Number(props.outputMw) * 1000,
      builtYear: Number(props.builtYear),
    }));
  }
  return rows;
}

/** Re-read what shipped, so a plain run is a normalisation and not a loss. */
function fromSelf() {
  if (!fs.existsSync(OUT_JSON)) {
    throw new Error(
      `${OUT_JSON} does not exist yet.\n`
      + 'Pass a dams.geojsonl from before the 2026-09-14 split to generate it:\n'
      + '  node scripts/build-world-hydro.mjs old-dams.geojsonl',
    );
  }
  const payload = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  return (payload.plants || []).map((plant) => record(plant));
}

const source = process.argv[2];
const plants = (source ? fromDamsPack(source) : fromSelf())
  .sort((a, b) => (a.osm < b.osm ? -1 : a.osm > b.osm ? 1 : 0));

const withKw = plants.filter((plant) => plant.kw != null);
const installedKw = withKw.reduce((sum, plant) => sum + plant.kw, 0);
const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'OpenStreetMap via Open Infrastructure Map (power-plant layer), ODbL 1.0',
  note: 'A SAMPLE, not a register: 592 stations is what one snapshot held. '
    + 'France is drawn from ODRÉ and is complete; this is not.',
  stats: {
    plants: plants.length,
    named: plants.filter((plant) => plant.name).length,
    withKw: withKw.length,
    installedKw,
  },
  plants,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 1)}\n`);

process.stderr.write([
  '',
  `Written           ${plants.length.toLocaleString('en-US')} stations → ${OUT_JSON}`,
  `  named           ${payload.stats.named.toLocaleString('en-US')}`,
  `  with a power    ${withKw.length.toLocaleString('en-US')} `
    + `(${(installedKw / 1e6).toFixed(1)} GW between them)`,
  '',
].join('\n'));
