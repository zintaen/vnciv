"""Check web/data/*.json against docs/DATA_CONTRACTS.md (the vnciv shapes). Also: python tests/test_contracts.py
For each documented object: keys the doc lists but the file lacks (MISSING) and keys the file has but the doc does not
mention anywhere (UNDOC). Prints mismatches; exit 1 if any."""
import json, re, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "web" / "data"
DOC = (ROOT / "docs" / "DATA_CONTRACTS.md").read_text()
MENTIONED = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", DOC))  # every identifier the doc names
load = lambda n: json.loads((D / f"{n}.json").read_text())
first = lambda v: next(iter(v.values())) if isinstance(v, dict) else v[0]
union = lambda rows: set().union(*[set(r) for r in rows if isinstance(r, dict)])

ECON = {"population", "employed", "yields", "jobs", "median_income", "median_rent", "home_value", "unemployment",
        "rent_burden", "gdp", "gdp_year", "gdp_by_industry", "gdp_undisclosed", "gdp_estimated", "growth", "growth_years",
        "pop_series", "years", "area_km2", "density", "urban", "labour_force", "trained", "literacy", "hdi", "poverty",
        "gini", "income_worker", "productivity", "fdi", "fdi_projects", "retail", "paddy", "tourism", "students",
        "lecturers", "pci", "pci_2024", "grdp_growth", "internet", "computer", "clean_water", "housing", "it_skills",
        "enterprises_pk"}
