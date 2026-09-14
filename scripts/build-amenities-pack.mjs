#!/usr/bin/env node
/**
 * Build the national everyday-amenity pack — INSEE BPE + FINESS — into
 * `.gev-cache/amenities-fr/pack.json`, out of process.
 *
 * ── WHY THIS SCRIPT EXISTS ──────────────────────────────────────────────────
 * Because the alternative was an outage. Until 2026-09-14 the only way to get a
 * pack was to ask the running server for one: any request to
 * `/api/amenities-fr/{departements,mesh,sites}` with no valid pack on disk
 * triggered the whole national fold *inside the process serving the globe*.
 * Measured on staging that day, inside the container's 1 GiB `mem_limit` and
 * `--max-old-space-size=768`: memory went 327 → 941 MiB in **fourteen seconds**,
 * then `FATAL ERROR: Ineffective mark-compacts near heap limit`, exit 134, and
 * Docker restarted the container. Turning the layer on took the site down, for
 * everyone, every time.
 *
 * Worse, it could not recover on its own. `AMENITIES_CACHE_VERSION` went 1 → 2
 * on 2026-09-08 and nobody rebuilt the pack on the VPS, so the version-1 file
 * sitting in the cache volume was refused — silently — and the stale-pack
 * fallback could not fire either, because a pack refused for its VERSION is
 * never loaded and the fallback only serves a pack that was. Six days of a dead
 * layer and a restart loop, from one number.
 *
 * So the build lives here now, in its own process with its own heap, and the
 * server does nothing but read the file. Same code either way:
 * `src/data/amenitiesPack.js` is the single implementation.
 *
 * ── WHAT IT WRITES ──────────────────────────────────────────────────────────
 *   pack.json              mesh, rollup, provenance, shard index — about 10 MB
 *   sites/<lat>_<lon>.json.gz   the records, one gzipped file per 0.5° cell
 *
 * The split is what makes the pack readable at all. All three parts in one
 * document was 162.5 MB on disk and **644 MB of heap** to hold — measured
 * 2026-09-14 — in a container whose ceiling is 768 MB, and the 152.7 MB of
 * records in it are wanted by exactly one route, `/sites?bbox`, which never
 * asks for more than 0.35° of them. The server now holds the small half and
 * reads four cells per request.
 *
 * Everything is staged in a sibling directory and swapped in, so an interrupted
 * build leaves the previous pack whole rather than half-replaced.
 *
 * The output is NOT committed (`.gev-cache/` is gitignored). A clone without one
 * still works: the proxy falls back to building in-process, which is fine on a
 * laptop and is the thing this script exists to avoid on a server.
 *
 * ── RUNNING IT ON THE VPS ───────────────────────────────────────────────────
 * The fold peaks around 1.3 GB of RSS, and `docker exec` shares the container's
 * 1 GiB cgroup, so it does not fit inside a running `gev`. Build it on the host
 * and move the directory into the cache volume — see `docs/DEPLOY.md`.
 *
 * Usage:
 *   node scripts/build-amenities-pack.mjs                    # download + build
 *   node scripts/build-amenities-pack.mjs --from BPE25.zip   # local archive
 *   node scripts/build-amenities-pack.mjs --finess FILE.csv  # local FINESS CSV
 *   node scripts/build-amenities-pack.mjs --out DIR          # elsewhere
 *   node scripts/build-amenities-pack.mjs --check            # report, build nothing
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AMENITIES_CACHE_VERSION,
  AMENITIES_TTL_MS,
  amenitiesPackPath,
  amenitiesShardPath,
  buildAmenitiesPack,
  readAmenitiesPack,
  writeAmenitiesPack,
} from '../src/data/amenitiesPack.js';
import { AMENITY_FAMILIES, sumByFamily } from '../src/data/amenitiesFeed.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Parse the command line.
 *
 * Unknown flags are an error rather than a shrug: a typo in `--finess` on a
 * monthly cron would silently download 44 MB instead of reading the file it was
 * pointed at, and nothing downstream would look wrong.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const options = { archiveFile: null, finessFile: null, out: null, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--from') options.archiveFile = value();
    else if (arg === '--finess') options.finessFile = value();
    else if (arg === '--out') options.out = value();
    else if (arg === '--check') options.check = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

const fr = (n) => new Intl.NumberFormat('fr-FR').format(n);
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;

/** Age of a pack in plain words, and whether the proxy still counts it fresh. */
export function describeAge(at, now = Date.now(), ttlMs = AMENITIES_TTL_MS) {
  const days = Math.floor((now - at) / (24 * 60 * 60 * 1000));
  const fresh = now - at <= ttlMs;
  return `${days} jour${days > 1 ? 's' : ''} — ${fresh ? 'frais' : 'périmé, à reconstruire'}`;
}

