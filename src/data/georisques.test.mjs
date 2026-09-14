// src/data/georisques.test.mjs
//
// The reported symptom, from a live session over the Trocadéro on 2026-09-14:
// "je peux bien voir une petite icône sur laquelle je peux cliquer. Très
// honnêtement, elle est très peu visible, voire même clairement invisible."
// The mark was one part of it. The other was that the eight hazards the same
// scan had already resolved were drawn nowhere and keyed nowhere — fetched,
// projected, summarised, and read by no surface of the globe.
//
// A second reading, over Bassussarry at 5 859 m, moved two more things: "elle
// est beaucoup trop petite, quasiment invisible" about the installation mark,
// and a request for the commune to be HIGHLIGHTED rather than outlined. The
// size half of that is pinned here as a number on screen rather than as a
// constant — `markPixelsAtDistance` — because the constant said 24 while the
// mark measured 15.9.
//
// These run against the real captured 13e scan, projected through the very
// function the proxy runs, so what is pinned is the answer a reader gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { projectGeorisques } from './georisquesFeed.js';
import { projectSingleCommuneContour } from './communeContours.js';
import { isWorldPick } from './pickRegistry.js';
import {
  COMMUNE_FILL_ALPHA,
  communeClassificationTypeForScene,
  communeDescription,
  drawCommuneOutline,
  drawCommuneWash,
  effectiveStanding,
  georisquesLegend,
  isCommuneWashId,
  legendBucket,
  markPixelsAtDistance,
} from './georisques.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ORIGIN = { lon: 2.3760, lat: 48.8300 };
const CONTOUR = projectSingleCommuneContour(read('geoapi-commune-75113-contour.json'));

/** The payload the browser is actually served for the captured 13e scan. */
const PAYLOAD = projectGeorisques({
  report: read('georisques-rapport-sample.json'),
  icpe: read('georisques-icpe-sample.json'),
  radon: read('georisques-radon-sample.json'),
  contour: CONTOUR,
  inseeCode: '75113',
  origin: ORIGIN,
  radiusM: 1000,
});

/** A `dataSource` that records what a layer asked to draw. */
function recordingDataSource() {
  const added = [];
  return { added, entities: { add: (entity) => { added.push(entity); return entity; } } };
}

test('the hazards reach the key, which is where they reached nothing before', () => {
  const controls = georisquesLegend(PAYLOAD, { commune: 'Paris', radonClass: 1 });
  const labels = controls.legend.map((entry) => entry.label);

  // Every hazard the register says reaches this address is on screen, by name.
  for (const name of ['Inondation', 'Remontée de nappe', 'Séisme', 'Mouvements de terrain',
    'Canalisations de transport de matières dangereuses', 'Pollution des sols']) {
    assert.ok(labels.some((label) => label.startsWith(`${name} —`)), `${name}: ${labels.join(' | ')}`);
  }
  // The grade rides in the label, not in a sentence a reader has to open:
  // "faible" and "important" are the difference between a formality and a
  // structural survey.
  assert.ok(labels.includes('Séisme — concerné · faible'), labels.join(' | '));
});

test('a verdict with no geometry gets an empty swatch, never a colour', () => {
  const controls = georisquesLegend(PAYLOAD, null);
  const hazardLines = controls.legend.filter((entry) => entry.label.includes('—'));
  assert.ok(hazardLines.length >= 6);
  // `color: null` is the manager's "assessed, not mapped" slot. A colour here
  // would promise the reader something on the globe is painted that hue, and
  // `resultats_rapport_risque` publishes no geometry for any of these.
  for (const entry of hazardLines) assert.equal(entry.color, null, entry.label);
  assert.match(controls.note, /pas de géométrie/);
});

