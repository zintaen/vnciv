"""geo.json + geo_rivers.json: physical and cultural geography layers (stream geo).

geo_rivers.json (small, loaded at start): the named Vietnamese rivers already drawn in world.json "rivers", with their
English names and Wikidata lengths; the browser merges world.json's segments by name for labels and search.
geo.json (lazy): mountain peaks, mountain passes, lakes & reservoirs, dams, border gates, industrial parks, craft
villages (OpenStreetMap), historic battle sites (Wikidata) and festivals (Vietnamese Wikipedia list)."""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict

from ..admin import fold
from ..fetch import RAW
from ..geo import UNIT
from ..store import load_web, write_web
from .common import World
from .ext_poi import Placer, centre, hav_m, in_provinces, name_of, outline, province_names, strip_wiki
from .resources import parse_mw

PEAK_MIN_M = 1500
LAKE_MIN_KM2 = 1.0
PARK_MIN_HA = 20
BATTLE_MIN_SITELINKS = 4
NOT_BATTLES = {"Q2025973"}  # Operation Babylift: an evacuation flight, classed under battle in Wikidata
DAM_PLANT_KM = 10  # a dam and a hydropower plant of the same name closer than this are one scheme
DEDUP_KM = 2.0

RULES = {
    "rivers": "The OpenStreetMap river relations with a Wikidata link inside Vietnam that are drawn on the base map "
              "(world.json) and have a Vietnamese name (name:vi, else a name that starts Sông, Suối, Nậm or Rạch); the "
              "segments of one name are joined into one river. Length and basin area are the river's whole length and "
              "basin from its Wikidata item (in Vietnam and abroad), shown only where Wikidata has them; \"drawn\" is the "
              "length of the simplified line on this map.",
    "peaks": f"OpenStreetMap peaks and volcanoes (natural=peak/volcano) inside Vietnam that have a name and a height "
             f"(ele) of at least {PEAK_MIN_M:,} m, plus lower named peaks that carry a Wikidata link (notable mountains "
             "such as Bà Đen or Ba Vì). Heights are as mapped (metres above sea level), which can differ by a few metres "
             "from official surveys. A name mapped twice within 2 km is kept once (the higher).",
    "passes": "OpenStreetMap mountain passes: nodes tagged mountain_pass=yes or natural=saddle, named by their own name "
              "or else by the road they lie on when that road is named Đèo …; plus roads named Đèo … that have no such "
              "node, placed at the middle of the mapped road (the road over the pass, not necessarily its summit). Only "
              "Vietnamese names (Đèo …, Dốc …, or a name:vi). Height (ele) where mapped.",
    "lakes": f"OpenStreetMap named lakes, reservoirs and lagoons (natural=water with water=lake/reservoir/lagoon, or "
             f"landuse=reservoir) whose mapped outline covers at least {LAKE_MIN_KM2:g} km² (outer rings minus inner "
             "rings). Capacity (volume) where OpenStreetMap tags it.",
    "dams": "OpenStreetMap dams (waterway=dam) named Đập … or Thủy điện … (sluice gates, Cống …, are left out). Dams of the same core name within 5 km are one. A dam is matched to an OpenStreetMap hydropower plant "
            f"(power=plant, plant:source=hydro) with the same core name within {DAM_PLANT_KM} km, which gives its "
            "installed capacity (plant:output:electricity); hydropower plants of 50 MW or more with no mapped dam are "
            "listed too, at the plant.",
    "gates": "OpenStreetMap border controls (barrier=border_control) inside Vietnam whose Vietnamese name contains "
             "Cửa khẩu, shown from those words on (\"Trạm Kiểm soát Liên hợp Cửa khẩu Tây Trang\" → Cửa khẩu Tây Trang; "
             "Chinese characters and a trailing address dropped). The class "
             "(international, main or secondary gate) is the one in the mapped name (Cửa khẩu quốc tế …, Cửa khẩu chính …, "
             "Cửa khẩu phụ …); it is left blank when the name does not say. Two crossings of the same name (with or without “quốc tế”) within 5 km are one. Not an official register: some gates are "
             "unmapped or unnamed.",
    "parks": f"OpenStreetMap industrial land (landuse=industrial) named Khu công nghiệp …, KCN … or … Industrial Park/Zone, "
             f"whose mapped outline covers at least {PARK_MIN_HA} ha. Outlines of one park mapped as several parts are "
             "summed by name. Not the official list of the Ministry of Planning: unmapped parks are missing.",
    "crafts": "OpenStreetMap features named as craft villages (Làng nghề …, or Làng + a craft: gốm, lụa, đúc, mộc, rèn, "
              "tranh, hương, nón, chiếu, dệt, thêu, đá, mây, gỗ, sơn mài, bạc, đồng, giấy, khảm, chạm, nhang, bánh, bún, "
              "miến, nước mắm, gạch, trống, đan). Not the official register of recognised craft villages; coverage is "
              "patchy.",
    "battles": f"Wikidata battles (instances of a subclass of battle, Q178561) that have their own coordinate on "
               f"Vietnam's land (or within 2 hexes of it) and articles in at least {BATTLE_MIN_SITELINKS} Wikipedia "
               "languages (a notability threshold). Operation Babylift (an evacuation flight that Wikidata classes as a "
               "battle) is left out. Year from the item's point in time or start time.",
    "festivals": "The rows of the table \"Danh sách một số lễ hội\" of the Vietnamese Wikipedia article Lễ hội Việt Nam "
                 "that give a start day (lunar calendar, as the table states) and a place in one province, placed at the "
                 "coordinates of the article linked in the festival cell (GeoData, else its Wikidata item) only when "
                 "that point lies within 3 km of the province the table names; else at the coordinates of the most specific place "
                 "linked in the place cell (a district, a mountain; position marked approximate), with the same check. Nationwide festivals (Tết Trung thu …) "
                 "have no single place and are left out.",
}

