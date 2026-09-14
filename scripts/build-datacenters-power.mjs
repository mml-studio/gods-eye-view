#!/usr/bin/env node
/*
 * BUILD — fold DCWatch's French power figures into the OSM datacenter pack.
 *
 * Reads two vendored snapshots and rewrites one:
 *
 *   in   src/data/local_data/datacenters/datacenters.osm.geojsonl   (OSM, ODbL)
 *   in   src/data/local_data/datacenters/dcwatch/export_summary.csv (DCWatch, ODbL)
 *   out  src/data/local_data/datacenters/datacenters.geojsonl
 *
 * The OSM half is kept verbatim and never reordered — the world outside France
 * passes through untouched — so that re-running this build is idempotent and a
 * future OSM re-extraction only has to replace `datacenters.osm.geojsonl`.
 *
 * Two things happen to the French half:
 *
 *   1. A feature that DCWatch can be pinned to gains a `dcwatch` property block
 *      carrying the power in MW, the two floor areas and the year. The OSM tags
 *      are not edited: a value nobody surveyed in OSM must not come back out of
 *      this pack looking like an OSM tag.
 *
 *   2. A DCWatch site IN OPERATION that no OSM feature could be pinned to is
 *      appended as a Point feature. These are datacenters OSM has never mapped,
 *      and they are the majority — leaving them out would mean shipping a power
 *      figure that five sites in six simply do not have.
 *
 * PROJECTS ARE EXCLUDED. DCWatch tracks 76 French sites at `progress_step =
 * project`, several of them enormous (Mistral AI at Fouju, 1 400 MW). Drawing
 * them beside sites that exist would put a building on the map that is not
 * there, and the pack's four render classes have no mark that says "announced".
 * They need their own sign before they can be shown; the count is printed below
 * so the omission stays visible.
 *
 * ── THE TWO SURFACE COLUMNS ARE NOT COPIED, AND THAT IS DELIBERATE ──────────
 *
 * `total_floor_area_sqm` and `IT_floor_area_sqm` look like two measurements and
 * are one. Over the 360 French rows that carry both, their ratio is EXACTLY
 * 0.500 on 223 of them and EXACTLY 5.000 on 49 more — 75.6 % of the pairs are
 * one number and a constant, and the 5.000 group is the same rule with the two
 * columns transposed (TGCC: total 3 651 m², "IT" 18 255 m²; a hall cannot be
 * five times the building around it). The direction of the derivation is
 * visible in the power-to-surface density too, which piles up on a handful of
 * exact values — 1 177 W/m² on 42 rows — because the surface was back-computed
 * from the power through `datacenter_categories`.
 *
 * The power itself survives the same test and is the reason this build exists:
 * recomputing every row as `total_floor_area_sqm × category ratio` reproduces
 * the published `power_total_mw` on 2 rows out of 349. The megawatts were
 * collected; the square metres were modelled from them. So the megawatts are
 * copied and the square metres are not, and the pack has no field for a reader
 * to mistake.
 *
 * Usage:  node scripts/build-datacenters-power.mjs [--check]
 *         --check  report what would change and exit non-zero if it differs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DCWATCH_MATCH_RADIUS_M,
  matchDcwatchToOsm,
  parseCsv,
  pointInGeometry,
} from './lib/dcwatchMatch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = resolve(ROOT, 'src/data/local_data/datacenters');
const OSM_SOURCE = resolve(DATA, 'datacenters.osm.geojsonl');
const OUTPUT = resolve(DATA, 'datacenters.geojsonl');
const DCWATCH_CSV = resolve(DATA, 'dcwatch/export_summary.csv');
const DEPARTEMENTS = resolve(ROOT, 'src/data/local_data/france_departements/departements.geojson');

/** Snapshot date of the vendored DCWatch release, for the card's provenance. */
const DCWATCH_RELEASE = '2026-04-09';

const checkOnly = process.argv.includes('--check');

/* ── Read the OSM half ────────────────────────────────────────────────────── */

if (!existsSync(OSM_SOURCE)) {
  console.error(`missing ${OSM_SOURCE}`);
  console.error('The pristine OSM extract is the input to this build. Restore it with:');
  console.error('  git show HEAD:src/data/local_data/datacenters/datacenters.geojsonl > ' + OSM_SOURCE);
  process.exit(2);
}

