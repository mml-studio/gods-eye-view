/*
 * LAYER FUSIONS — the one place that says which rows are ONE SUBJECT.
 *
 * `layerTaxonomy.js` answers "what is this dataset, and which group does it
 * belong to". It cannot answer the question this file exists for: "are these
 * two rows the same subject seen twice?" That is a statement ABOUT A PAIR, and
 * a per-layer field can only ever hold half of it.
 *
 * The audit that produced this table counted fourteen subjects drawn by two to
 * four rows each — DVF sold three times, the road measured four ways, three
 * registers of power plants, education split across two ministries. Every one
 * of those splits is an artifact of the order the layers merged in, not a
 * distinction a reader asked for. A panel that lists them separately makes the
 * reader do the join.
 *
 * WHAT A FUSION IS, AND WHAT IT IS NOT
 *
 * A fusion is a PRESENTATION decision: one row in the Data Layers panel, whose
 * toggle carries several registered layers, with one chip per companion so the
 * reader can still take the subject apart. It deletes NOTHING — not a module,
 * not a source, not a share token. Every fused layer keeps:
 *
 *   - its own id, module, lifecycle and cache;
 *   - its own share token, so links already sent keep restoring exactly what
 *     they always restored (a companion is enabled by token, with or without
 *     its primary — the row simply reads as partly on);
 *   - its own map legend entry, which `_refreshMapLegend` gathers from
 *     `getAll()` and therefore never went through a row in the first place;
 *   - its own credit line.
 *
 * That is deliberate and it is the whole reason this is a table and not a
 * rewrite: merging two layer MODULES is a data migration with a rollback cost,
 * merging two ROWS is a line in this file. Where a deeper merge is genuinely
 * owed — the 56 power plants held by three registers, the médecins family
 * `amenities-fr` still draws — the note on the entry says so, and the fusion
 * is the first half of that work, not a substitute for it.
 *
 * WHY NOT `showInTogglePanel: false` ON THE COMPANION
 *
 * Because that flag says "you enter this through another surface" — it is what
 * `military-awareness` uses, and it leaves the layer with no control at all in
 * the panel. A companion is not hidden: it is a chip, one click away, showing
 * its own on/off state. The reader who wants Sitadel alone can still have it.
 *
 * EXHAUSTIVENESS IS ENFORCED, NOT DOCUMENTED
 *
 * `validateLayerFusions()` runs at import and cross-checks against
 * REGISTERED_LAYER_IDS: an unknown id, an id claimed twice, a primary that is
 * itself somebody's companion, or a fusion with no companion is a BOOT
 * FAILURE. Same contract, same reason, as the taxonomy next door and the
 * duplicate-token assertion in `layerState.js`.
 */

import { REGISTERED_LAYER_IDS } from './layerState.js';