S34 = {"doctors", "doctors_pk", "forest_cover", "road_deaths", "pupils_per_teacher", "growth_9m2026", "industry_jobs_2026"}
V = {"version"}
# (label, getter, documented keys, optional keys)
SPEC = [
    ("world", lambda: [load("world")], {"version", "grid", "width", "height", "margin", "km_per_unit", "remote", "owner",
     "county", "elev", "elev_max", "water", "relief", "cover", "pct", "tables", "states", "counties", "rivers"}, set()),
    ("world.tables", lambda: [load("world")["tables"]], {"water", "relief", "cover", "notes"}, set()),
    ("cities[]", lambda: load("cities"), ECON | {"id", "name", "full", "states", "metro", "capital", "x", "y", "cell",
     "counties", "footprint", "ranks", "peers", "province_old", "province_new"}, set()),
    ("states[]", lambda: load("states"), ECON | S34 | {"fips", "abbr", "name", "former", "ranks", "label", "land", "energy", "pci_2025"},
     {"growth_9m2026", "industry_jobs_2026"}),
    ("nation", lambda: [load("nation")], {"vintage", "year", "gdp_vintage", "currency", "nation", "yields", "industries",
     "gdp_industries", "jobs_source", "years_note", "series"}, set()),
    ("nation.nation", lambda: [load("nation")["nation"]], ECON | S34 | {"cities_basis", "employed_lfs", "informal",
     "life_exp", "gdp_provinces"}, S34),
    ("lenses", lambda: [load("lenses")], {"vintage", "groups", "lenses"}, set()),
    ("lenses.lenses[]", lambda: load("lenses")["lenses"], {"id", "group", "name", "icon", "emoji", "unit", "format",
     "scale", "domain", "ramp", "higher_is", "source", "description", "values"}, {"note", "year", "level", "categories"}),
    ("resources", lambda: [load("resources")], {"types", "items", "summary"}, set()),
    ("resources.items[]", lambda: load("resources")["items"], {"type", "name", "x", "y", "cell", "value", "detail",
     "state", "cbsa"}, {"since", "capacity_from", "farms"}),
    ("counties", lambda: [load("counties")], {"vintage", "fields", "columns", "rows"}, set()),
    ("citizens", lambda: [load("citizens")], V | {"vintage", "year", "sources", "figures", "rows", "groups", "rule",
     "national", "cities", "note"}, set()),
    ("citizens.cities{}", lambda: list(load("citizens")["cities"].values()), {"residence", "work", "skills",
     "households", "life_expectancy", "migration", "specialists", "reliable"}, set()),
    ("districts", lambda: [load("districts")], V | {"vintage", "year", "sources", "rule", "catalog", "national",
     "cities"}, set()),
    ("districts.cities{}.districts[]", lambda: [d for c in load("districts")["cities"].values() for d in c["districts"]],
     {"id", "lq", "via", "strength", "text"}, {"value"}),
    ("infrastructure", lambda: [load("infrastructure")], V | {"vintage", "sources", "rules", "road_classes",
     "port_classes", "rail_tiers", "hubs", "roads", "rail", "ports", "seaports_unplaced", "airports"}, set()),
    ("infrastructure.ports[]", lambda: load("infrastructure")["ports"], {"id", "name", "seaport", "class", "main",
     "type", "rank", "tons", "domestic", "foreign", "imports", "exports", "year", "x", "y", "cell", "county", "cbsa",
     "state", "placed"}, set()),
    ("infrastructure.airports[]", lambda: load("infrastructure")["airports"], {"id", "name", "name_vi", "city", "hub",
     "enplanements", "enplanements_prev", "cargo_lbs", "year", "x", "y", "cell", "county", "cbsa", "state"}, set()),
    ("trade", lambda: [load("trade")], V | {"vintage", "year", "sources", "kind", "rule", "path_note", "units", "modes",
     "zones", "routes"}, {"international"}),
    ("trade.zones[]", lambda: load("trade")["zones"], {"id", "name", "short", "kind", "states", "cities", "airports",
     "anchor", "partners"}, set()),
    ("trade.routes[]", lambda: load("trade")["routes"], {"a", "b", "rank", "airlines", "airline_codes", "airports",
     "value_musd", "tons_k", "modes", "top_mode", "dist_km", "path"}, set()),
    ("military", lambda: [load("military")], V | {"vintage", "sources", "rule", "rules", "flagships", "caveats",
     "components", "installations", "ranges", "states", "national", "cities"}, set()),
    ("military.installations[]", lambda: load("military")["installations"], {"id", "name", "component", "joint",
     "status", "tier", "curated", "area_km2", "kind", "cells", "x", "y", "cell", "county", "cbsa", "state",
     "state_filed"}, {"parts"}),
    ("military.national", lambda: [load("military")["national"]], {"personnel", "spending", "veterans",
     "armed_forces_resident", "installations", "area_km2", "by_component", "by_tier"}, set()),
    ("wonders", lambda: [load("wonders")], V | {"vintage", "sources", "rules", "national", "wonders"}, set()),
    ("wonders.national", lambda: [load("wonders")["national"]], {"world_heritage", "national_parks", "park_visits",
     "r1_universities"}, set()),
    ("wonders.wonders[]", lambda: load("wonders")["wonders"], {"id", "name", "short", "name_en", "kind", "rule", "rank",
     "metrics", "x", "y", "cell", "cells", "county", "cbsa", "state", "curated"}, {"short_en"}),
    ("disasters", lambda: [load("disasters")], V | {"sources", "vintage", "typhoons"}, set()),
    ("disasters.typhoons", lambda: [load("disasters")["typhoons"]], {"since", "radius_km", "min_kt", "strong_kt", "rule",
     "counties", "states", "national", "provisional_seasons"}, set()),
    ("disasters.typhoons.national", lambda: [load("disasters")["typhoons"]["national"]], {"storms", "strong", "by_year",
     "strongest", "recent"}, set()),
    ("disasters.storm", lambda: load("disasters")["typhoons"]["national"]["strongest"], {"name", "season", "date",
     "max_kt", "strong", "hexes", "provinces", "provisional"}, set()),
    ("sources[]", lambda: load("sources"), {"id", "title", "publisher", "homepage", "license", "description", "used_for",
     "vintage", "files"}, set()),
    ("communes", lambda: [load("communes")], V | {"year", "as_of", "sources", "vintage", "rules", "kinds", "q", "unit_km",
     "count", "official_2025", "official_now", "changes", "by_province", "count_differences", "count_note", "outline_check", "stats", "arcs", "communes"}, set()),
    ("communes.communes[]", lambda: load("communes")["communes"], {"id", "n", "k", "p", "x", "y", "a", "r", "area_km2",
     "population", "density", "res"}, {"null_reason"}),
    ("poi", lambda: [load("poi")], V | {"vintage", "sources", "rules", "states", "religions", "cols", "points", "metro",
     "counts"}, set()),
    ("relics", lambda: [load("relics")], V | {"vintage", "sources", "rules", "states", "cols", "relics", "listed",
     "unplaced"}, set()),
    ("ethnic", lambda: [load("ethnic")], V | {"source", "date", "unit", "note", "rules", "groups", "nation", "former", "provinces"}, set()),
    ("forest_loss", lambda: [load("forest_loss")], V | {"source", "years", "canopy_min", "unit", "rules", "note", "cells",
     "forest2000_ha", "peak_year", "loss_ha", "provinces", "national"}, set()),
    ("sealevel", lambda: [load("sealevel")], V | {"source", "delta_source", "delta_cells", "levels", "unit", "hex_area_km2", "rule", "note", "cells",
     "land_pct", "share"}, set()),
    ("history", lambda: [load("history")], V | {"source", "rules", "categories", "events"}, set()),
    ("history.events[]", lambda: load("history")["events"], {"id", "date", "year", "category", "title", "text", "cite",
     "evidence", "x", "y", "lon", "lat", "title_vi", "text_vi", "revid", "place", "placed", "placed_vi", "place_vi", "also",
     "story", "storm", "wonder"}, {"also", "story", "storm", "wonder", "place_vi"}),
    ("places", lambda: [load("places")], V | {"sources", "rules", "archipelagos", "slogan", "islands", "towns"}, set()),
    ("timeline", lambda: [load("timeline")], V | {"sources", "years", "fx", "fx_used", "merger", "series", "storms",
     "events", "note", "provisional_seasons"}, set()),
    ("timeline.series{}", lambda: list(load("timeline")["series"].values()), {"unit", "source", "lens", "levels",
     "lens_values", "status", "status_levels", "note"}, {"status_levels"}),
]

