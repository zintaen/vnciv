"""poi.json: everyday life & heritage on the map — hospitals, universities & colleges, markets, places of worship,
beaches, nature reserves and other protected areas (OpenStreetMap), urban rail lines and major bridges (OpenStreetMap),
and the special national relics (Vietnamese Wikipedia list of the Prime Minister's rankings). Appends a "Schools
mapped" lens (OSM schools per hex) to lenses.json."""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict

from ..admin import fold
from ..fetch import RAW, manifest
from ..geo import UNIT
from ..store import load_web, write_web
from .common import World

PROTECTED_MIN_KM2 = 10.0
METRO_REST_MIN_KM = 3.0
BRIDGE_MIN_M = 500
DEDUP_KM = 0.5  # two features of the same kind and name closer than this are one place (a campus mapped twice)
HEX_AREA_KM2 = 65
RELIGIONS = ("buddhist", "christian", "caodaism", "hoahaoism", "muslim", "hindu", "folk", "other")
# a place without a religion tag, by the first word(s) of its name
NAME_RELIGION = [("nhà thờ họ", "folk"), ("nhà thờ tộc", "folk"), ("chùa", "buddhist"), ("tu viện", "buddhist"),
                 ("thiền viện", "buddhist"), ("tịnh xá", "buddhist"), ("niệm phật đường", "buddhist"),
                 ("nhà thờ", "christian"), ("giáo xứ", "christian"), ("giáo họ", "christian"), ("thánh thất", "caodaism"),
                 ("tòa thánh", "caodaism"), ("đình", "folk"), ("đền", "folk"), ("miếu", "folk"), ("phủ", "folk"),
                 ("lăng", "folk"), ("nhà thờ hồi giáo", "muslim"), ("thánh đường", "muslim")]

RULES = {
    "hospital": "OpenStreetMap features tagged amenity=hospital. Tier 1 = named as a hospital (Bệnh viện …, … Hospital); "
                "tier 0 = everything else tagged as a hospital (district health centres, commune health stations, clinics "
                "that mappers tagged as hospitals). Beds and operator are kept where mapped. Duplicates (same name within "
                f"{DEDUP_KM} km) are merged.",
    "university": "OpenStreetMap features tagged amenity=university or amenity=college (campuses, not institutions: a "
                  f"university with several campuses appears several times). Duplicates (same name within {DEDUP_KM} km) "
                  "are merged.",
    "market": f"OpenStreetMap features tagged amenity=marketplace. Duplicates (same name within {DEDUP_KM} km) are merged.",
    "worship": "OpenStreetMap features tagged amenity=place_of_worship, grouped by their religion tag: Buddhist (chùa), "
               "Christian (Catholic and Protestant churches), Cao Đài, Hòa Hảo, Muslim, Hindu, Vietnamese and Chinese folk "
               "religion (đình, đền, miếu, family halls) and other. A place without a religion tag is classed by the first "
               "words of its name (Chùa → Buddhist, Nhà thờ → Christian but Nhà thờ họ → folk, Thánh thất → Cao Đài, "
               "Đình/Đền/Miếu/Phủ → folk), else other.",
    "beach": "OpenStreetMap features tagged natural=beach that have a name.",
    "protected": "OpenStreetMap areas tagged boundary=protected_area or leisure=nature_reserve whose mapped outline covers "
                 f"at least {PROTECTED_MIN_KM2:g} km², except national parks (boundary=national_park, protect_class 2, or "
                 "a name starting “Vườn quốc gia”) and World Heritage sites (heritage:operator=whc): those are wonders already. Area is the outline's area (outer rings "
                 "minus inner rings).",
    "relic": "Every special national relic (di tích quốc gia đặc biệt) in the Vietnamese Wikipedia list, which follows "
             "the Prime Minister's ranking decisions (one per round). Placed at the coordinates given in the list, else at "
             "the coordinates of the relic's own Wikipedia article (GeoData, else its Wikidata item), else a named "
             "OpenStreetMap historic feature or place of worship whose name contains the relic's name or article title "
             "(at least two words; all matches within 5 km of each other); the last three only "
             "when they fall within 3 km of the province the list names (former or 2025 name). Relics that none of "
             "these places are left off the map (listed in unplaced).",
    "metro": "OpenStreetMap urban rail: route relations route=subway or light_rail (both directions merged by line), "
             "drawn along the ways railway=subway / light_rail they use; named rail ways outside any route (depot "
             f"spurs and test tracks excluded) are lines of their own when {METRO_REST_MIN_KM:g} km or longer. Length is "
             "one direction's mapped track. Only lines that are mapped as rail are shown; "
             "lines under construction are tagged differently and are not included.",
    "bridge": "OpenStreetMap road ways tagged bridge=* on expressways, national and primary roads (highway=motorway, "
              "trunk, primary and their links), named by bridge:name or a name starting “Cầu” or containing “Bridge”. "
              "Ways with the same name within 2 km are one bridge; its length is the straight distance between its "
              f"farthest mapped ends. Bridges {BRIDGE_MIN_M} m or longer are kept.",
    "schools_lens": "OpenStreetMap features tagged amenity=school, counted per hex.",
}


