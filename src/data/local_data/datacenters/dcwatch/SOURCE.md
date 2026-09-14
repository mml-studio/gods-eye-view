# DCWatch — provenance & licence

`export_summary.csv` is the flat export of the DCWatch database, vendored here
so that the datacenter pack can say how much electricity a French site draws.
OpenStreetMap cannot: `data_center:power` is set on **five** French features out
of 372, and the three other capacity keys the card reads match one feature each
in the whole world.

## Provenance

| File | Source | Licence | Retrieved |
|---|---|---|---|
| `export_summary.csv` | **DCWatch** release `2026.04.09`, a collaborative research database initiated by [Hubblo](https://hubblo.org) following the ADEME/Arcep work on datacenter electricity consumption published in January 2026 | **ODbL** (see `DATA_LICENSE`) | 2026-09-14 |

- **Downloaded from:**
  `https://gitlab.com/hubblo/datacenter-watch/-/archive/2026.04.09/datacenter-watch-2026.04.09.tar.gz`
  (HTTP 200, 7 545 331 bytes). `export_summary.csv` and `DATA_LICENSE` are taken
  verbatim from that archive; nothing else in it is vendored.
- **Project pages:** documentation at <https://dcwatch.hubblo.org>, map at
  <https://datacenters.hubblo.org>, repository at
  <https://gitlab.com/hubblo/datacenter-watch>.
- **Attribution:** DCWatch's licence requires crediting DCWatch and respecting
  the licences of its own upstream sources. The credit is registered in
  `src/data/dataCredits.js` under the `datacenters` key and surfaces in the
  app's "Data attribution" popover.
- **Share-alike:** ODbL, the same licence as the OpenStreetMap extract it is
  merged with, so `DATA_SOURCES.md`'s existing ODbL section covers both halves
  of the shipped pack.

## What the export contains

520 rows: 427 France, 56 Switzerland, 21 Belgium, 13 Luxembourg, 3 Monaco. Over
the 418 geolocated French rows:

| Column | Filled | Share |
|---|---|---|
| `operator` | 427 | 100 % |
| `progress_step` | 427 | 100 % — 342 `operating`, 85 `project` |
| `latitude` / `longitude` | 418 | 97.9 % |
| `power_total_mw` | 400 | 93.7 % |
| `total_floor_area_sqm` | 375 | 87.8 % |
| `IT_floor_area_sqm` | 371 | 86.9 % |
| `operation_start_year` | 274 | 64.2 % |

French powers run 0.03 MW → 1 400 MW, median 4 MW.

## What it does NOT contain

`PUE`, `WUE`, `CUE`, `ERF`, `REF`, `tier_uptime_institute`,
`cooling_technologies`, `heat_recovery`, `electricity_generation` and `campus`
are columns of the full schema (`dump/datacenters.csv` in the archive) and are
**empty on all 524 rows**. The `estimations` table is empty too, so the database
carries no per-value flag distinguishing a collected figure from a modelled one.
Nothing downstream may present any of these as available.

## Two columns that are derived, and are deliberately not shipped

`total_floor_area_sqm` and `IT_floor_area_sqm` look like two measurements and
are one. Across the 360 French rows carrying both, the ratio is **exactly
0.500 on 223 rows and exactly 5.000 on 49 more** — 75.6 % of the pairs are one
number and a constant, and the `5.000` group is that rule with the two columns
transposed (TGCC: total 3 651 m², "IT" 18 255 m²).

The direction of the derivation is visible in the power-to-surface density,
which piles up on a handful of exact values (1 177 W/m² on 42 rows) because the
surface was back-computed from the power through `datacenter_categories`.

The power survives the same test: recomputing every row as
`total_floor_area_sqm × category ratio` reproduces the published
`power_total_mw` on **2 rows out of 349**. The megawatts were collected; the
square metres were modelled from them. So `scripts/build-datacenters-power.mjs`
copies `power_total_mw` and `operation_start_year` and nothing else, and
`scripts/lib/dcwatchMatch.test.mjs` asserts both that the ratio is still
degenerate and that neither area has leaked into the shipped pack.

## Refreshing

1. Pick the newest release from <https://gitlab.com/hubblo/datacenter-watch/-/releases>.
2. Replace `export_summary.csv` and `DATA_LICENSE` from its source archive.
3. Update `DCWATCH_RELEASE` in `scripts/build-datacenters-power.mjs` and the
   dates in this file.
4. Run `node scripts/build-datacenters-power.mjs`, then `npm test` — the pinned
   feature counts in `src/data/datacentersPack.test.mjs` are expected to move
   and must be updated to the new measured values, not loosened.
