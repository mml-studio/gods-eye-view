// src/data/georisquesFeed.test.mjs
// Pins the UPSTREAM Géorisques shapes against three real captured responses.
// This is the projection the dev-server proxy runs, so it is the code that
// breaks first if the BRGM changes the register — and the only part of the
// Géorisques path a browser test would never see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GEORISQUES_DEFAULT_RADIUS_M,
  GEORISQUES_MAX_RADIUS_M,
  buildGeorisquesUrls,
  clampRadius,
  hazardGrade,
  hazardStanding,
  isSevesoStatus,
  projectGeorisques,
  projectHazards,
  projectIcpe,
  projectRadon,
} from './georisquesFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const REPORT = read('georisques-rapport-sample.json');
const ICPE = read('georisques-icpe-sample.json');
const RADON = read('georisques-radon-sample.json');

/** The point every fixture was captured at — avenue de France, Paris 13e. */
const ORIGIN = { lon: 2.3760, lat: 48.8300 };

test('the captured upstream responses still carry every field the projection reads', () => {
  for (const key of ['adresse', 'commune', 'url', 'risquesNaturels', 'risquesTechnologiques']) {
    assert.ok(Object.hasOwn(REPORT, key), `${key} must still be published`);
  }
  // The two hazard families are OBJECTS keyed by hazard, not arrays. A change
  // to an array here would silently project to zero hazards, which reads as
  // "this address is clear" — the one failure mode this source must not have.
  assert.equal(Array.isArray(REPORT.risquesNaturels), false);
  assert.equal(typeof REPORT.risquesNaturels, 'object');
  for (const entry of Object.values(REPORT.risquesNaturels)) {
    for (const key of ['present', 'libelle', 'libelleStatutCommune', 'libelleStatutAdresse']) {
      assert.ok(Object.hasOwn(entry, key), `hazard.${key} must still be published`);
    }
  }
  assert.equal(typeof ICPE.results, 'number');
  assert.ok(Array.isArray(ICPE.data));
  assert.ok(Array.isArray(RADON.data));
});

test('longitude comes first in latlon, against the parameter name', () => {
  const urls = buildGeorisquesUrls({ lon: 2.376, lat: 48.83, radiusM: 1000, inseeCode: '75113' });
  // Decoded, the pair reads "2.376,48.83". Reversed it would still be a valid
  // point — in Somalia — and the API would answer 200, so this is pinned.
  assert.match(decodeURIComponent(urls.report), /latlon=2\.376,48\.83&/);
  assert.match(urls.radon, /code_insee=75113$/);
});

test('a scan with no resolved INSEE code asks for no radon at all', () => {
  const urls = buildGeorisquesUrls({ lon: 2.376, lat: 48.83 });
  assert.equal(urls.radon, null);
});

test('the radius is clamped rather than trusted', () => {
  assert.equal(clampRadius(99_999), GEORISQUES_MAX_RADIUS_M);
  assert.equal(clampRadius(10), 100);
  assert.equal(clampRadius('not a number'), 1000);
});

test('both verdicts survive, and their disagreement is reported', () => {
  const technological = projectHazards(REPORT.risquesTechnologiques);
  const icpe = technological.find((entry) => entry.id === 'icpe');
  // The captured report says the commune is concerned by classified
  // installations while this address is not. That gap IS the answer to
  // "does this vary by street", and the upstream computed it for us.
  assert.equal(icpe.communeVerdict, 'Risque Concerne');
  assert.equal(icpe.addressVerdict, 'Risque non Concerne');
  assert.equal(icpe.variesByAddress, true);

  const pollution = technological.find((entry) => entry.id === 'pollutionSols');
  assert.equal(pollution.communeVerdict, pollution.addressVerdict);
  assert.equal(pollution.variesByAddress, false);
});

test('an absent hazard is a checked answer, not a dropped one', () => {
  const natural = projectHazards(REPORT.risquesNaturels);
  const coastal = natural.find((entry) => entry.id === 'risqueCotier');
  assert.equal(coastal.present, false);
  assert.equal(coastal.communeVerdict, null);
  // Present hazards sort first so a reader meets what reaches them first.
  assert.equal(natural[0].present, true);
  assert.equal(natural.at(-1).present, false);
});

test('a missing hazard map projects to an empty list, never to a throw', () => {
  assert.deepEqual(projectHazards(null), []);
  assert.deepEqual(projectHazards(undefined), []);
  assert.deepEqual(projectHazards([]), []);
});

