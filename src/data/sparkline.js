/**
 * @module sparkline
 *
 * A time series, drawn in text, for a card that has one line to spare.
 *
 * Extracted from `rteGenerationFeed.js`, which wrote it for production groups,
 * when the Hub'Eau layer needed the same picture for a river. Extracted rather
 * than copied: the two layers must agree on what a gap looks like, because a
 * reader who learns "·  means nobody reported" on one card and sees a zero bar
 * on the other has been told two different things by the same console.
 *
 * THE ONE DECISION IN HERE: a missing sample is `·`, never `▁`.
 *
 * `▁` is the lowest bar and it means "measured, and low". A feed that skipped a
 * quarter of an hour has not measured a low value — it has measured nothing —
 * and rendering that as the bottom of the scale invents a reading. This matters
 * more for hydrometry than for generation: about 40 % of nominally-active
 * French gauges are silent at any given moment, so gaps are the normal case
 * rather than the exception.
 *
 * A NEGATIVE value renders `▽`. Discharge can genuinely go negative on a tidal
 * reach, and a pumped-storage group consuming power is negative by design;
 * clamping either to zero would erase the fact worth seeing.
 */

/** The eight bar glyphs, lowest first. */
const BARS = '▁▂▃▄▅▆▇█';

/**
 * Draw a series as bar glyphs.
 *
 * The scale runs from ZERO to `reference` (or to the largest absolute value in
 * the window when no reference is given). Zero-based on purpose: a river
 * holding 615–620 m³/s for a day should render as a flat line, because it IS
 * flat, and a min-to-max scale would turn 5 m³/s of noise into a dramatic
 * hydrograph. The caller is expected to print the window's actual range beside
 * the glyphs, so the amplitude the flat line hides is still stated.
 *
 * @param {Array<number|null|undefined>} history Ordered oldest → newest.
 * @param {number|null} [reference] Top of the scale; omit to use the window max.
 * @returns {string} One glyph per sample, or '' when there is nothing to draw.
 */
export function textSparkline(history, reference = null) {
  if (!Array.isArray(history) || !history.length) return '';
  const top = Number.isFinite(reference) && reference > 0
    ? reference
    : Math.max(...history.map((value) => (Number.isFinite(value) ? Math.abs(value) : 0)), 0);
  // Everything is zero (or unmeasured): a flat floor is the honest picture, and
  // dividing by the max would be dividing by zero.
  if (!top) return history.map((value) => (Number.isFinite(value) ? '▁' : '·')).join('');
  let out = '';
  for (const value of history) {
    if (!Number.isFinite(value)) { out += '·'; continue; }
    if (value < 0) { out += '▽'; continue; }
    if (value === 0) { out += '▁'; continue; }
    const ratio = Math.min(1, value / top);
    out += BARS[Math.min(BARS.length - 1, Math.max(1, Math.round(ratio * (BARS.length - 1))))];
  }
  return out;
}

/**
 * Reduce a series to at most `width` samples by averaging each bucket.
 *
 * A 24-hour Hub'Eau window is 144 samples at the 10-minute cadence and 288 at
 * the 5-minute one, and no card is 288 characters wide. Averaging rather than
 * decimating, so a spike between two kept samples is not silently dropped — a
 * flood peak that falls in the discarded 95 % of a decimated series is exactly
 * the sample a reader opened the card for.
 *
 * A bucket holding ONLY gaps stays a gap: averaging over nothing must not
 * become a number.
 *
 * @param {Array<number|null|undefined>} history Ordered oldest → newest.
 * @param {number} width Target sample count.
 * @returns {Array<number|null>}
 */
export function bucketSeries(history, width) {
  const source = Array.isArray(history) ? history : [];
  const cap = Math.max(1, Math.floor(Number(width) || 0));
  if (source.length <= cap) return source.map((v) => (Number.isFinite(v) ? v : null));
  const out = [];
  for (let i = 0; i < cap; i += 1) {
    const from = Math.floor((i * source.length) / cap);
    const to = Math.max(from + 1, Math.floor(((i + 1) * source.length) / cap));
    let sum = 0;
    let seen = 0;
    for (let j = from; j < to && j < source.length; j += 1) {
      const value = source[j];
      if (Number.isFinite(value)) { sum += value; seen += 1; }
    }
    out.push(seen ? sum / seen : null);
  }
  return out;
}

/** The two gauge glyphs, and the mark for a value that runs past the scale. */
export const GAUGE_FILLED = '█';
export const GAUGE_EMPTY = '░';
const GAUGE_OVERFLOW = '▸';

/** Default gauge width, in cells. */
export const TEXT_GAUGE_WIDTH = 40;

/**
 * Draw ONE value against ONE reference, as a filled bar and its remainder.
 *
 * A different picture from {@link textSparkline} and a different question: the
 * sparkline draws a series against time, this draws a single reading against
 * something it is worth comparing to — this month's discharge against this
 * month's multi-year mean, on the Hub'Eau card that motivated it.
 *
 * THE ONE DECISION IN HERE: the remainder is `░`, never `·`.
 *
 * `·` already means "nobody measured this" across every sparkline in the
 * console, and the empty half of a gauge is the opposite — it is measured, and
 * it is the part that is NOT there today. Reusing the gap glyph would tell a
 * reader who learned it on the hydrograph that half the reference is missing
 * data. `░` is the same cell, half-inked, which is what it depicts.
 *
 * OVER the reference the bar fills completely and carries `▸`. The alternative
 * — stretching the scale to the value — moves the reference off the right edge
 * and destroys the one thing the bar is for: 100 % is always the far edge, so
 * two stations can be compared by eye. The caller prints the real percentage
 * beside the glyphs, so nothing is lost by clamping the drawing.
 *
 * Under the reference the bar never fills its last cell, and a value above
 * zero always lights its first: "99 %" must not render as a full bar and "1 %"
 * must not render as an empty one.
 *
 * @param {number} value
 * @param {number} reference Top of the scale; must be > 0.
 * @param {number} [width] Cell count.
 * @returns {string} '' when the comparison cannot be drawn.
 */
export function textGauge(value, reference, width = TEXT_GAUGE_WIDTH) {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || !(reference > 0)) return '';
  const cells = Math.max(1, Math.floor(Number(width) || 0));
  const ratio = value / reference;
  if (ratio >= 1) return GAUGE_FILLED.repeat(cells) + (ratio > 1 ? GAUGE_OVERFLOW : '');
  // A negative discharge — a tidal reach, a gauge running backwards — has no
  // share of the mean to fill. The percentage on the line says so in words.
  if (!(ratio > 0)) return GAUGE_EMPTY.repeat(cells);
  const filled = Math.min(cells - 1, Math.max(1, Math.round(ratio * cells)));
  return GAUGE_FILLED.repeat(filled) + GAUGE_EMPTY.repeat(cells - filled);
}

/**
 * Does this line carry a gauge?
 *
 * The card uses it to decide which ONE bar it draws — see `buildHubeauCard`.
 * NOT a universal detector: a sparkline pinned at its top is a run of `█` too,
 * so this is asked only of lines a gauge could have produced.
 * @param {string} line
 * @returns {boolean}
 */
export function hasTextGauge(line) {
  const text = String(line ?? '');
  return text.includes(GAUGE_FILLED) || text.includes(GAUGE_EMPTY);
}