# OpenStreetMap names shown as written except these mapping errors: {as mapped: as shown}
NAME_FIX = {"Đinh Núi Phan Xi Phăng": "Núi Phan Xi Păng"}  # "Đinh" for "Đỉnh" (summit)


def osm(name):
    p = RAW / "osm_geo" / name
    if not p.exists():
        print(f"    ! {name} not fetched: python -m tools.fetch_retry osm_geo {name}")
        return []
    return json.loads(p.read_text())["elements"]


def num(v):
    """'3143', '3143 m', '1,234' → float, else None."""
    m = re.match(r"^\s*(-?\d+(?:[.,]\d+)?)\s*(m)?\s*$", str(v or ""))
    return float(m.group(1).replace(",", ".")) if m else None


def vi_name(t):
    n = name_of(t)
    return NAME_FIX.get(n, n) if n else None


def put(P, lon, lat, **kw):
    if kw.get("n"):
        kw["n"] = kw["n"][0].upper() + kw["n"][1:]  # "làng gạch An Hiệp", "hội Gióng" as list items
    q = P(lon, lat)
    if q is None:
        return None
    nfc = lambda v: unicodedata.normalize("NFC", v) if isinstance(v, str) else v  # some OSM tags are decomposed
    return {"x": q[0], "y": q[1], "p": q[2], **{k: nfc(v) for k, v in kw.items() if v is not None}}


def dedup(rows, key="n", km=DEDUP_KM, better=None):
    """Keep one row per (folded) name within `km` (the first, or the `better` one)."""
    out = []
    for r in rows:
        twin = next((o for o in out if fold(o[key]) == fold(r[key]) and math.hypot(o["x"] - r["x"], o["y"] - r["y"]) / UNIT < km), None)
        if twin is None:
            out.append(r)
        elif better and better(r, twin):
            out[out.index(twin)] = r
    return out


# --- rivers --------------------------------------------------------------------------------------------------------

