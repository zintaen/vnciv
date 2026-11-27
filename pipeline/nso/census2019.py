"""Parse Table 2 (population by ethnic group and province, 1 April 2019) of NSO's "Kết quả toàn bộ Tổng điều tra
dân số và nhà ở năm 2019" into data/stats/census2019/ethnic_by_province.csv.

  uv run --with pypdf python -m pipeline.nso.census2019 data/raw/nso_census2019/Ket-qua-toan-bo-Tong-dieu-tra-dan-so-va-nha-o-2019.pdf

Each row of the table holds 9 numbers (total, male, female; urban total, male, female; rural total, male, female)
printed with spaces as thousands separators ("1 845 492 918 155 ..."), and "-" for zero. The split of the digit
groups into 9 numbers is not unique from the text alone, so every split is tried and the one that satisfies the
table's own identities (total = male + female, urban and rural likewise, total = urban + rural) is kept; a row with
no or several valid splits stops the script. Checks: within each province the groups sum to the province total,
and over the 63 provinces each group sums to the national row.
"""
import csv
import re
import sys
from functools import lru_cache
from pathlib import Path

from .names import std

URL = "https://www.nso.gov.vn/wp-content/uploads/2019/12/Ket-qua-toan-bo-Tong-dieu-tra-dan-so-va-nha-o-2019.pdf"
PAGES = range(43, 210)  # PDF page index = printed page number: Table 2 is printed pages 43-209
OUT = Path(__file__).resolve().parents[2] / "data" / "stats" / "census2019" / "ethnic_by_province.csv"


def split9(tokens):
    """The unique way to read the digit groups as 9 numbers that satisfy the row identities, else raise."""
    toks = tuple(tokens)

    @lru_cache(None)
    def go(i, k):  # all ways to read toks[i:] as k numbers
        if k == 0:
            return [()] if i == len(toks) else []
        if i >= len(toks):
            return []
        t = toks[i]
        if t == "-":
            return [(0,) + rest for rest in go(i + 1, k - 1)]
        if not (1 <= len(t) <= 3) or (len(t) > 1 and t[0] == "0"):
            return []
        out, j, s = [], i + 1, t
        while True:
            out += [(int(s),) + rest for rest in go(j, k - 1)]
            if j < len(toks) and len(toks[j]) == 3 and toks[j].isdigit():
                s += toks[j]
                j += 1
            else:
                return out

    ok = [v for v in go(0, 9) if v[0] == v[1] + v[2] and v[3] == v[4] + v[5] and v[6] == v[7] + v[8]
          and v[0] == v[3] + v[6] and v[1] == v[4] + v[7]]
    if len(ok) != 1:
        raise ValueError(f"{len(ok)} readings of {' '.join(tokens)}")
    return ok[0]


ROW = re.compile(r"^(?P<name>.*?[^\d\s-])\s+(?P<nums>(?:(?:\d{1,3}|-)\s*)+)$")


def parse(pages):
    groups, areas, cur = [], {}, None
    for text in pages:
        for line in text.splitlines():
            line = line.rstrip()
            m = ROW.match(line.strip())
            if not m or "Table" in line or "Biểu" in line:
                continue
            name = re.sub(r"\s+", " ", m["name"]).strip()
            vals = split9(m["nums"].split())
            if line.startswith("     "):  # an ethnic-group row
                if cur is None:
                    raise ValueError(line)
                areas[cur]["groups"][name] = vals[0]
                if cur == "nation":
                    groups.append(name)
            else:
                cur = "nation" if "TOÀN QUỐC" in name else std(name) or ("region:" + name)
                areas[cur] = {"total": vals[0], "groups": {}}
    return groups, areas


def main(pdf):
    import pypdf
    r = pypdf.PdfReader(pdf)
    groups, areas = parse(r.pages[i].extract_text() for i in PAGES)
    provs = {k: v for k, v in areas.items() if not k.startswith("region:") and k != "nation"}
    assert len(groups) == 56, groups  # 54 groups + foreigners + not stated
    assert len(provs) == 63, sorted(provs)
    for k, a in areas.items():
        assert list(a["groups"]) == groups, k
        assert sum(a["groups"].values()) == a["total"], (k, sum(a["groups"].values()), a["total"])
    nat = areas["nation"]
    for g in groups:
        assert sum(p["groups"][g] for p in provs.values()) == nat["groups"][g], g
    assert sum(p["total"] for p in provs.values()) == nat["total"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["province_std", "group", "population", "year", "unit", "source_url"])
        for k in ["nation"] + sorted(provs):
            for g in groups:
                w.writerow([k, g, areas[k]["groups"][g], "2019-04-01", "persons", URL + " (Table 2, pp.43-209)"])
    print(f"{len(provs)} provinces x {len(groups)} groups; national total {nat['total']:,}; sums check out -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
