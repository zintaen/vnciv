"""communes.json: the 3,321 communes, wards and special zones (xã, phường, đặc khu) of the two-tier local government
from 1 July 2025: names, kinds, province, label point, area and simplified boundaries in map units.

Boundaries are stored once per shared border (TopoJSON-style arcs) so neighbouring communes never draw a line twice.
Also checks the file against the officially announced counts and the 34 province outlines against the map's unions
of the 63 former provinces (pipeline/admin.py), and publishes both checks in the file."""
from __future__ import annotations

import html
import io
import json
import math
import re
import struct
import unicodedata
import zipfile

import numpy as np
from rasterio import features
from rasterio.enums import MergeAlg
from rasterio.transform import from_origin

from ..admin import fold, new_units
from ..fetch import RAW
from ..geo import UNIT, ring_contains
from ..store import write_web
from .common import World
from .world import LAT1, LON0, RES

KINDS = ["Xã", "Phường", "Đặc khu"]  # index stored per commune (k)
QV = 100_000          # topology grid: vertices snapped to 1e-5° (~1 m) before shared borders are matched
TOL = 0.6             # Douglas–Peucker tolerance, map units (0.12 km)
Q = 2                 # stored coordinates are integers of map units × Q (0.1 km steps)
COUNT_NOTE = ("The file is newer than the June 2025 list: 10 Đồng Nai communes became wards (Resolution "
              "237/NQ-UBTVQH16, from 30 April 2026) and 12 Bắc Ninh communes became wards (Resolution 388/NQ-UBTVQH16, "
              "September 2026). The number of units, 3,321, is unchanged.")
RULES = {
    "source": "Vietnamese Provinces Database v5.2.0 (wards GIS from the official reference map sapnhap.bando.com.vn, "
              "codes and names from the NSO/GSO list), as updated to Resolution 388/NQ-UBTVQH16 of September 2026.",
    "province": "Each commune's province is the one its official code belongs to, matched to the map's 34 provinces "
                "by name.",
    "geometry": f"Vertices snapped to 1e-5°; borders split where the neighbours change and kept once (arcs); each arc "
                f"simplified (Douglas–Peucker, {TOL * 0.2:.2f} km) with its ends fixed, so shared borders stay shared. "
                f"Coordinates are map units × {Q}, delta-encoded.",
    "area": "Computed from the full-resolution outline in the map's equal-area (Albers) projection.",
    "label": "Centroid of the commune's largest part; if that falls outside it, the middle of the widest span "
             "through the part at the centroid's latitude.",
}


# --- reading --------------------------------------------------------------------------------------------------

def load_units():
    """[{code, name, kind, prov, src_area, polys: [[ring of (lon, lat)]]}] and {province code: name}."""
    meta = json.loads((RAW / "vn_wards_gis" / "full_json_generated_data_vn_units.json").read_text())
    provs = {p["Code"]: p["Name"] for p in meta}
    info = {w["Code"]: w for p in meta for w in p["Wards"]}
    out = []
    with zipfile.ZipFile(RAW / "vn_wards_gis" / "vn_provinces_wards_geojson.zip") as z:
        for n in sorted(x for x in z.namelist() if "/wards/" in x and x.endswith(".geojson")):
            f, = json.loads(z.read(n))["features"]
            p, g = f["properties"], f["geometry"]
            w = info[p["code"]]
            polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            out.append({"code": p["code"], "name": w["Name"], "kind": KINDS.index(w["AdministrativeUnitShortName"]),
                        "prov": w["ProvinceCode"], "src_area": p.get("areaKm2"), "polys": polys})
    return out, provs


def province_geojsons():
    """{province code: geometry} of the 34 provinces in the same file."""
    out = {}
    with zipfile.ZipFile(RAW / "vn_wards_gis" / "vn_provinces_wards_geojson.zip") as z:
        for n in z.namelist():
            if n.endswith(".geojson") and "/wards/" not in n and n.count("/") == 2:
                f, = json.loads(z.read(n))["features"]
                out[f["properties"]["code"]] = (f["properties"]["name"], f["geometry"])
    return out