test('the two verdicts are printed together exactly when they disagree', () => {
  const controls = georisquesLegend(PAYLOAD, null);
  const argiles = controls.legend.find((entry) => entry.label.startsWith('Retrait gonflement'));
  // The real disagreement on the 13e: the commune is graded "important", the
  // address is not known. Collapsing that to one word would either invent
  // safety or invent alarm.
  assert.equal(argiles.label, 'Retrait gonflement des argiles — non connu · diffère de la commune');
  assert.equal(argiles.blurb, 'commune : Risque Existant - important · à cette adresse : Risque non Connu');

  // A HAZARD CLEARED AT THE ADDRESS AND PRESENT ON THE COMMUNE KEEPS ITS LINE.
  // This one was being folded into the "checked and clear" tail, which threw
  // away the most informative verdict of the scan — the reader read "settled"
  // where the register said "not on your street, yes around here".
  const icpe = controls.legend.find((entry) => entry.label.startsWith('Installations industrielles'));
  assert.equal(icpe.label, 'Installations industrielles classées (ICPE) — hors zone · diffère de la commune');
  assert.equal(icpe.blurb, 'commune : Risque Concerne · à cette adresse : Risque non Concerne');

  // A hazard both verdicts agree on carries no comparison at all.
  const flood = controls.legend.find((entry) => entry.label.startsWith('Inondation'));
  assert.equal(flood.blurb, '');
});

test('"checked and clear" is one tail line, not six lines of no', () => {
  const controls = georisquesLegend(PAYLOAD, null);
  const tail = controls.legend.at(-1);
  assert.match(tail.label, /^\d+ autres aléas vérifiés — hors zone$/);
  assert.equal(tail.color, null);
  // The distinction the whole feed is built to keep: checked-and-absent is not
  // unchecked, and the tail says so rather than implying it.
  assert.match(tail.blurb, /pas la même chose que non vérifiés/);
});

test('the key names the commune and leads with what is actually drawn', () => {
  const controls = georisquesLegend(PAYLOAD, { commune: 'Paris', radonClass: 1 });
  // Drawn first, assessed second: a key explains a map, and starting with six
  // colourless lines reads as six layers that failed to render.
  assert.equal(controls.legend[0].label, 'Commune de Paris 13e Arrondissement');
  assert.equal(controls.legend[0].color, '#6fd3e8');
  // The tint is named as a jurisdiction and denied as an extent, in that
  // order: a filled commune three lines above "inondation — concerné" is one
  // glance away from being read as the water.
  assert.match(controls.legend[0].blurb, /périmètre administratif/);
  assert.match(controls.legend[0].blurb, /pas l’étendue d’un risque/);
  // Installations come with a masked swatch of their own mark, so the key and
  // the globe show the same shape.
  const drawnClasses = controls.legend.filter((entry) => entry.glyph);
  assert.ok(drawnClasses.length >= 1);
  for (const entry of drawnClasses) {
    assert.match(entry.glyph, /^data:image\/svg\+xml;base64,/);
    assert.ok(Number.isFinite(entry.count) && entry.count > 0, entry.label);
  }
  assert.match(controls.legendNote, /Géorisques — BRGM \/ MTE · Paris · radon classe 1/);
  // A SURFACE FILL, now that the commune is washed: the shell mounts the
  // shared drape sentence from that flag, and over the photorealistic mesh the
  // tint climbs the façades where the tileset's own shading darkens it.
  assert.equal(controls.surfaceFill, true);
});

test('a scan with no outline still keys its verdicts, and vice versa', () => {
  const noContour = { ...PAYLOAD, communeContour: null };
  const controls = georisquesLegend(noContour, null);
  assert.ok(!controls.legend.some((entry) => entry.label.startsWith('Commune de')));
  // And no drape note for a layer that drew no wash this scan — the flag
  // follows the geometry, not the layer.
  assert.equal(controls.surfaceFill, false);
  assert.ok(controls.legend.length > 5);
  // Dormant, or before the first scan: nothing to key, and the manager is told
  // so rather than handed an empty block.
  assert.equal(georisquesLegend(null), null);
  assert.equal(georisquesLegend({ icpe: [], naturalRisks: [], technologicalRisks: [] }), null);
});