/**
 * The merged subjects.
 *
 * `primary` is the layer that KEEPS the row: its label, its scope chip, its
 * count and its meta line are what the row shows when nothing is expanded.
 * Choosing it is a product decision, not a size contest — where a fusion mixes
 * a world layer with a French one, the world layer is primary, so the row's
 * scope chip never tells a reader outside France that a row with data for them
 * is French-only.
 *
 * `companions[].chip` is the chip label. It is short on purpose: the chip row
 * is a control strip, not a second list of names. `title` is the tooltip, and
 * it is where the honest hedge goes.
 *
 * `primaryChip` is the same thing for the layer that KEEPS the row, and it
 * exists for the MAP KEY rather than for the panel — the primary has no chip
 * because the row's own toggle is its control. When two or more members of a
 * fusion publish a legend at once, `_refreshMapLegend` prints the row name once
 * and then one sub-block per member, titled by its chip; without this field the
 * primary's sub-block would be titled with the row's own name, which says
 * nothing. Measured on « Trafic routier »: four blocks, and the first was
 * called `Trafic routier` under a heading also called `Trafic routier`.
 *
 * It is OPTIONAL, and only the fusions that can currently split their key
 * carry one. A missing `primaryChip` falls back to the layer's display name,
 * and the renderer drops a sub-title that would only repeat the row's — so a
 * fusion whose primary gains a key later degrades to today's rendering rather
 * than to a wrong name. Add one when that happens.
 *
 * `primaryToggle: true` promotes that same label to a CHIP ON THE STRIP, so the
 * primary can be switched off while the row stays on. It requires
 * `primaryChip`, because a chip with no label is a blank button.
 *
 * IT IS THE EXCEPTION, AND THE RULE ABOVE IS STILL THE RULE. On almost every
 * fusion the primary IS the subject and the companions are variants of it — the
 * row's own toggle is the primary's control, and a chip for it would be a
 * second switch for the same thing sitting next to the first. `primaryToggle`
 * is for the fusions where the members are PEERS: « Infrastructure numérique »
 * carries data centres, submarine cables and radio masts, three different
 * objects that happen to share a shelf, and no one of them is the row. Without
 * the flag the reader could add the other two and never subtract the first —
 * measured on that row, where the 4 351 data centres were unswitchable for as
 * long as the reader wanted to look at antennas.
 *
 * `optIn: true` means the row's toggle does NOT switch that companion on. It
 * is for a companion whose cost is real and whose value is conditional — the
 * reader asks for it by pressing the chip. Every other companion follows the
 * row, which is the point of the row.
 *
 * There are two shapes of "conditional" here and they are worth telling apart.
 * `comparables-fr` is conditional on the READER: an empty dossier draws nothing
 * until somebody builds one. `comptages-fr` is conditional on the CAMERA: it
 * holds Paris and nothing else, so a row toggle pressed anywhere else was
 * paying for a layer that could not draw. What they share is that the row
 * cannot know the answer and the chip can ask.
 *
 * A companion that fills a HOLE in its primary is never `optIn`, whatever its
 * geography: `idfm-network` is on this row precisely because Île-de-France
 * publishes no live vehicle, and making it opt-in would put the capital back to
 * zero on a row that promises transit. Its territory is declared through
 * `layerCoverage.js` instead, which dims a control without unplugging it.
 *
 * `disabled: true` is the third state, and it is NOT a weaker `optIn`. `optIn`
 * says "the reader asks for this with the chip"; `disabled` says THERE IS NO
 * CHIP — the companion is withdrawn from the interface entirely, while staying
 * a registered layer with its module, its share token, its credit line and its
 * tests intact. `fusionCompanionsFor` drops it, so the row shows no chip for it
 * and `fusionToggleGroupFor` never switches it on; `fusedIntoFor` deliberately
 * still returns the primary, which is what keeps the layer OFF the panel
 * instead of promoting it back to a row of its own. The matching half lives in
 * `layerState.js` (`DISABLED_LAYER_IDS`), which is what stops a stored session
 * or an old share link from bringing it back with no control to switch it off.
 *
 * Deleting the entry would do the panel half and nothing else; this flag is the
 * reversible form of the same decision — take it out to give the chip back.
 */
