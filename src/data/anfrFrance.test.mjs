// What the DRAWN layer is allowed to claim, once the feed's fold and the
// mesh's thinning have already been proved.
//
// ONE property runs through the whole file, and it is the one the register
// makes easy to get wrong: **a mast that has never transmitted must never be
// presentable as a mast that transmits.** `Projet approuvé` is 8.05 % of the
// observatoire (66 508 of 826 418 rows, re-counted 2026-09-02) and 3 638
// supports carry nothing else. Each test below shuts one door an approved
// project could come through: the fill, the ring, the DETECT callout, the row
// label, the legend and the card.
//
// The second property is that the two channels never impersonate each other.
// Colour is the newest generation that RADIATES; size is how many operators
// are on the mast. Neither is ever a stand-in for the other, and neither is
// ever silently absent — a support with no readable height says so, a maillage
// dot that cannot draw the upgrade ring says so, and a Cartoradio card that
// has not arrived says so instead of leaving the address out.
//
// The third is that this layer's ids are SUP_ID-keyed. 952 of the 72 700
// supports share a five-decimal coordinate with another (measured on the real
// register), so a coordinate-keyed record map would drop them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import anfrFranceLayer, {
  ANFR_BAND_COLORS,
  ANFR_FR_LAYER_ID,
  ANFR_FR_OVERLAY_SOURCE_ID,
  ANFR_MAST_ENTER_SPAN_DEG,
  ANFR_MAST_EXIT_SPAN_DEG,
  ANFR_MAX_BOX_DEG,
  ANFR_SECTOR_RAY_M,
  anfrAzimuthLines,
  anfrBandColor,
  anfrCardinal,
  anfrExposureLines,
  anfrFiveGBandLabel,
  anfrMastBandsMhz,
  anfrMhzLabel,
  anfrOperatorName,
  anfrOperatorShort,
  anfrOperatorSummaryLine,
  anfrPlacementLine,
  anfrPlainAddress,
  anfrPlainText,
  anfrShortBand,
  anfrShortMonth,
  anfrMastHeightM,
  anfrMastLegend,
  anfrMastRegime,
  anfrSectorRays,
  anfrDetailLines,
  anfrEditionLabel,
  anfrFrenchDate,
  anfrHasPlannedUpgrade,
  anfrMeshStyle,
  anfrMeshRecordId,
  anfrPlanLine,
  anfrPointSize,
  anfrSupportId,
  anfrSupportStyle,
  anfrViewSpanDeg,
  buildAnfrLoadingLabel,
  buildAnfrMeshLabel,
  buildAnfrSelectionLabel,
  cameraAnfrBox,
  cameraAnfrMeshBox,
  createAnfrSelectedOverlayEntry,
  pickAnfrSupportsAt,
  _anfrDetectablesForTest,
  _anfrMastTallyForTest,
  _anfrRecordForTest,
  _anfrRowControlsForTest,
  _anfrSelectedIdForTest,
  _anfrStatsForTest,
  _clearAnfrSelectionForTest,
  _loadAnfrViewportForTest,
  _selectAnfrForTest,
  _setAnfrStateForTest,
} from './anfrFrance.js';
import {
  ANFR_GENERATIONS,
  ANFR_HEIGHTLESS_NATURES,
  ANFR_HEIGHT_MISSING,
  ANFR_ID,
  ANFR_LAT,
  ANFR_LON,
  ANFR_NAT,
  ANFR_HAUT,
  ANFR_OPS,
  ANFR_PLAN,
  ANFR_SVC,
  ANFR_LIVE,
  ANFR_SYS,
  anfrCsvColumns,
  anfrDecodeMask,
  anfrDistanceM,
  parseAnfrNatureTable,
  projectAnfrSupports,
  projectCartoradioAntennas,
  projectCartoradioExposure,
  projectCartoradioSupport,
  readAnfrCsvRow,
} from './anfrFeed.js';
import { buildAnfrMesh, selectAnfrMesh } from './anfrMesh.js';

// Cesium reads the aliased line-width range off a live WebGL context, and
// there is none under `node --test`, so `ContextLimits._maximumAliasedLineWidth`
// sits at 0 and every `RenderState.fromCache` throws "renderState.lineWidth is
// out of range". This layer draws points rather than lines, but the primitive
// it seats them in shares the render-state cache, and priming the limit is a
// property of the harness rather than of the layer.
const { default: ContextLimits } = await import('@cesium/engine/Source/Renderer/ContextLimits.js');
ContextLimits._maximumAliasedLineWidth = 16;

// The shafts and the azimuth rays are polylines, and a polyline carries a
// `Material`. Cesium types a material uniform by testing it against the DOM
// image classes — `uniformValue instanceof HTMLCanvasElement` and friends,
// `Material.js:1262` — and under `node --test` those identifiers do not exist,
// so a bare `Material.fromType('Color', …)` throws a ReferenceError before it
// ever reaches a GPU. Declaring the four names is a property of the harness,
// exactly like the aliased line width above: nothing here is ever an instance
// of them, so the `instanceof` chain falls through to the object branch that
// the colour and dash uniforms actually belong in.
for (const name of ['HTMLCanvasElement', 'HTMLImageElement', 'ImageBitmap', 'OffscreenCanvas']) {
  if (!(name in globalThis)) globalThis[name] = class {};
}

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const norm = (value) => String(value).replace(/[\s ]+/g, ' ');

const OBSERVATOIRE = read('anfr-observatoire-sample.json');
const NATURE = read('anfr-nature-sample.json');
const CARTORADIO = read('anfr-cartoradio-sample.json');

const LINES = OBSERVATOIRE.csv.split('\n');
const COLUMNS = anfrCsvColumns(LINES[0]);
const ROWS = LINES.slice(1).filter(Boolean).map((line) => readAnfrCsvRow(line, COLUMNS));
const FOLD = projectAnfrSupports({
  rows: ROWS, natures: parseAnfrNatureTable(NATURE.text), edition: OBSERVATOIRE.edition,
});

/** Exactly what the `/supports` route serves: masks decoded to labels. */
const SUPPORTS = FOLD.supports.map((row) => ({
  id: row[ANFR_ID],
  lat: row[ANFR_LAT],
  lon: row[ANFR_LON],
  svc: row[ANFR_SVC],
  live: row[ANFR_LIVE],
  plan: row[ANFR_PLAN],
  operators: anfrDecodeMask(row[ANFR_OPS], FOLD.operators),
  systems: anfrDecodeMask(row[ANFR_SYS], FOLD.systems),
  nature: FOLD.natures[String(row[ANFR_NAT])] || null,
  heightM: row[ANFR_HAUT],
}));
const NATIONAL = {
  count: FOLD.count,
  live: FOLD.live,
  projectOnly: FOLD.projectOnly,
  plannedUpgrades: FOLD.plannedUpgrades,
  bands: FOLD.bands,
  generations: FOLD.generations,
};
const PACK = {
  supports: SUPPORTS,
  count: SUPPORTS.length,
  inBox: SUPPORTS.length,
  truncated: false,
  edition: OBSERVATOIRE.edition,
  source: FOLD.source,
  national: NATIONAL,
  fetchedAt: 1_767_000_000_000,
};
const MESH_TUPLES = buildAnfrMesh(FOLD.supports);
const MESH_PAYLOAD = {
  mesh: MESH_TUPLES,
  ...NATIONAL,
  edition: OBSERVATOIRE.edition,
  source: FOLD.source,
  fetchedAt: 1_767_000_000_000,
};
const ANTENNAS = projectCartoradioAntennas(CARTORADIO.antennes.body);
const DETAIL = {
  supId: CARTORADIO.supId,
  site: projectCartoradioSupport(CARTORADIO.site.body),
  antennas: ANTENNAS,
  exposure: projectCartoradioExposure({
    mesures: CARTORADIO.mesures.body,
    report: CARTORADIO.mesure.body,
    lat: 48.85528,
    lon: 2.33167,
    newestService: ANTENNAS.newestService,
  }),
};

const support = (id) => SUPPORTS.find((row) => row.id === id);
const makeHost = () => {
  const host = {
    entries: null,
    visible: new Map(),
    setEntries(sourceId, entries) { host.entries = entries; },
    setVisible(sourceId, value) { host.visible.set(sourceId, value); },
    clearSource() { host.entries = null; },
  };
  return host;
};
const fakeViewer = (west, south, east, north) => ({
  camera: { computeViewRectangle: () => Cesium.Rectangle.fromDegrees(west, south, east, north) },
  scene: { requestRender() {} },
});

