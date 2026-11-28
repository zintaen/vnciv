"""seasons.json: the season calendar of ext/explore ("Lịch mùa Việt Nam"), month by month.

* storms: tropical storms that came near Vietnam since 1980 (timeline.json storms, IBTrACS), counted by the month they
  first came within 100 km of the mainland or a coastal island, with the provinces they touched most often that month;
* festivals: geo.json's festivals (lunar day and month, Vietnamese Wikipedia list) with their solar dates in a few lunar
  years, from Hồ Ngọc Đức's lunar year codes (the same tables as living.json's Tết dates), cross-checked against the
  Hong Kong Observatory's month starts where both exist;
* sights: flowers and terraced-field seasons whose months are quoted word for word from Vietnamese Wikipedia articles
  (the build checks that each quote is in the downloaded article), placed at the article's coordinates.
The rice stages and the Mekong flood season come from living.json (the browser reads them there).
"""
from __future__ import annotations

import datetime as dt
import json
import re
from collections import Counter, defaultdict

from ..fetch import RAW
from ..store import load_web, write_web
from .common import World

WP = RAW / "wikipedia_vi_seasons"
WD = RAW / "wikidata_seasons"
LREFS = RAW / "living_refs"

# Each sight: months (1–12, in order of the season), the quote they come from (must be in the article's text), the
# article file, and the place: a coordinates file + title (Wikipedia prop=coordinates) or a Wikidata item.
SIGHTS = [
    dict(id="mcc_water", kind="fields", vi="Ruộng bậc thang Mù Cang Chải mùa đổ nước", en="Mù Cang Chải terraces: water season",
         months=[5, 6], article="mu_cang_chai_terraces.json", title="Ruộng bậc thang Mù Cang Chải",
         quote="khi những thửa ruộng vào mùa đổ nước (khoảng tháng 5 tháng 6",
         place=("district_coords.json", "Mù Cang Chải (huyện)"), place_vi="Mù Cang Chải", place_en="Mù Cang Chải district"),
    dict(id="mcc_ripe", kind="fields", vi="Ruộng bậc thang Mù Cang Chải mùa lúa chín", en="Mù Cang Chải terraces: ripe rice",
         months=[9, 10], article="mu_cang_chai_terraces.json", title="Ruộng bậc thang Mù Cang Chải",
         quote="vào mùa lúa chín (khoảng tháng 9 tháng 10)",
         place=("district_coords.json", "Mù Cang Chải (huyện)"), place_vi="Mù Cang Chải", place_en="Mù Cang Chải district"),
    dict(id="hsp_plant", kind="fields", vi="Ruộng bậc thang Hoàng Su Phì mùa gieo cấy", en="Hoàng Su Phì terraces: planting season",
         months=[4, 5, 6], article="ha_giang.json", title="Hà Giang",
         quote="mùa gieo cấy (từ tháng 4 đến tháng 6 hàng năm)",
         place=("district_coords.json", "Hoàng Su Phì (huyện)"), place_vi="Hoàng Su Phì", place_en="Hoàng Su Phì district"),
    dict(id="hsp_ripe", kind="fields", vi="Ruộng bậc thang Hoàng Su Phì mùa lúa chín", en="Hoàng Su Phì terraces: ripe rice",
         months=[8, 9, 10], article="ha_giang.json", title="Hà Giang",
         quote="mùa lúa chín (từ tháng 8 đến giữa tháng 10 hàng năm)",
         place=("district_coords.json", "Hoàng Su Phì (huyện)"), place_vi="Hoàng Su Phì", place_en="Hoàng Su Phì district"),
    dict(id="mc_mustard", kind="flowers", vi="Hoa cải trắng Mộc Châu", en="White mustard flowers, Mộc Châu",
         months=[11, 12, 1], article="moc_chau.json", title="Mộc Châu (thị xã)",
         quote="khoảng tháng 11 đến tháng 1 có hoa cải trắng nở tràn trên núi",
         place=("moc_chau.json", "Mộc Châu (thị xã)"), place_vi="Mộc Châu", place_en="Mộc Châu"),
    dict(id="mc_plum_peach", kind="flowers", vi="Hoa mận, hoa đào Mộc Châu", en="Plum and peach blossom, Mộc Châu",
         months=[1, 2, 3], article="moc_chau.json", title="Mộc Châu (thị xã)",
         quote="Tháng 1 đến tháng 3 có hoa mận hậu, hoa đào",
         place=("moc_chau.json", "Mộc Châu (thị xã)"), place_vi="Mộc Châu", place_en="Mộc Châu"),
    dict(id="mc_bauhinia", kind="flowers", vi="Hoa ban Mộc Châu", en="Bauhinia (hoa ban) in bloom, Mộc Châu",
         months=[4], article="moc_chau.json", title="Mộc Châu (thị xã)",
         quote="Sang tháng 4 có hoa ban nở trắng rừng",
         place=("moc_chau.json", "Mộc Châu (thị xã)"), place_vi="Mộc Châu", place_en="Mộc Châu"),
    dict(id="mc_plums", kind="fruit", vi="Mùa mận chín Mộc Châu", en="Ripe plums, Mộc Châu",
         months=[5], article="moc_chau.json", title="Mộc Châu (thị xã)",
         quote="Đến tháng 5 là mùa mận chín",
         place=("moc_chau.json", "Mộc Châu (thị xã)"), place_vi="Mộc Châu", place_en="Mộc Châu"),
    dict(id="db_bauhinia_festival", kind="festival", vi="Lễ hội hoa ban Điện Biên", en="Điện Biên bauhinia festival",
         months=[3], article="dien_bien.json", title="Điện Biên",
         quote="Lễ hội hoa ban Điện Biên thường diễn ra vào giữa tháng 3 hàng năm",
         place=("dien_bien.json", "Điện Biên"), place_vi="Điện Biên (tỉnh)", place_en="Điện Biên province"),
    dict(id="dl_sunflower", kind="flowers", vi="Hoa dã quỳ Đà Lạt", en="Wild sunflowers (dã quỳ), Đà Lạt",
         months=[11], article="lam_vien_square.json", title="Quảng trường Lâm Viên",
         quote="Cứ vào cuối tháng 11 hằng năm, hoa Dã Quỳ đều nở rộ khắp mọi cung đường",
         place=("wikidata", "Q56072444"), place_vi="Quảng trường Lâm Viên, Đà Lạt", place_en="Lâm Viên Square, Đà Lạt"),
]
LEFT_OUT = ("Hà Giang's buckwheat flowers (tam giác mạch) and Đà Lạt's cherry blossom (mai anh đào) are left out: no "
            "fetched article gives both a month range and a place for them in Vietnam.")


