"""living_roads.json: the opening year of every expressway hex link (class 0 of infrastructure.json), so the timeline
can draw expressways by year. Years come from the OSM ways' own opening_date/start_date tags, Wikidata P1619, or a
reviewed table of quotes from the Vietnamese Wikipedia articles (VIWIKI below)."""
from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict

from ..fetch import RAW
from ..sources_living_roads import viwiki_file
from ..store import write_web
from .common import World
from .hexlinks import links_of, sample_cells

LAST_YEAR = 2026  # osm_roads was retrieved 2026-11-28; a later date would be a plan, not an opening
RULE = ("Every OpenStreetMap way tagged highway=motorway is snapped to hex links exactly as the expressways of "
        "infrastructure.json. A way's opening year is, in this order: (osm) the year in its opening_date tag, else in "
        "its start_date tag (on highways: the date it opened); (wikidata) the year of P1619 (date of official opening) "
        "of the Wikidata item in its wikidata tag, or, for a way without a wikidata tag, of a Vietnamese expressway item "
        "whose Vietnamese label (\"Đường cao tốc …\") is the way's name (ignoring case and dash style), used only when all such dates agree on "
        "the year (bridge names are not matched: many small bridges share a famous bridge's name); inception (P571) and start time "
        "(P580) are not used; (viwiki) else the year from a reviewed table of Vietnamese Wikipedia quotes for the "
        "way's route name (see routes: when the whole named route/section was open to traffic, i.e. its last stage; for "
        "a road first opened as a pre-expressway, its first opening; one exception beats the OSM tag: La Sơn – Hòa Liên, "
        "whose OSM opening_date 2026-06-30 is the planned widening, not the 2022 opening); (name) else the year of the other ways with exactly the same name, used only when all "
        "of them agree; else unknown. A link's year is the earliest year among the ways crossing it; null if none.")
NOTE = ("OpenStreetMap maps only what is open as an expressway now, so expressways that were closed or are still being "
        "built are not here. Years come from mappers' opening_date/start_date tags, Wikidata P1619 and quoted Vietnamese "
        "Wikipedia sentences (CC BY-SA 4.0); a route opened in stages shows from its last stage, so its first "
        "sections appear later than they opened; links with an unknown year (null) stay drawn in every year, as on today's map. A name shared by a whole "
        "route can spread one section's year to sections that opened later in the same route.")


def year(v):
    m = re.search(r"\b(19[89]\d|20\d\d)\b", v or "")
    return int(m[1]) if m and int(m[1]) <= LAST_YEAR else None


def norm(s):
    """A name for matching: lower case, one dash style, no leading "đường", old/new tone-mark spellings merged."""
    s = re.sub(r"\s+", " ", re.sub(r"\s*[–—-]\s*", " - ", unicodedata.normalize("NFC", s or ""))).strip().lower()
    s = s.replace("oà", "òa").replace("uý", "úy").replace("tphcm", "thành phố hồ chí minh")
    return s[6:] if s.startswith("đường ") else s