test('the layer object satisfies the manager contract it is registered under', () => {
  assert.equal(anfrFranceLayer.id, ANFR_FR_LAYER_ID);
  assert.equal(ANFR_FR_LAYER_ID, 'anfr-fr');
  assert.match(anfrFranceLayer.id, /^[a-z0-9-]+$/);
  assert.equal(anfrFranceLayer.name, 'Antennes mobiles (ANFR)');
  // NOT the ≋ of the RÉSEAUX & CAPTEURS shelf, and not anything the `radio`
  // row (internet audio streams) could be mistaken for.
  assert.equal(anfrFranceLayer.icon, '📡');
  assert.equal(typeof anfrFranceLayer.source, 'string');
  for (const method of ['init', 'enable', 'disable', 'update', 'getStats', 'getRowControls', 'getDetectableObjects', 'destroy']) {
    assert.equal(typeof anfrFranceLayer[method], 'function', method);
  }
  // The register is rebuilt weekly; the poll must not pretend otherwise.
  assert.ok(anfrFranceLayer.updateInterval >= 60 * 60_000);
});

test('the fill is the newest generation that RADIATES, and a project has none', () => {
  // 278838: eight rows, every one "Projet approuvé", across 2G/3G/4G.
  const planned = anfrSupportStyle(support(278838));
  assert.equal(planned.band, 'projet');
  assert.equal(planned.hollow, true);
  assert.equal(planned.ringed, true);
  assert.ok(planned.alpha < 0.2, 'a project is drawn hollow, not filled');
  assert.equal(planned.color, ANFR_BAND_COLORS.projet);

  // 449714: 5G technically operational over 2G/3G/4G in service.
  const live = anfrSupportStyle(support(449714));
  assert.equal(live.band, '5g');
  assert.equal(live.hollow, false);
  assert.equal(live.alpha, 1);
  assert.equal(live.color, ANFR_BAND_COLORS['5g']);

  // 325857: 3G and 4G, nothing newer.
  assert.equal(anfrSupportStyle(support(325857)).band, '4g');
  // Whatever the plan mask holds, it never reaches the fill.
  for (const row of SUPPORTS) {
    const withoutPlan = anfrSupportStyle({ ...row, plan: 0 });
    assert.equal(anfrSupportStyle(row).band, withoutPlan.band, `support ${row.id}`);
  }
});

test('the pale ring means one thing: an approved project is on file here', () => {
  // 506104 radiates 2G/3G/4G and has 5G approved — the ring is on a filled dot.
  const upgrade = anfrSupportStyle(support(506104));
  assert.equal(upgrade.ringed, true);
  assert.equal(upgrade.hollow, false);
  assert.equal(anfrHasPlannedUpgrade(support(506104)), true);

  // 449714 has a project filed on 5G, which it ALREADY radiates. That is
  // paperwork, not an upgrade, and it earns no ring — 11 830 of the 15 606
  // live supports with a project on file are exactly this case.
  assert.notEqual(support(449714).plan, 0);
  assert.equal(anfrHasPlannedUpgrade(support(449714)), false);
  assert.equal(anfrSupportStyle(support(449714)).ringed, false);

  // 22132 has no project at all.
  assert.equal(support(22132).plan, 0);
  assert.equal(anfrSupportStyle(support(22132)).ringed, false);
  assert.equal(anfrHasPlannedUpgrade({}), false);
});

test('the size is the operator count, capped at the one five-operator mast', () => {
  assert.equal(anfrPointSize(0), anfrPointSize(1));
  assert.ok(anfrPointSize(2) > anfrPointSize(1));
  assert.ok(anfrPointSize(4) > anfrPointSize(3));
  assert.equal(anfrPointSize(5), anfrPointSize(9), 'five is the measured maximum');
  assert.equal(anfrPointSize(null), anfrPointSize(1));
  // The channel is read off the resolved operator list, so the card and the
  // dot cannot disagree.
  assert.equal(anfrSupportStyle(support(506104)).operators, 5);
  assert.equal(anfrSupportStyle(support(506104)).sizePx, anfrPointSize(5));
  assert.equal(anfrSupportStyle(support(325857)).operators, 1);
});

test('the maillage draws the hollow ring and says which ring it cannot draw', () => {
  const byPosition = new Map(MESH_TUPLES.map((t) => [`${t[0]},${t[1]}`, t]));
  const plannedTuple = byPosition.get(`${support(278838).lat},${support(278838).lon}`);
  const style = anfrMeshStyle(plannedTuple);
  assert.equal(style.band, 'projet');
  assert.equal(style.hollow, true);
  assert.equal(style.ringed, true);

  // 506104's upgrade ring CANNOT be drawn from a tuple — there is no plan mask
  // in it — so the maillage draws it as an ordinary 4G dot and the row label
  // is what tells the reader the rings are missing at this zoom.
  const upgradeTuple = byPosition.get(`${support(506104).lat},${support(506104).lon}`);
  assert.equal(anfrMeshStyle(upgradeTuple).ringed, false);
  const label = buildAnfrLoadingLabel({
    regime: 'maillage',
    status: 'ready',
    loading: false,
    count: 6,
    inView: 15,
    national: NATIONAL,
    pick: { thinned: true },
  });
  assert.match(norm(label), /6 points pour 15 supports dans la vue/);
  assert.match(norm(label), /15 en France/);
  assert.match(norm(label), /projets d’extension visibles seulement en zoom/);
});

test('records are keyed by SUP_ID, so two masts on one lattice point both survive', () => {
  const host = makeHost();
  const coSited = [
    { ...support(449714), id: 900001 },
    { ...support(449714), id: 900002 },
  ];
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9),
    overlayHost: host,
    pack: { ...PACK, supports: coSited, count: 2, inBox: 2 },
  });
  assert.equal(_anfrStatsForTest().count, 2);
  assert.ok(_anfrRecordForTest(anfrSupportId(900001)));
  assert.ok(_anfrRecordForTest(anfrSupportId(900002)));
  assert.equal(anfrSupportId(900001), 'anfr-fr:900001');
  // A mesh id is namespaced apart, because it is a position and not an identity.
  assert.equal(anfrMeshRecordId([48.85528, 2.33167, 4, 4]), 'anfr-fr:mesh:48.85528,2.33167');
  // pickAnfrSupportsAt returns BOTH, ordered, so the card can name the co-siting.
  const here = pickAnfrSupportsAt(coSited, 48.85528, 2.33167);
  assert.equal(here.length, 2);
  assert.deepEqual(here.map((row) => row.id), [900001, 900002]);
  assert.deepEqual(pickAnfrSupportsAt(coSited, 0, 0), []);
  assert.deepEqual(pickAnfrSupportsAt(null, 0, 0), []);
  _clearAnfrSelectionForTest();
});

test('a register-wide filing convention is not news about one mast', () => {
  // Measured over the whole file: every technically-operational row is 5G and
  // no 5G row is ever "En service". That is how ANFR files 5G nationally, not
  // a fact about the mast under the cursor — so the card used to carry a
  // caveat that fired on every 5G mast in France, which reads as a caveat
  // about THAT mast. The distinction stays in the DATA and leaves the copy.
  for (const row of SUPPORTS) {
    const fiveG = Boolean(row.live & (1 << ANFR_GENERATIONS.indexOf('5G')));
    assert.equal(Boolean(row.live & ~row.svc), fiveG, `support ${row.id}`);
  }
  const copy = norm(buildAnfrSelectionLabel({ support: support(449714) }, PACK));
  assert.doesNotMatch(copy, /Techniquement opérationnel|déclarée ouverte au public/);
  // Colour still reads `live`, which is the channel the distinction feeds.
  assert.equal(anfrSupportStyle(support(449714)).band, '5g');

  // Nothing anywhere on the card promises a speed, a coverage or a verdict —
  // the three questions people arrive with that this register cannot answer.
  for (const row of SUPPORTS) {
    const card = norm(buildAnfrSelectionLabel({ support: row, detail: DETAIL }, PACK));
    assert.doesNotMatch(card, /débit|Mb\/s|couvert|sans danger|inoffensif|sans risque/i, `support ${row.id}`);
  }
});

test('the plan line distinguishes an upgrade from a re-filing', () => {
  // `Projet approuvé` is the register's phrase and it is the single most
  // misread field in this dataset — 8.05 % of the file, and a reader who takes
  // it for a transmitter has been misled. The card says what it IS.
  assert.match(anfrPlanLine(support(506104)), /^5G autorisée en plus — pas encore installée$/);
  assert.match(anfrPlanLine(support(278838)), /^4G · 3G · 2G autorisées ici — rien n’a encore été installé$/);
  // A RE-FILING TAKES NO LINE: an operator lodging a dossier for a band
  // already on the air is paperwork, true of 11 830 of the 15 606 live
  // supports that carry a project. The ring on the dot already says somebody
  // filed something; a line saying nothing changed is what a compact card
  // exists to remove.
  assert.equal(anfrPlanLine(support(449714)), null);
  assert.equal(anfrPlanLine(support(22132)), null);
  assert.equal(anfrPlanLine({}), null);
});