test('establishments are distance-sorted and keep their regime', () => {
  const { items, total, truncated } = projectIcpe(ICPE, ORIGIN);
  assert.equal(total, 30);
  assert.equal(truncated, true, 'the fixture keeps 5 of 30 rows, so the page is short');
  assert.equal(items.length, 5);
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(items[i].distanceM >= items[i - 1].distanceM, 'sorted by distance');
  }
  // A declassified site is KEPT, with its regime, rather than filtered away:
  // the register having surveyed it is itself a fact about the block.
  const darty = items.find((entry) => entry.name.includes('DARTY'));
  assert.equal(darty.regime, 'Non ICPE');
  assert.equal(darty.seveso, false);
  assert.ok(darty.distanceM > 0 && darty.distanceM < 1000);
});

test('radon reads the commune class, and refuses anything out of domain', () => {
  assert.deepEqual(projectRadon(RADON), { class: 1, label: 'Potentiel radon faible' });
  assert.deepEqual(projectRadon({ data: [{ classe_potentiel: '9' }] }), { class: null, label: null });
  assert.deepEqual(projectRadon(null), { class: null, label: null });
});

test('a failed upstream degrades one field and leaves the rest standing', () => {
  const projected = projectGeorisques({
    report: REPORT, icpe: null, radon: null, origin: ORIGIN, radiusM: 1000,
  });
  assert.equal(projected.available.report, true);
  assert.equal(projected.available.icpe, false);
  assert.equal(projected.available.radon, false);
  assert.deepEqual(projected.icpe, []);
  assert.equal(projected.icpeTotal, null);
  // The hazards the report DID answer are untouched by the other two failing.
  assert.ok(projected.naturalRisks.length > 0);
  assert.equal(projected.radon.class, null);
});

test('the commune code is echoed as Paris-whole, which is why radon is keyed elsewhere', () => {
  const projected = projectGeorisques({
    report: REPORT, icpe: ICPE, radon: RADON, origin: ORIGIN, radiusM: 1000,
  });
  // 75056, not 75113. Feeding this back into a per-arrondissement dataset —
  // DVF above all — is the bug this assertion exists to keep visible.
  assert.equal(projected.commune.inseeCode, '75056');
  assert.equal(projected.commune.postalCode, '75013');
  assert.equal(projected.radon.class, 1);
  assert.equal(projected.address.label, '38 Rue des Cadets de la France Libre, 75013 Paris');
});

test('an absent parameter takes the default, not the minimum', () => {
  // FOUND LIVE. `URLSearchParams.get()` returns `null` when a parameter is
  // absent, `Number(null)` is `0`, and `Number.isFinite(0)` is true — so the
  // clamp read "the caller said nothing" as "the caller said zero" and returned
  // its MINIMUM. `GET /api/dpe` with no radius scanned 50 m instead of 200 m and
  // reported `total: 0` for an address with 2,805 diagnostics around it.
  const absent = new URL('http://x/?other=1').searchParams.get('radius');
  assert.equal(absent, null);
  assert.equal(clampRadius(absent), GEORISQUES_DEFAULT_RADIUS_M);
  assert.equal(clampRadius(''), GEORISQUES_DEFAULT_RADIUS_M);
  assert.equal(clampRadius(undefined), GEORISQUES_DEFAULT_RADIUS_M);
  // An EXPLICIT zero is still a request, and is still clamped to the floor.
  assert.equal(clampRadius('0'), 100);
});

test('"non connu" is never read as "non concerné", which is the whole trap', () => {
  // Both begin "risque non", and a prefix test for the negative turns "the
  // register does not know whether the clay under this address shrinks" into
  // "it does not". Measured on the Paris 13e capture, where argiles reads
  // exactly that at address level.
  assert.equal(hazardStanding('Risque non Connu'), 'unknown');
  assert.equal(hazardStanding('Risque non Concerne'), 'clear');
  assert.equal(hazardStanding('Risque non concerné'), 'clear');

  // Two vocabularies, one for each family, both meaning "it reaches here".
  assert.equal(hazardStanding('Risque Existant'), 'concerned');
  assert.equal(hazardStanding('Risque Existant - faible'), 'concerned');
  assert.equal(hazardStanding('Risque Existant - important'), 'concerned');
  assert.equal(hazardStanding('Risque Concerne'), 'concerned');

  // Absent is absent — not assessed, and not clear.
  assert.equal(hazardStanding(null), null);
  assert.equal(hazardStanding(''), null);
  assert.equal(hazardStanding('   '), null);
  // A label neither vocabulary carries reports as unknown rather than as a
  // guess: a new verdict string upstream must not silently paint "clear".
  assert.equal(hazardStanding('Statut en cours de revision'), 'unknown');
});

