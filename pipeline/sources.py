"""Every public data source the map uses: what it is, where it comes from, which files.

`python -m pipeline fetch` downloads them all (cached in data/raw/<id>/); `catalog` turns this list plus the
download manifests into web/data/sources.json, the Almanac's bibliography.
"""
from __future__ import annotations

import urllib.parse

NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson"
BBOX = {"lat": (4.5, 26.0), "lon": (95.0, 121.0)}  # map window: mainland, Hoàng Sa, Trường Sa, neighbours


def sparql(q: str) -> str:
    return "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q)


WD_LABEL = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "vi,en". }'
Q_HERITAGE = f"""SELECT ?s ?sLabel ?enLabel ?c ?ref ?year WHERE {{
  ?s wdt:P757 ?ref; wdt:P17 wd:Q881.
  OPTIONAL {{ ?s wdt:P625 ?c. }}
  OPTIONAL {{ ?s p:P1435 ?st. ?st ps:P1435 wd:Q9259; pq:P580 ?year. }}
  OPTIONAL {{ ?s rdfs:label ?enLabel FILTER(lang(?enLabel) = "en") }}
  {WD_LABEL} }}"""
# Islands and reefs of the Hoàng Sa (Đà Nẵng) and Trường Sa (Khánh Hòa) archipelagos, looked up by Vietnamese name
HOANG_SA = ["Phú Lâm", "Hoàng Sa", "Quang Hòa", "Hữu Nhật", "Duy Mộng", "Quang Ảnh", "Tri Tôn", "Linh Côn", "Đảo Cây",
            "Đảo Trung", "Đảo Đá", "Ốc Hoa"]
TRUONG_SA = ["Trường Sa Lớn", "Đảo Song Tử Tây", "Đảo Song Tử Đông", "Đảo Nam Yết", "Đảo Sơn Ca", "Đảo Sinh Tồn",
             "Đảo Sinh Tồn Đông", "An Bang", "Phan Vinh", "Trường Sa Đông", "Đảo Ba Bình", "Đảo Thị Tứ", "Đảo Loại Ta",
             "Đảo Bến Lạc", "Vĩnh Viễn", "Bình Nguyên", "Đá Lớn", "Đá Tây", "Đá Đông", "Đá Nam", "Đá Bắc", "Cô Lin",
             "Châu Viên", "Tốc Tan"]
Q_ARCHIPELAGO = f"""SELECT ?s ?l ?c ?en WHERE {{
  VALUES ?l {{ {" ".join(f'"{n}"@vi' for n in HOANG_SA + TRUONG_SA)} }}
  ?s rdfs:label ?l; wdt:P625 ?c.
  OPTIONAL {{ ?s rdfs:label ?en FILTER(lang(?en) = "en") }} }}"""
LANDMARKS = ["Lăng Chủ tịch Hồ Chí Minh", "Văn Miếu – Quốc Tử Giám", "Dinh Độc Lập", "Địa đạo Củ Chi",
             "Nhà thờ chính tòa Đức Bà Sài Gòn", "Cầu Long Biên", "Đền Hùng", "Tòa thánh Tây Ninh", "Cầu Vàng",
             "Landmark 81", "Chùa Một Cột", "Cột cờ Lũng Cú"]
Q_LANDMARKS = f"""SELECT ?s ?sLabel ?enLabel ?c ?label WHERE {{
  VALUES ?label {{ {" ".join(f'"{n}"@vi' for n in LANDMARKS)} }}
  ?s rdfs:label ?label; wdt:P625 ?c.
  OPTIONAL {{ ?s rdfs:label ?enLabel FILTER(lang(?enLabel) = "en") }}
  {WD_LABEL} }}"""