export const LAYER_FUSIONS = Object.freeze([
  // ── 1. Autorisations d'urbanisme ─────────────────────────────────────────
  // The two rows read the SAME four Sitadel files through the same shared
  // module. What differed was placement — `ads-fr` geocodes through the BAN
  // and lands within ~400 m, `sitadel-fr` lands on the cadastral parcel — and
  // that is a precision fact about one subject, not two subjects.
  Object.freeze({
    primary: 'ads-fr',
    companions: Object.freeze([
      Object.freeze({
        id: 'sitadel-fr',
        chip: 'Sur parcelle',
        title: 'Sitadel posé sur la parcelle cadastrale, quand la référence est publiée',
      }),
    ]),
  }),

  // ── 2. Prix de l'immobilier ──────────────────────────────────────────────
  // Three rows for one question: "combien vaut ce sol". They read the same
  // register — `avis-valeur` already reuses the DVF silhouette — and the
  // comparables dossier is a tool applied to that same selection.
  //
  // THE CHIPS ARE VERBS. `Avis de valeur` is the trade's word for the document
  // and it named the LAYER rather than what pressing the chip does; beside a
  // row called « Prix de l'immobilier » a reader had no way to tell that one
  // of them was about a specific door. The row answers "what does it cost
  // around here"; the chips say what else you can ask.
  Object.freeze({
    primary: 'dvf-sales',
    companions: Object.freeze([
      Object.freeze({
        id: 'avis-valeur',
        chip: 'Estimer un bien',
        title: 'Estimer un logement au point cliqué, sur les mêmes ventes — le type suit la '
          + 'puce de la ligne, la surface se choisit ici',
      }),
      Object.freeze({
        id: 'comparables-fr',
        chip: 'Mes comparables',
        // Opt-in: the dossier is the reader's OWN selection, and an empty
        // dossier switched on by a row toggle draws nothing while costing a
        // lifecycle. It is a tool, and a tool is picked up.
        optIn: true,
        title: 'Dossier de comparables — sélection manuelle, à ouvrir quand on en constitue un',
      }),
    ]),
  }),

  // ── 3. Enseignement ──────────────────────────────────────────────────────
  // The taxonomy already stated the problem in prose next to `sup-fr`: "one
  // subject split across two ministries, and the taxonomy should not repeat
  // the split". It repeated it anyway, as two rows. It stops here.
  Object.freeze({
    primary: 'schools-fr',
    primaryChip: 'Écoles et lycées',
    companions: Object.freeze([
      Object.freeze({
        id: 'sup-fr',
        chip: 'Supérieur',
        title: 'Établissements du supérieur — 2 800 lycées à BTS sont dans les deux registres',
      }),
    ]),
  }),

  // ── 4. Navires et ports ──────────────────────────────────────────────────
  // A port is where the vessels stop. The two rows shared nothing in code and
  // everything in subject; the destination field of an AIS message is a port
  // name, unresolved to this day.
  Object.freeze({
    primary: 'ais-live-vessels',
    companions: Object.freeze([
      Object.freeze({
        id: 'local-ports',
        chip: 'Ports',
        title: 'World Port Index — les escales que les navires déclarent',
      }),
    ]),
  }),

  // ── 5. Zone de chalandise ────────────────────────────────────────────────
  // The fiche IS the card of the ring: `implantation-fr` joins four layers
  // inside the isochrone this row draws, and neither is readable without the
  // other.
  Object.freeze({
    primary: 'isochrone-fr',
    primaryChip: 'Anneau',
    companions: Object.freeze([
      Object.freeze({
        id: 'implantation-fr',
        chip: 'Fiche',
        title: "Fiche implantation — ce que l'anneau contient, en une carte",
      }),
    ]),
  }),

  // ── 6. Aéroports ─────────────────────────────────────────────────────────
  // `bruit-fr` leaves RISQUES & ENVIRONNEMENT to become a chip here. The
  // taxonomy's objection is on the record — "the polygon is about the
  // aircraft, not about the ground under it" — and that is exactly the
  // argument for filing it with the aircraft. The ground-level reading is
  // owed elsewhere: the address radiography, where a PEB zone is a fact about
  // a door.
  Object.freeze({
    primary: 'local-airports',
    companions: Object.freeze([
      Object.freeze({
        id: 'bruit-fr',
        chip: 'Bruit (PEB)',
        title: "Plans d'exposition au bruit — la contrainte au sol des aéroports",
      }),
    ]),
  }),

  // ── 7. Cours d'eau ───────────────────────────────────────────────────────
  // The two module headers already cite each other in prose. Vigicrues paints
  // the reach, Hub'Eau measures the flow inside it.
  Object.freeze({
    primary: 'vigicrues',
    companions: Object.freeze([
      Object.freeze({
        id: 'hubeau-hydro',
        chip: 'Stations',
        title: "Hub'Eau — débit et hauteur mesurés sur le tronçon",
      }),
    ]),
  }),

  // ── 8. Météo ─────────────────────────────────────────────────────────────
  // An inventory of instruments has value through its readings. The vigilance
  // says what is coming, the stations say what is measured.
  Object.freeze({
    primary: 'meteofrance-vigilance',
    primaryChip: 'Vigilance',
    companions: Object.freeze([
      Object.freeze({
        id: 'meteo-stations-fr',
        chip: 'Stations',
        title: 'Météo-France — les 190 stations qui publient leur relevé',
      }),
    ]),
  }),

  // ── 9. Centrales électriques ─────────────────────────────────────────────
  // Three registers, 56 plants held by more than one of them, five gas sites
  // drawn twice with different megawatts. The row merge is the FIRST half of
  // this fix; the deduplication by EIC and by ODRÉ id is the second, and it is
  // not done here. Until it is, the chips at least let a reader see the same
  // plant twice on purpose rather than by accident.
  Object.freeze({
    primary: 'edf-power-plants',
    primaryChip: 'Registre EDF',
    companions: Object.freeze([
      Object.freeze({
        id: 'rte-generation',
        chip: 'Groupes RTE',
        title: 'Groupes de production RTE — production temps réel avec une clé',
      }),
      Object.freeze({
        id: 'fr-hydro-plants',
        chip: 'Centrales hydro',
        title: 'Registre ODRÉ — toute la filière hydraulique française, '
          + 'plus 592 centrales cartographiées hors de France',
      }),
    ]),
  }),

  // ── 10. Transports en commun ─────────────────────────────────────────────
  // Vehicles where the operator publishes them, stops with their frequency
  // where it does not. Île-de-France is the second case, which is why the
  // capital had zero vehicles on the row that promised them.
  //
  // ONE IDFM chip and not two. `idfm-frequency` was a second chip on this row
  // until 2026-09-10, drawing the SAME stops — 95.6 % of its 36 502 join
  // `arrets.arrid` — so a reader who wanted "how good is the transport here"
  // had to know to press both, and the frequency half answered a click with a
  // card the network half could not see. The two modules are now one layer and
  // one card; see `idfmNetwork.js` for what the merge kept and what it dropped.
  Object.freeze({
    primary: 'transit-fr',
    primaryChip: 'Véhicules en direct',
    companions: Object.freeze([
      Object.freeze({
        id: 'idfm-network',
        chip: 'Réseau IDFM',
        title: 'Arrêts, lignes et fréquence horaire d’Île-de-France — 37 956 arrêts',
      }),
    ]),
  }),

  // ── 11. Vélos et véhicules partagés ──────────────────────────────────────
  // `bikeshare` is primary although it is the smaller set: it is the one with
  // data outside France, and a row that carried the `FR` chip would tell a
  // reader in Montréal that a layer serving them is French-only.
  Object.freeze({
    primary: 'bikeshare',
    primaryChip: 'Stations GBFS',
    companions: Object.freeze([
      Object.freeze({
        id: 'shared-mobility-fr',
        chip: 'Longue traîne FR',
        title: '135 opérateurs français, tous modes — vélo, trottinette, scooter, voiture',
      }),
      // WITHDRAWN FROM THE INTERFACE on 2026-09-14, by product decision, and
      // kept here rather than deleted: the module, the shipped pack, the share
      // token `vp`, the credit line and `qa-velo-pulse.mjs` all still work, and
      // this entry is the one line to remove to hand the chip back. While the
      // flag stands there is no « Semaine type » chip on the row and the row's
      // toggle no longer carries the layer.
      Object.freeze({
        id: 'velo-pulse-fr',
        chip: 'Semaine type',
        disabled: true,
        title: 'Remplissage moyen par heure de la semaine — Paris et Lyon',
      }),
    ]),
  }),

  // ── 12. Trafic routier ───────────────────────────────────────────────────
  // The same road measured four ways: a modelled ratio, a declared status, an
  // event list and a loop count. Three of the four already share the RRN
  // centreline pack.
  //
  // Two of them are territorial opposites and the row now shows it. Over Paris
  // `road-status-fr` goes quiet — DIRIF publishes neither stations nor status —
  // and `comptages-fr` is the only control on this globe holding a measured
  // vehicle count. Everywhere else the pair reads the other way round. Neither
  // fact was legible on the strip before `layerCoverage.js`: both chips looked
  // equally alive over a city where exactly one of them had data.
  Object.freeze({
    primary: 'traffic',
    primaryChip: 'Débit mesuré',
    companions: Object.freeze([
      Object.freeze({
        id: 'road-status-fr',
        chip: 'État du réseau',
        title: 'Traficolor — état déclaré par les DIR, hors autoroutes concédées',
      }),
      Object.freeze({
        id: 'road-events-fr',
        chip: 'Événements',
        title: 'Chantiers, accidents et fermetures publiés par Bison Futé',
      }),
      Object.freeze({
        id: 'comptages-fr',
        // The territory is IN the label, not only in the tooltip. This chip sits
        // on a row that works everywhere on Earth, and a bare "Comptages" beside
        // "État du réseau" and "Événements" reads as the third national feed
        // rather than as a layer whose entire extent is 12,6 km by 10,0 km.
        chip: 'Comptages · Paris',
        // Opt-in: the row toggle used to carry this one, so switching road
        // traffic on over Tokyo switched on a Paris-only layer, fetched its
        // chunk, and contributed SEVEN hour chips to a strip of fifteen — all
        // steering a layer with no payload. Its cost is real and its value is
        // geographic, which is exactly the case `optIn` was written for.
        optIn: true,
        title: 'Comptages routiers de Paris — un COMPTAGE de véhicules, pas une congestion',
      }),
    ]),
  }),

  // ── 13. Territoire ───────────────────────────────────────────────────────
  // Three choropleth engines over the same contours. The row merge is the
  // first half; the shared indicator selector the audit asks for is the
  // second. The delinquance layer's anti-defamation guard travels WITH its
  // chip — it lives in that module and nothing here weakens it.
  Object.freeze({
    primary: 'filosofi-fr',
    primaryChip: 'Revenus',
    companions: Object.freeze([
      Object.freeze({
        id: 'delinquance-fr',
        chip: 'Délinquance',
        title: 'Taux enregistrés par les services — à lire avec la garde du module',
      }),
      Object.freeze({
        id: 'petite-enfance-fr',
        chip: 'Petite enfance',
        title: "Places pour 100 enfants de moins de trois ans",
      }),
    ]),
  }),

  // ── 14. Infrastructure numérique ─────────────────────────────────────────
  // `local-datacenters` is primary for the same reason `bikeshare` is: it has
  // data everywhere. The submarine cables stay — they are already here, they
  // are drawn, and a French focus is a reason to ADD French layers, never a
  // reason to unplug a world one.
  //
  // THREE PEERS, SO THE PRIMARY GETS A CHIP TOO (`primaryToggle`). A hall, a
  // cable and a mast are three different objects; none of them is "the subject
  // the other two qualify", which is the shape every other fusion here has. The
  // row's toggle alone therefore left the data centres forced on under any
  // reader who came for the antennas.
  Object.freeze({
    primary: 'local-datacenters',
    primaryChip: 'Data centers',
    primaryToggle: true,
    companions: Object.freeze([
      Object.freeze({
        id: 'telegeography-submarine-cables',
        chip: 'Câbles',
        title: 'TeleGeography — atterrages et câbles sous-marins (licence non commerciale)',
      }),
      Object.freeze({
        id: 'anfr-fr',
        chip: 'Antennes',
        title: 'Supports ANFR — 2G à 5G, par opérateur',
      }),
    ]),
  }),

  // ── 15. Vols en direct ───────────────────────────────────────────────────
  // The military register already runs while its row is off — it feeds the
  // CONTACTS roster — and it mirrors `flights` options by explicit registry
  // disposition. It was a second row for the same sky.
  Object.freeze({
    primary: 'flights',
    primaryChip: 'Civils',
    companions: Object.freeze([
      Object.freeze({
        id: 'military',
        chip: 'Militaires',
        title: 'Aéronefs militaires identifiés — même source, même rendu',
      }),
    ]),
  }),
]);