test('a class with nothing in it is dropped from the key', () => {
  // "Non Seveso" is a truthy string, and reading it as a boolean painted three
  // of the five captured establishments as Seveso sites. None of them is, so
  // the class must not be in the key at all — printing it at zero teaches a
  // reader to hunt a colour that is not on screen.
  const labels = georisquesLegend(PAYLOAD, null).legend.map((entry) => entry.label);
  assert.ok(!labels.includes('Site Seveso'), labels.join(' | '));
  const seveso = {
    ...PAYLOAD,
    icpe: [...PAYLOAD.icpe, { id: 'x', seveso: true, regime: 'Autorisation', lon: 2.37, lat: 48.83 }],
  };
  assert.ok(georisquesLegend(seveso, null).legend.some((entry) => entry.label === 'Site Seveso'));
});

test('the address standing is what describes the reader, with the commune behind it', () => {
  assert.equal(effectiveStanding({ addressStanding: 'clear', communeStanding: 'concerned' }), 'clear');
  // A hazard graded for the commune and silent for the address still reaches
  // around here; dropping it would under-report.
  assert.equal(effectiveStanding({ addressStanding: null, communeStanding: 'concerned' }), 'concerned');
  assert.equal(effectiveStanding({}), null);
  assert.equal(effectiveStanding(null), null);
});

test('the outline is drawn as closed clamped strokes, one per ring', () => {
  const source = recordingDataSource();
  const drawn = drawCommuneOutline(source, CONTOUR, Cesium.ClassificationType.TERRAIN, 'desc');
  assert.equal(drawn, CONTOUR.parts.length);
  const [ring] = source.added;
  assert.equal(ring.polyline.clampToGround, true);
  assert.equal(ring.polyline.classificationType, Cesium.ClassificationType.TERRAIN);
  // Closed by hand. `fromDegreesArray` draws exactly the vertices it is given,
  // and a decimated ring whose closing vertex was strided away leaves a gash
  // across the commune.
  const positions = ring.polyline.positions;
  assert.equal(positions.length, CONTOUR.parts[0].length / 2 + 1);
  assert.ok(Cesium.Cartesian3.equals(positions[0], positions[positions.length - 1]));
  // The stroke draws the EDGE and nothing else. The interior is
  // `drawCommuneWash`'s, and keeping the two functions apart is what lets the
  // stroke stay a card-carrying object while the wash stays decoration.
  assert.ok(source.added.every((entity) => !entity.polygon));
});

test('the commune is washed, once per ring, in one colour, on the ground', () => {
  const source = recordingDataSource();
  const drawn = drawCommuneWash(source, CONTOUR, Cesium.ClassificationType.CESIUM_3D_TILE);
  assert.equal(drawn, CONTOUR.parts.length);
  assert.equal(source.added.length, CONTOUR.parts.length);

  for (const entity of source.added) {
    const { polygon } = entity;
    assert.ok(polygon, 'the wash is a polygon');
    // Ground classification, which is the whole point: no `height` and no
    // `perPositionHeight`, or Cesium builds an ordinary primitive and then
    // ignores the surface it was told to land on, in silence.
    assert.equal(polygon.height, undefined);
    assert.equal(polygon.perPositionHeight, undefined);
    assert.equal(polygon.classificationType, Cesium.ClassificationType.CESIUM_3D_TILE);
    assert.equal(polygon.outline, false);
    // The closing vertex is the stroke's problem, not the polygon's: a
    // hierarchy is closed by definition and a duplicated last point buys a
    // degenerate triangle.
    const ring = polygon.hierarchy.positions;
    assert.ok(!Cesium.Cartesian3.equals(ring[0], ring[ring.length - 1]));
  }

  // ONE COLOUR for every part, which is honest cartography (no composite score
  // exists to ramp it by) and separately what keeps a batched GroundPrimitive
  // correct — see `qa-cadastre-highlight.mjs` for what differing colours in
  // one batch do to each other along bounding-rectangle edges.
  const colours = new Set(source.added.map((entity) => entity.polygon.material.toCssColorString()));
  assert.equal(colours.size, 1);
  const [css] = [...colours];
  assert.equal(
    css,
    Cesium.Color.fromCssColorString('#6fd3e8').withAlpha(COMMUNE_FILL_ALPHA).toCssColorString(),
  );

  // ANONYMOUS BY CONSTRUCTION. A card here would cover half the frame with a
  // click target, and the contract `registerPickDecoration` asks for is that
  // there is nothing a reader could have meant by clicking it.
  for (const entity of source.added) {
    assert.equal(entity.name, undefined);
    assert.equal(entity.description, undefined);
    assert.equal(entity.properties, undefined);
  }
});