test('the selection card leads with the question people arrive with', () => {
  const raw = buildAnfrSelectionLabel({ support: support(449714), detail: DETAIL }, PACK);
  const copy = norm(raw);
  const lines = raw.split('\n').map(norm);
  // The title is what it is and whether it matters. The SUP_ID used to lead
  // and now closes: it is the one field nobody arrived wanting, and it is
  // still printed because it is the handle for every other ANFR tool.
  assert.equal(lines[0], 'Antenne-relais · 4 opérateurs · 5G');
  assert.match(lines.at(-1), /^ANFR n° 449714 · registre du 27 août 2026 · Licence Ouverte 2\.0$/);
  assert.match(copy, /Toit d’immeuble, 65 m/);

  // NINE LINES, and the four operators share ONE of them. Every French mast
  // where the operators file the same ladder — the great majority — used to
  // spend four lines repeating one fact.
  assert.equal(lines.length, 9);
  assert.match(copy, /5G 3,5 GHz et 4G : les 4 opérateurs · 3G et 2G : Orange et SFR/);
  // Names are not shouted, and the whole register is on the card: nothing is
  // hidden behind a `+n`.
  assert.doesNotMatch(copy, /FREE MOBILE|BOUYGUES TELECOM/);
  assert.doesNotMatch(copy, /\+\d+ systèmes/);
  // The owner of the ground, expanded out of the register's paper-form codes.
  assert.match(copy, /Propriétaire : Établissement public, Ministère, Syndicat mixte/);

  // 325857 publishes a height of 0, which is not a height.
  // 325857 publishes a height of 0 and is an `Intérieur galerie` — and those
  // two facts are the SAME fact: all 551 heightless supports in the register
  // are underground or indoor, so the card explains the missing shaft rather
  // than printing a hole where a number should be.
  const zeroHeight = norm(buildAnfrSelectionLabel({ support: support(325857) }, PACK));
  assert.match(zeroHeight, /Installation souterraine \(intérieur galerie\) — aucun mât/);
  assert.match(zeroHeight, /Aucun fût dessiné : 551 supports du registre ne publient pas de hauteur/);
  assert.doesNotMatch(zeroHeight, /de 0 m/);

  // A support that radiates nothing says so, and never as "5G".
  const planned = norm(buildAnfrSelectionLabel({ support: support(278838) }, PACK));
  assert.match(planned, /^Antenne-relais · \d+ opérateurs? · rien n’émet/);
  assert.match(planned, /Rien n’émet à cette position/);
  assert.doesNotMatch(planned, /en service/);
});

test('the plain-French pass expands the register without re-casing a real name', () => {
  assert.equal(anfrOperatorName('FREE MOBILE'), 'Free Mobile');
  assert.equal(anfrOperatorName('SFR'), 'SFR');
  assert.equal(anfrOperatorName(''), '');
  // ANFR files addresses on a paper form, in capitals and truncations.
  assert.equal(anfrPlainText('30 R PETRICOT RES HORIZON'), '30 rue Petricot résidence Horizon');
  assert.equal(anfrPlainText('PARIS 6E ARRONDISSEMENT'), 'Paris 6e Arrondissement');
  // Mixed case upstream is a name somebody typed: expand, never re-case.
  assert.equal(anfrPlainText('Ets public , Minist, Synd mixt'), 'Établissement public, Ministère, Syndicat mixte');
  assert.equal(anfrPlainText("Lieu d'habitation"), 'Lieu d’habitation');
  assert.equal(anfrPlainText(null), '');

  // A band is a NAME, not a quantity: no thousands separator, and 3500 is the
  // only one France says in gigahertz.
  assert.equal(anfrMhzLabel(1800), '1800 MHz');
  assert.equal(anfrMhzLabel(3500), '3,5 GHz');
  assert.equal(anfrMhzLabel('nope'), null);
  // The rung, never a speed — the register has no throughput column.
  assert.equal(anfrFiveGBandLabel(3500), 'rapide');
  assert.equal(anfrFiveGBandLabel(2100), 'moyenne');
  assert.equal(anfrFiveGBandLabel(700), 'basse');
  assert.equal(anfrCardinal(0), 'N');
  assert.equal(anfrCardinal(140), 'SE');
  assert.equal(anfrCardinal(-90), 'O');
  assert.equal(anfrCardinal(NaN), null);

  // The preposition is the whole point: a rooftop and a tower in a field are
  // different objects and a bare noun does not say which.
  assert.equal(anfrPlacementLine('Immeuble', 35), 'Toit d’immeuble, 35 m');
  assert.equal(anfrPlacementLine('Bâtiment', 12), 'Toit de bâtiment, 12 m');
  assert.equal(anfrPlacementLine('Pylône autostable', 42), 'Pylône autostable, 42 m');
  assert.match(anfrPlacementLine('Intérieur sous-terrain', null), /^Installation souterraine/);
  assert.equal(anfrPlacementLine('Mobilier urbain', 6), 'Sur mobilier urbain, 6 m');
  assert.equal(anfrPlacementLine(null, null), 'Nature et hauteur non publiées');

  // The brand, not the corporate name — only where four names share a line.
  assert.equal(anfrOperatorShort('FREE MOBILE'), 'Free');
  assert.equal(anfrOperatorShort('BOUYGUES TELECOM'), 'Bouygues');
  assert.equal(anfrOperatorShort('SFR'), 'SFR');
  assert.equal(anfrShortBand('TM 700 (Téléphonie Mobile en 700 MHz)'), '700 MHz');
  assert.equal(anfrShortBand('Réseaux locaux radioélectriques ou Wifi'), 'Wi-Fi');
  assert.equal(anfrShortMonth('2025-07-18'), '07/2025');
  assert.equal(anfrShortMonth(null), 'date inconnue');
  // The postcode and `Arrondissement` are dropped: both are redundant once
  // the commune is named, and the card wraps at about 62 characters.
  assert.equal(
    anfrPlainAddress({ address: '30 R PETRICOT', postcode: '64200', commune: 'BIARRITZ' }),
    '30 rue Petricot, Biarritz',
  );
  assert.equal(
    anfrPlainAddress({ address: '9 R DE GRENELLE', postcode: '75007', commune: 'PARIS 7E ARRONDISSEMENT' }),
    '9 rue de Grenelle, Paris 7e',
  );
});

test('the Cartoradio half is labelled while it is missing, not silently omitted', () => {
  const pending = buildAnfrSelectionLabel({ support: support(449714), detailPending: true }, PACK);
  assert.match(norm(pending), /Lecture de la fiche détaillée du mât…/);
  const failed = buildAnfrSelectionLabel(
    { support: support(449714), detailError: 'HTTP 503' }, PACK,
  );
  assert.match(norm(failed), /⚠ Fiche détaillée indisponible — HTTP 503/);
  // A card with neither says nothing about an address it does not have — and
  // still answers the operator question from the observatoire's own list,
  // because "who is on this mast" is the reason the reader clicked and a
  // pending fiche is not a reason to leave it blank.
  const bare = norm(buildAnfrSelectionLabel({ support: support(449714) }, PACK));
  assert.match(bare, /Bouygues Telecom, Free Mobile, Orange, SFR/);
  assert.match(bare, /Émet en 5G · 4G · 3G · 2G/);
  assert.doesNotMatch(bare, /appartenant à/);
  assert.doesNotMatch(bare, /V\/m/);
  assert.doesNotMatch(bare, /· modifié /);
});