A = "Đường cao tốc "
# Reviewed by hand from the fetched article text (data/raw/viwiki_roads/): OSM way name → (article, opening year, verbatim
# quote). The year is when the whole named route/section was open to traffic (thông xe / khánh thành / đưa vào khai
# thác); for a route opened in stages, the year its last stage opened; for a road first opened as a "tiền cao tốc"
# (pre-expressway) and upgraded later, the year it first opened. Left out where the article gives no such date, only
# part of the route, or a date that conflicts with the OSM tags (Cao Lãnh – Vàm Cống: "Cao Lãnh – Lộ Tẻ" 2018 but
# Vàm Cống bridge 2019), or no article was found: Châu Đốc – Cần Thơ – Sóc Trăng, Khánh Hòa – Buôn Ma Thuột (20 km
# of it), Lộ Tẻ – Rạch Sỏi (only its 2025 upgrade), Mỹ An – Cao Lãnh, Cao Lãnh – An Hữu, Ninh Bình – Hải Phòng,
# Nội Bài – Bắc Ninh, Phú Thọ – Ba Vì, Hữu Nghị – Chi Lăng, Vành đai 3 TP. Hà Nội.
VIWIKI = {
    "Bắc Giang - Lạng Sơn": ("Bắc Giang – Lạng Sơn", 2020, "chính thức đưa vào vận hành, khai thác vào ngày 15 tháng 1 năm 2020"),
    "Bãi Vọt - Hàm Nghi": ("Bãi Vọt – Hàm Nghi", 2025, "tuyến đường chính thức đưa vào khai thác tuyến chính từ ngày 28 tháng 4 năm 2025"),
    "Biên Hòa – Vũng Tàu": ("Biên Hòa – Vũng Tàu", 2026, "chính thức đưa vào khai thác đoạn từ nút giao Long Thành đến nút giao Bà Rịa từ ngày 29 tháng 4 năm 2026 và toàn tuyến từ ngày 18 tháng 5 năm 2026"),
    "Bến Lức - Long Thành": ("Bến Lức – Long Thành", 2026, "chính thức thông xe toàn tuyến vào 0 giờ ngày 1 tháng 10 năm 2026"),
    "Bùng - Vạn Ninh": ("Bùng – Vạn Ninh", 2025, "tuyến đường chính thức đưa vào khai thác tuyến chính từ ngày 28 tháng 4 năm 2025"),
    "Cam Lộ - La Sơn": ("Cam Lộ – La Sơn", 2022, "chính thức khánh thành, đưa vào khai thác vào ngày 31 tháng 12 năm 2022"),
    "Cam Lâm - Vĩnh Hảo": ("Cam Lâm – Vĩnh Hảo", 2024, "Thông xe chính thức toàn tuyến vào ngày 26 tháng 4 và chính thức khánh thành vào ngày 28 tháng 4 năm 2024"),
    "Cao Bồ - Mai Sơn": ("Cao Bồ – Mai Sơn", 2022, "được thông xe vào ngày 4 tháng 2 năm 2022"),
    "Chí Thạnh – Vân Phong": ("Chí Thạnh – Vân Phong", 2026, "chính thức thông xe toàn tuyến từ ngày 18 tháng 5 năm 2026"),
    "Cần Thơ - Cà Mau": ("Cần Thơ – Cà Mau", 2026, "thông xe phân đoạn Cần Thơ – Hậu Giang vào ngày 19 tháng 12 năm 2025, thông xe đoạn Hậu Giang - Cà Mau vào ngày 19 tháng 1 năm 2026"),
    "Cầu Giẽ - Ninh Bình": ("Cầu Giẽ – Ninh Bình", 2012, "đến ngày 30 tháng 6 năm 2012 thì thông xe kỹ thuật đoạn còn lại từ nút giao Liêm Tuyền đến nút giao Cao Bồ"),
    "Diễn Châu - Bãi Vọt": ("Diễn Châu – Bãi Vọt", 2024, "Phân đoạn từ nút giao Quốc lộ 46 đến cuối tuyến (nút giao Bãi Vọt) chính thức thông xe ngày 29 tháng 6 năm 2024"),
    "Liên Khương - Prenn": ("Dầu Giây – Liên Khương", 2008, "Tuyến đường được khánh thành và đưa vào sử dụng ngày 29 tháng 6 năm 2008 với quy mô tiền cao tốc"),
    "Hà Nội - Bắc Giang": ("Hà Nội – Bắc Giang", 2016, "được thông xe ngày 3 tháng 1 năm 2016"),
    "Hà Nội - Hải Phòng": ("Hà Nội – Hải Phòng", 2015, "Ngày 5 tháng 12 năm 2015, toàn bộ tuyến đường cao tốc Hà Nội – Hải Phòng đã được thông xe toàn tuyến"),
    "Hà Nội - Lào Cai": ("Nội Bài – Lào Cai", 2015, "Đến ngày 19 tháng 5 năm 2015, Thủ tướng Nguyễn Tấn Dũng cùng các đại biểu cắt băng thông xe 20 km cuối cùng của tuyến Nội Bài – Lào Cai"),
    "Hà Nội - Thái Nguyên": ("Hà Nội – Thái Nguyên – Bắc Kạn – Cao Bằng", 2014, "Ngày 18 tháng 1 năm 2014, Thủ tướng Chính phủ Nguyễn Tấn Dũng chính thức cắt băng khánh thành và thông xe toàn bộ tuyến cao tốc Hà Nội – Thái Nguyên"),
    "Hải Phòng - Móng Cái": ("Hải Phòng – Hạ Long – Vân Đồn – Móng Cái", 2022, "Ngày 1 tháng 9 năm 2022, chính thức khánh thành Đường cao tốc Vân Đồn – Móng Cái, tạo thành trục Đường cao tốc Hải Phòng – Hạ Long – Vân Đồn – Móng Cái"),
    "Hạ Long - Vân Đồn": ("Hải Phòng – Hạ Long – Vân Đồn – Móng Cái", 2019, "Ngày 1 tháng 2 năm 2019, chính thức khai thác Đường cao tốc Hạ Long – Vân Đồn"),
    "Hàm Nghi - Vũng Áng": ("Hàm Nghi – Vũng Áng", 2025, "tuyến đường chính thức đưa vào khai thác tuyến chính từ ngày 28 tháng 4 năm 2025"),
    "Hoài Nhơn - Quy Nhơn": ("Hoài Nhơn – Quy Nhơn", 2026, "Tuyến đường chính thức đưa vào khai thác tuyến chính từ ngày 29 tháng 4 năm 2026"),
    "Quảng Ngãi – Hoài Nhơn": ("Quảng Ngãi – Hoài Nhơn", 2026, "đưa vào khai thác tuyến chính từ ngày 29 tháng 4 năm 2026"),
    "La Sơn - Hoà Liên": ("La Sơn – Túy Loan", 2022, "đến ngày 16 tháng 4 năm 2022 mới chính thức đưa vào khai thác đoạn La Sơn – Hòa Liên"),
    "Hoà Liên - Tuý Loan": ("La Sơn – Túy Loan", 2025, "chính thức thông xe từ ngày 19 tháng 8 năm 2025"),
    "La Sơn - Túy Loan": ("La Sơn – Túy Loan", 2025, "Đoạn Hòa Liên – Túy Loan được triển khai xây dựng bằng việc nâng cấp đường tránh Quốc lộ 1 vào Quý IV/2023 với nguồn vốn khoảng 2.113 tỷ đồng và chính thức thông xe từ ngày 19 tháng 8 năm 2025"),
    "Mai Sơn - Quốc lộ 45": ("Mai Sơn – Quốc lộ 45", 2023, "Phân đoạn từ nút giao Đông Xuân đến cuối tuyến được đưa vào khai thác từ ngày 1 tháng 9 năm 2023"),
    "Mỹ Thuận - Cần Thơ": ("Mỹ Thuận – Cần Thơ", 2023, "chính thức đưa vào sử dụng toàn tuyến vào ngày 24 tháng 12 năm 2023"),
    "Nghi Sơn - Diễn Châu": ("Nghi Sơn – Diễn Châu", 2023, "được đưa vào khai thác tạm thời vào ngày 1 tháng 9 năm 2023 và chính thức được khánh thành vào ngày 18 tháng 10 năm 2023"),
    "Quốc lộ 45 - Nghi Sơn": ("Quốc lộ 45 – Nghi Sơn", 2023, "được đưa vào khai thác tạm thời vào ngày 1 tháng 9 năm 2023 và chính thức được khánh thành vào ngày 18 tháng 10 năm 2023"),
    "Nha Trang – Cam Lâm": ("Nha Trang – Cam Lâm", 2023, "chính thức thông xe vào ngày 19 tháng 5 năm 2023"),
    "Đà Nẵng - Quảng Ngãi": ("Đà Nẵng – Quảng Ngãi", 2018, "Ngày 2 tháng 9 năm 2018, toàn tuyến đường cao tốc Đà Nẵng – Quảng Ngãi được thông xe kĩ thuật"),
    "Phan Thiết - Dầu Giây": ("Phan Thiết – Dầu Giây", 2023, "Đến ngày 7 tháng 7 năm 2023 thì thông xe toàn bộ 4 nút giao còn lại"),
    "Pháp Vân - Cầu Giẽ": ("Pháp Vân – Cầu Giẽ", 2002, "hoàn thành giai đoạn 1 vào ngày 1 tháng 1 năm 2002, trong giai đoạn đầu chỉ khai thác giai đoạn tiền cao tốc"),
    "Quy Nhơn - Chí Thạnh": ("Quy Nhơn – Chí Thạnh", 2026, "chính thức thông xe toàn tuyến từ ngày 18 tháng 5 năm 2026"),
    "Thành phố Hồ Chí Minh – Long Thành – Dầu Giây": ("Thành phố Hồ Chí Minh – Long Thành – Dầu Giây", 2015, "Toàn bộ đường cao tốc thông xe vào ngày 8 tháng 2 năm 2015"),
    "Thành phố Hồ Chí Minh – Trung Lương": ("Thành phố Hồ Chí Minh – Trung Lương", 2010, "đến ngày 3 tháng 2 năm 2010, thì thông xe kỹ thuật đoạn còn lại từ nút giao Bến Lức đến nút giao Thân Cửu Nghĩa"),
    "Trung Lương - Mỹ Thuận": ("Trung Lương – Mỹ Thuận", 2022, "Từ ngày 27 tháng 4 năm 2022, tuyến đường cao tốc đã chính thức được đưa vào hoạt động"),
    "Tuyên Quang - Hà Giang": ("Tuyên Quang – Hà Giang", 2025, "dự án đã được thông xe kỹ thuật vào ngày 19 tháng 12 năm 2025"),
    "Tuyên Quang – Phú Thọ": ("Tuyên Quang – Phú Thọ", 2023, "khánh thành vào ngày 24 tháng 12 năm 2023"),
    "Vạn Ninh - Cam Lộ": ("Vạn Ninh – Cam Lộ", 2025, "chính thức thông xe từ ngày 19 tháng 8 năm 2025"),
    "Vân Phong - Nha Trang": ("Vân Phong – Nha Trang", 2026, "Phân đoạn từ nút giao Vân Phong đến nút giao Vạn Giã chính thức thông xe vào ngày 1 tháng 1 năm 2026"),
    "Vũng Áng - Bùng": ("Vũng Áng – Bùng", 2025, "tuyến đường chính thức đưa vào khai thác tuyến chính từ ngày 28 tháng 8 năm 2025"),
    "Vĩnh Hảo - Phan Thiết": ("Vĩnh Hảo – Phan Thiết", 2023, "chính thức thông xe vào ngày 19 tháng 5 năm 2023"),
}

