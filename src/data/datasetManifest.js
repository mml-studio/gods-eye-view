/*
 * DATASET MANIFEST — the one document a plugged dataset is.
 *
 * WHY THIS EXISTS. Adding a layer to this fork used to cost 17 to 23 files:
 * a module, a feed, a proxy plugin, a share token, a taxonomy row, a credit
 * entry, a voice alias, two README tables, a QA harness. Eleven of those are
 * one-line registry edits whose only purpose is to state a fact about the
 * dataset — where it comes from, what group it sits in, who publishes it,
 * under which licence. A manifest states those facts ONCE, as data, and the
 * dataset box (`datasetLayer.js`, `datasetBox.js`) derives every registry
 * entry from it.
 *
 * A manifest is deliberately NOT a layer module. It declares a SOURCE (where
 * the rows are and how to ask for them), a GEOMETRY (how a row becomes a point
 * on the globe), a FEATURE (what a mark says when it is read), and an
 * ATTRIBUTION (who to thank and under which terms). Everything about drawing
 * — stems, cards, label arbitration, horizon culling, ground sampling — is the
 * local GeoJSON loader's, shared with the bundled packs, and a manifest never
 * gets to reinvent it.
 *
 * STRICT, NOT PERMISSIVE. The registries this replaces were enforced at boot:
 * a layer without a category was a boot failure, not a row that landed in
 * whatever group it was appended next to. A manifest keeps that property —
 * `datasetManifestFaults()` lists every fault, `normalizeDatasetManifest()`
 * throws on the first, and the catalog test refuses any `datasets/*.json` that
 * does not pass. Defaults exist only where the doctrine has a safe answer
 * (the `plugged` group, a 5 000-feature ceiling, `periodic` cadence).
 *
 * @module data/datasetManifest
 */

/** Schema version written into every manifest the app produces. */
export const DATASET_MANIFEST_VERSION = 1;

/** Prefix every dataset layer id carries, so it can never collide with a core layer. */
export const DATASET_LAYER_ID_PREFIX = 'ds-';

/** The group a manifest lands in when it names none. */
export const DATASET_DEFAULT_CATEGORY = 'plugged';

/**
 * Source kinds the adapters in `datasetSources.js` know how to read.
 *
 *   geojson       one FeatureCollection (or an array of Features) at a URL
 *   geojsonl      newline-delimited Features at a URL — the bundled packs' format
 *   csv           a delimited text file at a URL; rows become points via `geometry`
 *   datagouv      a data.gouv.fr resource, read through the Tabular API page by
 *                 page (typed rows, bbox filters, no download) — falls back to
 *                 the raw file when the resource is not tabularised
 *   wfs           an OGC WFS 2.0 GetFeature (IGN Géoplateforme and any GeoServer)
 *   opendatasoft  an Opendatasoft portal dataset, Explore API v2.1 GeoJSON export
 */
export const DATASET_SOURCE_KINDS = Object.freeze([
  'geojson', 'geojsonl', 'csv', 'datagouv', 'wfs', 'opendatasoft',
]);

/** Kinds that can be asked for one bounding box at a time. */
export const DATASET_BBOX_KINDS = Object.freeze(new Set(['datagouv', 'wfs', 'opendatasoft']));

/** Kinds whose rows carry their own GeoJSON geometry and need no `geometry` block. */
export const DATASET_NATIVE_GEOMETRY_KINDS = Object.freeze(new Set(['geojson', 'geojsonl', 'wfs', 'opendatasoft']));

export const DATASET_SCOPES = Object.freeze(['all', 'viewport']);
export const DATASET_COVERAGES = Object.freeze(['global', 'fr', 'us', 'cities']);
export const DATASET_CADENCES = Object.freeze(['live', 'periodic', 'static']);

/**
 * Feature ceiling, in the doctrine's own words (CARTOGRAPHIE H3): the
 * GeoJSON / tiles frontier sits between 20 000 and 30 000 entities. A manifest
 * may ask for fewer, never for more — above this the answer is vector tiles,
 * which is a different transport and not something a manifest can declare.
 */
export const DATASET_MAX_FEATURES_CEILING = 30000;
/** What a manifest gets when it does not say (A5: the cap is still declared on the row). */
export const DATASET_DEFAULT_MAX_FEATURES = 5000;
/** Widest view, in degrees of latitude, a viewport-scoped source is asked for (F6). */
export const DATASET_DEFAULT_MAX_SPAN_DEG = 3;
export const DATASET_MAX_DETAILS = 8;
/**
 * What the floating overlay beside a mark carries.
 *
 *   card   title plus the declared detail lines — the historical behaviour,
 *          right for a set whose every member is a landmark
 *   label  the title alone, the detail reserved for the click
 *
 * A manifest may state this, but it does not have to: `datasetLayer.js`
 * promotes a dataset to `label` on its own once it holds more features than the
 * card cohort could ever show at once. See the note above
 * `DATASET_DENSE_FEATURE_COUNT` there — the rule is about the SET, not about
 * the subject, which is why it can be derived instead of declared.
 */