test('the exposure block is two lines, a scale and one caveat', () => {
  const lines = anfrDetailLines(DETAIL).map(norm);
  const joined = lines.join('\n');
  // The mobile antenna count and the three microwave dishes share ONE line,
  // because the second is a correction to the first and reads as one only
  // while it is beside it.
  assert.match(joined, /^30 antennes, 12 directions, 31 à 49 m du sol · \+3 FH hors téléphonie$/m);
  // Heights are rounded to the metre: the register publishes 30,9 and 48,8
  // and the tenths are precision the reader cannot use.
  assert.doesNotMatch(joined, /30,9|48,8/);
  // The ray-length convention is NOT repeated here — `anfrMastLegend` carries
  // it on the legend row that appears with the rays.
  assert.doesNotMatch(joined, /ni la largeur du faisceau/);

  // 0,0 V/m measured in 2009, forty metres away, beside equipment from 2025.
  // A global of zero is the protocol's floor and is never headlined as a
  // reassuring number: the strongest band carries the real reading.
  assert.match(joined, /^Champ global sous le seuil mesurable, à 40 m \(2009\), pic : 1800 MHz à 0,15 V\/m$/m);
  // THE SHARP LINE. A 2009 protocol has no row at all for 700, 800, 2600 or
  // 3600 — three of those four bands were not yet mobile in France — so the
  // 5G and the low-band 4G on this mast are UNMEASURED, not measured at zero.
  assert.match(joined, /^⚠ Relevé chez un voisin, 2009 — 700 MHz, 800 MHz, 2600 MHz, 3,5 GHz jamais mesurés$/m);
  assert.deepEqual(anfrMastBandsMhz(DETAIL), [700, 800, 900, 1800, 2100, 2600, 3500]);
  assert.deepEqual(anfrMastBandsMhz(null), []);

  // A RECENT report: TWO lines, a number with a scale and one caveat.
  const recent = {
    ...DETAIL,
    exposure: projectCartoradioExposure({
      mesures: CARTORADIO.mesures.body,
      report: CARTORADIO.mesureRecente.body,
      lat: 48.85528,
      lon: 2.33167,
      newestService: ANTENNAS.newestService,
    }),
  };
  const fresh = anfrExposureLines(recent).map(norm);
  assert.equal(fresh.length, 2);
  // 0,55 V/m against the strictest ceiling in its own report, 28 V/m. "51×
  // sous la limite" rather than "2 % de la limite": the same fact, and a
  // frightened reader reads a multiple faster than a percentage.
  assert.equal(fresh[0], '0,55 V/m à 40 m (2024) — 51× sous la limite (28 V/m), pic : 700 MHz');
  assert.equal(fresh[1], '⚠ Relevé chez un voisin, antérieur à l’équipement de 07/2025');
  // A ratio is not a verdict: the block never says a level is safe, and never
  // says the mast is the source of what was measured.
  assert.doesNotMatch(fresh.join('\n'), /sans danger|conforme aux normes|aucun risque/i);

  // No measurement in the radius is stated, not left blank.
  const empty = anfrDetailLines({ ...DETAIL, exposure: { within: 0, radiusM: 300, nearest: null, report: null } });
  assert.match(norm(empty.join('\n')), /Aucun relevé d’ondes publié dans 300 m autour de ce mât/);
  assert.deepEqual(anfrDetailLines(null), []);
  assert.deepEqual(anfrExposureLines(null), []);

  // A SUP_ID Cartoradio does not hold answers HTTP 200 with a ZERO-byte body
  // (measured against /sites/999999999), so the proxy hands back a card with
  // nothing in it. That is named rather than left as an empty half.
  const mute = anfrDetailLines({
    supId: 999999999, site: null, antennas: null, exposure: null,
    degraded: ['fiche support (empty upstream body)'],
  });
  assert.deepEqual(mute.map(norm), ['⚠ Fiche détaillée muette sur : fiche support (empty upstream body)']);
  assert.equal(anfrFrenchDate('2025-07-18'), '18/07/2025');
  assert.equal(anfrFrenchDate('18/07/2025'), null);
  assert.equal(anfrEditionLabel('2026-08-27'), '27 août 2026');
  assert.equal(anfrEditionLabel('nope'), null);
});

test('the maillage card is never a placeholder, and names which half it is showing', () => {
  const tuple = MESH_TUPLES.find((t) => t[3] === 4);
  const first = norm(buildAnfrMeshLabel({ tuple }, { edition: '2026-08-27' }));
  assert.match(first, /^Antenne-relais/);
  assert.match(first, /5G en service/);
  assert.match(first, /opérateurs? déclarés?/);
  // The far zoom cannot reach the per-mast fiche, so it says what the reader
  // gets by coming closer instead of leaving the card looking complete.
  assert.match(first, /Approchez pour la fiche du mât : opérateurs, bandes et relevé d’ondes/);
  assert.match(first, /Vue d’ensemble — un point par cellule · registre du 27 août 2026/);

  assert.match(norm(buildAnfrMeshLabel({ tuple, lookupPending: true })), /Lecture du mât dans le registre…/);
  assert.match(norm(buildAnfrMeshLabel({ tuple, lookupError: 'HTTP 500' })), /⚠ Registre injoignable pour ce point — HTTP 500/);
  assert.match(norm(buildAnfrMeshLabel({ tuple, lookupEmpty: true })), /⚠ Aucun mât du registre à cette position exacte/);
});

test('selecting a support runs the production path and publishes one protected card', async () => {
  const host = makeHost();
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => DETAIL };
  };
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK, http,
  });
  const id = anfrSupportId(449714);
  _selectAnfrForTest(id);
  assert.equal(_anfrSelectedIdForTest(), id);
  assert.equal(host.entries.length, 1);
  const entry = host.entries[0];
  assert.equal(entry.id, id);
  assert.equal(entry.protected, true);
  assert.equal(entry.selected, true);
  assert.equal(entry.priority, Number.MAX_SAFE_INTEGER);
  assert.match(norm(entry.title), /^Antenne-relais · 4 opérateurs · 5G$/);

  // The Cartoradio fetch is one call for the clicked mast, and the card is
  // repainted with it when it lands.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['/api/anfr-fr/support/449714']);
  assert.match(norm(host.entries[0].details.join('\n')), /Propriétaire : Établissement public/);

  // Selecting the same mast again does not re-ask.
  _selectAnfrForTest(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);

  _clearAnfrSelectionForTest();
  assert.equal(_anfrSelectedIdForTest(), null);
  assert.equal(host.entries, null);
});

test('a maillage click asks the register for the identity, once, and caches a miss', async () => {
  const host = makeHost();
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    if (url.startsWith('/api/anfr-fr/supports')) {
      return { ok: true, json: async () => ({ supports: [support(449714)] }) };
    }
    return { ok: true, json: async () => DETAIL };
  };
  const pick = selectAnfrMesh(MESH_TUPLES, { box: { south: 48.8, west: 2.3, north: 48.9, east: 2.4 } });
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9),
    overlayHost: host,
    mesh: MESH_PAYLOAD,
    meshPick: pick,
    regime: 'maillage',
    http,
  });
  const id = anfrMeshRecordId([48.85528, 2.33167, 4, 4]);
  assert.ok(_anfrRecordForTest(id), 'the Paris dot is in the pick');
  _selectAnfrForTest(id);
  // First paint: the band and the operator count, truthfully, with no identity.
  assert.match(norm(host.entries[0].title), /^Antenne-relais$/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].startsWith('/api/anfr-fr/supports?'), true);
  // The lookup box is ~110 m wide, because ANFR positions sit on a ~31 m
  // arc-second lattice and a wider box would sweep in the neighbour.
  const params = new URLSearchParams(calls[0].split('?')[1]);
  assert.ok(Number(params.get('north')) - Number(params.get('south')) < 0.002);
  assert.match(norm(host.entries[0].title), /^Antenne-relais · \d+ opérateurs? · 5G$/);

  // A dot the register cannot name is cached as unnameable, not re-asked.
  const missHost = makeHost();
  const missCalls = [];
  const missHttp = async (url) => {
    missCalls.push(url);
    return { ok: true, json: async () => ({ supports: [] }) };
  };
  _setAnfrStateForTest({
    viewer: fakeViewer(2.3, 48.8, 2.4, 48.9),
    overlayHost: missHost,
    mesh: MESH_PAYLOAD,
    meshPick: pick,
    regime: 'maillage',
    http: missHttp,
  });
  _selectAnfrForTest(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(norm(missHost.entries[0].details.join('\n')), /Aucun mât du registre à cette position exacte/);
  _selectAnfrForTest(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(missCalls.length, 1);
  _clearAnfrSelectionForTest();
});

test('DETECT is never offered a mast that has never transmitted', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const candidates = _anfrDetectablesForTest();
  assert.equal(candidates.length, SUPPORTS.length - FOLD.projectOnly);
  assert.equal(candidates.some((c) => c.sourceId === anfrSupportId(278838)), false);
  for (const candidate of candidates) {
    assert.equal(candidate.type, 'Antenna mast');
    assert.doesNotMatch(candidate.id, /PROJET/);
    assert.ok(candidate.position instanceof Cesium.Cartesian3);
    assert.match(candidate.id, /^(2G|3G|4G|5G)/);
  }
  // The cap and the stride are honoured, so the detector never gets more than
  // it asked for.
  assert.equal(_anfrDetectablesForTest({ maxCount: 3 }).length, 3);
  assert.equal(_anfrDetectablesForTest({ maxCount: 1, seed: 7 }).length, 1);
  _clearAnfrSelectionForTest();
  assert.deepEqual(_anfrDetectablesForTest(), [], 'a disabled layer offers nothing');
});

