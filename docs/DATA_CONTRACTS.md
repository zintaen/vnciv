# Data contracts (v2, Vietnam build)

> **vnciv.** This document is usaciv's contract; the Vietnam build keeps its shapes with these differences
> (the pipeline in `pipeline/` is new, see the README):
> * **Units.** `world.json` has `km_per_unit` (0.2): the hex radius is 25 map units = 5 km. Coordinates are "map
>   units", not km. `remote` lists the far-offshore island hexes (Hoàng Sa, Trường Sa), left out of framing.
> * **States** = the 34 provinces of 2025 (`abbr` like `HN`, `HCM`; `fips` "01".."34"; extra `former`).
>   **Counties** = the 63 former provinces (`geoid` = ISO 3166-2:VN suffix). **Cities** = their 63 seats, one per
>   former province (`counties: [iso]`, `footprint` = the former province's hexes, extra `province_old/new`).
> * **Economic fields.** `median_income` is income per *person* per year (USD); `jobs`, `gdp_by_industry`,
>   `median_rent`, `home_value`, `rent_burden` are null (not published per province). Extra fields: `area_km2,
>   density, urban, labour_force, trained, literacy, hdi, poverty, gini, income_worker, productivity, fdi,
>   fdi_projects, retail, paddy, tourism, students, lecturers, pci, grdp_growth, internet, computer, clean_water, housing,
>   it_skills, enterprises_pk, pci_2024`; states add the 34-province-only `doctors, doctors_pk, forest_cover, road_deaths,
>   pupils_per_teacher, growth_9m2026, industry_jobs_2026` (HDI and FDI on states and the nation are 2025, on cities 2024).
>   Every city/state/nation record has `years: {field: year label}`; `nation.cities_basis` holds the 2024 national
>   HDI/FDI to compare cities with; `nation.series` = `{indicator: {unit, values: {year: v}, status: {year: s},
>   source: {year: url}}}` is NSO's national row of every timeline series, in NSO units; `nation.nation` also has `employed_lfs, informal, life_exp,
>   gdp_provinces` (the sum of the provinces' GRDP) and the 34-province-only fields. `growth_years` is [2019, 2025]; `gdp_year` 2025.
>   `nation.nation.jobs` is national employment by industry; `nation.currency` holds the VND→USD rate.
> * **Yields**: food = paddy (`unit: "tonnes"`), production = employed workers, gold = GRDP (usd), science =
>   university students (`"students"`), culture = travel and tour turnover (usd).
> * **counties.json** columns are listed in its own `fields`. **lenses.json** ids: density, urban, growth, income,
>   gdp_pc, poverty, gini, fdi, trained, literacy, hdi, unemployment, productivity, pci, disasters (typhoons),
>   forest, farmland, developed, wetland. Since the 2025 update also: internet, clean_water, housing,
>   it_skills (63 former provinces), enterprises, growth_2026, industry_jobs_2026, doctors, road_deaths,
>   pupils_per_teacher, forest_cover (34 provinces: every hex of a province has its value). Province lenses carry
>   `year` and `level` ("63" | "34"). Stream lenses: osm_schools, ethnic_largest, ethnic_minority, crop_rice,
>   crop_maize, crop_cassava, crop_sugarcane, crop_tea, crop_orange, rainfall, temperature, hot_month, cold_month,
>   forest_loss, low_lying. Groups (in this order): people, economy, living, education, hazards, land, environment, agriculture.
> * **districts.json v2**: `catalog`, `rule`, `national`, `cities{id: {districts: [{id, lq|null, via, strength,
>   value?, text}], badge}}` (location quotients of per-resident figures, plus mapped sites).
>   **citizens.json v2**: rows residence / work / skills / households, plus `life_expectancy` and `migration`.
>   **disasters.json v2**: `typhoons` (IBTrACS) instead of FEMA/NOAA.
> * **Pipeline.** The "Pipeline conventions" section below describes usaciv's pipeline. vnciv's is simpler: builders in
>   `pipeline/build/*.py` run in the order of `pipeline/build/__init__.py`, sources are listed in `pipeline/sources.py` and `pipeline/sources_*.py`, and it
>   uses numpy, rasterio and openpyxl (not the standard library only).
> * **military.json** comes from OpenStreetMap military land: components army / navy / air_force / other; tiers by mapped
>   area; personnel, spending and veterans are null (not published). **trade.json** holds domestic air routes
>   (OpenFlights 2014): routes carry `airlines`, `airline_codes`, `airports`, `dist_km`; `value_musd`/`tons_k` are null.
>   Ports carry no tonnage.
> * **infrastructure.json** airports: `name` is OurAirports' English name, `name_vi` the Vietnamese one (the vi
>   Wikipedia title linked from Wikidata, else the Wikidata vi label; `format.js` airportName() shows it in vi).
>   **wonders.json**: a plaque `short` is Vietnamese; `short_en` (optional) replaces it in English ("ĐHQG Hà Nội" /
>   "VNU Hà Nội"). **counties.json** field labels carry their year when it is not the main 2025: "Literacy (2024)".
> * **Vietnam shapes of the usaciv files** (where they differ from the sections below):
>   * **infrastructure.json**: `road_classes` interstate = Expressway, major = National road; `port_classes` [special, I,
>     II, III]; ports add `seaport` (the official seaport they belong to), `class`, `main` (a main port area of 1579/QĐ-TTg)
>     and `placed` (osm | wikidata | geonames | town: where the position comes from); `tons`/`domestic`/`foreign`/
>     `imports`/`exports` are null. `seaports_unplaced: [{seaport, class, areas}]` lists listed seaports with no placed area.
>     `county` = a former-province code, `cbsa` = a cities.json id, `state` = a province abbr.
>   * **resources.json**: types hydro, coal_plant, gas_plant, oil_plant, wind, solar (all MW); items add `since` (year,
>     optional), `capacity_from` ("gppd" when the MW comes from WRI, optional) and `farms` (wind farms merged in a hex, optional).
>   * **wonders.json**: rules `world_heritage`, `national_park`, `research_university`, `landmark`; `national` is
>     `{world_heritage, national_parks, park_visits: null, r1_universities}`; every wonder has `name_en`; `metrics` keys
>     are among `inscribed, inscribed_date, whc_ref` (heritage), `area_km2, visits` (parks), `founded` (universities).
>   * **military.json**: installations add `kind` (the OSM military=* class) and have no `name_mirta`/`components`;
>     `national` = `{personnel, spending, veterans, armed_forces_resident (all null), installations, area_km2,
>     by_component, by_tier}`; `cities` entries have `armed_forces`/`share` null.
>   * **trade.json**: `kind: "air"`, `units: {airlines}`, `modes` = air only; zones are `{id, name, short, kind, states,
>     cities, airports, anchor, partners: [[zone, airlines]]}` (no `faf`, `counties`, `totals_musd`); no `commodities`,
>     `national_musd`; routes have no `tmiles_m`/`top_commodity`.
>   * **disasters.json**: `{version, sources, vintage (string), typhoons: {since, radius_km, provisional_seasons, min_kt, strong_kt, rule,
>     counties: {columns: [geoid, total, strong, last_date], rows}, states: {abbr: {total, strong}}, national: {storms,
>     strong, by_year: [{year, storms}], strongest: [storm], recent: [storm]}}}`, storm = `{name, season, date, max_kt,
>     strong, hexes, provinces, provisional}` (`provisional`: IBTrACS track type PROVISIONAL / US-PROVISIONAL, not yet a
>     final best track; `provisional_seasons` lists the seasons with such storms).
>   * **citizens.json**: rows residence, work, skills, households (`total`/`counts` null for households: only shares are
>     published), plus `life_expectancy` and `migration: {in, out, net, unit}` per row; every city has a row; a top-level
>     `note` says what the shares count.
>   * **world.json** `tables.cover` entries have no `color`/`nlcd`; `tables.notes: {water, relief, cover, provinces}`.
> * **Vietnam-only files** (all optional, `version: 1`, built by `pipeline/build/ext_*.py`, `places.py`, `timeline.py`):
>   * **communes.json** (lazy): `{year, sources, vintage, rules, kinds: [Xã, Phường, Đặc khu], q, unit_km, count,
>     official_2025: {total, communes, wards, special}, by_province: {abbr: {communes, wards, special, total,
>     official_2025}}, count_differences, count_note, outline_check, arcs, communes: [{id, n (name), k (kinds index),
>     p (province), x, y, a (km²), r (rings of arc indices)}]}`.
>   * **poi.json** (lazy): `{vintage, sources, rules, states: [abbr], religions, cols: {layer: [column]}, points: {layer:
>     [[row]]} (state = index into states), metro: [{name, ref, colour, route, km, state, paths}], counts}`.
>   * **relics.json** (lazy): `{vintage, sources, rules, states, cols: [x, y, name, state, year, category, article,
>     placed_by] (state = index into states), relics: [[row]], listed (the number on the list), unplaced: [{name, location, year}]}`;
>     `relics.length + unplaced.length == listed`.
>   * **ethnic.json**: `{source, date, unit, note, rules, groups: [56 names], nation, former: {city id: {name, province,
>     total, minority_share, kinh_share, largest, pop: [56]}}, provinces: {abbr: {name, total, minority_share, kinh_share,
>     largest, pop}}}` (nation has the same fields without name/province).
>   * **forest_loss.json**: `{source, years, canopy_min, unit: "ha", rules, note, cells, forest2000_ha, peak_year,
>     loss_ha: [per year, per cell], provinces: [{abbr, forest2000_ha, loss_ha, share}], national}` (cells = the hexes listed).
>   * **sealevel.json**: `{source, levels: [m], unit, hex_area_km2, rule, note, cells, land_pct, share: [per level, per cell]}`.
>   * **history.json**: `{source, rules, events: [{id, date, year, category (capital | dynasty | admin | national),
>     title, text, cite, evidence, x, y, lon, lat}]}`.
>   * **places.json** (eager): `{sources, rules, archipelagos: [{id, name, owner, x, y, islands}], slogan: {text, en, x, y},
>     islands: [{name, en, group, x, y}], towns: [{name, x, y, population, kind}]}`.
>   * **timeline.json** (lazy): `{sources, years, fx, fx_used, merger: {date, before, after}, series: {id: {unit, source,
>     lens, levels: {"63"|"34": {code: {year: value}}}, lens_values, status: {year: final | prel | est}, status_levels?,
>     note (a definition break inside the series, or null)}},
>     storms: [{name, season, date, max_kt, cells}], events: [{date, id, title, text, wonder?, source}], note}`.
>   * Motion data (lazy, `pipeline/build/ext_motion.py`; every selection rule is in the file's `rules`):
>     * **storm_tracks.json**: `{sources, cols: [time, x, y, kt], rules, storms: [{id (IBTrACS SID), name, season, date,
>       max_kt, agency (JMA | JTWC), points: [[time (ISO UTC "1980-06-26T00:00Z"), x, y, kt | null]]}]}`; `storms[i]` is
>       timeline.json `storms[i]`; points sorted by time, inside the map plus one point just outside at each edge crossing.
>     * **merger.json**: `{sources, date, rules, provinces: [{abbr, name, centroid: [x, y], anchor (cell), order (1..23),
>       order_from (resolution | code), members: [{iso, name, centroid, anchor, keeps_name}]}]}` (the 23 merged provinces).
>     * **motion_routes.json**: `{sources, rules: {rail, sea, air}, rail: [{id (north_south | branch_n), kind (main |
>       branch), from, to, from_city, to_city, cells, pts: [[x, y]], km}], sea: [{port, name, seaport, class, land_hexes,
>       pts}] (illustrative; pts[0] = the port), air: [{a, b (city ids), airport_a, airport_b, rank, airlines, dist_km,
>       p0, c, p1 (quadratic Bézier)}]}`.
>     * **night_lights.json**: `{sources, rules, domain: [lo, hi] (people / km²), values: [0..1 per cell, null off
>       Vietnamese land], seats: [{id, name, x, y, population, capital}]}` (derived from population, not satellite data).


The pipeline (Python) and the browser (web/js) agree on these files in `web/data/`. Change a contract here first, then on
both sides. All coordinates are **map km**: Albers equal-area, origin top-left, y **down** (see `pipeline/core/geo.py`).
Per-cell arrays have length `grid.cols * grid.rows`, with index `row * cols + col` (pointy-top, odd-r layout, see
`pipeline/core/hexgrid.py` ⇄ `web/js/hex.js`). `null` always means "no data". Never write `0` as a stand-in for "unknown".

## Pipeline conventions

* **Sources** (`pipeline/sources/*.py`) are discovered automatically: any `Source` subclass with `info = SourceInfo(...)`.
  `process()` returns a dict. It may include `"vintage"` (str) and `"_files"` (list of raw-file paths relative to
  `data/raw/<id>/` that this processing actually used; the Almanac cites only those).
* **Builders** (`pipeline/build/*.py`) are discovered automatically: a module with `REQUIRES`, `PRODUCES` and `build()`.
  They run in dependency order. Interims made by builders start with `_`. Helpers without `build()` (e.g. `yields.py`) are fine.
* The **`_world` interim** (made by `world`) holds: `grid`, `projection` (`MapProjection` kwargs), `owner`, `county`,
  `county_samples` (7 county indices per US cell, `[]` for other cells; sample 0 = centre), `states` (fips list, same order as
  world.json states), `counties` (geoid list), `water`, `cover`, `pct` (same as world.json). Builders that need to know whether a
  cell is land must use `owner[cell] >= 0`.
* Python is **standard library only**. Downloads go through `Source.download()` (or `Source.download_prefix()` for the
  leading block of a big sorted file), which cache them and record provenance in `data/raw/<id>/manifest.json`;
  `Source.discard(rel_path)` forgets a cached file that turned out to be bad. All three wrap `core.fetch`.
* Under `--offline` (`core.fetch.OFFLINE`, `Source.offline`) sources skip discovery requests and use the newest complete
  cached data; a download of a file that is not cached raises `OfflineError`.
* **Builder checks.** Any module in `pipeline/build/` may define `check(web_dir: Path) -> list[(level, message)]`, level one
  of `PASS`, `NOTE`, `WARN`, `FAIL`. `pipeline check` discovers and runs them after its own checks (section "builder
  checks", each line prefixed with the module name), so a new builder never edits `pipeline/check.py`. Rules: read only
  `web_dir` (tests point it at a tiny synthetic dataset); report a **missing output as a NOTE** (never WARN/FAIL: the unit
  tests run every discovered check against a dataset without your files); a check that raises is reported as a FAIL.
  Validate your file's shape against this document (keys, types, null rules, cell ranges against world.json) and add a
  short data-quality summary (counts, coverage) as PASS/NOTE lines.
* **ACS interims.** `acs_1yr` keeps every estimate line (`<TABLE>_<line>`, e.g. `C24010_007`) of its tables for the nation
  (`geos["0100000US"]`), the states (`geos["0400000USss"]`) and every CBSA (`cbsa["<5-digit code>"]`): `b01003 c24030 b19025
  b19013 b25064 b25077 b23025` plus, for citizens, `c24010` (occupation; male lines 002-037, female = male + 36), `b01001`
  (age; male 003-025, female = male + 24), `b01002` (median age), `c08301` (commute), `c15003` (education 25+) and `b05002`
  (place of birth). Sexes are **not** summed in the interim: builders add male + female lines. Census leaves some small
  CBSAs out of a table entirely (C24010 has 520 of 536 CBSAs, C08301 525, B05002 535): the CBSA's record then simply lacks
  those keys (treat as null). `acs_5yr` (`geos["0500000USsscc"]`, counties) adds `b21001` (veterans: `B21001_001` civilian
  population 18+, `_002` veterans) and `b23025` (`B23025_001` population 16+, `_006` in the armed forces, by residence).

## world.json

```jsonc
{
  "version": 2,
  "grid": {"radius": 25, "cols": 117, "rows": 90},
  "width": 5002.0, "height": 3301.7, "margin": 200,
  "owner":  [int],   // -1 water, -2 foreign land (Canada, Mexico, the Caribbean), >=0 index into states
  "county": [int],   // index into counties, -1 if none
  "elev":   [int],   // metres. Land: mean of land samples only. Water: mean of the hex's ETOPO samples below sea
                     // level (its depth, <= 0); lakes: min(mean, 0); -4000 where ETOPO has no samples
  "elev_max": [int], // optional: metres, the highest land sample in the hex (0 for water); the art uses it for snow
  "water":  [int],   // 0 land, 1 ocean, 2 coast (next to land or shallower than 200 m), 3 lake
  "relief": [int],   // 0 flat, 1 hills, 2 mountains, 3 peaks (alpine). 0 for water. A hex whose lower 60% of land
                     // samples is flat lowland (spread < 60 m, under 400 m) is eased one class (valley floors)
  "cover":  [int],   // land-cover id (see tables.cover). 0 = unknown/none (water, foreign land outside NLCD)
  "pct": {           // share of the cell's land samples, 0..100 ints (US cells; 0 elsewhere)
    "forest": [int], "crop": [int], "pasture": [int], "grass": [int], "shrub": [int],
    "wetland": [int], "developed": [int]
  },
  "tables": {
    "water":  [{"id": 0, "name": "Land"}, {"id": 1, "name": "Ocean", "color": "#1b4266", "rule": "..."}, ...],
    "relief": [{"id": 0, "name": "Flat", "rule": "..."}, ...],
    "cover":  [{"id": 1, "key": "forest_deciduous", "name": "Deciduous forest", "color": "#4f7a35", "nlcd": [41], "rule": "..."}, ...]
  },
  "states":   [{"fips": "01", "abbr": "AL", "name": "Alabama"}],
  "counties": [{"geoid": "01001", "name": "Autauga County"}],
  "rivers":   [{"name": "Mississippi", "rank": 1, "pts": [x0, y0, x1, y1, ...]}]   // clipped to the map; no lake centerlines
}
```

Cover ids (fixed): 0 none · 1 forest_deciduous · 2 forest_evergreen · 3 forest_mixed · 4 scrub (scrub & desert) ·
5 grassland · 6 pasture · 7 cropland · 8 wetland · 9 urban · 10 barren · 11 ice.
Dominant cover per cell = the largest group among its land samples. A cell is **urban** if NLCD 22+23+24 (developed
low/med/high) ≥ 30% of land samples. NLCD 21 (developed open space) counts toward grassland.

## cities.json

A list sorted by population, descending:

```jsonc
{
  "id": "35620",                  // 5-digit CBSA code
  "name": "New York", "full": "New York-Newark-Jersey City, NY-NJ Metro Area",
  "states": ["NY", "NJ"], "metro": true, "capital": false,   // capital: the national capital (Washington)
  "x": 3912.1, "y": 1100.4,       // principal city's true position (map km)
  "cell": 4567,                   // land cell (owner >= 0), unique per city where possible; banners anchor here
  "population": 20112448, "employed": 9876543,
  "yields": {"food": 15523, "production": 1059252, "gold": 2.1e12, "science": 1470849, "culture": 252479},  // any may be null
  "jobs": {"agriculture": 123, "...": null},
  "median_income": 98000, "median_rent": 1700, "home_value": 650000, "unemployment": 0.0578, "rent_burden": 0.227,
  "gdp": 2.1e12, "gdp_year": 2024,                       // BEA, current dollars; null if unavailable
  "gdp_by_industry": {"manufacturing": 1.2e11, "...": null},  // optional. BEA-withheld (D) county values are
                       // recovered from parent/sibling lines, else the parent's remainder is split in national proportions
  "gdp_undisclosed": null,          // optional: total minus the industries above when some stay null (usd), else null
  "gdp_estimated": ["utilities"],   // optional: industries whose value includes an apportioned county figure, or null
  "growth": 0.0174, "growth_years": [2021, 2025],         // population change, see below
  "counties": ["34003", "36005", "..."],                  // member county GEOIDs (OMB delineation, list 1), sorted
  "footprint": [3721, 3722, 3845, "..."],                 // US land cells of the metro, sorted (see below)
  "pop_series": {"2020": 20081935, "2021": 19708911, "...": null, "2025": 20112448},  // PEP, or null
  "ranks": {"population": 1, "gdp": 1, "gdp_per_capita": 12, "growth": 301,
            "food": 1, "production": 1, "gold": 1, "science": 1, "culture": 1},     // 1 = top; null if value null
  "peers": ["31080", "16980", "..."]                      // ids of the 5 cities closest in population
}
```

* **`footprint`**: the hexes that make up the metro on the map (City view). A US land cell (`owner >= 0`) belongs to
  a city when at least 4 of its 7 county samples (`_world.county_samples`) fall in the CBSA's member counties. The
  city's own `cell` is always included, even when it fails that test (a small metro, or a banner cell nudged away), so
  `footprint` is never empty. A cell is in at most one footprint by the majority rule, but a city's own `cell` may also
  sit in a bigger neighbour's footprint.
* **`counties`**: the CBSA's member counties from the OMB delineation (`cbsa_delineation`, list 1), the same list GDP is
  summed over. Some may be outside the map's county list (none are, today).
* **`pop_series`**: `{year (string): population}` for every year of the population-estimates vintage (2020 … latest,
  `pep_population`), on today's metro borders. A year without an estimate is `null`; the whole field is `null` when the
  CBSA is not in the estimates or its county list there differs from the delineation (the same guard as `growth`).
  These are PEP numbers, so the latest year will not equal the ACS `population`.
* **`ranks`**: rank among all cities in cities.json (metro and micro), 1 = highest, for `population`, `gdp`,
  `gdp_per_capita` (`gdp / population`), `growth` (1 = fastest growing) and each yield key. `null` where the value is
  null; non-null ranks are a permutation of 1..N, ties broken by population.
* **`peers`**: the 5 other cities whose population is closest to this one's, by ratio (|log(p / q)|), nearest first.

**Growth** (cities, states and `nation.nation`): `growth = population(end) / population(2021) - 1`, a fraction
(0.0174 = +1.74%), over `growth_years = [2021, end]`, where `end` equals nation.json `year` (the ACS year the panels
show). Both populations come from one vintage of the Census population estimates (PEP, source `pep_population`), which
estimates every year on the current (July 2023) metro delineations and with the same methods. So a city's growth is
like for like: no county added or dropped between the two years (e.g. Chicago without Kenosha County in both years,
Connecticut's planning regions back to 2020, renamed areas such as Kiryas Joel-Poughkeepsie-Newburgh), and no mix of
estimate vintages. `population` itself stays the ACS 1-year total; the two are different estimates and will not
divide exactly. The same `growth_years` is used in every file; it is null only when no estimates were fetched.
`growth` is **null** (never a guess) when:

* |growth| > 25% (a sanity cap; no area comes near it);
* for cities: the CBSA is not in the PEP metro file, or its member counties there differ from the OMB delineation
  the rest of the map uses (`cbsa_delineation`). See `pipeline/build/growth.py`.

Currently every city, every state and the nation have a rate. `check` fails if a state or the nation has none while
`growth_years` is set, if rows disagree on `growth_years`, or if it does not end at nation.json `year`.

## states.json

A list in the same order as world.json `states`, each with the same economic fields as a city (`population`, `employed`,
`yields`, `jobs`, medians, `unemployment`, `rent_burden`, `gdp`, …) plus `fips`, `abbr`, `name`,
`growth`/`growth_years` (as above), `ranks: {yieldKey: 1..49}` (1 = largest), and `label: {x, y, angle, size}` (null
for a state without hexes, i.e. DC). `label` is an optional suggested anchor for the big state name: `angle` in degrees
clockwise, `size` a suggested font height in map km, clamped to 14..110 km. The 14 km minimum can exceed very small
states (RI, DE), so the frontend should still clamp or hide those labels. The frontend may compute its own.

Also, per state:

```jsonc
"land": {"forest": 0.312, "crop": 0.204, "pasture": 0.051, "grass": 0.12, "shrub": 0.08, "wetland": 0.06,
         "developed": 0.044},   // or null (no hexes, i.e. DC)
"energy": {"unit": "MW", "total": 30530,
           "by_type": {"nuclear": 3937, "hydro": 0, "coal_plant": 0, "gas_plant": 5100, "geothermal": 0,
                       "pumped_storage": 0, "wind": 0, "solar": 7250, "battery": 4200},
           "sites": {"nuclear": 1, "hydro": 0, "...": 0},
           "note": "Only the mapped sites in resources.json ... not the state's total capacity."}
```

* **`land`**: land-cover shares as **0..1 fractions**: the mean of world.json `pct` over the state's cells
  (`owner == index`) that have land-cover samples (`cover > 0`). Keys are world.json `pct` keys. `null` for a state
  without such cells (DC).
* **`energy`**: MW summed from resources.json items whose `cell` is in the state, for every resource type with unit
  `MW` (all such types appear; `0` means no mapped site, a real zero for the map, not for the state). **It only counts
  the mapped sites above each type's threshold** (e.g. gas plants ≥ 1,500 MW, wind ≥ 500 MW per hex; see the types'
  `description`), so it is **not** the state's total generating capacity; `note` says so in plain words for the UI.
  Items count in their resources.json `state`; a site EIA files once per state (Hoover Dam, AZ + NV) is one item
  and counts in the state of its larger part. `sites` = number of mapped sites per type.
  `energy` is `null` if resources.json was not built.

## nation.json

```jsonc
{
  "vintage": "ACS 2025 1-year", "year": 2025,
  "gdp_vintage": "BEA CAGDP2, 2024",
  "nation": { /* same economic shape as a city */ },
  "yields": [{"key": "food", "icon": "y-food", "emoji": "🌾", "label": "Food", "color": "#7fbf3f",
              "unit": "workers|usd", "description": "..."}],
  "industries": {"agriculture": "Agriculture, forestry, fishing & hunting"}
}
```

## lenses.json

Produced by `pipeline/build/lenses.py`.

```jsonc
{
  "vintage": "ACS 2024 5-year",
  "groups": [{"id": "people", "name": "People"}, {"id": "prosperity", "name": "Prosperity"}, {"id": "knowledge", "name": "Knowledge"},
             {"id": "life", "name": "Daily life"}, {"id": "land", "name": "Land"}],
  "lenses": [{
    "id": "density", "group": "people", "name": "Population", "icon": "l-people", "emoji": "👥",
    "unit": "people / km²", "format": "int|usd|pct|float|minutes|years",   // pct values are 0..1 fractions
    "scale": "log|linear", "domain": [1, 2000],   // 2nd-98th percentile of the hex values, computed at build time "ramp": ["#..", "..."], "higher_is": "good|bad|neutral",
    "source": "acs_5yr", "description": "...",
    "values": [number|null],       // per cell; null on non-US cells
    "note": "..."                  // optional: a short caveat the legend always shows (e.g. what a count does not measure)
  }]
}
```

**Categorical lenses** (`"format": "category"`): each value is an integer index into `categories` (or null);
`"categories": [{"id": "catholic", "name": "Catholic", "color": "#…", "description"?: "…"}]` (≥ 2), `ramp` = the
categories' colours in the same order, `"scale": "linear"`, `"domain": [0, n - 1]` (so the ramp stops land exactly on the
colours). The legend shows swatches (click one to show only it) and tooltips show the category name. `check` enforces all
of this.

**County lenses from the Religion Census, CDC PLACES, FEMA and ACS veterans** (ids are a contract with the frontend, which may link to them):

| id | group | format | values | note (legend caveat) |
|---|---|---|---|---|
| `faith` | `faith` (group "Faith") | `float`, unit `adherents per 100 residents`, domain clamped to `[0, 100]` | 2020 U.S. Religion Census adherents ÷ 2020 population × 100 (compute it; do not trust the RATE columns), per county spread to hexes like the other county lenses. Can exceed 100 (adherents are counted where the congregation is) | required: counts congregations' adherents where they worship, not residents' beliefs; about half of Americans are counted; some traditions (notably historically Black churches) are under-reported; 2020 data |
| `faith_tradition` | `faith` | `category`: `evangelical`, `mainline`, `black_protestant`, `catholic`, `orthodox`, `lds`, `other` (Latter-day Saints split out of ARDA's "Other") | the county's largest tradition by adherents; null where no adherents were reported | same caveat |
| `amenities` | `life` | `float`, unit `index`, `higher_is: good` | 100 − 10 × mean z-score of the CDC PLACES age-adjusted shares of frequent mental distress, depression, fair/poor health and no leisure-time activity (state the exact recipe in `description`); null where PLACES has no BRFSS core data (all of KY and PA in the 2025 release): never imputed | required: model-based estimates, not a happiness survey |
| `disasters` | `hazards` (group "Hazards") | `int`, unit `declarations` | distinct FEMA major-disaster (DR) declarations naming the county since 2000 (Biological/COVID excluded; deduplicated by disaster number) | required: a declaration is an administrative act, not a measure of damage |
| `veterans` | `people` | `pct` (0..1) | ACS 5-year `B21001_002 / B21001_001` (veterans among civilian adults 18+) | |

Connecticut: the map's counties are the 2022 planning regions (`09110`…`09190`). Sources on the 8 legacy counties (USRC,
FEMA) need an overlap crosswalk, or CT stays null and the lens `note`/`description` says so.

**As built** (`pipeline/build/lenses.py` `community_lenses`, appended after the land lenses so the
existing lenses keep their array positions; every county value is spread to hexes with the same population weights as
the other county lenses, and the county formulas are shared with counties.json):

* `faith` (source `usrc_2020`): county `adherents / POP2020 × 100` (1 decimal); hex = population-weighted mean;
  `domain` fixed `[0, 100]` (no percentile note); counties can exceed 100 (max ≈ 450). **CT is null** (USRC's 8 old
  counties are not apportioned: no town-level adherent counts exist), as are the two counties with a blank total.
* `faith_tradition` (`usrc_2020`): categories in this order `evangelical, mainline, black_protestant, catholic, orthodox,
  lds, other` (each `{id, name, color, description}`; `other` = ARDA "Other" minus Latter-day Saints). Hex value = the
  tradition with the most adherents after summing each county's adherents × the share of the county in the hex; null
  where none were reported. Icon `l-faith-tradition`, name "Largest tradition".
* `amenities` (`cdc_places`), **named "Wellbeing"** (the id stays `amenities` for URLs and icons; the description says
  it stands in for the strategy-game Amenities): `100 − 10 × mean(z)` over `mhlth, depression, ghlth, lpa` (`_adjprev`), z against the
  unweighted mean ± SD of all mapped counties that have all four (the values are printed in `description`); unit
  `index (100 = average county)`, 1 decimal. Null for KY, PA (and Loving County, TX). PLACES already uses CT planning
  regions.
* `disasters` (`fema_declarations`): hex = population-weighted mean of the county counts **rounded to a whole number**
  (`format: int`); no nulls (0 = no declaration, a real zero). CT regions count a disaster declared for any old county
  they overlap (Census town crosswalk `ct_cou_to_cousub_crosswalk.xlsx`).
* `veterans` (`acs_5yr`): pct, 4 decimals; no `note`.
* Icons (fall back to the emoji until `web/js/icons.js` has them): `l-faith` 🕍, `l-faith-tradition` ⛪, `l-amenities` 🎭,
  `l-disasters` 🌪️, `l-veterans` 🎖️. Groups `faith` and `hazards` sit between `life` and `land`.
* `lenses.py` defines `check(web_dir)` (presence, required notes, faith domain, a short coverage summary).

## resources.json

```jsonc
{
  "types": [{"id": "nuclear", "name": "Nuclear plant", "category": "energy|mineral|agri",
             "emoji": "☢️", "icon": "r-nuclear", "color": "#e8d44d",
             "unit": "MW", "description": "...", "source": "eia_860m"}],
  "items": [{"type": "nuclear", "name": "Palo Verde", "x": 1234.5, "y": 2345.6, "cell": 4321,
             "value": 3937, "detail": "3 units, Arizona Public Service"}]
}
```

Each item also has `"state": "AZ"` (the state the source files the site under, e.g. EIA's plant state; for oil/gas
play hexes, or when that state is not on the map, the state owning its `cell`; a border site such as Vogtle, GA, can sit
in a hex another state owns) and `"cbsa": "38060"` (the id of the
cities.json city whose member counties contain the county at the cell's centre, `world.county[cell]`, or `null`).

Items are the meaningful sites only (thresholds are documented in each type's `description`). The frontend draws at most
one icon per cell at low zoom (the highest-ranked type wins) and may show more when zoomed in.

```jsonc
"summary": {
  "note": "Totals of the mapped sites only (each type's threshold applies) ...",
  "national": {"nuclear": {"count": 54, "value": 96952, "unit": "MW"}, "oil": {"count": 120, "value": null, "unit": "km² play area"}},
  "states":   {"AZ": {"nuclear": {"count": 1, "value": 3937, "unit": "MW"}, "...": {}}}   // only types present
}
```

`summary.national` has every type in `types`; `summary.states` has, per state abbr with at least one item, the types
present there. `value` is the sum of the items' `value` (nulls skipped), or `null` for a type whose values are not
additive: oil and gas items each carry their whole play's area, so summing them is meaningless.

## counties.json

One row per county on the map (the lower 48 + DC, world.json `counties` order), **column-oriented**:

```jsonc
{
  "vintage": "ACS 2024 5-year",
  "fields": [{"key": "population", "label": "Population", "format": "int", "unit": "people", "higher_is": "neutral",
              "source": "acs_5yr", "description": "..."}],    // one entry per column, in column order
  "columns": ["geoid", "name", "state", "population", "land_km2", "density", "income", "home_value", "poverty",
              "median_age", "foreign_born", "bachelors", "broadband", "commute", "homeownership", "uninsured",
              "forest", "crop", "pasture", "developed", "cbsa", "cell"],
  "rows": [["01001", "Autauga County", "AL", 59285, 1539.6, 38.5, 69841, 197900, 0.11, 39.1, ...,  "33860"]]
}
```

`rows[i][j]` is column `columns[j]` of county i; `fields` describes each column (`fields[j].key == columns[j]`).
`format` is one of the lens formats plus `text` (geoid, name, state, cbsa) and `km2`; as in lenses, `pct` values are
**0..1 fractions**. County metrics are computed exactly as the matching lenses (lens id `age` → `median_age`, `home` →
`home_value`). `density` = ACS population ÷ Gazetteer land area (people / km²). Land shares (`forest`, `crop`,
`pasture`, `developed`, same groupings as world.json `pct`) are the mean of the hex shares over the county's sample
points (`_world.county_samples`: a hex counts once per sample of the county in it), `null` for small counties that no
sample hits. `cbsa` is the cities.json id of the metro/micro area the county belongs to (OMB delineation), or `null`
(not in a CBSA, or in one too small for ACS 1-year data and so not in cities.json). `cell` (format `int`) is a
representative US land cell: the one nearest the county's Gazetteer centre point, in its own state where possible, so a
county smaller than a hex can still be ringed and framed. `null` always means no data.

**Faith, wellbeing, disaster and veteran columns** (`pipeline/build/counties.py` `community_fields`; `fields` describe
each, same null rules), after `cell`, in this order: `faith` (float, adherents per 100 residents, 1 decimal; null for CT), `faith_tradition` (text: a `faith_tradition`
category id), `amenities` (float index, 1 decimal), `mhlth` (pct, PLACES age-adjusted frequent mental distress),
`loneliness` (pct, PLACES; null in about 845 counties of states PLACES 2025 left out), `disasters` (int, DR declarations
since 2000-01-01, 0 = none), `veterans` (int, `B21001_002`), `veterans_pct` (pct of civilians 18+), `armed_forces` (int,
ACS `B23025_006`), `armed_forces_pct` (pct of population 16+). A column whose source interim is missing is all null.
Categorical county columns are `text` (the category id), not `category`.

## Optional map-layer files

Every file below is **optional**: the app and `check` work without it, and each owning builder validates its own file with
a `check(web_dir)` (see Pipeline conventions). Shared rules:

* Top level always has `"version": 1`, `"vintage"` (a human string, or `{part: string}`), and `"sources": [source ids]`
  (sources.json ids, so the Almanac can cite them).
* `cell` = a world.json cell index (pointy-top odd-r, `row * cols + col`); a site's `cell` is a US land cell (`owner >= 0`)
  unless stated. `x`, `y` = map km. `county` = 5-digit GEOID from world.json `counties` (or null), `cbsa` = a cities.json
  `id` (or null), `state` = postal abbr.
* Money is **US dollars** (not thousands or millions) unless the key says otherwise (`_musd`); shares are 0..1 fractions;
  `null` = unknown, never `0`. A value that is a **lower bound** (suppressed parts left out) says so (`lower_bound: true`
  or a `suppressed` count).
* Rules that pick things (districts, wonders, routes) are published inside the file as text (`rule` / `rules`) so the UI
  and the Almanac can quote them.
* **Loading** (browser): `infrastructure`, `military`, `wonders`, `trade`, `places` load eagerly right after the first frame (keep
  each **under ~300 kB**); `citizens`, `districts`, `disasters` load on demand with `app.loadData(name)`.

### citizens.json (lazy)

Per metro, the citizen mix for the City View's person icons, from ACS 1-year (`acs_1yr`), built by
`pipeline/build/citizens.py`. Figures are computed in the pipeline with **largest-remainder rounding** (each row's
figures sum exactly to its `figures` count), so the frontend only draws icons. About 950 kB: load on demand.

```jsonc
{
  "version": 1, "vintage": "ACS 2025 1-year", "year": 2025, "sources": ["acs_1yr"],
  "figures": {"workforce": 20, "age": 10, "commute": 10},   // icons per row (education/nativity have no figures)
  "rows": {"workforce": "Employed civilians 16+ by occupation", "age": "…", "commute": "…", "education": "…", "nativity": "…"},
  "groups": {   // the categories of each row, in display order
    "workforce": [{"key": "executive", "label": "Executives & managers", "icon": "c-executive",
                   "lines": "C24010 004 (male lines; female = male + 36)"},
                  {"key": "engineer"}, {"key": "scholar"}, {"key": "healer"}, {"key": "service"}, {"key": "clerk"},
                  {"key": "farmer"}, {"key": "builder"}, {"key": "maker"}],
    "age": [{"key": "child"}, {"key": "young"}, {"key": "midlife"}, {"key": "elder"}],
    "commute": [{"key": "drove_alone"}, {"key": "carpool"}, {"key": "transit"}, {"key": "walk"}, {"key": "other"}, {"key": "home"}],
    "education": [{"key": "less_than_hs"}, {"key": "high_school"}, {"key": "some_college"}, {"key": "bachelors"}, {"key": "graduate"}],
    "nativity": [{"key": "born_in_state"}, {"key": "other_state"}, {"key": "native_abroad"}, {"key": "foreign_born"}]
  },   // every entry has "label", "lines" and a suggested "icon" id (c-*; not yet in icons.js: fall back to a person)
  "rule": {"specialist_high": 1.5, "specialist_low": 0.67, "min_share": 0.01, "max_high": 4, "max_low": 2, "text": "…"},
  "national": { /* a row for the US (geos 0100000US); "specialists": [] and no "reliable" */ },
  "cities": {"41940": { /* a row */ }}   // every cities.json id; a city absent from all five tables → null
}
// a row:
{
  "workforce": {"total": 1056000, "counts": {"executive": 211000, …}, "shares": {"executive": 0.2, …},
                "figures": {"executive": 4, …}} | null,      // null when Census left the CBSA out of C24010
  "age": {"total": …, "counts": {…}, "shares": {…}, "figures": {…}, "median": 38.4 /* B01002_001, or null */} | null,
  "commute": {"total": …, "counts": {…}, "shares": {…}, "figures": {…}} | null,   // workers 16+ (C08301_001)
  "education": {"total": …, "counts": {…}, "shares": {…}, "bachelors_plus": 0.57} | null,  // adults 25+
  "nativity": {"total": …, "counts": {…}, "shares": {…}, "foreign_born": 0.42, "born_in_state": 0.31} | null,
  "specialists": [{"row": "workforce", "key": "engineer", "share": 0.26, "national": 0.074, "ratio": 3.5}],
  "reliable": true   // false for micropolitan areas (1-year margins of error are large there; the UI greys them)
}
```

* `counts` are whole people (rounded estimates); `shares` = count ÷ `total`, 3 decimals; every category of a row is
  present (a category can be 0). A row is null when Census left the CBSA out of that table (2025: 15 cities have no
  C24010 row, 10 no C08301 row) — never zeros.
* `specialists`: categories of any row whose share is ≥ 1.5× (up to 4, strongest first) or ≤ 0.67× (up to 2,
  strongest first) the national share; categories under 1% both in the city and nationally are skipped as noise.
  Ratios are computed from unrounded shares. Use them for the up/down chevrons and the "great person" call-out.

Category → lines (C24010 male line, female = +36): executive 004; engineer 007; scholar 011; healer 016 + 020; service
019 − 020; clerk 027; farmer 031; builder 030 − 031; maker 034 (they sum to `C24010_001`). Age (B01001 male, female = +24):
child 003-006, young 007-012, midlife 013-019, elder 020-025. Commute (C08301): drove_alone 003, carpool 004, transit 008,
walk 009, other 010, home 011 (shares of workers, not of all people). Education (C15003): less_than_hs 002-009,
high_school 010-011, some_college 012-014, bachelors 015, graduate 016-018. Nativity (B05002): born_in_state 003,
other_state 004, native_abroad 002 − 003 − 004, foreign_born 013. All five sums were verified to equal each table's
total line on the national row. Labels are plain words (original names; no game's unit names).

### districts.json (lazy)

Real industry specialisation from BLS QCEW annual averages (`bls_qcew`, ~40 industry slices), as strategy-game
districts, built by `pipeline/build/districts.py`. 2025 QCEW publishes metros as totals only, so **metro values are
sums of member counties** (cities.json `counties`), and LQ = (metro jobs in the district's NAICS ÷ metro total covered
jobs) ÷ (the same US ratio). The total is QCEW industry 10, all ownerships. About 670 kB: load on demand.

```jsonc
{
  "version": 1, "vintage": "BLS QCEW 2025 annual averages", "year": 2025, "sources": ["bls_qcew", "ipeds"],
  "rule": {"min_lq": 1.25, "min_jobs": 1000, "min_share": 0.01, "specialty_lq": 3.0, "specialty_jobs": 5000, "specialty_share": 0.005, "max_per_city": 5,
           "harbor_needs_water": true, "badge_lq": 6.0, "badge_share": 0.03, "college_share": 0.15, "text": "…(quote this in the UI)…", "county_note": "…"},
  "catalog": [{
    "id": "campus", "name": "Campus", "icon": "d-campus", "color": "#4a7bd0",
    "naics": ["5417", "6113", "5415", "5132", "5182"],   // codes summed for the district's score
    "own": [1, 2, 3, 5],                                  // QCEW ownership codes summed
    "sub": {"5417": "Research labs", "6113": "Universities", "5132": "Software", …},  // the listed specialities
    "badge": {"id": "scientific", "label": "Knowledge city", "labels": {"6113": "College town", "5132": "Tech city", …}},
    "description": "…", "caveat": null        // e.g. encampment: "Civilian defense staff only; …"
  }],
  "industries": {"3344": {"title": "Semiconductor and other electronic component manufacturing", "us_emp": 380000}},
  "national": {"emp": 155732363, "avg_pay": 76000},
  "cities": {"41940": {
    "emp": 1180000, "avg_pay": 152000, "counties": [2, 2],      // [counties with a disclosed total, member counties]
    "top": [{"naics": "3344", "emp": 45000, "lq": 15.1, "avg_pay": 251000, "oty_pct": 0.021,
             "suppressed": 0, "lower_bound": false}],           // up to 8 fetched industries by LQ (≥ 1,000 jobs,
                                                                // all ownerships; the 2-digit 31_33/52/22 excluded)
    "districts": [{"id": "campus", "lq": 2.82, "emp": 157377, "share": 0.133, "avg_pay": 190000,
                   "sub": "5415", "sub_lq": 4.66, "sub_emp": 60000,  // strongest speciality (null if none ≥ 1,000 jobs, LQ > 1)
                   "sub_lower_bound": false,  // the speciality's own value is a lower bound (show ≥)
                   "via": "broad",            // "broad" (the district passes) | "specialty" (only a speciality does)
                   "strength": 101000,        // jobs above the national norm, emp − emp/LQ: the ranking key
                   "suppressed": 2, "lower_bound": true}],   // passing the rule, strongest first, ≤ 5
    "badge": {"id": "scientific", "label": "Tech city", "district": "campus", "basis": "qcew",
              "text": "Computer services: 4.7× the national share of jobs"}  // "≥4.7×" when a lower bound;
                                                    // "Seat of government"/"Capital city" only for capital metros
           | {"id": "scientific", "label": "College town", "district": "campus", "basis": "ipeds", "withheld": true,
              "text": "Pennsylvania State University: R1 research university enrolment equal to 34% …"}
           | null
  } | null},                                                    // null: no member county has QCEW data
  "counties": {"06085": {"emp": 1100000, "districts": [["campus", 2.9, 150000]]}}  // [id, lq, emp], same rule
}                                                               // (no Harbor water test), every county with a total
```

Districts (fixed ids, in this order; NAICS 2022):

| id | name | summed NAICS (own) | specialities (`sub`) | badge id |
|---|---|---|---|---|
| campus | Campus | 5417, 6113, 5415, 5132, 5182 (all) | research labs, universities, software, computer services, data hosting | scientific |
| commercial_hub | Commercial hub | 52 (all) | 5231 securities, 524 insurance | commercial |
| industrial_zone | Industrial zone | 31-33, 211, 2121 (all) | 3361 autos, 3344 chips, 3254 pharma, 3241 refining, 331 metals, 211 oil & gas, 2121 coal | industrial |
| harbor | Harbor | 483, 4883 (all) | shipping lines, port services | maritime |
| theater_square | Theater square | 711, 512, 516 (all) | arts & sports, film, broadcasting | cultural |
| entertainment_complex | Entertainment complex | 713, 721 (all) | 7132 casinos, 713 amusement, 721 hotels | entertainment |
| aerodrome | Aerodrome | 481, 4881, 3364 (all) | airlines, airport services, aerospace | aviation |
| government_plaza | Government plaza | 921-927 (federal, state) | offices, courts/police/prisons, benefits, economic agencies, 927 space | governmental |
| encampment | Encampment | 928110 (federal, state) | defense civilians | militaristic |
| aqueduct | Aqueduct & dam | 22 (all) | 2211 power, 2213 water | utility |

* **Rule** (also in `rule.text`): a district appears when its summed LQ ≥ 1.25 and it has ≥ 1,000 jobs or ≥ 1% of the
  metro's jobs (`via: "broad"`), or when one of its specialities has LQ ≥ 3 with ≥ 1,000 jobs (`via: "specialty"`, e.g.
  Houston's oil and gas inside an average-sized Industrial zone: `lq` is then below 1.25). Districts are ranked by
  `strength` (jobs above the national norm, the larger of the district's and its qualifying speciality's), so a small,
  extreme speciality does not outrank what most of a city does; up to 5. Harbor needs a footprint hex that is water or
  next to water, or that a world.json river crosses.
* **Badge** = the strongest district's `badge`, unless a listed district has LQ ≥ `badge_lq` (6) and ≥ `badge_share`
  (3%) of the metro's jobs, in which case the strongest such district (Huntsville, Alamogordo: Military town). So
  `badge.district` is one of the city's `districts`, not always the first. The label is the speciality's nickname
  (`labels[sub]`) when that speciality has LQ ≥ 3, else the district's generic nickname — one vocabulary of nicknames:
  Knowledge city, Finance city, Factory town, Port city, Arts city, Resort city, Air hub, Government town, Military
  town, Utility town. A Government plaza in the national capital (cities.json `capital`) is "Capital city".
  `basis: "ipeds"`: when no Campus district passes because BLS withheld some of a member county's Campus rows, and R1
  universities' IPEDS 12-month enrolment is ≥ `college_share` (15%) of the metro's population, the badge is
  "College town" (`district: "campus"`, `withheld: true`; the campus is *not* in `districts`; State College, Ithaca,
  Champaign, Ames …). null when no district passes and no such rule applies ("diversified").
* Suppressed county rows (`disclosure_code` N, published as 0) are left out of the sums: `suppressed` = how many member
  counties had a withheld part of that value, `lower_bound` = suppressed > 0 (the UI shows "≥"). A value with no
  disclosed county at all is null, never 0. Big single employers are often withheld (e.g. the University of Michigan in
  Ann Arbor, Penn State), so Campus undercounts some college towns.
* Encampment here is QCEW NAICS 928110 (civilian DoD staff and state Guard employees). Uniformed troops come from
  military.json `cities`: the City View shows an Encampment when either file has one, with military.json's tier label.
* QCEW leaves out the self-employed, most farm workers, railroads and uniformed military; jobs are counted where the
  employer's establishment is, not where workers live.

### infrastructure.json (eager)

Tile improvements: roads and rail rasterised onto hex links (no polylines), plus ports and airports as sites. Built by
`pipeline/build/infrastructure.py` from `natural_earth_roads` (NE 1:10m roads + railroads, pinned v5.1.2), `usace_ports`
and `faa_airports` (both in `pipeline/sources/transport_hubs.py`). About 200 kB.

```jsonc
{
  "version": 1,
  "vintage": {"roads": "Natural Earth v5.1.2 (1:10m)", "rail": "…", "ports": "USACE principal ports, CY2023 tonnage",
              "airports": "FAA CY2025 enplanements, CY2025 all-cargo"},
  "sources": ["natural_earth_roads", "usace_ports", "faa_airports"],
  "rules": {"roads": "…", "rail": "…", "ports": "…", "airports": "…"},   // selection rules, quotable in the UI
  "road_classes": [{"id": "interstate", "name": "Interstate"}, {"id": "major", "name": "Major highway"}],
  "rail_tiers": [{"id": "main", "name": "Main line"}, {"id": "secondary", "name": "Secondary line"}],
  "hubs": {"L": "Large hub", "M": "Medium hub", "S": "Small hub", "N": "Nonhub primary"},
  "roads": [[3721, 3722, 0, "I-95"]],   // [cell a, cell b, class index, route name or null]; a < b, neighbours, unique pair
  "rail": [[3721, 3845, 0]],            // [a, b, tier index]; a < b, neighbours, unique pair
  "ports": [{"id": "2031", "name": "Houston Port Authority", "type": "coastal|great_lakes|inland", "rank": 1,
             "tons": 309531236, "domestic": …, "foreign": …, "imports": …, "exports": …, "year": 2023,   // short tons
             "x": …, "y": …, "cell": 9123, "county": "48201", "cbsa": "26420", "state": "TX"}],     // sorted by rank
  "airports": [{"id": "ATL", "name": "Hartsfield/Jackson Atlanta International", "city": "Atlanta", "hub": "L|M|S|N|null",
                "enplanements": 51459786, "enplanements_prev": 52511402, "cargo_lbs": 2864017498 | null, "year": 2025,
                "x": …, "y": …, "cell": …, "county": …, "cbsa": …, "state": "GA"}]   // sorted by enplanements, desc
}
```

* **Links** join **neighbouring** cells, at least one end on US land (`owner >= 0`) and neither end foreign land
  (`owner == -2`). Each line is sampled every 4 km, gaps are filled by a hex line walk, and a cell the line only clips
  at a corner is dropped (so a road along a row boundary does not zigzag). A pair appears once, with its best class
  (an Interstate link is never also a major link). Rail samples inside Canada or Mexico are dropped.
* **Road classes**: 0 = every NE road with `level == "Interstate"`; 1 = other roads at NE scale rank ≤ 6 plus
  expressways typed "Major Highway"/"Beltway". Route names: `I-95`, `US 101`, or the NE name for state roads; where
  several routes share a link the lowest number wins. **Rail tiers**: 0 = NE scale rank ≤ 5, 1 = 6–7.
  Natural Earth road and rail work is map art, not statistics (older alignment, about half the real rail network).
* **Ports**: USACE principal ports in the lower 48 (port-area centroid; long river ports are approximate). **Airports**:
  every primary airport (`hub` L/M/S/N) plus every airport in FAA's all-cargo table (`hub` null if not primary),
  placed by FAA id with the NASR airport master. `enplanements` null when the airport is only in the cargo table;
  `cargo_lbs` (all-cargo landed weight) null when it is not in the cargo table (not zero cargo).
* A site's `cell` is the US land cell at its point, else the nearest within 2 hexes; `x`/`y` stay the true position (a
  port's may be on water). `county`/`cbsa` come from that cell's centre county (OMB delineation, cities.json ids only).
  Tons and pounds are as published (short tons, landed lbs).

### trade.json (eager)

Freight "trade routes" between FAF5 zones (`faf5`), domestic flows only (`trade_type` 1), newest FAF year. Built by
`pipeline/build/trade.py` (after infrastructure, whose road links the drawn paths follow). About 70 kB.

```jsonc
{
  "version": 1, "vintage": "FAF5.7.1, 2024", "year": 2024, "sources": ["faf5"],
  "rule": "The 40 largest domestic freight flows by value between FAF zones in different states …",   // quote in the UI
  "path_note": "FAF gives a shipment's start and end zones, not its route: …",                          // quote in the UI
  "units": {"value_musd": "million current US dollars", "tons_k": "thousand short tons", "tmiles_m": "million ton-miles"},
  "modes": [{"id": "truck", "name": "Truck"}, {"id": "rail", …}, {"id": "water"}, {"id": "air"}, {"id": "multiple"},
            {"id": "pipeline"}, {"id": "other"}],                  // FAF dms_mode 1..7, in this order
  "commodities": {"43": "Mixed freight"},                          // SCTG2 code → FAF's short name (codes used below)
  "national_musd": {"domestic": 19788731.6, "import": 3134841.1, "export": 2045950.5},   // all zones incl. AK and HI
  "zones": [{"id": "092", "faf": ["092", "341", "363", "423"], "name": "New York-Newark, NY-NJ-CT-PA", "short": "New York",
             "kind": "metro|rest_of_state", "states": ["CT", "NJ", "NY", "PA"], "cities": ["35620", "…"],   // population order
             "counties": 30,                                          // member counties on the map
             "anchor": {"cell": 3845, "x": …, "y": …, "city": "35620" | null} | null,
             "partners": [["251", 61923.5, "truck"]],                // top 5 partner zones, any state: [zone, value_musd, top mode]
             "totals_musd": {"within": …, "other_zones": …, "import": …, "export": …}}],   // sorted by id
  "routes": [{"a": "092", "b": "251", "rank": 1, "value_musd": 61923.5, "tons_k": 15089.1, "tmiles_m": 3471.2,
              "modes": {"truck": 0.7268, "rail": 0.01, "...": 0}, "top_mode": "truck", "top_commodity": "43",
              "dist_km": 306, "path": [3845, 3846, "…"]}]           // rank order (value, desc)
}
```

* **Zones**: Alaska and Hawaii are dropped (115 zones remain). The parts of one CFS area split by a state line
  (same CSA/CBSA code) are **merged** into one zone: `id` = its lowest FAF code, `faf` lists the parts. Member counties
  come from the 2023 OMB delineation (CSA or CBSA code within the part's state; Knoxville's 2017 CSA 314 is today's 315);
  a rest-of-state zone holds the state's other counties. Each cities.json city joins the zone holding most of its
  member counties. `anchor` = the biggest city's banner cell, or (no city) the land cell nearest the middle of the
  zone's cells; `null` only if neither exists.
* **Routes**: only flows between FAF parts in **different states** count, the two zones may share no state, and their
  anchors must be ≥ 250 km apart; both directions are summed; the 40 largest by value are kept. `modes` are value
  shares (sum to 1). `top_commodity` is the largest SCTG2 by value among each part pair's top 5. `path` is a chain of
  neighbouring cells from `a`'s anchor to `b`'s along the cheapest road links (Interstate < major < rail < cross-country
  < water steps): a drawing aid, not data (FAF assigns no route).
* Values are FAF model estimates in **million current dollars** (`value_musd`) and **thousand short tons** (`tons_k`), as
  FAF publishes them; say so in the UI. Pipeline-dominated routes (crude, gas) are real and should get their own style.

### military.json (eager)

Built by `pipeline/build/military.py` from `mirta` (`sources/mirta.py`), `dmdc_personnel` (`sources/dmdc.py`),
`oldcc_spending` (`sources/oldcc.py`) and `acs_5yr`. About 280 kB (mostly installations).

```jsonc
{
  "version": 1,
  "vintage": {"installations": "DoD MIRTA FY2025 (layer edited …)", "personnel": "DMDC, as of September 30, 2026",
              "spending": "OLDCC FY2024", "acs": "ACS 2024 5-year"},
  "sources": ["mirta", "dmdc_personnel", "oldcc_spending", "acs_5yr"],
  "rule": "A metro gets an Encampment when …",           // the Encampment rule, quotable as is
  "rules": {"tier": "…", "ranges": "…", "encampment": "…", "installations": "…",   // every selection rule as text
            "names": "…"},                       // the 2025 Army renames applied to MIRTA names, with the source URL
  "flagships": ["Naval Station Norfolk", …],             // the curated flagship list (names as in MIRTA)
  "caveats": "…",                                         // show where installation/personnel numbers appear
  "components": [{"id": "army", "name": "Army", "codes": ["usa"]}, {"id": "navy"}, {"id": "air_force"}, {"id": "marines"},
                 {"id": "army_reserve"}, {"id": "navy_reserve"}, {"id": "air_force_reserve"}, {"id": "marine_reserve"},
                 {"id": "army_guard"}, {"id": "air_guard"}, {"id": "other"}],   // Space Force sites are filed as air_force
  "installations": [{"id": "fort-bragg-usa", "name": "Fort Bragg", "component": "army", "joint": false,
                     "name_mirta": "Fort Cavazos",          // optional: only when `name` differs (see rules.names);
                                                           // ids keep the MIRTA spelling (fort-cavazos-usa = Fort Hood)
                     "status": "act|semi|care",           // closed (clsd) and excess (excs) sites are left out
                     "tier": "major|base|site",            // rules.tier: by boundary area / component, never headcount
                     "curated": false,                     // true: a flagship base made 'major' by the published list
                     "area_km2": 628.4 | null,             // null: MIRTA has no boundary for the site (incl. folded parts)
                     "parts": ["NNSY St Helena", …],       // optional: small parcels folded into this installation
                     "components": ["air_force", "marines"],   // optional: when the folded parts span components
                     "cells": [..] | null,                 // hexes whose centre the boundary covers (boundaries >= 200 km²)
                     "x": …, "y": …, "cell": …, "county": "37051" | null, "cbsa": "22180" | null,
                     "state": "NC",                        // where the point lies (county, else hex owner)
                     "state_filed": "NC"}],                // the state MIRTA files it under (UTTR: NV)
                                                           // sorted major → base → site, then by area
  "ranges": [{"id": "nevada-test-and-training-range-usaf", "name": "Nevada Test and Training Range",
              "component": "air_force", "area_km2": 11702.8, "cells": [..],   // never empty (see rules.ranges)
              "state": "NV",                  // its installation's point state when mapped (Fort Bliss: TX), else hex_state
              "hex_state": "NV",              // the state holding most of its hexes (Fort Bliss: NM)
              "installation": "…" | null, "name_mirta": "…",   // name_mirta optional, as for installations
              "components": ["air_force", "marines"]}],   // optional; the 30 largest boundaries: restricted ground
  "states": {"NC": {                                       // postal abbr; 50 states, DC and PR (no data → null)
    "personnel": {"active": {"army": …, "navy": …, "marines": …, "air_force": …, "space_force": …, "coast_guard": …, "total": …},
                  "guard_reserve": {"army_guard": …, "army_reserve": …, "navy_reserve": …, "marine_reserve": …,
                                    "air_guard": …, "air_force_reserve": …, "coast_guard_reserve": …, "total": …},
                  "civilian": {"army": …, "navy": …, "marines": …, "air_force": …, "defense_wide": …, "total": …},
                  "total": …} | null,                     // DMDC, by duty state
    "spending": {"total": 1.2e10, "contracts": …, "grants": …, "payroll": …,          // OLDCC, US dollars
                 "payroll_parts": {"civilian": …, "active_duty": …, "guard_reserve": …},
                 "pct_gdp": 0.021, "per_resident": 1150, "personnel": …,              // OLDCC's own personnel count
                 "top_counties": [{"name": "Onslow", "county": "37133" | null, "contracts": …}],   // top 10, OLDCC names
                 "top_vendors": [{"name": "Austal", "contracts": …}]} | null}},       // top 5 contractors
  "national": {"personnel": {…same shape…}, "personnel_scope": "50 states, DC and US territories …",
               "spending": {"total": …, "contracts": …, "grants": …, "payroll": …, "pct_gdp": …, "per_resident": …,
                            "scope": "50 states and DC"},
               "veterans": 16900000, "armed_forces_resident": 1100000, "acs_scope": "…"},   // ACS 5-year, 50 states + DC
  "cities": {"22180": {"tier": "garrison|fortress", "armed_forces": 36721, "share": 0.1212, "naval": false,
                       "installations": ["fort-bragg-usa"],   // up to 8 ids, largest first
                       "installation_count": 1}}             // only cities that pass the Encampment rule
}
```

* Tiers: `major` = active-duty (or other DoD) boundary ≥ 100 km², or one of the curated `flagships` (large bases on
  small land: Naval Station Norfolk, Naval Base San Diego, Wright-Patterson …; `curated: true`). Guard and Reserve
  sites are never `major` (`base` from 10 km², else `site`). Other active-duty sites are `base` from 1 km², else `site`.
  Parcels under 1 km² sharing a hex and component with a larger installation are folded into the nearest one
  (`parts`); the two Barry M. Goldwater Range halves (Air Force, Marine Corps) are one installation and one range.
* Encampment (cities): (a) an active non-Guard installation of tier `major` or `base` in one of the metro's member
  counties, or a range covering one of its hexes, **and** (b) ACS armed forces (`B23025_006`, by residence, summed over
  member counties) ≥ 1% of the 16+ population, or ≥ 2,000 **and** ≥ 0.3%: `fortress` at ≥ 3%, else `garrison`.
  `naval` when the qualifying Navy and Marine installations outweigh the Army and Air Force ones, a `major` counting 4
  and a `base` 1 (so a cluster of small Navy parcels does not make Washington naval). New York and Detroit do not
  qualify; the smallest qualifying shares are about 0.3% (Tampa, Kansas City, Providence).
* Installation-level headcounts are not published; never invent them. Veterans and armed forces by county live in
  counties.json (`veterans`, `armed_forces`), not here.
* `top_counties[].county` is null where OLDCC's county name does not match one on the map (Connecticut: OLDCC uses the
  old counties, the map the 2022 planning regions; Alaska and Hawaii are not on the map). Contract dollars are by place
  of performance, not where bases are.
* Not on the map: sites outside the lower 48 and a few island sites with no US land hex within two rings (Key West,
  San Clemente and San Nicolas Islands).

### wonders.json (eager)

Built by `pipeline/build/wonders.py` from `nps_boundaries` (`sources/nps.py`), `nps_visits`, `ipeds`, `herd`
(`sources/nsf_herd.py`) and `nhl_landmarks` (`sources/nrhp_nhl.py`). About 20 kB, 52 wonders.

```jsonc
{
  "version": 1,
  "vintage": {"parks": "NPS recreation visits 2025", "boundaries": "…", "universities": "NSF HERD FY2025; IPEDS …",
              "landmarks": "NPS National Register GIS (NHL subset)"},
  "sources": ["nps_boundaries", "nps_visits", "ipeds", "herd", "nhl_landmarks"],
  "rules": [{"id": "national_park", "kind": "natural", "kinds": ["natural", "recreation", "coastal", "monument"],
             "year": 2025, "text": "The 15 lower-48 National Parks …"},
            {"id": "park_unit", "kind": "natural", "kinds": […same…], "year": 2025, "text": "The 5 most-visited other …"},
            {"id": "research_university", "kind": "university", "year": 2025, "text": "The 20 universities …"},
            {"id": "landmark", "kind": "landmark", "curated": true, "text": "Hand-picked by this project …"}],
  "national": {"park_visits": 323014305, "park_visits_year": 2025, "r1_universities": 187},
  "wonders": [{"id": "nps-GRSM", "name": "Great Smoky Mountains National Park", "short": "Great Smoky Mountains",
               "kind": "natural|recreation|coastal|monument|university|landmark",   // must be in its rule's `kinds`
               "rule": "national_park", "rank": 1,   // rank within its rule
               "metrics": {…},                    // see below; unknown values are null
               "x": …, "y": …, "cell": …, "cells": [..] | null,   // cells: hexes a big park covers (protected land)
               "county": "37173" | null, "cbsa": "…" | null, "state": "NC", "curated": false,
               "listed_as": "…",                  // landmarks only: the name in the NPS layer
               "state_note": "…"}]                // optional: why state/county differ from the publisher's (Statue of Liberty → NY)
}
```

* `metrics` by rule. Parks: `{visits, year, area_km2, unit_type}`; the merged National Mall (`nps-MALL`) adds
  `visits_of` (the memorial its `visits` come from), `memorials` ({code: visits}) and a `note`: never add the memorial
  counts together. Universities: `{rd_usd, federal_usd, year, enrollment, enrollment_year, r1, med_school,
  reported_as?}` (dollars; `enrollment` is IPEDS 12-month unduplicated headcount, which includes online students;
  `reported_as` names a combined HERD report matched to its lead campus, e.g. Texas A&M with its Health Science Center).
  Landmarks: NPS sites `{visits, year, unit_type}`, NHLs `{designated, nhl_ref, note?}` (`note` when a value the
  NHL layer leaves blank was filled in by hand: Wrigley Field's 2020 designation).
* Park `kind` follows the NPS unit type: National Recreation Areas → `recreation` (Golden Gate, Gateway, Lake Mead),
  seashores and lakeshores → `coastal` (Gulf Islands), memorials, historic sites and battlefields → `monument`, plus
  overrides for the National Mall and the Gateway Arch (a National Park, but a monument); everything else `natural`.
  `rule.kind` stays "natural" for old readers; `rule.kinds` lists what the rule allows. Parks of any of these kinds
  have `metrics.visits` and may have `cells` (protected land): readers should key on `rule` (national_park,
  park_unit), not `kind`, for visits and protected land.
* `rank` is 1-based within the wonder's rule; curated landmarks are ranked alphabetically (not by importance).
  Recreation visits are counted differently by unit type, so parks are ranked only within their rule (the rule text
  says so). Wonders are in rule order: national_park, park_unit, research_university, landmark.
* `state`/`county`: the publisher's filed state wins when the point lands across a border river on the 1:20M county
  outlines (Gateway Arch → St. Louis city). The curated landmarks never repeat a site a park rule already holds
  (Hoover Dam was dropped for Golden Spike because Lake Mead NRA is a park-unit wonder). Statue of Liberty: NPS files it under NJ,
  but Liberty Island is part of New York County, so `state` "NY", `county` "36061" with a `state_note`.

### disasters.json (lazy)

Built by `pipeline/build/disasters.py` from the sources `fema_declarations` (`pipeline/sources/openfema.py`) and
`noaa_billions` (`pipeline/sources/noaa_billion.py`). About 160 kB.

```jsonc
{
  "version": 1, "sources": ["fema_declarations", "noaa_billions"],
  "vintage": {"fema": "OpenFEMA declarations as of 2026-11-25", "noaa": "NOAA NCEI billion-dollar disasters 1980–2024 (final release)"},
  "fema": {
    "window": ["2000-01-01", "2026-11-25"], "as_of": "2026-11-25",     // as_of = the day the declarations were fetched
    "rule": "Distinct major-disaster (DR) declarations naming the county …",   // full text, quote it in the UI
    "types": [{"id": "hurricane", "name": "Hurricanes & tropical storms", "incident_types": ["Hurricane", "Tropical Storm", "Tropical Depression", "Typhoon"]},
              {"id": "flood", …}, {"id": "fire", …}, {"id": "severe_storm", …}, {"id": "winter", …},
              {"id": "other", "incident_types": []}],          // other = every FEMA incidentType not listed above
    "counties": {"columns": ["geoid", "total", "hurricane", "flood", "fire", "severe_storm", "winter", "other", "last_date"],
                 "rows": [["01001", 14, 3, 2, 0, 8, 1, 0, "2025-04-02"]]},   // world.json counties order; 0 = none declared; last_date null if none
    "states": {"TX": {"total": 120, "statewide": 3, "by_type": {"hurricane": 30, "...": 0}}},   // every DR disaster in the state (incl. AK, HI, territories)
    "recent_days": 365,
    "recent": [{"disaster": 4870, "type": "hurricane", "incident_type": "Hurricane", "title": "Severe Storms And Flooding",
                "date": "2026-10-02", "state": "FL", "counties": ["12086"], "statewide": false, "areas": 1}]
                // declared within recent_days of as_of, newest first; counties = map GEOIDs only (CT mapped to regions),
                // areas = FEMA's designated-county count (also counts areas off the map, e.g. Alaska or Puerto Rico)
  },
  "noaa": {
    "years": [1980, 2024], "final": true, "unit": "USD, CPI-adjusted", "rule": "…",
    "types": [{"id": "drought", "name": "Drought"}, {"id": "flooding"}, {"id": "freeze"}, {"id": "severe_storm"},
              {"id": "tropical_cyclone"}, {"id": "wildfire"}, {"id": "winter_storm"}],
    "states": {"TX": {"count": {"drought": 20, "...": 0}, "cost_usd": {"drought": 4.4e10, "...": 0}}},   // incl. AK, HI, PR, VI, GU
    "national": {"events": 403, "cost_usd": 2.92e12, "deaths": 16000,
                 "by_year": [{"year": 1980, "events": 3, "cost_usd": …}],      // from the national event list
                 "costliest": [{"name": "Hurricane Katrina (August 2005)", "type": "Tropical Cyclone", "begin": "2005-08-25",
                                "cost_usd": 2.0e11, "deaths": 1833}]}          // top 10 by CPI-adjusted cost
  }
}
```

NOAA events span many states: never add state costs together into a national figure (use `national`). The shared
helper `disasters.county_declarations(fema_interim, geoids)` gives the per-county counts used by the `disasters` lens,
the counties.json column and this file, so the three always agree.

## sources.json

A list of `{id, title, publisher, homepage, license, description, used_for, vintage, files: [{file, url, retrieved, sha256, bytes}]}`.
`files` lists only files the latest `process()` used (`_files`), or every manifest entry if the source didn't say. A file
saved by `download_prefix()` has a `partial` note in the manifest, and its `sha256`/`bytes` describe the saved part.

## Browser module boundaries (web/js)

* `world.js`: `prepareWorld(world, cities, extras) → w` with `w.grid`, `w.raw`, `w.stateColor[]`, `w.cityByCell: Map<cell, city>`;
  `applyLens(w, lens, band = null)` sets `w.colors`/`w.rgb`; exports `WATER = -1`, `FOREIGN = -2`.
* `camera.js`: `Camera` with `fit()`, `toScreen()`, `toWorld()`, `zoomAt()`, `panBy()`, `centerOn()`, `flyTo(x, y, scale, ms)`,
  `step(dt) → bool stillMoving`, `view()`.
* `render/*`: map drawing and banners. `main.js` owns input, state and wiring. `ui/*` owns DOM panels.
* The `state` object (owned by `main.js`, read by `render/*`): `cities`, `lens` (a lenses.json lens or null = terrain),
  `band` (`[t0, t1]` in normalised lens units 0..1, or null: cells outside are dimmed, see `applyLens`), `hoverCell`,
  `selectedCity` (a city object or null), `selectedState` (a state index, abbr, fips or `{index|abbr|fips}`, or null;
  resolved with `world.js` `stateIndex(w, ref)`), `showResources`.
* `render/snapshot.js`: `renderToCanvas(target, cam, w, state, nation, opts) → {cam, hits}` draws a full frame off-screen
  (share images, OG cards) without touching the on-screen cache. `target` is a canvas, OffscreenCanvas or 2D context;
  `opts`: `banners = true`, `overlay = true`, `dpr = 1`, `fit = "contain"|"cover"|"same"`, or an explicit `scale`, `x`, `y`.

## Browser extension API (window.__app; main.js "extension API", app/api.js)

Extensions live in `web/js/ext/<name>/index.js` and export `install(app)`; `ext/index.js` loads `cityView`, `advisors` and
`layers` (roads, rail, forts, ports, airports, wonders and trade routes). The API:

**Data.**
* `app.data.<name>`: the core files (`world`, `cities`, `states`, `nation`, `lenses`, `resources`, `sources`) are loaded
  before anything runs. Optional files: `undefined` until loaded, `null` when missing (404) or invalid.
* `app.loadData(name) → Promise<data | null>`: loads `data/<name>.json` once (cached promise; later calls return the same
  promise) and sets `app.data[name]`. Emits `"data"` `{name, data}` when it arrives. `infrastructure`, `military`,
  `wonders`, `trade`, `places` are requested automatically right after the first frame; `citizens`, `districts`, `disasters` (and
  `counties`) only when something calls `loadData`. `app.loadCounties()` = `app.loadData("counties")`.

**Static map layers** (art that belongs in the cached map, drawn once per cache render):

```js
const off = app.registerStaticLayer({
  id: "roads",                 // unique; registering the same id again replaces the layer
  z: 55,                       // where it draws among the built-in steps (app.layerZ / render/map.js Z)
  draw(ctx, vp, w, o) {},      // required. ctx starts in world km (saved/restored around the call)
  visible() { return on; },    // optional; false = not drawn, not hit-tested (part of the cache key)
  sig() { return "v1"; },      // optional; any string that changes when the art must re-render (cache key)
  minRpx: 6, maxRpx: Infinity, // optional zoom range in hex radius css px (drawn when minRpx <= Rpx < maxRpx)
  hit(xKm, yKm, Rpx) { return item | null; },   // optional hover / click test, pointer in world km
  tooltip(item) { return "<b>html</b>" | {text: "plain"} | null; },  // optional; a string is HTML: escape data yourself
  click(item, ev) { return true; },             // optional; true consumes the click (see below)
  warm(ctx, vp, w, o) {},      // optional; paint sprites for vp's zoom in idle time (stamps may land anywhere)
  snapshot: true,              // default true: drawn into share images too
});
off();   // or app.unregisterStaticLayer("roads" | layer)
```

* `o` = `{Rpx, s, dpr, lod, lens, selectedCity, showResources, snapshot, app, cells, range: {r0, r1, c0, c1},
  world(), screen(), toScreen(x, y) → [css px]}`. `cells` are the visible cell indices; `o.screen()` switches ctx to
  screen css px of the cache canvas (use `o.toScreen`), `o.world()` back. Use sprites (`render/art/sprites.js`
  getSprite/drawSprite) for anything richer than a few paths.
* Built-in z steps: `WATER 10`, `LAND 20` (land tiles), `GRID 30`, `GLYPHS 40` (terrain), `RIVERS_BORDERS 50`, `CITIES 60`
  (city tiles), `FOG 70` (edge mist), `RESOURCES 80` (screen-space icons), `LABELS 90` (state names). A layer with z
  between two steps draws after the lower one; equal to a step = right after it. Suggested slots: 45 terrain
  improvements, **55 roads and rail**, 58 restricted ground / protected land hatching, **65 sites** (ports, airports,
  forts, wonders, plaques), **85 trade routes** (above resources, under state names).
* The cache key includes every layer's id, `visible()` and `sig()`, so toggling or restyling re-renders the cache and
  nothing else does. Errors in `draw`/`hit`/`sig`/... are logged once per layer and the layer is skipped.
* **Performance**: nothing may animate continuously (an idle map draws no frames); keep each layer under ~3 ms per cache
  render at typical zooms (time it with `drawStatic(..., {layers: app.staticLayers(), timings: T})`: it reports
  `layer:<id>`); precompute geometry once (not per draw); cull to `vp`.
* `app.staticLayers()` lists the registered layers; `app.hitLayer(mx, my)` (screen css px) → `{layer: id, item} | null`.

**Hover and click.** The hover tooltip asks the layers (highest z first, only those drawn at the current zoom) after the
city banners: the first non-null `hit()` wins and its `tooltip(item)` is shown (the cell tooltip otherwise). The
`"hover"` event payload is `{cell, city, resource, x, y, layer, item}` (`layer` = id or null). A click builds
`ev = {cell, city, resource, state, x, y, pointerType, layer, item}`; outside a mode the layer's `click(item, ev)` goes
first (true consumes it), then the `"mapclick"` handlers, then the default (select city/state). While a mode is active
(City View, advisors) the `"mapclick"` handlers go first and the layer's `click` only after them.

**Map toggles.** `app.ui.addMapToggle({id, label, icon, get() → bool, set(on), title?, default?}) → remove()`: a switch
in the "Map" menu next to the Resources toggle in the lens dock (one button + a small menu, so it fits phones). `set` is
yours (flip the state your layer's `visible()` reads); main redraws. The hash key `layers` lists the switches that are on
(`#layers=roads,rail,military`, `layers=none`) and is written only while some switch differs from its default; switches
added after load are set from it, and ids whose extension has not loaded yet stay in the URL. `app.ui.mapToggles()` →
`[{id, label, on}]`. `hash: false` keeps a toggle (a preference such as Effects) out of `layers=` and out of the menu button's count. `app.ui.setMapToggle(id, on) → bool` switches one from code exactly as the menu would (redraw,
hash), e.g. an advisor's "show roads, rail and forts" button; false if no toggle has that id (yet).

**URL.** Core keys: `lens`, `city` (CBSA id), `state`, `at`, plus extension keys (`advisor`, `layers`, ...).
* `#state=` accepts a FIPS code (`48`, `6`), a postal code (`TX`, `tx`) or a state name; a link keeps the form it
  was opened with.
* `at=x,y,z`: `x`, `y` = the map-km point at the centre of the screen (rounded), and `z` = **log2(camera scale ÷
  home-fit scale)**, the zoom relative to the "whole country fits" view: `0` = home framing, `1` = twice as close,
  negative = zoomed out past it. It is relative so a link frames the same area on any screen size; it is *not* the
  absolute scale (css px per km) that `app.flyTo(x, y, scale)` and `camera.scale` use. Convert with
  `scale = fitScale × 2^z`. `at` is written only once the user (or an extension) has moved the camera.
* When the hash is written: during a fly-to the link names the **destination** right away (within one 350 ms debounce
  of the flight starting); after a pan or wheel zoom it catches up 350 ms after the camera settles; `app.setMode`
  writes it on the next task. Lens, selection and mode changes push a history entry (Back undoes them); camera moves
  replace the current one. `app.hash.flush()` writes immediately (Share calls it before copying).

**Year views (ext/timeline).** `app.setLensView(fn | null)`: `fn(lens)` returns a lens-shaped object (own `id`,
`values` per hex, `domain`, `note`, ...) that is coloured, shown in the legend and the hex tooltip instead of the active
lens, or null for the lens itself; `state.lens`, the hash and the picker stay on the real lens. `fn` is called often
(every tooltip), so cache its result. `app.refreshLens()` re-applies after the view's output changed (e.g. a new
year); `app.shownLens()` is the lens as drawn. `app.bannerPopulation = (city) => number | null`: the population shown
on that city's banner instead of `city.population` (swapped in for the banner draw only). `world.js adminBorders(w,
"63" | "34")` returns `{bands, stateLines, bandColor, stateLabels}` for the 63 former provinces (`world.county`) or
the 34; the timeline swaps them into `w` for years before the 2025 merger (`render/map.js` uses `w.bandColor ||
w.stateColor` for the border bands). Hash key `year=` (absent = the latest data, "now").
Replays (`ext/timeline/replay.js`, all on `app.motion`, one at a time in a bottom bar; Esc / ✕ close it): a storm
or a whole season along storm_tracks.json (▶ in the storms card; 1 day ≈ 1.5 s at ×1), the 2025 merger from
merger.json (stepping into 2025 or the merger card's button; hides `w.stateLabels` while it runs) and the forest
loss adding up 2001→2025 (the forest lens's ▶ button; an overlay over the lens as published, no cache re-render
per year). Effects off / reduced motion: the storm shows its complete still track, the merger and forest jump to
the end state.

**Optional state and debug handles** (not data contracts; don't rely on them from other extensions without asking):
* `state.cityBadges`: an optional `Map<city id, {label, color: "#rrggbb"}>` that `render/banners.js` reads to draw a
  city-type tab on banners that show their yield row. Filled by `ext/cityView` from districts.json; absent = no tabs.
* `app.cityView.model`: read-only getter on the City View's current model (debugging).
* `app.mapArt = {model, on, layers}`: added by `ext/layers` for debugging. `model` holds `installations`, `ports`,
  `airports`, `wonders`, each item `{data (the json row), cell, x, y}`. The layers' hit items have the shape
  `{kind: "fort"|"range"|"port"|"airport"|"wonder"|"route", data}` (route items: `data.route` with `a`/`b`); the
  advisors rely on that shape for map-to-dashboard links, so keep it.

**Who reads which fields.** The advisors read every counties.json column after `cell`, military.json `states`, districts.json
`cities` and `counties`, and citizens.json `cities`; the City View reads citizens.json, districts.json, military.json
`cities`, trade.json zones and infrastructure.json `cbsa`. Update `web/js/ext/advisors` and `web/js/ext/cityView`
when renaming a field in those files.

**Lenses.** Legend ticks print numbers only (plus short units: %, $, min, /km²); a longer `unit` is printed once under
the ticks, so keep `unit` a plain phrase ("adherents per 100 residents"), not part of the number. `lens.note` is shown in the legend; `format: "category"` lenses get a swatch legend (see lenses.json).

## Motion (app.motion; web/js/app/motion.js, wired in main.js)

One engine for every animation, on main.js's frame loop. The cached static map is never redrawn per frame: motion
draws per-frame art above it. **Idle = zero frames**: the loop requests frames only while a tween runs or a
registered item's `active()` is true, and only while motion is enabled.

* `app.motion.enabled` (getter): the user's Effects switch is on AND not `prefers-reduced-motion: reduce` AND the
  tab is visible. `app.motion.userEnabled`: the switch alone.
* `app.motion.setEnabled(bool)`: the user switch, persisted in localStorage `vnciv-motion` ("0" / "1"; default on;
  storage errors ignored). The switch is "Hiệu ứng / Effects" (✨) at the top of the Layers menu (group `display`); it is a preference, not a map
  layer, so it is not written to the `layers=` hash (`app.ui.addMapToggle({..., hash: false})`). While the switch is
  off, `<html>` has the class `no-motion` (CSS animations and transitions of the motion work are off).
* `app.motion.on("change", fn(enabled))` → off(): `enabled` flipped (switch, reduced-motion setting, tab hidden /
  shown). When the switch goes off or reduced motion comes on, every running tween jumps to its end first; a hidden tab
  only pauses them (they carry on when it is shown again).
* `app.motion.register({id, z, active() → bool, draw(ctx, cam, app, f), ambient = true})` → unregister(). Same id
  again replaces the item. `draw` runs on **every** frame the map draws (whatever caused it), in the world transform
  (km, like `registerOverlay`); `z < 100` draws under the city banners, `z ≥ 100` above them. Keep `draw` cheap when
  there is nothing to show (cull to `cam.view()` first). `f` (one reused object; don't keep it):
  `{t (s since start), dt (s since the last frame, 1/60 after a pause), dpr, w (the prepared world, app.w), raw
  (app.w.raw), cssW, cssH (canvas css px), active (your active() this frame, false while motion is off), still
  (true = motion is off: draw your still, fully informative end state, or nothing for purely decorative art),
  moving (the camera is panning / zooming: skip expensive ambient detail), lowPower}`.
  `active()` is asked every frame: return true only while something of yours is animating AND on screen.
  `ambient: false` = a data animation the user started (a replay): it keeps full frame rate even in lowPower.
* `app.motion.tween({from, to, ms = 400, ease = "inOut", onUpdate(v, p), onDone()})` → cancel(). Numbers only;
  `ease` = `"linear" | "in" | "out" | "inOut"` or a function p → p. `onUpdate` runs right before each frame draws
  (set state there, then draw it). While motion is disabled it jumps to the end synchronously (`onUpdate(to, 1);
  onDone()`). cancel() stops it where it is (no `onDone`). A frame advances a tween by at most 50 ms, so a slow
  frame (the static re-render right after a lens change, a throttled phone) stretches the tween instead of skipping it.
* `app.motion.countTo(el, to, fmt = String, ms = 650)`: counts `el`'s text from its last `countTo` value to `to`
  (`el.textContent = fmt(v)`; the end shows `fmt(to)` exactly; the first call just sets it). The top-bar numbers use it.
* `app.motion.lowPower`: the 2 s average of the time spent in active items' draws went over 6 ms per frame on this
  device (back off under 3 ms). Ambient items then get half the frame rate (~30 fps).
* `app.motion.items()` → the registered ids (debugging).

Built-in uses (main.js / render/*): a picked lens recolours as a ripple from the middle of the view (~480 ms) and a
timeline year step (`app.refreshLens()` when `app.shownLens()` changed) crossfades (~380 ms): the old cache canvas
is kept (swapped, not copied) and drawn fading over the new one, freed afterwards; the selected province's border
gets one glint sweeping around it (1.1 s, `render/map.js isAnimating`); the selected city's banner pops
(`state.bannerPop`, 340 ms); the hovered hex fades in (`state.hoverFade`, 140 ms); panels, docks and the tooltip
slide / fade in with CSS (off under `.no-motion` and reduced motion); flights keep camera.js's ease-in-out and land
instantly under reduced motion.

- `app.motion.pause(bool)`: stop the loop's frame requests while another view covers the 2D map (the 3D view uses it); `pause(false)` resumes.