# national parks: every Vietnamese item whose Vietnamese Wikipedia article is titled "Vườn quốc gia …" (joined to the
# Vietnamese Wikipedia list by article title)
Q_PARKS = f"""SELECT ?s ?t ?enLabel ?c WHERE {{
  ?s wdt:P17 wd:Q881.
  ?a schema:about ?s; schema:isPartOf <https://vi.wikipedia.org/>; schema:name ?t.
  FILTER(STRSTARTS(?t, "Vườn quốc gia"))
  OPTIONAL {{ ?s wdt:P625 ?c. }}
  OPTIONAL {{ ?s rdfs:label ?enLabel FILTER(lang(?enLabel) = "en") }} }}"""
VI_PARKS = "Danh_sách_vườn_quốc_gia_tại_Việt_Nam"
Q_UNIS = f"""SELECT ?s ?sLabel ?enLabel ?c ?inception ?students WHERE {{
  ?s wdt:P31/wdt:P279* wd:Q3918; wdt:P17 wd:Q881; wdt:P625 ?c.
  OPTIONAL {{ ?s wdt:P571 ?inception. }}
  OPTIONAL {{ ?s wdt:P2196 ?students. }}
  OPTIONAL {{ ?s rdfs:label ?enLabel FILTER(lang(?enLabel) = "en") }}
  {WD_LABEL} }}"""
Q_PORTS = f"""SELECT ?s ?sLabel ?enLabel ?c WHERE {{
  ?s wdt:P31/wdt:P279* wd:Q44782; wdt:P17 wd:Q881; wdt:P625 ?c.
  OPTIONAL {{ ?s rdfs:label ?enLabel FILTER(lang(?enLabel) = "en") }}
  {WD_LABEL} }}"""

def overpass(body: str, timeout=600) -> str:
    return "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(
        f'[out:json][timeout:{timeout}];area["ISO3166-1"="VN"][admin_level=2]->.vn;' + body)


