import assert from 'node:assert/strict';
import test from 'node:test';

import { describeAge, parseArgs } from './build-amenities-pack.mjs';

test('flags are read, and an unknown one is an error rather than a shrug', () => {
  assert.deepEqual(parseArgs([]), { archiveFile: null, finessFile: null, out: null, check: false });
  assert.deepEqual(
    parseArgs(['--from', 'BPE25.zip', '--finess', 'f.csv', '--check']),
    { archiveFile: 'BPE25.zip', finessFile: 'f.csv', out: null, check: true },
  );
  // A monthly cron that silently downloads 142 MB because of a typo is the
  // failure this refuses.
  assert.throws(() => parseArgs(['--fines', 'f.csv']), /unknown argument --fines/);
  assert.throws(() => parseArgs(['--from']), /--from needs a value/);
  assert.throws(() => parseArgs(['--from', '--check']), /--from needs a value/);
});

test('a pack past its TTL is reported as needing a rebuild', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 8, 14);
  assert.match(describeAge(now - day, now), /^1 jour — frais$/);
  assert.match(describeAge(now - 29 * day, now), /29 jours — frais/);
  assert.match(describeAge(now - 40 * day, now), /40 jours — périmé, à reconstruire/);
});
