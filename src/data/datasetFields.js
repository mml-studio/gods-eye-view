/*
 * WHAT A PLUGGED ROW ACTUALLY SAYS.
 *
 * A manifest names the columns a card prints. Until this module existed it
 * printed them RAW, and a raw column from a public register is very often not
 * a sentence. Measured on GeoDAE (`datasets/defibrillateurs-geodae.json`), the
 * 888 defibrillators inside Lyon, read through the Tabular API on 2026-09-14:
 *
 *   `c_disp_j`  `{lundi,mardi,mercredi,jeudi,vendredi}`   338 rows
 *   `c_disp_j`  `{"non renseigné"}`                       326 rows
 *   `c_disp_h`  `{"heures ouvrables"}`                    571 rows
 *   `c_disp_h`  `{"non renseigné"}`                       270 rows
 *   `c_etat_fonct` `En fonctionnement`                    883 of 888 rows
 *   `c_com_nom` `Lyon`                                    888 of 888 rows
 *
 * Three separate problems, and each one costs a whole line of a card:
 *
 *   · A POSTGRES ARRAY LITERAL is not text. `{lundi,mardi,…}` is how a PostGIS
 *     export spells a list, and putting the braces and the quotes on screen
 *     shows the reader the transport instead of the answer. `parseListValue`
 *     unpacks it; `format: "days"` then compacts the French weekday runs it
 *     produces, because "lun–ven" is the same fact as five words.
 *   · AN ABSENCE DRESSED AS A VALUE. `{"non renseigné"}` is the register
 *     saying it does not know, spelled as data. A line that says "we do not
 *     know" is worth strictly less than no line: it costs the same height and
 *     displaces something true. `feature.blank` lists those spellings and they
 *     are dropped, field by field, not globally guessed at.
 *   · A CONSTANT. `État : En fonctionnement` on 99.4 % of the rows is not
 *     information about the row, it is information about the register. But the
 *     five rows where it is NOT that are the only ones a reader must not miss,
 *     so the line is not deleted — `omitWhen` suppresses the majority spelling
 *     and keeps every other one. The exception becomes the only thing printed.
 *
 * All three are declared in the manifest, never inferred: this module holds no
 * table of column names and knows nothing about defibrillators. Pure and
 * dependency-free (no Cesium, no DOM) so it runs identically in the browser and
 * under `node --test`.
 *
 * @module data/datasetFields
 */

/** Longest rendered detail line, before the ellipsis. */
export const DATASET_FIELD_MAX_LINE = 64;

/** French weekdays, Monday first — the order `format: "days"` compacts runs in. */
export const FRENCH_WEEKDAYS = Object.freeze([
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
]);

/** Their three-letter forms, same order. */
export const FRENCH_WEEKDAYS_SHORT = Object.freeze([
  'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim',
]);

