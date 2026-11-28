"""Sources of the living-roads stream: opening dates of the expressways mapped in OpenStreetMap (osm_roads, registered
elsewhere). entities.json: the items in the `wikidata` tags of the OSM highway=motorway ways (48 items, one API call);
opening.json: every Vietnamese road, motorway, bridge or tunnel item with a P1619, matched to untagged ways by exact name."""
import re
import urllib.parse



def sparql(q):  # as pipeline.sources.sparql (not imported: sources.py imports this module)
    return "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q)

# Vietnamese Wikipedia articles of the expressways named in OSM (title guessed from the OSM name, else the wikidata
# sitelink or wikipedia tag of its ways, else a search); read as plain-text extracts
VIWIKI = ["Biên Hòa – Vũng Tàu", "Bãi Vọt – Hàm Nghi", "Bùng – Vạn Ninh", "Bắc Giang – Lạng Sơn", "Bến Lức – Long Thành",
          "Cam Lâm – Vĩnh Hảo", "Cam Lộ – La Sơn", "Cao Bồ – Mai Sơn", "Cao Lãnh – Lộ Tẻ", "Châu Đốc – Cần Thơ – Sóc Trăng",
          "Chí Thạnh – Vân Phong", "Cần Thơ – Cà Mau", "Cầu Giẽ – Ninh Bình", "Diễn Châu – Bãi Vọt", "Hà Nội – Bắc Giang",
          "Hà Nội – Hải Phòng", "Nội Bài – Lào Cai", "Hà Nội – Thái Nguyên – Bắc Kạn – Cao Bằng", "Hàm Nghi – Vũng Áng",
          "Hoài Nhơn – Quy Nhơn", "Quảng Ngãi – Hoài Nhơn", "Hải Phòng – Hạ Long – Vân Đồn – Móng Cái",
          "Khánh Hòa – Buôn Ma Thuột", "La Sơn – Túy Loan", "Dầu Giây – Liên Khương", "Lộ Tẻ – Rạch Sỏi",
          "Mai Sơn – Quốc lộ 45", "Mỹ An – Cao Lãnh", "Mỹ Thuận – Cần Thơ", "Nghi Sơn – Diễn Châu", "Nha Trang – Cam Lâm",
          "Ninh Bình – Hải Phòng", "Nội Bài – Bắc Ninh – Hạ Long", "Phan Thiết – Dầu Giây", "Pháp Vân – Cầu Giẽ",
          "Phú Thọ – Ba Vì", "Quy Nhơn – Chí Thạnh", "Quốc lộ 45 – Nghi Sơn", "Thành phố Hồ Chí Minh – Long Thành – Dầu Giây",
          "Thành phố Hồ Chí Minh – Trung Lương", "Trung Lương – Mỹ Thuận", "Tuyên Quang – Hà Giang", "Tuyên Quang – Phú Thọ",
          "Vân Phong – Nha Trang", "Vĩnh Hảo – Phan Thiết", "Vũng Áng – Bùng", "Vạn Ninh – Cam Lộ", "Đà Nẵng – Quảng Ngãi",
          "Hồng Ngự – Trà Vinh"]
VIWIKI = ["Đường cao tốc " + t for t in VIWIKI] + ["Đường vành đai 3 (Hà Nội)"]


def viwiki_file(title):
    return re.sub(r"[^a-z0-9]+", "_", title.lower().encode("ascii", "ignore").decode()).strip("_") + ".json"

Q_OPENING = """SELECT ?s ?vi ?d WHERE { ?s wdt:P17 wd:Q881; wdt:P1619 ?d; wdt:P31/wdt:P279* ?c.
  VALUES ?c { wd:Q34442 wd:Q46622 wd:Q12280 wd:Q2354973 wd:Q44377 }
  OPTIONAL { ?s rdfs:label ?vi FILTER(lang(?vi) = "vi") } }"""

WD_IDS = ("Q10752386|Q10771234|Q10771767|Q10810946|Q10840982|Q10840994|Q10841248|Q124880907|Q124881817|Q124891915|"
          "Q124934951|Q125018690|Q125019737|Q125252721|Q125252733|Q125855734|Q125855834|Q126405364|Q126664235|"
          "Q126686519|Q126891417|Q130907858|Q130908344|Q1372266|Q141687182|Q16479982|Q16480413|Q16480433|Q16480914|"
          "Q175144|Q20025663|Q20025664|Q24956743|Q24956744|Q24957174|Q24958940|Q24959073|Q3023373|Q30920467|Q30920474|"
          "Q30920476|Q32214269|Q61130156|Q61131797|Q64515557|Q65167616|Q85765646|Q86013310")

SOURCES = [
    dict(id="wikidata_roads", title="Wikidata: opening dates of Vietnam's expressways (P1619)",
         publisher="Wikimedia Foundation / Wikidata contributors", homepage="https://www.wikidata.org/",
         license="CC0 1.0",
         description="The Wikidata items linked from OpenStreetMap's expressway ways (their wikidata tags), fetched "
         "with the wbgetentities API, plus a SPARQL list of every Vietnamese road, bridge and tunnel item with a date "
         "of official opening (P1619), matched to OSM ways without a wikidata tag by exact Vietnamese name. Only "
         "P1619 is used as an opening year; inception (P571) and start time (P580) are not.",
         used_for=["Living map: expressways by opening year"],
         files=[("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|claims|sitelinks"
                 "&languages=vi|en&ids=" + WD_IDS, "entities.json"),
                (sparql(Q_OPENING), "opening.json")]),
    dict(id="viwiki_roads", title="Vietnamese Wikipedia: articles on Vietnam's expressways",
         publisher="Wikimedia Foundation / Wikipedia contributors", homepage="https://vi.wikipedia.org/",
         license="CC BY-SA 4.0",
         description="Plain-text extracts (MediaWiki API) of the Vietnamese Wikipedia articles on the expressways "
         "named in OpenStreetMap. A reviewed table in the living-roads builder takes the year each named route or "
         "section opened to traffic (thông xe / khánh thành / đưa vào khai thác) from a quoted sentence of the article.",
         used_for=["Living map: expressways by opening year"],
         files=[("https://vi.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&redirects=1"
                 "&titles=" + urllib.parse.quote(t), viwiki_file(t)) for t in VIWIKI]),
]