def _page(name):
    j = json.loads((WP / name).read_text(encoding="utf-8"))
    return list(j["query"]["pages"].values())


def _coords(spec):
    kind, key = spec
    if kind == "wikidata":
        e = json.loads((WD / f"{key}.json").read_text(encoding="utf-8"))["entities"][key]
        v = e["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"]
        return v["longitude"], v["latitude"], f"https://www.wikidata.org/wiki/{key}"
    for p in _page(kind):
        if p["title"] == key and p.get("coordinates"):
            c = p["coordinates"][0]
            return c["lon"], c["lat"], "https://vi.wikipedia.org/wiki/" + key.replace(" ", "_")
    raise ValueError(f"no coordinates for {key} in {kind}")


# --- the Vietnamese lunar calendar (Hồ Ngọc Đức's year codes, UTC+7) -------------------------------------------------

def year_codes():
    js = (LREFS / "hnd_amlich_JavaScript_amlich-ntt.js").read_text(encoding="utf-8", errors="replace")
    out = {}
    for name, base in (("TK20", 1900), ("TK21", 2000)):
        body = re.search(name + r"\s*=\s*new Array\((.*?)\)", js, re.S).group(1)
        for k, h in enumerate(re.findall(r"0x[0-9a-fA-F]+", body)):
            out[base + k] = int(h, 16)
    return out