# --- helpers -------------------------------------------------------------------------------------------------------

def osm(source, name):
    return json.loads((RAW / source / name).read_text())["elements"]


def centre(e):
    if e["type"] == "node":
        return e.get("lon"), e.get("lat")
    c = e.get("center")
    if c:
        return c["lon"], c["lat"]
    g = e.get("geometry")
    if g:
        return sum(p["lon"] for p in g) / len(g), sum(p["lat"] for p in g) / len(g)
    return None, None


def hav_m(a, b):
    """Great-circle metres between (lon, lat) points."""
    lo1, la1, lo2, la2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


class Placer:
    """lon/lat → (x, y, province index in world.states) by the province outlines (World.place)."""

    def __init__(self, W):
        self.W = W

    def __call__(self, lon, lat):
        W = self.W
        x, y = W.proj(lon, lat)
        cell, k = W.place(lon, lat)
        if cell is None:
            return None  # outside Vietnam's land (or far out at sea)
        prov = W.old_new[k] if k is not None and k >= 0 else W.owner[cell]
        return round(x, 1), round(y, 1), prov


def dedup(rows, km=DEDUP_KM):
    """Drop rows whose (folded) name repeats within `km` of an earlier one. Rows: [x, y, name, …]."""
    seen = defaultdict(list)
    out = []
    for r in rows:
        if r[2]:
            key = fold(r[2])
            if any(math.hypot(r[0] - x, r[1] - y) / UNIT < km for x, y in seen[key]):
                continue
            seen[key].append((r[0], r[1]))
        out.append(r)
    return out


def name_of(t):
    return (t.get("name") or t.get("name:vi") or "").strip() or None


# --- kinds ---------------------------------------------------------------------------------------------------------

HOSPITAL_RE = re.compile(r"^(bệnh viện|benh vien|bv\b)|hospital", re.I)


def hospitals(P):
    rows = []
    for e in osm("osm_poi", "hospitals.json"):
        t = e.get("tags", {})
        p = P(*centre(e))
        if not p:
            continue
        nm = name_of(t)
        beds = t.get("beds")
        beds = int(beds) if beds and beds.isdigit() else None
        tier = 1 if nm and HOSPITAL_RE.search(nm) else 0
        rows.append([*p[:2], nm, p[2], tier, beds, t.get("operator") or None])
    rows.sort(key=lambda r: (-r[4], -(r[5] or 0)))
    return dedup([[r[0], r[1], r[2], r[3], r[4], r[5], r[6]] for r in rows])


def universities(P):
    rows = []
    for e in osm("osm_poi", "universities.json"):
        t = e.get("tags", {})
        p = P(*centre(e))
        if p:
            rows.append([*p[:2], name_of(t), p[2], 1 if t.get("amenity") == "university" else 0])
    rows.sort(key=lambda r: -r[4])
    return dedup(rows)


def markets(P):
    rows = []
    for e in osm("osm_poi", "markets.json"):
        p = P(*centre(e))
        if p:
            rows.append([*p[:2], name_of(e.get("tags", {})), p[2]])
    rows.sort(key=lambda r: r[2] is None)
    return dedup(rows)


