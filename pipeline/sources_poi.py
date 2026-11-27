"""Sources of the "everyday life & heritage" layers (stream poi): OpenStreetMap points of interest via Overpass, and
the Vietnamese Wikipedia list of special national relics."""
import json
import urllib.parse

from .fetch import RAW
from .sources import overpass, sparql

RELICS_PAGE = "Di tích quốc gia đặc biệt (Việt Nam)"


def _relic_qids():
    """Wikidata coordinates for the list's linked articles that have none on Wikipedia: the query is built from the
    downloaded relics_links.json (empty until that file is fetched)."""
    p = RAW / "wikipedia_vi_relics" / "relics_links.json"
    if not p.exists():
        return []
    pages = json.loads(p.read_text())["query"]["pages"]
    q = sorted({pg["pageprops"]["wikibase_item"] for pg in pages if "coordinates" not in pg and pg.get("pageprops")})
    return [(sparql("SELECT ?s ?c WHERE { VALUES ?s { " + " ".join("wd:" + x for x in q) + " } ?s wdt:P625 ?c. }"),
             "relics_wikidata.json")] if q else []


OSM = dict(publisher="OpenStreetMap contributors (via Overpass API)", homepage="https://www.openstreetmap.org/",
           license="ODbL 1.0 (© OpenStreetMap contributors)")

SOURCES = [
    dict(id="osm_poi", title="OpenStreetMap everyday places of Vietnam", **OSM,
         description="Features mapped in Vietnam as hospitals (amenity=hospital), universities and colleges "
         "(amenity=university/college), schools (amenity=school), markets (amenity=marketplace), places of worship "
         "(amenity=place_of_worship, with religion=*), named historic features (historic=*), named beaches (natural=beach) and urban rail (railway=subway/"
         "light_rail and their route relations), with their centres and tags. Coverage depends on mappers: cities are "
         "mapped far better than the countryside, and many features have no name.",
         used_for=["Special national relics (positions by name)", "Hospitals", "Universities", "Schools lens", "Markets", "Places of worship", "Beaches", "Metro lines"],
         files=[(overpass('nwr["amenity"="hospital"](area.vn);out center tags;', 300), "hospitals.json"),
                (overpass('nwr["amenity"~"^(university|college)$"](area.vn);out center tags;', 300), "universities.json"),
                (overpass('nwr["amenity"="school"](area.vn);out center;', 300), "schools.json"),
                (overpass('nwr["amenity"="marketplace"](area.vn);out center tags;', 300), "markets.json"),
                (overpass('nwr["amenity"="place_of_worship"](area.vn);out center tags;', 600), "worship.json"),
                (overpass('nwr["historic"]["name"](area.vn);out center tags;', 300),
                 "historic.json"),
                (overpass('nwr["natural"="beach"]["name"](area.vn);out center tags;', 300), "beaches.json"),
                (overpass('(relation["route"~"^(subway|light_rail)$"](area.vn);way["railway"~"^(subway|light_rail)$"](area.vn););'
                          'out geom;', 300), "metro.json")]),
    dict(id="osm_bridges", title="OpenStreetMap major road bridges of Vietnam", **OSM,
         description="Road ways tagged bridge=* on expressways, national roads and primary roads (highway=motorway/trunk/"
         "primary and their links) that carry a name, with their geometry; the map keeps bridges 500 m or longer.",
         used_for=["Major bridges"],
         files=[(overpass('way["bridge"]["bridge"!="no"]["name"]["highway"~"^(motorway|trunk|primary)(_link)?$"](area.vn);'
                          'out tags geom;', 300), "bridges.json")]),
    dict(id="osm_protected", title="OpenStreetMap protected areas of Vietnam", **OSM,
         description="Areas mapped as protected areas (boundary=protected_area, with protect_class) or nature reserves "
         "(leisure=nature_reserve) in Vietnam, with their outlines (for area and centre).",
         used_for=["Nature reserves & protected areas"],
         files=[(overpass('(way["boundary"="protected_area"](area.vn);relation["boundary"="protected_area"](area.vn);'
                          'way["leisure"="nature_reserve"](area.vn);relation["leisure"="nature_reserve"](area.vn););'
                          'out geom;', 600), "protected.json")]),
    dict(id="wikipedia_vi_relics", title="Di tích quốc gia đặc biệt (Việt Nam)", publisher="Wikipedia tiếng Việt",
         homepage="https://vi.wikipedia.org/wiki/" + urllib.parse.quote(RELICS_PAGE.replace(" ", "_")), license="CC BY-SA 4.0",
         description="The list of special national relics (di tích quốc gia đặc biệt), by ranking round (each round is a "
         "decision of the Prime Minister), with location, category and coordinates; the linked articles give coordinates (GeoData) for the rest, or Wikidata (P625) when the article has none. Wikipedia compiles the list from the "
         "decisions and the Government portal; it is not itself an official register.",
         used_for=["Special national relics"],
         files=[("https://vi.wikipedia.org/w/api.php?action=parse&page=" + urllib.parse.quote(RELICS_PAGE) +
                 "&prop=wikitext&format=json&formatversion=2&redirects=1", "relics_list.json"),
                ("https://vi.wikipedia.org/w/api.php?action=query&generator=links&titles=" + urllib.parse.quote(RELICS_PAGE) +
                 "&gplnamespace=0&gpllimit=max&prop=coordinates%7Cpageprops&ppprop=wikibase_item&colimit=max&redirects=1"
                 "&format=json&formatversion=2", "relics_links.json")] + _relic_qids()),
]