export const DATASET_AMBIENTS = Object.freeze(['card', 'label']);
/**
 * How a detail line reads its column.
 *
 *   (none) the cell as text
 *   list   a Postgres text-array literal `{a,b}` unpacked and joined
 *   days   the same, then French weekday runs compacted to `lun–ven`
 */
export const DATASET_DETAIL_FORMATS = Object.freeze(['list', 'days']);
/** Group key a rule-based classification gives a row no rule claimed. */
export const DATASET_OTHER_GROUP_KEY = '__other__';
/** Most row chips a manifest may declare — a strip, not a menu. */
export const DATASET_MAX_FILTERS = 5;
/**
 * Longest chip label a manifest may give itself on somebody else's row.
 *
 * The strip is a control strip, not a second list of names — the same rule
 * `layerFusions.js` states for the core fusions, where the longest shipped chip
 * is « Archive · Gironde 2026 » at 22 characters.
 */
export const DATASET_MAX_CHIP_LENGTH = 24;
export const DATASET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const CRS_PATTERN = /^EPSG:\d{4,6}$/;

/** Geometry declarations a row-based source may use, one shape per manifest. */
export const DATASET_GEOMETRY_SHAPES = Object.freeze(['lonlat', 'point', 'wkt', 'projected', 'geojson']);

/**
 * Thrown by {@link normalizeDatasetManifest}; carries every fault at once so a
 * form can print them all rather than the first.
 */