def rivers():
    lens = {}
    for b in json.loads((RAW / "wikidata_geo" / "rivers.json").read_text())["results"]["bindings"]:
        q = b["s"]["value"].rsplit("/", 1)[1]
        L, B = (float(b[k]["value"]) if k in b else None for k in ("len", "basin"))
        o = lens.setdefault(q, [None, None])
        o[0] = max(filter(None, (o[0], L)), default=None)
        o[1] = max(filter(None, (o[1], B)), default=None)
    world = load_web("world.json")["rivers"]
    drawn = defaultdict(float)
    for r in world:
        p = r["pts"]
        drawn[r["name"]] += sum(math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]) for i in range(2, len(p), 2)) / UNIT
    out = {}
    for e in json.loads((RAW / "osm_rivers" / "rivers.json").read_text())["elements"]:
        t = e["tags"]
        name = t.get("name:vi") or t.get("name") or ""  # the name world.py drew it under
        if name not in drawn:
            continue
        if not t.get("name:vi") and not re.match(r"^(Sông|sông|Suối|Nậm|Rạch) ", name):
            continue  # "Rivière Neo": no Vietnamese name
        L, B = lens.get(t.get("wikidata"), (None, None))
        en = unicodedata.normalize("NFC", t["name:en"]) if t.get("name:en") else None
        out[name] = {"name": name, "label": name[0].upper() + name[1:], "en": en, "wikidata": t.get("wikidata"),
                     "km": round(L / 1000) if L else None, "basin_km2": round(B / 1e6) if B else None,
                     "drawn_km": round(drawn[name])}
    rows = sorted(out.values(), key=lambda r: -r["drawn_km"])
    write_web("geo_rivers.json", {"version": 1, "sources": ["osm_rivers", "wikidata_geo"], "rules": {"rivers": RULES["rivers"]},
                                  "rivers": rows})
    return len(rows)


# --- peaks and passes ---------------------------------------------------------------------------------------------

def peaks(P):
    rows = []
    for e in osm("peaks.json"):
        t = e.get("tags", {})
        n, ele = vi_name(t), num(t.get("ele"))
        if not n or ele is None or (ele < PEAK_MIN_M and not t.get("wikidata")):
            continue
        r = put(P, e["lon"], e["lat"], n=n, en=t.get("name:en"), ele=round(ele), wd=t.get("wikidata"),
                kind="volcano" if t.get("natural") == "volcano" else None)
        if r:
            rows.append(r)
    rows.sort(key=lambda r: -r["ele"])
    return dedup(rows)


PASS_NAME = re.compile(r"^(Đèo|Dốc) ", re.I)


def passes(P):
    els = osm("passes.json")
    road_of = defaultdict(list)
    for w in (e for e in els if e["type"] == "way"):
        n = name_of(w.get("tags", {}))
        if n and PASS_NAME.match(n):
            for nd in w["nodes"]:
                road_of[nd].append(n)
    rows = []
    for e in (e for e in els if e["type"] == "node"):
        t = e.get("tags", {})
        n = t.get("name:vi") or name_of(t)
        if not n or not PASS_NAME.match(n):
            roads = [r for r in road_of.get(e["id"], []) if "cũ" not in r]
            n = n if n and t.get("name:vi") else (roads[0] if roads else None)
        if not n or not (PASS_NAME.match(n) or t.get("name:vi")):
            continue
        ele = num(t.get("ele"))
        r = put(P, e["lon"], e["lat"], n=n[0].upper() + n[1:], ele=round(ele) if ele else None, how="node")
        if r:
            rows.append(r)
    # roads named Đèo … with no pass node: the middle of the road (ways of one name within 15 km are one road)
    groups = []
    for w in osm("pass_roads.json"):
        n = name_of(w.get("tags", {}))
        g = [(p["lon"], p["lat"]) for p in w.get("geometry", []) if p]
        if not n or len(g) < 2 or "cũ" in n.lower():
            continue
        n = n[0].upper() + n[1:]
        grp = next((x for x in groups if fold(x["n"]) == fold(n) and min(hav_m(g[0], q) for q in x["pts"][::5] + x["pts"][-1:]) < 15000), None)
        if grp:
            grp["ways"].append(g)
            grp["pts"] += g
        else:
            groups.append({"n": n, "ways": [g], "pts": list(g)})
    for grp in groups:
        if any(fold(r["n"]) == fold(grp["n"]) and min(hav_m(P.W.proj.inverse(r["x"], r["y"]), q) for q in grp["pts"]) < 5000 for r in rows):
            continue
        pts = grp["pts"]
        total = sum(hav_m(a, b) for w in grp["ways"] for a, b in zip(w, w[1:]))
        # the point half-way along the longest way
        w = max(grp["ways"], key=lambda w: sum(hav_m(a, b) for a, b in zip(w, w[1:])))
        half, acc, mid = sum(hav_m(a, b) for a, b in zip(w, w[1:])) / 2, 0.0, w[0]
        for a, b in zip(w, w[1:]):
            d = hav_m(a, b)
            if acc + d >= half:
                f = (half - acc) / d if d else 0
                mid = (a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]))
                break
            acc += d
        r = put(P, *mid, n=grp["n"], how="road", road_km=round(total / 1000, 1))
        if r and len(pts) >= 2:
            rows.append(r)
    return dedup(rows, km=5)


