"""infrastructure.json: expressways, national roads and railways (OpenStreetMap) snapped to hex links; seaports
(Quyết định 804/QĐ-TTg) and airports."""
from __future__ import annotations

import csv
import json
import re
import zipfile
from collections import Counter, defaultdict

from ..fetch import RAW
from ..names import accent
from ..geo import geojson_lines
from ..store import save_interim, write_web
from .common import World, site_cell, wkt_point
from .hexlinks import links_of, sample_cells

ROAD_CLASSES = [{"id": "interstate", "name": "Expressway"}, {"id": "major", "name": "National road"}]
RAIL_TIERS = [{"id": "main", "name": "Main line"}, {"id": "secondary", "name": "Branch line"}]
HUBS = {"L": "Major hub (10M+ passengers)", "M": "Medium hub (2–10M)", "S": "Small hub (0.5–2M)", "N": "Local airport"}
# The 34 seaports of Quyết định 804/QĐ-TTg (8 July 2022, transcribed from the signed scan) in its order, with class, and
# their main port areas (khu bến) from the seaport master plan (Quyết định 1579/QĐ-TTg, 2021), each with a folded-name
# pattern that finds it in OpenStreetMap, GeoNames or Wikidata. The first area found is the seaport's main marker.
UNPLACED = []  # seaports of the list with no port area found (filled by ports())
SEAPORTS = [
    ("Quảng Ninh", "I", [("Cái Lân", r"cai lan|port of ha long|^hon gai$"), ("Cẩm Phả", r"cam pha")]),
    ("Hải Phòng", "special", [("Lạch Huyện", r"lach huyen|hict|tan cang hai phong"), ("Đình Vũ", r"dinh vu|tan vu|hai an port"),
                              ("Hoàng Diệu", r"hoang dieu|^cang hai phong$")]),
    ("Nam Định", "III", [("Hải Thịnh", r"hai thinh")]),
    ("Thái Bình", "III", [("Diêm Điền", r"diem dien")]),
    ("Thanh Hóa", "I", [("Nghi Sơn", r"nghi son")]),
    ("Nghệ An", "I", [("Cửa Lò", r"cua lo")]),
    ("Hà Tĩnh", "I", [("Vũng Áng", r"vung ang"), ("Sơn Dương", r"son duong")]),
    ("Quảng Bình", "II", [("Hòn La", r"hon la")]),
    ("Quảng Trị", "II", [("Cửa Việt", r"cua viet")]),
    ("Thừa Thiên Huế", "II", [("Chân Mây", r"chan may")]),
    ("Đà Nẵng", "I", [("Tiên Sa", r"tien sa"), ("Liên Chiểu", r"lien chieu")]),
    ("Quảng Nam", "III", [("Chu Lai – Kỳ Hà", r"chu lai|ky ha|tam hiep")]),
    ("Quảng Ngãi", "I", [("Dung Quất", r"dung quat")]),
    ("Bình Định", "I", [("Quy Nhơn", r"quy nhon|qui nhon")]),
    ("Phú Yên", "III", [("Vũng Rô", r"vung ro")]),
    ("Khánh Hòa", "I", [("Nam Vân Phong", r"van phong"), ("Cam Ranh", r"cam ranh"), ("Nha Trang", r"nha trang")]),
    ("Ninh Thuận", "III", [("Cà Ná", r"ca na")]),
    ("Bình Thuận", "II", [("Vĩnh Tân", r"vinh tan"), ("Phan Thiết", r"phan thiet")]),
    ("TP. Hồ Chí Minh", "I", [("Cát Lái", r"cat lai"), ("Hiệp Phước", r"hiep phuoc"),
                              ("Khánh Hội", r"khanh hoi|port of saigon|sai gon port")]),
    ("Bà Rịa–Vũng Tàu", "special", [("Cái Mép", r"cai mep"), ("Thị Vải", r"thi vai|sp-psa|ptsc phu my"),
                                    ("Vũng Tàu – Cát Lở", r"vung tau|cat lo"), ("Côn Đảo", r"ben dam|cang tau khach con dao")]),
    ("Đồng Nai", "I", [("Phước An – Gò Dầu", r"phuoc an|go dau"), ("Long Bình Tân", r"^cang dong nai$|long binh tan")]),
    ("Bình Dương", "III", [("Bình Dương", r"binh duong")]),
    ("Long An", "III", [("Long An", r"long an|ben luc|can giuoc")]),
    ("Tiền Giang", "III", [("Gò Công", r"go cong"), ("Mỹ Tho", r"my tho")]),
    ("Bến Tre", "III", [("Giao Long", r"giao long")]),
    ("Đồng Tháp", "II", [("Sa Đéc", r"sa dec"), ("Cao Lãnh", r"cao lanh")]),
    ("Sóc Trăng", "III", [("Đại Ngãi", r"dai ngai|^cang soc trang$"), ("Trần Đề", r"tran de")]),
    # 1579 names no port area for Hậu Giang (its scope is the Hậu river bank from the Cái Cui to the Cái Côn channel);
    # "Vĩnh Thái" is a Vĩnh Long area
    ("Hậu Giang", "II", [("Cái Côn", r"cai con")]),
    ("Cần Thơ", "I", [("Cái Cui", r"cai cui"), ("Trà Nóc", r"^cang can tho$|can tho port|tra noc")]),
    ("An Giang", "III", [("Mỹ Thới", r"my thoi")]),
    ("Vĩnh Long", "III", [("Vĩnh Long", r"vinh long")]),
    ("Cà Mau", "III", [("Năm Căn", r"nam can"), ("Sông Đốc", r"song doc")]),
    ("Kiên Giang", "III", [("Hòn Chông", r"hon chong"), ("Phú Quốc", r"an thoi|duong dong")]),
    ("Trà Vinh", "II", [("Duyên Hải – Định An", r"duyen hai|dinh an")]),
]
PORT_CLASSES = [{"id": "special", "name": "Special-class seaport"}, {"id": "I", "name": "Class I seaport"},
                {"id": "II", "name": "Class II seaport"}, {"id": "III", "name": "Class III seaport"}]
