import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYER_FUSIONS,
  fusedIntoFor,
  fusionCompanionsFor,
  fusionToggleGroupFor,
  validateLayerFusions,
} from './layerFusions.js';
import { DISABLED_LAYER_IDS, REGISTERED_LAYER_IDS } from './layerState.js';
import { LAYER_TAXONOMY, groupLayerIdsByCategory, layerTaxonomyFor } from './layerTaxonomy.js';

test('the shipped table validates against the registered layer set', () => {
  assert.equal(validateLayerFusions(), true);
});

test('no layer is claimed twice, and no primary is somebody else s companion', () => {
  // The failure this forbids is not theoretical: a layer that is a primary in
  // one entry and a companion in another would draw a row AND a chip for the
  // same source — the exact duplication the table exists to remove.
  const seen = new Set();
  for (const fusion of LAYER_FUSIONS) {
    assert.ok(!seen.has(fusion.primary), `${fusion.primary} claimed twice`);
    seen.add(fusion.primary);
    for (const companion of fusion.companions) {
      assert.ok(!seen.has(companion.id), `${companion.id} claimed twice`);
      seen.add(companion.id);
    }
  }
});

test('every id in the table is a layer the app actually registers', () => {
  const registered = new Set(REGISTERED_LAYER_IDS);
  for (const fusion of LAYER_FUSIONS) {
    assert.ok(registered.has(fusion.primary), `unknown primary ${fusion.primary}`);
    for (const companion of fusion.companions) {
      assert.ok(registered.has(companion.id), `unknown companion ${companion.id}`);
    }
  }
});

test('a fused row never hides a world layer behind a French scope chip', () => {
  // The rule the table states in prose, asserted: where a fusion mixes a layer
  // that has data everywhere with one that stops at the French border, the
  // world layer keeps the row. A row chipped `FR` over a world subject tells a
  // reader in Montréal that a layer serving them is not for them.
  for (const fusion of LAYER_FUSIONS) {
    const primary = layerTaxonomyFor(fusion.primary);
    if (primary.coverage === 'global') continue;
    for (const companion of fusion.companions) {
      const entry = layerTaxonomyFor(companion.id);
      assert.notEqual(
        entry.coverage,
        'global',
        `${companion.id} has world data and is folded into the narrower ${fusion.primary}`,
      );
    }
  }
});

test('the row toggle carries its followers and leaves the opt-in companions alone', () => {
  // `comparables-fr` is the reader's own dossier: switching it on from a row
  // toggle would spend a lifecycle drawing an empty selection.
  const dvf = fusionToggleGroupFor('dvf-sales');
  assert.deepEqual(dvf, ['dvf-sales', 'avis-valeur']);
  assert.ok(fusionCompanionsFor('dvf-sales').some((entry) => entry.id === 'comparables-fr'));

  // A layer with no fusion is its own group of one — that is the contract that
  // lets a caller use this unconditionally.
  assert.deepEqual(fusionToggleGroupFor('cctv'), ['cctv']);
  assert.deepEqual(fusionToggleGroupFor('not-a-layer'), ['not-a-layer']);
});

test('a companion resolves back to the row it disappeared into', () => {
  assert.equal(fusedIntoFor('sitadel-fr'), 'ads-fr');
  assert.equal(fusedIntoFor('bruit-fr'), 'local-airports');
  assert.equal(fusedIntoFor('military'), 'flights');
  assert.equal(fusedIntoFor('cctv'), null);
  assert.equal(fusedIntoFor('ads-fr'), null);
});

test('the taxonomy carries the fusion facets, and the panel projection drops the companions', () => {
  const byId = new Map(LAYER_TAXONOMY.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('sitadel-fr').fusedInto, 'ads-fr');
  assert.equal(byId.get('ads-fr').companions.length, 1);
  assert.equal(byId.get('cadastre-fr').companions, null);
  assert.equal(byId.get('cadastre-fr').fusedInto, null);

  const rows = groupLayerIdsByCategory().flatMap((group) => group.layerIds);
  for (const fusion of LAYER_FUSIONS) {
    assert.ok(rows.includes(fusion.primary), `${fusion.primary} lost its row`);
    for (const companion of fusion.companions) {
      assert.ok(!rows.includes(companion.id), `${companion.id} still has a row`);
    }
  }
});