test('the legend keeps the project row at zero, because the ring has to be explained', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const { legend, chips } = _anfrRowControlsForTest();
  // No chips: the manager renders a chip as a clickable button that dispatches
  // `chip.params`, so an informational one would be a control that does
  // nothing. `anfr-fr` is `enabled-only` and owns no option group.
  assert.deepEqual(chips, []);
  // Newest generation first, which is the order the map is read in.
  assert.deepEqual(legend.map((row) => row.color).slice(0, 2), [
    ANFR_BAND_COLORS['5g'], ANFR_BAND_COLORS['4g'],
  ]);
  assert.equal(legend[legend.length - 1].color, ANFR_BAND_COLORS.projet);
  assert.equal(legend.find((row) => row.color === ANFR_BAND_COLORS['5g']).count, FOLD.bands['5g']);
  for (const row of legend) assert.ok(row.blurb && row.blurb.length > 20, row.label);

  // ONE SENTENCE PER SWATCH. A colour key answers "what does this colour mean"
  // and a national count puts it in proportion; it does not run to four
  // sentences about how ANFR files a status. That fact qualifies one clicked
  // mast and the CARD prints ANFR's own gloss for it.
  const fiveG = legend.find((row) => row.color === ANFR_BAND_COLORS['5g']);
  assert.match(norm(fiveG.blurb), /La 5G émet depuis ce mât/);
  assert.match(norm(fiveG.blurb), /50 148 supports/);
  for (const row of legend) {
    assert.ok(row.blurb.length <= 140, `${row.label} is a paragraph again: ${row.blurb.length}`);
  }

  // With nothing drawn there is no legend to draw either.
  _clearAnfrSelectionForTest();
  assert.deepEqual(_anfrRowControlsForTest(), { chips: [], legend: [] });
});

test('the row label counts the rings it is drawing, in the singular when there is one', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const label = norm(buildAnfrLoadingLabel());
  assert.match(label, /^15 supports/);
  assert.match(label, /1 projet approuvé, rien n’émet/);
  assert.match(label, /4 extensions autorisées/);
  assert.equal(norm(buildAnfrLoadingLabel({ loading: true })), 'lecture du registre ANFR...');
  assert.equal(buildAnfrLoadingLabel({ status: 'error' }), '');
  assert.equal(
    buildAnfrLoadingLabel({ regime: 'supports', count: 0, records: new Map() }),
    'aucun support ANFR dans cette vue',
  );
  _clearAnfrSelectionForTest();
});

test('getStats surfaces the honesty numbers and the guidance, never a fake zero', () => {
  const host = makeHost();
  _setAnfrStateForTest({ viewer: fakeViewer(2.3, 48.8, 2.4, 48.9), overlayHost: host, pack: PACK });
  const stats = _anfrStatsForTest();
  assert.equal(stats.status, 'ok');
  assert.equal(stats.count, 15);
  assert.equal(stats.regime, 'supports');
  assert.equal(stats.supportsNational, FOLD.count);
  assert.equal(stats.projectOnly, FOLD.projectOnly);
  assert.equal(stats.plannedUpgrades, FOLD.plannedUpgrades);
  assert.equal(stats.edition, '2026-08-27');
  assert.equal('error' in stats, false);
  assert.ok(stats.loadingLabel);
  const summary = anfrFranceLayer.getViewportSummary();
  assert.equal(summary.regime, 'supports');
  assert.equal(summary.drawn, 15);
  assert.equal('supports' in summary, false, 'the rows are not repeated into the summary');
  _clearAnfrSelectionForTest();
});

test('the camera decides the regime, and never asks for a box the proxy refuses', async () => {
  assert.equal(ANFR_MAX_BOX_DEG, 0.35);
  const wide = fakeViewer(-5, 41, 10, 51.5);
  assert.equal(cameraAnfrBox(wide), null, 'a national view is above the ceiling');
  assert.ok(cameraAnfrMeshBox(wide), 'the maillage has no ceiling');
  assert.ok(anfrViewSpanDeg(wide).lat > 10);
  const tight = fakeViewer(2.30, 48.84, 2.36, 48.88);
  const box = cameraAnfrBox(tight);
  assert.ok(box.north - box.south <= ANFR_MAX_BOX_DEG);
  assert.ok(box.east - box.west <= ANFR_MAX_BOX_DEG);
  // The padded maillage box is wider than the view, so a dot does not pop in
  // at the screen edge.
  const padded = cameraAnfrMeshBox(tight);
  assert.ok(padded.north > box.north && padded.south < box.south);
  assert.equal(anfrViewSpanDeg({}).lat, Infinity);
  assert.equal(cameraAnfrBox({}), null);
  assert.equal(cameraAnfrMeshBox({}), null);
});

test('a wide view loads the maillage and a tight one loads the supports', async () => {
  const host = makeHost();
  const asked = [];
  const http = async (url) => {
    asked.push(url.split('?')[0]);
    if (url.startsWith('/api/anfr-fr/mesh')) return { ok: true, json: async () => MESH_PAYLOAD };
    if (url.startsWith('/api/anfr-fr/supports')) return { ok: true, json: async () => PACK };
    return { ok: true, json: async () => DETAIL };
  };
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const national = await _loadAnfrViewportForTest(fakeViewer(-5, 41, 10, 51.5));
  assert.equal(national.regime, 'maillage');
  assert.equal(asked[0], '/api/anfr-fr/mesh');
  assert.ok(national.count > 0);
  assert.equal(national.status, 'ready');

  const street = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88));
  assert.equal(street.regime, 'supports');
  assert.equal(asked[asked.length - 1], '/api/anfr-fr/supports');
  assert.equal(street.count, 15);
  _clearAnfrSelectionForTest();
});

test('a failed refresh keeps the map it has and says the refresh failed', async () => {
  const host = makeHost();
  let fail = false;
  const http = async (url) => {
    if (fail) throw new Error('ECONNREFUSED');
    if (url.startsWith('/api/anfr-fr/supports')) return { ok: true, json: async () => PACK };
    return { ok: true, json: async () => MESH_PAYLOAD };
  };
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const first = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88));
  assert.equal(first.count, 15);
  fail = true;
  const second = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88), { force: true });
  // Fifteen real masts are still fifteen real masts. Blanking the screen would
  // say France has no antennas.
  assert.equal(second.count, 15);
  assert.equal(second.status, 'ready');
  assert.match(second.error, /rafraîchissement du registre ANFR indisponible/);

  // With nothing drawn at all, the failure is an error state and not an empty
  // country.
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const cold = await _loadAnfrViewportForTest(fakeViewer(2.30, 48.84, 2.36, 48.88), { force: true });
  assert.equal(cold.count, 0);
  assert.equal(cold.status, 'error');
  assert.match(cold.error, /registre ANFR indisponible/);
  assert.equal(_anfrStatsForTest().status, 'error');
  _clearAnfrSelectionForTest();
});

test('a malformed payload is refused rather than drawn as an empty France', async () => {
  const host = makeHost();
  const http = async () => ({ ok: true, json: async () => ({ nope: true }) });
  _setAnfrStateForTest({ overlayHost: host, http, regime: 'maillage' });
  const result = await _loadAnfrViewportForTest(fakeViewer(-5, 41, 10, 51.5));
  assert.equal(result.count, 0);
  assert.equal(result.status, 'error');
  // The reader gets a French sentence; `malformed payload` stays in the console.
  assert.equal(result.error, 'maillage national ANFR indisponible');
  _clearAnfrSelectionForTest();
});

test('the maillage says when the camera is simply not over France', () => {
  // `layerFeedState()` renders `empty` as a green ON chip, so a blank row and a
  // broken row look identical. The sentence is what tells them apart.
  assert.equal(
    buildAnfrLoadingLabel({
      regime: 'maillage', status: 'ready', loading: false, count: 0, inView: 0, national: NATIONAL,
    }),
    'aucun support ANFR dans cette vue',
  );
  // Before anything at all has loaded there is nothing honest to say.
  assert.equal(
    buildAnfrLoadingLabel({
      regime: 'maillage', status: 'ready', loading: false, count: 0, inView: 0, national: null,
    }),
    '',
  );
});