export class DatasetManifestError extends Error {
  constructor(faults) {
    super(`Manifeste invalide : ${faults.join(' ; ')}`);
    this.name = 'DatasetManifestError';
    this.faults = [...faults];
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A copy with every `null` removed, so a NORMALIZED manifest — which writes
 * `null` where the author wrote nothing — validates again when it comes back
 * from storage or from a file the panel exported. Arrays keep their order;
 * `null` items inside them are dropped too.
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripNulls(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(stripNulls);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    out[key] = stripNulls(item);
  }
  return out;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Which of the five geometry shapes a `geometry` block declares, or null.
 * @param {object|null|undefined} geometry
 * @returns {string|null}
 */
export function datasetGeometryShape(geometry) {
  if (!isPlainObject(geometry)) return null;
  if (isNonEmptyString(geometry.lon) && isNonEmptyString(geometry.lat)) return 'lonlat';
  if (isNonEmptyString(geometry.point)) return 'point';
  if (isNonEmptyString(geometry.wkt)) return 'wkt';
  if (isNonEmptyString(geometry.x) && isNonEmptyString(geometry.y)) return 'projected';
  if (isNonEmptyString(geometry.geojson)) return 'geojson';
  return null;
}

/**
 * The keys a `feature.group` classification can hand out, in legend order.
 *
 * Shared by the validator and the normalizer so a filter naming a group that
 * does not exist is a FAULT rather than a chip that silently empties the map.
 * @param {object} group Raw `feature.group`.
 * @returns {string[]}
 */
function rawGroupKeys(group) {
  if (!isPlainObject(group)) return [];
  if (Array.isArray(group.rules)) {
    return group.rules.filter((rule) => isPlainObject(rule) && isNonEmptyString(rule.key)).map((rule) => rule.key);
  }
  return isPlainObject(group.styles) ? Object.keys(group.styles) : [];
}

/**
 * Faults in `feature.group`, in either of its two forms.
 *
 * FORM ONE — `{field, styles}` — classifies on one column by exact value, and
 * is what a register with a clean categorical column deserves.
 *
 * FORM TWO — `{rules}` — is ordered, first match wins, and each rule may read
 * SEVERAL columns. It exists because the column a register happens to publish
 * is not always the distinction a reader came for. GeoDAE classifies its
 * defibrillators by `c_acc` (indoor / outdoor): inside Lyon that is 885 against
 * 3, so the colour channel is spent on a fact that separates nothing, and the
 * legend prints two numbers a reader cannot use. What they came to ask — can I
 * reach this one right now — lives in two other columns: `c_disp_h` (41 rows
 * say 24h/24) and `c_acc_lib` (584 free access against 304 restricted). Form
 * two is how a manifest spends its one colour channel on that instead.
 *
 * @param {unknown} group
 * @returns {string[]}
 */
function datasetGroupFaults(group) {
  const faults = [];
  if (!isPlainObject(group)) return ['`feature.group` : objet'];
  const hasRules = group.rules !== undefined;
  if (hasRules && group.field !== undefined) {
    faults.push('`feature.group` : `rules` ou `field`/`styles`, pas les deux');
  }
  if (hasRules) {
    if (!Array.isArray(group.rules) || group.rules.length === 0) {
      faults.push('`feature.group.rules` : au moins une règle { key, color, label?, when }');
    } else {
      const seen = new Set();
      group.rules.forEach((rule, index) => {
        if (!isPlainObject(rule)) {
          faults.push(`\`feature.group.rules[${index}]\` : objet { key, color, label?, when }`);
          return;
        }
        if (!isNonEmptyString(rule.key) || rule.key === DATASET_OTHER_GROUP_KEY) {
          faults.push(`\`feature.group.rules[${index}].key\` : identifiant non vide, « ${DATASET_OTHER_GROUP_KEY} » réservé`);
        } else if (seen.has(rule.key)) {
          faults.push(`\`feature.group.rules[${index}].key\` : « ${rule.key} » en double`);
        } else {
          seen.add(rule.key);
        }
        if (!(typeof rule.color === 'string' && HEX_COLOR.test(rule.color))) {
          faults.push(`\`feature.group.rules[${index}].color\` : couleur hexadécimale #rrggbb`);
        }
        if (rule.label !== undefined && !isNonEmptyString(rule.label)) {
          faults.push(`\`feature.group.rules[${index}].label\` : chaîne non vide`);
        }
        const when = rule.when;
        if (!isPlainObject(when) || Object.keys(when).length === 0) {
          faults.push(`\`feature.group.rules[${index}].when\` : { champ: [valeurs acceptées] }`);
        } else {
          for (const [field, accepted] of Object.entries(when)) {
            if (!isNonEmptyString(field) || !(Array.isArray(accepted) && accepted.length > 0 && accepted.every(isNonEmptyString))) {
              faults.push(`\`feature.group.rules[${index}].when["${field}"]\` : liste de valeurs non vides`);
            }
          }
        }
      });
    }
  } else if (!isNonEmptyString(group.field)) {
    faults.push('`feature.group.field` : champ de classement');
  } else {
    const styles = group.styles;
    if (!isPlainObject(styles) || Object.keys(styles).length === 0) {
      faults.push('`feature.group.styles` : au moins une valeur { color, label? }');
    } else {
      for (const [value, style] of Object.entries(styles)) {
        if (!isPlainObject(style) || !(typeof style.color === 'string' && HEX_COLOR.test(style.color))) {
          faults.push(`\`feature.group.styles["${value}"]\` : { color: #rrggbb, label? }`);
        }
      }
    }
  }
  if (group.other !== undefined
    && !(isPlainObject(group.other) && typeof group.other.color === 'string' && HEX_COLOR.test(group.other.color))) {
    faults.push('`feature.group.other` : { color: #rrggbb, label? }');
  }
  return faults;
}

/**
 * Faults in `feature.filters` — the row's chips.
 *
 * A chip does not re-ask the source and does not drop a row from the load: it
 * hides the marks of the groups it does not name, so the row's count and its
 * legend keep reporting the whole answer. `groups: null` (or absent) is the
 * "everything" chip every strip needs a way back to.
 *
 * @param {unknown} filters
 * @param {unknown} group The `feature.group` the ids must exist in.
 * @returns {string[]}
 */
function datasetFilterFaults(filters, group) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return ['`feature.filters` : liste de puces { id, label, groups? }'];
  }
  const faults = [];
  if (filters.length > DATASET_MAX_FILTERS) {
    faults.push(`\`feature.filters\` : ${DATASET_MAX_FILTERS} puces au plus`);
  }
  const known = new Set([...rawGroupKeys(group), DATASET_OTHER_GROUP_KEY]);
  if (known.size === 1) faults.push('`feature.filters` : sans `feature.group`, une puce n\'a rien à filtrer');
  const seen = new Set();
  filters.forEach((filter, index) => {
    if (!isPlainObject(filter)) {
      faults.push(`\`feature.filters[${index}]\` : objet { id, label, groups? }`);
      return;
    }
    if (!isNonEmptyString(filter.id) || !DATASET_ID_PATTERN.test(filter.id)) {
      faults.push(`\`feature.filters[${index}].id\` : minuscules, chiffres et tirets`);
    } else if (seen.has(filter.id)) {
      faults.push(`\`feature.filters[${index}].id\` : « ${filter.id} » en double`);
    } else {
      seen.add(filter.id);
    }
    if (!isNonEmptyString(filter.label)) faults.push(`\`feature.filters[${index}].label\` manquant`);
    if (filter.title !== undefined && !isNonEmptyString(filter.title)) {
      faults.push(`\`feature.filters[${index}].title\` : chaîne non vide`);
    }
    if (filter.groups !== undefined) {
      if (!(Array.isArray(filter.groups) && filter.groups.length > 0 && filter.groups.every(isNonEmptyString))) {
        faults.push(`\`feature.filters[${index}].groups\` : liste de clés de groupe`);
      } else {
        for (const key of filter.groups) {
          if (!known.has(key)) faults.push(`\`feature.filters[${index}].groups\` : groupe « ${key} » inconnu`);
        }
      }
    }
  });
  if (!filters.some((filter) => isPlainObject(filter) && filter.groups === undefined)) {
    faults.push('`feature.filters` : une puce sans `groups` est le retour à « tout »');
  }
  return faults;
}