/** Whitespace collapsed, ends trimmed; `null`/`undefined` become ''. */
export function cleanFieldText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value).replace(/\s+/g, ' ').trim(); } catch { return ''; }
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Case- and accent-insensitive key for comparing a cell against a declared value. */
export function fieldMatchKey(value) {
  return cleanFieldText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * A cell as a list of values.
 *
 * Handles the three spellings a tabular source actually hands over: a real
 * array, a Postgres text-array literal (`{a,b,"c, d"}` — quotes and backslash
 * escapes included, because a day list with a comma inside a quoted item is
 * legal and splitting on every comma would tear it in half), and a plain
 * scalar, which is a list of one.
 *
 * @param {unknown} raw
 * @returns {string[]} Non-empty values, in source order.
 */
export function parseListValue(raw) {
  if (Array.isArray(raw)) return raw.map(cleanFieldText).filter(Boolean);
  const text = cleanFieldText(raw);
  if (!text) return [];
  if (!(text.startsWith('{') && text.endsWith('}'))) return [text];
  const body = text.slice(1, -1);
  if (!body.trim()) return [];
  const out = [];
  let buffer = '';
  let quoted = false;
  let escaped = false;
  for (const char of body) {
    if (escaped) { buffer += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { out.push(buffer.trim()); buffer = ''; continue; }
    buffer += char;
  }
  out.push(buffer.trim());
  return out.filter(Boolean);
}

/**
 * Compact a list of French weekdays into runs: `lun–ven`, `lun–mer, ven`.
 *
 * Anything that is not a weekday is kept VERBATIM and in place — a GeoDAE day
 * list legitimately contains `7j/7` and `événements`, and a compactor that
 * dropped what it did not recognise would be deleting the only rows whose
 * opening hours are unusual. Weekdays are gathered and compacted, non-weekdays
 * follow in their own order.
 *
 * @param {string[]} values
 * @returns {string} One rendered line, '' when there is nothing to render.
 */
export function compactFrenchDays(values) {
  const indices = [];
  const passthrough = [];
  for (const value of values || []) {
    const index = FRENCH_WEEKDAYS.indexOf(fieldMatchKey(value));
    if (index >= 0) {
      if (!indices.includes(index)) indices.push(index);
    } else {
      const text = cleanFieldText(value);
      if (text && !passthrough.includes(text)) passthrough.push(text);
    }
  }
  indices.sort((a, b) => a - b);
  const runs = [];
  let start = null;
  let previous = null;
  const flush = () => {
    if (start === null) return;
    // A two-day "run" is printed as two days: `lun, mar` is no longer than
    // `lun–mar` and does not ask the reader to expand a range to count it.
    runs.push(previous - start >= 2
      ? `${FRENCH_WEEKDAYS_SHORT[start]}–${FRENCH_WEEKDAYS_SHORT[previous]}`
      : Array.from({ length: previous - start + 1 }, (_, offset) => FRENCH_WEEKDAYS_SHORT[start + offset]).join(', '));
    start = null;
  };
  for (const index of indices) {
    if (start === null) { start = index; previous = index; continue; }
    if (index === previous + 1) { previous = index; continue; }
    flush();
    start = index;
    previous = index;
  }
  flush();
  return [...runs, ...passthrough].join(', ');
}

/** Truncate to {@link DATASET_FIELD_MAX_LINE}, ellipsis included in the budget. */
export function clampFieldLine(text, max = DATASET_FIELD_MAX_LINE) {
  const limit = Math.max(1, Math.floor(Number(max) || DATASET_FIELD_MAX_LINE));
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

/**
 * The values of one field, as the manifest asked for them and with the
 * register's spellings of "I do not know" removed.
 *
 * @param {object} row Unwrapped row properties.
 * @param {{field: string, format?: string|null}} detail
 * @param {Set<string>} blankKeys Match keys of `feature.blank`.
 * @returns {string[]}
 */
export function datasetFieldValues(row, detail, blankKeys) {
  const raw = row?.[detail?.field];
  const values = detail?.format === 'list' || detail?.format === 'days'
    ? parseListValue(raw)
    : [cleanFieldText(raw)].filter(Boolean);
  if (!blankKeys || blankKeys.size === 0) return values;
  return values.filter((value) => !blankKeys.has(fieldMatchKey(value)));
}

/**
 * One rendered card line, or null when the field has nothing to say here.
 *
 * Null has three causes and they are deliberately indistinguishable to the
 * caller: the column is empty, everything in it was a declared blank, or the
 * value is the one `omitWhen` spelling this line exists to be silent about. In
 * all three the honest card is one line shorter.
 *
 * @param {object} row
 * @param {{field:string,label?:string|null,unit?:string|null,format?:string|null,omitWhen?:ReadonlyArray<string>|null}} detail
 * @param {{blankKeys?: Set<string>, max?: number}} [options]
 * @returns {string|null}
 */
export function datasetDetailLine(row, detail, { blankKeys = null, max = DATASET_FIELD_MAX_LINE } = {}) {
  if (!detail?.field) return null;
  const values = datasetFieldValues(row, detail, blankKeys);
  if (values.length === 0) return null;
  const omit = detail.omitWhen && detail.omitWhen.length
    ? new Set(detail.omitWhen.map(fieldMatchKey))
    : null;
  // Every value suppressed means the row holds only the majority spelling; a
  // row that ALSO holds something else keeps the line, minus the majority.
  const kept = omit ? values.filter((value) => !omit.has(fieldMatchKey(value))) : values;
  if (kept.length === 0) return null;
  const body = detail.format === 'days' ? compactFrenchDays(kept) : kept.join(', ');
  if (!body) return null;
  const label = detail.label ? `${detail.label} : ` : '';
  const unit = detail.unit ? ` ${detail.unit}` : '';
  return clampFieldLine(`${label}${body}${unit}`, max);
}

/**
 * Whether a row satisfies a `when` clause: every named field must hold at
 * least one of the values listed for it.
 *
 * The row's cell is read as a LIST, so `{24h/24}` matches `"24h/24"` without
 * the manifest having to know that the column is a Postgres array — the same
 * blindness to transport the detail lines get.
 *
 * @param {object} row
 * @param {Record<string, ReadonlyArray<string>>} when
 * @returns {boolean}
 */
export function rowMatchesWhen(row, when) {
  if (!when) return false;
  for (const [field, accepted] of Object.entries(when)) {
    const wanted = new Set((accepted || []).map(fieldMatchKey));
    if (wanted.size === 0) return false;
    const present = parseListValue(row?.[field]).map(fieldMatchKey);
    if (!present.some((value) => wanted.has(value))) return false;
  }
  return true;
}
