"""Themes stream: extra lenses appended to web/data/lenses.json.

* People (63 former provinces): life expectancy, crude birth rate, total fertility, net migration (NSO Statistical
  Yearbook 2025, 2025 preliminary) and the ageing index (NSO 2024 intercensal survey, 1 April 2024).
* Economy (63): fishery output and travel turnover (yearbook 2025).
* Hazards (63): deaths and missing in storms, floods and landslides 1989-2010 (DesInventar, CCFSC records).
* Land (per hex): mean elevation and mean slope (ETOPO1). Environment (per hex): PM2.5 2024 (SatPM2.5 V6.GL.03).

Province figures: every hex takes the value of its former province (world.json `county`), as ext_society does.
Earlier copies of this builder's own lenses are replaced; no other lens is touched.

The ageing index comes from a PDF table: parse it once with
  uv run --with pypdf python -m pipeline.build.ext_themes parse
which writes data/stats/midcensus2024/ageing_index.csv (checked against the table's own identities).
"""
from __future__ import annotations

import csv
import json
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import numpy as np

from ..fetch import RAW, ROOT
from ..nso.names import std
from ..store import load_web, write_web
from .common import World

STATS = ROOT / "data" / "stats"
RAMPS = json.loads((ROOT / "pipeline" / "ramps.json").read_text())
YB = "NSO Statistical Yearbook 2025"
MID_PDF = RAW / "nso_midcensus2024" / "Dieu-tra-Dan-so-giua-ky-2024-31.12-2.pdf"
MID_CSV = STATS / "midcensus2024" / "ageing_index.csv"
MID_PAGES = (121, 122)  # PDF page index = printed page number of Table 5
DI_ZIP = RAW / "desinventar_vnm" / "DI_export_vnm.zip"
# Storm, flood and landslide records (the CCFSC coding is not consistent: Typhoon Linda 1997 is filed as "Lũ" with
# the comment "Bão số 5", so storms and floods are counted together). Not counted: earthquake, forest fire, drought,
# desertification, cold wave.
DI_EVENTS = ("Bão", "Typhoon", "Lũ", "Lũ quét", "Lụt", "Sạt lở đất", "Gió mùa", "Nước dâng", "Lốc", "Lốc tố",
             "Lốc+ mưa đá")
DI_YEARS = (1989, 2010)  # the inventory's continuous run; its single 2019 record is left out
DI_NAMES = {"Hà Tây": "Hà Nội", "Lao Cai": "Lào Cai", "Đăk Lăk": "Đắk Lắk", "Đăk Nông": "Đắk Nông"}
PM_NC = RAW / "satpm_v6gl03" / "V6GL03.CNNPM25.AS.202401-202412.nc"
ARCMIN_M = 1852.0  # one arc-minute of latitude, metres
GROUP_ENV = {"id": "environment", "name": "Environment & climate"}

RULES = {
    "hexes": "Each hex shows the figure of its former province (before 1 July 2025).",
    "disaster_deaths": f"Deaths plus missing persons of every DesInventar record of {DI_YEARS[0]}-{DI_YEARS[1]} whose "
                       f"event is a storm, flood, flash flood, inundation, landslide, monsoon rain, surge or whirlwind, "
                       "summed by former province; Hà Tây (merged into Hà Nội in 2008) is added to Hà Nội.",
    "elevation": "Mean ETOPO1 elevation of the hex's land samples (the same figure the terrain uses).",
    "slope": "Slope of every ETOPO1 sample (1 arc-minute grid, central differences, metres per metre → degrees), "
             "averaged over the hex's samples inside Vietnam that are above sea level.",
    "pm25": "Mean of the SatPM2.5 0.01° pixels whose centre falls in the hex and inside Vietnam (no-data pixels left out).",
}


# --- ageing index: parse the 2024 intercensal survey's Table 5 ----------------------------------------------------

NUM = r"-?\d+,\d"
ROW = re.compile(rf"^(\D+?)\s+((?:{NUM}\s+){{7}}{NUM})\s*$")


def parse_rows(text):
    """[(province_std, [8 numbers])] from Table 5's text: sex ratio (total, urban, rural), total dependency ratio,
    shares 0-14 / 15-64 / 65+ (%), ageing index (%). Region and national rows are dropped."""
    out = []
    for line in text.splitlines():
        m = ROW.match(line.strip())
        if m and std(m.group(1).strip()):
            out.append((std(m.group(1).strip()), [float(x.replace(",", ".")) for x in m.group(2).split()]))
    return out


