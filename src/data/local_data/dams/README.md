# Barrages & digues

Bundled dam pack behind the `local-dams` layer. **6 840 features**, rebuilt
2026-09-01 with `npm run dams:pack`
([scripts/build-osm-dams.mjs](../../../../scripts/build-osm-dams.mjs)), split
2026-09-14.

| Half | Features | Source | Geometry |
|---|---|---|---|
| France — métropole + outre-mer | 6 771 | OpenStreetMap, extracted directly via the Overpass API on 2026-09-01 | dam AND dyke structures |
| Rest of the world | 69 | the older Open Infrastructure Map / PostGIS snapshot the pack shipped before | outlines with no generator |

The French half is why this file exists. The pack used to be 704 features for
the entire planet, and **44** of them were in France — so in a France fork
"Barrages" was a row you switched on to watch nothing happen. France is now
extracted completely. The taxonomy says where the layer can be trusted to have
the set: `coverage: 'fr'`.

## The world half lost 592 features, and they were never dams

The two halves were never the same object. France is an extraction of dam
STRUCTURES. The world half was the old Open Infrastructure Map **POWER-PLANT**
layer, filtered on a dam tag — 661 features, **592 of them generating
stations**. So one row answered a click with a civil-engineering structure in
France and with a power station everywhere else, and the divergence was loudest
where a reader looks first: on the top tier, `damTier` promotes anything
hydroelectric, so it held **592 world features against 494 French ones**.
Someone who switched on "Barrages" and looked at the globe got a map of the
world's hydroelectricity.

Those 592 moved to [`../world_hydro/`](../world_hydro/README.md), which the
**Centrales hydro** layer draws beside France's own register — the layer whose
subject they have always been. **Nothing was deleted.** The 69 that generate
nothing (pumping stations, reservoirs, unpowered barrages) stayed here,
unclassified, because a structure with no generator is this pack's subject and
nothing else's.

## The row has one chip group, and it did not always

`TOUS / BARRAGES / DIGUES`, and that is all. There used to be a second,
orthogonal row — `TOUS / NOMMÉS / GRANDS` — and it was removed on 2026-09-14
rather than retuned, for a measured reason: **`GRANDS` named a size and filtered
on something else.** It kept 494 French features, of which only **65 carry a
height at all**; the clause actually doing the work was `hydro === true`, so the
chip was a hydro filter wearing a size label.

What it legitimately did — thin 6 771 structures down to something readable — is
the zoom's job now, through `markerMaxDistance` on each tier:

| Tier | Features (FR) | Mark drawn under | Card offered under |
|---|---|---|---|
| Grand barrage | 494 | 14 000 km (orbit) | 14 000 km |
| Barrage nommé | 533 | 3 000 km | 1 200 km |
| Petit ouvrage | 5 744 | **900 km** | 200 km |

900 km is where France stops overflowing a 1080 px viewport, so the nameless
seuils arrive exactly when a département is the subject of the frame — and a
globe seen from orbit stops reporting a French dam density that belongs to the
SELECTION rather than to the world.

## Selection

`waterway=dam`, `man_made=dam`, `building=dam`, `man_made=dyke` or
`embankment=dyke`, anywhere inside `ISO3166-1=FR` — which in Overpass is the
whole French Republic, so Réunion, Guyane, the Antilles, Mayotte,
Nouvelle-Calédonie and Polynésie are in. The filters live in
[`src/data/damsPack.js`](../../damsPack.js) beside the code that reads the
result back; the build adds exactly one exclusion, documented below.

### A digue is not a barrage

The pack used to hold both and could not say which was which. Every feature now
carries `kind`:

| `kind` | Features | What it is |
|---|---|---|
| `dam` | 5 504 | a barrier ACROSS the watercourse, holding it back |
| `dyke` | 1 243 | an embankment ALONGSIDE the water, containing it |
| `dam+dyke` | 24 | tagged both in OSM — the mapper did not choose, and neither does this pack |
| *absent* | 69 | the world tail, whose raw tags are long gone |

An **absent** `kind` means unclassified, never "dam". Defaulting it would
recreate the exact conflation the field exists to end, outside France where
nobody would notice.

`kind` also writes the TITLE of the features OpenStreetMap never named —
80% of the pack, so this is what most cards and globe labels actually say.
Colouring a digue ochre and then titling its card "Barrage" loses the
distinction on the one surface a reader reads: `w860215522` is a 159 m
anti-ruissellement bund at Octeville-sur-Mer with no water body within 250 m,
and it read as a 159 m barrage. Nameless features are titled **Barrage**,
**Digue**, **Barrage-digue** — the same words the chips and the legend use — or
**Ouvrage** for the world half, which has no `kind` left to read.

