/**
 * @module amenitiesPack
 *
 * The national everyday-amenity pack: how it is discovered, read, folded and
 * written to disk. Node-side only — it reads files and opens sockets, and the
 * browser never imports it.
 *
 * ── WHY THIS IS A MODULE AND NOT THE PROXY'S PRIVATE BUSINESS ───────────────
 * It used to live inside `vite.config.js`, which meant the ONLY way to build a
 * pack was to ask the running server for one. Measured on staging 2026-09-14,
 * that is not a build, it is an outage: the container carries a 1 GiB
 * `mem_limit` and `--max-old-space-size=768`, and folding 521 672 register rows
 * inside the process that is also serving the globe took it from 327 MiB to
 * 941 MiB in **fourteen seconds** and ended in `FATAL ERROR: Ineffective
 * mark-compacts near heap limit`, exit 134, and a Docker restart. Every visitor
 * who switched the layer on restarted the server for everyone.
 *
 * So the build moved out here, where `scripts/build-amenities-pack.mjs` can run
 * it once a month in its own process with its own heap and the proxy can go back
 * to doing nothing but reading a file. The proxy still knows how to build one —
 * a clone with no pack has to get one somehow — but that path is now the
 * fallback rather than the design.
 *
 * ── WHAT THE BUILD COSTS, measured end to end 2026-09-02 ────────────────────
 * **52.9 s**, of which 51 s is the 142 884 474-byte download. Inflating that to
 * 1 515 251 530 bytes of semicolon CSV and reading all 2 921 770 rows takes
 * **8.7 s**; FINESS is 44 053 043 bytes in 2.7 s and 103 032 rows; the fold, the
 * mesh and the 34 778-commune point-in-polygon rollup are the rest.
 *
 * ── WHY THE ARCHIVE IS STREAMED AND NEVER BUFFERED ─────────────────────────
 * 1.5 GB does not belong in a Buffer. The single member's local header is read,
 * the rest is piped through `zlib.createInflateRaw`, and lines are handed to
 * `readBpeRow` one at a time. Nothing larger than one line is held except the
 * selected rows.
 *
 * ── WHY THE EDITION IS DISCOVERED ──────────────────────────────────────────
 * BPE gains an edition every August at a NEW INSEE page id, and the only stable
 * pointer to it is INSEE's own data.gouv entry, whose single resource url is the
 * current landing page. Three hops (data.gouv → landing → sub-pages), floored at
 * BPE25 — a discovery older than the floor is a malformed answer, not a new
 * fact, and is refused.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { readResponseJsonCapped, readResponseTextCapped } from './httpCapped.js';
import { buildDepartementIndex } from './franceDepartements.js';
import { projectAmenitiesDepartements } from './amenitiesDepartements.js';
import {
  AMENITY_FAMILIES,
  BPE_COLUMN_COUNT,
  BPE_DATAGOUV_URL,
  BPE_EDITION_FLOOR,
  BPE_LANDING_URL,
  BPE_ROW_FLOOR,
  FINESS_COLUMN_COUNT,
  FINESS_CSV_URL,
  FINESS_ROW_FLOOR,
  bpeArchiveFromHtml,
  bpeLandingFromDataset,
  bpeSubPagesFromHtml,
  buildAmenityMeshRows,
  csvHeaderIndex,
  foldAmenitySites,
  newAmenityTally,
  newestBpeArchive,
  readBpeRow,
  readFinessRow,
  splitSemicolonRow,
  sumByFamily,
  tallyAmenityOutcome,
} from './amenitiesFeed.js';

export const AMENITIES_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AMENITIES_STALE_MS = 120 * 24 * 60 * 60 * 1000;
export const AMENITIES_META_TIMEOUT_MS = 30_000;
export const AMENITIES_BULK_TIMEOUT_MS = 15 * 60_000;
export const AMENITIES_META_MAX_BYTES = 4 * 1024 * 1024;
export const AMENITIES_BPE_MAX_BYTES = 400 * 1024 * 1024;
export const AMENITIES_FINESS_MAX_BYTES = 160 * 1024 * 1024;
export const AMENITIES_SITE_CAP = 12_000;

/**
 * Shape version of the cached pack. BUMP IT whenever `readBpeRow`,
 * `readFinessRow`, `foldAmenitySites`, `buildAmenityMeshRows` or
 * `projectAmenitiesDepartements` changes what it returns: the cache lives for a
 * MONTH on disk and costs ninety seconds to rebuild, so without a bump a
 * projection edit stays invisible until October.
 *
 * A bump is also a DEPLOYMENT step, which is the lesson of 2026-09-08. Version 2
 * shipped without anyone rebuilding the pack on the VPS, the version-1 file sat
 * there being silently refused for six days, and the layer was dead the whole
 * time. Bumping this number means running `npm run amenities:pack` wherever a
 * pack lives — see `docs/DEPLOY.md`.
 */