test('init builds the three real collections, and the draw path fills them', async () => {
  // The seams above run the card and legend paths with `point: null`. This one
  // runs the production `reconcileSupports` against a real
  // PointPrimitiveCollection, so the style a test asserts on is the style a
  // primitive actually receives. The two polyline collections beside it are
  // the world-space channel: shafts, and the selected mast's azimuth rays.
  const added = [];
  const viewer = {
    ...fakeViewer(2.30, 48.84, 2.36, 48.88),
    scene: {
      requestRender() {},
      primitives: {
        add(primitive) { added.push(primitive); return primitive; },
        remove(primitive) { return added.splice(added.indexOf(primitive), 1).length > 0; },
        contains() { return true; },
        raiseToTop() {},
      },
    },
  };
  anfrFranceLayer.init(viewer);
  assert.equal(added.length, 3);
  assert.equal(added[0].constructor, Cesium.PointPrimitiveCollection);
  assert.equal(added[1].constructor, Cesium.PolylineCollection, 'the shafts');
  assert.equal(added[2].constructor, Cesium.PolylineCollection, 'the azimuth rays');

  const http = async (url) => ({
    ok: true,
    json: async () => (url.startsWith('/api/anfr-fr/supports') ? PACK : MESH_PAYLOAD),
  });
  _setAnfrStateForTest({ viewer, overlayHost: makeHost(), http, regime: 'maillage' });
  // `_setAnfrStateForTest` does not touch the collection init() made, so the
  // real load path below is what puts primitives in it.
  const result = await _loadAnfrViewportForTest(viewer);
  assert.equal(result.regime, 'supports');
  assert.equal(added[0].length, 15, 'one primitive per support in the box');

  const record = _anfrRecordForTest(anfrSupportId(449714));
  assert.ok(record.point, 'the record holds its primitive');
  assert.equal(record.point.pixelSize, record.style.sizePx);
  const before = record.point.pixelSize;
  _selectAnfrForTest(record.id);
  assert.ok(record.point.pixelSize > before, 'selection grows the real primitive');
  _clearAnfrSelectionForTest();
  assert.equal(record.point.pixelSize, before, 'and clearing restores it');

  anfrFranceLayer.destroy(viewer);
  assert.equal(added.length, 0, 'destroy removes every collection it added');
});

test('the overlay entry is anchored, protected and single', () => {
  const record = {
    id: anfrSupportId(449714),
    support: support(449714),
    position: Cesium.Cartesian3.fromDegrees(2.33167, 48.85528, 2.5),
  };
  const entry = createAnfrSelectedOverlayEntry(record, PACK);
  assert.equal(entry.collisionGroup, 'ambient-card');
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.interactive, false);
  assert.equal(entry.horizonCull, true);
  // The compact card is three lines before the detailed fiche lands — where
  // it is, who transmits, and where it comes from — and never a stub.
  assert.equal(entry.details.length, 3, entry.details.join(' | '));
  assert.match(entry.details[0], /^Toit d’immeuble/);
  assert.match(entry.details[1], /Orange/);
  assert.match(entry.details[2], /^ANFR n° /);
  assert.equal(createAnfrSelectedOverlayEntry({ id: 'x' }), null);
  assert.equal(createAnfrSelectedOverlayEntry(null), null);
  assert.equal(ANFR_FR_OVERLAY_SOURCE_ID, 'anfr-fr-selected');
  assert.equal(anfrBandColor('nope'), ANFR_BAND_COLORS.projet);
});

// ── The world-space channel: the support drawn at its real height ───────────
// One property holds through the six tests below, and it is B2's: the QUANTITY
// is a length in metres of the world, and no screen-space channel is composed
// with it. The dot's pixel size is still the operator count and is multiplied
// by nothing; the shaft's pixel width is a constant that carries nothing. The
// second property is A1's: 551 supports of the register publish no height, and
// none of them gets a default one — they get no shaft at all, and the count
// travels with the row label, the legend and the card.

const heightlessId = anfrSupportId(325857);

test('the shaft is the published height, and there is none where there is none', () => {
  // 325857 is the fixture's underground support: the register leaves its
  // height blank because there is no mast to measure. It is one of the three
  // natures that hold all 551 blanks nationally.
  const blank = support(325857);
  assert.equal(blank.heightM, null);
  assert.ok(ANFR_HEIGHTLESS_NATURES.includes(blank.nature));
  assert.equal(anfrMastHeightM(blank), null);
  // A zero and a negative are the same refusal, for the same reason: the
  // register writes 0 where nobody filled the field in.
  assert.equal(anfrMastHeightM({ heightM: 0 }), null);
  assert.equal(anfrMastHeightM({ heightM: -12 }), null);
  assert.equal(anfrMastHeightM({}), null);
  assert.equal(anfrMastHeightM(null), null);
  // And a published one is passed through in metres, unscaled and unclassed —
  // there is no thematic mapping to invert here.
  assert.equal(anfrMastHeightM(support(437710)), 308);
  assert.equal(anfrMastHeightM(support(449714)), 65);

  _setAnfrStateForTest({ overlayHost: makeHost(), pack: PACK, regime: 'supports', mastRegime: true });
  const tally = _anfrMastTallyForTest();
  assert.equal(tally.masts + tally.unpublished, SUPPORTS.length);
  assert.equal(tally.unpublished, 1, 'the one blank in the fixture, counted');
  assert.equal(tally.clipped, 0);
  _clearAnfrSelectionForTest();
});

test('the dot rides the top of its shaft, and stays on the ground without one', () => {
  _setAnfrStateForTest({ overlayHost: makeHost(), pack: PACK, regime: 'supports', mastRegime: true });
  const tall = _anfrRecordForTest(anfrSupportId(437710));
  const flat = _anfrRecordForTest(heightlessId);
  const lift = (record) => Cesium.Cartographic.fromCartesian(record.position).height
    - Cesium.Cartographic.fromCartesian(record.groundPosition).height;
  // 308 m of support is 308 m of lift, to within the ellipsoid round trip.
  assert.ok(Math.abs(lift(tall) - 308) < 0.5);
  // No height, no lift: the dot and the foot of the missing shaft are the same
  // point, which is exactly what "no measurement" should look like.
  assert.ok(Math.abs(lift(flat)) < 1e-6);
  // The pixel channel is untouched by any of it — the dot is still sized by
  // the operator count, and nothing multiplies it (B2).
  assert.equal(tall.style.sizePx, anfrPointSize(tall.support.operators.length));
  assert.equal(flat.style.sizePx, anfrPointSize(flat.support.operators.length));
  _clearAnfrSelectionForTest();
});

test('the shaft sub-regime has hysteresis and is nested inside the exact one', () => {
  // Entering is stricter than leaving, so a camera resting on the boundary
  // cannot flicker the whole shaft field on and off.
  assert.ok(ANFR_MAST_ENTER_SPAN_DEG < ANFR_MAST_EXIT_SPAN_DEG);
  assert.ok(ANFR_MAST_EXIT_SPAN_DEG < ANFR_MAX_BOX_DEG, 'and both sit inside the exact regime');
  assert.equal(anfrMastRegime(0.05, false), true);
  assert.equal(anfrMastRegime(0.07, false), false, 'above the entry, not entered');
  assert.equal(anfrMastRegime(0.07, true), true, 'above the entry, not yet left');
  assert.equal(anfrMastRegime(0.1, true), false);
  assert.equal(anfrMastRegime(Infinity, true), false);
  assert.equal(anfrMastRegime(NaN, true), false);

  // The maillage tuple has no height in it, so the shafts cannot follow the
  // camera down there even if the span would allow it.
  _setAnfrStateForTest({
    overlayHost: makeHost(), mesh: MESH_PAYLOAD, regime: 'maillage', mastRegime: true,
  });
  assert.equal(_anfrMastTallyForTest().mastRegime, false);
  assert.equal(_anfrMastTallyForTest().masts, 0);
  assert.deepEqual(anfrMastLegend({ regime: 'maillage', mastRegime: true }), [],
    'and no height key is published beside a map that draws no shafts');
  _clearAnfrSelectionForTest();
});

