// The commune outlines two French layers now share.
//
// The behaviour under test is the same one `delinquanceFeed.test.mjs` has
// always pinned — it runs against the same real Corsican and Parisian
// fixtures — and those tests staying green next to these is what says the
// extraction was faithful rather than a rewrite. What is new here is the part
// the childcare layer needed: `codeEpci` surviving the projection, and the
// second request that is the only way an arrondissement exists at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ARRONDISSEMENT_DEPARTEMENTS,
  COMMUNE_MAX_PARTS,
  COMMUNE_MAX_RING_VERTICES,
  arrondissementContoursUrl,
  communeContoursUrl,
  decimateCommuneRing,
  hasArrondissements,
  projectCommuneContours,
  projectSingleCommuneContour,
  ringAnchor,
  singleCommuneContourUrl,
} from './communeContours.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const CORSE = load('geoapi-communes-2b-sample.json');
const PARIS = load('geoapi-communes-75-epci-sample.json');
const ARRONDISSEMENTS = load('geoapi-arrondissements-75-sample.json');

test('a URL is only built for a code the API could answer', () => {
  assert.equal(
    communeContoursUrl('2B'),
    'https://geo.api.gouv.fr/departements/2B/communes?format=geojson&geometry=contour&fields=code,nom,population',
  );
  assert.match(communeContoursUrl('2a'), /departements\/2A\/communes/);
  assert.match(communeContoursUrl('971'), /departements\/971\/communes/);
  for (const bad of ['', '9', '999', '../etc', '75056', null]) {
    assert.throws(() => communeContoursUrl(bad), /invalid département code/);
  }
  // The field list is the one place a caller could smuggle query string into
  // the URL, so it is guarded rather than escaped — see `assertFields`.
  assert.throws(() => communeContoursUrl('75', { fields: 'code&limit=1' }), /invalid fields/);
  assert.match(communeContoursUrl('75', { fields: 'code,codeEpci' }), /fields=code,codeEpci$/);
});

test('only three départements have arrondissements, and they need the second call', () => {
  assert.deepEqual([...ARRONDISSEMENT_DEPARTEMENTS], ['75', '69', '13']);
  for (const dep of ARRONDISSEMENT_DEPARTEMENTS) assert.equal(hasArrondissements(dep), true);
  assert.equal(hasArrondissements('01'), false);
  assert.equal(hasArrondissements(null), false);
  const url = arrondissementContoursUrl('13');
  assert.match(url, /codeDepartement=13/);
  assert.match(url, /type=arrondissement-municipal/);
  // Not the /departements/:code/communes route: that one answers the parent
  // commune and would silently return the same polygon twice.
  assert.equal(/departements\/13/.test(url), false);
});

test('a ring is closed, deduped and honest about having been strided', () => {
  const galeria = CORSE.features.find((f) => f.properties.code === '2B121');
  const decimated = decimateCommuneRing(galeria.geometry.coordinates[0]);
  assert.equal(decimated.simplified, true);
  assert.equal(decimated.ring.length / 2, COMMUNE_MAX_RING_VERTICES);
  // An unclosed ring is the one simplification whose failure mode is a visible
  // gash across the commune.
  assert.equal(decimated.ring[0], decimated.ring[decimated.ring.length - 2]);
  assert.equal(decimated.ring[1], decimated.ring[decimated.ring.length - 1]);
  // A ring the layer cannot draw yields nothing rather than a degenerate shape.
  assert.deepEqual(decimateCommuneRing([[1, 2], [1, 2]]), { ring: [], simplified: false });
  assert.deepEqual(decimateCommuneRing(null), { ring: [], simplified: false });
});

test('a multi-part commune keeps its biggest pieces and says how many it dropped', () => {
  const contours = projectCommuneContours(CORSE);
  assert.equal(contours.communes.length, 5);
  assert.equal(contours.droppedParts, 2, "L'Île-Rousse publishes five pieces; three are kept");
  const ileRousse = contours.communes.find((c) => c.code === '2B134');
  assert.equal(ileRousse.parts.length, COMMUNE_MAX_PARTS);
  assert.equal(ileRousse.simplified, true);
  // Outer rings only: an interior ring is ANOTHER commune, drawn in its own
  // right, so cutting the hole would leave a gap where a polygon already sits.
  assert.equal(contours.communes.find((c) => c.code === '2B049').parts.length, 2);
  assert.equal(projectCommuneContours({ features: [{ properties: {}, geometry: null }] }).communes.length, 0);
  assert.equal(projectCommuneContours(null).communes.length, 0);
});