# --- water --------------------------------------------------------------------------------------------------------

def core(n):
    """A water/dam/plant name without its kind words, folded: 'Thủy điện Hòa Bình', 'Hồ Hòa Bình' → 'hoa binh'."""
    s = fold(n)
    s = re.sub(r"\b(nha may|thuy dien|ho chua nuoc|ho chua|ho thuy dien|ho|dap|dam|dam phu|dap dang|cong trinh|"
               r"hydropower|hydro|power plant|plant|dam|lake|reservoir|station)\b", " ", s)
    return re.sub(r"\s+", "", s)


def hydro_plants():
    out = []
    for e in json.loads((RAW / "osm_power" / "power_plants.json").read_text())["elements"]:
        t = e.get("tags", {})
        if t.get("plant:source") != "hydro":
            continue
        lon, lat = centre(e)
        n = name_of(t)
        if lon is None or not n:
            continue
        out.append({"n": n, "mw": parse_mw(t.get("plant:output:electricity")), "ll": (lon, lat), "core": core(n)})
    return out


def lakes(P):
    rows = []
    for e in osm("water.json"):
        t = e.get("tags", {})
        n = vi_name(t)
        km2, c = outline(e)
        if not n or km2 < LAKE_MIN_KM2 or c is None:
            continue
        kind = "reservoir" if t.get("water") == "reservoir" or t.get("landuse") == "reservoir" else t.get("water", "lake")
        vol = num(t.get("volume"))
        r = put(P, *c, n=n, en=t.get("name:en"), km2=round(km2, 1), kind=kind, vol_m3=vol)
        if r:
            rows.append(r)
    rows.sort(key=lambda r: -r["km2"])
    return dedup(rows, km=10)


def dams(P):
    plants = hydro_plants()
    used = set()
    rows = []
    for e in osm("dams.json"):
        t = e.get("tags", {})
        n = vi_name(t)
        lon, lat = centre(e)
        if not n or lon is None or not re.match(r"^(dap|thuy dien)\b", fold(n)):
            continue  # "Cống …" (sluice gates), "Presa", English or unnamed-kind dams
        c = core(n)
        match = [k for k, p in enumerate(plants) if c and p["core"] == c and hav_m((lon, lat), p["ll"]) < DAM_PLANT_KM * 1000]
        mw = max((plants[k]["mw"] or 0 for k in match), default=0) or None
        used.update(match)
        r = put(P, lon, lat, n=n, mw=mw, plant=plants[match[0]]["n"] if match else None, how="dam")
        if r:
            rows.append(r)
    for k, p in enumerate(plants):
        if k in used or not p["mw"] or p["mw"] < 50:
            continue
        r = put(P, *p["ll"], n=p["n"], mw=p["mw"], how="plant")
        if r:
            rows.append(r)
    rows.sort(key=lambda r: -(r.get("mw") or 0))
    out = []  # "Đập thủy điện Hàm Thuận" and "Đập Hàm Thuận" a few hundred metres apart: one dam
    for r in rows:
        if not any(core(o["n"]) == core(r["n"]) and math.hypot(o["x"] - r["x"], o["y"] - r["y"]) / UNIT < 5 for o in out):
            out.append(r)
    return out


# --- border gates, industrial parks, craft villages ---------------------------------------------------------------

GATE_CLASS = [("intl", re.compile(r"quốc tế|international", re.I)), ("main", re.compile(r"cửa khẩu chính", re.I)),
              ("minor", re.compile(r"cửa khẩu phụ|lối mở", re.I))]


