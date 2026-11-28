"""living.json: the data of the living map (web/js/ext/living), all small:

* crop_calendar + rice: lowland rice hexes with their crop-calendar region (USDA FAS IPAD rice calendar, North / South);
* flood: low-lying hexes of the Mekong Delta's annually flooded provinces and the months of the flood season
  (illustrative of mùa nước nổi, not a forecast);
* fishing: the zone where illustrative boat lights are scattered;
* tet: the Gregorian date of Tết (mùng 1 tháng Giêng) per year, 1990–2040, decoded from Hồ Ngọc Đức's Vietnamese lunar
  calendar tables (UTC+7), cross-checked against the Hong Kong Observatory's (Chinese calendar, UTC+8).
"""
from __future__ import annotations

import datetime as dt
import re

from ..admin import fold
from ..fetch import RAW
from ..store import load_web, write_web
from .common import World

REFS = RAW / "living_refs"

# USDA FAS IPAD, "Southeast Asia - Crop Calendar", Vietnam rice chart (usda_ipad_seasia_vm_1_calendar.png): planting
# and harvest months of each season, read off the chart's bars against its month gridlines (the page has no table).
CROP_CALENDAR = {
    "north": {"name": "North", "seasons": [
        {"name": "Winter–spring (Đông Xuân)", "plant": [11, 12, 1, 2, 3], "harvest": [6], "share": 22},
        {"name": "Main season (vụ Mùa)", "plant": [6, 7], "harvest": [9, 10, 11], "share": 16},
    ]},
    "south": {"name": "South", "seasons": [
        {"name": "Winter–spring (Đông Xuân)", "plant": [12, 1, 2], "harvest": [4, 5], "share": 25},
        {"name": "Summer–autumn (Hè Thu)", "plant": [3, 4, 5], "harvest": [8, 9], "share": 21},
        {"name": "Late summer–autumn / autumn–winter (Thu Đông)", "plant": [7, 8], "harvest": [11, 12], "share": 10},
    ]},
}
SPLIT_LAT = 16.2  # Hải Vân Pass: hexes north of it follow the North calendar, south of it the South
RICE_MIN_CROP = 30  # % of the hex in cropland (WorldCover)
RICE_MAX_ELEV = 50  # m: lowland (deltas and coastal plains), where cropland is mostly paddy

# Annually flooded upper delta (Phạm Thị Huyền Trang & Trương Văn Tuấn 2016): "1.632.000 ha thuộc 8 tỉnh: Đồng Tháp, An
# Giang, Long An, Kiên Giang, Cần Thơ, Tiền Giang và một phần của Vĩnh Long, Bến Tre". Months: inflow July–August,
# peak at Tân Châu / Châu Đốc in September or early October, recession from October to the end of December.
FLOOD_PROVINCES = ["Đồng Tháp", "An Giang", "Long An", "Kiên Giang", "Cần Thơ", "Tiền Giang", "Vĩnh Long", "Bến Tre"]
FLOOD_MONTHS = {"7": 0.3, "8": 0.6, "9": 0.9, "10": 1.0, "11": 0.65, "12": 0.3}
FLOOD_LEVEL = 3  # m: a hex floods in proportion to its land at or below 3 m (ETOPO1, sealevel.json)
FLOOD_MIN_SHARE = 10  # %

FISHING = {"min_nm": 6, "max_nm": 100}


def tet_dates():
    """{year: 'YYYY-MM-DD'} 1990–2040 from Hồ Ngọc Đức's year codes (TK20 / TK21): Tết = 1 January + (code >> 17)."""
    js = (REFS / "hnd_amlich_JavaScript_amlich-ntt.js").read_text(encoding="utf-8", errors="replace")
    tables = {}
    for name, base in (("TK20", 1900), ("TK21", 2000)):
        body = re.search(name + r"\s*=\s*new Array\((.*?)\)", js, re.S).group(1)
        codes = [int(h, 16) for h in re.findall(r"0x[0-9a-fA-F]+", body)]
        assert len(codes) == 100, name
        for k, c in enumerate(codes):
            tables[base + k] = c
    out = {}
    for y in range(1990, 2041):
        d = dt.date(y, 1, 1) + dt.timedelta(days=tables[y] >> 17)
        out[str(y)] = d.isoformat()
    return out