# Exceptions where the VIWIKI year beats the way's own OSM date tag: La Sơn – Hòa Liên opened 16/4/2022 (article), but
# its ways' opening_date 2026-06-30 is the planned widening (OSM note "Đoạn dự kiến mở rộng tại tuyến La Sơn - Hòa Liên").
VIWIKI_OVER_OSM = {"La Sơn - Hoà Liên"}


def viwiki_routes():
    """{normalised OSM name: route entry}; checks every quote is verbatim in the fetched article and names its year."""
    out = {}
    for name, (art, y, quote) in VIWIKI.items():
        title = A + art
        page = next(iter(json.loads((RAW / "viwiki_roads" / viwiki_file(title)).read_text())["query"]["pages"].values()))
        assert quote in page["extract"] and str(y) in quote, (name, quote)
        out[norm(A + name)] = {"name": A + name, "year": y, "quote": quote,
                               "source": "https://vi.wikipedia.org/wiki/" + page["title"].replace(" ", "_")}
    return out


def wikidata_years():
    """({qid: year} from the tagged items, {normalised vi label: year}) of P1619; a key with disagreeing years is left out."""
    d = RAW / "wikidata_roads"
    by_q = {}
    for q, e in json.loads((d / "entities.json").read_text())["entities"].items():
        ys = {year(s["mainsnak"].get("datavalue", {}).get("value", {}).get("time")) for s in e.get("claims", {}).get("P1619", [])}
        if len(ys) == 1 and None not in ys:
            by_q[q] = ys.pop()
    by_label = defaultdict(set)
    for b in json.loads((d / "opening.json").read_text())["results"]["bindings"]:
        if "vi" in b and norm(b["vi"]["value"]).startswith("cao tốc"):
            by_label[norm(b["vi"]["value"])].add(year(b["d"]["value"]))
    return by_q, {k: ys.pop() for k, ys in by_label.items() if len(ys) == 1 and None not in ys}