def religion_of(t):
    r = (t.get("religion") or "").lower()
    if not r or r == "none":
        nm = (name_of(t) or "").lower()
        hit = [rel for pre, rel in sorted(NAME_RELIGION, key=lambda x: -len(x[0])) if nm.startswith(pre + " ")]
        return hit[0] if hit else "other"
    if r in ("buddhist", "buddhism"):
        return "buddhist"
    if r == "christian":
        return "christian"
    if r in ("caodaism", "cao_dai", "caodai"):
        return "caodaism"
    if r in ("hoahaoism", "hoa_hao"):
        return "hoahaoism"
    if r in ("muslim", "islam"):
        return "muslim"
    if r == "hindu":
        return "hindu"
    if r in ("ancestor", "folk", "taoist", "confucian", "vietnamese_folk", "chinese_folk", "vietnamese_folk_religion"):
        return "folk"
    if "phật" in r:
        return "buddhist"
    return "other"


def worship(P):
    rows = []
    for e in osm("osm_poi", "worship.json"):
        t = e.get("tags", {})
        p = P(*centre(e))
        if p:
            rel = religion_of(t)
            den = (t.get("denomination") or "").lower()
            sub = "catholic" if rel == "christian" and "catholic" in den else "protestant" if rel == "christian" and den and "catholic" not in den else None
            rows.append([*p[:2], name_of(t), p[2], RELIGIONS.index(rel), sub])
    rows.sort(key=lambda r: r[2] is None)
    return dedup(rows)


def beaches(P):
    rows = []
    for e in osm("osm_poi", "beaches.json"):
        p = P(*centre(e))
        if p:
            rows.append([*p[:2], name_of(e.get("tags", {})), p[2]])
    return dedup(rows, km=2)


# --- protected areas: outline area -----------------------------------------------------------------------------------