# not a seaport's cargo area: fishing ports, ferries, marinas, boatyards, dry ports, airports
NOT_PORT = re.compile(r"^(cang|ben) ca\b|fish|ben (do|pha|thuyen|tau)\b|du kien|du thuyen|marina|ferry|xuong|cang can\b(?! tho)|\bicd\b|hang khong|airport|\bcang vu\b")
# Nội Bài lies in Sóc Sơn district, Hà Nội (the old geoBoundaries border put it in Vĩnh Phúc; kept as a guard)
AIRPORT_PROVINCE = {"HAN": "HN"}
RULES = {
    "roads": "OpenStreetMap roads in Vietnam (fetched in 2026), sampled along their length and snapped to hex-centre links. "
             "Class 0: every way mapped as an expressway (highway=motorway, cao tốc; slip roads left out). Class 1: every way "
             "mapped as a trunk road (highway=trunk: the national roads, quốc lộ), where no expressway already joins the "
             "same two hexes. Each link is named by the route number most of its ways carry (CT.01, QL.1, HCM for the Hồ "
             "Chí Minh road). Expressways open to traffic are mapped as motorway; sections under construction are not.",
    "rail": "OpenStreetMap railways in Vietnam (railway=rail, fetched in 2026; sidings, yards, tourist and military "
            "lines left out), snapped to hex-centre links. Tier 0 (main line): lines tagged as main lines, which include "
            "the North–South (Thống Nhất) railway and the lines from Hà Nội to Hải Phòng, Lào Cai, Đồng Đăng and Quan "
            "Triều; tier 1: branch and industrial lines. Urban metro lines are not railway=rail and are not drawn.",
    "ports": "The 34 seaports (cảng biển) of the Prime Minister's list, Quyết định 804/QĐ-TTg (2022), with its class "
             "(special, I, II, III; Decree 76/2021/NĐ-CP). Each seaport is drawn at its main port areas (khu bến) named in "
             "the seaport master plan (Quyết định 1579/QĐ-TTg, 2021): two to four for the special and some class I seaports, "
             "one for the others. An area is placed at a port, harbour or terminal of that name mapped in OpenStreetMap "
             "(fishing ports, ferry landings and marinas excluded), else at a GeoNames or Wikidata port of that name, in or "
             "next to the seaport's former province; a seaport none of whose areas is found is placed at the town or "
             "commune its main area is named after (GeoNames), and is left out if there is none. Ranked by class, then in the decision's "
             "order. Vietnam's port throughput statistics are not published as open data, so ports carry no tonnage.",
    "airports": "Every Vietnamese airport with scheduled service and an IATA code (OurAirports), with yearly passengers "
                "from Airports Corporation of Vietnam figures compiled on Wikipedia. Hub class by passengers: major 10M+, "
                "medium 2–10M, small 0.5–2M, local under 0.5M. Vietnamese names: the title of the airport's Wikipedia "
                "tiếng Việt article linked from Wikidata (by IATA code), else its Wikidata Vietnamese label.",
}