/**
 * Every fault in a candidate manifest. Empty means valid.
 *
 * Written as a list rather than a throw so the plug panel can show a reader
 * all of what is wrong with the file they pasted, and so the catalog test can
 * name the exact field of the exact file.
 * @param {unknown} candidate
 * @returns {string[]}
 */
export function datasetManifestFaults(candidate) {
  const faults = [];
  if (!isPlainObject(candidate)) return ['le manifeste doit être un objet'];
  const m = stripNulls(candidate);

  if (!isNonEmptyString(m.id) || !DATASET_ID_PATTERN.test(m.id)) {
    faults.push('`id` : minuscules, chiffres et tirets, 2 à 63 caractères');
  }
  if (!isNonEmptyString(m.label)) faults.push('`label` manquant');
  else if (m.label.trim().length > 64) faults.push('`label` : 64 caractères au plus');
  if (m.name !== undefined && !isNonEmptyString(m.name)) faults.push('`name` : chaîne non vide si présent');
  if (m.icon !== undefined && (!isNonEmptyString(m.icon) || m.icon.trim().length > 4)) {
    faults.push('`icon` : un glyphe (4 caractères au plus)');
  }
  if (m.color !== undefined && !(typeof m.color === 'string' && HEX_COLOR.test(m.color))) {
    faults.push('`color` : couleur hexadécimale #rrggbb');
  }
  if (m.category !== undefined && !(isNonEmptyString(m.category) && /^[a-z0-9-]+$/.test(m.category))) {
    faults.push('`category` : identifiant de groupe (minuscules et tirets)');
  }
  if (m.coverage !== undefined && !DATASET_COVERAGES.includes(m.coverage)) {
    faults.push(`\`coverage\` : ${DATASET_COVERAGES.join(' | ')}`);
  }
  if (m.cadence !== undefined && !DATASET_CADENCES.includes(m.cadence)) {
    faults.push(`\`cadence\` : ${DATASET_CADENCES.join(' | ')}`);
  }
  if (m.refreshMs !== undefined && !(Number.isInteger(m.refreshMs) && m.refreshMs >= 0)) {
    faults.push('`refreshMs` : entier ≥ 0 (0 = jamais)');
  }

  // ── fusion ───────────────────────────────────────────────────────────────
  // A manifest MAY say it is a chip on an existing row rather than a row of its
  // own. It names the row and the chip; whether that row exists is checked
  // where the layers are — `registerDataset()` — because this module knows
  // nothing about which layers a given build registers, and must not.
  if (m.fusion !== undefined) {
    if (!isPlainObject(m.fusion)) {
      faults.push('`fusion` : objet { into, chip }');
    } else {
      if (!isNonEmptyString(m.fusion.into)) faults.push('`fusion.into` : identifiant de la couche hôte');
      if (!isNonEmptyString(m.fusion.chip)) faults.push('`fusion.chip` : libellé de la puce');
      else if (m.fusion.chip.trim().length > DATASET_MAX_CHIP_LENGTH) {
        faults.push(`\`fusion.chip\` : ${DATASET_MAX_CHIP_LENGTH} caractères au plus`);
      }
      if (m.fusion.title !== undefined && !isNonEmptyString(m.fusion.title)) {
        faults.push('`fusion.title` : chaîne non vide si présent');
      }
      if (m.fusion.optIn !== undefined && typeof m.fusion.optIn !== 'boolean') {
        faults.push('`fusion.optIn` : booléen');
      }
      if (m.fusion.into === m.id) faults.push('`fusion.into` : une couche ne peut pas se fusionner dans elle-même');
    }
  }

  // ── source ───────────────────────────────────────────────────────────────
  const source = m.source;
  if (!isPlainObject(source)) {
    faults.push('`source` manquant');
  } else {
    const kind = source.kind;
    if (!DATASET_SOURCE_KINDS.includes(kind)) {
      faults.push(`\`source.kind\` : ${DATASET_SOURCE_KINDS.join(' | ')}`);
    } else {
      if (kind === 'datagouv') {
        if (!(isNonEmptyString(source.resourceId) && /^[0-9a-f-]{36}$/i.test(source.resourceId))) {
          faults.push('`source.resourceId` : identifiant de ressource data.gouv.fr (UUID)');
        }
      } else if (!isHttpUrl(source.url)) {
        faults.push('`source.url` : URL http(s)');
      }
      if (kind === 'wfs' && !isNonEmptyString(source.typeName)) {
        faults.push('`source.typeName` : nom de la couche WFS (ex. BDTOPO_V3:aerodrome)');
      }
      if (kind === 'opendatasoft' && !isNonEmptyString(source.dataset)) {
        faults.push('`source.dataset` : identifiant du jeu Opendatasoft');
      }
      if (kind === 'opendatasoft' && source.geoField !== undefined && !isNonEmptyString(source.geoField)) {
        faults.push('`source.geoField` : nom du champ géographique');
      }
      if (kind === 'csv' && source.delimiter !== undefined
        && !(typeof source.delimiter === 'string' && source.delimiter.length === 1)) {
        faults.push('`source.delimiter` : un caractère');
      }
    }
    if (source.scope !== undefined && !DATASET_SCOPES.includes(source.scope)) {
      faults.push(`\`source.scope\` : ${DATASET_SCOPES.join(' | ')}`);
    }
    if (source.scope === 'viewport' && !DATASET_BBOX_KINDS.has(kind)) {
      faults.push(`\`source.scope\` viewport : réservé à ${[...DATASET_BBOX_KINDS].join(', ')}`);
    }
    if (source.maxFeatures !== undefined
      && !(Number.isInteger(source.maxFeatures) && source.maxFeatures >= 1 && source.maxFeatures <= DATASET_MAX_FEATURES_CEILING)) {
      faults.push(`\`source.maxFeatures\` : entier entre 1 et ${DATASET_MAX_FEATURES_CEILING}`);
    }
    if (source.maxSpanDeg !== undefined
      && !(Number.isFinite(source.maxSpanDeg) && source.maxSpanDeg > 0 && source.maxSpanDeg <= 90)) {
      faults.push('`source.maxSpanDeg` : nombre entre 0 et 90');
    }
    if (source.columns !== undefined
      && !(Array.isArray(source.columns) && source.columns.every(isNonEmptyString))) {
      faults.push('`source.columns` : liste de noms de colonnes');
    }
  }

  // ── geometry ─────────────────────────────────────────────────────────────
  const kind = isPlainObject(source) ? source.kind : null;
  const shape = datasetGeometryShape(m.geometry);
  if (kind && !DATASET_NATIVE_GEOMETRY_KINDS.has(kind) && !shape) {
    faults.push('`geometry` : une source tabulaire doit dire comment une ligne devient un point ({lon,lat} | {point} | {wkt} | {x,y,crs} | {geojson})');
  }
  if (m.geometry !== undefined && !isPlainObject(m.geometry)) {
    faults.push('`geometry` : objet');
  } else if (shape === 'projected') {
    if (!(isNonEmptyString(m.geometry.crs) && CRS_PATTERN.test(m.geometry.crs))) {
      faults.push('`geometry.crs` : code EPSG (ex. EPSG:2154) obligatoire avec x/y');
    } else if (m.geometry.crs !== 'EPSG:2154' && m.geometry.crs !== 'EPSG:4326') {
      faults.push('`geometry.crs` : seuls EPSG:2154 (Lambert-93) et EPSG:4326 sont reprojetés');
    }
  }

  // ── feature ──────────────────────────────────────────────────────────────
  if (m.feature !== undefined) {
    if (!isPlainObject(m.feature)) {
      faults.push('`feature` : objet');
    } else {
      const f = m.feature;
      if (f.title !== undefined && !(Array.isArray(f.title) && f.title.every(isNonEmptyString))) {
        faults.push('`feature.title` : liste de champs, le premier non vide fait le titre');
      }
      if (f.ambient !== undefined && !DATASET_AMBIENTS.includes(f.ambient)) {
        faults.push(`\`feature.ambient\` : ${DATASET_AMBIENTS.join(' | ')}`);
      }
      if (f.blank !== undefined && !(Array.isArray(f.blank) && f.blank.every(isNonEmptyString))) {
        faults.push('`feature.blank` : liste des écritures qui veulent dire « non renseigné »');
      }
      if (f.details !== undefined) {
        if (!Array.isArray(f.details) || f.details.length > DATASET_MAX_DETAILS) {
          faults.push(`\`feature.details\` : liste de ${DATASET_MAX_DETAILS} lignes au plus`);
        } else {
          f.details.forEach((detail, index) => {
            const ok = isNonEmptyString(detail)
              || (isPlainObject(detail) && isNonEmptyString(detail.field)
                && (detail.label === undefined || isNonEmptyString(detail.label))
                && (detail.unit === undefined || isNonEmptyString(detail.unit))
                && (detail.format === undefined || DATASET_DETAIL_FORMATS.includes(detail.format))
                && (detail.omitWhen === undefined
                  || (Array.isArray(detail.omitWhen) && detail.omitWhen.every(isNonEmptyString))));
            if (!ok) {
              faults.push(`\`feature.details[${index}]\` : "champ" ou {field, label?, unit?, format? (${DATASET_DETAIL_FORMATS.join('|')}), omitWhen?}`);
            }
          });
        }
      }
      if (f.group !== undefined) faults.push(...datasetGroupFaults(f.group));
      if (f.filters !== undefined) faults.push(...datasetFilterFaults(f.filters, f.group));
    }
  }

  // ── attribution ──────────────────────────────────────────────────────────
  if (!isPlainObject(m.attribution)) {
    faults.push('`attribution` manquant — un jeu sans éditeur ni licence ne s\'affiche pas');
  } else {
    if (!isNonEmptyString(m.attribution.publisher)) faults.push('`attribution.publisher` manquant');
    if (!isNonEmptyString(m.attribution.licence)) faults.push('`attribution.licence` manquant');
    if (m.attribution.url !== undefined && !isHttpUrl(m.attribution.url)) faults.push('`attribution.url` : URL http(s)');
    if (m.attribution.text !== undefined && !isNonEmptyString(m.attribution.text)) faults.push('`attribution.text` : chaîne non vide');
  }

  return faults;
}

