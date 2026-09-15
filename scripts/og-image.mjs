// Build the social share card — `public/og.png`, 1200×630.
//
// WHY THIS IS RENDERED AND NOT DRAWN BY HAND. The card has to carry the
// wordmark exactly as the app draws it: JetBrains Mono 600 at 8 px of tracking,
// with the cyan glow. Hand-authoring that in SVG means re-deriving glyph
// metrics and re-tuning the blur every time `style.css` moves. Chrome already
// owns both, so the card is a real page screenshotted at the card's size, and
// the tokens below are copied from `:root` rather than invented.
//
// THE FONTS ARE INLINED AS DATA URLS, not linked. A `file://` page cannot fetch
// `/fonts/inter-latin.woff2`, and a page pointed at the dev server would make
// this script depend on a running server to produce a static asset. Inlining
// the two subsets the card actually uses keeps it a pure function of the repo.
//
//     npm run og:build
//
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'og.png');

/** The card's copy, in one place so a rewrite is a one-line diff. */
export const CARD = Object.freeze({
  hook: 'La France au rayon X.',
  sub: 'Tout ce que vous n\u2019auriez jamais pensé à chercher.',
  proof: '59 COUCHES PUBLIQUES · 56 SANS CLÉ · OPEN SOURCE',
  slogan: 'AUCUN ANGLE MORT',
});

async function dataUrl(rel, mime) {
  const buf = await readFile(path.join(ROOT, rel));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function cardHtml() {
  const [inter, mono, logo] = await Promise.all([
    dataUrl('public/fonts/inter-latin.c9407645.woff2', 'font/woff2'),
    dataUrl('public/fonts/jetbrains-mono-latin.1e06740a.woff2', 'font/woff2'),
    dataUrl('public/logo.svg', 'image/svg+xml'),
  ]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Inter'; font-weight: 300 600; src: url('${inter}') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 300 700; src: url('${mono}') format('woff2'); }
/* Copied from :root in style.css — keep in step when the tokens move. */
:root { --bg-dark:#0a0a0f; --accent:#00d4ff; --accent-glow:rgba(0,212,255,0.4);
        --text-primary:#e8eaed; --text-secondary:rgba(232,234,237,0.68);
        --glass-border:rgba(126,176,204,0.28); }
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1200px; height:630px; background:var(--bg-dark); overflow:hidden;
       font-family:'Inter',sans-serif; -webkit-font-smoothing:antialiased; }
/* The globe's own light: one off-centre cyan bloom, nothing else. */
.bloom { position:absolute; inset:0;
  background: radial-gradient(900px 620px at 88% 12%, rgba(0,212,255,0.16), transparent 62%),
              radial-gradient(700px 500px at 8% 96%, rgba(0,212,255,0.07), transparent 60%); }
.frame { position:absolute; inset:28px; border:1px solid var(--glass-border); border-radius:16px; }
.card { position:absolute; inset:28px; padding:64px 72px; display:flex; flex-direction:column;
        justify-content:space-between; }
.brand { display:flex; align-items:center; gap:16px;
  font-family:'JetBrains Mono',monospace; font-weight:600; font-size:34px; letter-spacing:8px;
  color:var(--text-primary); text-shadow:0 0 30px var(--accent-glow); }
.brand img { width:44px; height:44px; }
.brand .accent { color:var(--accent); font-weight:300; }
.hook { font-size:82px; font-weight:600; line-height:1.03; letter-spacing:-2px;
        color:var(--text-primary); }
.sub { margin-top:22px; font-size:38px; font-weight:300; line-height:1.25;
       color:var(--text-secondary); max-width:960px; }
.foot { display:flex; align-items:baseline; justify-content:space-between; gap:64px;
        font-family:'JetBrains Mono',monospace; font-size:18px; letter-spacing:3px;
        white-space:nowrap; }
.foot .proof { color:var(--text-secondary); }
.foot .slogan { color:var(--accent); text-shadow:0 0 22px var(--accent-glow); }
</style></head><body>
<div class="bloom"></div><div class="frame"></div>
<div class="card">
  <div class="brand"><img src="${logo}" alt=""><span>SUR<span class="accent">PLOMB</span></span></div>
  <div><div class="hook">${CARD.hook}</div><div class="sub">${CARD.sub}</div></div>
  <div class="foot"><span class="proof">${CARD.proof}</span><span class="slogan">${CARD.slogan}</span></div>
</div></body></html>`;
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(await cardHtml(), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // A missing face falls back to Helvetica without a word of warning, and the
  // card still looks plausible — so assert both are really in use.
  const faces = await page.evaluate(() => [
    document.fonts.check('600 82px Inter'),
    document.fonts.check('600 18px "JetBrains Mono"'),
  ]);
  if (!faces[0] || !faces[1]) {
    throw new Error(`[og] font fallback: Inter=${faces[0]} JetBrainsMono=${faces[1]}`);
  }
  const png = await page.screenshot({ type: 'png' });
  await writeFile(OUT, png);
  console.log(`[og] ${path.relative(ROOT, OUT)} — 1200×630, ${(png.length / 1024).toFixed(1)} kB`);
} finally {
  await browser.close();
}
