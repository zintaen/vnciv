"""Sources of the physical and cultural geography layers (stream geo): OpenStreetMap peaks, passes, lakes and
reservoirs, dams, border crossings, industrial parks and craft villages via Overpass, and Wikidata battles."""
import json
import urllib.parse

from .fetch import RAW
from .sources import overpass, sparql

FEST_PAGE = "Lễ hội Việt Nam"
WP = "https://vi.wikipedia.org/w/api.php?"


def _fest_qids():
    """Wikidata coordinates for the festival list's linked articles that have none on Wikipedia (built from the
    downloaded festivals_links.json; empty until that file is fetched)."""
    p = RAW / "wikipedia_vi_festivals" / "festivals_links.json"
    if not p.exists():
        return []
    pages = json.loads(p.read_text())["query"]["pages"]
    q = sorted({pg["pageprops"]["wikibase_item"] for pg in pages if "coordinates" not in pg and pg.get("pageprops")})
    return [(sparql("SELECT ?s ?c WHERE { VALUES ?s { " + " ".join("wd:" + x for x in q) + " } ?s wdt:P625 ?c. }"),
             "festivals_wikidata.json")] if q else []


OSM = dict(publisher="OpenStreetMap contributors (via Overpass API)", homepage="https://www.openstreetmap.org/",
           license="ODbL 1.0 (© OpenStreetMap contributors)")
CRAFTS = ("nghề|gốm|lụa|đúc|mộc|rèn|tranh|hương|nón|chiếu|dệt|thêu|đá|mây|gỗ|sơn mài|bạc|đồng|giấy|"
          "khảm|chạm|nhang|bánh|bún|miến|nước mắm|gạch|trống|đan")
INDUSTRIAL = "([Kk]hu [Cc]ông [Nn]ghiệp|^KCN |[Ii]ndustrial ([Pp]ark|[Zz]one|[Ee]state))"
BOX = ('SERVICE wikibase:box { ?s wdt:P625 ?c. bd:serviceParam wikibase:cornerSouthWest "Point(102.1 8.3)"^^geo:wktLiteral. '
       'bd:serviceParam wikibase:cornerNorthEast "Point(109.6 23.5)"^^geo:wktLiteral. }')
Q_BATTLES = f"""SELECT ?s ?vi ?en ?c ?when ?start ?sl ?viwiki WHERE {{
  {BOX}
  ?s wdt:P31/wdt:P279* wd:Q178561; wikibase:sitelinks ?sl.
  OPTIONAL {{ ?s wdt:P585 ?when. }}
  OPTIONAL {{ ?s wdt:P580 ?start. }}
  OPTIONAL {{ ?s rdfs:label ?vi FILTER(lang(?vi) = "vi") }}
  OPTIONAL {{ ?s rdfs:label ?en FILTER(lang(?en) = "en") }}
  OPTIONAL {{ ?a schema:about ?s; schema:isPartOf <https://vi.wikipedia.org/>; schema:name ?viwiki. }} }}"""

def _river_qids():
    """Length (P2043) and basin area (P2053) of the OpenStreetMap rivers' Wikidata items (built from the downloaded
    osm_rivers file; empty until it is fetched)."""
    p = RAW / "osm_rivers" / "rivers.json"
    if not p.exists():
        return []
    q = sorted({e["tags"]["wikidata"] for e in json.loads(p.read_text())["elements"] if e["tags"].get("wikidata")})
    return [(sparql("SELECT ?s ?len ?basin WHERE { VALUES ?s { " + " ".join("wd:" + x for x in q) + " } "
                    "OPTIONAL { ?s p:P2043/psn:P2043/wikibase:quantityAmount ?len. } "
                    "OPTIONAL { ?s p:P2053/psn:P2053/wikibase:quantityAmount ?basin. } }"), "rivers.json")]