const osmLines = readFileSync(OSM_SOURCE, 'utf8').trim().split('\n');
const osmFeatures = osmLines.map((line) => JSON.parse(line));

/** Outer rings of a geometry, or [] for a Point. */
function outerRings(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates?.[0]].filter(Array.isArray);
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates ?? []).map((p) => p?.[0]).filter(Array.isArray);
  return [];
}

/** A representative `[lon, lat]`: the point itself, or the first ring's mean. */
function centreOf(geometry) {
  if (geometry?.type === 'Point') {
    const c = geometry.coordinates;
    return Array.isArray(c) && Number.isFinite(c[0] + c[1]) ? [Number(c[0]), Number(c[1])] : null;
  }
  const ring = outerRings(geometry)[0];
  if (!ring?.length) return null;
  let x = 0;
  let y = 0;
  for (const p of ring) { x += Number(p[0]); y += Number(p[1]); }
  return Number.isFinite(x + y) ? [x / ring.length, y / ring.length] : null;
}

/* ── Which OSM features are in France ─────────────────────────────────────── */

const departements = JSON.parse(readFileSync(DEPARTEMENTS, 'utf8')).features;
// A cheap envelope first: the point-in-polygon sweep over 96 départements is
// the expensive part, and 4 351 features mostly are not in Europe at all.
const FRANCE_ENVELOPE = { west: -6, east: 10.5, south: 41, north: 51.5 };

function frenchDepartement(centre) {
  if (!centre) return null;
  const [lon, lat] = centre;
  if (lon < FRANCE_ENVELOPE.west || lon > FRANCE_ENVELOPE.east) return null;
  if (lat < FRANCE_ENVELOPE.south || lat > FRANCE_ENVELOPE.north) return null;
  for (const d of departements) {
    if (pointInGeometry(centre, d.geometry)) return d.properties.code;
  }
  return null;
}

const frenchIndex = [];
osmFeatures.forEach((feature, index) => {
  const centre = centreOf(feature.geometry);
  const code = frenchDepartement(centre);
  if (!code) return;
  const tags = feature.properties?.tags ?? {};
  frenchIndex.push({
    index,
    centre,
    geometry: feature.geometry,
    identity: [tags.operator, tags.name, tags.brand, tags.owner, tags.ref].filter(Boolean).join(' '),
    ref: [tags.name, tags.ref].filter(Boolean).join(' '),
  });
});

/* ── Read the DCWatch half ────────────────────────────────────────────────── */

const dcwatchRows = parseCsv(readFileSync(DCWATCH_CSV, 'utf8'))
  .filter((row) => row.country === 'France')
  .filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)))
  .filter((row) => row.latitude !== '' && row.longitude !== '');

const rowsForMatching = dcwatchRows.map((row) => ({
  point: [Number(row.longitude), Number(row.latitude)],
  identity: `${row.operator} ${row.name}`,
  city: row.city_name,
  ref: row.name,
}));

const { pairs, unmatchedRows, refusedByRef } = matchDcwatchToOsm(rowsForMatching, frenchIndex, {
  radiusM: DCWATCH_MATCH_RADIUS_M,
});

/* ── Shape one DCWatch row into the block a card can read ─────────────────── */

