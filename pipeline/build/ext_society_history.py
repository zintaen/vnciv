"""web/data/history.json: the History list (dated events with sources) for the timeline and the story chapters.

The curated events are data/stats/history/events*.json (one file per theme); every event carries a verbatim
`evidence` sentence from a Wikipedia article fetched through the MediaWiki API with its revision id
(pipeline/sources_story2.py, data/raw/wikipedia_events/). The build fails if the sentence is not in that revision's
extract, if the event's year is not in the sentence, if a place has no coordinates in its article, or if an id repeats.

Placement (`at`): "<raw file>" = that article's coordinates; "wonder:<id>" = the UNESCO site in wonders.json;
"nation" = an event about the whole country, drawn at the capital of the time (CAPITALS); null = no single place.
"""
from __future__ import annotations

import gzip
import html
import json
import re
import urllib.parse

from ..fetch import RAW, ROOT
from ..sources_story2 import SOURCE, WEB, WEB_SOURCE, _articles
from ..store import load_web, write_web
from .common import World

HIST = ROOT / "data" / "stats" / "history"
RAWDIR = RAW / SOURCE
CATEGORIES = {
    "dynasty": "Founding and dynasties",
    "modern": "Modern and contemporary",
    "admin": "Provinces and administration",
    "infra": "Infrastructure",
    "disaster": "Disasters",
    "culture": "Culture and heritage",
    "economy": "Economy and integration",
    "science": "Science and sport",
}
OLD_CATEGORY = {"capital": "dynasty", "dynasty": "dynasty", "national": "modern", "admin": "admin"}
# (first year, last year, raw file, place): the capital an event about the whole country is drawn at, each period
# following this file's own capital events (Hoa Lư 968, Thăng Long 1010, Tây Đô 1397, Thăng Long/Đông Kinh 1428,
# Phú Xuân under the Tây Sơn, Huế 1802, Hà Nội 1945).
CAPITALS = [
    (968, 1009, "hoa_lu_ancient.json", "Hoa Lư"),
    (1010, 1396, "hanoi.json", "Thăng Long"),
    (1397, 1407, "ho_citadel.json", "Tây Đô"),
    (1408, 1787, "hanoi.json", "Thăng Long"),
    (1788, 1801, "hue.json", "Phú Xuân (Huế)"),
    (1802, 1944, "hue.json", "Huế"),
    (1945, 9999, "hanoi.json", "Hà Nội"),
]
RULES = {
    "events": "What qualifies: (1) the founding of a state, the start or end of a dynasty, a change of capital, and the "
              "battles that decided them (Bạch Đằng 938, 981 and 1288, Chi Lăng, Đống Đa); (2) the turning points of the "
              "modern era as dated in the cited article (treaties, declarations, the 1954 and 1973 agreements, 1975, "
              "1976), worded as the article words them; (3) every province split or merger (1975/1976, 1978, 1989, "
              "1991, 1996/1997, 2003/2004, 2008, 2025), one event per province, besides the summary events, and the "
              "province-level cities and ward changes made since (2025, 2026); (4) openings of railways, "
              "major bridges and tunnels, the first and the trunk expressways, metro lines, the main airports and ports; "
              "(5) disasters that Wikipedia names among the deadliest or costliest in Vietnam; (6) UNESCO inscriptions "
              "(world, intangible and documentary heritage, geoparks) and (7) Vietnam joining ASEAN, APEC, the WTO and "
              "the major trade agreements, normal relations with the US; (8) science and sport only for a national first "
              "(the first Vietnamese in space, the first Olympic gold medal). Each with a sentence of the cited "
              "Wikipedia article that states its date.",
    "date": "ISO 8601 as precise as the source: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. Years before the common era use "
            "astronomical numbering ('-0256' = 257 BCE); `year` is the same number as an integer.",
    "position": "x, y (map units) at the event's place: the coordinates of that place's Wikipedia article, or the UNESCO "
                "site's position in wonders.json; an event about the whole country is drawn at the capital of the time "
                "(Hoa Lư 968–1009, Thăng Long 1010–1787 except Tây Đô 1397–1407, Phú Xuân 1788–1801, Huế 1802–1944, "
                "Hà Nội from 1945) and says so in `placed`; before 968 such an event has no position.",
    "cite": "cite = the article, revid = the revision whose text holds the evidence sentence (retrieved on the date in "
            "the source manifest); `also` = more sentences from other articles where one is not enough.",
    "neutral": "Political and war events use the cited article's own wording and dates, without judgement.",
    "legend": "Dates before about 1000 CE follow tradition and chronicles (e.g. the Hùng kings); the text says so.",
}


def page_of(name):
    return json.loads((RAWDIR / name).read_text(encoding="utf-8"))["query"]["pages"][0]


def year_of(date):
    return -int(date[1:].split("-")[0]) if date.startswith("-") else int(date.split("-")[0])


def wiki_url(name):
    a = _articles()[name]
    title = page_of(name)["title"]  # after redirects
    return f"https://{a['lang']}.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'), safe='()')}"


def web_text(name):
    """An official page (web.json) as plain text: tags dropped, entities decoded, white space collapsed."""
    b = (RAW / WEB_SOURCE / name).read_bytes()
    b = gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", b.decode("utf-8"))))


