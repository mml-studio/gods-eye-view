# Datacenters

The runtime file `datacenters.geojsonl` is **built**, not extracted. It merges
two ODbL databases:

| File | Role | Source | Licence |
|---|---|---|---|
| `datacenters.osm.geojsonl` | input — the pristine OpenStreetMap extract, 4 351 features worldwide | OpenStreetMap contributors (`telecom=data_center`) | ODbL 1.0 |
| `dcwatch/export_summary.csv` | input — French electrical power, 520 rows | DCWatch / Hubblo, release `2026.04.09` | ODbL |
| `datacenters.geojsonl` | **output**, 4 638 features — what the app loads | derived from both | ODbL 1.0 |

Rebuild with:

```sh
node scripts/build-datacenters-power.mjs          # rewrites datacenters.geojsonl
node scripts/build-datacenters-power.mjs --check  # fails if the output is stale
```

## What the merge does

- **53** OSM features are pinned to a DCWatch row and gain a `dcwatch` property
  block (51 of them with a power). The OSM tags are never edited.
- **287** DCWatch sites in operation that no OSM feature could be pinned to are
  appended as `Point` features tagged `source=DCWatch`. These are datacenters
  OSM has never mapped, and they are the majority: 254 of them sit more than
  400 m from any OSM datacenter.
- **78** DCWatch **projects** are excluded. Drawing an announced building beside
  ones that exist would put something on the map that is not there, and the
  pack has no mark that says "announced".
- Result: **333 French sites carry a power, 2 301 MW in total.**

Matching requires BOTH proximity (≤ 250 m, or the point inside the polygon) AND
a corroborating identity token, and it refuses a pair whose two sides name the
same building stem with different numbers. Without those guards the campus at
Roubaix hands RBX-2's megawatts to RBX6. The rules and their measured failures
are documented in `scripts/lib/dcwatchMatch.mjs`.

About 1 % of the appended points are a site OSM does hold under a different
spelling — `CELESTE - MARYLIN` against OSM's `Datacenter Marilyn` is the known
case. That is the cost of refusing to match on proximity alone, and it is the
cheaper error.

## The OSM half

The public-release snapshot removes contact-oriented tags such as email, phone,
fax, mobile, and WhatsApp values. The application does not display or depend on
those fields; it uses feature identity, geometry, name, operator, and capacity
metadata.

The original extraction date and query were **not recorded** alongside this
snapshot. Future refreshes should record both before replacing
`datacenters.osm.geojsonl`.

## The DCWatch half

See `dcwatch/SOURCE.md` — in particular the reason its two floor-area columns
are not copied into the pack.
