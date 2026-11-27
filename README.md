# vnciv: Vietnam as a strategy game, built from real data

A visualizer (not a game) that draws the **real** Vietnam like a turn-based strategy map: painted hex terrain from
elevation and land cover, the 34 provinces of 2025, cities with yield banners, power plants as resources, roads,
railways, ports, airports and wonders on the tiles, 45 lenses, a City View, a council of Advisors and an Explorer.
Every number traces back to a public source listed in the in-app **Almanac**. The interface is in **Vietnamese** (default)
and **English** (the EN/VI button, or `?lang=en`).

**Live:** https://zintaen.github.io/vnciv/

**Hoàng Sa, Trường Sa là của Việt Nam.** Both archipelagos are drawn with their islands (Hoàng Sa under Đà Nẵng,
Trường Sa under Khánh Hòa), named on the map with the slogan in the sea between them.

It is a fork of [usaciv](https://karpathy.ai/usaciv/) by Andrej Karpathy (MIT): the browser engine (plain ES modules
and Canvas 2D, no framework, no build step) is reused, and a new data pipeline feeds it Vietnam's data.

## Quick start

You need [uv](https://docs.astral.sh/uv/). The built data (`web/data/`) is included, so to run it:

```bash
uv run python -m pipeline serve        # http://127.0.0.1:8765
```

`web/` is a self-contained static site: upload it to any static host.

```bash
uv run python -m pipeline all          # download (cached in data/raw/) → build web/data/*.json
uv run python -m pipeline build lenses # rebuild one step (see pipeline/build/__init__.py for the order)
uv run python -m pipeline package      # vnciv.zip (the site) and vnciv-source.zip (this project)
uv run python -m unittest discover -s tests   # data checks
QA_LANG=vi uv run --with playwright python tools/qa.py   # every view in a browser (also QA_LANG=en)
node tools/i18n/check_dups.mjs                 # Vietnamese dictionaries agree
python3 tools/i18n/gen.py                      # regenerate the Vietnamese data dictionary
```

The first `all` downloads about 300 MB. The province statistics were parsed from NSO publications into the tidy CSVs
in `data/stats/` by the scripts in `pipeline/nso/` (see `data/stats/SOURCES.md`); they are committed, so a rebuild does not
need the NSO servers.

## How Vietnam maps onto the game

| Game | Vietnam |
|---|---|
| States | The **34 provinces** of 1 July 2025 (Resolution 202/2025/QH15), drawn as unions of the former provinces |
| Counties (the Explorer's finest level) | The **63 former provinces**: Vietnam's statistics are still published for them |
| Cities | The **63 seats** of the former provinces; each stands for its whole former province, as a metro does |
| Hexes | 5 km radius (~65 km²), Albers equal-area; 1 map unit = 0.2 km so the art keeps its 25-unit hex |
| Food | Paddy rice harvested (tonnes) |
| Production | Employed workers |
| Gold | GRDP 2025, in US dollars at the World Bank 2024 rate (the 2025 rate is not yet published) |
| Science | University students |
| Culture | Travel and tour turnover |
| Districts | Location quotients of students, retail, FDI and tourism per resident, plus mapped sites (ports, airports, heritage, power) |
| Citizens | Urban/rural, formal/informal jobs, trained/untrained workers, poor/not-poor households |
| Disasters | Typhoons (IBTrACS best tracks within 100 km since 1980) |
| Military | People's Army sites mapped in OpenStreetMap (forts sized by mapped area; ranges as restricted ground) |
| Trade routes | The 30 domestic air routes flown by the most airlines (OpenFlights route database, 2014) |
| Wonders | UNESCO World Heritage sites, national parks, the national and regional universities, landmarks |
| Place names | The Hoàng Sa and Trường Sa islands (Wikidata), well-known coastal islands and towns (GeoNames) |

Hoàng Sa (Paracel) and Trường Sa (Spratly) islands are part of Đà Nẵng and Khánh Hòa, as in the official outlines;
they are shown by the hexes at their named islands' centres.

## Data sources

| Source | Publisher | Used for |
|---|---|---|
| Statistical Yearbooks 2025 and 2024, PX-Web, monthly reports 2026 | National Statistics Office (NSO, formerly GSO) | Every province figure: population, GRDP, labour, income, HDI, poverty, FDI, rice, students, tourism, migration, internet, doctors… (2025 preliminary for the 63 former provinces; HDI, FDI, enterprises, doctors, forest cover, 2026 growth for the 34 provinces) |
| Provincial Competitiveness Index | VCCI | Business-climate lens |
| Official exchange rate | World Bank | VND → USD |
| COD-AB admin 1 (2025; 2020 release for the 63 former provinces) | OCHA / HDX, from the Government of Viet Nam | Province outlines, coast, former-province borders |
| ETOPO1 via ERDDAP | NOAA NCEI | Relief, hill-shading, sea depth |
| WorldCover 2021 | ESA | Land cover |
| WorldPop 2025 | University of Southampton | Population density |
| Global Power Plant Database | WRI | Capacities of power plants that OpenStreetMap maps without one |
| IBTrACS | NOAA NCEI | Typhoons |
| OurAirports; ACV passengers via Wikipedia | OurAirports; Airports Corporation of Vietnam | Airports |
| Wikidata | Wikimedia | World Heritage sites, national-park positions, universities, landmarks, islands |
| Quyết định 804/QĐ-TTg (2022), 1579/QĐ-TTg (2021) | Prime Minister of Vietnam | The 34 seaports and their class; their main port areas |
| Danh sách vườn quốc gia tại Việt Nam | Wikipedia tiếng Việt | Which national parks, their area |
| Natural Earth 1:10m | Natural Earth | Neighbouring countries, rivers outside Vietnam, lakes |
| OpenStreetMap (Overpass API) | OpenStreetMap contributors | Rivers in Vietnam, military land, power plants, expressways and national roads, railways, port and national-park positions, bridges, protected areas, everyday places (hospitals, schools, markets…) and relic positions |
| OpenFlights route database | OpenFlights | Domestic air routes |
| GeoNames | GeoNames | City positions, towns and coastal islands |
| Completed results of the 2019 Population and Housing Census | NSO | Ethnic-group lenses and panels |
| Global Forest Change 2000–2025 | Hansen / UMD / Google / USGS / NASA | Forest-loss lens and timeline |
| CHELSA bioclimatic variables | WSL (Karger et al.) | Rainfall and temperature lenses |
| Di tích quốc gia đặc biệt; Wikipedia articles on capitals, dynasties and provinces | Wikipedia tiếng Việt; Wikipedia | Special national relics; history events on the timeline |
| Vietnamese Provinces Database (wards GIS) | Thang Le Quoc, from the official reference map | Communes and wards layer |
| VTC News (16 June 2025) | VTC News | Commune count check |

### Reading the map honestly

- **A city is its former province.** Its banner numbers cover the whole former province (rural districts too).
- **Years are labelled.** Most figures are 2025 (preliminary); since 2025 NSO publishes HDI, FDI and some others only for
  the 34 provinces, so cities keep their 2024 values and every record's `years` says which year a field is.
- **Gaps stay gaps.** NSO publishes no workers by industry per province, no GDP by industry per province and no
  visitor counts, so those panels show national figures or say what is missing. Vietnam publishes no port tonnage,
  installation list, troop numbers, defence spending or freight flows: ports carry only their official class (special, I, II, III), the military layer shows
  what OpenStreetMap has mapped (uneven coverage, no headcounts), and the trade routes are air routes (2014).
- **Power plants are what OpenStreetMap maps** (2026), with capacities from WRI's 2021 database where OSM has none;
  plants without a known capacity, most wind farms' capacities and rooftop solar are missing.
- **Selections are rules.** Wonders, districts and badges come from rules published in the data files.

The code is MIT-licensed (see [LICENSE](LICENSE)); the data keep their publishers' terms (the Almanac lists them).
Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0: the files in `web/data`
derived from OpenStreetMap (or OpenFlights) are released under the ODbL too. Text and lists from Wikipedia are
CC BY-SA 4.0 (each history event links its article). WorldPop, ESA WorldCover, GeoNames, WRI, World Bank and Hansen /
UMD / Google / USGS / NASA Global Forest Change are CC BY 4.0; OCHA COD-AB is CC BY-IGO; the Vietnamese Provinces
Database is © 2021 Thang Le Quoc, MIT licence.
The look is inspired by turn-based 4X strategy games; every glyph and texture is drawn in code.
