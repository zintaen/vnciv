# vnciv: Vietnam as a strategy game, built from real data

<p><a href="https://cyberskill.world/?utm_source=atlasvn&utm_medium=referral&utm_campaign=readme"><img src="web/img/brand/cyberskill-logo-primary.svg" alt="CyberSkill" width="40" height="40" align="left"></a>
<b>Built by <a href="https://cyberskill.world/?utm_source=atlasvn&utm_medium=referral&utm_campaign=readme">CyberSkill</a></b>, a software studio in Ho Chi Minh City
(web apps, mobile apps, internal systems). Live at <a href="https://atlasvn.online">atlasvn.online</a>.</p>

A visualizer (not a game) that draws the **real** Vietnam like a turn-based strategy map: painted hex terrain from
elevation and land cover, the 34 provinces of 2025, cities with yield banners, power plants as resources, roads,
railways, ports, airports and wonders on the tiles, 56 lenses, map layers (communes and wards, special national relics,
everyday places, sea-level rise), a timeline (statistics by year, typhoons since 1980, history), a City View, a council of
Advisors and an Explorer. In motion: replays of typhoon tracks, the 2025 merger and forest loss, a sea-level-rise
play, a living map (sea, rivers, clouds), moving traffic on the air routes, ports and railways, day–night shading with
city lights, a 2-minute camera tour (Hành trình Việt Nam) and a tilted 3D view; the **Effects** switch in the Layers
menu (or the system's reduced-motion setting) stills the animations.
Every number traces back to a public source listed in the in-app **Almanac**. The interface is in **Vietnamese** (default)
and **English** (the EN/VI button, or `?lang=en`).

**Live:** https://atlasvn.online/ (https://zintaen.github.io/vnciv/ redirects there)

**Hoàng Sa, Trường Sa là của Việt Nam.** Both archipelagos are drawn with their islands (Hoàng Sa under Đà Nẵng,
Trường Sa under Khánh Hòa), named on the map with the slogan in the sea between them.

It is a fork of [usaciv](https://karpathy.ai/usaciv/) by Andrej Karpathy (MIT): the browser engine (plain ES modules
and Canvas 2D, no framework, no build step) is reused, and a new data pipeline feeds it Vietnam's data.

## Quick start

You need [git](https://git-scm.com/) and [uv](https://docs.astral.sh/uv/). The built data (`web/data/`) is included,
so serving needs no downloads (`data/raw/` is only for rebuilding):

```bash
git clone https://github.com/zintaen/vnciv.git && cd vnciv
uv run python -m pipeline serve        # http://127.0.0.1:8765 (uv installs the dependencies on first run)
```

`web/` is a self-contained static site: upload it to any static host.

```bash
uv run python -m pipeline all          # download (cached in data/raw/) → build web/data/*.json
uv run python -m pipeline build lenses # rebuild one step (see pipeline/build/__init__.py for the order)
uv run python -m pipeline package      # vnciv.zip (the site, ready to upload)
uv run python -m unittest discover -s tests   # data checks (those that read data/raw or data/interim skip until `all` has run)
QA_LANG=vi uv run --with playwright python tools/qa.py   # every view in a browser (also QA_LANG=en)
uv run --with playwright python tools/regress.py        # 33 fixed-bug journeys in a browser (about 5 minutes; not in CI)
node tools/i18n/check_dups.mjs                 # Vietnamese dictionaries agree
python3 tools/i18n/gen.py                      # regenerate the Vietnamese data dictionary
```

Developer pages, served locally only (the deploy drops `web/dev/`): `/dev/art.html` shows every art piece side by side,
`/dev/trailer.html` plays the promo trailer (`tools/render_trailer.py` renders it to MP4).

The first `all` downloads about 550 MB (about 600 MB in `data/raw/`). The province statistics were parsed from NSO publications into the tidy CSVs
in `data/stats/` by the scripts in `pipeline/nso/` (see `data/stats/SOURCES.md`); they are committed, so a rebuild does not
need the NSO servers.

## Embed this map

Any view of the atlas can go into an article or blog post: **Thêm ▾ → Chia sẻ → Nhúng** (More → Share → Embed) gives
the code for the current view, in a 16:9, 4:3 or square frame that fills the column's width, with a preview and a Copy
button. The code is an `<iframe>` (with `title` and `loading="lazy"`) and a credit link back to the same view:

```html
<iframe src="https://atlasvn.online/?embed=1#lens=density" title="Bản đồ Việt Nam: Dân số · atlasvn.online" width="640" height="360"
  style="width:100%;height:auto;aspect-ratio:640/360;border:0" loading="lazy"></iframe>
<p><a href="https://atlasvn.online/#lens=density">Bản đồ: atlasvn.online · CyberSkill</a></p>
```

`?embed=1` shows only the map, a thin strip with the theme's key and "Mở trên atlasvn.online ↗", and the CyberSkill
credit; add `&lang=en` for English and `&search=1` for the search box. Every hash key of a normal link works (`lens`,
`year`, `city`, `state`, `layers`, `at`, `story`, ...). Readers can pan, zoom, hover and click; the mouse wheel scrolls
the host page until the map has been clicked ("Bấm để tương tác"). An embed saves nothing in the browser and never adds
entries to the host page's history. `https://atlasvn.online/oembed.json` is a static oEmbed response for the home view.

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
| Disasters | Typhoons (IBTrACS best tracks within 100 km since 1980; the 2025–2026 seasons are still provisional in IBTrACS) |
| Military | People's Army sites mapped in OpenStreetMap (forts sized by mapped area; ranges as restricted ground) |
| Trade routes | The 29 domestic air routes flown by at least 3 airlines (airlines-and-destinations tables of the English and Vietnamese Wikipedia airport articles, November 2026) |
| Wonders | UNESCO World Heritage sites, national parks, the national and regional universities, landmarks |
| Place names | The Hoàng Sa and Trường Sa islands (Wikidata), well-known coastal islands and towns (GeoNames) |
| Communes layer | The 3,321 communes, wards and special zones of the two-tier local government (1 July 2025), with their current types from the NSO register (28 Nov 2026: 2,599 communes, 709 wards, 13 special zones) |
| Relics layer | The 150 special national relics (di tích quốc gia đặc biệt) of the Vietnamese Wikipedia list, placed where coordinates are known |

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
| Airlines and destinations of Vietnam's airports | Wikipedia (English and Vietnamese) | Air routes (domestic drawn; international listed in air_routes.json) |
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
  what OpenStreetMap has mapped (uneven coverage, no headcounts), and the trade routes are air routes (Wikipedia airport articles, 2026).
- **Power plants are what OpenStreetMap maps** (2026), with capacities from WRI's 2021 database where OSM has none;
  plants without a known capacity, most wind farms' capacities and rooftop solar are missing.
- **Ambient motion is illustrative.** The living map, the planes, ships and trains are not weather, schedules or
  real traffic, and the night lights are derived from population density (WorldPop), not satellite images.
- **Selections are rules.** Wonders, districts and badges come from rules published in the data files.

The code is MIT-licensed (see [LICENSE](LICENSE)); the data keep their publishers' terms (the Almanac lists them).
Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0: the files in `web/data`
derived from OpenStreetMap are released under the ODbL too. Text and lists from Wikipedia are
CC BY-SA 4.0 (each history event links its article; air_routes.json records the revision of each airport article). WorldPop, ESA WorldCover, GeoNames, WRI, World Bank and Hansen /
UMD / Google / USGS / NASA Global Forest Change are CC BY 4.0; OCHA COD-AB is CC BY-IGO; the Vietnamese Provinces
Database is © 2021 Thang Le Quoc, MIT licence. Wikidata and CHELSA are CC0; NOAA (ETOPO1, IBTrACS), Natural Earth and
OurAirports are public domain. NSO statistics state no licence (official figures, reused with attribution); VCCI's PCI is free
to reuse with attribution.
The look is inspired by turn-based 4X strategy games; every glyph and texture is drawn in code.