def gates(P):
    rows = []
    for e in osm("border.json"):
        t = e.get("tags", {})
        n = t.get("name:vi") or name_of(t)
        lon, lat = centre(e)
        m = re.search(r"cửa khẩu.*", n or "", re.I)
        if not m or lon is None:
            continue  # unnamed, or no Vietnamese name ("Lao Cai exit", "Dak Plo")
        # "Trạm Kiểm soát Liên hợp Cửa khẩu Tây Trang", "Cửa khẩu Hữu Nghị 友谊口岸", "Cửa khẩu Na Mèo, Quan Sơn, Thanh Hóa"
        n = re.sub(r"[\u2e80-\u9fff]+", "", m.group(0)).split(",")[0].strip()
        n = "Cửa khẩu" + n[8:]
        cls = next((k for k, rx in GATE_CLASS if rx.search(n)), None)
        r = put(P, lon, lat, n=n, en=t.get("name:en"), cls=cls)
        if r:
            rows.append(r)
    rows.sort(key=lambda r: r.get("cls") is None)  # a mapped twin named with its class wins
    out = []
    for r in rows:
        k = fold(r["n"]).replace("quoc te ", "")
        if not any(fold(o["n"]).replace("quoc te ", "") == k and math.hypot(o["x"] - r["x"], o["y"] - r["y"]) / UNIT < 5 for o in out):
            out.append(r)
    return out


def parks(P):
    by = {}
    for e in osm("industrial.json"):
        t = e.get("tags", {})
        n = vi_name(t)
        km2, c = outline(e)
        if not n or c is None:
            continue
        key = fold(n)
        g = by.setdefault(key, {"n": n, "ha": 0.0, "c": c, "big": 0.0})
        g["ha"] += km2 * 100
        if km2 > g["big"]:
            g["big"], g["c"] = km2, c
    rows = []
    for g in by.values():
        if g["ha"] < PARK_MIN_HA:
            continue
        r = put(P, *g["c"], n=g["n"], ha=round(g["ha"]))
        if r:
            rows.append(r)
    rows.sort(key=lambda r: -r["ha"])
    return rows


def crafts(P):
    rows = []
    for e in osm("crafts.json"):
        t = e.get("tags", {})
        n = vi_name(t)
        lon, lat = centre(e)
        if not n or lon is None:
            continue
        r = put(P, lon, lat, n=n, craft=t.get("craft"))
        if r:
            rows.append(r)
    return dedup(rows)


# --- battles and festivals ----------------------------------------------------------------------------------------

def year_of(v):
    m = re.match(r"^(-?)(\d+)-", v or "")
    return (-1 if m.group(1) else 1) * int(m.group(2)) if m else None


def battles(P):
    by = {}
    for b in json.loads((RAW / "wikidata_geo" / "battles.json").read_text())["results"]["bindings"]:
        q = b["s"]["value"].rsplit("/", 1)[1]
        g = by.setdefault(q, {"q": q, "sl": int(b["sl"]["value"]), "c": set()})
        for k in ("vi", "en", "viwiki"):
            if k in b:
                g[k] = b[k]["value"]
        for k in ("when", "start"):
            if k in b:
                y = year_of(b[k]["value"])
                g["year"] = min(g.get("year", y), y)
        g["c"].add(b["c"]["value"])
    rows = []
    for g in by.values():
        n = g.get("viwiki") or g.get("vi") or g.get("en")
        if g["sl"] < BATTLE_MIN_SITELINKS or g["q"] in NOT_BATTLES or not n or len(g["c"]) != 1:
            continue  # several coordinates: a campaign over a region, not one site
        lon, lat = map(float, next(iter(g["c"]))[6:-1].split())
        r = put(P, lon, lat, n=n, en=g.get("en"), year=g.get("year"), wd=g["q"], sl=g["sl"])
        if r:
            rows.append(r)
    rows.sort(key=lambda r: -r["sl"])
    return rows


