import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AMENITIES_CACHE_VERSION,
  AMENITIES_SHARD_DEG,
  amenitiesShardKey,
  amenitiesShardPath,
  amenitiesShardsForBox,
  amenitySitesInBox,
  clearAmenitiesShardCache,
  readAmenitiesPack,
  writeAmenitiesPack,
} from './amenitiesPack.js';
import { AMENITIES_MAX_BOX_DEG } from './amenitiesFeed.js';

const record = (lat, lon, extra = {}) => ({
  id: `a:${lat},${lon}`,
  family: 'pharmacie',
  register: 'finess',
  lat,
  lon,
  precision: 'numero',
  count: 1,
  names: ['X'],
  ...extra,
});

const entryOf = (records) => ({
  version: AMENITIES_CACHE_VERSION,
  at: Date.now(),
  payload: {
    records,
    mesh: [[48.85, 2.35, 8, 3]],
    rollup: { departements: [{ code: '75', communes: 1, share: 1, bin: 0 }] },
    provenance: { edition: 25, year: 2025, dots: records.length },
  },
});

async function inTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gev-amenities-'));
  try {
    return await run(path.join(root, 'amenities-fr'));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    clearAmenitiesShardCache();
  }
}

test('a shard is wider than the widest query, so a box reads at most four', () => {
  assert.ok(AMENITIES_SHARD_DEG > AMENITIES_MAX_BOX_DEG);
  const worst = amenitiesShardsForBox({
    // Straddling a cell boundary on both axes is the worst case there is.
    south: AMENITIES_SHARD_DEG - 0.01,
    north: AMENITIES_SHARD_DEG - 0.01 + AMENITIES_MAX_BOX_DEG,
    west: AMENITIES_SHARD_DEG - 0.01,
    east: AMENITIES_SHARD_DEG - 0.01 + AMENITIES_MAX_BOX_DEG,
  });
  assert.equal(worst.length, 4);
});

test('negative coordinates get one key, not a signed-zero pair', () => {
  // Réunion is south of the equator and Guyane is west of Greenwich: a key
  // built by truncation rather than floor would put -0.2 and +0.2 in one cell
  // and lose half of both.
  assert.equal(amenitiesShardKey(-21.1, 55.5), '-43_111');
  assert.notEqual(amenitiesShardKey(-0.2, 0.2), amenitiesShardKey(0.2, 0.2));
  assert.equal(amenitiesShardKey(0, 0), '0_0');
});

test('a box query returns exactly what a full scan would', async () => {
  await inTempDir(async (dir) => {
    const records = [];
    for (let i = 0; i < 400; i += 1) {
      records.push(record(
        Number((41 + (i * 0.0237) % 10).toFixed(5)),
        Number((-5 + (i * 0.0413) % 15).toFixed(5)),
      ));
    }
    // Two DOM, because they are the reason the keys have to handle both signs.
    records.push(record(-21.1, 55.5), record(4.9, -52.3), record(16.25, -61.55));
    const entry = entryOf(records);
    await writeAmenitiesPack(path.join(dir, 'pack.json'), entry);

    const onDisk = await readAmenitiesPack(path.join(dir, 'pack.json'));
    assert.ok(onDisk, 'pack should read back');
    assert.equal(onDisk.payload.records, undefined, 'records must not be in pack.json');

    for (const centre of [[48.8, 2.3], [-21.1, 55.5], [4.9, -52.3], [16.25, -61.55], [45.0, 0.0]]) {
      const box = {
        south: centre[0] - 0.17,
        north: centre[0] + 0.17,
        west: centre[1] - 0.17,
        east: centre[1] + 0.17,
      };
      const scanned = records.filter((r) => r.lat >= box.south && r.lat <= box.north
        && r.lon >= box.west && r.lon <= box.east);
      const sharded = await amenitySitesInBox(onDisk, box);
      assert.deepEqual(
        sharded.map((r) => r.id).sort(),
        scanned.map((r) => r.id).sort(),
        `box around ${centre} disagrees`,
      );
    }
  });
});

test('every record lands in the shard its own key names', async () => {
  await inTempDir(async (dir) => {
    const records = [record(48.86, 2.34), record(48.86, 2.36), record(-21.1, 55.5)];
    await writeAmenitiesPack(path.join(dir, 'pack.json'), entryOf(records));
    const entry = await readAmenitiesPack(path.join(dir, 'pack.json'));
    let counted = 0;
    for (const [key, count] of Object.entries(entry.payload.shards.cells)) {
      counted += count;
      await fsp.access(amenitiesShardPath(dir, key));
    }
    assert.equal(counted, records.length);
  });
});

test('an in-memory entry answers from its records, with no shards on disk', async () => {
  const entry = entryOf([record(48.86, 2.34), record(10, 10)]);
  const found = await amenitySitesInBox(entry, { south: 48.5, north: 49, west: 2, east: 2.5 });
  assert.deepEqual(found.map((r) => r.id), ['a:48.86,2.34']);
});

test('a pack of the wrong version is refused, and says so', async () => {
  await inTempDir(async (dir) => {
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'pack.json');
    await fsp.writeFile(file, JSON.stringify({ version: 1, at: Date.now(), payload: {} }));
    const warnings = [];
    assert.equal(await readAmenitiesPack(file, (m) => warnings.push(m)), null);
    assert.match(warnings.join(' '), /version 1.*needs 3/);
    assert.match(warnings.join(' '), /amenities:pack/);
  });
});

test('a missing pack is silent, an unreadable one is not', async () => {
  await inTempDir(async (dir) => {
    const warnings = [];
    assert.equal(await readAmenitiesPack(path.join(dir, 'pack.json'), (m) => warnings.push(m)), null);
    assert.deepEqual(warnings, [], 'no pack yet is not a problem to report');

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'pack.json'), 'not json');
    assert.equal(await readAmenitiesPack(path.join(dir, 'pack.json'), (m) => warnings.push(m)), null);
    assert.equal(warnings.length, 1);
  });
});

test('writing refuses a directory that is not already a pack', async () => {
  await inTempDir(async (dir) => {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'thesis.txt'), 'do not delete me');
    await assert.rejects(
      writeAmenitiesPack(path.join(dir, 'pack.json'), entryOf([record(48.86, 2.34)])),
      /not a pack directory/,
    );
    await fsp.access(path.join(dir, 'thesis.txt'));
  });
});

test('a rebuild replaces the previous pack rather than merging with it', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'pack.json');
    await writeAmenitiesPack(file, entryOf([record(48.86, 2.34), record(-21.1, 55.5)]));
    const first = Object.keys((await readAmenitiesPack(file)).payload.shards.cells);
    assert.equal(first.length, 2);

    // The Réunion record is gone; its shard file must go with it, or a later
    // read would serve a point no register still publishes.
    await writeAmenitiesPack(file, entryOf([record(48.86, 2.34)]));
    const second = await readAmenitiesPack(file);
    assert.deepEqual(Object.keys(second.payload.shards.cells), [amenitiesShardKey(48.86, 2.34)]);
    assert.deepEqual(await fsp.readdir(path.join(dir, 'sites')), [`${amenitiesShardKey(48.86, 2.34)}.json.gz`]);
  });
});
