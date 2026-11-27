"""ESA WorldCover 2021 mosaic for Vietnam, read from the COG overviews (~150 m) and cached as one .npy."""
from __future__ import annotations

import datetime as dt
import json

import numpy as np

from .fetch import RAW

BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif"
LAT0, LAT1, LON0, LON1 = 6, 24, 102, 111  # tile corners (3° tiles); covers the mainland and coastal islands
PX = 1200  # pixels read per 3° tile (the overviews make this cheap): 9″ ≈ 0.28 km
RES = 3 / PX  # degrees per pixel


def mosaic() -> np.ndarray:
    """uint8 array [row from LAT1 down, col from LON0], WorldCover class codes; 0 = no data."""
    d = RAW / "worldcover"
    d.mkdir(parents=True, exist_ok=True)
    out = d / f"mosaic_{PX}.npy"
    if out.exists():
        return np.load(out)
    import rasterio
    rows, cols = (LAT1 - LAT0) // 3 * PX, (LON1 - LON0) // 3 * PX
    arr = np.zeros((rows, cols), np.uint8)
    files = {}
    for lat in range(LAT0, LAT1, 3):
        for lon in range(LON0, LON1, 3):
            name = f"N{lat:02d}E{lon:03d}"
            url = BASE.format(name)
            try:
                with rasterio.open(url) as src:
                    a = src.read(1, out_shape=(PX, PX))
            except Exception as e:  # ocean-only tiles do not exist
                print(f"    worldcover {name}: none ({type(e).__name__})")
                continue
            r0 = (LAT1 - lat - 3) // 3 * PX
            c0 = (lon - LON0) // 3 * PX
            arr[r0:r0 + PX, c0:c0 + PX] = a
            files[f"ESA_WorldCover_10m_2021_v200_{name}_Map.tif (overview)"] = {
                "url": url, "retrieved": dt.date.today().isoformat(), "sha256": None, "bytes": None,
                "note": f"read at {PX}×{PX} px from the cloud-optimised overviews"}
            print(f"    worldcover {name}: ok")
    np.save(out, arr)
    (d / "manifest.json").write_text(json.dumps(files, indent=1))
    return arr


def lookup(arr: np.ndarray, lon: float, lat: float) -> int:
    r = int((LAT1 - lat) / RES)
    c = int((lon - LON0) / RES)
    if 0 <= r < arr.shape[0] and 0 <= c < arr.shape[1]:
        return int(arr[r, c])
    return 0