**Weirs are deliberately out.** France has 7 704 `waterway=weir` against 5 519
`waterway=dam`; adding them would more than double a layer called "Barrages"
with objects most readers would not call one, and the dam-versus-weir boundary
is a mapper's judgement about overtopping rather than a survey. Separate
decision, separate rebuild.

**Road-carrying dykes are excluded**, and the cost is real. Half of France's
`man_made=dyke` — 1 428 of 2 661 elements — also carries `highway=*`, and the
OSM wiki is explicit that a road on a dyke belongs on the highway as
`embankment=dyke`. Importing them would draw the D-road along the Loire as a
barrage. Where a levée is mapped ONLY as a road, this pack therefore does not
hold it: 49 ways of the Levée de la Loire are absent for that reason.

**What OSM cannot say.** There is no tag anywhere that separates a digue de
protection contre les inondations from a digue d'étang — `dyke:type` has one
use worldwide. The register that does cover French flood dykes is SIOUH
(décret n° 2015-526, classes A/B/C, ~9 000 km), and it is not open bulk data.
The layer's own legend says so rather than implying a distinction it cannot
make.

This is OpenStreetMap's idea of a dam — a volunteer's judgement about a
structure, not a national register. France's own ROE register lists ~100 000
obstacles à l'écoulement and is an order of magnitude larger.

## Shape of what ships

| | |
|---|---|
Two independent axes. **Colour says what the structure is, size says how much
it matters** — a 1 106 m dyke and a 1 106 m barrage draw the same size, in
different colours, because they are the same size and different objects.

| Importance | | |
|---|---|---|
| Grand barrage | 494 | ≥ 15 m high, or hydroelectric, or named and ≥ 300 m long |
| Barrage nommé | 570 | |
| Petit ouvrage | 5 776 | no name, no height, no operator |

Since the hydro handover the top tier is **100 % French**, which is what makes
its orbital `markerMaxDistance` honest.

The bottom tier used to be called *"Seuil & petit ouvrage"*. It never contained
a single OSM-tagged weir — `waterway=weir` has never been in the filters — so
the label named a thing the pack does not hold. It names the rule instead.

| | |
|---|---|
| Named | 948 (14%) |
| Hydroelectric | 380 (6%) — the other 94 % of this layer generates nothing |
| With a height | 143 (2%) |
| With a measured span | 5 328 (78%) |
| Footprint polygons / points | 1 264 / 5 576 |

Geometry, and why most dams ship as a point: nodes and closed ways keep what
OSM has (Point, Polygon); an **open** way ships as a Point at the middle of its
crest, because the layer draws its stem, marker and card off one position per
feature and that stem would overwrite the LineString's own polyline — a crest
line would render as a blue thread with no name and no card.

## Properties

An allowlist, and that is also the privacy transform: `contact:*`,
`operator:phone`, `note`, `description` and every other free-text field a mapper
may have pasted an address into never reach the file.

`name` · `osm` (`w123456`) · `operator` · `river` (world half only — OSM does
not tag the watercourse on the dam itself) · `heightM` · `spanM` (longest
straight-line dimension of the mapped structure, ≥ 25 m) · `material` (family,
not the raw free-text value) · `builtYear` · `outputMw` · `hydro` · `abandoned`.

Nothing is emitted empty: an absent field is absent, so the card omits a line
rather than printing a placeholder.

## Rebuilding

```sh
npm run dams:pack                       # queries Overpass (~90 s)
node scripts/build-osm-dams.mjs raw.json  # replays a saved Overpass answer
```

`carryOverWorld` drops any carried feature that is `hydro` and unclassified, so
a rebuild re-applies the 2026-09-14 split rather than resurrecting the 592.

Idempotent and deterministic: the world half is read back out of the file the
script writes, features are emitted in code-point order of their OSM id, and
coordinates are rounded to 6 decimals — two runs over the same Overpass answer
produce the same bytes on any machine.

`dams.geojson` is the human-readable twin of the runtime `dams.geojsonl`; both
carry the same features.

## Licence

Open Database License (**ODbL 1.0**). Keep the OpenStreetMap contributor
attribution — and the Open Infrastructure Map credit for the world half — when
redistributing this derived database. See `DATA_SOURCES.md`.
