"""Environment & climate: CHELSA climate normals, Hansen forest loss and ETOPO1 low-lying land (the Mekong delta
from Minderhoud et al. 2019's DEM), per hex.

Writes web/data/forest_loss.json (per-hex, per-year loss for a timeline), web/data/sealevel.json (per-hex share of
land at or below 0.5/1/2/3 m, for the sea-level-rise tool) and appends the "environment" lenses to lenses.json.
CHELSA and Hansen are read as windows over HTTP (GDAL /vsicurl/) and cached clipped in data/raw/<id>/.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math

import numpy as np

from ..fetch import RAW
from ..geo import HEX_KM, UNIT
from ..sources_env import CHELSA_BIO, GFC
from ..store import load_web, write_web
from .common import World
from .lenses import RAMPS, pctl

HEX_AREA_KM2 = 3 * math.sqrt(3) / 2 * HEX_KM ** 2
GROUP = {"id": "environment", "name": "Environment & climate"}
CL_BOX = (95.0, 4.5, 121.0, 26.0)  # lon0, lat0, lon1, lat1: the map window
CL_VARS = {"bio1": "bio01", "bio5": "bio05", "bio6": "bio06", "bio12": "bio12"}
GFC_TILES = {"30N_100E": (20.0, 23.5), "20N_100E": (10.0, 20.0), "10N_100E": (8.0, 10.0)}  # lat window per tile
GFC_LON = (102.0, 110.0)  # Vietnam's mainland and coastal islands (Hoàng Sa, Trường Sa lie east of 110° E)
GFC_STEP = 4  # read every 4th pixel: 0.001° (~110 m)
CANOPY_MIN = 30  # % canopy in 2000 that counts as forest (Global Forest Watch's default)
FOREST_MIN_KM2 = 2.0  # hexes with less 2000 forest get no loss share (too noisy)
YEARS = list(range(2001, 2026))
SEA_LEVELS = [0.5, 1, 2, 3]
LOW_LENS_M = 2
MIN_LAND_SAMPLES = 3
DELTA_MIN_SHARE = 0.5  # a hex takes the Mekong-delta DEM when its valid pixels cover at least half its land

RULES = {
    "climate": "Each land hex averages all CHELSA V2.1 30-arc-second (~0.9 km) pixels whose centre lies in the hex "
               "(about 70 per hex; pixels without data are skipped). Values are the stored integers times the "
               "file's scale plus its offset: °C for temperatures, mm per year for precipitation.",
    "forest_2000": f"Forest = Hansen tree canopy cover in 2000 of at least {CANOPY_MIN}% (Global Forest Watch's "
                   f"default). Pixels are read every {GFC_STEP}th row and column (~110 m) and weighted by their area "
                   "on the WGS84 sphere approximation.",
    "loss": "Loss = forest-2000 pixels with a loss year 2001–2025 (stand-replacing disturbance: clearing, fire, "
            "plantation harvest). Gross loss: regrowth and new plantations are not subtracted.",
    "loss_share": f"Share of the hex's 2000 forest lost 2001–2025; hexes with under {FOREST_MIN_KM2:g} km² of 2000 "
                  "forest have none.",
    "peak_year": "The year with the most loss in the hex (earliest on ties); none when there is no loss.",
    "provinces": "Province totals count each pixel in the province whose official province outline (OCHA COD-AB) "
                 "holds it, so they don't depend on hex borders.",
    "sea_level": "For each land hex: the share of its ETOPO1 samples (1 arc-minute, ~1.8 km) inside Vietnam's "
                 "outline whose elevation is at or below each level. ETOPO1 heights are whole metres, so 0.5 m "
                 f"means samples at or below 0 m. Hexes with fewer than {MIN_LAND_SAMPLES} such samples and the "
                 "far-offshore islands have none. In the Mekong delta (delta_cells), a hex whose valid pixels of the "
                 "Minderhoud et al. (2019) delta DEM (500 m, metres above the Hòn Dấu datum, rivers and bedrock "
                 f"outcrops cut out) cover at least {DELTA_MIN_SHARE:.0%} of its land takes the share of those pixels "
                 "at or below each level instead.",
}
SEA_NOTE = ("Coarse elevation (ETOPO1, ~1.8 km), no dykes, tides or storm surge: an exposure indicator, not a "
            "forecast. Global elevation models can misjudge the height of low deltas: Minderhoud et al. (2019, Nature "
            "Communications 10:3847) find the Mekong delta's mean elevation is about 0.8 m above sea level, not the "
            "about 2.6 m assumed earlier, so the map uses their delta DEM there.")


# --- remote windows, cached -----------------------------------------------------------------------------------

def remote_window(sid, url, vsi, name, bounds, step=1):
    """Read bounds (lon0, lat0, lon1, lat1) of a raster (every `step`th pixel), cache it as a GeoTIFF in
    data/raw/<sid>/<name> with a manifest entry, return the path. vsi=None downloads the whole file first (deleted
    after clipping): /vsicurl/ strip-by-strip reads of the 40000-row Hansen tiles are far slower than one download."""
    import rasterio
    from rasterio.windows import from_bounds
    from affine import Affine
    d = RAW / sid
    d.mkdir(parents=True, exist_ok=True)
    path = d / name
    man_path = d / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    if path.exists() and name in man:
        return path
    print(f"  ↓ window {bounds} of {url}")
    full = None
    if vsi is None:
        import shutil
        import urllib.request
        from ..fetch import UA
        full = d / f".full_{name}"
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r, open(full, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
        vsi = str(full)
    env = dict(GDAL_HTTP_USERAGENT="vnciv-pipeline/0.1 (+static map project)", GDAL_HTTP_MULTIRANGE="PARALLEL",
               GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="60", GDAL_HTTP_CONNECTTIMEOUT="30",
               GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="5")
    with rasterio.Env(**env), rasterio.open(vsi) as src:
        win = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
        h, w = int(win.height) // step, int(win.width) // step
        a = src.read(1, window=win, out_shape=(h, w))
        tr = src.window_transform(win) * Affine.scale(win.width / w, win.height / h)
        prof = dict(driver="GTiff", width=w, height=h, count=1, dtype=a.dtype, crs=src.crs, transform=tr,
                    nodata=src.nodata, compress="deflate", tiled=True)
        scale, offset = src.scales, src.offsets
    tmp = path.with_suffix(".part.tif")
    with rasterio.open(tmp, "w", **prof) as out:
        out.write(a, 1)
        out.scales, out.offsets = scale, offset  # CHELSA stores K×10 etc.: keep the unpacking in the clip
    tmp.replace(path)
    if full:
        full.unlink()
    data = path.read_bytes()
    man[name] = {"url": url, "retrieved": dt.date.today().isoformat(), "sha256": hashlib.sha256(data).hexdigest(),
                 "bytes": len(data), "note": f"window lon {bounds[0]}–{bounds[2]}, lat {bounds[1]}–{bounds[3]}"
                 + (f", every {step}th pixel" if step > 1 else "")}
    man_path.write_text(json.dumps(man, indent=1, ensure_ascii=False))
    return path


# --- vectorised lon/lat → hex cell (mirrors geo.MapProjection and hexgrid.HexGrid.cell_at) ---------------------

def cells_of(W, lon, lat):
    a, p = W.proj._albers, W.proj
    rho = 6371.0088 * np.sqrt(a.c - 2 * a.n * np.sin(np.radians(lat))) / a.n
    th = a.n * (np.radians(lon) - a.lon0)
    x = (rho * np.sin(th) - p.min_x) * UNIT + p.margin
    y = (p.max_y - (a.rho0 - rho * np.cos(th))) * UNIT + p.margin
    g = W.grid
    q = (math.sqrt(3) / 3 * x - y / 3) / g.radius
    r = (2 / 3 * y) / g.radius
    s = -q - r
    rx, ry, rz = np.floor(q + 0.5), np.floor(s + 0.5), np.floor(r + 0.5)
    dx, dy, dz = np.abs(rx - q), np.abs(ry - s), np.abs(rz - r)
    m1 = (dx > dy) & (dx > dz)
    m2 = ~m1 & (dy <= dz)
    rx = np.where(m1, -ry - rz, rx)
    rz = np.where(m2, -rx - ry, rz)
    row = rz.astype(np.int64)
    col = rx.astype(np.int64) + (row - (row & 1)) // 2
    ok = (col >= 0) & (row >= 0) & (col < g.cols) & (row < g.rows)
    return np.where(ok, row * g.cols + col, -1)


def provinces_of(W, lon, lat):
    """2025-province index (owner index) of each point by the official province outline (OCHA COD-AB), -1 outside."""
    from .world import LAT1, LON0, NCOL, NROW, RES, province_rasters
    if not hasattr(W, "_new_r"):
        W._new_r = province_rasters()[0]
    i = ((LAT1 - lat) / RES).astype(np.int64)
    j = ((lon - LON0) / RES).astype(np.int64)
    ok = (i >= 0) & (i < NROW) & (j >= 0) & (j < NCOL)
    return np.where(ok, W._new_r[np.clip(i, 0, NROW - 1), np.clip(j, 0, NCOL - 1)].astype(np.int64), -1)


# --- climate ----------------------------------------------------------------------------------------------------

def climate(W, land):
    """Per land hex: mean of the CHELSA pixels whose centre falls in the hex (RULES["climate"])."""
    import rasterio
    out = {}
    for key, var in CL_VARS.items():
        url = CHELSA_BIO.format(var=var)
        path = remote_window("chelsa", url, f"/vsicurl/{url}", f"CHELSA_{var}_1981-2010_V.2.1_vn.tif", CL_BOX)
        with rasterio.open(path) as src:
            raw = src.read(1)
            a = raw.astype(float) * src.scales[0] + src.offsets[0]
            a[raw == src.nodata] = np.nan
            rows, cols = np.indices(a.shape)
            lon, lat = rasterio.transform.xy(src.transform, rows.ravel(), cols.ravel())
        cell, v = cells_of(W, np.asarray(lon), np.asarray(lat)), a.ravel()
        ok = (cell >= 0) & np.isfinite(v)
        n = np.bincount(cell[ok], minlength=len(W.owner))
        tot = np.bincount(cell[ok], weights=v[ok], minlength=len(W.owner))
        with np.errstate(invalid="ignore"):
            out[key] = (tot / n)[np.asarray(land)]  # 0/0 = NaN: hexes without data
    return out


# --- forest -----------------------------------------------------------------------------------------------------

def forest(W):
    import rasterio
    ncell, nprov, ny = len(W.owner), len(W.states), len(YEARS) + 1
    f2000 = np.zeros(ncell)
    loss = np.zeros((ncell, ny))
    pf2000, ploss = np.zeros(nprov), np.zeros((nprov, ny))
    for tile, (la0, la1) in GFC_TILES.items():
        box = (GFC_LON[0], la0, GFC_LON[1], la1)
        paths = {}
        for layer in ("treecover2000", "lossyear"):
            url = GFC.format(layer=layer, tile=tile)
            paths[layer] = remote_window("hansen_gfc", url, None, f"{layer}_{tile}_vn.tif", box, GFC_STEP)
        with rasterio.open(paths["treecover2000"]) as a, rasterio.open(paths["lossyear"]) as b:
            tc, ly, tr = a.read(1), b.read(1), a.transform
        assert tc.shape == ly.shape and ly.max() <= len(YEARS), (tile, tc.shape, ly.shape, ly.max())
        for r0 in range(0, tc.shape[0], 500):  # row chunks keep memory small
            rr, cc = np.nonzero(tc[r0:r0 + 500] >= CANOPY_MIN)
            rr = rr + r0
            lon = tr.c + (cc + 0.5) * tr.a
            lat = tr.f + (rr + 0.5) * tr.e
            area = (abs(tr.a) * 111.320 * np.cos(np.radians(lat))) * (abs(tr.e) * 110.574)  # km²
            yr = ly[rr, cc].astype(np.int64)
            cell = cells_of(W, lon, lat)
            ok = cell >= 0
            f2000 += np.bincount(cell[ok], area[ok], ncell)
            loss += np.bincount(cell[ok] * ny + yr[ok], area[ok], ncell * ny).reshape(ncell, ny)
            pv = provinces_of(W, lon, lat)
            ok = pv >= 0
            pf2000 += np.bincount(pv[ok], area[ok], nprov)
            ploss += np.bincount(pv[ok] * ny + yr[ok], area[ok], nprov * ny).reshape(nprov, ny)
        print(f"    {tile}: {tc.shape[1]}×{tc.shape[0]} samples")
    return f2000, loss[:, 1:], pf2000, ploss[:, 1:]


# --- sea level ----------------------------------------------------------------------------------------------------

def delta_land(W):
    """{cell: n Mekong-delta DEM pixels inside Vietnam's outline, [n at or below each level]} (Minderhoud et al. 2019,
    500 m pixels in UTM 48N, metres above the Hòn Dấu datum; rivers and bedrock outcrops are NODATA)."""
    import zipfile
    from rasterio.warp import transform
    with zipfile.ZipFile(RAW / "mekong_dem" / "Topo_DEM_Mekong_delta.zip") as z:
        lines = z.read("Topo_DEM_Mekong_delta_excl_rivers_and_bedrock.asc").decode().splitlines()
    head = {l.split()[0].lower(): float(l.split()[1]) for l in lines[:6]}
    ncols, nrows, cs = int(head["ncols"]), int(head["nrows"]), head["cellsize"]
    z = np.array([np.fromstring(l, sep=" ") for l in lines[6:6 + nrows]])
    assert z.shape == (nrows, ncols), z.shape
    r, c = np.nonzero(z != head["nodata_value"])
    ex = head["xllcorner"] + (c + 0.5) * cs
    ny = head["yllcorner"] + (nrows - r - 0.5) * cs
    lon, lat = (np.array(v) for v in transform("EPSG:32648", "EPSG:4326", ex.tolist(), ny.tolist()))
    alt = z[r, c]
    ncell = len(W.owner)
    cell = cells_of(W, lon, lat)
    m = (cell >= 0) & (provinces_of(W, lon, lat) >= 0)
    n = np.bincount(cell[m], minlength=ncell)
    lows = [np.bincount(cell[m & (alt <= h)], minlength=ncell) for h in SEA_LEVELS]
    return n, lows, (cs / 1000) ** 2


def low_land(W):
    """{cell: (n land samples, n all samples, [n at or below each level])} from the ETOPO1 csv."""
    a = np.loadtxt(RAW / "etopo" / "etopo_vn.csv", delimiter=",", skiprows=2)
    lat, lon, alt = a[:, 0], a[:, 1], a[:, 2]
    ok = ~np.isnan(alt)
    lat, lon, alt = lat[ok], lon[ok], alt[ok]
    assert np.all(alt == np.round(alt)), "ETOPO1 heights expected in whole metres"
    ncell = len(W.owner)
    cell = cells_of(W, lon, lat)
    inside = provinces_of(W, lon, lat) >= 0
    k = cell >= 0
    n_all = np.bincount(cell[k], minlength=ncell)
    m = k & inside
    n_land = np.bincount(cell[m], minlength=ncell)
    lows = [np.bincount(cell[m & (alt <= math.floor(h))], minlength=ncell) for h in SEA_LEVELS]
    return n_land, n_all, lows


# --- build --------------------------------------------------------------------------------------------------------

def lens(lid, name, emoji, icon, unit, fmt, ramp, hi, source, year, desc, vals, note=None, domain=None):
    d = {"id": lid, "group": GROUP["id"], "name": name, "icon": icon, "emoji": emoji, "unit": unit, "format": fmt,
         "scale": "linear", "domain": domain or pctl([v for v in vals if v is not None]), "ramp": RAMPS[ramp],
         "higher_is": hi, "source": source, "year": year, "description": desc, "values": vals}
    if note:
        d["note"] = note
    return d


def build():
    W = World()
    ncell = len(W.owner)
    land = [i for i in range(ncell) if W.owner[i] >= 0]
    remote = set(load_web("world.json")["remote"])
    lo, la = np.random.default_rng(0).uniform([102, 8], [110, 23.5], (2000, 2)).T  # the vector lookup = the scalar one
    assert list(cells_of(W, lo, la)) == [W.grid.cell_at(*W.proj(a, b)) for a, b in zip(lo, la)]
    rnd = lambda x, d: None if x is None or not np.isfinite(x) else (round(float(x), d) if d else int(round(float(x))))

    # climate
    cl = climate(W, land)
    cv = {k: [None] * ncell for k in cl}
    for k, arr in cl.items():
        for j, i in enumerate(land):
            cv[k][i] = rnd(arr[j], 0 if k == "bio12" else 1)
    cov = sum(v is not None for v in cv["bio12"]) / len(land)
    print(f"    climate: {cov:.1%} of land hexes have CHELSA values")

    # forest
    f2000, loss, pf2000, ploss = forest(W)
    share, peak = [None] * ncell, [None] * ncell
    fcells = [i for i in land if f2000[i] >= FOREST_MIN_KM2]
    for i in fcells:
        tot = loss[i].sum()
        share[i] = round(float(tot / f2000[i]), 4)
        peak[i] = YEARS[int(np.argmax(loss[i]))] if tot > 0 else None
    provs = []
    for k, s in enumerate(W.states):
        provs.append({"abbr": s, "forest2000_ha": int(round(pf2000[k] * 100)),
                      "loss_ha": [int(round(v * 100)) for v in ploss[k]],
                      "share": round(float(ploss[k].sum() / pf2000[k]), 4) if pf2000[k] else None})
    write_web("forest_loss.json", {
        "version": 1, "source": "hansen_gfc", "years": YEARS, "canopy_min": CANOPY_MIN, "unit": "ha",
        "rules": {k: RULES[k] for k in ("forest_2000", "loss", "loss_share", "peak_year", "provinces")},
        "note": "A relative indicator of trends, not an official statistic: the producers warn that Landsat sensors "
                "and the method changed over time (year-to-year steps can be artefacts) and that pixel counts are not "
                "definitive area estimates. Much loss in Vietnam is the harvest of plantations (acacia, rubber) that "
                "are replanted.",
        "cells": fcells,
        "forest2000_ha": [int(round(f2000[i] * 100)) for i in fcells],
        "peak_year": [peak[i] for i in fcells],
        "loss_ha": [[int(round(loss[i, y] * 100)) for i in fcells] for y in range(len(YEARS))],  # [year][cell]
        "provinces": provs,
        "national": {"forest2000_ha": int(round(pf2000.sum() * 100)),
                     "loss_ha": [int(round(v * 100)) for v in ploss.sum(0)]},
    })

    # sea level
    n_land, n_all, lows = low_land(W)
    d_n, d_lows, px_km2 = delta_land(W)
    scells, sh, lf, dcells = [], [[] for _ in SEA_LEVELS], [], []
    low2 = [None] * ncell
    for i in land:
        if i in remote or n_land[i] < MIN_LAND_SAMPLES:
            continue
        land_km2 = HEX_AREA_KM2 * n_land[i] / max(n_all[i], 1)
        if d_n[i] * px_km2 >= DELTA_MIN_SHARE * land_km2:  # Mekong delta: the delta DEM's pixels
            n, lw = d_n[i], [x[i] for x in d_lows]
            dcells.append(i)
        else:
            n, lw = n_land[i], [x[i] for x in lows]
        low2[i] = round(lw[SEA_LEVELS.index(LOW_LENS_M)] / n, 3)
        if lw[-1] == 0:
            continue
        scells.append(i)
        lf.append(round(100 * n_land[i] / max(n_all[i], 1)))
        for k in range(len(SEA_LEVELS)):
            sh[k].append(round(100 * lw[k] / n))
    print(f"    sea level: {len(dcells)} Mekong-delta hexes from the delta DEM, the rest ETOPO1")
    write_web("sealevel.json", {"version": 1, "source": "etopo", "delta_source": "mekong_dem", "delta_cells": dcells, "levels": SEA_LEVELS, "unit": "% of the hex's land",
                                "hex_area_km2": round(HEX_AREA_KM2, 2), "rule": RULES["sea_level"], "note": SEA_NOTE,
                                "cells": scells, "land_pct": lf, "share": sh})

    # lenses
    CL = ("CHELSA V2.1, averages of 1981–2010 downscaled from the ERA5 reanalysis with terrain (30 arc-second "
          "pixels, ~0.9 km, averaged per hex). Karger et al. 2017, Scientific Data 4: 170122; CC0 1.0.")
    new = [
        lens("rainfall", "Rainfall", "🌧️", "l-rain", "mm per year", "int", "bachelors", "neutral", "chelsa",
             "1981–2010", "Average annual precipitation (CHELSA BIO12). " + CL, cv["bio12"],
             note="Climate normals of 1981–2010, not recent years."),
        lens("temperature", "Temperature", "🌡️", "l-thermo", "°C", "float", "uninsured", "neutral", "chelsa",
             "1981–2010", "Mean annual air temperature (CHELSA BIO1). " + CL, cv["bio1"],
             note="Climate normals of 1981–2010; Vietnam has warmed since."),
        lens("hot_month", "Hottest-month highs", "☀️", "l-sun", "°C", "float", "poverty", "neutral", "chelsa",
             "1981–2010", "Average daily maximum temperature of the warmest month (CHELSA BIO5). " + CL, cv["bio5"]),
        lens("cold_month", "Coldest-month lows", "❄️", "l-snow", "°C", "float", "bachelors", "neutral", "chelsa",
             "1981–2010", "Average daily minimum temperature of the coldest month (CHELSA BIO6). " + CL, cv["bio6"]),
        lens("forest_loss", "Forest loss since 2001", "🪓", "l-forest", "share of the 2000 forest lost", "pct",
             "poverty", "bad", "hansen_gfc", "2001–2025",
             f"Share of the hex's year-2000 forest (tree canopy ≥ {CANOPY_MIN}%) with stand-replacing loss in "
             f"2001–2025 (Hansen Global Forest Change v1.13, Landsat). Hexes with under {FOREST_MIN_KM2:g} km² of "
             "forest in 2000 are blank.", share, domain=[0, pctl([v for v in share if v is not None])[1]],
             note="Gross loss, including plantation harvests that are replanted; regrowth is not counted."),
        lens("low_lying", "Low-lying land (≤ 2 m)", "🌊", "l-wave", "share of land at or below 2 m", "pct",
             "foreign_born", "bad", "etopo", None,
             "Share of the hex's land samples (ETOPO1, 1 arc-minute, ~1.8 km) at or below 2 m above sea level; in the "
             "Mekong delta, the share of the delta DEM's 500 m pixels (Minderhoud et al. 2019, Hòn Dấu datum).",
             low2, domain=[0, 1],
             note="An exposure indicator, not a flood model: no dykes, tides or drainage. Global elevation models can "
                  "misjudge the height of low deltas: Minderhoud et al. (2019, Nature Communications 10:3847) find the "
                  "Mekong delta's mean elevation is about 0.8 m above sea level, not the about 2.6 m assumed earlier; "
                  "the map uses their delta DEM there."),
    ]
    for l in new:
        if l["year"] is None:
            del l["year"]
    lf_ = load_web("lenses.json")
    ids = {l["id"] for l in new}
    lf_["lenses"] = [l for l in lf_["lenses"] if l["id"] not in ids] + new  # re-runs replace our own lenses only
    if GROUP["id"] not in {g["id"] for g in lf_["groups"]}:
        lf_["groups"].append(GROUP)
    write_web("lenses.json", lf_)
    nf = sum(v is not None for v in share)
    print(f"    forest: {nf} hexes with ≥ {FOREST_MIN_KM2:g} km² of 2000 forest; national loss "
          f"{ploss.sum() / pf2000.sum():.1%}; sea level: {len(scells)} hexes with land ≤ {SEA_LEVELS[-1]} m")
