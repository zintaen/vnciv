"""Run the builders in dependency order: python -m pipeline build [name ...]"""
import importlib
import sys
import time

ORDER = ["world", "stats", "resources", "cities", "infrastructure", "wonders", "lenses", "districts",
         "citizens", "disasters", "military", "trade", "places", "catalog"]


def main():
    names = sys.argv[2:] or ORDER
    for n in names:
        t = time.time()
        print(f"[{n}]")
        importlib.import_module(f".{n}", __name__).build()
        print(f"    {time.time() - t:.1f}s")
