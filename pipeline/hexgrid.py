"""Pointy-top hex grid in "odd-r" offset layout (odd rows shifted right).

Cell (col, row) has its center at  x = W * (col + 0.5 * (row & 1)),  y = H * row
with W = sqrt(3) * radius and H = 1.5 * radius, in map km (y down).
web/js/hex.js mirrors this exactly — keep the two in sync.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

SQRT3 = math.sqrt(3)

# Neighbour offsets in direction order E, SE, SW, W, NW, NE (y down).
_NEIGHBOURS = (
    ((1, 0), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1)),  # even rows
    ((1, 0), (1, 1), (0, 1), (-1, 0), (0, -1), (1, -1)),  # odd rows
)


@dataclass(frozen=True)
class HexGrid:
    radius: float
    cols: int
    rows: int

    @classmethod
    def covering(cls, width: float, height: float, radius: float) -> "HexGrid":
        return cls(radius, math.ceil(width / (SQRT3 * radius)) + 1, math.ceil(height / (1.5 * radius)) + 1)

    @property
    def size(self) -> int:
        return self.cols * self.rows

    def index(self, col: int, row: int) -> int:
        return row * self.cols + col

    def col_row(self, index: int) -> tuple[int, int]:
        return index % self.cols, index // self.cols

    def center(self, col: int, row: int) -> tuple[float, float]:
        return SQRT3 * self.radius * (col + 0.5 * (row & 1)), 1.5 * self.radius * row

    def cell_at(self, x: float, y: float) -> int:
        """Index of the cell containing (x, y), or -1 outside the grid."""
        q = (SQRT3 / 3 * x - y / 3) / self.radius
        r = (2 / 3 * y) / self.radius
        cx, cz = q, r
        cy = -cx - cz
        # floor(v + 0.5) is JS Math.round: Python's round() rounds half to even, which disagrees on ties.
        rx, ry, rz = math.floor(cx + 0.5), math.floor(cy + 0.5), math.floor(cz + 0.5)
        dx, dy, dz = abs(rx - cx), abs(ry - cy), abs(rz - cz)
        if dx > dy and dx > dz:
            rx = -ry - rz
        elif dy <= dz:
            rz = -rx - ry
        row = rz
        col = rx + (row - (row & 1)) // 2
        if 0 <= col < self.cols and 0 <= row < self.rows:
            return self.index(col, row)
        return -1

    def neighbours(self, index: int) -> list[int]:
        col, row = self.col_row(index)
        out = []
        for dc, dr in _NEIGHBOURS[row & 1]:
            c, r = col + dc, row + dr
            if 0 <= c < self.cols and 0 <= r < self.rows:
                out.append(self.index(c, r))
        return out

    def to_dict(self) -> dict:
        return {"radius": self.radius, "cols": self.cols, "rows": self.rows}