def route_ref(tags, prefix):
    """The way's route number for its class ('CT.01' for an expressway, 'QL.1' for a national road), else its first
    ref, else its name."""
    refs = [re.sub(r"^(CT|QL)\.?\s*", r"\1.", r.strip()) for r in (tags.get("ref") or "").split(";") if r.strip()]
    return next((r for r in refs if r.startswith(prefix)), refs[0] if refs else tags.get("name"))


def build_roads(W, ways):
    links = {}  # (a, b) → [class, Counter of route refs of that class]
    for w in ways:
        tags = w.get("tags", {})
        cls = {"motorway": 0, "trunk": 1}.get(tags.get("highway"))
        if cls is None or "geometry" not in w:
            continue
        ref = route_ref(tags, ("CT", "QL")[cls])
        pts = [W.proj(g["lon"], g["lat"]) for g in w["geometry"] if g]
        for run in sample_cells(W.grid, pts):
            for a, b in links_of(W.grid, run):
                if W.owner[a] == -2 or W.owner[b] == -2 or (W.owner[a] < 0 and W.owner[b] < 0):
                    continue
                e = links.get((a, b))
                if e is None or cls < e[0]:
                    e = links[(a, b)] = [cls, Counter()]
                if cls == e[0] and ref:
                    e[1][ref] += 1
    return [[a, b, c, refs.most_common(1)[0][0] if refs else None] for (a, b), (c, refs) in sorted(links.items())]


def build_rail(W, ways):
    tier_of = {}
    for w in ways:
        usage = w.get("tags", {}).get("usage")
        if usage in ("tourism", "military") or "geometry" not in w:
            continue
        tier = 0 if usage == "main" else 1
        keep = lambda x, y: W.grid.cell_at(x, y) >= 0 and W.owner[W.grid.cell_at(x, y)] != -2
        for run in sample_cells(W.grid, [W.proj(g["lon"], g["lat"]) for g in w["geometry"] if g], keep):
            for a, b in links_of(W.grid, run):
                if W.owner[a] == -2 or W.owner[b] == -2 or (W.owner[a] < 0 and W.owner[b] < 0):
                    continue
                tier_of[(a, b)] = min(tier, tier_of.get((a, b), 9))
    return [[a, b, t] for (a, b), t in sorted(tier_of.items())]


def place(W, lon, lat, rings=2):
    x, y = W.proj(lon, lat)
    cell, k = W.place(lon, lat, rings)
    if cell is None:
        return None
    iso = W.counties[k]
    return {"x": round(x, 1), "y": round(y, 1), "cell": cell, "county": iso, "cbsa": iso,
            "state": W.states[W.old_new[k]]}


