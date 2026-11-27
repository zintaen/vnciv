"""Run the builders in dependency order: python -m pipeline build [name ...]"""
import importlib
import sys
import time

ORDER = ["world", "stats", "resources", "cities", "infrastructure", "wonders", "lenses", "districts",
         "citizens", "disasters", "military", "trade", "places", "timeline", "catalog"]


def full_order():
    """ORDER plus feature builders pipeline/build/ext_*.py (run after "places", before "timeline" and "catalog")."""
    import pathlib
    extra = sorted(f.stem for f in pathlib.Path(__file__).parent.glob("ext_*.py"))
    k = ORDER.index("timeline")
    return ORDER[:k] + extra + ORDER[k:]


def main():
    names = sys.argv[2:] or full_order()
    for n in names:
        t = time.time()
        print(f"[{n}]")
        importlib.import_module(f".{n}", __name__).build()
        print(f"    {time.time() - t:.1f}s")
