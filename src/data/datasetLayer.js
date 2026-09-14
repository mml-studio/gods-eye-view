/*
 * A MANIFEST AS A LAYER.
 *
 * `createDatasetLayer(manifest)` returns a module the manager registers like
 * any other. Underneath is the local GeoJSON loader — the same stems, cards,
 * label arbitration and horizon culling the bundled packs get — fed by the
 * source adapters instead of a bundled file. This module owns only what the
 * loader cannot know about a plugged dataset:
 *
 *   · WHEN to fetch. A viewport-scoped source is asked for the view the
 *     camera settled on, padded so a nudge does not refetch, and refetched
 *     when the view leaves that box — or when the last answer was clipped
 *     and the reader has since come closer (a clipped answer over a wide
 *     view says nothing about a narrow one).
 *   · WHEN NOT to. Above `maxSpanDeg` a viewport source is not asked at all:
 *     the row says "rapprochez-vous" as a prompt, not a fault (F6, and the
 *     manager's guidance carve-out). Nothing is drawn from orbit that would
 *     be a sample of a sample.
 *   · WHAT THE ROW SAYS. `n affichés / N connus` with the criterion, every
 *     time an answer was clipped (A5); the publisher and licence as the
 *     source line; a legend per group, or one swatch when the dataset is
 *     flat (D1 — a colour with no printed meaning is a promise).
 *   · WHAT A CARD SAYS. The manifest's `feature.details`, or — when it
 *     declares none — the first few short fields of the row, minus the
 *     columns that only locate or identify it. A line whose value is one of
 *     `feature.blank`, or the one spelling a detail declares `omitWhen` for,
 *     is not written at all: a card is worth its shortest true version.
 *   · WHETHER IT SAYS IT AT ALL. Above `DATASET_DENSE_FEATURE_COUNT` loaded
 *     features a card each is arithmetically impossible, so the overlay
 *     carries the title alone and the detail waits for the click. Derived from
 *     the load, not from the subject — `feature.ambient` overrules it.
 *
 * @module data/datasetLayer
 */

import * as Cesium from 'cesium';
import { LOCAL_OVERLAY_COHORT_LIMIT, createLocalGeoJsonLayer } from './localGeojson.js';
import { DATASET_OTHER_GROUP_KEY, datasetLayerId, datasetSourceLine } from './datasetManifest.js';
import { DATASET_RELAY_PATH, loadDatasetFeatures } from './datasetSources.js';
import {
  cleanFieldText,
  datasetDetailLine,
  fieldMatchKey,
  rowMatchesWhen,
} from './datasetFields.js';

/** How often a viewport-scoped layer re-checks the camera, ms. */
export const DATASET_VIEWPORT_POLL_MS = 2500;
/** Padding around the view a fetch covers, as a fraction of its span. */
export const DATASET_BBOX_PAD_RATIO = 0.2;
/** A clipped answer is refetched once the view has shrunk to this fraction of the loaded box. */
export const DATASET_REFETCH_SHRINK_RATIO = 0.5;
export const DATASET_CARD_MAX_LINE = 64;
export const DATASET_CARD_DEFAULT_LINES = 4;
/**
 * Above this many loaded features, the floating overlay carries the TITLE and
 * the detail waits for a click.
 *
 * Not a taste: it is the point where a card each stops being possible. The
 * shared host materializes at most {@link LOCAL_OVERLAY_COHORT_LIMIT} ambient
 * entries per source, so a set larger than that can never show a card for every
 * member — what it shows is a screen-grid sample of itself, drawn at full card
 * height, hiding the map underneath. Measured on GeoDAE over Lyon: 1 176
 * features in view, about 25 cards on screen, each seven lines tall, over 60 %
 * of the viewport covered by a 2 % sample.
 *
 * The threshold is the cohort limit itself rather than a tuned number, because
 * that is the fact it is about. `feature.ambient` in the manifest overrides it
 * in both directions.
 */
export const DATASET_DENSE_FEATURE_COUNT = LOCAL_OVERLAY_COHORT_LIMIT;

/**
 * Ceiling on the recall stem, in metres, for a set drawn as labels.
 *
 * The stem holds its mark 65 px above the ground at every range, which is a
 * recall device when a layer draws forty of them and a wall when it draws
 * twelve hundred: on the Lyon view every defibrillator contributed a ~58 m
 * pink shaft, and the aggregate read as hatching over the whole city. Capped in
 * metres the device survives — the mark is still lifted clear of the photoreal
 * mesh, which is the job — and the shaft shrinks to nothing as the camera pulls
 * back, exactly when the wall used to appear. Same mechanism, and the same
 * reasoning, as the airports pack's 150 m (`stemMaxHeightM` in `localGeojson.js`).
 */