test('the grade is the source\'s own word, and absent when there is none', () => {
  assert.equal(hazardGrade('Risque Existant - faible'), 'faible');
  assert.equal(hazardGrade('Risque Existant - important'), 'important');
  assert.equal(hazardGrade('Risque Existant'), null);
  assert.equal(hazardGrade('Risque non Connu'), null);
  assert.equal(hazardGrade(null), null);
});

test('every hazard carries both standings, and the address grade wins', () => {
  const natural = projectHazards(REPORT.risquesNaturels);
  const argiles = natural.find((entry) => entry.id === 'retraitGonflementArgile');
  // The real disagreement on the 13e, and the reason both verdicts travel:
  // the commune is graded "important", the address is not known at all.
  assert.equal(argiles.communeStanding, 'concerned');
  assert.equal(argiles.addressStanding, 'unknown');
  assert.equal(argiles.variesByAddress, true);
  // The address carries no grade, so the commune's is what is reported rather
  // than nothing — the reader is still owed "important".
  assert.equal(argiles.grade, 'important');

  const seisme = natural.find((entry) => entry.id === 'seisme');
  assert.equal(seisme.addressStanding, 'concerned');
  assert.equal(seisme.grade, 'faible');

  const cotier = natural.find((entry) => entry.id === 'risqueCotier');
  // Checked and absent: no verdict either side, and no standing invented.
  assert.equal(cotier.present, false);
  assert.equal(cotier.communeStanding, null);
  assert.equal(cotier.addressStanding, null);

  const icpe = projectHazards(REPORT.risquesTechnologiques).find((entry) => entry.id === 'icpe');
  assert.equal(icpe.communeStanding, 'concerned');
  assert.equal(icpe.addressStanding, 'clear');
});

test('the commune outline rides along, with the code the scan actually ran on', () => {
  const contour = { code: '75113', name: 'Paris 13e Arrondissement', parts: [[2.3, 48.8, 2.4, 48.8, 2.4, 48.9]], simplified: true };
  const out = projectGeorisques({
    report: REPORT, icpe: ICPE, radon: RADON, contour, inseeCode: '75113', origin: ORIGIN, radiusM: 1000,
  });
  assert.equal(out.communeContour, contour);
  assert.equal(out.available.contour, true);
  // BOTH codes, because both are true statements about different things: the
  // report was written about Paris-whole, the outline and the radon class were
  // fetched for the arrondissement.
  assert.equal(out.commune.inseeCode, '75056');
  assert.equal(out.commune.scanInseeCode, '75113');
});

test('a missing outline degrades the stroke and nothing else', () => {
  const out = projectGeorisques({
    report: REPORT, icpe: ICPE, radon: RADON, origin: ORIGIN, radiusM: 1000,
  });
  assert.equal(out.communeContour, null);
  assert.equal(out.available.contour, false);
  // The verdicts, the establishments and the radon class are all still there:
  // the outline is the one upstream whose absence costs a reader a line and
  // not an answer.
  assert.ok(out.naturalRisks.length > 0);
  assert.ok(out.icpe.length > 0);
  assert.equal(out.radon.class, 1);
  assert.equal(out.commune.scanInseeCode, null);
});

test('"Non Seveso" is a truthy string, and was painting 78% of the red marks', () => {
  // The register answers with a LABEL, not a boolean, and one of its values
  // says no. Measured over 380 establishments on four scans (Feyzin,
  // Port-Jérôme, Lacq, Paris 13e) on 2026-09-14: null 199, "Non Seveso" 141,
  // "Seveso seuil bas" 15, "Seveso seuil haut" 25. Read as a boolean, 181
  // sites came back Seveso — 141 of them wrongly, in the loudest colour the
  // layer has, beside a card reading "Seveso : Non Seveso".
  assert.equal(isSevesoStatus('Non Seveso'), false);
  assert.equal(isSevesoStatus(null), false);
  assert.equal(isSevesoStatus(''), false);
  assert.equal(isSevesoStatus('Seveso seuil haut'), true);
  assert.equal(isSevesoStatus('Seveso seuil bas'), true);
  // Positive on the prefix, so a value this vocabulary has not seen yet stays
  // Seveso if it announces itself as one, and is never promoted if it does not.
  assert.equal(isSevesoStatus('Seveso seuil haut (dérogation)'), true);
  assert.equal(isSevesoStatus('Établissement non concerné'), false);

  // …and the projection uses it. Three of the five captured establishments
  // carry "Non Seveso" and not one of them is a Seveso site.
  const { items } = projectIcpe(ICPE, ORIGIN);
  assert.equal(items.filter((site) => site.seveso).length, 0);
  // The label still travels, because the card prints it: "checked, not Seveso"
  // is a fact worth showing, it is just not a red plate.
  assert.equal(items.filter((site) => site.sevesoStatus === 'Non Seveso').length, 3);
});