def read_shp_polygons(shp: bytes, dbf: bytes, name_field: str):
    """Minimal ESRI shapefile reader (polygon type 5): [(name, [rings])]. Records and names in file order."""
    rings_all, pos = [], 100
    while pos < len(shp):
        _, length = struct.unpack(">ii", shp[pos:pos + 8])
        rec = shp[pos + 8: pos + 8 + length * 2]
        pos += 8 + length * 2
        if struct.unpack("<i", rec[:4])[0] != 5:
            rings_all.append([])
            continue
        nparts, npts = struct.unpack("<ii", rec[36:44])
        parts = list(struct.unpack(f"<{nparts}i", rec[44:44 + 4 * nparts])) + [npts]
        pts = np.frombuffer(rec[44 + 4 * nparts: 44 + 4 * nparts + 16 * npts], dtype="<f8").reshape(-1, 2)
        rings_all.append([pts[parts[i]:parts[i + 1]].tolist() for i in range(nparts)])
    nrec, hlen, rlen = struct.unpack("<IHH", dbf[4:12])
    fields, off = [], 32
    while dbf[off] != 0x0D:
        fields.append((dbf[off:off + 11].split(b"\0")[0].decode(), dbf[off + 16]))
        off += 32
    k = [f for f, _ in fields].index(name_field)
    start = 1 + sum(w for _, w in fields[:k])
    names = [dbf[hlen + i * rlen + start: hlen + i * rlen + start + fields[k][1]].decode("utf-8").strip()
             for i in range(nrec)]
    return list(zip(names, rings_all))


# --- geometry -------------------------------------------------------------------------------------------------

def ring_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        a += x0 * y1 - x1 * y0
    return a / 2


def label_point(ring):
    """Centroid of a ring (map units); the middle of the widest span at its y when the centroid is outside."""
    a = ring_area(ring)
    if abs(a) < 1e-9:
        return ring[0]
    cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        c = x0 * y1 - x1 * y0
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    cx, cy = cx / (6 * a), cy / (6 * a)
    if ring_contains(ring, cx, cy):
        return cx, cy
    xs = sorted((x0 + (cy - y0) * (x1 - x0) / (y1 - y0)) for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1])
                if (y0 > cy) != (y1 > cy))
    spans = [(xs[i + 1] - xs[i], (xs[i] + xs[i + 1]) / 2) for i in range(0, len(xs) - 1, 2)]
    return (max(spans)[1], cy) if spans else ring[0]


def dp(pts, tol):
    """Douglas–Peucker on an (n, 2) array; ends kept. Returns kept indices."""
    n = len(pts)
    if n < 3:
        return list(range(n))
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        a, b = pts[i], pts[j]
        seg = pts[i + 1:j] - a
        d = b - a
        L = math.hypot(*d)
        dist = np.abs(seg[:, 0] * d[1] - seg[:, 1] * d[0]) / L if L > 0 else np.hypot(seg[:, 0], seg[:, 1])
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return list(np.nonzero(keep)[0])


def build_topology(units):
    """Snap rings to the QV grid, find junctions (vertices whose neighbours differ between rings), cut rings into
    arcs there and keep each arc once. Returns (arcs as lists of vertex ids, per unit: [[signed arc refs] per ring])."""
    rings = []  # (unit index, cyclic list of vertex ints)
    for ui, u in enumerate(units):
        for poly in u["polys"]:
            for ring in poly:
                vs = []
                for lon, lat, *_ in ring:
                    v = round(lon * QV) * 10_000_000 + round(lat * QV)
                    if not vs or vs[-1] != v:
                        vs.append(v)
                if len(vs) > 1 and vs[0] == vs[-1]:
                    vs.pop()
                if len(vs) >= 3:
                    rings.append((ui, vs))
    a = np.concatenate([np.array(vs, np.int64) for _, vs in rings])
    b = np.concatenate([np.roll(np.array(vs, np.int64), -1) for _, vs in rings])
    c = np.concatenate([np.roll(np.array(vs, np.int64), 1) for _, vs in rings])
    pairs = np.unique(np.stack([np.concatenate([a, a]), np.concatenate([b, c])], 1), axis=0)
    verts, counts = np.unique(pairs[:, 0], return_counts=True)
    junction = set(verts[counts > 2].tolist())

    arcs, index = [], {}

    def ref(seq):
        key = tuple(seq)
        if key in index:
            return index[key]
        rk = key[::-1]
        if rk in index:
            return ~index[rk]
        index[key] = len(arcs)
        arcs.append(seq)
        return len(arcs) - 1

    out = [[] for _ in units]
    for ui, vs in rings:
        js = [i for i, v in enumerate(vs) if v in junction]
        if not js:  # a ring with no junction: one closed arc, rotated to start at its smallest vertex
            k = vs.index(min(vs))
            seq = vs[k:] + vs[:k]
            fwd = seq + [seq[0]]
            rev = [seq[0]] + seq[:0:-1] + [seq[0]]
            r = index.get(tuple(fwd))
            if r is None and tuple(rev) in index:
                r = ~index[tuple(rev)]
            out[ui].append([r if r is not None else ref(fwd)])
            continue
        seq = vs[js[0]:] + vs[:js[0]] + [vs[js[0]]]
        cut = [i - js[0] for i in js] + [len(vs)]
        out[ui].append([ref(seq[cut[i]:cut[i + 1] + 1]) for i in range(len(cut) - 1)])
    return arcs, out