def lunar_months(year, code):
    """[(month, leap, first day as date, length)] of lunar year `year`: a port of decodeLunarYear() in amlich-ntt.js."""
    lengths = (29, 30)
    tet = dt.date(year, 1, 1) + dt.timedelta(days=code >> 17)
    leap = code & 0xF
    leap_len = lengths[(code >> 16) & 1]
    regular = [0] * 12
    j = code >> 4
    for i in range(12):
        regular[11 - i] = lengths[j & 1]
        j >>= 1
    out, day = [], tet
    for m in range(1, 13):
        out.append((m, False, day, regular[m - 1]))
        day += dt.timedelta(days=regular[m - 1])
        if m == leap:
            out.append((m, True, day, leap_len))
            day += dt.timedelta(days=leap_len)
    return out


def lunar_to_solar(year, month, day, codes):
    """The solar date of day/month (the regular month, not a leap one) of lunar year `year`, or None."""
    for m, leap, first, n in lunar_months(year, codes[year]):
        if m == month and not leap:
            return first + dt.timedelta(days=day - 1) if 1 <= day <= n else None
    return None


def hko_month_starts(year):
    """{(month): date} of the Chinese calendar's month starts in a Gregorian year (HKO table, UTC+8), or {}."""
    p = LREFS / "hko_calendar" / f"T{year}e.txt"
    out = {}
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"\s*(\d{4})/(\d{1,2})/(\d{1,2})\s+(\d+)(?:st|nd|rd|th) Lunar Month", line)
        if m:
            out.setdefault(dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))), int(m.group(4)))
    return out