export const DATASET_DENSE_STEM_MAX_M = 18;

/**
 * The camera's view rectangle in degrees, or null when it does not intersect
 * the globe (looking at space) — in which case nothing is fetched.
 * @param {object} viewer
 * @returns {{west:number, south:number, east:number, north:number}|null}
 */
export function viewRectangleDegrees(viewer) {
  const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
  let rectangle = null;
  try { rectangle = viewer?.camera?.computeViewRectangle?.(ellipsoid) || null; } catch { rectangle = null; }
  if (!rectangle) return null;
  const box = {
    west: Cesium.Math.toDegrees(rectangle.west),
    south: Cesium.Math.toDegrees(rectangle.south),
    east: Cesium.Math.toDegrees(rectangle.east),
    north: Cesium.Math.toDegrees(rectangle.north),
  };
  if (![box.west, box.south, box.east, box.north].every(Number.isFinite)) return null;
  if (box.east <= box.west || box.north <= box.south) return null;
  return box;
}

/** Widest side of a box, in degrees. */
export function bboxSpanDeg(box) {
  if (!box) return Number.POSITIVE_INFINITY;
  return Math.max(box.east - box.west, box.north - box.south);
}

/** Grow a box by a fraction of each side, clamped to the globe. */
export function padBbox(box, ratio = DATASET_BBOX_PAD_RATIO) {
  const dx = (box.east - box.west) * ratio;
  const dy = (box.north - box.south) * ratio;
  return {
    west: Math.max(-180, box.west - dx),
    south: Math.max(-90, box.south - dy),
    east: Math.min(180, box.east + dx),
    north: Math.min(90, box.north + dy),
  };
}

export function bboxContains(outer, inner) {
  if (!outer || !inner) return false;
  return inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;
}

/**
 * Whether a settled view calls for a new fetch.
 * @param {{loaded: object|null, view: object, truncated: boolean}} state
 * @returns {boolean}
 */
export function shouldRefetch({ loaded, view, truncated }) {
  if (!view) return false;
  if (!loaded) return true;
  if (!bboxContains(loaded, view)) return true;
  if (truncated && bboxSpanDeg(view) <= bboxSpanDeg(loaded) * DATASET_REFETCH_SHRINK_RATIO) return true;
  return false;
}