test('the mast key states the ABSENCES and publishes no size ladder', () => {
  // The house rule (PR #138): `#map-legend` carries the COLOUR channel, not the
  // FORM channel. A shaft under a dot is decoded right without a key, and the
  // three numbered height marks were a size ladder in one flat graphite — a
  // second list re-printing the same masts by their extent. Both are gone.
  _setAnfrStateForTest({ overlayHost: makeHost(), pack: PACK, regime: 'supports', mastRegime: true });
  const { legend } = _anfrRowControlsForTest();
  const labels = legend.map((row) => row.label);
  assert.equal(labels.filter((label) => /^\d+ m$/.test(label)).length, 0, 'the size ladder is gone');
  assert.ok(!labels.some((label) => label.startsWith('Fût —')), 'a shaft needs no key');

  // A1 — what survives is the mark that is NOT THERE. A dot with no shaft reads
  // as a short mast, which is the one way a form is decoded WRONG unaided, so
  // it keeps its row, its count and a hatch rather than a tint (D3).
  const blank = legend.find((row) => row.label.startsWith('Sans mât'));
  assert.equal(blank.count, 1);
  assert.ok(blank.glyph?.startsWith('data:image/svg+xml'));
  assert.ok(blank.blurb.includes(String(ANFR_HEIGHT_MISSING)));
  assert.ok(blank.blurb.length <= 180, blank.blurb);
  // The band ramp is untouched: the absence rows are appended, never mixed in.
  assert.equal(labels.indexOf('5G en service'), 0);
  _clearAnfrSelectionForTest();
});

test('the ceiling and the azimuths only take a row when they have something to say', () => {
  assert.deepEqual(
    anfrMastLegend({
      regime: 'supports', mastRegime: true, mastsUnpublished: 0, mastsClipped: 0, sectors: 0,
    }),
    [],
    'every shaft drawn at its height is a key with nothing to disclose',
  );
  const full = anfrMastLegend({
    regime: 'supports', mastRegime: true, mastsUnpublished: 2, mastsClipped: 7, sectors: 3,
  });
  assert.deepEqual(full.map((row) => row.label), [
    'Sans mât — hauteur non publiée', 'Fûts écrêtés', 'Azimuts du support sélectionné',
  ]);
  assert.deepEqual(full.map((row) => row.count), [2, 7, 3]);
});

test('the row label tells the three empties apart', () => {
  // A4 — no shaft on screen can mean too far to draw one, no height published,
  // or the cap biting. Three causes, three sentences.
  const far = buildAnfrLoadingLabel({
    regime: 'supports', status: 'ready', loading: false, count: 15, inView: 15,
    records: new Map(), mastRegime: false, masts: 0, mastsUnpublished: 0, mastsClipped: 0,
  });
  assert.ok(far.includes('vue rapprochée'));
  assert.ok(!far.includes('sans hauteur publiée'));

  const near = buildAnfrLoadingLabel({
    regime: 'supports', status: 'ready', loading: false, count: 15, inView: 15,
    records: new Map(), mastRegime: true, masts: 14, mastsUnpublished: 1, mastsClipped: 3,
  });
  assert.ok(near.includes('14 fûts à leur hauteur'));
  assert.ok(near.includes('1 sans hauteur publiée, sans fût'), 'singular, and A1');
  assert.ok(near.includes('3 fûts écrêtés par le plafond'), 'A5 — the cap declares itself');

  const plural = buildAnfrLoadingLabel({
    regime: 'supports', status: 'ready', loading: false, count: 15, inView: 15,
    records: new Map(), mastRegime: true, masts: 10, mastsUnpublished: 5, mastsClipped: 0,
  });
  assert.ok(plural.includes('5 sans hauteur publiée, sans fût'));
  // The maillage never mentions shafts at all: it has no heights to draw.
  const mesh = buildAnfrLoadingLabel({
    regime: 'maillage', status: 'ready', loading: false, count: 3, inView: 9,
    national: NATIONAL, pick: { thinned: true }, mastRegime: false,
  });
  assert.ok(!mesh.includes('fût'));
});

test('the rays are the published bearings, and refuse to imply a range', () => {
  // The azimuth is NOT in the observatoire — it comes from the Cartoradio card
  // of the mast the reader clicked, one mast at a time. What is drawn is a
  // bearing at a published mounting height, and nothing else.
  const { rays, bearings, unplaced, unaimed } = anfrSectorRays(DETAIL);
  assert.ok(rays.length > 0);
  assert.equal(unplaced, 0);
  assert.equal(unaimed, 0);
  assert.ok(bearings.includes(0), 'zero is north, and it is drawn');
  assert.deepEqual(bearings, [...new Set(bearings)].sort((a, b) => a - b));
  assert.ok(bearings.length < rays.length, 'the card lists bearings, the map draws pairs');

  // A bearing with no mounting height is REFUSED, not seated on the mast's own
  // height: those are two different published numbers and swapping them would
  // be an invention that looks measured.
  const partial = anfrSectorRays({
    antennas: {
      withoutAzimuth: 2,
      azimuths: [
        { deg: 120, heightM: 30, antennas: 3 },
        { deg: 240, heightM: null, antennas: 1 },
        { deg: NaN, heightM: 30, antennas: 1 },
      ],
    },
  });
  assert.deepEqual(partial.rays, [{ deg: 120, heightM: 30, antennas: 3 }]);
  assert.equal(partial.unplaced, 1);
  assert.equal(partial.unaimed, 2);
  assert.deepEqual(anfrSectorRays(null).rays, []);

  // The card COUNTS the directions rather than listing them. Twelve bearings
  // printed as twelve numbers is twelve numbers nobody can use; the count and
  // the height range are the same fact in a form a reader can check by
  // standing under the mast and looking up.
  const lines = anfrAzimuthLines(DETAIL);
  assert.equal(lines[0], '30 antennes, 12 directions, 31 à 49 m du sol · +3 FH hors téléphonie');
  assert.ok(!lines.some((line) => line.includes('Azimuts publiés')));
  // The ray-length convention is the LEGEND's job — it appears on the row
  // that appears with the rays, and printing it per mast repeated on every
  // card a fact about how this layer draws.
  assert.ok(!lines.some((line) => line.includes(`${ANFR_SECTOR_RAY_M} m`)));
  assert.ok(anfrMastLegend({ mastRegime: true, regime: 'supports', sectors: 12 })
    .some((row) => /convention de dessin, pas une portée/.test(row.blurb)));

  // Four or fewer, and they are NAMED with their compass point — the
  // three-sector mast is the textbook case and reads without a protractor.
  const threeSector = anfrAzimuthLines({
    antennas: {
      antennas: 9,
      withoutAzimuth: 0,
      azimuths: [
        { deg: 0, heightM: 30, antennas: 3 },
        { deg: 120, heightM: 30, antennas: 3 },
        { deg: 240, heightM: 30, antennas: 3 },
      ],
    },
  });
  assert.equal(threeSector[0], '9 antennes, 3 directions (0° N · 120° SE · 240° SO), 30 m du sol');

  const refusals = anfrAzimuthLines({
    antennas: { antennas: 1, withoutAzimuth: 1, azimuths: [{ deg: 90, heightM: null, antennas: 1 }] },
  });
  assert.ok(refusals.some((line) => line.includes('sans hauteur de fixation publiée')));
  assert.ok(refusals.some((line) => line.includes('sans direction publiée')));
  assert.deepEqual(anfrAzimuthLines({ antennas: { azimuths: [], withoutAzimuth: 0 } }), []);
});