// 2 — the Cityscan catch-up widened `BPE_CODE_FAMILY` from ten codes to
// twenty-four and `AMENITY_FAMILIES` from seven to fourteen, so a version-1
// pack holds neither the new records nor the new family indices in its mesh.
// 3 — the records left `pack.json` for per-cell shards. Measured 2026-09-14, the
// version-2 pack was 162.5 MB on disk and **644 MB of heap** to hold, in a
// container with a 768 MB ceiling: a pack that cannot be read is not a cache.
export const AMENITIES_CACHE_VERSION = 3;

/**
 * Degrees per shard of the site index.
 *
 * 0.5°, against a `AMENITIES_MAX_BOX_DEG` of 0.35: because the cell is WIDER
 * than the widest query, a `/sites` box can never straddle more than two cells
 * on either axis, so a request reads at most four shards no matter where it
 * lands. A 1° grid would read the same four but each would be four times the
 * size, and the densest of them is Paris.
 */
export const AMENITIES_SHARD_DEG = 0.5;

/** How many parsed shards stay resident. Four is one worst-case query. */
export const AMENITIES_SHARD_CACHE = 8;

/** Directory holding the pack, under a cache root (`.gev-cache` by default). */
export function amenitiesPackDir(root = process.cwd()) {
  return path.join(root, '.gev-cache', 'amenities-fr');
}

/** The pack file itself — mesh, rollup, provenance and the shard index. */
export function amenitiesPackPath(root = process.cwd()) {
  return path.join(amenitiesPackDir(root), 'pack.json');
}

/**
 * Shard key for one position.
 *
 * `Math.floor` on the scaled degree, formatted through the integer cell index
 * rather than the degree, so `-0` and floating-point dust can never produce two
 * names for one cell.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function amenitiesShardKey(lat, lon) {
  return `${Math.floor(lat / AMENITIES_SHARD_DEG)}_${Math.floor(lon / AMENITIES_SHARD_DEG)}`;
}

/**
 * Every shard key a bbox can touch.
 *
 * The east and north edges are inclusive because `validBox` hands over a closed
 * rectangle and a point exactly on the edge belongs to the query.
 * @param {{south:number,west:number,north:number,east:number}} box
 * @returns {string[]}
 */
export function amenitiesShardsForBox(box) {
  const keys = [];
  const latFrom = Math.floor(box.south / AMENITIES_SHARD_DEG);
  const latTo = Math.floor(box.north / AMENITIES_SHARD_DEG);
  const lonFrom = Math.floor(box.west / AMENITIES_SHARD_DEG);
  const lonTo = Math.floor(box.east / AMENITIES_SHARD_DEG);
  for (let lat = latFrom; lat <= latTo; lat += 1) {
    for (let lon = lonFrom; lon <= lonTo; lon += 1) keys.push(`${lat}_${lon}`);
  }
  return keys;
}

/** Path of one shard. */
export function amenitiesShardPath(dir, key) {
  return path.join(dir, 'sites', `${key}.json.gz`);
}

/** One small JSON document (data.gouv). */
async function fetchAmenitiesJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(AMENITIES_META_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return readResponseJsonCapped(response, AMENITIES_META_MAX_BYTES);
}