/**
 * Validate the fusion table against the registered layer set.
 * @param {ReadonlyArray<object>} [fusions] Table under test.
 * @param {ReadonlyArray<string>} [registeredIds] Ids the app actually registers.
 * @returns {true} When valid.
 * @throws {Error} On any unknown id, duplicate claim, or empty fusion.
 */
export function validateLayerFusions(
  fusions = LAYER_FUSIONS,
  registeredIds = REGISTERED_LAYER_IDS,
) {
  if (!Array.isArray(fusions)) throw new Error('Layer fusions must be an array');
  const registered = new Set(registeredIds);
  const claimed = new Map();
  const primaries = new Set();
  for (const fusion of fusions) {
    const primary = fusion?.primary;
    if (typeof primary !== 'string' || !primary) {
      throw new Error('Layer fusion missing primary');
    }
    if (!registered.has(primary)) throw new Error(`Unknown fusion primary: ${primary}`);
    if (primaries.has(primary)) throw new Error(`Duplicate fusion primary: ${primary}`);
    primaries.add(primary);
    if (claimed.has(primary)) {
      throw new Error(`Fusion primary is already a companion: ${primary}`);
    }
    // Optional, but never empty and never a non-string: a blank one would
    // render as a sub-block with a title bar and no title.
    if (fusion.primaryChip !== undefined
        && (typeof fusion.primaryChip !== 'string' || !fusion.primaryChip.trim())) {
      throw new Error(`Fusion primaryChip must be a non-empty string: ${primary}`);
    }
    // Typed rather than truthy, same reason as `disabled` below: a string
    // `'false'` reads as off to a reviewer and as on to JavaScript.
    if (fusion.primaryToggle !== undefined && typeof fusion.primaryToggle !== 'boolean') {
      throw new Error(`Fusion primaryToggle must be a boolean: ${primary}`);
    }
    // A chip with no label is a blank button, and the fallback `primaryChip`
    // has for the MAP KEY (the layer's display name) is the row's own name —
    // which on the strip would read as a chip for the row inside the row.
    if (fusion.primaryToggle === true && !fusion.primaryChip) {
      throw new Error(`Fusion primaryToggle needs a primaryChip: ${primary}`);
    }
    claimed.set(primary, primary);
    const companions = fusion.companions;
    if (!Array.isArray(companions) || companions.length === 0) {
      throw new Error(`Fusion has no companion: ${primary}`);
    }
    for (const companion of companions) {
      const id = companion?.id;
      if (typeof id !== 'string' || !id) throw new Error(`Fusion companion missing id: ${primary}`);
      if (!registered.has(id)) throw new Error(`Unknown fusion companion: ${id}`);
      if (claimed.has(id)) throw new Error(`Layer claimed by two fusions: ${id}`);
      if (!companion.chip || typeof companion.chip !== 'string') {
        throw new Error(`Fusion companion missing chip label: ${id}`);
      }
      if (companion.chip === fusion.primaryChip) {
        throw new Error(`Fusion companion repeats the primary's chip: ${id}`);
      }
      // Typed rather than truthy: `disabled: 'false'` reads as "on" to a
      // reviewer and as "off" to JavaScript, and the whole point of the flag
      // is that a reader of this table can see which layers are offered.
      if (companion.disabled !== undefined && typeof companion.disabled !== 'boolean') {
        throw new Error(`Fusion companion disabled flag must be a boolean: ${id}`);
      }
      claimed.set(id, primary);
    }
  }
  // A companion that is itself a primary would render a row AND a chip for the
  // same layer, which is the exact duplication this table exists to remove.
  for (const [id, owner] of claimed) {
    if (id !== owner && primaries.has(id)) {
      throw new Error(`Fusion companion is also a primary: ${id}`);
    }
  }
  return true;
}