test('codeEpci survives the projection when the caller asked for it', () => {
  // An EPCI has no contour on this API. This one property is the whole reason
  // its territory can be drawn at all.
  assert.equal(projectCommuneContours(PARIS).communes[0].epci, '200054781');
  // …and its absence is null rather than a guess: the arrondissement request
  // does not carry it, measured on the real answer.
  assert.equal(projectCommuneContours(ARRONDISSEMENTS).communes[0].epci, null);
  assert.equal(projectCommuneContours(CORSE).communes[0].epci, null);
});

test('a card anchor is the mean of a drawn ring, never of an undrawn one', () => {
  const paris = projectCommuneContours(PARIS).communes[0];
  const [lon, lat] = ringAnchor(paris.parts[0]);
  assert.ok(lon > 2.2 && lon < 2.5, `lon ${lon}`);
  assert.ok(lat > 48.7 && lat < 49, `lat ${lat}`);
  assert.equal(ringAnchor([1, 2]), null);
  assert.equal(ringAnchor(null), null);
});

test('one commune is fetched by code, and the geometry is asked for explicitly', () => {
  const url = singleCommuneContourUrl('33063');
  assert.equal(
    url,
    'https://geo.api.gouv.fr/communes/33063?format=geojson&geometry=contour&fields=code,nom,population',
  );
  // THE FAILURE THIS PINS IS SILENT. Without `geometry=contour` the endpoint
  // answers 200, `"type":"Feature"`, with a **Point** — the commune centre —
  // in 125 bytes. Nothing throws and nothing is empty; the caller just draws a
  // dot where it asked for a boundary. Measured on 33063, 75113 and 75056.
  assert.match(url, /geometry=contour/);
  // An arrondissement municipal answers on this route without the `type`
  // filter the département route needs, which is what lets a caller holding a
  // BAN-resolved 75113 ask for the arrondissement and not for Paris.
  assert.match(singleCommuneContourUrl('75113'), /communes\/75113\?/);
  assert.match(singleCommuneContourUrl('2A004'), /communes\/2A004\?/);
  assert.equal(singleCommuneContourUrl('2a004'), singleCommuneContourUrl('2A004'));
});

test('a code this API cannot accept throws rather than building a bad URL', () => {
  // The caller decides what to do with it — the Géorisques proxy catches and
  // drops the outline so one optional upstream cannot fail a whole scan.
  for (const bad of ['', null, undefined, '750', '750566', 'PARIS', '7505A']) {
    assert.throws(() => singleCommuneContourUrl(bad), /invalid commune code/, String(bad));
  }
  // Surrounding whitespace is trimmed rather than rejected: it comes from a
  // query string, and a caller that typed a space meant the code.
  assert.equal(singleCommuneContourUrl(' 75056 '), singleCommuneContourUrl('75056'));
  assert.throws(() => singleCommuneContourUrl('33063', { fields: 'code,nom;drop' }), /invalid fields/);
});

test('the single-Feature reply projects through the SAME decimator as the pack', () => {
  const feature = load('geoapi-commune-75113-contour.json');
  const one = projectSingleCommuneContour(feature);
  assert.equal(one.code, '75113');
  assert.equal(one.name, 'Paris 13e Arrondissement');
  assert.equal(one.population, 181271);
  assert.equal(one.parts.length, 1);
  // Flat [lon, lat, …] pairs, closed and drawable, decimated to the same
  // ceiling one of 887 communes gets. 114 source vertices become 64.
  assert.ok(one.parts[0].length % 2 === 0);
  assert.equal(one.parts[0].length / 2 <= COMMUNE_MAX_RING_VERTICES + 1, true);
  assert.equal(one.simplified, true);
  const [lon, lat] = ringAnchor(one.parts[0]);
  assert.ok(lon > 2.3 && lon < 2.42, `lon ${lon}`);
  assert.ok(lat > 48.8 && lat < 48.86, `lat ${lat}`);
});

test('a centre-only reply projects to nothing, rather than to a one-point commune', () => {
  // What the endpoint sends when `geometry=contour` was forgotten. It must
  // surface as "no outline", never as a polygon with one vertex.
  assert.equal(projectSingleCommuneContour(load('geoapi-commune-75113-centre.json')), null);
  assert.equal(projectSingleCommuneContour(null), null);
  assert.equal(projectSingleCommuneContour({ properties: { code: '75113' }, geometry: null }), null);
});