def festival_coords():
    base = RAW / "wikipedia_vi_festivals"
    q = json.loads((base / "festivals_links.json").read_text())["query"]
    wd = {}
    if (base / "festivals_wikidata.json").exists():
        for b in json.loads((base / "festivals_wikidata.json").read_text())["results"]["bindings"]:
            lon, lat = b["c"]["value"][6:-1].split()
            wd[b["s"]["value"].rsplit("/", 1)[1]] = (float(lon), float(lat))
    out = {}
    for pg in q.get("pages", []):
        cs = pg.get("coordinates") or []
        c = next((x for x in cs if x.get("primary")), cs[0] if cs else None)
        qid = (pg.get("pageprops") or {}).get("wikibase_item")
        if c:
            out[pg["title"]] = ((c["lon"], c["lat"]), "article")
        elif qid in wd:
            out[pg["title"]] = (wd[qid], "wikidata")
    for r in q.get("redirects", []) + q.get("normalized", []):
        if r["to"] in out:
            out[r["from"]] = out[r["to"]]
    return out


def festivals(P, W):
    text = json.loads((RAW / "wikipedia_vi_festivals" / "festivals_list.json").read_text())["parse"]["wikitext"]
    body = text[text.find("==Danh sách một số lễ hội=="):]
    table = body[body.find("{|"): body.find("\n|}")]
    coords = festival_coords()
    provs = province_names()
    rows, skipped = [], []
    for row in table.split("\n|-")[2:]:
        cells = []
        for line in row.split("\n"):
            if line.startswith(("|", "!")):
                cells += line[1:].split("||")
        if len(cells) < 3:
            continue
        d = re.match(r"\s*(\d+)\s*/\s*(\d+)", cells[0])
        link = re.search(r"\[\[([^\]|#]+)", cells[2])
        name, place = strip_wiki(cells[2]), strip_wiki(cells[1])
        if not d or not link:
            skipped.append(name)
            continue
        f = fold(place)
        ok = {k for nm, k in provs.items() if re.search(r"(^|[ ,(])" + re.escape(nm) + r"($|[ ,)])", f)}
        look = lambda a: coords.get(a) or coords.get(a[:1].upper() + a[1:])
        hit = look(link.group(1).strip())
        if len(ok) == 1 and not (hit and in_provinces(W, *hit[0], ok)):
            # else the most specific place linked in the place cell (a district, a mountain), not the province itself
            places = [a.strip() for a in re.findall(r"\[\[([^\]|#]+)", cells[1])
                      if fold(re.sub(r"\s*\(.*\)$", "", a)).strip() not in provs]
            hit = look(places[-1]) if places else None
            hit = (hit[0], "place") if hit else None
        if len(ok) != 1 or not hit or not in_provinces(W, *hit[0], ok):
            skipped.append(name)
            continue
        r = put(P, *hit[0], n=name, day=int(d.group(1)), month=int(d.group(2)), cal="lunar", place=place, pos=hit[1],
                article=link.group(1).strip())
        if r:
            rows.append(r)
    return rows, skipped


def build():
    W = World()
    P = Placer(W)
    nr = rivers()
    out = {"version": 1, "states": [s["abbr"] for s in load_web("world.json")["states"]], "rules": {k: v for k, v in RULES.items() if k != "rivers"},
           "sources": {"peaks": ["osm_geo"], "passes": ["osm_geo"], "lakes": ["osm_geo"], "dams": ["osm_geo", "osm_power"],
                       "gates": ["osm_geo"], "parks": ["osm_geo"], "crafts": ["osm_geo"], "battles": ["wikidata_geo"],
                       "festivals": ["wikipedia_vi_festivals"]}}
    out["peaks"] = peaks(P)
    out["passes"] = passes(P)
    out["lakes"] = lakes(P)
    out["dams"] = dams(P)
    out["gates"] = gates(P)
    out["parks"] = parks(P)
    out["crafts"] = crafts(P)
    out["battles"] = battles(P)
    out["festivals"], skipped = festivals(P, W)
    out["festivals_unplaced"] = skipped
    out["counts"] = {k: len(out[k]) for k in out["sources"]}
    write_web("geo.json", out)
    print(f"    {nr} rivers;", ", ".join(f"{v} {k}" for k, v in out["counts"].items()))