/** Ten hues, far enough apart to read on both the dark and the light basemaps. */
export const DATASET_PALETTE = Object.freeze([
  '#ffb14e', '#3ce0c8', '#b388ff', '#ff6f91', '#7cd992',
  '#5ac8fa', '#f5d33c', '#ff8a5c', '#9fa8ff', '#c9f24b',
]);

/**
 * A stable colour for an id, so the same dataset gets the same hue on every
 * machine that plugs it, without anyone choosing one.
 * @param {string} id
 * @returns {string}
 */
export function datasetPaletteColor(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DATASET_PALETTE[hash % DATASET_PALETTE.length];
}

function normalizeDetail(detail) {
  if (typeof detail === 'string') {
    return Object.freeze({ field: detail, label: null, unit: null, format: null, omitWhen: null });
  }
  return Object.freeze({
    field: detail.field,
    label: detail.label ?? null,
    unit: detail.unit ?? null,
    format: detail.format ?? null,
    omitWhen: Array.isArray(detail.omitWhen) ? Object.freeze([...detail.omitWhen]) : null,
  });
}

/**
 * Both `feature.group` forms as ONE shape, so nothing downstream has to know
 * which one the author wrote.
 *
 * `styles` is the legend, in declaration order, keyed by the group key a row
 * resolves to. `rules` is the ordered classifier, or null when the classifier
 * is a plain exact match on `field`. A reader of the normalized manifest picks
 * `rules` when it is there and `field` otherwise; the legend is the same in
 * both cases.
 *
 * @param {object|undefined} group
 * @returns {object|null}
 */