def parse_midcensus():
    import pypdf
    r = pypdf.PdfReader(MID_PDF)
    rows = [x for p in MID_PAGES for x in parse_rows(r.pages[p].extract_text())]
    assert len(rows) == 63 and len({p for p, _ in rows}) == 63, len(rows)
    for p, v in rows:  # the table's own identities: shares add to 100, dependency = (0-14 + 65+) / 15-64
        assert abs(v[4] + v[5] + v[6] - 100) <= 0.2, (p, v)
        assert abs((v[4] + v[6]) / v[5] * 100 - v[3]) <= 0.4, (p, v)
    MID_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(MID_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["province_std", "value", "year", "unit", "source_url", "share_0_14", "share_65plus"])
        from ..sources_themes import MIDCENSUS_URL
        for p, v in rows:
            w.writerow([p, v[7], "2024-04-01", "people 60+ per 100 under 15", f"{MIDCENSUS_URL} (Table 5, p.121-122)",
                        v[4], v[6]])
    print(f"wrote {MID_CSV} ({len(rows)} provinces)")


# --- readers ------------------------------------------------------------------------------------------------------

def read_csv(path, col="value"):
    return {r["province_std"]: float(r[col]) for r in csv.DictReader(open(path, encoding="utf-8")) if r[col] not in ("", None)}


def yb25(name):
    return read_csv(STATS / "2025" / f"{name}.csv")


def disaster_deaths():
    """{province_std: deaths + missing}, number of records used."""
    with zipfile.ZipFile(DI_ZIP) as z:
        root = ET.fromstring(z.read("DI_export_vnm.xml"))
    out, n = {}, 0
    for t in root.find("fichas"):
        y = int(t.findtext("fechano") or 0)
        if t.findtext("evento") not in DI_EVENTS or not DI_YEARS[0] <= y <= DI_YEARS[1]:
            continue
        name = t.findtext("name0")
        p = std(DI_NAMES.get(name, name))
        assert p, name
        out[p] = out.get(p, 0) + float(t.findtext("muertos") or 0) + float(t.findtext("desaparece") or 0)
        n += 1
    return out, n


def hex_mean(W, lon, lat, val, ok):
    """Mean of `val` per hex over the points inside Vietnam (and `ok`), None where a hex has none."""
    from .ext_env import cells_of, provinces_of
    cell = cells_of(W, lon, lat)
    m = ok & (cell >= 0) & (provinces_of(W, lon, lat) >= 0)
    n = np.bincount(cell[m], minlength=len(W.owner))
    s = np.bincount(cell[m], weights=val[m], minlength=len(W.owner))
    return [round(float(s[i] / n[i]), 2) if n[i] and W.owner[i] >= 0 else None for i in range(len(W.owner))]


def slope(W):
    a = np.loadtxt(RAW / "etopo" / "etopo_vn.csv", delimiter=",", skiprows=2)
    lats, lons = np.unique(a[:, 0]), np.unique(a[:, 1])
    assert len(a) == len(lats) * len(lons)
    order = np.lexsort((a[:, 1], a[:, 0]))  # rows by latitude, columns by longitude
    z = a[order, 2].reshape(len(lats), len(lons))
    dlat, dlon = np.diff(lats).mean() * 60, np.diff(lons).mean() * 60  # arc-minutes per step
    gy, gx = np.gradient(z, dlat * ARCMIN_M, 1.0)
    gx = gx / (dlon * ARCMIN_M * np.cos(np.radians(lats))[:, None])
    deg = np.degrees(np.arctan(np.hypot(gx, gy)))
    LA, LO = np.meshgrid(lats, lons, indexing="ij")
    return hex_mean(W, LO.ravel(), LA.ravel(), deg.ravel(), ~np.isnan(deg.ravel()) & (z.ravel() >= 0))