test('the merge is measured, not asserted: the panel loses 22 rows and keeps every layer', () => {
  // The number is the point of the whole exercise, so it is pinned. If a new
  // layer lands, the row count moves and this assertion moves with it — what
  // must not move silently is the DIFFERENCE between what is registered and
  // what is listed.
  //
  // 23 until 2026-09-10, when `idfm-frequency` stopped being a companion by
  // stopping being a layer: it and `idfm-network` drew the same stops, so they
  // were merged into ONE module rather than kept as two chips on one row. A
  // fusion hides a row; a merge deletes one, and the two are not the same
  // operation. See `idfmNetwork.js`.
  const folded = LAYER_FUSIONS.reduce((total, fusion) => total + fusion.companions.length, 0);
  assert.equal(folded, 22);

  const rows = groupLayerIdsByCategory().flatMap((group) => group.layerIds);
  const datasets = LAYER_TAXONOMY.filter((entry) => entry.kind === 'dataset');
  assert.equal(rows.length, datasets.length - folded);

  // Nothing is deleted. Every folded layer is still registered, still carries
  // its own share token, and is still reachable by id.
  const registered = new Set(REGISTERED_LAYER_IDS);
  for (const fusion of LAYER_FUSIONS) {
    for (const companion of fusion.companions) assert.ok(registered.has(companion.id));
  }
});

test('a withdrawn companion loses its chip, keeps its layer, and never gets a row', () => {
  // The three halves of `disabled: true`, asserted together because dropping
  // any one of them is a different bug: no chip (the reader cannot ask for it),
  // not in the row's toggle group (the row never switches it on behind their
  // back), and STILL fused (so it does not come back as a row of its own — the
  // failure mode of simply deleting the entry).
  const offered = fusionCompanionsFor('bikeshare');
  assert.deepEqual(offered.map((entry) => entry.id), ['shared-mobility-fr']);
  assert.deepEqual(fusionToggleGroupFor('bikeshare'), ['bikeshare', 'shared-mobility-fr']);
  assert.equal(fusedIntoFor('velo-pulse-fr'), 'bikeshare');

  // Nothing was deleted: the entry is still in the table, still registered,
  // and still carries the chip label it comes back with.
  const entry = LAYER_FUSIONS.find((fusion) => fusion.primary === 'bikeshare')
    .companions.find((companion) => companion.id === 'velo-pulse-fr');
  assert.equal(entry.disabled, true);
  assert.equal(entry.chip, 'Semaine type');
  assert.ok(REGISTERED_LAYER_IDS.includes('velo-pulse-fr'));
  assert.ok(DISABLED_LAYER_IDS.includes('velo-pulse-fr'));

  // And the panel projection agrees: no row, and no chip on anyone else's.
  const rows = groupLayerIdsByCategory().flatMap((group) => group.layerIds);
  assert.ok(!rows.includes('velo-pulse-fr'));
  const byId = new Map(LAYER_TAXONOMY.map((row) => [row.id, row]));
  assert.deepEqual(byId.get('bikeshare').companions.map((c) => c.id), ['shared-mobility-fr']);
});

test('a fusion may withdraw every companion it has', () => {
  // Validation accepts it rather than calling it an empty fusion: the entry is
  // still the statement that these layers are one subject, and taking the flags
  // back off is how the row gets its strip again. `fusionCompanionsFor` then
  // answers `null` rather than `[]`, so such a row renders exactly like an
  // unfused one instead of opening a control strip with nothing in it.
  const table = [
    { primary: 'a', companions: [{ id: 'b', chip: 'B', disabled: true }] },
  ];
  assert.equal(validateLayerFusions(table, ['a', 'b']), true);
  // The shipped table's own case: `bikeshare` keeps one offered companion, so
  // it still has a strip — the `null` branch is the contract, asserted above on
  // every layer that has no fusion at all.
  assert.equal(fusionCompanionsFor('cctv'), null);
});

test('validation refuses the four ways a fusion table goes wrong', () => {
  const ids = ['a', 'b', 'c'];
  assert.throws(
    () => validateLayerFusions([{ primary: 'zz', companions: [{ id: 'a', chip: 'A' }] }], ids),
    /Unknown fusion primary/,
  );
  assert.throws(
    () => validateLayerFusions([{ primary: 'a', companions: [{ id: 'zz', chip: 'Z' }] }], ids),
    /Unknown fusion companion/,
  );
  assert.throws(
    () => validateLayerFusions([{ primary: 'a', companions: [] }], ids),
    /Fusion has no companion/,
  );
  assert.throws(
    () => validateLayerFusions([
      { primary: 'a', companions: [{ id: 'b', chip: 'B' }] },
      { primary: 'c', companions: [{ id: 'b', chip: 'B' }] },
    ], ids),
    /Layer claimed by two fusions/,
  );
  assert.throws(
    () => validateLayerFusions([
      { primary: 'a', companions: [{ id: 'b', chip: 'B' }] },
      { primary: 'b', companions: [{ id: 'c', chip: 'C' }] },
    ], ids),
    /Fusion primary is already a companion|Fusion companion is also a primary/,
  );
  assert.throws(
    () => validateLayerFusions([{ primary: 'a', companions: [{ id: 'b' }] }], ids),
    /missing chip label/,
  );
  assert.throws(
    () => validateLayerFusions([{ primary: 'a', companions: [{ id: 'b', chip: 'B', disabled: 'yes' }] }], ids),
    /disabled flag must be a boolean/,
  );
});