function normalizeGroup(group) {
  if (!isPlainObject(group)) return null;
  const other = group.other
    ? Object.freeze({
      color: group.other.color,
      label: isNonEmptyString(group.other.label) ? group.other.label : 'Autre',
    })
    : null;
  if (Array.isArray(group.rules)) {
    return Object.freeze({
      field: null,
      // `color` and `label` live on the rule AND in `styles` below. The
      // duplicate is deliberate: `styles` is what the legend reads, and a rule
      // that had lost its colour could not be written back out as the file it
      // came from — `exportableManifest` drops the derived half instead.
      rules: Object.freeze(group.rules.map((rule) => Object.freeze({
        key: rule.key,
        color: rule.color,
        label: isNonEmptyString(rule.label) ? rule.label : rule.key,
        when: Object.freeze(Object.fromEntries(Object.entries(rule.when).map(([field, accepted]) => [
          field,
          Object.freeze([...accepted]),
        ]))),
      }))),
      styles: Object.freeze(Object.fromEntries(group.rules.map((rule) => [
        rule.key,
        Object.freeze({ color: rule.color, label: isNonEmptyString(rule.label) ? rule.label : rule.key }),
      ]))),
      other,
    });
  }
  return Object.freeze({
    field: group.field,
    rules: null,
    styles: Object.freeze(Object.fromEntries(Object.entries(group.styles).map(([value, style]) => [
      value,
      Object.freeze({ color: style.color, label: isNonEmptyString(style.label) ? style.label : value }),
    ]))),
    other,
  });
}