def build():
    W = World()
    world = load_web("world.json")
    remote = set(world.get("remote") or [])
    owner = world["owner"]
    abbr = [s["abbr"] for s in world["states"]]

    # storms
    tl = load_web("timeline.json")
    by_month = defaultdict(list)
    seasons = set()
    for s in tl["storms"]:
        cells = [c for c in s["cells"] if c not in remote]
        if not cells:
            continue  # only near Hoàng Sa / Trường Sa: left out, as in disasters.json
        m = int(s["date"][5:7])
        by_month[m].append((s, cells))
        seasons.add(s["season"])
    first, last = min(seasons), max(seasons)
    n_years = last - first + 1
    storms = {"since": first, "until": last, "years": n_years, "provisional": tl.get("provisional_seasons") or [],
              "months": {}}
    total = 0
    for m in range(1, 13):
        rows = by_month.get(m, [])
        total += len(rows)
        prov = Counter()
        for s, cells in rows:
            for a in {abbr[owner[c]] for c in cells if owner[c] >= 0}:
                prov[a] += 1
        storms["months"][str(m)] = {"count": len(rows), "strong": sum(1 for s, _ in rows if s["max_kt"] >= 64),
                                    "per_year": round(len(rows) / n_years, 2),
                                    "top": [[a, n] for a, n in prov.most_common(3)]}
    dis = (load_web("disasters.json") or {}).get("typhoons", {}).get("national", {}).get("storms")
    storms["total"] = total
    storms["rule"] = ("Tropical cyclones of at least tropical-storm strength (34 kt) whose IBTrACS best track passed within "
                      f"100 km of a mainland or coastal-island hex of Vietnam, {first}–{last} (the storms of timeline.json "
                      "without those that only came near Hoàng Sa or Trường Sa), counted by the month they first came "
                      f"within 100 km; per year = count ÷ {n_years} seasons. 'Strong' = 64 kt or more. Top provinces: the "
                      "2025 provinces whose land those storms touched most often in that month. The latest seasons are "
                      "provisional in IBTrACS.")
    if dis is not None:
        assert dis == total, f"storm count {total} differs from disasters.json {dis}"

    # festivals
    codes = year_codes()
    living = load_web("living.json")
    for y, d in living["tet"]["dates"].items():  # the same tables as living.json's Tết dates
        assert lunar_months(int(y), codes[int(y)])[0][2].isoformat() == d, y
    this = dt.date.today().year
    years = list(range(this - 1, this + 3))
    checked = mismatched = 0
    for y in years + [years[-1] + 1]:
        hko = hko_month_starts(y)
        for ly in (y - 1, y):
            for m, leap, start, _ in lunar_months(ly, codes[ly]):
                if start.year == y and start in hko:
                    checked += 1
                    mismatched += hko[start] != m
    geo = load_web("geo.json")
    fest = []
    for f in geo.get("festivals", []):
        if f.get("cal") != "lunar" or not f.get("month") or not f.get("day"):
            continue
        sol = {str(y): lunar_to_solar(y, f["month"], f["day"], codes) for y in years}
        fest.append({"n": f["n"], "x": f["x"], "y": f["y"], "p": f.get("p"), "month": f["month"], "day": f["day"],
                     "solar": {y: d.isoformat() for y, d in sol.items() if d}})

    # sights
    sights = []
    for s in SIGHTS:
        page = next(p for p in _page(s["article"]) if p["title"] == s["title"])
        assert s["quote"] in page["extract"], f"quote not in {s['article']}: {s['quote']}"
        lon, lat, place_url = _coords(s["place"])
        x, y = W.proj(lon, lat)
        sights.append({"id": s["id"], "kind": s["kind"], "vi": s["vi"], "en": s["en"], "months": s["months"],
                       "quote": s["quote"], "source": "https://vi.wikipedia.org/wiki/" + s["title"].replace(" ", "_"),
                       "source_title": s["title"], "place_vi": s["place_vi"], "place_en": s["place_en"],
                       "lon": round(lon, 5), "lat": round(lat, 5), "place_source": place_url,
                       "x": round(x, 1), "y": round(y, 1)})

    doc = {
        "version": 1,
        "sources": {"storms": ["ibtracs"], "festivals": ["wikipedia_vi_festivals", "hnd_amlich", "hko_calendar"],
                    "sights": ["wikipedia_vi_seasons", "wikidata_seasons"],
                    "rice": ["usda_ipad_cropcal"], "flood": ["hcmue_flood_2016", "fao_mrc_flood"]},
        "rules": {
            "storms": storms["rule"],
            "festivals": (f"The festivals of geo.json (Vietnamese Wikipedia list of festivals, placed ones) with a lunar "
                          f"start day; solar dates for the lunar years {years[0]}–{years[-1]} from Hồ Ngọc Đức's Vietnamese "
                          f"lunar calendar year codes (UTC+7; a regular month, never the leap one). Checked against the Hong "
                          f"Kong Observatory's tables (Chinese calendar, UTC+8): {checked - mismatched} of {checked} month starts "
                          f"in those years agree" + ("." if not mismatched else "; the others are a day apart where the "
                          "time zones put the new moon on different days.")),
            "sights": ("Each sight's months are quoted word for word from the Vietnamese Wikipedia article named with it "
                       "(the build checks the quote is in the article), placed at the coordinates of the article about "
                       "that district or place. " + LEFT_OUT),
            "rice": "living.json crop_calendar (USDA FAS IPAD rice calendar, North and South rows).",
            "flood": "living.json flood (the Mekong flood season, mùa nước nổi; months with their relative level).",
        },
        "lunar_years": years,
        "storms": storms,
        "festivals": fest,
        "sights": sights,
    }
    print(f"    {total} storms {first}–{last}, {len(fest)} festivals × {len(years)} lunar years "
          f"(HKO month starts {checked - mismatched}/{checked} agree), {len(sights)} sights")
    write_web("seasons.json", doc)
