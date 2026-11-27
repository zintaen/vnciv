"""districts.json: each city's specialisations as strategy-game districts, from published province figures.

A measured district compares the former province's figure per resident with Vietnam's (a location quotient, LQ);
a site district needs a mapped site in the province (port, airport, World Heritage site, power plants).
"""
from __future__ import annotations

import json

from ..fetch import ROOT
from ..store import load_interim, write_web

MIN_LQ = 1.25
MAX_PER_CITY = 5
CATALOG = [
    # id, name, icon, colour, measure (stat key or site rule), badge label, description
    ("campus", "Campus", "d-campus", "#4a7bd0", "students", "Knowledge city", "University students per resident (2023)."),
    ("commercial_hub", "Commercial hub", "d-commercial_hub", "#d9a23b", "retail", "Trade city", "Retail sales of goods and services per resident (2025)."),
    ("industrial_zone", "Industrial zone", "d-industrial_zone", "#b0613a", "fdi", "Factory town", "Foreign direct investment registered in 2024 per resident (the last year published for the 63 former provinces)."),
    ("harbor", "Harbor", "d-harbor", "#3f8fc0", "site:port", "Port city", "A port area of one of the 34 seaports (Decision 804/QĐ-TTg) in the province."),
    ("theater_square", "Heritage quarter", "d-theater_square", "#b07ce0", "site:heritage", "Heritage city", "A UNESCO World Heritage site in the province."),
    ("entertainment_complex", "Tourist quarter", "d-entertainment_complex", "#e07c9a", "tourism", "Tourism hub", "Travel-agency and tour turnover per resident, 2025 (counted where the agencies are registered)."),
    ("aerodrome", "Aerodrome", "d-aerodrome", "#8aa0b8", "site:airport", "Air hub", "An airport with 2 million or more passengers a year."),
    ("government_plaza", "Government plaza", "d-government_plaza", "#c9a45c", "site:capital", "Capital city", "The national capital."),
    ("aqueduct", "Dam & power plant", "d-aqueduct", "#5fb0a8", "site:power", "Power town", "Mapped power plants totalling 1,000 MW or more."),
]
RULE = (f"A measured district appears when the former province's figure per resident is at least {MIN_LQ}× Vietnam's "
        "(LQ, location quotient): Campus (university students), Commercial hub (retail sales), Industrial zone "
        "(FDI registered in 2024) and Tourist quarter (travel and tour turnover): NSO, retail and tourism 2025, FDI "
        "2024 (the last year published for the 63 former provinces), students 2023, per resident of 2025. A site "
        "district needs a mapped site in the province: Harbor (a port), Heritage quarter (a UNESCO World Heritage "
        "site), Aerodrome (2M+ passengers), Dam & power plant (1,000+ MW of mapped plants), Government plaza (the "
        "capital). Districts are ranked by LQ, a site district counting as LQ 2 (the capital first); up to "
        f"{MAX_PER_CITY}. The badge is the strongest district's.")


def build():
    st = load_interim("_stats")["rows"]
    cities = json.loads((ROOT / "web" / "data" / "cities.json").read_text())
    infra = load_interim("_infrastructure")
    wonders = load_interim("_wonders")["wonders"]
    res = load_interim("_resources")["items"]
    nat = {k: sum(r[k] or 0 for r in st.values()) / sum(r["population"] for r in st.values())
           for k in ("students", "retail", "fdi", "tourism")}
    sites = {"port": {}, "airport": {}, "heritage": {}, "power": {}}
    for p in infra["ports"]:
        sites["port"].setdefault(p["cbsa"], []).append(p["name"])
    for a in infra["airports"]:
        if (a["enplanements"] or 0) >= 2e6:
            sites["airport"].setdefault(a["cbsa"], []).append(f"{a['name']} ({a['enplanements'] / 1e6:.1f}M passengers)")
    for w in wonders:
        if w["rule"] == "world_heritage":
            sites["heritage"].setdefault(w["cbsa"], []).append(w["short"])
    mw = {}
    for it in res:
        mw[it["cbsa"]] = mw.get(it["cbsa"], 0) + (it["value"] or 0)
    out = {}
    for c in cities:
        r = st[c["id"]]
        ds = []
        for did, name, icon, color, measure, badge, desc in CATALOG:
            if measure.startswith("site:"):
                kind = measure[5:]
                if kind == "capital":
                    hit, text = c["capital"], "Seat of the National Assembly and the Government"
                elif kind == "power":
                    hit, text = mw.get(c["id"], 0) >= 1000, f"{mw.get(c['id'], 0):,} MW of mapped power plants"
                else:
                    names = sites[kind].get(c["id"], [])
                    hit, text = bool(names), ", ".join(names[:3])
                if hit:
                    ds.append({"id": did, "lq": None, "via": "site", "strength": 99 if kind == "capital" else 2.0, "text": text})
            else:
                v = (r[measure] or 0) / r["population"]
                lq = v / nat[measure] if nat[measure] else 0
                if lq >= MIN_LQ:
                    ds.append({"id": did, "lq": round(lq, 2), "via": "measure", "strength": lq, "value": round(r[measure] or 0),
                               "text": f"{lq:.1f}× Vietnam's {desc[0].lower() + desc[1:-1]}"})
        ds.sort(key=lambda d: -d["strength"])
        ds = ds[:MAX_PER_CITY]
        top = ds[0] if ds else None
        cat = {x[0]: x for x in CATALOG}
        out[c["id"]] = {"districts": ds,
                        "badge": {"id": top["id"], "label": cat[top["id"]][5], "district": top["id"], "text": top["text"]} if top else None}
    write_web("districts.json", {
        "version": 2, "vintage": "NSO Statistical Yearbooks 2025 and 2024; mapped sites", "year": 2025,
        "sources": ["nso_yearbook", "qd804", "osm_ports", "wikidata", "ourairports", "wikipedia_airports", "osm_power", "gppd"],
        "rule": {"min_lq": MIN_LQ, "max_per_city": MAX_PER_CITY, "text": RULE},
        "catalog": [{"id": i, "name": n, "icon": ic, "color": col, "measure": m, "badge": {"label": b}, "description": d}
                    for i, n, ic, col, m, b, d in CATALOG],
        "national": {k: round(v, 2) for k, v in nat.items()},
        "cities": out})
    n = sum(1 for v in out.values() if v["districts"])
    print(f"    {n} of {len(out)} cities have at least one district")