test('a click on the wash is a click on the MAP, for every sibling layer', () => {
  // The regression this prevents: a ground-classified fill IS pickable —
  // `delinquanceFrance.js` selects a commune by clicking one — so a wash the
  // size of a commune would have made every sibling's ground click and every
  // card dismissal inside that commune resolve to `ignore`.
  const source = recordingDataSource();
  drawCommuneWash(source, CONTOUR, Cesium.ClassificationType.TERRAIN);
  const washId = source.added[0].id;
  assert.ok(isCommuneWashId(washId), washId);
  // Shaped like a real Cesium entity pick: `picked.id` is the Entity.
  assert.equal(isWorldPick({ id: { id: washId } }), true);
  assert.equal(isWorldPick({ id: washId }), true);
  // And the outline, which DOES carry the commune's card, is not swept up in
  // it. Its own id is the neighbouring one, and the substring test has to tell
  // them apart.
  const strokes = recordingDataSource();
  drawCommuneOutline(strokes, CONTOUR, Cesium.ClassificationType.TERRAIN, 'desc');
  assert.equal(isCommuneWashId(strokes.added[0].id), false);
  assert.equal(isWorldPick({ id: { id: strokes.added[0].id } }), false);
  assert.equal(isCommuneWashId('georisques:icpe:0123.45678'), false);
  assert.equal(isCommuneWashId(null), false);
});

test('the mark is measured where it is READ, not at the near end of its ramp', () => {
  // The complaint's own view: Bassussarry, 5 859 m. The mark was 15.9 px there
  // while `SIZE_ICPE_PX` said 24, because Cesium interpolates a NearFarScalar
  // against SQUARED distance and then raises t to the power 0.2 — so the far
  // value owns nearly the whole band and the near one is almost decorative.
  const icpe = markPixelsAtDistance(34, 5859);
  assert.ok(icpe > 28 && icpe < 30, `${icpe}`);
  // The floor of the family — a declassified site — stays findable across the
  // whole band, from a rooftop to the 12 km dormancy ceiling.
  for (const distance of [200, 900, 3000, 5859, 12_000, 40_000]) {
    assert.ok(markPixelsAtDistance(28, distance) >= 22, `${distance} m`);
  }
  // Full size at the near end, and never above it: a mark that grows past its
  // authored size is a mark drawn from a raster that cannot afford it.
  assert.equal(markPixelsAtDistance(34, 400), 34);
  assert.equal(markPixelsAtDistance(34, 0), 34);
  // And the old ramp is what the fix is measured against, in one line.
  assert.ok(markPixelsAtDistance(34, 5859) > 15.9 * 1.8);
});

test('a ring too short to be a shape is skipped rather than drawn as a spike', () => {
  const source = recordingDataSource();
  const drawn = drawCommuneOutline(
    source,
    { code: '99999', name: 'Nulle part', parts: [[1, 2], [1, 2, 3, 4, 5, 6, 7, 8]] },
    Cesium.ClassificationType.TERRAIN,
    'desc',
  );
  assert.equal(drawn, 1);
  assert.equal(source.added.length, 1);
});

