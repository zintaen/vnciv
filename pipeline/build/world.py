"""The map: hex grid, land/water, relief, land cover, provinces (34 of 2025), former provinces (63), rivers.

Adapted from usaciv's world builder (MIT). Point-in-polygon lookups go through rasters (rasterio) so the 10 m
country outlines stay fast. Saves interim "_world" for the other builders.
"""
from __future__ import annotations

import csv
import json
import math
from collections import Counter

import numpy as np
from rasterio import features
from rasterio.transform import from_origin

from .. import worldcover
from ..admin import OLD, new_units, old_units
from ..fetch import RAW
from ..geo import HEX_KM, UNIT, MapProjection, geojson_lines
from ..hexgrid import SQRT3, HexGrid
from ..store import save_interim, write_web

R = 25.0  # hex radius in map units (= HEX_KM km)
MARGIN = 200.0  # map units
WATER, FOREIGN = -1, -2
LAND, OCEAN, COAST, LAKE = range(4)
FLAT, HILLS, MOUNTAINS, PEAKS = range(4)
TIDAL_SEA_SHARE = 0.5
COAST_DEPTH_M = -200
LAND_MIN_ALT_M = -100
RES = 0.005  # degrees per lookup-raster pixel (~0.55 km)
MAP_ASPECT = 1.3  # minimum width ÷ height of the map rectangle
LON0, LAT1 = 95.0, 26.0
NCOL, NROW = int((121.0 - LON0) / RES), int((LAT1 - 4.5) / RES)
COVER_STEP = 1.0 * UNIT  # cover lattice spacing: 1 km
URBAN_MIN_PCT = 25

# relief thresholds (m) for 8 km hexes; ETOPO1 gives ~50 samples per hex
HILLS_SD, MOUNT_SD, MOUNT_MEAN, PEAK_MAX = 70, 190, 1500, 2600

WATER_TABLE = [
    {"id": LAND, "name": "Land", "rule": "At least 4 of the hex's 7 sample points (centre + 6) fall on province or neighbouring-country outlines, unless the centre is sea and the hex is mostly at or below sea level in ETOPO1. Islands of at least 3 km² (and every Hoàng Sa and Trường Sa island) keep at least the hex at their centre."},
    {"id": OCEAN, "name": "Sea", "color": "#1b4266", "rule": "Sea deeper than 200 m and not next to land."},
    {"id": COAST, "name": "Coast", "color": "#2d6d97", "rule": "Sea next to a land hex, or shallower than 200 m (ETOPO1 mean)."},
    {"id": LAKE, "name": "Lake", "color": "#3a80b0", "rule": "Water hex with Natural Earth 1:10m lake points that outnumber sea points, or above sea level."},
]
RELIEF_TABLE = [
    {"id": FLAT, "name": "Flat", "rule": f"Elevation standard deviation inside the hex under {HILLS_SD} m, or a valley floor (the lower 60% of samples within 60 m of each other and under 400 m) eased down one class."},
    {"id": HILLS, "name": "Hills", "rule": f"Elevation standard deviation ≥ {HILLS_SD} m."},
    {"id": MOUNTAINS, "name": "Mountains", "rule": f"Elevation standard deviation ≥ {MOUNT_SD} m, or mean elevation ≥ {MOUNT_MEAN:,} m."},
    {"id": PEAKS, "name": "Peaks", "rule": f"Highest sample ≥ {PEAK_MAX:,} m with mountain relief (the Hoàng Liên Sơn range around Fansipan)."},
]
# WorldCover classes: 10 tree, 20 shrub, 30 grass, 40 crop, 50 built-up, 60 bare, 70 snow, 80 water, 90 wetland, 95 mangrove
COVER = [
    (1, "forest_deciduous", "Broadleaf forest", "#4f7a35", [10], "Tree cover (10) is the largest group, mean elevation under 1,000 m."),
    (2, "forest_evergreen", "Montane pine forest", "#2f5a3a", [10], "Tree cover is the largest group, mean elevation 1,600 m or more."),
    (3, "forest_mixed", "Montane forest", "#43703f", [10], "Tree cover is the largest group, mean elevation 1,000–1,600 m."),
    (4, "scrub", "Scrub", "#c9b07a", [20], "Shrubland (20) is the largest group."),
    (5, "grassland", "Grassland", "#a9b35a", [30], "Grassland (30) is the largest group."),
    (6, "pasture", "Pasture", "#8fb04e", [], "Not used: WorldCover has no pasture class (grazing land is grassland)."),
    (7, "cropland", "Cropland & paddies", "#c2b84e", [40], "Cropland (40: rice paddies, fields, plantations it can tell from forest) is the largest group."),
    (8, "wetland", "Wetland & mangrove", "#4f8a6e", [90, 95], "Herbaceous wetland (90) plus mangroves (95) is the largest group."),
    (9, "urban", "Urban", "#8a8378", [50], f"Built-up (50) is ≥ {URBAN_MIN_PCT}% of the hex's land, whatever else is there."),
    (10, "barren", "Barren", "#bfae95", [60], "Bare or sparse vegetation (60: sand dunes, rock) is the largest group."),
    (11, "ice", "Ice & snow", "#e8eef2", [70], "Snow and ice (70) is the largest group."),
]
GROUPS = {"forest": (10,), "scrub": (20,), "grassland": (30,), "cropland": (40,), "wetland": (90, 95), "barren": (60,), "ice": (70,)}
GROUP_ID = {"scrub": 4, "grassland": 5, "cropland": 7, "wetland": 8, "barren": 10, "ice": 11}
PCT = {"forest": (10,), "crop": (40,), "pasture": (), "grass": (30,), "shrub": (20,), "wetland": (90, 95), "developed": (50,)}
COVER_NOTE = (
    "From ESA WorldCover 2021, read at about 280 m pixels and sampled on a 1 km lattice inside each hex (about 160 "
    "points). Permanent water and no-data pixels are ignored; shares are of the remaining land points. Neighbouring "
    "countries have cover 0 (none); far-offshore island hexes are drawn as grassland (5), as WorldCover's tiles stop at 111° E. Perennial tree crops such as coffee, rubber and cashew are "
    "often classed as tree cover, so the Central Highlands look more forested than they are."
)
WATER_NOTE = (
    "Province outlines (geoBoundaries) and Natural Earth 1:10m country outlines don't meet exactly. A sea hex whose ETOPO1 "
    "mean is above sea level (and fewer than half of its samples below it) becomes land when at least 4 of its 6 neighbours are land, or when it touches both "
    "Vietnamese and foreign land. Hoàng Sa (Paracel) and Trường Sa (Spratly) islands are far smaller than a hex; each "
    "island group is shown by the hexes at its islands' centres, owned by Đà Nẵng and Khánh Hòa."
)
RELIEF_NOTE = "From ETOPO1 samples (~1.8 km apart, about 50 per hex) at or above -100 m. Water hexes are always flat."