def stitch(ways):
    """Join way segments ([(lon, lat)...]) into closed rings by matching end points."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        ring = segs.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for k, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[-2::-1]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[:0:-1] + ring
                else:
                    continue
                segs.pop(k)
                changed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def ring_km2(ring):
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = 111.32 * math.cos(math.radians(lat0)), 110.57
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return abs(a) / 2


def outline(e):
    """(km², (lon, lat) of the largest outer ring's centre) of a way or multipolygon relation, or (0, None)."""
    if e["type"] == "way":
        g = [(p["lon"], p["lat"]) for p in e.get("geometry", []) if p]
        outers, inners = stitch([g]), []
    else:
        mem = [m for m in e.get("members", []) if m.get("type") == "way" and m.get("geometry")]
        pts = lambda m: [(p["lon"], p["lat"]) for p in m["geometry"] if p]
        outers = stitch([pts(m) for m in mem if m.get("role") != "inner"])
        inners = stitch([pts(m) for m in mem if m.get("role") == "inner"])
    if not outers:
        return 0.0, None
    area = sum(ring_km2(r) for r in outers) - sum(ring_km2(r) for r in inners)
    big = max(outers, key=ring_km2)
    return area, (sum(p[0] for p in big[:-1]) / (len(big) - 1), sum(p[1] for p in big[:-1]) / (len(big) - 1))


def park_names():
    w = load_web("wonders.json")
    return {fold(x["name"]).replace("vuon quoc gia ", "").strip() for x in w["wonders"] if x.get("rule") == "national_park"}


def protected(P):
    parks = park_names()
    rows, skipped = [], Counter()
    for e in osm("osm_protected", "protected.json"):
        t = e.get("tags", {})
        nm = name_of(t)
        fn = fold(nm or "")
        if t.get("boundary") == "national_park" or t.get("protect_class") == "2" or fn.startswith("vuon quoc gia") \
                or fn.replace("vuon quoc gia ", "") in parks:
            skipped["national park"] += 1
            continue
        if t.get("heritage:operator") == "whc" or t.get("ref:whc"):
            skipped["world heritage"] += 1  # a wonder already
            continue
        if not nm:
            skipped["no name"] += 1
            continue
        area, c = outline(e)
        if area < PROTECTED_MIN_KM2 or not c:
            skipped["small"] += 1
            continue
        p = P(*c)
        if not p:
            skipped["outside"] += 1
            continue
        rows.append([*p[:2], nm, p[2], round(area, 1), t.get("protect_class") or None])
    rows.sort(key=lambda r: -r[4])
    return dedup(rows, km=5), skipped


# --- metro ---------------------------------------------------------------------------------------------------------

def way_km(w):
    g = w["geometry"]
    return sum(hav_m((a["lon"], a["lat"]), (b["lon"], b["lat"])) for a, b in zip(g, g[1:])) / 1000


def metro(W):
    els = osm("osm_poi", "metro.json")
    ways = {e["id"]: e for e in els if e["type"] == "way"}
    lines = {}
    for r in (e for e in els if e["type"] == "relation"):
        t = r.get("tags", {})
        key = t.get("ref") or re.split(r"[:→\-–]", t.get("name", ""))[0].strip() or str(r["id"])
        ln = lines.setdefault(key, {"name": (t.get("name") or "").replace("→", "–") or None, "ref": t.get("ref"),
                                    "colour": t.get("colour"), "route": t.get("route"), "ways": set(), "km": 0.0})
        mine = {m["ref"] for m in r.get("members", []) if m.get("type") == "way" and m["ref"] in ways}
        ln["ways"] |= mine
        ln["km"] = max(ln["km"], sum(way_km(ways[i]) for i in mine))  # one direction's track, not both
    out = []
    used = set()
    for key, ln in lines.items():
        segs = [ways[i] for i in sorted(ln["ways"])]
        used |= ln["ways"]
        if segs:
            out.append(metro_line(W, ln["name"], ln["ref"], ln["colour"], ln["route"], segs, ln["km"]))
    rest = defaultdict(list)  # rail ways that no route relation uses, grouped by name
    for i, w in ways.items():
        nm = fold(w.get("tags", {}).get("name") or "")
        if i not in used and w.get("tags", {}).get("service") is None and "depot" not in nm and "chay thu" not in nm:
            rest[w.get("tags", {}).get("name") or ""].append(w)
    for nm, segs in rest.items():
        km = sum(way_km(w) for w in segs)
        if km >= METRO_REST_MIN_KM:
            out.append(metro_line(W, nm or None, None, None, segs[0]["tags"].get("railway"), segs, km))
    return out


def metro_line(W, name, ref, colour, route, segs, km):
    paths = [[round(v, 1) for p in s["geometry"] for v in W.proj(p["lon"], p["lat"])] for s in segs]
    lon = sum(p["lon"] for s in segs for p in s["geometry"]) / sum(len(s["geometry"]) for s in segs)
    lat = sum(p["lat"] for s in segs for p in s["geometry"]) / sum(len(s["geometry"]) for s in segs)
    _, k = W.place(lon, lat)
    return {"name": name, "ref": ref, "colour": colour if colour and re.fullmatch(r"#[0-9A-Fa-f]{6}", colour) else None,
            "route": route, "km": round(km, 1), "state": W.states[W.old_new[k]] if k is not None and k >= 0 else None,
            "paths": paths}


# --- bridges -------------------------------------------------------------------------------------------------------

def bridge_name(t):
    if t.get("bridge:name"):
        return t["bridge:name"].strip()
    n = (t.get("name") or "").strip()
    return n if n.lower().startswith("cầu") or "bridge" in n.lower() else None


def bridges(P):
    groups = defaultdict(list)  # folded name → [clusters of point lists]
    for e in osm("osm_bridges", "bridges.json"):
        nm = bridge_name(e.get("tags", {}))
        g = [(p["lon"], p["lat"]) for p in e.get("geometry", []) if p]
        if not nm or len(g) < 2:
            continue
        cl = groups[fold(nm)]
        hit = next((c for c in cl if any(hav_m(g[0], q) < 2000 for q in c["pts"][::5] + [c["pts"][-1]])), None)
        if hit:
            hit["pts"] += g
        else:
            cl.append({"name": nm, "pts": g})
    rows = []
    for cl in groups.values():
        for c in cl:
            pts = c["pts"]
            a, b = max(((p, q) for p in pts[::max(1, len(pts) // 40)] for q in pts[::max(1, len(pts) // 40)]),
                       key=lambda pq: hav_m(*pq))
            span = hav_m(a, b)
            if span < BRIDGE_MIN_M:
                continue
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            p = P(*mid)
            if not p:
                continue
            ax, ay = P.W.proj(*a)
            bx, by = P.W.proj(*b)
            rows.append([*p[:2], c["name"], p[2], round(span), [round(ax, 1), round(ay, 1), round(bx, 1), round(by, 1)]])
    rows.sort(key=lambda r: -r[4])
    return rows


# --- special national relics -----------------------------------------------------------------------------------------

COORD = re.compile(r"\{\{\s*[Cc]oord\s*\|([^}]*)\}\}")


def parse_coord(s):
    """{{coord|…}} arguments → (lon, lat): d|m|s|N|d|m|s|E, d|m|N|d|m|E, d|N|d|E or decimal lat|lon."""
    parts = [p.strip() for p in s.split("|") if p.strip() and "=" not in p]
    def dms(vals):
        return sum(float(v) / 60 ** k for k, v in enumerate(vals))
    for k, p in enumerate(parts):
        if p in ("N", "S"):
            lat = dms(parts[:k]) * (1 if p == "N" else -1)
            rest = parts[k + 1:]
            j = next(j for j, q in enumerate(rest) if q in ("E", "W"))
            lon = dms(rest[:j]) * (1 if rest[j] == "E" else -1)
            return lon, lat
    return float(parts[1]), float(parts[0])


def strip_wiki(s):
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s).replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", s).strip(" ,;")


# typos in the list's wikitext (shown as names on the map): {as written: as the relic's own article spells it}
TYPOS = {"Tây6)ơn": "Tây Sơn",  # "Quần thể di tích Tây Sơn Thượng Đạo" (Đợt 15, 2022)
         "khảo cố": "khảo cổ"}  # Cát Tiên's category (Đợt 7, 2014)


def fix_typos(s):
    for a, b in TYPOS.items():
        s = s.replace(a, b)
    return s


def relic_category(s):
    """One spelling for the list's category cells: kinds joined by ", " ("Di tích lịch sử - kiến trúc nghệ thuật",
    "… và Khảo cổ" → "…, kiến trúc nghệ thuật", "…, khảo cổ"), as the map's English labels expect."""
    s = re.sub(r"\s+(?:-|–|và)\s+", ", ", fix_typos(s).strip())
    return s[:1] + s[1:].lower()


def relic_link(cell):
    """The relic's own article in its name cell: a link that starts the name ("[[Chùa Tây Phương]]"), is the whole
    name after a generic prefix ("Khu di tích [[Phố Hiến]]"), or gives its other name in brackets ("Quần thể Hương
    Sơn ([[Chùa Hương]])"). A link to only part of the name ("Tây Thiên - [[Tam Đảo]]", "Khu đền thờ [[Tây Sơn Tam
    Kiệt]]": the people) is not the relic's article."""
    c = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", cell, flags=re.S).strip()
    return (re.match(r"\[\[([^\]|#]+)", c)
            or re.fullmatch(r"(?:Khu di tích|Quần thể)\s+\[\[([^\]|#]+)[^\]]*\]\]", c)
            or re.search(r"\(\[\[([^\]|#]+)[^\]]*\]\]\)$", c))


def relic_rows():
    """[{name, article, location, category, round, year, coord}] from the list's per-round tables."""
    text = json.loads((RAW / "wikipedia_vi_relics" / "relics_list.json").read_text())["parse"]["wikitext"]
    parts = re.split(r"\n===\s*(Đợt[^=]+?)\s*===\n", text)
    out = []
    for head, body in zip(parts[1::2], parts[2::2]):
        m = re.match(r"Đợt\s*(\d+)\s*\((\d{4})\)", head)
        rnd, year = int(m.group(1)), int(m.group(2))
        table = body[body.find("{|"): body.find("\n|}")]
        for row in table.split("\n|-")[1:]:
            cells = re.split(r"\n\|", "\n" + row.strip("\n"))[1:]
            cells = [c for c in cells if not c.startswith("}")]
            if len(cells) < 4:
                continue
            name_cell, loc_cell, cat_cell = cells[0], cells[2], cells[3]
            link = relic_link(name_cell)
            cm = COORD.search(row)
            provs = re.findall(r"(?:tỉnh|thành phố|Thành phố|Tỉnh)\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", loc_cell)
            out.append({"name": fix_typos(strip_wiki(name_cell)), "article": link.group(1).strip() if link else None,
                        "location": strip_wiki(loc_cell), "category": relic_category(strip_wiki(cat_cell)), "round": rnd, "year": year,
                        "coord": parse_coord(cm.group(1)) if cm else None, "provinces": provs})
    return out


def article_coords():
    """{title (and redirect source): (lon, lat)} from the list's linked articles: their GeoData coordinates, else their
    Wikidata item's coordinate location (P625)."""
    base = RAW / "wikipedia_vi_relics"
    q = json.loads((base / "relics_links.json").read_text())["query"]
    wd = {}
    if (base / "relics_wikidata.json").exists():
        for b in json.loads((base / "relics_wikidata.json").read_text())["results"]["bindings"]:
            lon, lat = b["c"]["value"][6:-1].split()
            wd[b["s"]["value"].rsplit("/", 1)[1]] = (float(lon), float(lat))
    out = {}
    for pg in q.get("pages", []):
        c = (pg.get("coordinates") or [None])[0]
        qid = (pg.get("pageprops") or {}).get("wikibase_item")
        if c:
            out[pg["title"]] = ((c["lon"], c["lat"]), "article")
        elif qid in wd:
            out[pg["title"]] = (wd[qid], "wikidata")
    for r in q.get("redirects", []) + q.get("normalized", []):
        if r["to"] in out:
            out[r["from"]] = out[r["to"]]
    return out


RELIC_PREFIX = re.compile(r"^(di tích|danh lam thắng cảnh|khảo cổ|kiến trúc nghệ thuật|lịch sử|và|,|\s)+", re.I)


def osm_named():
    """{folded name: [(lon, lat)]} of named OSM historic/heritage features and places of worship."""
    out = defaultdict(list)
    for f in ("historic.json", "worship.json"):
        for e in osm("osm_poi", f):
            nm = name_of(e.get("tags", {}))
            lon, lat = centre(e)
            if nm and lon is not None:
                out[fold(nm)].append((lon, lat))
    return out


def province_names():
    """{folded province name, 2025 or former: world.states index} (the list mixes both)."""
    from ..admin import NEW
    idx = {s["abbr"]: k for k, s in enumerate(load_web("world.json")["states"])}
    out = {}
    for name, (abbr, olds) in NEW.items():
        for n in [name, *olds]:
            out[fold(n)] = idx[abbr]
    out[fold("Thừa Thiên – Huế")] = out[fold("Thừa Thiên Huế")]
    return out


def in_provinces(W, lon, lat, ok, km=3.0):
    """True when the point, or a point within `km` of it, lies in one of the province indices `ok`."""
    for dx, dy in [(0, 0)] + [(math.cos(a), math.sin(a)) for a in (k * math.pi / 4 for k in range(8))]:
        lo, la = lon + dx * km / 111 / math.cos(math.radians(lat)), lat + dy * km / 111
        k = W.point_county(lo, la)
        if k is not None and k >= 0 and W.old_new[k] in ok:
            return True
    return False


def relics(P, W):
    names = province_names()
    arts = article_coords()
    named = osm_named()
    rows, unplaced = [], []
    for r in relic_rows():
        ok = {names[fold(p)] for p in r["provinces"] if fold(p) in names}
        cands = []  # (lon, lat, via) in order of preference
        if r["coord"]:
            cands.append((*r["coord"], "list"))
        if r["article"] in arts:
            cands.append((*arts[r["article"]][0], arts[r["article"]][1]))
        hits = []
        for key in {fold(RELIC_PREFIX.sub("", r["name"])), fold(re.sub(r"\s*\(.*\)$", "", r["article"] or ""))} - {""}:
            if len(key) < 8 or " " not in key:
                continue  # too generic to look up by name
            pat = re.compile(rf"(^|\s){re.escape(key)}($|\s)")
            hits += [h for nm, hs in named.items() if pat.search(nm) for h in hs if ok and in_provinces(W, *h, ok)]
        if hits and max(hav_m(hits[0], h) for h in hits) < 5000:  # one place (a temple mapped as node and area)
            cands.append((*hits[0], "osm"))
        pos = via = None
        for lon, lat, v in cands:
            if v != "list" and ok and not in_provinces(W, lon, lat, ok):
                continue  # a coordinate outside the province the list names: not trusted
            p = P(lon, lat)
            if p:
                pos, via = p, v
                break
        if not pos:
            unplaced.append({"name": r["name"], "location": r["location"], "year": r["year"]})
            continue
        rows.append([*pos[:2], r["name"], pos[2], r["year"], r["category"], r["article"], via])
    return rows, unplaced


# --- schools lens --------------------------------------------------------------------------------------------------

def schools_lens(W):
    n = len(W.owner)
    cnt = [0] * n
    total = 0
    for e in osm("osm_poi", "schools.json"):
        lon, lat = centre(e)
        if lon is None:
            continue
        c = W.grid.cell_at(*W.proj(lon, lat))
        if c >= 0 and W.owner[c] >= 0:
            cnt[c] += 1
            total += 1
    vals = [cnt[i] if W.owner[i] >= 0 else None for i in range(n)]
    nz = sorted(v for v in vals if v)
    hi = nz[int(len(nz) * 0.98)] if nz else 1
    lens = {"id": "osm_schools", "group": "education", "name": "Schools mapped", "icon": "l-degrees", "emoji": "🏫",
            "unit": "schools in the hex", "format": "int", "scale": "linear", "domain": [0, hi],
            "ramp": ["#0b1d3a", "#1d4e89", "#2f86b8", "#5fbfc4", "#a8e3c0", "#f4fbd9"], "higher_is": "neutral",
            "source": "osm_poi", "year": manifest("osm_poi").get("schools.json", {}).get("retrieved", "")[:4],
            "description": f"Schools (amenity=school) mapped in OpenStreetMap in the hex (about {HEX_AREA_KM2} km²).",
            "note": "Shows how well schools are mapped, not how many there are: OpenStreetMap covers cities far better "
                    "than the countryside, and Vietnam publishes no school locations as open data.",
            "values": vals}
    return lens, total


def add_lens(lens):
    L = load_web("lenses.json")
    L["lenses"] = [l for l in L["lenses"] if l["id"] != lens["id"]] + [lens]
    write_web("lenses.json", L)


# --- build ---------------------------------------------------------------------------------------------------------

def build():
    W = World()
    P = Placer(W)
    hosp, unis, mk, wor, bch = hospitals(P), universities(P), markets(P), worship(P), beaches(P)
    prot, skipped = protected(P)
    br = bridges(P)
    rel, unplaced = relics(P, W)
    lines = metro(W)
    lens, n_schools = schools_lens(W)
    ret = manifest("osm_poi").get("hospitals.json", {}).get("retrieved")
    data = {
        "version": 1,
        "vintage": f"OpenStreetMap retrieved {ret}; special national relics as listed on Vietnamese Wikipedia "
                   f"(retrieved {manifest('wikipedia_vi_relics').get('relics_list.json', {}).get('retrieved')})",
        "sources": ["osm_poi", "osm_bridges", "osm_protected", "wikipedia_vi_relics"],
        "rules": RULES,
        "states": list(W.states),
        "religions": list(RELIGIONS),
        "cols": {"hospital": ["x", "y", "name", "state", "tier", "beds", "operator"],
                 "university": ["x", "y", "name", "state", "university"],
                 "market": ["x", "y", "name", "state"],
                 "worship": ["x", "y", "name", "state", "religion", "denomination"],
                 "beach": ["x", "y", "name", "state"],
                 "protected": ["x", "y", "name", "state", "area_km2", "protect_class"],
                 "bridge": ["x", "y", "name", "state", "length_m", "ends"],
                 },
        "points": {"hospital": hosp, "university": unis, "market": mk, "worship": wor, "beach": bch,
                   "protected": prot, "bridge": br},
        "metro": lines,
    }
    data["counts"] = {k: len(v) for k, v in data["points"].items()} | {"metro": len(lines), "schools": n_schools}
    write_web("poi.json", data)
    # The relics layer is on by default, so it gets its own small file (poi.json loads only when a switch turns on).
    by = {r[-1] for r in rel}  # placed_by: list, article, wikidata (the article's item, P625), osm
    write_web("relics.json", {"version": 1, "vintage": data["vintage"],
                              "sources": ["wikipedia_vi_relics", "osm_poi"] + (["wikidata"] if "wikidata" in by else []),
                              "rules": {"relic": RULES["relic"]}, "states": data["states"],
                              "cols": ["x", "y", "name", "state", "year", "category", "article", "placed_by"],
                              "relics": rel, "listed": len(rel) + len(unplaced), "unplaced": unplaced})
    add_lens(lens)
    print(f"    {data['counts']}; relics placed {len(rel)}/{len(rel) + len(unplaced)}; protected skipped {dict(skipped)}")


def check(web_dir):
    p = web_dir / "data" / "poi.json" if (web_dir / "data").exists() else web_dir / "poi.json"
    if not p.exists():
        return [("NOTE", "poi.json not built")]
    d = json.loads(p.read_text())
    out = [("PASS", f"poi.json {d['counts']}")]
    r = web_dir / "data" / "relics.json" if (web_dir / "data").exists() else web_dir / "relics.json"
    if r.exists():
        r = json.loads(r.read_text())
        out.append(("NOTE", f"relics placed {len(r['relics'])}/{r['listed']}"))
    return out