def port_candidates():
    """[(folded name, lon, lat)] of mapped ports: OSM port areas first, then other OSM, GeoNames and Wikidata ports."""
    from ..admin import fold
    osm = []
    for f in ("ports.json", "named_ports.json"):
        path = RAW / "osm_ports" / f
        for e in json.loads(path.read_text())["elements"] if path.exists() else []:
            t, c = e.get("tags", {}), e.get("center") or e
            for n in {t.get("name"), t.get("name:vi"), t.get("name:en"), t.get("official_name")} - {None}:
                area = t.get("industrial") == "port" or t.get("landuse") == "port"
                osm.append((0 if area else 1, fold(n), c["lon"], c["lat"], "osm"))
    with zipfile.ZipFile(RAW / "geonames" / "VN.zip") as z:
        for ln in z.read("VN.txt").decode("utf-8").splitlines():
            f = ln.split("\t")
            if f[7] in ("PRT", "HBR"):
                osm.append((2, fold(f[1]), float(f[5]), float(f[4]), "geonames"))
            elif f[6] == "P" or f[7] == "ADM3":  # towns and communes: the last resort, for an area named after one
                town = re.sub(r"^(thi tran|xa|phuong) ", "", fold(f[1]))
                osm.append((4, town, float(f[5]), float(f[4]), "town"))
    for r in json.loads((RAW / "wikidata" / "ports.json").read_text())["results"]["bindings"]:
        for n in (r["sLabel"]["value"], r.get("enLabel", {}).get("value")):
            if n:
                osm.append((3, fold(n), *wkt_point(r["c"]["value"]), "wikidata"))
    return [c[1:] for c in sorted(osm, key=lambda c: c[0]) if not NOT_PORT.search(c[1])]


def build_ports(W):
    UNPLACED.clear()
    from ..admin import fold, old_units
    cands = port_candidates()
    names = {fold(u["name"]): W.counties.index(u["iso"]) for u in old_units()}
    ports, rank = [], 0
    order = {c["id"]: k for k, c in enumerate(PORT_CLASSES)}
    def find(k_sea, match):
        for n, lon, lat, src in cands:
            if match(n, src):
                x, y = W.proj(lon, lat)
                cell = site_cell(W, x, y, 2, county=k_sea)  # in (or within two hexes of) the seaport's province
                if cell is not None:
                    iso = W.counties[k_sea]
                    return {"x": round(x, 1), "y": round(y, 1), "cell": cell, "county": iso, "cbsa": iso,
                            "state": W.states[W.old_new[k_sea]], "placed": src}

    for seaport, cls, areas in sorted(SEAPORTS, key=lambda s: order[s[1]]):
        k_sea = names[fold(seaport)]
        hits = [(label, find(k_sea, lambda n, src: src != "town" and re.search(pat, n))) for label, pat in areas]
        hits = [(label, h) for label, h in hits if h]
        if not hits:  # no area mapped: the town or commune the main area is named after
            label = areas[0][0]
            town = fold(label.split(" – ")[0])
            h = find(k_sea, lambda n, src: src == "town" and n == town)
            hits = [(label, h)] if h else []
        if not hits:
            print(f"    ! seaport {seaport}: no port area found")
            UNPLACED.append({"seaport": f"Cảng biển {seaport}", "class": cls, "areas": [label for label, _ in areas]})
        for k, (label, hit) in enumerate(hits):
            rank += 1
            ports.append({"id": fold(f"{seaport} {label}").replace(" ", "-").replace("–", "").replace(".", ""),
                          "name": label, "seaport": f"Cảng biển {seaport}", "class": cls, "main": k == 0,
                          "type": "coastal", "rank": rank, "tons": None, "domestic": None, "foreign": None,
                          "imports": None, "exports": None, "year": 2022, **hit})
    # one port per hex: keep the higher-ranked
    by_cell = {}
    for p in ports:
        by_cell.setdefault(p["cell"], p)
    return sorted(by_cell.values(), key=lambda p: p["rank"])


def airport_passengers():
    """{IATA: (passengers, year)} from the Wikipedia table: the newest year with a figure."""
    text = json.loads((RAW / "wikipedia_airports" / "busiest_airports.json").read_text())["parse"]["wikitext"]
    sec = text.split("===2020s===", 1)[1].split("|}", 1)[0]
    head = re.findall(r"data-sort-type=number\|(\d{4})", sec)
    out = {}
    for row in sec.split("|-")[1:]:
        cells = [c.strip() for c in row.strip().split("\n") if c.startswith("|")]
        cells = [re.sub(r"<ref[^>]*/>|<ref.*?</ref>|<ref[^>]*>.*", "", c[1:]).strip() for c in cells]
        if len(cells) < 6:
            continue
        iata = cells[4]
        vals = cells[6:6 + len(head)]
        for year, v in reversed(list(zip(head, vals))):
            if "unknown" in v.lower():  # data-sort-value="N" {{unknown}}: no figure for that year
                continue
            n = re.sub(r"[^\d]", "", v)
            if n:
                out[iata] = (int(n), int(year))
                break
    return out