validateLayerFusions();

const FUSION_BY_PRIMARY = new Map(LAYER_FUSIONS.map((fusion) => [fusion.primary, fusion]));
// The offered companions, filtered ONCE at import rather than per call: the
// table is frozen, so the answer cannot change, and `fusionToggleGroupFor` is a
// public entry point a caller is free to put in a loop.
const OFFERED_BY_PRIMARY = new Map(LAYER_FUSIONS.map((fusion) => {
  const offered = fusion.companions.filter((entry) => entry.disabled !== true);
  return [fusion.primary, offered.length ? Object.freeze(offered) : null];
}));
// Frozen once at import, like OFFERED_BY_PRIMARY above and for the same
// reason: the table cannot change, and the panel asks for this on every repaint.
const PRIMARY_CHIP_BY_ID = new Map(LAYER_FUSIONS
  .filter((fusion) => fusion.primaryToggle === true)
  .map((fusion) => [fusion.primary, Object.freeze({
    id: fusion.primary,
    chip: fusion.primaryChip,
    title: '',
  })]));
const PRIMARY_BY_COMPANION = new Map();
for (const fusion of LAYER_FUSIONS) {
  for (const companion of fusion.companions) {
    PRIMARY_BY_COMPANION.set(companion.id, fusion.primary);
  }
}