LENS_IDS = ("density urban growth income gdp_pc poverty gini fdi trained literacy hdi unemployment productivity pci "
            "disasters forest farmland developed wetland internet clean_water housing it_skills enterprises growth_2026 "
            "industry_jobs_2026 doctors road_deaths pupils_per_teacher forest_cover osm_schools ethnic_largest "
            "ethnic_minority crop_rice crop_maize crop_cassava crop_sugarcane crop_tea crop_orange rainfall temperature "
            "hot_month cold_month forest_loss low_lying "
            # themes stream (ext_themes.py)
            "life_expectancy ageing_index crude_birth_rate total_fertility_rate net_migration_rate fishery_production "
            "tourism_travel_turnover disaster_deaths elevation slope pm25").split()
GROUPS = "people economy living education hazards land environment agriculture".split()


def main():
    bad = []
    for label, get, doc, opt in SPEC:
        rows = get()
        have, every = union(rows), set.intersection(*[set(r) for r in rows if isinstance(r, dict)])
        for k in sorted((doc - opt) - every):
            bad.append(f"{label}: MISSING documented key '{k}'" + ("" if k not in have else " (in some records only)"))
        for k in sorted(have - doc - opt):
            bad.append(f"{label}: UNDOC key '{k}'" + (" (named elsewhere in the doc)" if k in MENTIONED else ""))
    L = load("lenses")
    if sorted(l["id"] for l in L["lenses"]) != sorted(LENS_IDS):
        bad.append(f"lenses ids: doc-only {set(LENS_IDS) - {l['id'] for l in L['lenses']}}, "
                   f"file-only {({l['id'] for l in L['lenses']}) - set(LENS_IDS)}")
    if [g["id"] for g in L["groups"]] != GROUPS:
        bad.append(f"lenses groups: doc {GROUPS} vs file {[g['id'] for g in L['groups']]}")
    for l in L["lenses"]:
        if l.get("level") not in (None, "63", "34") or len(l["ramp"]) < 2:
            bad.append(f"lens {l['id']}: level {l.get('level')!r} / ramp {len(l['ramp'])}")
    c, w = load("cities"), load("world")
    if any(x["growth_years"] != [2019, 2025] or x["gdp_year"] != 2025 for x in c):
        bad.append("cities: growth_years/gdp_year differ from [2019, 2025]/2025")
    if w["km_per_unit"] != 0.2 or w["grid"]["radius"] != 25:
        bad.append("world: km_per_unit/radius")
    r = load("relics")
    if len(r["relics"]) + len(r["unplaced"]) != r["listed"]:
        bad.append("relics: relics + unplaced != listed")
    return bad


class TestContracts(unittest.TestCase):
    def test_data_matches_contracts(self):
        bad = main()
        self.assertFalse(bad, "\n".join(bad))

    def test_strings_are_nfc(self):
        """Every string in web/data is NFC: a decomposed name (some OSM names are) defeats prefix rules such as
        "Chùa" → Buddhist and the browser's search."""
        import unicodedata
        bad = []
        def walk(x, f):
            if isinstance(x, str):
                if unicodedata.normalize("NFC", x) != x:
                    bad.append((f, x))
            elif isinstance(x, dict):
                for v in x.values():
                    walk(v, f)
            elif isinstance(x, list):
                for v in x:
                    walk(v, f)
        files = sorted(D.glob("*.json"))
        self.assertGreater(len(files), 20)
        for p in files:
            walk(json.loads(p.read_text()), p.name)
        self.assertEqual(bad[:10], [])


if __name__ == "__main__":
    unittest.main()