/** `--check`: say what is on disk and stop. */
async function check(file) {
  const problems = [];
  const entry = await readAmenitiesPack(file, (message) => problems.push(message));
  if (!entry) {
    console.log(`✘ ${file}`);
    for (const problem of problems) console.log(`  ${problem}`);
    if (!problems.length) console.log('  aucun pack sur le disque');
    return 1;
  }
  const { size } = await fsp.stat(file);
  const provenance = entry.payload.provenance || {};
  const cells = Object.keys(entry.payload.shards?.cells || {});
  const shardBytes = (await Promise.all(cells.map(async (key) => {
    const stat = await fsp.stat(amenitiesShardPath(path.dirname(file), key)).catch(() => null);
    return stat ? stat.size : 0;
  }))).reduce((total, bytes) => total + bytes, 0);
  const missing = cells.length - (await Promise.all(cells.map((key) => fsp
    .stat(amenitiesShardPath(path.dirname(file), key)).then(() => 1, () => 0)))).reduce((a, b) => a + b, 0);
  console.log(`✔ ${file}`);
  console.log(`  version ${entry.version} · ${mb(size)} + ${fr(cells.length)} shards de ${mb(shardBytes)}`
    + ` · ${describeAge(entry.at)}`);
  if (missing) console.log(`  ⚠ ${fr(missing)} shards annoncés mais absents du disque`);
  console.log(`  BPE ${provenance.edition ?? '?'} (${provenance.year ?? '?'}) · ${fr(provenance.bpeRows ?? 0)} lignes`);
  console.log(`  FINESS ${fr(provenance.finessRows ?? 0)} lignes · maj ${provenance.finessUpdated ?? 'inconnue'}`);
  const dots = cells.reduce((total, key) => total + entry.payload.shards.cells[key], 0);
  console.log(`  ${fr(dots)} points · ${fr(entry.payload.mesh.length)} mailles`
    + ` · ${fr(entry.payload.rollup.departements.length)} départements`);
  return 0;
}

/** Families, biggest first — the shape of the pack in one readable block. */
function reportFamilies(perFamily = {}) {
  const rows = AMENITY_FAMILIES
    .map((family) => [family, perFamily[family] || 0])
    .sort((a, b) => b[1] - a[1]);
  const width = Math.max(...rows.map(([family]) => family.length));
  for (const [family, count] of rows) {
    console.log(`  ${family.padEnd(width)}  ${fr(count).padStart(9)}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✘ ${error.message}`);
    console.error('  node scripts/build-amenities-pack.mjs [--from BPE25.zip] [--finess FILE.csv] [--out DIR] [--check]');
    process.exitCode = 2;
    return;
  }

  const file = options.out ? path.join(options.out, 'pack.json') : amenitiesPackPath(REPO);
  if (options.check) {
    process.exitCode = await check(file);
    return;
  }

  const started = Date.now();
  // Sampled on every progress tick rather than read once at the end: the build
  // peaks during the fold and V8 has usually given a chunk of it back by the
  // time the last line prints, so an end-of-run reading understates the number
  // that decides whether this fits on a host.
  let peak = 0;
  const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
  const tick = (message) => {
    sample();
    console.log(`  ${String((Date.now() - started) / 1000).padStart(6)}s  ${message}`);
  };
  console.log(`Pack équipements du quotidien — version ${AMENITIES_CACHE_VERSION}`);
  if (options.archiveFile) console.log(`  archive locale : ${options.archiveFile}`);
  if (options.finessFile) console.log(`  FINESS local   : ${options.finessFile}`);

  const payload = await buildAmenitiesPack({
    archiveFile: options.archiveFile,
    finessFile: options.finessFile,
    root: REPO,
    onProgress: tick,
    warn: (message) => console.warn(`  ⚠ ${message}`),
  });

  const entry = { version: AMENITIES_CACHE_VERSION, at: Date.now(), payload };
  sample();
  const written = await writeAmenitiesPack(file, entry);
  sample();

  console.log('');
  console.log(`✔ ${file}`);
  console.log(`  ${mb(written.packBytes)} + ${fr(written.shards)} shards de ${mb(written.shardBytes)}`
    + ` · ${((Date.now() - started) / 1000).toFixed(1)} s · RSS max ${mb(peak)}`);
  console.log(`  BPE ${payload.provenance.edition} (${payload.provenance.year})`
    + `${payload.provenance.editionDiscovered ? ' — édition découverte' : ' — page de repli'}`);
  console.log(`  ${fr(payload.provenance.bpeRows)} lignes BPE + ${fr(payload.provenance.finessRows)} FINESS`
    + ` → ${fr(payload.records.length)} points`);
  // Each of these is a per-family record, not a number — printing one straight
  // gives `NaN`, which is how this line read the first time it ran.
  console.log(`  refusés : ${fr(sumByFamily(payload.provenance.refusedNoCoordinate))} sans coordonnée,`
    + ` ${fr(sumByFamily(payload.provenance.refusedInvented))} position inventée,`
    + ` ${fr(sumByFamily(payload.provenance.refusedCrs))} hors CRS`);
  console.log('');
  reportFamilies(payload.provenance.perFamily);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`✘ ${error?.message || error}`);
    process.exitCode = 1;
  });
}