/** One INSEE HTML page. No Origin header is sent, which is the whole point. */
async function fetchAmenitiesHtml(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(AMENITIES_META_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return readResponseTextCapped(response, AMENITIES_META_MAX_BYTES);
}

/**
 * Resolve the current BPE archive URL.
 *
 * data.gouv is the stable root and the two INSEE hops are what actually name
 * the file. If data.gouv is unreachable the landing page measured against is
 * used instead, which is a degradation and not a guess: it is the edition every
 * number in `amenitiesFeed.js` was measured on.
 * @param {(message: string) => void} [warn]
 */
export async function discoverBpeArchive(warn = () => {}) {
  let landing = BPE_LANDING_URL;
  let discovered = false;
  try {
    const dataset = await fetchAmenitiesJson(BPE_DATAGOUV_URL);
    const fromDataset = bpeLandingFromDataset(dataset);
    if (fromDataset) {
      landing = fromDataset;
      discovered = true;
    }
  } catch (error) {
    warn(`data.gouv landing lookup failed: ${error?.message || error}`);
  }
  const html = await fetchAmenitiesHtml(landing);
  const base = landing.replace(/\/fr\/statistiques\/\d+.*$/, '');
  const pages = bpeSubPagesFromHtml(html);
  const candidates = [bpeArchiveFromHtml(html)];
  for (const page of pages) {
    try {
      candidates.push(bpeArchiveFromHtml(await fetchAmenitiesHtml(`${base}/fr/statistiques/${page}`)));
    } catch (error) {
      warn(`BPE sub-page ${page} unreadable: ${error?.message || error}`);
    }
  }
  const newest = newestBpeArchive(candidates, BPE_EDITION_FLOOR);
  if (!newest) {
    throw new Error(`no BPE archive at or above edition ${BPE_EDITION_FLOOR} on ${landing}`);
  }
  return { ...newest, landing, discovered };
}

/**
 * Bytes of an upstream response, as an async iterable of Buffers, with a
 * running cap.
 */
async function* responseBytes(response, maxBytes) {
  const reader = response.body.getReader();
  let downloaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    downloaded += value.byteLength;
    if (downloaded > maxBytes) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw new Error('Upstream response too large');
    }
    yield Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
}

/**
 * Stream one line at a time out of a byte source, optionally through the single
 * member of a ZIP.
 *
 * The source is any async iterable of Buffers — an upstream response, or a
 * `fs.createReadStream` when the build script was handed a local archive. Both
 * feed the same parser, which is the point: `--from` is a shortcut past the
 * download, never a second reader.
 *
 * The archive's local file header is 30 fixed bytes plus a name and an extra
 * field; everything after it is the raw deflate stream, which `inflateRaw`
 * consumes without ever materialising the 1.5 GB it expands to. Nothing bigger
 * than one inflate chunk is ever held.
 *
 * TWO THINGS HERE ARE PERFORMANCE AND NOT STYLE, both measured on the real
 * 1 515 251 530-byte member. Splitting each decoded chunk with `split('\n')`
 * rather than walking `indexOf` and re-slicing the carry took the parse from
 * **340 s to 8.7 s** — a 500-byte line inside a 1 MB chunk makes the
 * slice-per-line version copy the chunk's tail two thousand times, and there
 * are 2 921 770 lines. The inflate is also given a 1 MB `chunkSize`, because
 * the 16 KB default turns the same archive into ninety thousand generator
 * round-trips.
 * @param {AsyncIterable<Buffer>} source
 * @param {{ zipped?: boolean }} options
 */
export async function* amenitiesCsvLines(source, { zipped } = {}) {
  let stream = source;
  if (zipped) {
    stream = (async function* unzip() {
      const inflate = zlib.createInflateRaw({ chunkSize: 1024 * 1024 });
      const pending = [];
      let failure = null;
      let header = Buffer.alloc(0);
      let started = false;
      inflate.on('data', (chunk) => pending.push(chunk));
      inflate.on('error', (error) => { failure = error; });
      for await (const chunk of source) {
        let body = chunk;
        if (!started) {
          header = header.length ? Buffer.concat([header, chunk]) : chunk;
          if (header.length < 30) continue;
          if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('not a ZIP local header');
          const method = header.readUInt16LE(8);
          if (method !== 8) throw new Error(`unsupported ZIP compression method ${method}`);
          const offset = 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
          if (header.length < offset) continue;
          body = header.subarray(offset);
          started = true;
        }
        if (failure) throw failure;
        if (!inflate.write(body)) {
          await new Promise((resolve) => inflate.once('drain', resolve));
        }
        while (pending.length) yield pending.shift();
      }
      await new Promise((resolve) => inflate.end(resolve));
      if (failure) throw failure;
      while (pending.length) yield pending.shift();
    })();
  }

  const decoder = new TextDecoder('utf-8');
  let carry = '';
  for await (const chunk of stream) {
    const parts = (carry + decoder.decode(chunk, { stream: true })).split('\n');
    carry = parts.pop();
    for (const part of parts) {
      yield part.charCodeAt(part.length - 1) === 13 ? part.slice(0, -1) : part;
    }
  }
  if (carry) yield carry;
}