test('the outline card says what the trait is, and what it is not', () => {
  const text = communeDescription(PAYLOAD, CONTOUR);
  assert.match(text, /^Commune de Paris 13e Arrondissement \(75113\)/);
  // The commune verdicts, counted and named — the reason the shape is there.
  assert.match(text, /risques recensés sur la commune/);
  // The two disclosures a legal boundary redrawn at 64 vertices owes a reader.
  assert.match(text, /verdicts diffèrent entre la commune et l’adresse scannée/);
  assert.match(text, /contour simplifié pour l’affichage/);
  assert.match(text, /la surbrillance porte la commune, pas la zone exposée/);
});

test('the stroke classifies onto whichever surface is actually drawn', () => {
  // A hidden globe means the photorealistic tileset is the only surface left,
  // and a stroke classified onto TERRAIN there lands on nothing.
  assert.equal(
    communeClassificationTypeForScene({ globe: { show: false } }),
    Cesium.ClassificationType.CESIUM_3D_TILE,
  );
  assert.equal(
    communeClassificationTypeForScene({ globe: { show: true } }),
    Cesium.ClassificationType.TERRAIN,
  );
  assert.equal(communeClassificationTypeForScene(null), Cesium.ClassificationType.BOTH);
});

test('a hazard checked and absent lands in the tail, not in nowhere', () => {
  // `present: false` comes back with BOTH verdicts null, so a classifier that
  // switches on the standing alone drops it from every bucket. Nine of the
  // eighteen hazards on the captured 13e scan are exactly that, and they are
  // the whole population of the tail line.
  assert.equal(legendBucket({ present: false, communeStanding: null, addressStanding: null }), 'settled');
  assert.equal(legendBucket({ present: true, addressStanding: 'concerned' }), 'concerned');
  assert.equal(legendBucket({ present: true, addressStanding: 'unknown' }), 'unknown');
  // Disagreement outranks "unknown": that the two verdicts differ is the more
  // actionable of the two facts, and the label has room for one.
  assert.equal(legendBucket({ addressStanding: 'unknown', variesByAddress: true }), 'varying');
  assert.equal(legendBucket({ addressStanding: 'clear', variesByAddress: true }), 'varying');
  // An unexplained positive is never summarised as "nothing here".
  assert.equal(legendBucket({ present: true, communeStanding: null, addressStanding: null }), 'unknown');

  const tail = georisquesLegend(PAYLOAD, null).legend.at(-1);
  assert.equal(tail.label, '9 autres aléas vérifiés — hors zone');
});

test('a silent hazard register says so, instead of looking like a clear address', () => {
  // Measured live on 2026-09-14: `resultats_rapport_risque` refused every
  // connection for a whole session while `installations_classees` and `radon`
  // kept answering. The layer drew a commune, 31 establishments — and nothing
  // where the flood verdict goes. Without a line saying why, "the register is
  // down" and "nothing reaches this address" are the same picture.
  const outage = projectGeorisques({
    report: null,
    icpe: read('georisques-icpe-sample.json'),
    radon: read('georisques-radon-sample.json'),
    contour: CONTOUR,
    inseeCode: '75113',
    origin: ORIGIN,
    radiusM: 1000,
  });
  assert.equal(outage.available.report, false);
  const controls = georisquesLegend(outage, null);
  const tail = controls.legend.at(-1);
  assert.equal(tail.label, 'Aléas indisponibles');
  assert.equal(tail.color, null);
  assert.match(tail.blurb, /n’est pas la même chose qu’absents/);
  // The establishments are still keyed: one upstream failing degrades one act.
  assert.ok(controls.legend.some((entry) => entry.label.startsWith('Installation classée')));
  assert.ok(controls.legend.some((entry) => entry.label.startsWith('Commune de')));

  // And a scan where the register DID answer carries no such line.
  assert.ok(!georisquesLegend(PAYLOAD, null).legend.some((entry) => entry.label === 'Aléas indisponibles'));
});