/** French grouping with a plain space — deterministic across runtimes and locales. */
function formatCount(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * The row's coverage line — the edge of what was drawn (H1) and the cap that
 * cut it (A5), in one string the manager prints as-is.
 * @param {object} report
 * @returns {string}
 */
export function datasetCoverageLine({ count = 0, total = null, truncated = false, unplaced = 0, scope = 'all', maxFeatures = 0, via = 'direct', gated = false, maxSpanDeg = 0 } = {}) {
  if (gated) return `au-delà de ${maxSpanDeg}° de vue, rien n'est demandé`;
  const parts = [];
  if (truncated && Number.isFinite(Number(total)) && total > count) {
    parts.push(`${formatCount(count)} affichés sur ${formatCount(total)} — plafond ${formatCount(maxFeatures)}, premières lignes`);
  } else if (scope === 'viewport') {
    parts.push(`${formatCount(count)} dans la vue`);
  } else if (truncated) {
    parts.push(`${formatCount(count)} affichés — plafond ${formatCount(maxFeatures)}`);
  } else {
    parts.push(`${formatCount(count)} objets, jeu entier`);
  }
  if (unplaced > 0) parts.push(`${formatCount(unplaced)} sans position`);
  if (via === 'relay') parts.push('via relais');
  return parts.join(' · ');
}

function cleanValue(value) {
  // Objects are clamped on the way out of JSON, scalars are not: the one
  // caller left is the TITLE, which the card host wraps and the label entry
  // clamps for its own one-line drawing (`clampOverlayLabelTitle`).
  if (value != null && typeof value === 'object') {
    return cleanFieldText(value).slice(0, DATASET_CARD_MAX_LINE);
  }
  return cleanFieldText(value);
}

const ID_LIKE = /(^|_)(id|gid|uuid|siren|siret|code|url|lien|link|photo|geom|wkt|the_geom|coordonnees|coordinates|__id)(_|$)/i;

/**
 * The card writer for a manifest: declared details first, otherwise the first
 * few short fields of the row that are not the title, a position or an id.
 * @param {object} manifest
 * @returns {(props: object) => {title: string, details: string[]}}
 */
/*
 * ── WHAT A PROGRESS LINE IS ALLOWED TO SAY ────────────────────────────────
 *
 * Measured 2026-09-09 (docs/DEMANDER-UNE-DONNEE.md), extrapolating the time
 * left from the pages already received in the SAME load:
 *
 *   150 pages (33,4 s) — after 10 % : +11 % · after 20 % : +9 % · 50 % : +7 %
 *    25 pages ( 3,3 s) — after 10 % : −45 % · after 20 % : −8 % · 50 % : +4 %
 *
 * The −45 % is the whole reason these thresholds exist: two pages are not a
 * rate, they are two samples. So a time is offered only past five requests AND
 * a fifth of the work, and only when more than three seconds are left — under
 * that, the countdown is gone before the eye reaches it. The figure is then
 * rounded coarser than its own error (±10 % of 30 s is ±3 s, so steps of 5 s):
 * a number nobody can catch out is worth more than a precise one that is wrong.
 *
 * The FRACTION has no such caveat. `meta.total` arrives with page one, so
 * "2 400 sur 16 474" is exact from the first response onward, and it is what
 * the line leads with.
 */

/** Five requests before a rate is a rate. */
export const PROGRESS_MIN_REQUESTS = 5;
/** And a fifth of the work, so a fast head does not promise a fast tail. */
export const PROGRESS_MIN_FRACTION = 0.2;
/** Under three seconds left, a countdown is noise. */
export const PROGRESS_MIN_REMAINING_MS = 3000;

/**
 * How long this load still has, or null when it cannot be said honestly.
 * @param {{received?: number, ceiling?: number|null, requests?: number, startedAt?: number}} progress
 * @param {number} [now]
 * @returns {number|null}
 */
export function datasetRemainingMs(progress, now = Date.now()) {
  const received = Number(progress?.received);
  const ceiling = Number(progress?.ceiling);
  const requests = Number(progress?.requests);
  const startedAt = Number(progress?.startedAt);
  if (!Number.isFinite(received) || received <= 0) return null;
  if (!Number.isFinite(ceiling) || ceiling <= received) return null;
  if (!Number.isFinite(requests) || requests < PROGRESS_MIN_REQUESTS) return null;
  // A zero stamp is a legal clock reading, not a missing one; only the
  // elapsed span below decides whether there is anything to extrapolate from.
  if (!Number.isFinite(startedAt) || startedAt < 0) return null;
  if (received / ceiling < PROGRESS_MIN_FRACTION) return null;
  const elapsed = now - startedAt;
  if (!(elapsed > 0)) return null;
  const remaining = elapsed * ((ceiling - received) / received);
  return remaining >= PROGRESS_MIN_REMAINING_MS ? remaining : null;
}

/** A duration rounded coarser than the error it carries. */
export function datasetRemainingLabel(ms) {
  if (!Number.isFinite(ms) || ms < PROGRESS_MIN_REMAINING_MS) return null;
  if (ms < 60000) return `environ ${Math.max(5, Math.round(ms / 5000) * 5)} secondes`;
  const minutes = Math.round(ms / 30000) / 2;
  return `environ ${minutes % 1 === 0 ? minutes : minutes.toFixed(1).replace('.', ',')} minutes`;
}

/**
 * What a load says about itself while it runs — the fraction always, the time
 * left only when the run has earned the right to guess it.
 * @param {object|null} progress
 * @param {number} [now]
 * @returns {string|null}
 */
export function datasetProgressLine(progress, now = Date.now()) {
  if (!progress) return null;
  const received = Number(progress.received);
  if (!Number.isFinite(received) || received < 0) return null;
  const ceiling = Number(progress.ceiling);
  const head = Number.isFinite(ceiling) && ceiling > 0
    ? `${formatCount(received)} sur ${formatCount(ceiling)}`
    : `${formatCount(received)} lignes reçues`;
  const remaining = datasetRemainingLabel(datasetRemainingMs(progress, now));
  return remaining ? `${head} — ${remaining}` : head;
}

export function datasetCardCopy(manifest, { titleOnly = false } = {}) {
  const geometryFields = new Set(Object.values(manifest.geometry || {}).filter((value) => typeof value === 'string'));
  const titleFields = new Set(manifest.feature?.title || []);
  const declared = manifest.feature?.details || [];
  const blankKeys = new Set((manifest.feature?.blank || []).map(fieldMatchKey));
  return (props) => {
    const row = props || {};
    const title = cleanValue(row.name) || manifest.label;
    // A label entry carries the title and nothing else. The title stays FULL
    // here: `createLocalInfrastructureOverlayEntry` clamps what it draws, and
    // the context card the click opens gets the name the register published.
    if (titleOnly) return { title, details: [] };
    const details = [];
    if (declared.length) {
      for (const detail of declared) {
        const line = datasetDetailLine(row, detail, { blankKeys, max: DATASET_CARD_MAX_LINE });
        if (line) details.push(line);
      }
      return { title, details };
    }
    for (const [key, raw] of Object.entries(row)) {
      if (details.length >= DATASET_CARD_DEFAULT_LINES) break;
      if (key === 'name' || key === 'tags' || geometryFields.has(key) || titleFields.has(key) || ID_LIKE.test(key)) continue;
      const value = cleanValue(raw);
      if (!value || value === title || value.length > DATASET_CARD_MAX_LINE || /^https?:\/\//i.test(value)) continue;
      if (value === 'true' || value === 'false' || value === 'f' || value === 't') continue;
      if (blankKeys.has(fieldMatchKey(value))) continue;
      details.push(`${key} : ${value}`);
    }
    return { title, details };
  };
}

/**
 * Which group a row falls in, for either form of `feature.group`.
 *
 * Rule form is ORDERED and first-match-wins, so a manifest states its priority
 * by writing it down: a defibrillator that is both open 24h/24 and freely
 * accessible is drawn as 24h/24, because that is the stronger of the two
 * answers to the question the reader asked.
 *
 * @param {object|null} group Normalized `feature.group`.
 * @returns {((props: object) => (string|null))|null}
 */
export function datasetGroupResolver(group) {
  if (!group) return null;
  if (group.rules) {
    return (props) => {
      for (const rule of group.rules) {
        if (rowMatchesWhen(props || {}, rule.when)) return rule.key;
      }
      return group.other ? DATASET_OTHER_GROUP_KEY : null;
    };
  }
  return (props) => {
    const value = props?.[group.field];
    const key = value == null ? '' : String(value).trim();
    if (Object.hasOwn(group.styles, key)) return key;
    return group.other ? DATASET_OTHER_GROUP_KEY : (key || null);
  };
}

/**
 * The chip strip for a manifest's `feature.filters`, with what each one would
 * leave on screen.
 *
 * The count is the DRAWN total of the groups the chip names, read off the same
 * tally the legend is built from — so a chip says how much of the map it keeps
 * before it is pressed, and the row's own count (which never moves) says how
 * much was loaded. Nothing is dropped by a chip; the marks of the groups it
 * does not name are hidden.
 *
 * @param {object} manifest
 * @param {object} params Current runtime params.
 * @param {Map<string,{total:number}>} tally
 * @returns {Array<object>}
 */
export function datasetFilterChips(manifest, params, tally) {
  const filters = manifest.feature?.filters;
  if (!filters || filters.length === 0) return [];
  const current = datasetActiveFilter(manifest, params);
  const totalOf = (keys) => keys.reduce((sum, key) => sum + (tally?.get?.(key)?.total || 0), 0);
  const loaded = [...(tally?.values?.() || [])].reduce((sum, bucket) => sum + (bucket.total || 0), 0);
  return filters.map((filter) => {
    const active = filter.id === current.id;
    const kept = filter.groups ? totalOf(filter.groups) : loaded;
    const title = filter.title
      ? `${filter.title} — ${formatCount(kept)} sur ${formatCount(loaded)}`
      : `${formatCount(kept)} sur ${formatCount(loaded)} dans la vue`;
    return {
      id: `filter:${filter.id}`,
      label: filter.label,
      active,
      state: active ? 'active' : 'idle',
      title,
      params: { filter: filter.id },
    };
  });
}

/** The filter a params bag selects, falling back to the first declared one. */
export function datasetActiveFilter(manifest, params) {
  const filters = manifest.feature?.filters || [];
  if (filters.length === 0) return { id: null, groups: null };
  const wanted = params?.filter;
  return filters.find((filter) => filter.id === wanted) || filters[0];
}

/**
 * The legend the row shows: one entry per group with its drawn count, or a
 * single swatch for a flat dataset.
 * @param {object} manifest
 * @param {Map<string,{total:number, visible:number}>} tally
 * @param {number} count
 * @returns {Array<{color:string, label:string, count?:number}>}
 */
export function datasetLegend(manifest, tally, count) {
  const group = manifest.feature?.group;
  if (!group) return [{ color: manifest.color, label: manifest.label, count }];
  const entries = [];
  for (const [value, style] of Object.entries(group.styles)) {
    const bucket = tally?.get?.(value);
    entries.push({ color: style.color, label: style.label, count: bucket ? bucket.total : 0 });
  }
  if (group.other) {
    const bucket = tally?.get?.(DATASET_OTHER_GROUP_KEY);
    entries.push({ color: group.other.color, label: group.other.label, count: bucket ? bucket.total : 0 });
  }
  return entries;
}

/**
 * What the floating overlay carries for this load: the manifest's word if it
 * gave one, otherwise the answer the feature count implies.
 *
 * Re-asked on every load rather than fixed at construction, because the same
 * manifest is dense over Lyon and sparse over the Creuse and the honest
 * rendering is not the same one.
 *
 * @param {object} manifest
 * @param {number} count Features this load actually produced.
 * @returns {'card'|'label'}
 */
export function datasetAmbientVariant(manifest, count) {
  const declared = manifest.feature?.ambient;
  if (declared === 'card' || declared === 'label') return declared;
  return Number(count) > DATASET_DENSE_FEATURE_COUNT ? 'label' : 'card';
}

/**
 * Build the layer module for one manifest.
 *
 * @param {object} manifest Normalized manifest.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string|null} [options.relay]
 * @param {(viewer: object) => (object|null)} [options.viewportOf] View box reader, injectable for tests.
 * @param {object} [options.loaderOptions] Extra options handed to the local loader (test seams).
 * @returns {object} Manager-compatible layer module.
 */
export function createDatasetLayer(manifest, {
  fetchImpl = globalThis.fetch,
  relay = DATASET_RELAY_PATH,
  viewportOf = viewRectangleDegrees,
  loaderOptions = {},
} = {}) {
  const id = datasetLayerId(manifest);
  const viewportScoped = manifest.source.scope === 'viewport';
  const group = manifest.feature?.group || null;
  let _bbox = null;
  let _loadedBbox = null;
  let _report = null;
  let _gated = false;
  let _loading = false;
  let _progress = null;
  let _error = null;
  let _enabled = false;
  let _abort = null;

  const groupStyles = group
    ? Object.fromEntries([
      ...Object.entries(group.styles).map(([value, style]) => [value, { color: style.color }]),
      ...(group.other ? [[DATASET_OTHER_GROUP_KEY, { color: group.other.color }]] : []),
    ])
    : null;
  const groupOf = datasetGroupResolver(group);
  const filters = manifest.feature?.filters || null;
  // Two writers, one per ambient variant, both built once: the variant is
  // re-decided per load and swapping a closure is cheaper than re-deriving the
  // blank set and the title field per feature.
  const cardWriter = datasetCardCopy(manifest);
  const labelWriter = datasetCardCopy(manifest, { titleOnly: true });
  let _ambient = datasetAmbientVariant(manifest, 0);

  const inner = createLocalGeoJsonLayer({
    id,
    url: null,
    name: manifest.name,
    color: manifest.color,
    icon: manifest.icon,
    source: datasetSourceLine(manifest),
    labels: true,
    ...(groupOf ? { groupOf, groupStyles } : {}),
    ...(filters ? {
      groupVisible: (groupKey, params) => {
        const active = datasetActiveFilter(manifest, params);
        return !active.groups || active.groups.includes(groupKey);
      },
      defaultParams: { filter: filters[0].id },
    } : {}),
    rowControls: (params, tally) => ({
      chips: datasetFilterChips(manifest, params, tally),
      legend: datasetLegend(manifest, tally, _report?.features?.length || 0),
    }),
    // Read per load, not captured: `_ambient` is settled the moment the
    // features land, before the loader walks them into records.
    overlayVariant: () => _ambient,
    stemMaxHeightM: () => (_ambient === 'label' ? DATASET_DENSE_STEM_MAX_M : Number.POSITIVE_INFINITY),
    cardCopy: (props, measured) => (_ambient === 'label' ? labelWriter(props, measured) : cardWriter(props, measured)),
    loadFeatures: async () => {
      _abort?.abort();
      _abort = typeof AbortController === 'function' ? new AbortController() : null;
      _loading = true;
      _error = null;
      // `startedAt` is stamped here, not on the first page, so the rate the
      // estimate is built from includes the time the source took to answer at
      // all — which is part of the wait the reader is actually sitting through.
      const startedAt = Date.now();
      _progress = null;
      try {
        const result = await loadDatasetFeatures(manifest, {
          bbox: viewportScoped ? _bbox : null,
          fetchImpl,
          relay,
          signal: _abort?.signal,
          onProgress: (step) => { _progress = { ...step, startedAt }; },
        });
        _report = result;
        // Settled HERE, between the answer and the walk that turns it into
        // records: everything downstream (`cardCopy`, `overlayVariant`,
        // `stemMaxHeightM`) reads it while building, so a load that arrives
        // dense cannot be drawn with the previous load's sparse rendering.
        _ambient = datasetAmbientVariant(manifest, result.features?.length || 0);
        return result.features;
      } catch (error) {
        _error = error?.message || String(error);
        throw error;
      } finally {
        _loading = false;
        _progress = null;
      }
    },
    ...loaderOptions,
  });

  async function loadForView(viewer) {
    const view = viewportOf(viewer);
    if (!view) return;
    if (bboxSpanDeg(view) > manifest.source.maxSpanDeg) {
      if (!_gated) {
        _gated = true;
        _loadedBbox = null;
        inner.invalidate(viewer);
      }
      return;
    }
    _gated = false;
    if (!shouldRefetch({ loaded: _loadedBbox, view, truncated: _report?.truncated === true })) return;
    const target = padBbox(view);
    _bbox = target;
    _loadedBbox = target;
    inner.invalidate(viewer);
    await inner.enable(viewer);
  }

  return {
    id,
    name: manifest.name,
    icon: manifest.icon,
    source: datasetSourceLine(manifest),
    updateInterval: viewportScoped ? DATASET_VIEWPORT_POLL_MS : manifest.refreshMs,
    statsRefreshInterval: 1000,

    /** The manifest this layer was built from. */
    getManifest: () => manifest,
    /** The last load report, for the panel and the QA harness. */
    getLoadReport: () => _report,
    /** What the floating overlay is carrying right now — 'card' or 'label'. */
    getAmbientVariant: () => _ambient,

    // Attached only when the manifest declares chips: the manager treats the
    // presence of `setParams` as "this layer has runtime parameters", and a
    // dataset with nothing to filter must keep rejecting them as it always did.
    ...(filters ? {
      setParams: (params) => inner.setParams?.(params) === true,
      getParams: () => inner.getParams?.() || null,
    } : {}),

    init: async () => {},

    enable: async (viewer) => {
      _enabled = true;
      if (viewportScoped) {
        await loadForView(viewer);
        return;
      }
      await inner.enable(viewer);
    },

    update: async (viewer) => {
      if (!_enabled) return;
      if (viewportScoped) {
        await loadForView(viewer);
        return;
      }
      if (manifest.refreshMs > 0) {
        inner.invalidate(viewer);
        await inner.enable(viewer);
      }
    },

    disable: (viewer) => {
      _enabled = false;
      _abort?.abort();
      inner.disable(viewer);
    },

    destroy: (viewer) => {
      _enabled = false;
      _abort?.abort();
      inner.destroy(viewer);
    },

    getRowControls: () => inner.getRowControls?.() || null,
    setRowControlsListener: (listener) => inner.setRowControlsListener?.(listener),

    getStats: () => {
      const base = inner.getStats();
      const count = base.count || 0;
      const coverage = datasetCoverageLine({
        count,
        total: _report?.total ?? null,
        truncated: _report?.truncated === true,
        unplaced: _report?.unplaced || 0,
        scope: manifest.source.scope,
        maxFeatures: manifest.source.maxFeatures,
        via: _report?.via,
        gated: _gated,
        maxSpanDeg: manifest.source.maxSpanDeg,
      });
      return {
        ...base,
        count,
        error: base.error || _error,
        loading: _loading,
        source: datasetSourceLine(manifest),
        coverage,
        // Only while a load is in flight: a finished layer has a coverage line,
        // which is the truth, and a leftover fraction next to it would be noise.
        ...(_loading && _progress ? { progress: _progress, progressLine: datasetProgressLine(_progress) } : {}),
        ...(_gated ? {
          status: 'zoom-in',
          loadingLabel: `Zoome : la source se charge pour une vue de moins de ${manifest.source.maxSpanDeg}°`,
        } : {}),
      };
    },
  };
}