/** The row's chips, `groups: null` meaning "everything". */
function normalizeFilters(filters) {
  if (!Array.isArray(filters) || filters.length === 0) return null;
  return Object.freeze(filters.map((filter) => Object.freeze({
    id: filter.id,
    label: filter.label,
    title: isNonEmptyString(filter.title) ? filter.title : null,
    groups: Array.isArray(filter.groups) ? Object.freeze([...filter.groups]) : null,
  })));
}

/**
 * Fill the defaults in and freeze the result. Throws {@link DatasetManifestError}
 * with every fault when the candidate is not a manifest.
 * @param {unknown} candidate
 * @returns {object} Frozen, normalized manifest.
 */
export function normalizeDatasetManifest(candidate) {
  const faults = datasetManifestFaults(candidate);
  if (faults.length) throw new DatasetManifestError(faults);
  const m = stripNulls(candidate);
  const source = m.source;
  const kind = source.kind;
  const bboxCapable = DATASET_BBOX_KINDS.has(kind);
  const scope = source.scope || 'all';
  const geometryShape = datasetGeometryShape(m.geometry);
  const feature = isPlainObject(m.feature) ? m.feature : {};
  const group = normalizeGroup(feature.group);

  return Object.freeze({
    version: DATASET_MANIFEST_VERSION,
    id: m.id,
    label: m.label.trim(),
    name: isNonEmptyString(m.name) ? m.name.trim() : m.label.trim(),
    icon: isNonEmptyString(m.icon) ? m.icon.trim() : '◆',
    color: typeof m.color === 'string' ? m.color.toLowerCase() : datasetPaletteColor(m.id),
    category: isNonEmptyString(m.category) ? m.category : DATASET_DEFAULT_CATEGORY,
    coverage: m.coverage || 'fr',
    cadence: m.cadence || (scope === 'viewport' ? 'periodic' : 'static'),
    refreshMs: Number.isInteger(m.refreshMs) ? m.refreshMs : 0,
    // Null on the manifests that are their own row, which is almost all of
    // them. `category` is still carried and still validated when a manifest is
    // fused: it is what the row falls back to if the host ever goes away.
    fusion: isPlainObject(m.fusion)
      ? Object.freeze({
        into: m.fusion.into.trim(),
        chip: m.fusion.chip.trim(),
        title: isNonEmptyString(m.fusion.title) ? m.fusion.title.trim() : null,
        optIn: m.fusion.optIn === true,
      })
      : null,
    source: Object.freeze({
      kind,
      url: isNonEmptyString(source.url) ? source.url.trim() : null,
      resourceId: isNonEmptyString(source.resourceId) ? source.resourceId.toLowerCase() : null,
      typeName: isNonEmptyString(source.typeName) ? source.typeName.trim() : null,
      dataset: isNonEmptyString(source.dataset) ? source.dataset.trim() : null,
      geoField: isNonEmptyString(source.geoField) ? source.geoField.trim() : null,
      delimiter: typeof source.delimiter === 'string' ? source.delimiter : null,
      columns: Array.isArray(source.columns) ? Object.freeze([...source.columns]) : null,
      scope: bboxCapable ? scope : 'all',
      maxFeatures: Number.isInteger(source.maxFeatures) ? source.maxFeatures : DATASET_DEFAULT_MAX_FEATURES,
      maxSpanDeg: Number.isFinite(source.maxSpanDeg) ? source.maxSpanDeg : DATASET_DEFAULT_MAX_SPAN_DEG,
    }),
    geometry: geometryShape
      ? Object.freeze({
        shape: geometryShape,
        lon: m.geometry.lon ?? null,
        lat: m.geometry.lat ?? null,
        point: m.geometry.point ?? null,
        wkt: m.geometry.wkt ?? null,
        x: m.geometry.x ?? null,
        y: m.geometry.y ?? null,
        crs: m.geometry.crs ?? null,
        geojson: m.geometry.geojson ?? null,
      })
      : null,
    feature: Object.freeze({
      title: Array.isArray(feature.title) ? Object.freeze([...feature.title]) : null,
      // `null`, not `'card'`: a manifest that says nothing lets the layer
      // decide from how many features actually arrived, which is the only
      // place that number is known. An explicit value always wins.
      ambient: DATASET_AMBIENTS.includes(feature.ambient) ? feature.ambient : null,
      blank: Array.isArray(feature.blank) ? Object.freeze([...feature.blank]) : Object.freeze([]),
      details: Array.isArray(feature.details) ? Object.freeze(feature.details.map(normalizeDetail)) : Object.freeze([]),
      group,
      filters: normalizeFilters(feature.filters),
    }),
    attribution: Object.freeze({
      publisher: m.attribution.publisher.trim(),
      licence: m.attribution.licence.trim(),
      url: isNonEmptyString(m.attribution.url) ? m.attribution.url.trim() : null,
      text: isNonEmptyString(m.attribution.text) ? m.attribution.text.trim() : null,
    }),
  });
}