/** Open the BPE archive: a local file when one was given, the upstream otherwise. */
async function openBpeArchive({ archiveFile, warn }) {
  if (archiveFile) {
    // A local archive is a shortcut past the download and nothing else: the
    // edition still has to be discovered, because the file on disk does not say
    // which INSEE page it came from and the provenance has to.
    const archive = await discoverBpeArchive(warn);
    return { archive, bytes: fs.createReadStream(archiveFile) };
  }
  const archive = await discoverBpeArchive(warn);
  const response = await fetch(archive.url, {
    headers: { Accept: 'application/zip' },
    signal: AbortSignal.timeout(AMENITIES_BULK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${archive.url}`);
  return { archive, bytes: responseBytes(response, AMENITIES_BPE_MAX_BYTES) };
}

/** Fold the whole BPE archive: the drawn rows, and one point per commune. */
async function readBpeArchive(tally, { archiveFile, warn, onProgress }) {
  const { archive, bytes } = await openBpeArchive({ archiveFile, warn });

  const sites = [];
  const communes = new Map();
  let index = null;
  let scanned = 0;
  for await (const line of amenitiesCsvLines(bytes, { zipped: true })) {
    if (!index) {
      index = csvHeaderIndex(line);
      if (Object.keys(index).length !== BPE_COLUMN_COUNT) {
        throw new Error(`BPE header has ${Object.keys(index).length} columns, expected ${BPE_COLUMN_COUNT}`);
      }
      continue;
    }
    if (!line) continue;
    scanned += 1;
    if (onProgress && scanned % 500_000 === 0) onProgress(`BPE ${scanned} lignes`);
    const fields = splitSemicolonRow(line);
    const outcome = readBpeRow(fields, index);
    tallyAmenityOutcome(tally, outcome);
    const depcom = String(fields[index.DEPCOM] ?? '').replace(/^"|"$/g, '').trim();
    if (depcom) {
      let commune = communes.get(depcom);
      if (!commune) {
        commune = { depcom, lat: undefined, lon: undefined, covered: false };
        communes.set(depcom, commune);
      }
      if (outcome.kind === 'site') {
        commune.covered = true;
        if (commune.lat === undefined) {
          commune.lat = outcome.site.lat;
          commune.lon = outcome.site.lon;
        }
      } else if (commune.lat === undefined) {
        const lat = Number(String(fields[index.LATITUDE] ?? '').replace(/^"|"$/g, ''));
        const lon = Number(String(fields[index.LONGITUDE] ?? '').replace(/^"|"$/g, ''));
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          commune.lat = Number(lat.toFixed(5));
          commune.lon = Number(lon.toFixed(5));
        }
      }
    }
    if (outcome.kind === 'site') sites.push(outcome.site);
  }
  if (scanned < BPE_ROW_FLOOR * 0.9) {
    throw new Error(`BPE read only ${scanned} rows against a floor of ${BPE_ROW_FLOOR}`);
  }
  if (scanned !== BPE_ROW_FLOOR) {
    warn(`BPE drifted: ${scanned} rows against the measured ${BPE_ROW_FLOOR}`);
  }
  return { archive, sites, communes: [...communes.values()], scanned };
}

/** Fold the FINESS establishment extract. */
async function readFinessExtract(tally, { finessFile, onProgress }) {
  let bytes;
  let updated = null;
  if (finessFile) {
    bytes = fs.createReadStream(finessFile);
  } else {
    const response = await fetch(FINESS_CSV_URL, {
      headers: { Accept: 'text/csv' },
      signal: AbortSignal.timeout(AMENITIES_BULK_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${FINESS_CSV_URL}`);
    updated = response.headers.get('last-modified') || null;
    bytes = responseBytes(response, AMENITIES_FINESS_MAX_BYTES);
  }
  const sites = [];
  let index = null;
  let scanned = 0;
  for await (const line of amenitiesCsvLines(bytes, { zipped: false })) {
    if (!index) {
      index = csvHeaderIndex(line);
      if (Object.keys(index).length !== FINESS_COLUMN_COUNT) {
        throw new Error(`FINESS header has ${Object.keys(index).length} columns, expected ${FINESS_COLUMN_COUNT}`);
      }
      continue;
    }
    if (!line) continue;
    scanned += 1;
    if (onProgress && scanned % 50_000 === 0) onProgress(`FINESS ${scanned} lignes`);
    const outcome = readFinessRow(splitSemicolonRow(line), index);
    tallyAmenityOutcome(tally, outcome);
    if (outcome.kind === 'site') sites.push(outcome.site);
  }
  if (scanned < FINESS_ROW_FLOOR * 0.9) {
    throw new Error(`FINESS read only ${scanned} rows against a floor of ${FINESS_ROW_FLOOR}`);
  }
  return { sites, scanned, updated };
}

/**
 * Bundled département polygons, read once per process.
 *
 * The same file the browser layer fetches, so the national rollup and the shapes
 * it is painted on can never come from two different vintages.
 */
let _departementIndex = null;
export async function loadAmenitiesDepartementIndex(root = process.cwd()) {
  if (_departementIndex) return _departementIndex;
  const file = path.join(root, 'src', 'data', 'local_data', 'france_departements', 'departements.geojson');
  _departementIndex = buildDepartementIndex(JSON.parse(await fsp.readFile(file, 'utf8')));
  return _departementIndex;
}

/**
 * The whole national build.
 *
 * FINESS is fetched in parallel with the BPE archive but is NOT allowed to fail
 * silently: it is the only register behind two of the fourteen families, so
 * losing it would quietly delete every pharmacy and every hospital in France.
 * The layer degrades on a whole failure, with a sentence, rather than on half of
 * one without.
 *
 * @param {object} [options]
 * @param {string} [options.archiveFile] Local `BPE25.zip` instead of the download.
 * @param {string} [options.finessFile] Local FINESS CSV instead of the download.
 * @param {string} [options.root] Repository root, for the bundled polygons.
 * @param {(message: string) => void} [options.onProgress]
 * @param {(message: string) => void} [options.warn]
 */
export async function buildAmenitiesPack({
  archiveFile = null,
  finessFile = null,
  root = process.cwd(),
  onProgress = null,
  warn = (message) => console.warn(`[Amenities Pack] ${message}`),
} = {}) {
  const started = Date.now();
  const index = await loadAmenitiesDepartementIndex(root);
  const tally = newAmenityTally();
  const [bpe, finess] = await Promise.all([
    readBpeArchive(tally, { archiveFile, warn, onProgress }),
    readFinessExtract(tally, { finessFile, onProgress }),
  ]);
  onProgress?.(`repli de ${bpe.sites.length + finess.sites.length} lignes`);
  // Appended rather than spread into a third array: `[...a, ...b]` at half a
  // million elements is one more copy of everything at the exact moment the
  // fold is about to allocate its own, and this build has died of memory
  // before.
  const sites = bpe.sites;
  for (const site of finess.sites) sites.push(site);
  finess.sites.length = 0;
  const records = foldAmenitySites(sites);
  sites.length = 0;
  onProgress?.(`${records.length} points, maillage et roulement`);
  const mesh = buildAmenityMeshRows(records);
  const rollup = projectAmenitiesDepartements({ records, communes: bpe.communes, index });
  const perFamily = Object.fromEntries(AMENITY_FAMILIES.map((family) => [family, 0]));
  for (const record of records) perFamily[record.family] += 1;
  return {
    records,
    mesh,
    rollup,
    provenance: {
      edition: bpe.archive.edition,
      year: bpe.archive.year,
      archive: bpe.archive.url,
      landing: bpe.archive.landing,
      editionDiscovered: bpe.archive.discovered,
      finessUpdated: finess.updated,
      bpeRows: bpe.scanned,
      finessRows: finess.scanned,
      communes: bpe.communes.length,
      drawn: sumByFamily(tally.drawn),
      dots: records.length,
      perFamily,
      refusedNoCoordinate: tally.refusedNoCoordinate,
      refusedInvented: tally.refusedInvented,
      refusedCrs: tally.refusedCrs,
      precision: tally.precision,
      builtInMs: Date.now() - started,
    },
  };
}

/**
 * Write a pack to disk: the small half as one document, the records as shards.
 *
 * THE SPLIT IS THE WHOLE POINT. Measured on the 2026-09-14 build, the three
 * parts are 152.7 MB of `records`, 9.8 MB of `mesh` and 21 KB of `rollup` — and
 * only `/sites?bbox` ever wants a record, never more than a 0.35° box of them.
 * Keeping all three in one document meant the proxy paid 644 MB of heap to
 * answer a 21 KB rollup, which is why it could not run at all inside a 768 MB
 * ceiling. `mesh` and `rollup` stay resident because they are national and small;
 * the records go to per-cell files and are read four at a time.
 *
 * Neither half is ever held as one string either: the shards are written cell by
 * cell as the records are distributed, and `mesh` is streamed element by
 * element. `JSON.stringify` of the old whole-pack entry was a 162 MB string on
 * top of the object graph it came from.
 *
 * Everything lands in a sibling directory and is renamed into place, so an
 * interrupted build leaves the previous pack whole rather than half-replaced.
 *
 * @param {string} file Destination `pack.json`.
 * @param {{ version: number, at: number, payload: object }} entry
 * @returns {Promise<{ packBytes: number, shardBytes: number, shards: number }>}
 */
export async function writeAmenitiesPack(file, entry) {
  const dir = path.dirname(file);
  // The swap at the bottom REPLACES this directory, so refuse to point it at
  // one that is not already a pack. `--out ~/Documents` should be an error
  // message, not a deletion.
  const existing = await fsp.readdir(dir).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing?.length && !existing.includes('pack.json')) {
    throw new Error(`${dir} is not a pack directory (no pack.json) and is not empty — refusing to replace it`);
  }
  const staging = `${dir}.tmp`;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(path.join(staging, 'sites'), { recursive: true });

  // One pass over the records, appending each to its cell's open buffer. The
  // buffers are flushed as they are finished rather than kept, so the records
  // are copied once and never twice.
  const cells = new Map();
  for (const record of entry.payload.records || []) {
    const key = amenitiesShardKey(record.lat, record.lon);
    let cell = cells.get(key);
    if (!cell) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(record);
  }

  const index = {};
  let shardBytes = 0;
  for (const [key, records] of cells) {
    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(records)), { level: 9 });
    await fsp.writeFile(amenitiesShardPath(staging, key), gzipped);
    index[key] = records.length;
    shardBytes += gzipped.length;
    records.length = 0;
  }
  cells.clear();

  const packFile = path.join(staging, 'pack.json');
  const handle = fs.createWriteStream(packFile);
  const write = (text) => new Promise((resolve, reject) => {
    handle.write(text, (error) => (error ? reject(error) : resolve()));
  });
  try {
    await write(`{"version":${entry.version},"at":${entry.at},"payload":{"mesh":[`);
    const mesh = entry.payload.mesh || [];
    for (let i = 0; i < mesh.length; i += 1) {
      await write(i ? `,${JSON.stringify(mesh[i])}` : JSON.stringify(mesh[i]));
    }
    await write(`],"rollup":${JSON.stringify(entry.payload.rollup)}`);
    await write(`,"provenance":${JSON.stringify(entry.payload.provenance)}`);
    await write(`,"shards":{"deg":${AMENITIES_SHARD_DEG},"cells":${JSON.stringify(index)}}}}`);
    await new Promise((resolve, reject) => {
      handle.end((error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    handle.destroy();
    await fsp.rm(staging, { recursive: true, force: true });
    throw error;
  }

  const previous = `${dir}.old`;
  await fsp.rm(previous, { recursive: true, force: true });
  // `rename` over a populated directory fails, so the old one steps aside first.
  // The window where neither exists is one syscall, and a reader that lands in
  // it gets ENOENT — which `readAmenitiesPack` already treats as "no pack yet".
  if (await fsp.stat(dir).then(() => true, () => false)) await fsp.rename(dir, previous);
  await fsp.rename(staging, dir);
  await fsp.rm(previous, { recursive: true, force: true });

  return {
    packBytes: (await fsp.stat(file)).size,
    shardBytes,
    shards: Object.keys(index).length,
  };
}

/**
 * Read a pack from disk, saying WHY when it refuses one.
 *
 * The silence is what cost six days in September 2026: a version-1 file under a
 * version-2 build was dropped by a bare `if` with no log, so the only symptom
 * was a layer that rebuilt — and crashed — on every request. A refusal now
 * names itself.
 * @param {string} file
 * @param {(message: string) => void} [warn]
 * @returns {Promise<{ version: number, at: number, payload: object } | null>}
 */
export async function readAmenitiesPack(file, warn = () => {}) {
  let entry;
  try {
    entry = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(`pack at ${file} unreadable: ${error?.message || error}`);
    return null;
  }
  if (entry?.version !== AMENITIES_CACHE_VERSION) {
    warn(`pack at ${file} is version ${entry?.version ?? '?'}, this build needs ${AMENITIES_CACHE_VERSION}`
      + ' — rebuild it with `npm run amenities:pack`');
    return null;
  }
  if (!Number.isFinite(entry.at)
    || !Array.isArray(entry.payload?.mesh)
    || !Array.isArray(entry.payload?.rollup?.departements)
    || !entry.payload?.shards?.cells) {
    warn(`pack at ${file} is malformed — rebuild it with \`npm run amenities:pack\``);
    return null;
  }
  entry.dir = path.dirname(file);
  return entry;
}

/**
 * Parsed shards, most recently used last.
 *
 * A Map is the cache: insertion order is the LRU order, re-reading a key deletes
 * and re-sets it, and eviction is `keys().next()`. At `AMENITIES_SHARD_CACHE`
 * entries this holds two worst-case queries, so panning along a coast re-reads
 * nothing and the ceiling is still a handful of megabytes.
 */
const _shardCache = new Map();

/** Drop every cached shard — after a rebuild, the files underneath changed. */
export function clearAmenitiesShardCache() {
  _shardCache.clear();
}

/** One shard, from cache or disk. Missing cells are empty, not an error. */
async function readAmenitiesShard(dir, key) {
  const id = `${dir} ${key}`;
  const cached = _shardCache.get(id);
  if (cached) {
    _shardCache.delete(id);
    _shardCache.set(id, cached);
    return cached;
  }
  let records;
  try {
    records = JSON.parse(zlib.gunzipSync(await fsp.readFile(amenitiesShardPath(dir, key))));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    records = [];
  }
  _shardCache.set(id, records);
  if (_shardCache.size > AMENITIES_SHARD_CACHE) {
    _shardCache.delete(_shardCache.keys().next().value);
  }
  return records;
}

/**
 * Every record inside a bbox.
 *
 * Reads the four shards the box can touch and filters them, rather than
 * scanning the nation. An entry that still carries `records` in memory — the
 * in-process fallback build — is answered from those instead, so a clone with
 * no pack on disk behaves identically.
 * @param {{ payload: object, dir?: string }} entry
 * @param {{south:number,west:number,north:number,east:number}} box
 * @returns {Promise<object[]>}
 */
export async function amenitySitesInBox(entry, box) {
  const inBox = [];
  const keep = (record) => {
    if (record.lat < box.south || record.lat > box.north) return;
    if (record.lon < box.west || record.lon > box.east) return;
    inBox.push(record);
  };
  if (Array.isArray(entry.payload?.records)) {
    for (const record of entry.payload.records) keep(record);
    return inBox;
  }
  for (const key of amenitiesShardsForBox(box)) {
    for (const record of await readAmenitiesShard(entry.dir, key)) keep(record);
  }
  return inBox;
}
