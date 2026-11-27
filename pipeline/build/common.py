"""Shared helpers for builders: the world interim, cell lookups and site snapping."""
from __future__ import annotations

import math
from collections import deque

from ..geo import UNIT, MapProjection
from ..hexgrid import HexGrid
from ..store import load_interim


class World:
    def __init__(self):
        w = load_interim("_world")
        self.raw = w
        self.grid = HexGrid(**w["grid"])
        self.proj = MapProjection(**w["projection"])
        self.owner, self.county, self.water = w["owner"], w["county"], w["water"]
        self.states, self.counties, self.old_new = w["states"], w["counties"], w["old_new"]
        self.samples = w["county_samples"]
        self.pct = w["pct"]

    def land(self, i):
        return i >= 0 and self.owner[i] >= 0

    def state_abbr(self, cell):
        return self.states[self.owner[cell]] if self.land(cell) else None

    def city_of_cell(self, cell):
        """The city id (former province ISO) whose province holds the cell."""
        k = self.county[cell] if cell is not None and cell >= 0 else -1
        return self.counties[k] if k >= 0 else None

    def county_cells(self):
        """{former-province index: [cells]} by the cell's county."""
        out = {}
        for i, k in enumerate(self.county):
            if k >= 0 and self.owner[i] >= 0:
                out.setdefault(k, []).append(i)
        return out

    def point_county(self, lon, lat):
        """Former-province index at a point by the geoBoundaries outlines (not the hex's majority), or -1."""
        if not hasattr(self, "_prov_r"):
            import json
            from ..admin import OLD
            from ..fetch import RAW
            from .world import raster
            gb = json.loads((RAW / "geoboundaries" / "geoBoundaries-VNM-ADM1.geojson").read_text())
            idx = {iso: k for k, iso in enumerate(self.counties)}
            self._prov_r = raster([(f["geometry"], idx[OLD[f["properties"]["shapeName"].strip()][0]]) for f in gb["features"]])
        from .world import look
        return look(self._prov_r, lon, lat)

    def place(self, lon, lat, rings=2):
        """(cell, former-province index) for a site: the hex is snapped to land, the province comes from the point,
        and the hex is kept in that province when one within reach is."""
        x, y = self.proj(lon, lat)
        k = self.point_county(lon, lat)
        cell = site_cell(self, x, y, rings, county=k) if k >= 0 else None
        if cell is None:
            cell = site_cell(self, x, y, rings)
            if cell is not None and k < 0:
                k = self.county[cell]
        return cell, k

    def center(self, i):
        return self.grid.center(*self.grid.col_row(i))

    def km(self, d_units):
        return d_units / UNIT


def site_cell(W: World, x, y, rings=1, county=None):
    """The Vietnamese land cell at (x, y), else the nearest one within `rings` hexes (optionally in `county`)."""
    c = W.grid.cell_at(x, y)
    ok = (lambda i: W.land(i) and (county is None or W.county[i] == county))
    if c >= 0 and ok(c):
        return c
    if c < 0:
        return None
    seen, q, best = {c}, deque([(c, 0)]), None
    while q:
        i, d = q.popleft()
        if d > rings:
            break
        if ok(i):
            cx, cy = W.center(i)
            dist = math.hypot(cx - x, cy - y)
            if best is None or dist < best[0]:
                best = (dist, i)
        for j in W.grid.neighbours(i):
            if j not in seen:
                seen.add(j)
                q.append((j, d + 1))
    return best[1] if best else None


def wkt_point(s):
    """'Point(lon lat)' → (lon, lat)."""
    a, b = s[s.index("(") + 1: s.index(")")].split()
    return float(a), float(b)