test('the drawn shafts and rays are world geometry, and go away with the selection', async () => {
  // The production path, against real primitive collections: this is where a
  // length in metres either is a length in metres or is not.
  const added = [];
  const viewer = {
    ...fakeViewer(2.325, 48.850, 2.340, 48.860),
    scene: {
      requestRender() {},
      canvas: {},
      preRender: { addEventListener: () => () => {} },
      primitives: {
        add(primitive) { added.push(primitive); return primitive; },
        remove(primitive) { return added.splice(added.indexOf(primitive), 1).length > 0; },
        contains() { return true; },
        raiseToTop() {},
      },
    },
  };
  anfrFranceLayer.init(viewer);
  const [, masts, sectors] = added;

  const http = async () => ({ ok: true, json: async () => PACK });
  _setAnfrStateForTest({ viewer, overlayHost: makeHost(), http, regime: 'maillage' });
  // A 0.015° box is inside the shaft sub-regime, so the load path draws them.
  await _loadAnfrViewportForTest(viewer);
  assert.equal(_anfrMastTallyForTest().mastRegime, true);
  assert.equal(masts.length, 14, 'one shaft per published height, and none for the blank');
  assert.equal(masts.show, true);

  // The shaft's LENGTH is the support's height, in metres of the world. This
  // is the B2 assertion: nothing screen-space is composed with it.
  const line = masts.get(0);
  const foot = Cesium.Cartographic.fromCartesian(line.positions[0]);
  const top = Cesium.Cartographic.fromCartesian(line.positions[1]);
  assert.ok(Math.abs(foot.longitude - top.longitude) < 1e-12, 'the shaft is vertical');
  const drawn = top.height - foot.height;
  const heights = SUPPORTS.map((row) => row.heightM).filter((value) => value > 0);
  assert.ok(heights.some((value) => Math.abs(value - drawn) < 0.5), `${drawn} is a published height`);

  // A support that radiates nothing gets a dashed shaft: its height is a
  // figure on an authorised file, not a measurement of something built.
  const materials = new Set();
  for (let i = 0; i < masts.length; i += 1) materials.add(masts.get(i).material.type);
  assert.ok(materials.has('Color'));
  assert.ok(materials.has('PolylineDash'), 'the project-only support is dashed');

  // Now the rays. Nothing is drawn until a support is selected AND its
  // Cartoradio card has arrived, because that card is where the bearings are.
  assert.equal(sectors.show, false);
  _setAnfrStateForTest({
    viewer, overlayHost: makeHost(), http, pack: PACK, regime: 'supports',
    mastRegime: true, details: [[449714, DETAIL]],
  });
  _selectAnfrForTest(anfrSupportId(449714));
  const expected = anfrSectorRays(DETAIL).rays.length;
  assert.equal(_anfrMastTallyForTest().sectors, expected);
  assert.equal(sectors.length, expected);
  assert.equal(sectors.show, true);
  // Every ray is exactly the declared 60 m, horizontal, at its own mounting
  // height — a direction, never a coverage radius.
  for (let i = 0; i < sectors.length; i += 1) {
    const [near, far] = sectors.get(i).positions;
    const a = Cesium.Cartographic.fromCartesian(near);
    const b = Cesium.Cartographic.fromCartesian(far);
    assert.ok(Math.abs(a.height - b.height) < 0.5, 'horizontal');
    const metres = anfrDistanceM(
      Cesium.Math.toDegrees(a.latitude), Cesium.Math.toDegrees(a.longitude),
      Cesium.Math.toDegrees(b.latitude), Cesium.Math.toDegrees(b.longitude),
    );
    assert.ok(Math.abs(metres - ANFR_SECTOR_RAY_M) < 0.5, `${metres} m`);
  }
  // ONE MATERIAL PER RAY, and the same colour on every one of them.
  //
  // The instances have to be distinct because `Polyline._destroy()` destroys
  // its own material and Cesium's `destroyObject` is not idempotent: a fan of
  // 33 rays sharing one instance is 32 throws waiting for the next teardown.
  // The COLOUR has to be identical because that — not the instance — is what
  // Cesium batches on: `sortPolylinesIntoBuckets` keys on `material.type` and
  // the draw pass splits commands on type plus uniform VALUES, so 33 cyan
  // instances are still one draw command.
  const rayMaterials = [...Array(sectors.length)].map((_, i) => sectors.get(i).material);
  assert.equal(new Set(rayMaterials).size, sectors.length, 'no ray shares an instance');
  assert.equal(new Set(rayMaterials.map((m) => `${m.type}|${m.uniforms.color.toCssColorString()}`)).size, 1,
    'and they all wear the same cyan, so they still batch into one command');

  // Deselecting takes the rays down and leaves the shafts alone: they belong
  // to two different questions.
  _clearAnfrSelectionForTest();
  assert.equal(sectors.show, false);
  for (let i = 0; i < sectors.length; i += 1) assert.equal(sectors.get(i).show, false);

  anfrFranceLayer.destroy(viewer);
  assert.equal(added.length, 0);
});

test('a shaft owns its material, so a teardown does not destroy the same one twice', async () => {
  // The bug this closes was silent in every previous test because the fake
  // `primitives.remove` above never destroys. Cesium's does — and
  // `Polyline._destroy()` calls `this._material.destroy()` unconditionally
  // while `destroyObject` replaces every method with a thrower. So two shafts
  // holding one memoized material meant the second `destroy()` threw
  // `DeveloperError`, on `disable()` (which calls `removeAll()`) and on
  // `destroy()` (which calls `primitives.remove()`) alike.
  //
  // Proved first on bare Cesium so the property is anchored to the engine and
  // not to this layer's plumbing.
  const positions = [Cesium.Cartesian3.fromDegrees(2.3, 48.8), Cesium.Cartesian3.fromDegrees(2.4, 48.9)];
  const shared = Cesium.Material.fromType('Color', { color: Cesium.Color.RED });
  const sharing = new Cesium.PolylineCollection();
  sharing.add({ positions, width: 2, material: shared });
  sharing.add({ positions, width: 2, material: shared });
  assert.throws(() => sharing.destroy(), /destroyed/, 'a shared material throws on the second destroy');

  const owning = new Cesium.PolylineCollection();
  owning.add({ positions, width: 2, material: Cesium.Material.fromType('Color', { color: Cesium.Color.RED }) });
  owning.add({ positions, width: 2, material: Cesium.Material.fromType('Color', { color: Cesium.Color.RED }) });
  owning.destroy();

  // Now the layer itself, on real collections, torn down twice over: the
  // `removeAll()` inside `disable()` and then a real `destroy()`.
  const added = [];
  const viewer = {
    ...fakeViewer(2.325, 48.850, 2.340, 48.860),
    scene: {
      requestRender() {},
      canvas: {},
      preRender: { addEventListener: () => () => {} },
      primitives: {
        add(primitive) { added.push(primitive); return primitive; },
        // The real thing: `PrimitiveCollection.remove` destroys what it drops.
        remove(primitive) {
          const at = added.indexOf(primitive);
          if (at < 0) return false;
          added.splice(at, 1);
          primitive.destroy();
          return true;
        },
        contains() { return true; },
        raiseToTop() {},
      },
    },
  };
  anfrFranceLayer.init(viewer);
  const [, masts, sectors] = added;
  const http = async () => ({ ok: true, json: async () => PACK });
  _setAnfrStateForTest({ viewer, overlayHost: makeHost(), http, regime: 'maillage' });
  await _loadAnfrViewportForTest(viewer);
  assert.ok(masts.length > 1, 'more than one shaft, or there is nothing to double-destroy');
  const shaftMaterials = [...Array(masts.length)].map((_, i) => masts.get(i).material);
  assert.equal(new Set(shaftMaterials).size, masts.length, 'no shaft shares an instance');

  _setAnfrStateForTest({
    viewer, overlayHost: makeHost(), http, pack: PACK, regime: 'supports',
    mastRegime: true, details: [[449714, DETAIL]],
  });
  _selectAnfrForTest(anfrSupportId(449714));
  assert.ok(sectors.length > 1, 'more than one ray, likewise');

  anfrFranceLayer.disable(viewer);
  anfrFranceLayer.destroy(viewer);
  assert.equal(added.length, 0);
  assert.equal(masts.isDestroyed(), true);
  assert.equal(sectors.isDestroyed(), true);
});

test('the drawn shafts are grouped by appearance, so the field is a handful of draw commands', async () => {
  // Cesium opens a new `DrawCommand` every time two CONSECUTIVE polylines of a
  // bucket disagree on `type + uniform values`. In register order the five
  // appearances interleave, so the fullest 0.09° box (1 913 shafts) could cost
  // 1 913 commands for what is at most five distinct looks. Grouping the drawn
  // set is what collapses that, and it is a rendering decision only: WHICH
  // shafts are drawn is still decided in register order, before the sort.
  const added = [];
  const viewer = {
    ...fakeViewer(2.325, 48.850, 2.340, 48.860),
    scene: {
      requestRender() {},
      canvas: {},
      preRender: { addEventListener: () => () => {} },
      primitives: {
        add(primitive) { added.push(primitive); return primitive; },
        remove(primitive) { return added.splice(added.indexOf(primitive), 1).length > 0; },
        contains() { return true; },
        raiseToTop() {},
      },
    },
  };
  anfrFranceLayer.init(viewer);
  const [, masts] = added;
  const http = async () => ({ ok: true, json: async () => PACK });
  _setAnfrStateForTest({ viewer, overlayHost: makeHost(), http, regime: 'maillage' });
  await _loadAnfrViewportForTest(viewer);

  const appearance = (i) => {
    const material = masts.get(i).material;
    return `${material.type}|${material.uniforms.color.toCssColorString()}`;
  };
  const drawn = _anfrMastTallyForTest().masts;
  const looks = new Set();
  let runs = 0;
  let previous = null;
  for (let i = 0; i < drawn; i += 1) {
    const key = appearance(i);
    looks.add(key);
    if (key !== previous) runs += 1;
    previous = key;
  }
  assert.ok(looks.size > 1, 'this fixture has more than one band, or the test proves nothing');
  assert.equal(runs, looks.size, 'one run per appearance — no band is drawn twice');

  anfrFranceLayer.destroy(viewer);
});