RIVER_VI = {"Mekong": "Mê Kông", "Hong": "Sông Hồng", "Da": "Sông Đà", "Ca": "Sông Cả", "Ba": "Sông Ba",
            "Srepok": "Sông Srêpốk", "Krong": "Krông", "Kong": "Sông Sê Kông", "Ou": "Nậm U", "Lancang": "Lan Thương"}


def rings_of(geom):
    t, c = geom["type"], geom["coordinates"]
    return [c] if t == "Polygon" else c if t == "MultiPolygon" else []


def raster(shapes):
    """int16 raster of shape values (+1; 0 = none) on the lookup grid."""
    tr = from_origin(LON0, LAT1, RES, RES)
    return features.rasterize(((g, v + 1) for g, v in shapes), out_shape=(NROW, NCOL), transform=tr, fill=0,
                              dtype="int16", all_touched=False)


def look(r, lon, lat):
    i, j = int((LAT1 - lat) / RES), int((lon - LON0) / RES)
    return int(r[i, j]) - 1 if 0 <= i < NROW and 0 <= j < NCOL else -1


def classify_relief(mean, sd, vmax):
    if vmax >= PEAK_MAX and (sd >= MOUNT_SD or mean >= MOUNT_MEAN):
        return PEAKS
    if sd >= MOUNT_SD or mean >= MOUNT_MEAN:
        return MOUNTAINS
    if sd >= HILLS_SD:
        return HILLS
    return FLAT


def is_valley_floor(samples):
    if len(samples) < 6:
        return False
    v = sorted(samples)
    lo = v[: max(3, int(len(v) * 0.6))]
    return lo[-1] < 400 and lo[-1] - lo[0] < 60


def majority(values, centre):
    counts = Counter(values)
    top = max(counts.values())
    tied = [v for v in counts if counts[v] == top]
    return centre if centre in tied else tied[0]


