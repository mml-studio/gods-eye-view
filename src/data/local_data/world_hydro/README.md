# Centrales hydroélectriques hors de France

`plants.json` — **592 stations**, drawn by the **Centrales hydro**
(`fr-hydro-plants`) layer beside France's own register. Built with
`npm run hydro:world`
([scripts/build-world-hydro.mjs](../../../../scripts/build-world-hydro.mjs)).

## Why this file exists

These 592 shipped as **barrages** until 2026-09-14.

The dams pack had two halves that were never the same object. France is a
direct OpenStreetMap extraction of dam STRUCTURES — walls across a river,
embankments beside one, 6 771 of them, **94 % of which generate nothing**. The
rest of the world was the old Open Infrastructure Map **POWER-PLANT** layer,
filtered on a dam tag: 661 features, 592 of them generating stations.

So one row called "Barrages" answered a click with a civil-engineering
structure in France and with a power station everywhere else — and the
divergence was loudest exactly where a reader looks first. `damTier` promotes
anything hydroelectric to its top rung, so the top rung held **592 world
features against 494 French ones**: someone who switched the layer on and
looked at the globe got a map of the world's hydroelectricity under a French
structural label.

A generating station belongs to the layer that draws generating stations. The
69 features that generate nothing — pumping stations, reservoirs, unpowered
barrages — stayed in the dams pack, because a structure with no generator is
that pack's subject and nothing else's.

## What this is NOT

**It is not a world hydro register**, and the layer never implies one.

592 stations is what one OSM-derived snapshot happened to hold. The real number
is in the tens of thousands: China alone operates more large hydro plants than
this whole file lists. France is a different claim entirely — ODRÉ's hydraulic
filière ENTIRE, 2 742 installations down to a 40 kW mill at Monteils — and the
two are drawn as different things so a reader is never invited to compare them:

- **their own colour** (`WORLD_HYDRO_COLOR`, slate blue), never the register's
  neutral grey. "ODRÉ left the technology column blank" and "nobody ever asked
  OpenStreetMap" are two different silences, and the grey's legend row says the
  first one in ODRÉ's own words;
- **their own legend row**, which says *échantillon … pas un inventaire
  mondial* — a legend row is where a reader checks what a colour promises;
- **their own card**, four lines at most, ending on the same warning.

The layer's taxonomy entry stays **`coverage: 'fr'`**, and that is deliberate.
The chip says where the layer can be TRUSTED to have the set, and France is
where it can: ODRÉ entire, down to the 40 kW mill. `global` would promise a
reader in Lima a register that does not exist — and would fold a world
companion under the narrower French primary of the *Centrales électriques* row,
which `layerFusions.test.mjs` refuses outright.

What DID go is the `(FR)` suffix in the row's name: it is **Centrales hydro**
now, not *Petite hydro (FR)*, because neither half of that name was true.

## What is in a record

An allowlist, and nothing is emitted empty: an absent field is absent, so the
card omits a line rather than printing a placeholder.

| Field | Coverage | |
|---|---|---|
| `osm` | 592 | `r1144261` / `w121546174` — the identity, and the only key |
| `lat` / `lon` | 592 | see below |
| `name` | 536 (91 %) | OpenStreetMap's, verbatim |
| `kw` | 273 (46 %) | **144,4 GW between them**; the other 319 say "puissance non publiée" |
| `operator` | 188 (32 %) | |
| `builtYear` | 123 (21 %) | |

**A position is the centre of the mapped outline.** 645 of the source features
are polygons — a power plant's site, as somebody drew it — and the ring average
is inside it. This is deliberately NOT the dams pack's rule, which takes the
midpoint of an open way's crest: these objects are not crests.

An absent `kw` is `null` and never `0`. The distinction is load-bearing: the
row's power chips filter on `kw >= floor`, so a zero would clear a "≥ 0 kW"
floor while asserting a dead plant. As shipped, raising the floor above zero
hides all 319 — which is the honest answer, not a special case.

## Rebuilding

```sh
npm run hydro:world                                    # normalise in place
node scripts/build-world-hydro.mjs old-dams.geojsonl   # re-extract from a pre-split pack
```

Same contract as `carryOverWorld` in `build-osm-dams.mjs`: **the file is its own
source.** A plain run re-reads `plants.json`, re-normalises it and writes the
same bytes — records sorted by OSM id, coordinates at 6 decimals — so two runs
on any machine agree. The re-extraction path exists so the split is replayable
rather than a one-off edit nobody can reproduce.

## Licence

Open Database License (**ODbL 1.0**) — OpenStreetMap, via Open Infrastructure
Map. Keep both attributions when redistributing this derived database. See
`DATA_SOURCES.md`.