/**
 * The companions a row OFFERS — every companion in the table except the ones
 * withdrawn from the interface with `disabled: true`.
 *
 * This is the single filter, and everything the reader can touch is downstream
 * of it: the chip strip, the row toggle's follower group, and the taxonomy's
 * `companions` facet. `null` rather than `[]` when a row has nothing left to
 * offer, so a fusion whose every companion is withdrawn renders exactly like an
 * unfused row instead of like one with an empty control strip.
 * @param {string} layerId Registered layer id.
 * @returns {ReadonlyArray<object>|null} Companion descriptors, or null.
 */
export function fusionCompanionsFor(layerId) {
  return OFFERED_BY_PRIMARY.get(layerId) || null;
}

/**
 * The row a layer disappeared into.
 *
 * A `disabled` companion still answers with its primary, and that is the point:
 * this is the field the panel reads to decide a layer has no row of its own, so
 * a withdrawn companion that answered `null` here would come BACK as a full row
 * in its category. Withdrawn means "no control", not "promoted".
 * @param {string} layerId Registered layer id.
 * @returns {string|null} Primary layer id, or null when the layer keeps a row.
 */
export function fusedIntoFor(layerId) {
  return PRIMARY_BY_COMPANION.get(layerId) || null;
}

/**
 * What to call ONE MEMBER of a fused row — the word the reader pressed.
 *
 * This is the map key's tier-2 title. It deliberately returns the CHIP label
 * and not the layer's taxonomy label, because the chip is the control that put
 * the block on screen: a reader who pressed `Comptages` should read
 * `Comptages` back, not `Comptages routiers (Paris)`, which appears nowhere in
 * the panel.
 *
 * @param {string} rowId The fusion's primary — the layer that keeps the row.
 * @param {string} memberId The primary itself, or one of its companions.
 * @returns {?string} The chip label, or null when there is none to give.
 */
