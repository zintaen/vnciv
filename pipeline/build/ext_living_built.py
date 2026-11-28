"""Living map: built-up surface per hex for each observed GHSL epoch 1975–2020 → web/data/living_built.json."""
from __future__ import annotations

import numpy as np

from ..fetch import RAW
from ..sources_living_built import EPOCHS, TILES, tile_file
from ..store import write_web
from .common import World
from .ext_env import HEX_AREA_KM2, cells_of

THRESHOLD = 0.05  # GHSL counts roof area only (no roads, yards): 5% ≈ 3.25 km² of buildings in a 65 km² hex, a town-sized
# footprint; 10% leaves only 4 hexes in 1975 and 93 in 2020 (just the big-city cores)
KEEP = 0.02  # hexes listed: at least 2% built-up in 2020
RULE = (f"For each Vietnamese land hex and each observed GHS-BUILT-S R2023A epoch ({EPOCHS[0]}–{EPOCHS[-1]}, every "
        "5 years): the sum of the built-up surface (m²) of the 1 km Mollweide pixels whose centre falls in the hex, "
        f"divided by the hex area ({HEX_AREA_KM2:.2f} km²), rounded to a whole percent. Listed: hexes with at least "
        f"{KEEP:.0%} in {EPOCHS[-1]}. A hex is built-up from the first epoch whose share reaches {THRESHOLD:.0%} "
        "(\"first\", -1 if never); built-up surface is roof area only, so 5% of a hex is already a town-sized footprint.")
NOTE = ("1 km product: built-up surface (building footprint area), not population or city limits. Epochs every 5 "
        "years; nothing is interpolated between them. The release's 2025 and 2030 layers are model projections and "
        "are not used. Shares are of the whole hex, so coastal hexes read lower. A hex counts from the first observed "
        "epoch it crosses the threshold. The 1975 layer rests on coarser Landsat MSS imagery than the later ones; small dips between epochs are the "
        "product's own.")


def build():
    import rasterio
    from rasterio.warp import transform as warp
    W = World()
    n = len(W.owner)
    built = np.zeros((len(EPOCHS), n))
    for k, e in enumerate(EPOCHS):
        for t in TILES:
            name = tile_file(e, t)
            with rasterio.open(f"/vsizip/{RAW / 'ghsl_built' / name}/{name[:-4]}.tif") as src:
                a, tr, crs, nod = src.read(1), src.transform, src.crs, src.nodata
            rr, cc = np.nonzero((a > 0) & (a != nod))
            x, y = tr * (cc + 0.5, rr + 0.5)
            lon, lat = warp(crs, "EPSG:4326", x, y)
            cell = cells_of(W, np.asarray(lon), np.asarray(lat))
            ok = cell >= 0
            built[k] += np.bincount(cell[ok], a[rr, cc][ok].astype(float), n)
    land = np.asarray(W.owner) >= 0
    share = built / (HEX_AREA_KM2 * 1e6)
    share[:, ~land] = 0
    cells = np.nonzero(share[-1] >= KEEP)[0]
    over = share[:, cells] >= THRESHOLD
    first = np.where(over.any(0), over.argmax(0), -1)
    pct = np.clip(np.rint(share[:, cells] * 100), 0, 100).astype(int)
    for k, e in enumerate(EPOCHS):
        print(f"    {e}: {int((share[k] >= THRESHOLD).sum())} built-up hexes, {int(((first >= 0) & (first <= k)).sum())} by first")
    write_web("living_built.json", {
        "version": 1, "source": "ghsl_built", "epochs": EPOCHS, "threshold": THRESHOLD,
        "unit": "share of the hex area covered by buildings", "hex_area_km2": round(HEX_AREA_KM2, 2),
        "rule": RULE, "note": NOTE, "cells": cells.tolist(), "first": first.tolist(),
        "share": pct.T.tolist()})
