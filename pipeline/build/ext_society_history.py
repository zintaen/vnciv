"""web/data/history.json: dated events (capitals, dynasties, national milestones, administrative changes) for the
timeline, each cited to a Wikipedia article fetched through the MediaWiki API.

The curated list is data/stats/history/events.json; each event carries a verbatim `evidence` sentence and the cached
API response it comes from (data/raw/wikipedia_history/). The build fails if the sentence is not in that response, if
the event's year is not in the sentence, or if the coordinates differ from the ones in the cited response.
"""
from __future__ import annotations

import json

from ..fetch import RAW, ROOT
from ..store import write_web
from .common import World

EVENTS = ROOT / "data" / "stats" / "history" / "events.json"
RAWDIR = RAW / "wikipedia_history"
RULES = {
    "events": "Capitals, dynasties, national milestones and changes to the province map, each with a sentence from the "
              "cited Wikipedia article that states its date.",
    "date": "ISO 8601 as precise as the source: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. Years before the common era use "
            "astronomical numbering ('-0256' = 257 BCE); `year` is the same number as an integer.",
    "position": "x, y (map units) only for an event bound to one place, from the coordinates of that place's Wikipedia "
                "article; events about the whole country have none.",
    "legend": "Dates before about 1000 CE follow tradition and chronicles (e.g. the Hùng kings); the text says so.",
}


def extract(name):
    page = json.loads((RAWDIR / name).read_text(encoding="utf-8"))["query"]["pages"][0]
    return page.get("extract", ""), (page.get("coordinates") or [None])[0]


def year_of(date):
    return -int(date[1:].split("-")[0]) if date.startswith("-") else int(date.split("-")[0])


def build():
    W = World()
    out = []
    for e in json.loads(EVENTS.read_text(encoding="utf-8")):
        text, _ = extract(e["raw_file"])
        y = year_of(e["date"])
        label = str(1 - y) if y <= 0 else str(y)  # astronomical → the BCE year the sentence states
        assert e["evidence"] in text, f"{e['id']}: evidence not in {e['raw_file']}"
        assert label in e["evidence"], f"{e['id']}: year {label} not in the evidence"
        x = yy = None
        if e.get("lat") is not None:
            _, c = extract(e["coord_file"])
            assert c and (c["lat"], c["lon"]) == (e["lat"], e["lon"]), f"{e['id']}: coordinates differ from {e['coord_file']}"
            x, yy = (round(v, 1) for v in W.proj(e["lon"], e["lat"]))
        out.append({"id": e["id"], "date": e["date"], "year": y, "category": e["category"], "title": e["title_en"],
                    "text": e["text_en"], "cite": e["cite_url"], "evidence": e["evidence"],
                    "x": x, "y": yy, "lon": e["lon"] if x is not None else None, "lat": e["lat"] if x is not None else None})
    out.sort(key=lambda ev: (ev["year"], ev["date"]))
    write_web("history.json", {"version": 1, "source": "wikipedia_history", "rules": RULES, "events": out})
    print(f"    {len(out)} events ({sum(ev['x'] is not None for ev in out)} placed on the map)")
