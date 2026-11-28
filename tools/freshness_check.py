"""Weekly data-freshness check (.github/workflows/freshness.yml): for each source with a machine-checkable "latest
version" signal, compare it with the vintage recorded in web/data (sources.json and the data files). Small requests
only (an API answer, a HEAD, a directory listing); nothing big is downloaded and nothing is changed.

    python3 tools/freshness_check.py                 # print the table (a dry run)
    python3 tools/freshness_check.py --out body.md   # also write the issue body; prints the number of newer sources

A check that cannot reach its source reports "error" and does not count as newer. OpenStreetMap is always live: skipped.
"""
import datetime as dt
import email.utils
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "data"
UA = {"User-Agent": "vnciv-freshness-check/1.0 (+https://github.com/zintaen/vnciv)"}
TIMEOUT = 40
SRC = {s["id"]: s for s in json.loads((DATA / "sources.json").read_text())}


def http(url, method="GET", data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers={**UA, **(headers or {})})
    return urllib.request.urlopen(req, timeout=TIMEOUT)


def get_json(url, headers=None):
    with http(url, headers=headers) as r:
        return json.loads(r.read())


def exists(url):
    try:
        with http(url, "HEAD"):
            return True
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return False
        raise


def urls(sid):
    return [f["url"] for f in SRC[sid].get("files", [])]


# --- checks: each returns (ours, latest, newer: bool) --------------------------------------------------------------

def worldbank_fx():
    ours = int(re.search(r"(\d{4})\s*$", SRC["worldbank_fx"]["vintage"]).group(1))
    d = get_json("https://api.worldbank.org/v2/country/VNM/indicator/PA.NUS.FCRF?format=json&mrnev=1")
    latest = int(d[1][0]["date"])
    return str(ours), str(latest), latest > ours


def nso_monthly():
    month = lambda u: tuple(map(int, re.search(r"thang-(\d{1,2})\.(\d{4})", u, re.I).groups()[::-1]))  # (year, month)
    ours = max(month(u) for u in urls("nso_monthly_2026"))
    media = get_json("https://www.nso.gov.vn/wp-json/wp/v2/media?search=Bieu-thang&per_page=20&_fields=source_url,date",
                     {"User-Agent": "Mozilla/5.0 (compatible; vnciv-freshness-check)"})
    found = [month(m["source_url"]) for m in media if re.search(r"thang-\d{1,2}\.\d{4}", m["source_url"], re.I)]
    latest = max(found) if found else ours
    fmt = lambda ym: f"{ym[1]}/{ym[0]}"
    return fmt(ours), fmt(latest), latest > ours


def ibtracs():
    f = SRC["ibtracs"]["files"][0]
    ours = dt.date.fromisoformat(f["retrieved"])
    with http(f["url"], "HEAD") as r:
        lm = email.utils.parsedate_to_datetime(r.headers["Last-Modified"]).date()
    return f"retrieved {ours}", f"file modified {lm}", lm > ours


def hansen_gfc():
    u = urls("hansen_gfc")[0]
    year, minor = map(int, re.search(r"GFC-(\d{4})-v1\.(\d+)", u).groups())
    latest = (year, minor)
    for y, m in ((year + 1, minor + 1), (year + 1, minor + 2), (year + 2, minor + 2)):  # the next one or two releases
        probe = re.sub(r"GFC-\d{4}-v1\.\d+", f"GFC-{y}-v1.{m}", u)
        if exists(probe):
            latest = max(latest, (y, m))
    fmt = lambda v: f"GFC-{v[0]}-v1.{v[1]}"
    return fmt((year, minor)), fmt(latest), latest > (year, minor)


def natural_earth():
    ours = re.search(r"/(v[\d.]+)/", urls("natural_earth")[0]).group(1)
    tok = os.environ.get("GITHUB_TOKEN")
    d = get_json("https://api.github.com/repos/nvkelso/natural-earth-vector/releases/latest",
                 {"Authorization": f"Bearer {tok}"} if tok else None)
    latest = d["tag_name"]
    ver = lambda s: tuple(int(x) for x in re.findall(r"\d+", s))
    return ours, latest, ver(latest) > ver(ours)


def worldpop():
    ours = re.search(r"/(R\d{4}[A-Z])/", urls("worldpop")[0]).group(1)
    with http("https://data.worldpop.org/GIS/Population/Global_2015_2030/") as r:
        rel = set(re.findall(r"R\d{4}[A-Z]", r.read().decode("utf-8", "replace")))
    latest = max(rel | {ours})
    return ours, latest, latest > ours


