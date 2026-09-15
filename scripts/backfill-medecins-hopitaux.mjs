/**
 * Add the FINESS hospitals to the SHIPPED médecins pack, without re-geocoding.
 *
 *   node scripts/backfill-medecins-hopitaux.mjs [--refresh]
 *
 * ── WHY THIS EXISTS, AND WHEN NOT TO USE IT ────────────────────────────────
 *
 * `build-medecins-fr.mjs` reads the hospitals natively since 2026-09-15, and a
 * full `npm run medecins:registry` is still the way to rebuild the pack. But a
 * full build re-asks BAN for 64 232 addresses, and the practice register had
 * not changed on the day the hospitals were added: five minutes of somebody
 * else's public API to recompute a column that depends on none of it.
 *
 * So this script does the one thing that was actually new. It reads the shipped
 * pack, hands its ALREADY GEOCODED addresses to the very same `readHospitals`
 * the build script uses — imported, not copied, which is what makes the result
 * byte-identical to the next full rebuild — and writes the pack back with
 * `etablissements` and `stats.hopitaux` filled in.
 *
 * Run it once. After that the pack has the field and a rebuild maintains it.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { _readHospitalsForBackfill } from './build-medecins-fr.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'src', 'data', 'local_data', 'medecins_fr', 'medecins.json.gz');

/** Tuple layout of `sites[]`, mirrored from `medecinsFrFeed.js`. */
const SITE_LAT = 0;
const SITE_LON = 1;
const SITE_PRACTITIONERS = 10;

const PRECISION = Object.freeze(['numero', 'voie', 'lieu-dit', 'commune']);

async function main() {
  const refresh = process.argv.includes('--refresh');

  process.stderr.write(`Lecture de ${path.relative(ROOT, PACK)}\n`);
  const pack = JSON.parse(zlib.gunzipSync(await fsp.readFile(PACK)));
  process.stderr.write(`  ${pack.sites.length} adresses déjà géocodées\n`);

  // `readHospitals` wants the build's in-memory shape — a `position` and a
  // `people` Set. The shipped tuples carry both facts, so the adapter is four
  // lines and no re-geocoding: `people.size` is the distinct-practitioner count
  // the build already wrote at index 10.
  const placed = pack.sites.map((site) => ({
    position: { lat: site[SITE_LAT], lon: site[SITE_LON] },
    people: { size: Number(site[SITE_PRACTITIONERS]) || 0 },
  }));

  process.stderr.write('\nFINESS — établissements hospitaliers\n');
  const hospitals = await _readHospitalsForBackfill(placed, { refresh });
  process.stderr.write(
    `  ${hospitals.stats.lignes} lignes retenues → ${hospitals.stats.etablissements} établissements`
    + `, dont ${hospitals.stats.avecPraticiensSurPlace} avec au moins une adresse de praticien `
    + `à moins de ${hospitals.stats.rayonFusionM} m\n`,
  );
  for (const [reason, count] of Object.entries(hospitals.stats.refuses)) {
    process.stderr.write(`  refusés — ${reason} : ${count}\n`);
  }

  pack.stats.hopitaux = hospitals.stats;
  pack.etablissements = hospitals.rows.map((row) => [
    row.lat,
    row.lon,
    PRECISION.indexOf(row.precision),
    row.names.join('+'),
    row.kinds.join('+'),
    row.finess.join('+'),
    row.commune,
    row.praticiensSurPlace,
    row.adressesSurPlace,
    row.updated || '',
  ]);
  const finessSource = 'FINESS — Fichier national des établissements sanitaires et sociaux, ARS/ANS (Licence Ouverte 2.0)';
  if (!pack.sources.includes(finessSource)) {
    // After the BAN line, which is the order the build script writes.
    const at = pack.sources.findIndex((line) => line.startsWith('BAN —'));
    pack.sources.splice(at < 0 ? pack.sources.length : at + 1, 0, finessSource);
  }

  const body = zlib.gzipSync(Buffer.from(JSON.stringify(pack), 'utf8'), { level: 9 });
  await fsp.writeFile(PACK, body);
  process.stderr.write(
    `\n${path.relative(ROOT, PACK)} — ${pack.etablissements.length} établissements ajoutés, `
    + `${(body.length / 1024 / 1024).toFixed(2)} Mo\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`\n✖ ${error.message}\n`);
  process.exitCode = 1;
});