# --- checks ---------------------------------------------------------------------------------------------------

def official_counts():
    """{folded province name: (total, {kind index: n})} parsed from the VTC News article (June 2025)."""
    t = (RAW / "vtc_communes_2025" / "vtc_3321.html").read_text(encoding="utf-8")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S | re.I)
    t = re.sub(r"\s+", " ", unicodedata.normalize("NFC", html.unescape(re.sub(r"<[^>]+>", " ", t))))
    out = {}
    for m in re.finditer(r"(?:[Tt]ỉnh|TP\.?) ?([^\d,;.]+?) có (\d+) đơn vị hành chính cấp xã,? gồm ([^;.]+)", t):
        name = {"HCM": "Hồ Chí Minh"}.get(m.group(1).strip(), m.group(1).strip())
        kinds = {KINDS.index(k.capitalize()) if k != "đặc khu" else 2: int(n)
                 for n, k in re.findall(r"(\d+) (xã|phường|đặc khu)", m.group(3))}
        assert sum(kinds.values()) == int(m.group(2)), m.group(0)
        out[fold(name)] = (int(m.group(2)), kinds)
    tot = re.search(r"cả nước còn ([\d.]+) đơn vị hành chính cấp xã \(gồm ([\d.]+) xã, ([\d.]+) phường và ([\d.]+) đặc khu",
                    t)
    national = [int(x.replace(".", "")) for x in tot.groups()] if tot else None
    return out, national


def window_raster(shapes, bbox):
    """Even–odd raster of rings (list of [(lon, lat)]) on the lookup grid, restricted to bbox (lon0, lat0, lon1, lat1)."""
    c0, r0 = int((bbox[0] - LON0) / RES) - 1, int((LAT1 - bbox[3]) / RES) - 1
    c1, r1 = int((bbox[2] - LON0) / RES) + 2, int((LAT1 - bbox[1]) / RES) + 2
    tr = from_origin(LON0 + c0 * RES, LAT1 - r0 * RES, RES, RES)
    shp = [({"type": "Polygon", "coordinates": [r]}, 1) for r in shapes if len(r) >= 4]
    a = features.rasterize(shp, out_shape=(r1 - r0, c1 - c0), transform=tr, fill=0, dtype="int16",
                           merge_alg=MergeAlg.add) if shp else np.zeros((r1 - r0, c1 - c0), "int16")
    return a % 2 == 1, (r0, r1, c0, c1)


def outline_check(W, outlines, label):
    """IoU of each 2025 province outline (other file) with the map's union of former provinces, on the 0.005° grid."""
    W.point_county(106, 16)  # builds W._prov_r
    new_r = np.where(W._prov_r > 0, np.array(W.old_new + [0])[np.maximum(W._prov_r - 1, 0)], -1)
    rows = []
    for abbr, rings in outlines:
        lons = [p[0] for r in rings for p in r]
        lats = [p[1] for r in rings for p in r]
        theirs, (r0, r1, c0, c1) = window_raster(rings, (min(lons), min(lats), max(lons), max(lats)))
        r0c, c0c = max(r0, 0), max(c0, 0)
        theirs = theirs[r0c - r0:, c0c - c0:]
        ours = new_r[r0c:r1, c0c:c1] == W.states.index(abbr)
        theirs = theirs[:ours.shape[0], :ours.shape[1]]
        inter, union = int((ours & theirs).sum()), int((ours | theirs).sum())
        rows.append({"abbr": abbr, "iou": round(inter / union, 4) if union else None})
    rows.sort(key=lambda r: r["iou"] or 0)
    print(f"    outlines vs {label}: lowest IoU " + ", ".join(f"{r['abbr']} {r['iou']}" for r in rows[:5]))
    return rows


# --- build ----------------------------------------------------------------------------------------------------