export function fusionMemberChipFor(rowId, memberId) {
  const fusion = FUSION_BY_PRIMARY.get(rowId);
  if (!fusion) return null;
  if (memberId === rowId) return fusion.primaryChip || null;
  return fusion.companions.find((entry) => entry.id === memberId)?.chip || null;
}

/**
 * The chip a row offers for its OWN primary, or null when it offers none.
 *
 * Shaped like a companion descriptor (`{id, chip, title}`) so the strip builder
 * can run one loop over `[primary, ...companions]` instead of forking, and so a
 * future second peer row is a line in the table rather than a branch in the
 * panel.
 *
 * `title` is deliberately absent rather than invented: the companion tooltips
 * in this table carry a source and a hedge, and a made-up sentence beside them
 * would be the one line in the strip that says nothing.
 *
 * @param {string} layerId Registered layer id.
 * @returns {?{id: string, chip: string, title: string}} Descriptor, or null.
 */
export function fusionPrimaryChipFor(layerId) {
  const fusion = FUSION_BY_PRIMARY.get(layerId);
  if (!fusion || fusion.primaryToggle !== true) return null;
  return PRIMARY_CHIP_BY_ID.get(layerId) || null;
}

/**
 * Every layer a row's toggle switches on — the primary first, then the
 * companions that follow it. `optIn` companions are excluded: the row toggle
 * does not switch them on, their chip does.
 * @param {string} layerId Registered layer id.
 * @returns {string[]} Layer ids, primary first.
 */
export function fusionToggleGroupFor(layerId) {
  const companions = fusionCompanionsFor(layerId);
  if (!companions) return [layerId];
  return [layerId, ...companions.filter((entry) => entry.optIn !== true).map((entry) => entry.id)];
}
