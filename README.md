# vnciv: Vietnam as a strategy game, built from real data

A visualizer (not a game) that draws the **real** Vietnam like a turn-based strategy map: painted hex terrain from
elevation and land cover, the 34 provinces of 2025, cities with yield banners, power plants as resources, roads,
railways, ports, airports and wonders on the tiles, 19 lenses, a City View, a council of Advisors and an Explorer.
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
| Hexes | 8 km radius (~166 km²), Albers equal-area; 1 map unit = 0.32 km so the art keeps its 25-unit hex |
| Food | Paddy rice harvested (tonnes) |
| Production | Employed workers |
| Gold | GRDP, in US dollars at the World Bank 2024 rate |
| Science | University students |
| Culture | Travel and tour turnover |
| Districts | Location quotients of students, retail, FDI and tourism per resident, plus mapped sites (ports, airports, heritage, power) |
| Citizens | Urban/rural, formal/informal jobs, trained/untrained workers, poor/not-poor households |
| Disasters | Typhoons (IBTrACS best tracks within 100 km since 1980) |
| Military | People's Army sites mapped in OpenStreetMap (forts sized by mapped area; ranges as restricted ground) |
| Trade routes | The 30 domestic air routes flown by the most airlines (OpenFlights route database, 2014) |
| Wonders | UNESCO World Heritage sites, national parks, the national and regional universities, landmarks |
| Place names | The Hoàng Sa and Trường Sa islands (Wikidata), well-known coastal islands and towns (GeoNames) |

Hoàng Sa (Paracel) and Trường Sa (Spratly) islands are part of Đà Nẵng and Khánh Hòa, as in geoBoundaries' outlines;
they are shown by the hexes at their islands' centres.

## Data sources

| Source | Publisher | Used for |
|---|---|---|
| Statistical Yearbook 2024, PX-Web | National Statistics Office (NSO, formerly GSO) | Every province figure: population, GRDP, labour, income, HDI, poverty, FDI, rice, students, tourism, migration… |
| Provincial Competitiveness Index | VCCI | Business-climate lens |
| Official exchange rate | World Bank | VND → USD |
| geoBoundaries VNM ADM1 | William & Mary geoLab | Province outlines (incl. Hoàng Sa, Trường Sa) |
| ETOPO1 via ERDDAP | NOAA NCEI | Relief, hill-shading, sea depth |
| WorldCover 2021 | ESA | Land cover |
| WorldPop 2025 | University of Southampton | Population density |
| Global Power Plant Database | WRI | Power plants |
| IBTrACS | NOAA NCEI | Typhoons |
| OurAirports; ACV passengers via Wikipedia | OurAirports; Airports Corporation of Vietnam | Airports |
| Wikidata | Wikimedia | World Heritage sites, national parks, universities, ports, landmarks, islands |
| Natural Earth 1:10m | Natural Earth | Neighbouring countries, rivers outside Vietnam, lakes, roads, railways |
| OpenStreetMap (Overpass API) | OpenStreetMap contributors | Rivers in Vietnam, military land |
| OpenFlights route database | OpenFlights | Domestic air routes |
| GeoNames | GeoNames | City positions |

### Reading the map honestly

- **A city is its former province.** Its banner numbers cover the whole former province (rural districts too).
- **Gaps stay gaps.** NSO publishes no workers by industry per province, no GDP by industry per province and no
  visitor counts, so those panels show national figures or say what is missing. Vietnam publishes no port tonnage,
  installation list, troop numbers, defence spending or freight flows: ports are unranked, the military layer shows
  what OpenStreetMap has mapped (uneven coverage, no headcounts), and the trade routes are air routes (2014).
- **Power plants are as of 2021** (WRI); the solar boom since is only partly in it.
- **Selections are rules.** Wonders, districts and badges come from rules published in the data files.

The code is MIT-licensed (see [LICENSE](LICENSE)); the data keep their publishers' terms (the Almanac lists them).
The look is inspired by turn-based 4X strategy games; every glyph and texture is drawn in code.