SOURCES = [
    dict(id="natural_earth", title="Natural Earth 1:10m", publisher="Natural Earth",
         homepage="https://www.naturalearthdata.com/", license="Public domain",
         description="Neighbouring countries, lakes and rivers. Pinned to natural-earth-vector v5.1.2.",
         used_for=["Neighbouring countries", "Rivers and lakes"],
         files=[(f"{NE}/{n}.geojson", f"{n}.geojson") for n in (
             "ne_10m_admin_0_countries", "ne_10m_lakes", "ne_10m_rivers_lake_centerlines")]),
    dict(id="etopo", title="ETOPO1 global relief model", publisher="NOAA NCEI (via ERDDAP)",
         homepage="https://www.ncei.noaa.gov/products/etopo-global-relief-model", license="Public domain (U.S. Government work)",
         description="Land elevation and sea depth at 1 arc-minute (~1.8 km). Each hex's relief comes from the mean and "
         "spread of the samples inside it.",
         used_for=["Relief (hills, mountains)", "Hill-shading", "Sea depth"],
         files=[("https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.csv?altitude"
                 f"%5B({BBOX['lat'][0]}):1:({BBOX['lat'][1]})%5D%5B({BBOX['lon'][0]}):1:({BBOX['lon'][1]})%5D",
                 "etopo_vn.csv")]),
    dict(id="worldcover", title="ESA WorldCover 10 m 2021 v200", publisher="European Space Agency",
         homepage="https://esa-worldcover.org/", license="CC BY 4.0",
         description="Global land cover from Sentinel-1 and -2. Read from the cloud-optimised tiles' overviews "
         "(about 280 m pixels) and sampled on a lattice inside each hex.",
         used_for=["Land cover (forest, cropland, rice paddies' cropland, wetland, urban)"], files=[]),
    dict(id="worldpop", title="WorldPop population 2025, 1 km (R2025A, constrained, UN-adjusted)",
         publisher="WorldPop, University of Southampton", homepage="https://www.worldpop.org/", license="CC BY 4.0",
         description="Estimated people per 1 km pixel, constrained to built-up areas and adjusted to UN national totals.",
         used_for=["Population density lens", "Population weights for province lenses"],
         files=[("https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025/VNM/v1/1km_ua/constrained/"
                 "vnm_pop_2025_CN_1km_R2025A_UA_v1.tif", "vnm_pop_2025_CN_1km_R2025A_UA_v1.tif")]),
    dict(id="gppd", title="Global Power Plant Database v1.3.0", publisher="World Resources Institute",
         homepage="https://datasets.wri.org/dataset/globalpowerplantdatabase", license="CC BY 4.0",
         description="Power plants with capacity, fuel and location, as of 2021. Used only to fill the capacity (and name) "
         "of a plant OpenStreetMap maps without one, from the same-fuel plant within 3 km.",
         used_for=["Power-plant capacities missing in OpenStreetMap"],
         files=[("https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/"
                 "global_power_plant_database.csv", "global_power_plant_database.csv")]),
    dict(id="ourairports", title="OurAirports airports", publisher="OurAirports (community, public domain)",
         homepage="https://ourairports.com/", license="Public domain",
         description="Airport locations, IATA codes and types.", used_for=["Airports"],
         files=[("https://davidmegginson.github.io/ourairports-data/airports.csv", "airports.csv")]),
    dict(id="geonames", title="GeoNames gazetteer, Vietnam", publisher="GeoNames", homepage="https://www.geonames.org/",
         license="CC BY 4.0", description="Place names and coordinates of Vietnam's cities and towns.",
         used_for=["City positions", "Towns and coastal islands", "Search"],
         files=[("https://download.geonames.org/export/dump/VN.zip", "VN.zip")]),
    dict(id="ibtracs", title="IBTrACS v04r01, Western Pacific", publisher="NOAA NCEI",
         homepage="https://www.ncei.noaa.gov/products/international-best-track-archive", license="Public domain (U.S. Government work)",
         description="Best-track positions of every tropical cyclone in the Western Pacific basin, 3-hourly.",
         used_for=["Typhoons lens", "Storm history"],
         files=[("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
                 "v04r01/access/csv/ibtracs.WP.list.v04r01.csv", "ibtracs.WP.list.v04r01.csv")]),
    dict(id="osm_rivers", title="OpenStreetMap rivers of Vietnam", publisher="OpenStreetMap contributors (via Overpass API)",
         homepage="https://www.openstreetmap.org/", license="ODbL 1.0",
         description="Every river relation in Vietnam that carries a Wikidata link (the notable rivers), with its "
         "geometry. Drawn as map art in place of Natural Earth's sparser lines inside Vietnam; width follows length.",
         used_for=["Rivers"],
         files=[("https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(
             '[out:json][timeout:300];area["ISO3166-1"="VN"][admin_level=2]->.vn;'
             'relation["waterway"="river"]["wikidata"](area.vn);out geom(8,101.5,23.6,110);'), "rivers.json")]),
    dict(id="osm_military", title="OpenStreetMap military land of Vietnam", publisher="OpenStreetMap contributors (via Overpass API)",
         homepage="https://www.openstreetmap.org/", license="ODbL 1.0",
         description="Areas mapped as military land (landuse=military or a military=* tag: airfields, naval bases, "
         "barracks, training areas, ranges), with their outlines. Vietnam publishes no list of installations; OSM "
         "shows what mappers have drawn, so coverage is uneven and most sites have no name.",
         used_for=["Military layer", "Military advisor"],
         files=[("https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(
             '[out:json][timeout:600];area["ISO3166-1"="VN"][admin_level=2]->.vn;'
             '(way["landuse"="military"](area.vn);relation["landuse"="military"](area.vn);'
             'way["military"](area.vn);relation["military"](area.vn););out geom;'), "military.json")]),
    dict(id="osm_power", title="OpenStreetMap power plants of Vietnam", publisher="OpenStreetMap contributors (via Overpass API)",
         homepage="https://www.openstreetmap.org/", license="ODbL 1.0",
         description="Every feature mapped as a power plant (power=plant) in Vietnam, with its source (plant:source), "
         "capacity (plant:output:electricity) and name. Coverage depends on mappers: most large plants and many solar "
         "and wind farms are mapped, but some lack a capacity tag and rooftop solar is not mapped as plants.",
         used_for=["Power plants", "Energy by province"],
         files=[(overpass('nwr["power"="plant"](area.vn);out center tags;', 300), "power_plants.json")]),
    dict(id="osm_ports", title="OpenStreetMap port areas of Vietnam", publisher="OpenStreetMap contributors (via Overpass API)",
         homepage="https://www.openstreetmap.org/", license="ODbL 1.0",
         description="Port land, harbours and port terminals mapped in Vietnam (landuse=port, industrial=port, "
         "harbour=*, seamark:type=harbour), and features named Cảng… or Bến cảng…, with their centres; used to position the listed seaports.",
         used_for=["Seaports (positions)"],
         files=[(overpass('(nwr["landuse"="port"](area.vn);nwr["industrial"="port"](area.vn);nwr["harbour"](area.vn);'
                          'nwr["seamark:type"="harbour"](area.vn););out center tags;', 300), "ports.json"),
                (overpass('nwr["name"~"^(Cảng|Bến cảng|Tân Cảng|Khu bến|Cảng biển|Thương cảng)"](area.vn);out center tags;', 300),
                 "named_ports.json")]),
    dict(id="osm_roads", title="OpenStreetMap expressways and national roads of Vietnam",
         publisher="OpenStreetMap contributors (via Overpass API)", homepage="https://www.openstreetmap.org/", license="ODbL 1.0",
         description="Every way mapped as highway=motorway (expressways, cao tốc) or highway=trunk (national roads, quốc "
         "lộ) in Vietnam, with its route number (ref) and geometry. Slip roads (motorway_link) are left out.",
         used_for=["Roads"],
         files=[(overpass('way["highway"~"^(motorway|trunk)$"](area.vn);out tags geom;'), "roads.json")]),
    dict(id="osm_rail", title="OpenStreetMap railways of Vietnam", publisher="OpenStreetMap contributors (via Overpass API)",
         homepage="https://www.openstreetmap.org/", license="ODbL 1.0",
         description="Every way mapped as railway=rail in Vietnam (service tracks such as sidings and yards excluded), "
         "with its usage tag and geometry.",
         used_for=["Railways"],
         files=[(overpass('way["railway"="rail"][!"service"](area.vn);out tags geom;'), "rail.json")]),
    dict(id="osm_parks", title="OpenStreetMap national parks of Vietnam", publisher="OpenStreetMap contributors (via Overpass API)",
         homepage="https://www.openstreetmap.org/", license="ODbL 1.0",
         description="Areas mapped as national parks in Vietnam (boundary=national_park, or protected areas of IUCN class "
         "2), with their centres; used to place a park that Wikidata has no coordinates for.",
         used_for=["National parks (positions)"],
         files=[(overpass('(nwr["boundary"="national_park"](area.vn);nwr["boundary"="protected_area"]["protect_class"="2"](area.vn););'
                          'out center tags;', 300), "parks.json")]),
    dict(id="qd804", title="Quyết định 804/QĐ-TTg: Danh mục cảng biển Việt Nam (8 July 2022)",
         publisher="Prime Minister of Vietnam (Thủ tướng Chính phủ)",
         homepage="https://hcc.nghean.gov.vn/laws/detail/Cong-bo-danh-muc-cang-bien-Viet-Nam-515/", license="Public legal document",
         description="The official list of Vietnam's 34 seaports (cảng biển) with their class under Decree 76/2021/NĐ-CP: "
         "2 special, 11 class I, 7 class II, 14 class III. The signed scan is transcribed in the pipeline; the port "
         "areas used to place each seaport follow the seaport master plan (Quyết định 1579/QĐ-TTg, 2021).",
         used_for=["Seaports (which ports, class)"],
         files=[("https://hcc.nghean.gov.vn/laws/detail/Cong-bo-danh-muc-cang-bien-Viet-Nam-515/?download=1&id=0",
                 "804-ttg.signed.pdf"),
                ("https://faolex.fao.org/docs/pdf/vie219306.pdf", "1579-qd-ttg-en.pdf")]),
    dict(id="wikipedia_vi_parks", title="Danh sách vườn quốc gia tại Việt Nam", publisher="Wikipedia tiếng Việt",
         homepage="https://vi.wikipedia.org/wiki/" + VI_PARKS, license="CC BY-SA 4.0",
         description="The list of Vietnam's national parks with year of establishment, area (ha) and province. Each park "
         "is created by a decision of the Government or the Prime Minister; Wikipedia compiles the list, it is not itself "
         "an official register.",
         used_for=["National parks (which parks, area)"],
         files=[("https://vi.wikipedia.org/w/api.php?action=parse&page=" + urllib.parse.quote(VI_PARKS) +
                 "&prop=wikitext&format=json&formatversion=2&redirects=1", "parks_list.json"),
                ("https://vi.wikipedia.org/w/api.php?action=query&generator=links&titles=" + urllib.parse.quote(VI_PARKS) +
                 "&gplnamespace=0&gpllimit=max&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&formatversion=2",
                 "parks_links.json")]),
    dict(id="openflights_routes", title="OpenFlights route database", publisher="OpenFlights.org",
         homepage="https://openflights.org/data", license="Open Database License (ODbL)",
         description="Airline routes as of June 2014 (the last update): each row is one airline flying one airport "
         "pair. The domestic Vietnamese pairs are the map's trade routes; the number of airlines per pair is the "
         "route's weight. It is old: routes opened since 2014 are missing.",
         used_for=["Trade routes (domestic air routes)"],
         files=[("https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat", "routes.dat")]),
    dict(id="wikipedia_airports", title="List of the busiest airports in Vietnam", publisher="Wikipedia (figures from "
         "Airports Corporation of Vietnam, ACV)", homepage="https://en.wikipedia.org/wiki/List_of_the_busiest_airports_in_Vietnam",
         license="CC BY-SA 4.0", description="Yearly passengers per airport, as compiled on Wikipedia from ACV reports.",
         used_for=["Airport passengers"],
         files=[("https://en.wikipedia.org/w/api.php?action=parse&page=List_of_the_busiest_airports_in_Vietnam"
                 "&prop=wikitext&format=json&formatversion=2", "busiest_airports.json")]),
    dict(id="wikidata", title="Wikidata", publisher="Wikimedia Foundation", homepage="https://www.wikidata.org/",
         license="CC0", description="Coordinates and facts for World Heritage sites, national parks, universities, "
         "ports, landmarks and the islands of Hoàng Sa and Trường Sa, by SPARQL query.",
         used_for=["Wonders", "Universities", "National-park positions", "Port positions (where OpenStreetMap has none)",
                   "Hoàng Sa and Trường Sa islands"],
         files=[(sparql(Q_HERITAGE), "heritage.json"), (sparql(Q_PARKS), "parks.json"), (sparql(Q_UNIS), "universities.json"),
                (sparql(Q_PORTS), "ports.json"),
                (sparql(Q_LANDMARKS), "landmarks.json"), (sparql(Q_ARCHIPELAGO), "archipelago.json")]),
]

# More sources live in pipeline/sources_*.py (one file per feature area), each defining SOURCES = [dict(...)].
def _extra():
    import importlib
    import pathlib
    for f in sorted(pathlib.Path(__file__).parent.glob("sources_*.py")):
        yield from importlib.import_module(f"{__package__}.{f.stem}").SOURCES


SOURCES += list(_extra())
BY_ID = {s["id"]: s for s in SOURCES}