def build():
    W = World()
    units, provs = load_units()
    abbr_of_name = {fold(u["name"]).replace("tp. ", ""): u["abbr"] for u in new_units()}
    prov_abbr = {c: abbr_of_name[fold(n).replace("tp. ", "").replace("thanh pho ", "")] for c, n in provs.items()}

    arcs, refs = build_topology(units)
    print(f"    {len(units)} units, {len(arcs)} arcs, {sum(len(a) for a in arcs):,} arc vertices")

    # project once per vertex, simplify each arc, quantize, delta-encode
    def xy(v):
        return W.proj(v // 10_000_000 / QV, v % 10_000_000 / QV)

    enc, n_out = [], 0
    for arc in arcs:
        pts = np.array([xy(v) for v in arc])
        keep = dp(pts, TOL)
        if arc[0] == arc[-1] and len(keep) < 4:  # keep small closed rings (islets) as at least a triangle
            far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
            mid = max(1, far // 2)
            keep = sorted({0, mid, far, len(pts) - 1} if far > 1 else set(range(len(pts))))
        q = [(round(pts[i][0] * Q), round(pts[i][1] * Q)) for i in keep]
        q = [p for k, p in enumerate(q) if k == 0 or p != q[k - 1]] or q[:1]
        if len(q) == 1:
            q = q * 2
        flat = [q[0][0], q[0][1]]
        for (x0, y0), (x1, y1) in zip(q, q[1:]):
            flat += [x1 - x0, y1 - y0]
        enc.append(flat)
        n_out += len(q)

    official, national = official_counts()
    communes, by_prov = [], {}
    for u, r in zip(units, refs):
        parts = []
        for poly in u["polys"]:
            pr = [[W.proj(lon, lat) for lon, lat, *_ in ring] for ring in poly]
            parts.append((abs(ring_area(pr[0])) - sum(abs(ring_area(h)) for h in pr[1:]), pr[0]))
        area = sum(a for a, _ in parts) / UNIT / UNIT
        lx, ly = label_point(max(parts, key=lambda p: p[0])[1])
        abbr = prov_abbr[u["prov"]]
        communes.append({"id": u["code"], "n": u["name"], "k": u["kind"], "p": abbr, "x": round(lx, 1), "y": round(ly, 1),
                         "a": round(area, 2), "r": r})
        by_prov.setdefault(abbr, [0, 0, 0])[u["kind"]] += 1

    # counts against the June 2025 announcement
    counts, diffs = {}, []
    for c, name in provs.items():
        abbr = prov_abbr[c]
        have = by_prov.get(abbr, [0, 0, 0])
        off = official.get(fold(name).replace("thanh pho ", ""))
        if off is None:
            off = next((v for k2, v in official.items() if abbr_of_name.get(k2) == abbr), None)
        want = [off[1].get(i, 0) for i in range(3)] if off else None
        counts[abbr] = {"communes": have[0], "wards": have[1], "special": have[2], "total": sum(have),
                        "official_2025": ({"communes": want[0], "wards": want[1], "special": want[2], "total": off[0]}
                                          if off else None)}
        if not off or off[0] != sum(have) or want != have:
            diffs.append(f"{abbr}: file {have} vs 2025 {want}")
    if diffs:
        print("    ! counts differing from the June 2025 announcement (communes, wards, special zones): " + "; ".join(diffs))

    # province outlines: this file's 34 and HDX COD-AB's 34 vs the map's unions
    pg = province_geojsons()
    vpd = [(prov_abbr[c], [r for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]])
                           for r in poly]) for c, (_, g) in pg.items()]
    with zipfile.ZipFile(RAW / "hdx_cod_ab_vnm" / "vnm_admin_boundaries.shp.zip") as z:
        hdx = read_shp_polygons(z.read("vnm_admin1.shp"), z.read("vnm_admin1.dbf"), "adm1_name1")
    hdx = [(abbr_of_name[fold(n).replace("thanh pho ", "").replace("tp. ", "")], rings) for n, rings in hdx]
    outlines = {"method": "Intersection over union of each 2025 province, rasterised on a 0.005° (~0.55 km) grid, "
                          "with the map's province lookup raster (OCHA COD-AB 2025 outlines).",
                "vn_wards_gis": outline_check(W, vpd, "Vietnamese Provinces Database"),
                "hdx_cod_ab_vnm": outline_check(W, hdx, "HDX COD-AB")}

    total = len(communes)
    write_web("communes.json", {
        "version": 1, "year": 2025, "sources": ["vn_wards_gis", "vtc_communes_2025", "hdx_cod_ab_vnm"],
        "vintage": "Units of 1 July 2025 as updated to Resolution 388/NQ-UBTVQH16 (20 September 2026)",
        "rules": RULES, "kinds": KINDS, "q": Q, "unit_km": 1 / UNIT,
        "count": total, "official_2025": dict(zip(["total", "communes", "wards", "special"], national)) if national else None,
        "by_province": counts, "count_differences": diffs, "count_note": COUNT_NOTE,
        "outline_check": outlines,
        "arcs": enc, "communes": communes,
    })
    print(f"    {total} communes ({sum(c['k'] == 0 for c in communes)} xã, {sum(c['k'] == 1 for c in communes)} phường, "
          f"{sum(c['k'] == 2 for c in communes)} đặc khu), {n_out:,} stored vertices; official 2025: {national}")