def hko_tet(year):
    """Chinese New Year (HKO's table, UTC+8): the Gregorian date whose lunar day is '1st Lunar Month'."""
    p = REFS / "hko_calendar" / f"T{year}e.txt"
    if not p.exists():
        return None
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if "1st lunar month" in line.lower():
            m = re.match(r"\s*(\d{4})/(\d{1,2})/(\d{1,2})", line)
            if m:
                return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def build():
    W = World()
    web = load_web("world.json")
    n = len(web["owner"])
    sea = load_web("sealevel.json")
    lvl = sea["levels"].index(FLOOD_LEVEL)

    # rice
    split_y = W.proj(107.5, SPLIT_LAT)[1]
    crop = web["pct"]["crop"]
    regions = list(CROP_CALENDAR)
    rice = {"cells": [], "region": [], "share": []}
    for i in range(n):
        if web["owner"][i] < 0 or web["water"][i] or web["relief"][i] != 0 or web["elev"][i] > RICE_MAX_ELEV:
            continue
        if (crop[i] or 0) < RICE_MIN_CROP:
            continue
        rice["cells"].append(i)
        rice["region"].append(regions.index("north" if W.center(i)[1] < split_y else "south"))
        rice["share"].append(int(round(min(100, crop[i]))))

    # flood
    names = {fold(c["name"]): k for k, c in enumerate(web["counties"])}
    want = {names[fold(p)] for p in FLOOD_PROVINCES}
    flood = {"cells": [], "share": []}
    for c, s in zip(sea["cells"], sea["share"][lvl]):
        if web["county"][c] not in want or s < FLOOD_MIN_SHARE:
            continue
        flood["cells"].append(c)
        flood["share"].append(int(s))

    tet = tet_dates()
    differ = {y: (d, hko_tet(int(y))) for y, d in tet.items() if hko_tet(int(y)) not in (None, d)}

    doc = {
        "version": 1,
        "sources": ["usda_ipad_cropcal", "fao_giews_vnm", "hcmue_flood_2016", "fao_mrc_flood", "etopo", "worldcover",
                    "nd26_2019", "hnd_amlich", "hko_calendar"],
        "crop_calendar": {
            "short": "USDA FAS",
            "source": "USDA Foreign Agricultural Service, IPAD: Southeast Asia crop calendar, Vietnam rice (public domain)",
            "rule": (f"Rice planting and harvest months per season, read off USDA IPAD's Vietnam rice calendar chart (North: "
                     f"winter–spring and the main season; South: winter–spring, summer–autumn and the late season). Hexes "
                     f"north of {SPLIT_LAT}°N (the Hải Vân Pass) follow the North, the rest the South; USDA gives no separate "
                     f"Central-coast or Central-Highlands rows, so those follow the nearer row. FAO GIEWS's Viet Nam calendar "
                     f"(2026) agrees within about a month. A month shows the latest stage any season is in (harvest > ripening > "
                     f"green > transplanting > fallow)."),
            "regions": CROP_CALENDAR,
        },
        "rice": {**rice, "rule": (f"Land hexes on flat ground with at least {RICE_MIN_CROP}% cropland (ESA WorldCover) and a "
                                  f"mean elevation of {RICE_MAX_ELEV} m or less: the deltas and coastal plains, where cropland is "
                                  f"mostly paddy. Upland fields (maize, cassava, coffee) are left as they are.")},
        "flood": {**flood, "months": FLOOD_MONTHS, "level_m": FLOOD_LEVEL,
                  "rule": (f"Hexes of the annually flooded upper Mekong Delta ({', '.join(FLOOD_PROVINCES)}; former provinces) "
                           f"with at least {FLOOD_MIN_SHARE}% of their land at or below {FLOOD_LEVEL} m (ETOPO1, as in the sea-level "
                           f"lens), drawn with that share as depth. The season: water comes in from July–August, peaks in "
                           f"September–October and recedes to the end of December (Phạm Thị Huyền Trang & Trương Văn Tuấn 2016; "
                           f"FAO: 'every flood season from July to November')."),
                  "note": ("Illustrative of the flood season (mùa nước nổi), not a forecast or a flood map: coarse elevation, "
                           "no dykes or the real year's water levels.")},
        "fishing": {**FISHING,
                    "rule": (f"Illustrative boat lights scattered over the sea between {FISHING['min_nm']} and "
                             f"{FISHING['max_nm']} nautical miles from land (mainland and islands), denser nearer the coast and "
                             "gathered in fleets. Not vessel positions: Decree 26/2019/NĐ-CP (Art. 42–43) splits the sea into "
                             "coastal, inshore and offshore fishing zones (vùng ven bờ, vùng lộng, vùng khơi), but the zone "
                             "lines' coordinates are not published with it, and open vessel data (Global Fishing Watch) is "
                             "non-commercial only.")},
        "tet": {"dates": tet, "differs_from_chinese": {y: {"vn": a, "cn": b} for y, (a, b) in differ.items()},
                "rule": ("Mùng 1 Tết per year, decoded from Hồ Ngọc Đức's Vietnamese lunar calendar tables (computed for "
                         "105°E / UTC+7): 1 January + the year code's Tết offset. Checked against the Hong Kong Observatory's "
                         "Chinese calendar (UTC+8); the two differ only where Vietnam's time zone moves the new moon "
                         "to the previous day.")},
    }
    print(f"    {len(rice['cells'])} rice hexes, {len(flood['cells'])} flood hexes, Tết {min(tet)}–{max(tet)} "
          f"(differs from Chinese: {sorted(differ)})")
    write_web("living.json", doc)
