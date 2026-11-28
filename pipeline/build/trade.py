"""trade.json + air_routes.json: Vietnam's air routes from the "Airlines and destinations" tables of the English and
Vietnamese Wikipedia articles on its 22 airports with scheduled service (current revisions).

Vietnam publishes no freight flows between provinces, so the trade layer shows the domestic air links: each city pair
whose airports are linked by at least one airline, weighted by the number of airlines flying it. air_routes.json keeps
every airport pair (domestic and international) with its airlines, service type and the articles that list it.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import re
from collections import Counter

from .. import airtables
from ..fetch import RAW, manifest
from ..geo import UNIT
from ..sources_fresh2 import AIRPORT_ARTICLES
from ..store import load_interim, load_web, write_web
from .common import World

SRC = "wikipedia_air_routes"
D = RAW / SRC
MIN_AIRLINES = 3
RULES = {
    "tables": "The \"Airlines and destinations\" table of each airport's English Wikipedia article ({{Airport-dest-list}}) "
              "and the airlines-and-destinations table of its Vietnamese article, current revision (ids and timestamps in "
              "`articles`). Airlines and destinations are matched across the two languages by their Wikidata items "
              "(destination airports by IATA code, P238; airlines by IATA designator, P229). Links to a city instead of "
              "an airport, and destinations with no IATA code on Wikidata, are dropped (`dropped_links`).",
    "service": "Each listing keeps the table's markers: \"Seasonal:\" / \"Theo mùa:\" → seasonal, \"Charter:\" / \"Thuê "
               "chuyến:\" → charter. A listing whose note says the service begins or resumes after the download date, "
               "or that it has stopped (\"Đã ngừng\", \"tạm dừng\", an \"ends\" date already past), is left out. An "
               "airline's service on a route is \"charter\" if every listing that counts marks it charter, else "
               "\"seasonal\" if every one marks it seasonal, else \"scheduled\".",
    "domestic": "A domestic route is a pair of the 22 airports with an airline listed for it on the articles of both "
                "airports (in either language): the airline is listed under A with destination B and under B with "
                "destination A. Pairs listed at one end only are kept apart in `one_sided`, not drawn.",
    "international": "An international route is a Vietnamese airport and a foreign airport (an IATA code in OurAirports "
                     "outside Vietnam) listed in the Vietnamese airport's English or Vietnamese article; the foreign "
                     "airport's own article is not read.",
}
TRADE_RULE = (f"The domestic routes between cities flown by at least {MIN_AIRLINES} airlines (scheduled or seasonal; "
              "charter-only airlines not counted), from the airlines-and-destinations tables of the English and Vietnamese Wikipedia "
              "articles on Vietnam's airports (current revisions, see air_routes.json): an airline counts for a pair of "
              "airports when the articles of both airports list it. Routes are ranked by airlines, ties broken by the passengers of the route's "
              "airports (latest ACV year compiled on Wikipedia). Each route links the cities whose former provinces hold "
              "the two airports.")
MIN_INTL_AIRLINES = 2
FRAME_MARGIN = 150  # map units (30 km): a foreign airport this far inside the map's edge counts as in the frame
INTL_RULE = (f"International routes: a Vietnamese airport and a foreign airport listed in the Vietnamese airport's English "
             "or Vietnamese Wikipedia article (the foreign airport's article is not read), counting the airlines that are "
             "not charter-only. Routes to an airport inside the map frame flown by at least "
             f"{MIN_INTL_AIRLINES} airlines are drawn as arcs; the others are listed. Destination names are the English "
             "articles' link labels, or OurAirports' airport name where only a Vietnamese article links the airport.")
PATH_NOTE = ("Drawn as an arc between the two cities: Wikipedia's tables list which airports each airline links, not "
             "how many flights or passengers each route has, and they can lag behind airline schedule changes.")


def titles_to_qid(lang):
    """{link target: Wikidata item} from the links_<lang>_*.json lookups (normalisation and redirects followed)."""
    norm, redir, page = {}, {}, {}
    for p in sorted(D.glob(f"links_{lang}_*.json")):
        q = json.loads(p.read_text())["query"]
        norm |= {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir |= {r["from"]: r["to"] for r in q.get("redirects", [])}
        page |= {pg["title"]: pg["pageprops"]["wikibase_item"] for pg in q.get("pages", [])
                 if "wikibase_item" in pg.get("pageprops", {})}

    def qid(t):
        t = norm.get(t, t)
        return page.get(redir.get(t, t))
    return qid


def build():
    W = World()
    infra = load_interim("_infrastructure")
    airports = {a["id"]: a for a in infra["airports"]}
    assert set(airports) == set(AIRPORT_ARTICLES), "the article list must match infrastructure.json's airports"
    cities = {c["id"]: c for c in json.loads((RAW.parent.parent / "web" / "data" / "cities.json").read_text())}
    ourair = {r["iata_code"]: r for r in csv.DictReader(open(RAW / "ourairports" / "airports.csv", encoding="utf-8"))
              if r["iata_code"]}
    airport_iata, airline_iata = {}, {}
    for b in json.loads((D / "iata.json").read_text())["results"]["bindings"]:
        q = b["s"]["value"].rsplit("/", 1)[1]
        if "iata" in b:
            airport_iata.setdefault(q, set()).add(b["iata"]["value"])
        if "airline" in b:
            airline_iata.setdefault(q, set()).add(b["airline"]["value"])
    man = manifest(SRC)
    articles, names, dropped = {}, {}, 0
    listings = {}  # (origin, dest, airline id) → [(article, flags)]
    labels = {}  # destination IATA → Counter of its English link labels ("Bangkok–Suvarnabhumi")
    for lang in ("en", "vi"):
        qid = titles_to_qid(lang)
        rows_of = airtables.en_rows if lang == "en" else airtables.vi_rows
        for o in sorted(AIRPORT_ARTICLES):
            f = f"{lang}_{o}.json"
            text, title, revid, ts = airtables.revision(D / f)
            today = dt.date.fromisoformat(man[f]["retrieved"])
            art = f"{lang}:{o}"
            articles[art] = {"title": title, "revid": revid, "timestamp": ts, "retrieved": man[f]["retrieved"],
                             "url": f"https://{lang}.wikipedia.org/w/index.php?oldid={revid}"}
            for airline, dests in rows_of(text):
                airline = re.sub(r"^:?(?:w:)?(?:en|vi):", "", airline)  # interwiki links ([[:en:X]])
                aq = qid(airline) or f"{lang}:{airline}"
                if lang == "en" or aq not in names:
                    names[aq] = re.sub(r"\s*\(.*\)$", "", airline)
                for target, label, flags, note in dests:
                    codes = airport_iata.get(qid(target) or "", set())
                    d = next(iter(sorted(codes & set(airports))), None) or next(iter(sorted(c for c in codes if c in ourair)), None)
                    if not d or d == o:
                        dropped += 1
                        continue
                    if airtables.status(note, today) != "listed":
                        continue
                    listings.setdefault((o, d, aq), []).append((art, flags))
                    if lang == "en":
                        labels.setdefault(d, Counter())[label] += 1

    # an airline with no Wikidata item in one language joins the item of the same name from the other
    by_name = {n.lower(): q for q, n in names.items() if ":" not in q}
    merged = {}
    for (o, d, aq), ls in listings.items():
        merged.setdefault((o, d, by_name.get(names[aq].lower(), aq) if ":" in aq else aq), []).extend(ls)
    listings = merged

    def service(ls):
        fl = [set(f) for _, f in ls]
        return "charter" if all("charter" in f for f in fl) else "seasonal" if all("seasonal" in f for f in fl) else "scheduled"

    domestic, one_sided, international = {}, {}, {}
    for (o, d, aq), ls in listings.items():
        if d in airports:
            a, b = sorted((o, d))
            both = listings.get((a, b, aq), []) + listings.get((b, a, aq), [])
            ends = {x[0].split(":")[1] for x in both}
            (domestic if ends == {a, b} else one_sided).setdefault((a, b), {})[aq] = both
        elif ourair[d]["iso_country"] != "VN":
            international.setdefault((o, d), {})[aq] = ls

    def airline_list(m):
        return [{"id": aq, "service": service(ls), "listed_in": sorted({x[0] for x in ls})}
                for aq, ls in sorted(m.items(), key=lambda kv: names[kv[0]])]

    def label_of(d):  # the most used English label; ties → the shortest, then alphabetical
        c = labels.get(d)
        return min(c, key=lambda k: (-c[k], len(k), k)) if c else ourair[d]["name"]  # no English link: the airport's name

    def code(aq):
        c = sorted(airline_iata.get(aq, []))
        return c[0] if len(c) == 1 else names[aq]

    routes_all = [{"a": a, "b": b, "airlines": airline_list(m)} for (a, b), m in sorted(domestic.items())]
    used_airlines = {x["id"] for r in routes_all for x in r["airlines"]}
    intl = [{"vn": o, "foreign": d, "airlines": airline_list(m)} for (o, d), m in sorted(international.items())]
    used_airlines |= {x["id"] for r in intl for x in r["airlines"]}
    one = [{"a": a, "b": b, "airlines": airline_list(m)} for (a, b), m in sorted(one_sided.items())
           if (a, b) not in domestic or set(m) - set(domestic[(a, b)])]
    for r in one:  # one_sided lists only the airlines not already confirmed on the route
        r["airlines"] = [x for x in r["airlines"] if (r["a"], r["b"]) not in domestic or x["id"] not in domestic[(r["a"], r["b"])]]
    used_airlines |= {x["id"] for r in one for x in r["airlines"]}
    foreign = {d: {"name": ourair[d]["name"], "label": label_of(d), "country": ourair[d]["iso_country"], "municipality": ourair[d]["municipality"],
                   "lon": float(ourair[d]["longitude_deg"]), "lat": float(ourair[d]["latitude_deg"])}
               for d in sorted({r["foreign"] for r in intl})}
    write_web("air_routes.json", {
        "version": 1, "sources": [SRC, "wikidata", "ourairports"], "rules": RULES, "articles": articles,
        "airlines": {aq: {"name": names[aq], "iata": code(aq) if aq in airline_iata else None} for aq in sorted(used_airlines)},
        "domestic": routes_all, "one_sided": one, "international": intl, "foreign_airports": foreign,
        "dropped_links": dropped})

    # trade.json: city pairs from the confirmed domestic routes, airlines that are not charter-only
    by_city = {}
    for r in routes_all:
        ca, cb = airports[r["a"]]["cbsa"], airports[r["b"]]["cbsa"]
        if not ca or not cb or ca == cb:
            continue
        als = {x["id"] for x in r["airlines"] if x["service"] != "charter"}
        if not als:
            continue
        e = by_city.setdefault(tuple(sorted((ca, cb))), {"airlines": set(), "airports": set()})
        e["airlines"] |= als
        e["airports"] |= {r["a"], r["b"]}
    for e in by_city.values():
        e["pax"] = sum(airports[x]["enplanements"] or 0 for x in e["airports"])
    pairs = sorted(by_city, key=lambda k: (-len(by_city[k]["airlines"]), -by_city[k]["pax"], k))
    routes, used = [], set()
    for ca, cb in [k for k in pairs if len(by_city[k]["airlines"]) >= MIN_AIRLINES]:
        e = by_city[(ca, cb)]
        A, B = cities[ca], cities[cb]
        dist = math.dist(W.center(A["cell"]), W.center(B["cell"])) / UNIT
        routes.append({"a": ca, "b": cb, "rank": len(routes) + 1, "airlines": len(e["airlines"]),
                       "airline_codes": sorted(code(x) for x in e["airlines"]), "airports": sorted(e["airports"]),
                       "value_musd": None, "tons_k": None, "modes": {"air": 1.0}, "top_mode": "air",
                       "dist_km": round(dist), "path": [A["cell"], B["cell"]]})
        used |= {ca, cb}
    zones = []
    for cid in sorted(used):
        c = cities[cid]
        zones.append({"id": cid, "name": c["full"], "short": c["name"], "kind": "city", "states": c["states"],
                      "cities": [cid], "airports": sorted(k for k, a in airports.items() if a["cbsa"] == cid),
                      "anchor": {"cell": c["cell"], "x": c["x"], "y": c["y"], "city": cid},
                      "partners": sorted(([r["b"] if r["a"] == cid else r["a"], r["airlines"]] for r in routes
                                          if cid in (r["a"], r["b"])), key=lambda p: -p[1])[:5]})
    # international: Vietnamese airport → foreign airport, airlines that are not charter-only
    world = load_web("world.json")
    width, height = world["width"], world["height"]
    inter = []
    for r in intl:
        als = [x["id"] for x in r["airlines"] if x["service"] != "charter"]
        if not als:
            continue
        f = ourair[r["foreign"]]
        x, y = W.proj(float(f["longitude_deg"]), float(f["latitude_deg"]))
        inside = FRAME_MARGIN <= x <= width - FRAME_MARGIN and FRAME_MARGIN <= y <= height - FRAME_MARGIN
        vn = airports[r["vn"]]
        inter.append({"vn": r["vn"], "city": vn["cbsa"], "foreign": r["foreign"], "airlines": len(als),
                      "airline_codes": sorted(code(x) for x in als), "in_frame": inside,
                      "drawn": inside and len(als) >= MIN_INTL_AIRLINES,
                      "dist_km": round(math.dist((vn["x"], vn["y"]), (x, y)) / UNIT),
                      "path": [vn["cell"], W.grid.cell_at(x, y)] if inside else None})
    inter.sort(key=lambda r: (-r["airlines"], r["dist_km"], r["vn"], r["foreign"]))
    for k, r in enumerate(inter):
        r["rank"] = k + 1
    fdest = {r["foreign"] for r in inter}
    pos = {r["foreign"]: W.proj(float(ourair[r["foreign"]]["longitude_deg"]), float(ourair[r["foreign"]]["latitude_deg"]))
           for r in inter if r["in_frame"]}
    international = {
        "rule": INTL_RULE, "min_airlines": MIN_INTL_AIRLINES,
        "foreign": {d: {"city": label_of(d), "country": ourair[d]["iso_country"],
                        **({"x": round(pos[d][0], 1), "y": round(pos[d][1], 1)} if d in pos else {})} for d in sorted(fdest)},
        "routes": inter}
    newest = dt.date.fromisoformat(max(a["retrieved"] for a in articles.values()))
    write_web("trade.json", {"version": 1, "vintage": f"Wikipedia airport articles, {newest:%B %Y}",
                             "year": newest.year, "sources": [SRC, "wikidata", "ourairports", "wikipedia_airports"],
                             "kind": "air", "rule": TRADE_RULE, "path_note": PATH_NOTE,
                             "units": {"airlines": "airlines flying the route"},
                             "modes": [{"id": "air", "name": "Air"}], "zones": zones, "routes": routes,
                             "international": international})
    print(f"    {len(routes_all)} domestic airport pairs ({len(one)} one-sided), {len(intl)} international, "
          f"{dropped} links dropped; trade: {len(routes)} of {len(pairs)} city pairs between {len(zones)} cities; top: "
          f"{[(cities[r['a']]['name'], cities[r['b']]['name'], r['airlines']) for r in routes[:3]]}")