def airport_names_vi():
    """{IATA: Vietnamese name} from Wikidata: the vi Wikipedia article's title, else the vi label. Where two items
    share a code (an old air base and the airport), the one whose English label is OurAirports' name wins."""
    from ..admin import fold as fold_
    fold = lambda s: fold_((s or "").split(" / ")[0]).strip()
    rows = json.loads((RAW / "wikidata" / "airports.json").read_text())["results"]["bindings"]
    by = defaultdict(list)
    for r in rows:
        vi = r.get("viTitle", r.get("viLabel", {})).get("value")
        if vi and not vi.startswith("Dự án"):  # "Dự án …" (a planned airport) is not the operating airport's name
            by[r["iata"]["value"]].append((fold(r.get("enLabel", {}).get("value")), vi))
    return lambda iata, name_en: next((vi for en, vi in by[iata] if en == fold(name_en)),
                                      by[iata][0][1] if len(by[iata]) == 1 else None)


def build():
    W = World()
    roads = build_roads(W, json.loads((RAW / "osm_roads" / "roads.json").read_text())["elements"])
    rail = build_rail(W, json.loads((RAW / "osm_rail" / "rail.json").read_text())["elements"])
    print(f"    {len(roads)} road links, {len(rail)} rail links")

    ports = build_ports(W)

    pax = airport_passengers()
    name_vi = airport_names_vi()
    from ..admin import old_units
    SEAT = {u["iso"]: u["name"] for u in old_units()}  # where an airport is: its former province (OurAirports municipality strings are messy)
    airports = []
    for r in csv.DictReader(open(RAW / "ourairports" / "airports.csv", encoding="utf-8")):
        if r["iso_country"] != "VN" or r["scheduled_service"] != "yes" or not r["iata_code"]:
            continue
        pl = place(W, float(r["longitude_deg"]), float(r["latitude_deg"]))
        if not pl:
            continue
        if r["iata_code"] in AIRPORT_PROVINCE:  # generalised outlines put a border airport in the neighbour
            iso = AIRPORT_PROVINCE[r["iata_code"]]
            k = W.counties.index(iso)
            pl.update(county=iso, cbsa=iso, state=W.states[W.old_new[k]])
            if W.county[pl["cell"]] != k:
                pl["cell"] = site_cell(W, pl["x"], pl["y"], 2, county=k) or pl["cell"]
        n, year = pax.get(r["iata_code"], (None, None))
        hub = None if n is None else "L" if n >= 1e7 else "M" if n >= 2e6 else "S" if n >= 5e5 else "N"
        airports.append({"id": r["iata_code"], "name": r["name"], "name_vi": name_vi(r["iata_code"], r["name"]),
                         "city": SEAT[pl["cbsa"]], "hub": hub,
                         "enplanements": n, "enplanements_prev": None, "cargo_lbs": None, "year": year, **pl})
    airports.sort(key=lambda a: -(a["enplanements"] or 0))
    print(f"    {len(ports)} ports, {len(airports)} airports ({sum(a['enplanements'] is not None for a in airports)} with passengers)")
    doc = {"version": 1,
           "vintage": {"roads": "OpenStreetMap (Overpass API)", "rail": "OpenStreetMap (Overpass API)",
                       "ports": "Quyết định 804/QĐ-TTg (2022); positions from OpenStreetMap", "airports": f"ACV passengers {max((a['year'] or 0) for a in airports)}"},
           "sources": ["osm_roads", "osm_rail", "qd804", "osm_ports", "wikidata", "geonames", "ourairports", "wikipedia_airports"], "rules": RULES,
           "road_classes": ROAD_CLASSES, "port_classes": PORT_CLASSES, "rail_tiers": RAIL_TIERS, "hubs": HUBS, "roads": roads, "rail": rail,
           "ports": ports, "seaports_unplaced": UNPLACED, "airports": airports}
    write_web("infrastructure.json", doc)
    save_interim("_infrastructure", doc)
