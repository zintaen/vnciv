"""citizens.json: each city's people as rows of figures, from the shares NSO publishes per province (2024)."""
from __future__ import annotations

import json

from ..fetch import ROOT
from ..store import load_interim, write_web

FIGURES = {"residence": 20, "work": 10, "skills": 10, "households": 10}
ROWS = {"residence": "Residents by where they live", "work": "Employed workers by kind of job",
        "skills": "Labour force by training", "households": "Households by poverty status"}
GROUPS = {
    "residence": [{"key": "urban", "label": "City dwellers", "icon": "c-service", "lines": "urban population (NSO)"},
                  {"key": "rural", "label": "Country dwellers", "icon": "c-farmer", "lines": "population − urban"}],
    "work": [{"key": "formal", "label": "Formal jobs", "icon": "c-clerk", "lines": "employed × (1 − informal share)"},
             {"key": "informal", "label": "Informal jobs", "icon": "c-maker", "lines": "employed × informal share (NSO V02.51)"}],
    "skills": [{"key": "trained", "label": "Trained", "icon": "c-engineer", "lines": "labour force × trained share"},
               {"key": "untrained", "label": "No vocational training", "icon": "c-builder", "lines": "labour force × (1 − trained share)"}],
    "households": [{"key": "not_poor", "label": "Not poor", "icon": "c-executive", "lines": "1 − multidimensional poverty rate"},
                   {"key": "poor", "label": "Poor", "icon": "c-farmer", "lines": "multidimensional poverty rate"}],
}
RULE = {"specialist_high": 1.5, "specialist_low": 0.67, "min_share": 0.01, "max_high": 4, "max_low": 2,
        "text": "A city stands out in a category when its share is at least 1.5× or at most 0.67× Vietnam's (categories "
                "under 1% both locally and nationally are skipped)."}


def figures(shares, n):
    """Largest-remainder rounding of shares to n figures."""
    raw = {k: v * n for k, v in shares.items()}
    out = {k: int(v) for k, v in raw.items()}
    for k in sorted(raw, key=lambda k: -(raw[k] - out[k]))[: n - sum(out.values())]:
        out[k] += 1
    return out


def row(total, counts, n):
    shares = {k: (v / total if total else 0) for k, v in counts.items()}
    return {"total": round(total), "counts": {k: round(v) for k, v in counts.items()},
            "shares": {k: round(v, 3) for k, v in shares.items()}, "figures": figures(shares, n)}


def citizen_rows(r):
    out = {
        "residence": row(r["population"], {"urban": r["urban_population"], "rural": r["population"] - r["urban_population"]}, FIGURES["residence"]),
        "work": row(r["employed"], {"formal": r["employed"] * (1 - r["informal"]), "informal": r["employed"] * r["informal"]}, FIGURES["work"])
        if r["informal"] is not None else None,
        "skills": row(r["labour_force"], {"trained": r["labour_force"] * r["trained"], "untrained": r["labour_force"] * (1 - r["trained"])}, FIGURES["skills"])
        if r["trained"] is not None else None,
        "households": row(1000, {"not_poor": 1000 * (1 - r["poverty"]), "poor": 1000 * r["poverty"]}, FIGURES["households"])
        if r["poverty"] is not None else None,
    }
    if out["households"]:
        out["households"]["total"] = None  # a share of households: NSO publishes no household count here
        out["households"]["counts"] = None
    out["life_expectancy"] = r["life_exp"]
    out["migration"] = {"in": r["in_migration"], "out": r["out_migration"], "net": r["net_migration"], "unit": "per 1,000 residents"}
    return out


def build():
    st = load_interim("_stats")["rows"]
    pop = sum(r["population"] for r in st.values())
    w = lambda k, wk="population": sum(r[k] * r[wk] for r in st.values()) / sum(r[wk] for r in st.values())
    nat = {"population": pop, "urban_population": sum(r["urban_population"] for r in st.values()),
           "employed": sum(r["employed"] for r in st.values()), "labour_force": sum(r["labour_force"] for r in st.values()),
           "informal": w("informal", "employed"), "trained": w("trained", "labour_force"), "poverty": w("poverty"),
           "life_exp": w("life_exp"), "in_migration": None, "out_migration": None, "net_migration": None}
    national = citizen_rows(nat)
    national["specialists"] = []
    cities = {}
    for iso, r in st.items():
        c = citizen_rows(r)
        spec = []
        for rk in FIGURES:
            if not c[rk] or not national[rk]:
                continue
            for cat, sh in c[rk]["shares"].items():
                ns = national[rk]["shares"][cat]
                if ns <= 0 or (sh < 0.01 and ns < 0.01):
                    continue
                ratio = sh / ns
                if ratio >= RULE["specialist_high"] or ratio <= RULE["specialist_low"]:
                    spec.append({"row": rk, "key": cat, "share": sh, "national": ns, "ratio": round(ratio, 2)})
        hi = sorted((s for s in spec if s["ratio"] >= 1), key=lambda s: -s["ratio"])[:RULE["max_high"]]
        lo = sorted((s for s in spec if s["ratio"] < 1), key=lambda s: s["ratio"])[:RULE["max_low"]]
        c["specialists"] = hi + lo
        c["reliable"] = True
        cities[iso] = c
    write_web("citizens.json", {"version": 2, "vintage": "NSO Statistical Yearbook 2024 and PX-Web", "year": 2024,
                                "sources": ["nso_yearbook"], "figures": FIGURES, "rows": ROWS, "groups": GROUPS,
                                "rule": RULE, "national": national, "cities": cities,
                                "note": "Shares are NSO's province figures for 2024; household poverty is the share of "
                                        "households under the multidimensional poverty standard, the rest are people."})