SOURCES = [
    dict(id="osm_geo", title="OpenStreetMap physical and economic geography of Vietnam", **OSM,
         description="Named peaks and volcanoes (natural=peak/volcano, with ele), mountain passes (mountain_pass=yes "
         "nodes and the roads they lie on; named natural=saddle; roads named Đèo …), named lakes and reservoirs (natural=water with "
         "water=lake/reservoir/lagoon, landuse=reservoir) with their outlines, named dams (waterway=dam), border "
         "crossings (barrier=border_control), industrial parks (landuse=industrial named Khu công nghiệp / KCN / "
         "Industrial Park) with their outlines, and features named as craft villages (Làng nghề, Làng gốm, Làng lụa …). "
         "Coverage depends on volunteer mappers.",
         used_for=["Mountain peaks", "Mountain passes", "Lakes & reservoirs", "Dams", "Border gates", "Industrial parks",
                   "Craft villages"],
         files=[(overpass('node["natural"~"^(peak|volcano)$"]["name"](area.vn);out;', 300), "peaks.json"),
                (overpass('(node["mountain_pass"="yes"](area.vn);node["natural"="saddle"]["name"](area.vn);)->.p;.p out;'
                          'way(bn.p)["highway"]["name"];out body;', 300), "passes.json"),
                (overpass('way["highway"]["name"~"^[Đđ]èo "](area.vn);out tags geom;', 300), "pass_roads.json"),
                (overpass('(way["natural"="water"]["water"~"^(reservoir|lake|lagoon)$"]["name"](area.vn);'
                          'relation["natural"="water"]["water"~"^(reservoir|lake|lagoon)$"]["name"](area.vn);'
                          'way["landuse"="reservoir"]["name"](area.vn);relation["landuse"="reservoir"]["name"](area.vn););'
                          'out geom;', 600), "water.json"),
                (overpass('nwr["waterway"="dam"]["name"](area.vn);out center tags;', 300), "dams.json"),
                (overpass('nwr["barrier"="border_control"](area.vn);out center tags;', 300), "border.json"),
                (overpass(f'(way["landuse"="industrial"]["name"~"{INDUSTRIAL}"](area.vn);'
                          f'relation["landuse"="industrial"]["name"~"{INDUSTRIAL}"](area.vn););out geom;', 300), "industrial.json"),
                (overpass(f'nwr["name"~"^[Ll]àng ({CRAFTS})"](area.vn);out center tags;', 300), "crafts.json")]),
    dict(id="wikidata_geo", title="Wikidata battles fought in Vietnam, and river lengths", publisher="Wikidata", homepage="https://www.wikidata.org/",
         license="CC0 1.0",
         description="Items that are battles (instance of a subclass of battle, Q178561) with a coordinate in the box "
         "around mainland Vietnam, with their date, Vietnamese and English labels, Vietnamese Wikipedia title and "
         "number of Wikipedia sitelinks (used as the notability threshold); and the length (P2043) and basin area "
         "(P2053) of the rivers' Wikidata items, normalised to metres and square metres.",
         used_for=["Historic battle sites", "River names"],
         files=[(sparql(Q_BATTLES), "battles.json")] + _river_qids()),
    dict(id="wikipedia_vi_festivals", title="Lễ hội Việt Nam (danh sách một số lễ hội)", publisher="Wikipedia tiếng Việt",
         homepage="https://vi.wikipedia.org/wiki/" + urllib.parse.quote(FEST_PAGE.replace(" ", "_")), license="CC BY-SA 4.0",
         description="The table \"Danh sách một số lễ hội\" of the Vietnamese Wikipedia article on Vietnamese festivals: "
         "start day in the lunar calendar, place and festival. Positions come from the article linked in the festival "
         "cell (its GeoData coordinates, or its Wikidata item's P625), else from the most specific place linked in the "
         "place cell. Wikipedia compiles the table; it is not an "
         "official register and lists only some festivals.",
         used_for=["Festivals"],
         files=[(WP + "action=parse&page=" + urllib.parse.quote(FEST_PAGE) + "&prop=wikitext&format=json&formatversion=2"
                 "&redirects=1", "festivals_list.json"),
                (WP + "action=query&generator=links&titles=" + urllib.parse.quote(FEST_PAGE) + "&gplnamespace=0&gpllimit=max"
                 "&prop=coordinates%7Cpageprops&ppprop=wikibase_item&colimit=max&coprimary=all&redirects=1&format=json&formatversion=2",
                 "festivals_links.json")] + _fest_qids()),
]