def nso_dvhc():
    """Today's register (code, type) against the units on the map (communes.json): any change = newer."""
    today = dt.date.today()
    body = ('<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
            f'<soap:Body><DanhMucPhuongXa xmlns="http://tempuri.org/"><DenNgay>{today:%d/%m/%Y}</DenNgay>'
            '<Tinh></Tinh><QuanHuyen></QuanHuyen><NguoiYeuCau></NguoiYeuCau></DanhMucPhuongXa></soap:Body></soap:Envelope>')
    with http("https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx", "POST", body.encode(),
              {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '"http://tempuri.org/DanhMucPhuongXa"'}) as r:
        root = ET.fromstring(r.read())
    now = {t.findtext("MaPhuongXa"): (t.findtext("LoaiHinh") or "").strip().lower() for t in root.iter("TABLE")}
    if not now:
        raise RuntimeError("empty register answer")
    C = json.loads((DATA / "communes.json").read_text())
    ours = {c["id"] for c in C["communes"]}
    kind = lambda s: "ward" if s.startswith("phường") else "special" if s.startswith("đặc khu") else "commune"
    counts = {k: sum(1 for v in now.values() if kind(v) == k) for k in ("commune", "ward", "special")}
    off = C["official_now"]
    changed = set(now) != ours or (counts["commune"], counts["ward"], counts["special"]) != (off["communes"], off["wards"], off["special"])
    fmt = lambda n, c, w, s: f"{n} units ({c} communes, {w} wards, {s} special zones)"
    return (f"{C['as_of']}: " + fmt(off["total"], off["communes"], off["wards"], off["special"]),
            f"{today}: " + fmt(len(now), counts["commune"], counts["ward"], counts["special"]) +
            (f"; {len(set(now) ^ ours)} codes differ" if set(now) != ours else ""), changed)


def wikipedia_air_routes():
    arts = json.loads((DATA / "air_routes.json").read_text())["articles"]
    changed, by_lang = [], {}
    for key, a in arts.items():
        by_lang.setdefault(key.split(":")[0], []).append(a)
    for lang, items in by_lang.items():
        for k in range(0, len(items), 50):
            chunk = items[k:k + 50]
            q = urllib.parse.urlencode({"action": "query", "prop": "revisions", "rvprop": "ids", "redirects": 1, "format": "json",
                                        "formatversion": 2, "titles": "|".join(a["title"] for a in chunk)})
            pages = get_json(f"https://{lang}.wikipedia.org/w/api.php?{q}")["query"]["pages"]
            cur = {p["title"]: p["revisions"][0]["revid"] for p in pages if p.get("revisions")}
            changed += [f"{lang}:{a['title']}" for a in chunk if a["title"] in cur and cur[a["title"]] != a["revid"]]
    note = ", ".join(changed[:8]) + (f" and {len(changed) - 8} more" if len(changed) > 8 else "")
    return f"{len(arts)} article revisions", f"{len(changed)} edited since" + (f": {note}" if changed else ""), bool(changed)


CHECKS = [
    ("worldbank_fx", "World Bank exchange rate (PA.NUS.FCRF)", worldbank_fx),
    ("nso_monthly_2026", "NSO monthly socio-economic report", nso_monthly),
    ("ibtracs", "IBTrACS typhoon tracks", ibtracs),
    ("hansen_gfc", "Hansen Global Forest Change", hansen_gfc),
    ("natural_earth", "Natural Earth", natural_earth),
    ("worldpop", "WorldPop population", worldpop),
    ("nso_dvhc", "NSO administrative-unit register", nso_dvhc),
    ("wikipedia_air_routes", "Wikipedia airport articles (air routes)", wikipedia_air_routes),
]


def main():
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
    rows, newer = [], 0
    for sid, title, fn in CHECKS:
        try:
            ours, latest, is_newer = fn()
            status = "**newer**" if is_newer else "current"
            newer += is_newer
        except Exception as e:  # a source that cannot be reached is reported, not fatal (e.g. the NSO register from abroad)
            ours, latest, status = SRC.get(sid, {}).get("vintage") or "", f"{type(e).__name__}: {str(e)[:120]}", "error"
        rows.append((title, sid, ours, latest, status))
        print(f"{status:12} {title}: ours {ours} | latest {latest}", file=sys.stderr)
    cell = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
    run = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', 'zintaen/vnciv')}/actions/workflows/freshness.yml"
    md = (f"Weekly check of {dt.date.today()} ([workflow]({run})). Nothing is updated "
          "automatically: refresh a source with its builder (`uv run python -m pipeline build …`) and review the diff.\n\n"
          "| Source | id | Our vintage | Latest seen | Status |\n|---|---|---|---|---|\n"
          + "".join(f"| {' | '.join(cell(c) for c in r)} |\n" for r in rows)
          + "\nOpenStreetMap layers are live data and are not checked.\n")
    if out:
        Path(out).write_text(md)
    else:
        print(md, file=sys.stderr)
    print(newer)


if __name__ == "__main__":
    main()