def pm25(W):
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open(PM_NC) as src:
        win = from_bounds(101.5, 7.5, 118.5, 24, src.transform).round_offsets().round_lengths()  # Vietnam + islands
        v = src.read(1, window=win).astype(float)
        t = src.window_transform(win)
    rows, cols = np.indices(v.shape)
    lon, lat = t * (cols.ravel() + 0.5, rows.ravel() + 0.5)
    v = v.ravel()
    return hex_mean(W, np.asarray(lon), np.asarray(lat), v, (v >= 0) & (v < 1000))


# --- build --------------------------------------------------------------------------------------------------------

def pctl(vals, lo=2, hi=98):
    v = sorted(x for x in vals if x is not None)
    a, b = v[int(len(v) * lo / 100)], v[min(len(v) - 1, int(len(v) * hi / 100))]
    return [a, b] if b > a else [v[0], v[-1]]


def lens(lid, group, name, icon, emoji, unit, fmt, ramp, hi, source, year, desc, vals, note=None, scale="linear",
         level=None, domain=None):
    pos = [v for v in vals if v is not None and (scale != "log" or v > 0)]
    d = {"id": lid, "group": group, "name": name, "icon": icon, "emoji": emoji, "unit": unit, "format": fmt,
         "scale": scale, "domain": domain or pctl(pos), "ramp": RAMPS[ramp], "higher_is": hi, "source": source,
         "year": year, "description": desc, "values": vals}
    if level:
        d["level"] = level
    if note:
        d["note"] = note
    return d