/**
 * The layer id a manifest registers under — namespaced, so a plugged dataset
 * can never shadow a core layer, and so anything reading `dataManager.layers`
 * can tell the two apart at a glance.
 * @param {{id: string}} manifest
 * @returns {string}
 */
export function datasetLayerId(manifest) {
  return `${DATASET_LAYER_ID_PREFIX}${manifest.id}`;
}

/** Whether a layer id belongs to a plugged dataset. */
export function isDatasetLayerId(layerId) {
  return typeof layerId === 'string' && layerId.startsWith(DATASET_LAYER_ID_PREFIX);
}

/**
 * The taxonomy row the manager is handed — the same shape `layerTaxonomy.js`
 * produces for a core layer, so the panel draws a plugged row exactly like any
 * other. `scopeChip` is resolved by the caller with `coverageChip()`, because
 * that mapping is product copy owned by the taxonomy module.
 * @param {object} manifest Normalized manifest.
 * @param {(coverage: string) => (string|null)} chipOf
 * @returns {object}
 */
export function datasetTaxonomyEntry(manifest, chipOf = () => null) {
  const id = datasetLayerId(manifest);
  return Object.freeze({
    id,
    category: manifest.category,
    label: manifest.label,
    kind: 'dataset',
    coverage: manifest.coverage,
    auth: 'none',
    cadence: manifest.cadence,
    scopeChip: chipOf(manifest.coverage),
    // The two fusion facets, in the same shape `layerTaxonomy.js` produces for
    // a core layer: `fusedInto` is what keeps this dataset OFF the panel as a
    // row, and `companion` is the entry the manager splices into the host row's
    // strip. A core layer needs neither — its half of the pair is a line in
    // `layerFusions.js`, which is validated at import against a layer set a
    // plugged dataset is not in.
    fusedInto: manifest.fusion?.into || null,
    companion: manifest.fusion
      ? Object.freeze({
        id,
        chip: manifest.fusion.chip,
        title: manifest.fusion.title || null,
        optIn: manifest.fusion.optIn === true,
      })
      : null,
  });
}

/** The row's source line: publisher, then licence — what a reader owes. */
export function datasetSourceLine(manifest) {
  return `${manifest.attribution.publisher} · ${manifest.attribution.licence}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The credit registered into Cesium's attribution lightbox. Built from the
 * manifest, never typed twice — the same discipline `dataCredits.js` asks of
 * a core layer, without the second copy.
 * @param {object} manifest Normalized manifest.
 * @returns {{key: string, html: string}}
 */
export function datasetCredit(manifest) {
  const text = manifest.attribution.text
    || `${manifest.label} : ${manifest.attribution.publisher} (${manifest.attribution.licence})`;
  const html = manifest.attribution.url
    ? `<a href="${escapeHtml(manifest.attribution.url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`
    : escapeHtml(text);
  return { key: datasetLayerId(manifest), html };
}

/**
 * A normalized manifest as a FILE: what `datasets/<id>.json` should contain.
 *
 * Drops what normalization derived (`version`, `geometry.shape`), the
 * defaults an author did not write (`refreshMs: 0`, an empty `details`, a
 * `name` equal to the label, the default icon) and every `null`, so the file
 * reads like one a person typed — and validates again, byte for byte.
 * @param {object} manifest Normalized manifest.
 * @returns {object} Plain object, ready for `JSON.stringify`.
 */
export function exportableManifest(manifest) {
  const { version, ...rest } = stripNulls(manifest);
  const out = { ...rest };
  if (out.name === out.label) delete out.name;
  if (out.icon === '◆') delete out.icon;
  if (out.refreshMs === 0) delete out.refreshMs;
  if (out.geometry) {
    const { shape, ...geometry } = out.geometry;
    out.geometry = geometry;
  }
  if (out.feature) {
    const feature = { ...out.feature };
    if (Array.isArray(feature.details) && feature.details.length === 0) delete feature.details;
    if (Array.isArray(feature.blank) && feature.blank.length === 0) delete feature.blank;
    // `styles` is DERIVED from `rules` when a group is rule-based; writing both
    // back out would hand the next reader two copies of the legend to keep in
    // step, and only one of them is the source of truth.
    if (feature.group && Array.isArray(feature.group.rules)) {
      const { styles, ...group } = feature.group;
      feature.group = group;
    }
    if (Object.keys(feature).length === 0) delete out.feature;
    else out.feature = feature;
  }
  return out;
}