def check_sentence(eid, name, evidence, label=None):
    web = json.loads(WEB.read_text(encoding="utf-8")) if WEB.exists() else {}
    if name in web:
        assert evidence in web_text(name), f"{eid}: evidence not in {name}"
        assert label is None or label in evidence, f"{eid}: year {label} not in the evidence"
        return {"cite": web[name], "revid": None, "evidence": evidence}
    assert name in _articles(), f"{eid}: {name} is not in articles.json"
    p = page_of(name)
    assert evidence in p.get("extract", ""), f"{eid}: evidence not in {name}"
    assert label is None or label in evidence, f"{eid}: year {label} not in the evidence"
    return {"cite": wiki_url(name), "revid": p["revisions"][0]["revid"], "evidence": evidence}


def coords(eid, name):
    c = (page_of(name).get("coordinates") or [None])[0]
    assert c, f"{eid}: {name} has no coordinates"
    return c["lon"], c["lat"]


def load_events():
    out = []
    for f in sorted(HIST.glob("events*.json")):
        out += json.loads(f.read_text(encoding="utf-8"))
    return out


def validate(events, W=None, wonders=None):
    """The checked, placed events (sorted by date). Raises AssertionError on the first problem."""
    ids = [e["id"] for e in events]
    dup = {i for i in ids if ids.count(i) > 1}
    assert not dup, f"duplicate ids: {sorted(dup)}"
    W = W or World()
    wonders = wonders if wonders is not None else {w["id"]: w for w in (load_web("wonders.json") or {}).get("wonders", [])}
    out = []
    for e in events:
        eid = e["id"]
        cat = OLD_CATEGORY.get(e["category"], e["category"])
        assert cat in CATEGORIES, f"{eid}: category {e['category']}"
        for k in ("date", "title_en", "title_vi", "text_en", "text_vi", "raw_file", "evidence"):
            assert e.get(k), f"{eid}: no {k}"
        y = year_of(e["date"])
        label = str(1 - y) if y <= 0 else str(y)  # astronomical → the BCE year the sentence states
        also = [check_sentence(eid, a["raw_file"], a["evidence"]) for a in e.get("also", [])]
        # the year is in the evidence, or (a page that says "this year") in a dateline quoted from the same page
        dated = any(label in a["evidence"] and a["raw_file"] == e["raw_file"] for a in e.get("also", []))
        src = check_sentence(eid, e["raw_file"], e["evidence"], None if dated else label)
        at = e.get("at", e.get("coord_file"))
        lon = lat = x = yy = None
        place, placed, placed_vi = e.get("place"), None, None
        if at == "nation":
            cap = next((c for c in CAPITALS if c[0] <= y <= c[1]), None)
            if cap:
                lon, lat = coords(eid, cap[2])
                place = place or cap[3]
                placed = f"Nationwide: shown at the capital of the time, {cap[3]} (coordinates of the Wikipedia article ‘{page_of(cap[2])['title']}’)."
                placed_vi = f"Sự kiện cả nước: đặt tại kinh đô thời đó, {cap[3]} (tọa độ của bài Wikipedia ‘{page_of(cap[2])['title']}’)."
            else:
                placed, placed_vi = "Nationwide, before 968: no single place.", "Sự kiện cả nước, trước năm 968: không đặt ở một địa điểm."
        elif at and at.startswith("wonder:"):
            wd = wonders.get(at[7:])
            assert wd and wd.get("x") is not None, f"{eid}: no wonder {at}"
            x, yy = wd["x"], wd["y"]
            place = place or wd.get("short") or wd["name"]
            placed = f"At the UNESCO site's position in wonders.json ({wd['name']})."
            placed_vi = f"Tại vị trí của di sản UNESCO trong wonders.json ({wd['name']})."
        elif at:
            lon, lat = coords(eid, at)
            if e.get("lat") is not None:  # the older events also state them: they must still agree
                assert (lat, lon) == (e["lat"], e["lon"]), f"{eid}: coordinates differ from {at}"
            placed = f"At {place or page_of(at)['title']}: coordinates of the Wikipedia article ‘{page_of(at)['title']}’."
            placed_vi = f"Tại {e.get('place_vi') or place or page_of(at)['title']}: tọa độ của bài Wikipedia ‘{page_of(at)['title']}’."
            place = place or page_of(at)["title"]
        else:
            placed, placed_vi = "No single place.", "Không đặt ở một địa điểm."
        if lon is not None:
            x, yy = (round(v, 1) for v in W.proj(lon, lat))
        ev = {"id": eid, "date": e["date"], "year": y, "category": cat, "title": e["title_en"], "text": e["text_en"],
              "title_vi": e["title_vi"], "text_vi": e["text_vi"], **src,
              "x": x, "y": yy, "lon": lon, "lat": lat, "place": place, "placed": placed, "placed_vi": placed_vi}
        if e.get("place_vi"):
            ev["place_vi"] = e["place_vi"]
        if also:
            ev["also"] = also
        for k in ("story", "storm", "wonder"):
            if e.get(k):
                ev[k] = e[k]
        out.append(ev)
    out.sort(key=lambda ev: (ev["year"], ev["date"]))
    return out


def build():
    out = validate(load_events())
    by = {}
    for ev in out:
        by[ev["category"]] = by.get(ev["category"], 0) + 1
    write_web("history.json", {"version": 2, "source": SOURCE, "rules": RULES, "categories": CATEGORIES, "events": out})
    print(f"    {len(out)} events ({sum(ev['x'] is not None for ev in out)} placed on the map) {by}")