def build():
    W = World()
    from ..admin import old_units
    olds = old_units()
    std_of = {u["iso"]: std(u["name"]) for u in olds}
    assert all(std_of.values())
    iso_of_k = list(W.counties)
    land = [i for i in range(len(W.owner)) if W.owner[i] >= 0]
    fx = {int(r["date"]): r["value"] for r in json.loads((STATS / "wb_fx.json").read_text())[1] if r["value"]}
    usd_rate = fx[max(fx)]  # 2025 VND figures at the latest published rate (2024), as the other lenses

    def per_hex(d, conv=lambda x: x):
        vals = [None] * len(W.owner)
        for i in land:
            k = W.county[i]
            if k >= 0:
                v = d.get(std_of[iso_of_k[k]])
                vals[i] = None if v is None else conv(v)
        return vals

    hexes = RULES["hexes"]
    prel = f"{YB}, 2025 preliminary, by the 63 former provinces"
    ageing = read_csv(MID_CSV)
    deaths, n_rec = disaster_deaths()
    tour = yb25("tourism_travel_turnover")
    lenses = [
        lens("life_expectancy", "people", "Life expectancy", "l-age", "🎂", "years at birth", "years", "home", "good",
             "nso_yearbook", "2025", f"Life expectancy at birth, 2025 ({prel}, Part I table p.143-144).", per_hex(yb25("life_expectancy")),
             note=hexes),
        lens("ageing_index", "people", "Ageing index", "l-age", "👵", "people 60+ per 100 under 15", "float", "age",
             "neutral", "nso_midcensus2024", "2024-04-01",
             "People aged 60 and over per 100 children under 15 on 1 April 2024 (NSO 2024 intercensal population and "
             "housing survey, Table 5, by the 63 former provinces). Nationally 60.2.", per_hex(ageing),
             note="A sample survey, not a full census. " + hexes),
        lens("crude_birth_rate", "people", "Birth rate", "l-people", "👶", "births per 1,000 people", "float", "home",
             "neutral", "nso_yearbook", "2025", f"Crude birth rate: live births in the year per 1,000 people, 2025 ({prel}).",
             per_hex(yb25("crude_birth_rate")), note=hexes),
        lens("total_fertility_rate", "people", "Fertility", "l-people", "🍼", "children per woman", "float", "foreign_born",
             "neutral", "nso_yearbook", "2025",
             f"Total fertility rate: the average number of children a woman would have at the year's birth rates by age, "
             f"2025 ({prel}).", per_hex(yb25("total_fertility_rate")), note=hexes),
        lens("net_migration_rate", "people", "Net migration", "l-people", "🧳", "per 1,000 people", "float", "age",
             "neutral", "nso_yearbook", "2025",
             f"In-migrants minus out-migrants per 1,000 residents, 2025 ({prel}). Negative: more people left than "
             "arrived.", per_hex(yb25("net_migration_rate")),
             note="Moves within a former province are not counted. " + hexes),
        lens("fishery_production", "economy", "Fisheries", "l-wave", "🐟", "tonnes of fish and seafood", "int",
             "bachelors", "neutral", "nso_yearbook", "2025",
             f"Fishery production, 2025: capture fisheries (sea and inland) plus aquaculture, tonnes ({prel}, table p.649-650).",
             per_hex(yb25("fishery_production"), round), scale="log",
             note=hexes),
        lens("tourism_travel_turnover", "economy", "Travel turnover", "l-amenities", "🧭", "travel-agency turnover, $",
             "usd", "broadband", "neutral", "nso_yearbook", "2025",
             f"Turnover of travel agencies and tour operators, 2025, current prices ({prel}, table p.714-715), "
             f"converted at the World Bank {max(fx)} rate ({usd_rate:,.0f} VND per $).",
             per_hex(tour, lambda v: round(v * 1e9 / usd_rate)), scale="log",
             note="Tour sales, not visitor numbers or hotel revenue (NSO publishes neither by province). Bắc Kạn's "
                  "2025 cell is blank in the yearbook. " + hexes),
        lens("disaster_deaths", "hazards", "Storm & flood deaths", "l-disasters", "🌊", "dead and missing, 1989–2010",
             "int", "disasters", "bad", "desinventar_vnm", "1989–2010",
             f"People killed or missing in storms, floods, flash floods and landslides, {DI_YEARS[0]}-{DI_YEARS[1]}, "
             f"summed over {n_rec} DesInventar records (Viet Nam's flood and storm control committee, CCFSC), by the 63 "
             "former provinces.", per_hex({p: deaths.get(p, 0) for p in std_of.values()}, round), scale="log",
             note="A historical inventory with no records after 2010 and few in 2009-2010. Storm no. 5 of November 1997 "
                  "dominates the south (over 1,100 missing in Cà Mau alone). Provinces without a record show 0. " + hexes),
    ]

    elev = [W.raw["elev"][i] if W.owner[i] >= 0 else None for i in range(len(W.owner))]
    sl = slope(W)
    pm = pm25(W)
    lenses += [
        lens("elevation", "land", "Elevation", "l-snow", "⛰️", "m above sea level", "int", "age", "neutral", "etopo", None,
             "Mean elevation of the hex's land (ETOPO1, 1 arc-minute, ~1.8 km samples), in metres.",
             [None if v is None else max(0, round(v)) for v in elev], domain=[0, pctl([v for v in elev if v is not None])[1]],
             note="Averaged over about 20 samples per hex: peaks are higher than their hex."),
        lens("slope", "land", "Slope", "l-snow", "📐", "degrees", "float", "homeownership", "neutral", "etopo", None,
             "Mean terrain slope of the hex, degrees, from the ETOPO1 1-arc-minute (~1.8 km) elevation grid.",
             sl, domain=[0, pctl(sl)[1]],
             note="A coarse grid smooths steep slopes: real hillsides are much steeper than this average."),
        lens("pm25", "environment", "Air quality (PM2.5)", "l-sun", "😷", "µg/m³ PM2.5, annual mean", "float", "poverty",
             "bad", "satpm_v6gl03", "2024",
             "Annual mean fine particulate matter (PM2.5) at ground level, 2024, µg/m³: SatPM2.5 V6.GL.03 (Washington "
             "University in St. Louis), satellite aerosol optical depth combined with a chemical-transport model and "
             "ground monitors, 0.01° pixels averaged per hex.", pm,
             note="A modelled estimate, not a monitor reading; CC BY 4.0, cite van Donkelaar, Martin et al."),
    ]
    for l in lenses:
        if l["year"] is None:
            del l["year"]

    # --- append to lenses.json (re-read right before writing: other ext_* builders append too) ---
    L = load_web("lenses.json")
    ids = {l["id"] for l in lenses}
    L["lenses"] = [l for l in L["lenses"] if l["id"] not in ids] + lenses
    if GROUP_ENV["id"] not in {g["id"] for g in L["groups"]}:
        L["groups"].append(GROUP_ENV)
    write_web("lenses.json", L)
    cover = {l["id"]: sum(v is not None for v in l["values"]) for l in lenses}
    print(f"    {len(lenses)} lenses appended; hexes with a value: {cover}; {n_rec} DesInventar records")


if __name__ == "__main__" and sys.argv[1:] == ["parse"]:
    parse_midcensus()