def way_years(ways):
    """[(way, year, method)] of the motorway ways with geometry."""
    by_q, by_label = wikidata_years()
    routes = viwiki_routes()
    over = {norm(A + n) for n in VIWIKI_OVER_OSM}
    out = []
    for w in ways:
        t = w.get("tags", {})
        if t.get("highway") != "motorway" or "geometry" not in w:
            continue
        y, m = year(t.get("opening_date")) or year(t.get("start_date")), "osm"
        if norm(t.get("name")) in over:
            y = None
        if y is None:
            y, m = by_q.get(t["wikidata"]) if "wikidata" in t else by_label.get(norm(t.get("name"))), "wikidata"
        if y is None:
            y, m = routes.get(norm(t.get("name")), {}).get("year"), "viwiki"
        out.append([w, y, m if y else None])
    named = defaultdict(set)
    for w, y, m in out:
        if y and w["tags"].get("name"):
            named[w["tags"]["name"]].add(y)
    for e in out:
        ys = named.get(e[0]["tags"].get("name"), ())
        if e[1] is None and len(ys) == 1:
            e[1], e[2] = next(iter(ys)), "name"
    return out


def build():
    W = World()
    years, methods = {}, {}  # (a, b) → earliest year / its method ("unknown" when no way knows)
    for w, y, m in way_years(json.loads((RAW / "osm_roads" / "roads.json").read_text())["elements"]):
        pts = [W.proj(g["lon"], g["lat"]) for g in w["geometry"] if g]
        for run in sample_cells(W.grid, pts):
            for a, b in links_of(W.grid, run):
                if W.owner[a] == -2 or W.owner[b] == -2 or (W.owner[a] < 0 and W.owner[b] < 0):
                    continue
                old = years.get((a, b))
                if (a, b) not in years or (y and (old is None or y < old)):
                    years[(a, b)], methods[(a, b)] = y, m or "unknown"
    links = [[a, b, y] for (a, b), y in sorted(years.items())]
    by_method = {k: sum(v == k for v in methods.values()) for k in ("osm", "wikidata", "viwiki", "name", "unknown")}
    hist = defaultdict(int)
    for *_, y in links:
        if y:
            hist[str(y)] += 1
    routes = {r.pop("name"): r for r in viwiki_routes().values()}
    write_web("living_roads.json", {"version": 1, "sources": ["osm_roads", "wikidata_roads", "viwiki_roads"], "rule": RULE,
                                    "note": NOTE, "routes": routes, "links": links, "by_method": by_method, "years": dict(sorted(hist.items()))})
    print(f"    {len(links)} expressway links, {by_method}")