def hex_lattice(radius, step):
    half_w = SQRT3 / 2 * radius
    n = int(radius // step) + 1
    out = []
    for iy in range(-n, n + 1):
        for ix in range(-n, n + 1):
            x, y = (ix + 0.5) * step, (iy + 0.5) * step
            if abs(x) <= half_w and abs(y) <= radius - abs(x) / SQRT3:
                out.append((x, y))
    return out


def simplify(points, min_d):
    out = [points[0]]
    for p in points[1:-1]:
        if math.dist(p, out[-1]) >= min_d:
            out.append(p)
    out.append(points[-1])
    return out


def ring_area_km2(ring, proj):
    pts = [proj(lon, lat) for lon, lat, *_ in ring]
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        a += x0 * y1 - x1 * y0
    return abs(a) / 2 / UNIT / UNIT


HOANG_SA_BOX = (15.5, 17.5, 110.8, 113.0)  # lat0, lat1, lon0, lon1
TRUONG_SA_BOX = (6.0, 12.5, 111.0, 118.0)


def archipelago_islands():
    """[{name, en, lon, lat, group}] from the Wikidata archipelago query, inside each archipelago's box."""
    from ..sources import HOANG_SA, TRUONG_SA
    d = json.loads((RAW / "wikidata" / "archipelago.json").read_text())["results"]["bindings"]
    out, seen = [], set()
    for r in d:
        name = r["l"]["value"]
        c = r["c"]["value"]
        lon, lat = (float(v) for v in c[c.index("(") + 1: c.index(")")].split())
        for group, names, (a0, a1, o0, o1) in (("hoang_sa", HOANG_SA, HOANG_SA_BOX), ("truong_sa", TRUONG_SA, TRUONG_SA_BOX)):
            if name in names and a0 < lat < a1 and o0 < lon < o1 and name not in seen:
                seen.add(name)
                label = name if name.startswith(("Đảo", "Đá")) else ("Đảo " + name if name != "Hoàng Sa" else "Đảo Hoàng Sa")
                out.append({"name": label, "en": r.get("en", {}).get("value"), "lon": lon, "lat": lat, "group": group})
    return out


def build():
    olds, news = old_units(), new_units()
    old_idx = {u["iso"]: k for k, u in enumerate(olds)}
    new_idx = {u["name"]: k for k, u in enumerate(news)}
    old_new = [new_idx[u["new"]] for u in olds]  # former province → 2025 province index

    gb = json.loads((RAW / "geoboundaries" / "geoBoundaries-VNM-ADM1.geojson").read_text())
    parts = []  # (old index, geometry)
    for f in gb["features"]:
        iso = OLD[f["properties"]["shapeName"].strip()][0]
        parts.append((old_idx[iso], f["geometry"]))

    # projection fitted to every province part (islands included)
    probe = MapProjection(0, 0, 0)
    xs, ys = [], []
    for _, g in parts:
        for poly in rings_of(g):
            for lon, lat, *_ in poly[0]:
                x, y = probe._albers(lon, lat)
                xs.append(x)
                ys.append(y)
    height = (max(ys) - min(ys)) * UNIT + 2 * MARGIN
    width = (max(xs) - min(xs)) * UNIT + 2 * MARGIN
    # a tall country: widen the map (neighbours west, sea east) so wide screens are not framed by empty bands
    extra = max(0.0, MAP_ASPECT * height - width) / 2
    proj = MapProjection(min(xs) - extra / UNIT, max(ys), MARGIN)
    width += 2 * extra
    corners = [proj.inverse(x, y) for x in (0, width) for y in (0, height)]
    print(f"    map window lon {min(c[0] for c in corners):.2f}–{max(c[0] for c in corners):.2f}, "
          f"lat {min(c[1] for c in corners):.2f}–{max(c[1] for c in corners):.2f}")
    grid = HexGrid.covering(width, height, R)
    print(f"    grid {grid.cols}×{grid.rows} = {grid.size} hexes of {HEX_KM:g} km")

    prov_r = raster([(g, k) for k, g in parts])
    ne = RAW / "natural_earth"
    countries = json.loads((ne / "ne_10m_admin_0_countries.geojson").read_text())["features"]
    foreign_r = raster([(f["geometry"], 0) for f in countries if f["properties"]["ADM0_A3"] not in ("VNM", "PGA", "SCR")])
    lakes = json.loads((ne / "ne_10m_lakes.geojson").read_text())["features"]
    lake_r = raster([(f["geometry"], 0) for f in lakes])

    # --- elevation per hex ---
    stats_all = [[0, 0.0, 0.0] for _ in range(grid.size)]
    stats_land = [[0, 0.0, 0.0] for _ in range(grid.size)]
    samples_land = [[] for _ in range(grid.size)]
    below_sea, below_sum = [0] * grid.size, [0.0] * grid.size
    with open(RAW / "etopo" / "etopo_vn.csv", newline="") as f:
        rows = csv.reader(f)
        next(rows), next(rows)
        for la, lo, al in rows:
            if al == "NaN":
                continue
            alt = float(al)
            i = grid.cell_at(*proj(float(lo), float(la)))
            if i < 0:
                continue
            if alt < 0:
                below_sea[i] += 1
                below_sum[i] += alt
            for st in (stats_all[i], stats_land[i]) if alt >= LAND_MIN_ALT_M else (stats_all[i],):
                st[0] += 1
                st[1] += alt
                st[2] += alt * alt
            if alt >= LAND_MIN_ALT_M:
                samples_land[i].append(alt)

    def mean_std(st):
        n, s1, s2 = st
        if not n:
            return None, None
        m = s1 / n
        return m, math.sqrt(max(0.0, s2 / n - m * m))

    def sea_share(i):
        return below_sea[i] / stats_all[i][0] if stats_all[i][0] else 0.0

    # --- ownership: majority of 7 sample points ---
    offsets = [(0.0, 0.0)] + [(0.6 * R * math.cos(math.radians(60 * k - 30)), 0.6 * R * math.sin(math.radians(60 * k - 30)))
                              for k in range(6)]
    owner, water = [WATER] * grid.size, [OCEAN] * grid.size
    county = [-1] * grid.size
    county_samples = [[] for _ in range(grid.size)]
    for i in range(grid.size):
        cx, cy = grid.center(*grid.col_row(i))
        kinds = []
        for dx, dy in offsets:
            lon, lat = proj.inverse(cx + dx, cy + dy)
            if look(lake_r, lon, lat) >= 0:
                kinds.append("lake")
            elif (p := look(prov_r, lon, lat)) >= 0:
                kinds.append(("vn", p))
            elif look(foreign_r, lon, lat) >= 0:
                kinds.append(FOREIGN)
            else:
                kinds.append("sea")
        land = [k for k in kinds if not isinstance(k, str)]
        m_all, _ = mean_std(stats_all[i])
        tidal = kinds[0] == "sea" and m_all is not None and (m_all <= 0 or sea_share(i) >= TIDAL_SEA_SHARE)
        if len(land) * 2 > len(kinds) and not tidal:
            vn = [k[1] for k in land if k != FOREIGN]
            nf = len(land) - len(vn)
            if len(vn) > nf or (len(vn) == nf and kinds[0] != FOREIGN):
                centre = kinds[0][1] if isinstance(kinds[0], tuple) else None
                owner[i] = majority([old_new[p] for p in vn], old_new[centre] if centre is not None else None)
                county_samples[i] = [k[1] if isinstance(k, tuple) else -1 for k in kinds]
            else:
                owner[i] = FOREIGN
            water[i] = LAND
        else:
            wet = [k for k in kinds if isinstance(k, str)]
            above = m_all is not None and m_all > 0
            water[i] = LAKE if "lake" in wet and (above or majority(wet, kinds[0] if kinds[0] in wet else "lake") == "lake") else OCEAN

    # slivers between the two outline datasets
    slivers = []
    for i in range(grid.size):
        if water[i] != OCEAN:
            continue
        m, _ = mean_std(stats_all[i])
        nb = [j for j in grid.neighbours(i) if water[j] == LAND]
        land_nb = [owner[j] for j in nb]
        border = FOREIGN in land_nb and any(o >= 0 for o in land_nb)
        if m is not None and m > 0 and sea_share(i) < TIDAL_SEA_SHARE and (len(land_nb) >= 4 or border):
            slivers.append((i, Counter(land_nb).most_common(1)[0][0], nb))
    for i, o, nb in slivers:
        owner[i], water[i] = o, LAND
        if o >= 0:
            cs = [k for j in nb for k in county_samples[j] if k >= 0 and old_new[k] == o]
            county_samples[i] = [Counter(cs).most_common(1)[0][0]] if cs else []
    print(f"    {len(slivers)} sliver water hexes turned into land")

    # islands smaller than a hex: keep the hex at their centre (≥ 3 km², or any island far offshore)
    forced = 0
    islands = []
    for k, g in parts:
        for poly in rings_of(g):
            ring = poly[0]
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
            area = ring_area_km2(ring, proj)
            offshore = lon > 109.6
            if area < 3 and not offshore:
                continue
            i = grid.cell_at(*proj(lon, lat))
            if i < 0 or water[i] == LAND:
                continue
            owner[i], water[i] = old_new[k], LAND
            county_samples[i] = [k]
            forced += 1
            if offshore:
                islands.append(i)
    # every Hoàng Sa (Đà Nẵng) and Trường Sa (Khánh Hòa) island and reef Wikidata places, by Vietnamese name
    arch = archipelago_islands()
    old_iso = [u["iso"] for u in olds]
    for isl in arch:
        i = grid.cell_at(*proj(isl["lon"], isl["lat"]))
        if i < 0:
            continue
        k = old_iso.index("DN" if isl["group"] == "hoang_sa" else "34")
        if water[i] != LAND:
            owner[i], water[i] = old_new[k], LAND
            county_samples[i] = [k]
            forced += 1
        if i not in islands and isl["lon"] > 109.6:
            islands.append(i)
    print(f"    {forced} island hexes kept ({len(islands)} offshore: Hoàng Sa, Trường Sa; {len(arch)} named islands)")

    # county (former province) per hex: centre sample if in the owner province, else the commonest in-province one
    for i, smp in enumerate(county_samples):
        valid = [k for k in smp if k >= 0]
        if owner[i] < 0:
            continue
        if not valid:  # borrow from same-province neighbours
            valid = [k for j in grid.neighbours(i) for k in county_samples[j] if k >= 0 and old_new[k] == owner[i]]
            if not valid:
                valid = [k for k, n in enumerate(old_new) if n == owner[i]][:1]
            county_samples[i] = [Counter(valid).most_common(1)[0][0]] * 7
            smp = county_samples[i]
        same = [k for k in valid if old_new[k] == owner[i]] or valid
        county[i] = smp[0] if smp[0] in same else Counter(same).most_common(1)[0][0]
        county_samples[i] = [k if k >= 0 else county[i] for k in smp] + [county[i]] * (7 - len(smp))

    # --- elevation, depth classes, relief ---
    elev, relief, elev_max = [0] * grid.size, [FLAT] * grid.size, [0] * grid.size
    for i in range(grid.size):
        if water[i] == LAND:
            m, sd = mean_std(stats_land[i])
            if m is None:
                m, sd = mean_std(stats_all[i])
                m = None if m is None else max(m, 0.0)
            if m is None:
                continue
            vmax = max(samples_land[i]) if samples_land[i] else m
            elev[i] = round(m)
            relief[i] = classify_relief(max(m, 0.0), sd, vmax)
            if relief[i] in (HILLS, MOUNTAINS) and is_valley_floor(samples_land[i]):
                relief[i] -= 1
            elev_max[i] = max(0, round(vmax))
        else:
            m, _ = mean_std(stats_all[i])
            if m is None:
                elev[i] = -4000
            elif water[i] != LAKE and below_sea[i]:
                elev[i] = round(below_sum[i] / below_sea[i])
            else:
                elev[i] = min(round(m), 0)
            if water[i] == OCEAN:
                near = any(water[j] == LAND for j in grid.neighbours(i))
                water[i] = COAST if near or elev[i] > COAST_DEPTH_M else OCEAN
    print("    relief:", dict(Counter(relief[i] for i in range(grid.size) if owner[i] >= 0)))

    # --- land cover (WorldCover) ---
    wc = worldcover.mosaic()
    lattice = hex_lattice(R, COVER_STEP)
    cover = [0] * grid.size
    pct = {k: [0] * grid.size for k in PCT}
    for i in range(grid.size):
        if owner[i] < 0 or i in islands:
            continue
        cx, cy = grid.center(*grid.col_row(i))
        counts = Counter(worldcover.lookup(wc, *proj.inverse(cx + ox, cy + oy)) for ox, oy in lattice)
        land = sum(n for c, n in counts.items() if c not in (0, 80))
        if not land:
            continue
        for k, codes in PCT.items():
            pct[k][i] = round(100 * sum(counts[c] for c in codes) / land)
        if pct["developed"][i] >= URBAN_MIN_PCT:
            cover[i] = 9
            continue
        best, best_n = None, 0
        for g, codes in GROUPS.items():
            n = sum(counts[c] for c in codes)
            if n > best_n:
                best, best_n = g, n
        if best == "forest":
            cover[i] = 1 if elev[i] < 1000 else 3 if elev[i] < 1600 else 2
        elif best:
            cover[i] = GROUP_ID[best]
    for i in islands:
        cover[i] = 5  # coral islands: grass and scrub at this scale
    print("    cover:", dict(Counter(cover[i] for i in range(grid.size) if owner[i] >= 0)))

    # --- rivers: OpenStreetMap's notable rivers inside Vietnam (when fetched), Natural Earth 1:10m elsewhere ---
    osm_path = RAW / "osm_rivers" / "rivers.json"
    osm = json.loads(osm_path.read_text())["elements"] if osm_path.exists() else None
    in_vn = lambda lon, lat: look(prov_r, lon, lat) >= 0
    rivers = []

    def add_line(name, rank, lonlat):
        """Project, clip to the map and simplify; split where the line leaves the map."""
        run = []
        for pt in list(lonlat) + [None]:
            q = proj(*pt) if pt is not None else None
            if q and -50 <= q[0] <= width + 50 and -50 <= q[1] <= height + 50:
                run.append(q)
                continue
            if len(run) >= 2:
                pts = simplify(run, 4.0)
                rivers.append({"name": name, "rank": rank, "pts": [round(v, 1) for p in pts for v in p]})
            run = []

    for f in json.loads((ne / "ne_10m_rivers_lake_centerlines.geojson").read_text())["features"]:
        p = f["properties"]
        if (p.get("scalerank") or 99) > 9:
            continue
        name = p.get("name") or ""
        for line in geojson_lines(f["geometry"]):
            if osm is None:
                add_line(RIVER_VI.get(name, name), int(p.get("scalerank") or 9), line)
                continue
            seg = []  # keep only the parts outside Vietnam (OSM draws the inside)
            for lon, lat in line:
                if in_vn(lon, lat):
                    if len(seg) >= 2:
                        add_line(RIVER_VI.get(name, name), int(p.get("scalerank") or 9), seg)
                    seg = []
                else:
                    seg.append((lon, lat))
            if len(seg) >= 2:
                add_line(RIVER_VI.get(name, name), int(p.get("scalerank") or 9), seg)
    if osm:
        for rel in osm:
            name = rel["tags"].get("name:vi") or rel["tags"].get("name") or ""
            ways = [[(pt["lon"], pt["lat"]) for pt in m.get("geometry", []) if pt]
                    for m in rel.get("members", []) if m["type"] == "way" and m.get("role", "") in ("", "main_stream")]
            ways = [w for w in ways if len(w) >= 2]
            km = sum(math.dist(proj(*a), proj(*b)) for w in ways for a, b in zip(w, w[1:])) / UNIT
            rank = 4 if km >= 400 else 6 if km >= 150 else 8  # drawn width follows the river's length on the map
            for wline in ways:
                add_line(name, rank, wline)
        print(f"    rivers: {len(osm)} OpenStreetMap rivers in Vietnam, Natural Earth outside")

    cover_table = [{"id": 0, "key": "none", "name": "None", "rule": "Water, neighbouring countries, or no WorldCover land pixels."}] + [
        {"id": cid, "key": key, "name": name, "color": color, "worldcover": codes, "rule": rule}
        for cid, key, name, color, codes, rule in COVER]
    tables = {"water": WATER_TABLE, "relief": RELIEF_TABLE, "cover": cover_table,
              "notes": {"water": WATER_NOTE, "relief": RELIEF_NOTE, "cover": COVER_NOTE}}
    states_out = [{"fips": f"{k + 1:02d}", "abbr": u["abbr"], "name": u["name"]} for k, u in enumerate(news)]
    counties_out = [{"geoid": u["iso"], "name": u["name"]} for u in olds]
    write_web("world.json", {
        "version": 2, "grid": grid.to_dict(), "width": round(width, 1), "height": round(height, 1), "margin": MARGIN,
        "km_per_unit": round(1 / UNIT, 4), "remote": sorted(islands),
        "owner": owner, "county": county, "elev": elev, "elev_max": elev_max, "water": water, "relief": relief,
        "cover": cover, "pct": pct, "tables": tables, "states": states_out, "counties": counties_out, "rivers": rivers,
    })
    save_interim("_world", {
        "grid": grid.to_dict(), "projection": proj.to_dict(), "owner": owner, "county": county,
        "county_samples": county_samples, "states": [u["abbr"] for u in news], "counties": [u["iso"] for u in olds],
        "old_new": old_new, "water": water, "cover": cover, "pct": pct, "elev": elev, "islands": islands,
    })
