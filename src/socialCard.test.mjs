// The social card's one build-time rewrite, pinned as a pure function.
//
// This exists because the failure is silent on both sides. A relative
// `og:image` renders a perfectly normal-looking page — Facebook and LinkedIn
// simply drop the image and show a card with a title and nothing else, and no
// build step, test or health probe notices. A typo'd origin is worse: the tag
// ships pointing at `undefined/og.png`, which is also a blank card.
//
// So the two decisions are pinned here: what counts as an origin, and which
// tags get rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_ORIGIN_DEFAULT,
  absolutizeSocialUrls,
  resolveSocialOrigin,
} from '../vite.config.js';

test('an unset or unusable origin falls back to the public site', () => {
  for (const value of [undefined, null, '', '   ', 'pas-une-url', 'ftp://exemple.fr', '//exemple.fr']) {
    assert.equal(resolveSocialOrigin(value), SOCIAL_ORIGIN_DEFAULT, `for ${JSON.stringify(value)}`);
  }
});

test('a configured origin keeps its host and loses everything after it', () => {
  assert.equal(resolveSocialOrigin('https://exemple.fr'), 'https://exemple.fr');
  // The trailing slash is what would otherwise produce `https://exemple.fr//og.png`.
  assert.equal(resolveSocialOrigin('https://exemple.fr/'), 'https://exemple.fr');
  assert.equal(resolveSocialOrigin('https://exemple.fr/sous/dossier'), 'https://exemple.fr');
  assert.equal(resolveSocialOrigin('  https://exemple.fr  '), 'https://exemple.fr');
  assert.equal(resolveSocialOrigin('http://localhost:4173'), 'http://localhost:4173');
});

test('both image tags are made absolute, property and name alike', () => {
  const source = [
    '<meta property="og:image" content="/og.png" />',
    '<meta name="twitter:image" content="/og.png" />',
  ].join('\n');
  const { html, changed } = absolutizeSocialUrls(source, 'https://exemple.fr');
  assert.equal(changed, true);
  assert.match(html, /property="og:image" content="https:\/\/exemple\.fr\/og\.png"/);
  assert.match(html, /name="twitter:image" content="https:\/\/exemple\.fr\/og\.png"/);
});

test('the tags that are not URLs are left alone', () => {
  // `og:image:width` starts with the same seven characters as `og:image`, and
  // a loose pattern would rewrite the alt text too.
  const source = [
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:alt" content="Une carte sombre" />',
    '<meta property="og:title" content="Surplomb — La France au rayon X" />',
    '<meta property="og:description" content="Tout ce que vous n’auriez jamais pensé à chercher." />',
  ].join('\n');
  const { html, changed } = absolutizeSocialUrls(source, 'https://exemple.fr');
  assert.equal(changed, false);
  assert.equal(html, source);
});

test('an already absolute URL is not prefixed a second time', () => {
  const source = '<meta property="og:image" content="https://cdn.exemple.fr/og.png" />';
  const { html, changed } = absolutizeSocialUrls(source, 'https://exemple.fr');
  assert.equal(changed, false);
  assert.equal(html, source);
});

test('the shipped page carries the tags the rewrite depends on', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  // The card is worthless without a large-image hint, and LinkedIn and Slack
  // both read the dimensions to lay the card out before the image arrives.
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  // No og:url: see the comment in index.html. A canonical URL in the bundle
  // would make every self-hosted instance advertise ours.
  assert.equal(/property="og:url"/.test(html), false);
  const { changed } = absolutizeSocialUrls(html, 'https://exemple.fr');
  assert.equal(changed, true, 'index.html should still have a relative og:image to rewrite');
});