/** A finite positive number, or null. Empty strings and 0.000 are both "unsaid". */
function positive(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Clean a DCWatch designation without softening what it says.
 *
 * `- autogenerated #2` is a marker DCWatch's own import writes when a row is
 * the second entry for one operator at one address; the ordinal is real and the
 * word is machine noise, so the ordinal stays and the word goes. Nothing else
 * is touched — in particular the trailing '?' on rows like 'ex-IBM DC /
 * kyndryl ?' is the source telling the reader it is unsure, and deleting it
 * would make this pack more confident than the database it came from.
 */
function cleanName(value) {
  return String(value ?? '')
    .replace(/\s*-\s*autogenerated\s*(#\d+)?/gi, (_, ordinal) => (ordinal ? ` ${ordinal}` : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function dcwatchBlock(row) {
  const block = {
    id: Number(row.id),
    release: DCWATCH_RELEASE,
    operator: (row.operator || '').trim() || undefined,
    name: cleanName(row.name) || undefined,
    // `power_total_mw` is 0.000 on a handful of rows, which means "collected,
    // nothing found" and not "a datacenter drawing no power". Those must not
    // print "0 MW", so they are dropped to undefined here rather than downstream.
    powerMw: positive(row.power_total_mw) ?? undefined,
    startYear: positive(row.operation_start_year) ?? undefined,
    department: (row.department || '').trim() || undefined,
  };
  for (const key of Object.keys(block)) if (block[key] === undefined) delete block[key];
  return block;
}

/* ── 1. Enrich the matched OSM features ───────────────────────────────────── */

const output = osmFeatures.map((feature) => ({
  ...feature,
  properties: { ...feature.properties },
}));

let enriched = 0;
let enrichedWithPower = 0;
for (const pair of pairs) {
  const target = output[frenchIndex[pair.featureIndex].index];
  const block = dcwatchBlock(dcwatchRows[pair.rowIndex]);
  target.properties.dcwatch = block;
  enriched += 1;
  if (block.powerMw) enrichedWithPower += 1;
}

/* ── 2. Append the operating sites OSM never mapped ───────────────────────── */

const appended = [];
let skippedProjects = 0;
for (const rowIndex of unmatchedRows) {
  const row = dcwatchRows[rowIndex];
  if (row.progress_step !== 'operating') { skippedProjects += 1; continue; }
  const block = dcwatchBlock(row);
  // The synthesized tags are the minimum a card and a label need, and they are
  // flagged `source=DCWatch` so nothing downstream can mistake them for an OSM
  // survey. `telecom=data_center` is what makes the render path treat the
  // feature as the same subject as the rest of the pack.
  appended.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] },
    properties: {
      id: `dcwatch/${row.id}`,
      // `type` in this pack is the OSM tag VALUE, not the element kind — it
      // reads `data_center` on 4 350 features and `data_centre` on one. An
      // appended row is the same subject, so it says the same thing; what
      // marks it as DCWatch's is `tags.source` and the `dcwatch` block, not a
      // third value in a field that means something else.
      type: 'data_center',
      tags: {
        telecom: 'data_center',
        name: cleanName(row.name) || undefined,
        operator: (row.operator || '').trim() || undefined,
        source: 'DCWatch',
      },
      dcwatch: block,
    },
  });
}
for (const feature of appended) {
  for (const key of Object.keys(feature.properties.tags)) {
    if (feature.properties.tags[key] === undefined) delete feature.properties.tags[key];
  }
}

const merged = [...output, ...appended];
const serialised = `${merged.map((f) => JSON.stringify(f)).join('\n')}\n`;

/* ── Report ───────────────────────────────────────────────────────────────── */

const appendedWithPower = appended.filter((f) => f.properties.dcwatch.powerMw).length;
const totalMw = merged.reduce((sum, f) => sum + (f.properties.dcwatch?.powerMw ?? 0), 0);
const frenchTotal = frenchIndex.length + appended.length;

console.log(`DCWatch ${DCWATCH_RELEASE} → pack datacenters`);
console.log(`  OSM en entrée              ${osmFeatures.length} features, dont ${frenchIndex.length} en France`);
console.log(`  DCWatch France géolocalisé ${dcwatchRows.length} lignes`);
console.log(`  appariés (≤ ${DCWATCH_MATCH_RADIUS_M} m + identité) ${enriched}, dont ${enrichedWithPower} avec une puissance`);
console.log(`  refusés sur un n° de bâtiment discordant ${refusedByRef}`);
console.log(`  ajoutés en exploitation    ${appended.length}, dont ${appendedWithPower} avec une puissance`);
console.log(`  projets écartés            ${skippedProjects}`);
console.log(`  → pack final ${merged.length} features, ${frenchTotal} en France`);
console.log(`  → ${enrichedWithPower + appendedWithPower} sites français portent une puissance, ${totalMw.toFixed(0)} MW cumulés`);

if (checkOnly) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (current === serialised) {
    console.log('\n--check : le pack est à jour.');
    process.exit(0);
  }
  console.error('\n--check : le pack DIFFÈRE de ce que cette entrée produirait. Relancer sans --check.');
  process.exit(1);
}

writeFileSync(OUTPUT, serialised);
console.log(`\nécrit ${OUTPUT}`);
