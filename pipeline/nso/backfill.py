# usage: backfill.py data/stats [data/interim/nso_dc]   (run after series.py)
# Fills years the 2025 yearbook does not print into data/stats/series/<indicator>.csv, from
#  1. PX-Web tables (data/stats/px/*.json, pxget.py) for the 63 former provinces, and
#  2. older yearbooks (NGTK<edition>.txt from ext.py; YB below) by matching the 2025 table's title.
# Rules (published in SOURCES.md): only years 2019-2026 that the series lacks are added (existing rows are never
# replaced); a source is used for an indicator only if, on every year it shares with the series, it agrees with it on
# at least 95% of the provinces (within one rounding unit) - otherwise it is reported and skipped (definition or unit
# break). Among yearbooks, the newest edition that prints a year wins. Status: "Sơ bộ"/"Prel." -> prel, "Ước tính" -> est.
import csv, glob, json, os, re, sys
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
from names import std, key

ST = sys.argv[1]; TXT = sys.argv[2] if len(sys.argv) > 2 else 'data/interim/nso_dc'
YEARS = range(2019, 2027)
NSO = 'https://www.nso.gov.vn/wp-content/uploads/'
YB = {2024: NSO + '2026/01/NG-TONG-CUC-2024_OKIN_Final.pdf', 2023: NSO + '2024/06/NIEN-GIAM-THONG-KE-2023_Ban-quyen-1.pdf',
      2022: NSO + '2023/06/Sach-Nien-giam-TK-2022-final.pdf', 2021: NSO + '2022/08/Sach-Nien-giam-TK-2021-1.pdf',
      2020: NSO + '2021/07/Sach-NGTK-2020Ban-quyen.pdf', 2019: NSO + '2020/09/Nien-giam-thong-ke-day-du-2019.pdf'}

# indicator: (PX table, {variable text: value text} filter for the non-province, non-year variables)
PX = {
    'population': ('V02.03-07', {'Dân số trung bình': 'Tổng số'}),
    'urban_population': ('V02.03-07', {'Dân số trung bình': 'Thành thị'}),
    'sex_ratio': ('V02.09', {}),
    'crude_birth_rate': ('V02.12-14', {'Phân tổ': 'Tỷ suất sinh thô'}),
    'crude_death_rate': ('V02.12-14', {'Phân tổ': 'Tỷ suất chết thô'}),
    'total_fertility_rate': ('V02.16', {}),
    'infant_mortality': ('V02.18', {}),
    'population_growth_rate': ('V02.20', {}),
    'in_migration_rate': ('V02.21-23', {'Tỷ suất': 'Tỷ suất nhập cư'}),
    'out_migration_rate': ('V02.21-23', {'Tỷ suất': 'Tỷ suất xuất cư'}),
    'net_migration_rate': ('V02.21-23', {'Tỷ suất': 'Tỷ suất di cư thuần'}),
    'life_expectancy': ('V02.25', {}),
    'literacy_rate_15plus': ('V02.27', {}),
    'mean_age_first_marriage': ('V02.30', {}),
    'labour_force': ('V02.37', {}),
    'employed_workers': ('V02.45', {}),
    'informal_employment_rate': ('V02.51', {}),
    'trained_labour_share': ('V02.55', {}),
    'labour_productivity': ('V02.58', {}),
    'unemployment_rate': ('V02.63', {}),
    'underemployment_rate': ('V02.70', {}),
    'industrial_production_index': ('V07.02', {}),
    'new_enterprises': ('V05.02', {}),
    'active_enterprises': ('V05.04', {}),
    'enterprises_per_1000': ('V05.05', {}),
    'enterprises_with_results': ('V05.08', {}),
    'enterprise_employees': ('V05.11', {}),
    'enterprise_net_turnover': ('V05.23', {}),
    'enterprise_monthly_wage': ('V05.35', {}),
    'enterprise_profit': ('V05.38', {}),
    'cooperatives': ('V05.51', {}),
    'household_businesses': ('V05.54', {}),
    'household_business_workers': ('V05.56', {}),
    'divorces': ('V02.31', {'Cấp xét xử': 'Tổng số'}),
}
# units of series that exist only through PX (no 2025-yearbook rows to copy the unit from)
PX_UNIT = {'literacy_rate_15plus': '% of population 15+ (literate)'}


PX_REF = {'literacy_rate_15plus': ('2024/literacy_rate_15plus.csv', 2024)}


def per1000_check(rows):
    """V05.05 (enterprises per 1,000 people) must equal V05.04 (enterprises) / V02.03 (population) within 0.06."""
    a = px_rows('active_enterprises'); p = px_rows('population'); drop = {}
    for (s, y), (v, _, _) in rows.items():
        if (s, y) in a and (s, y) in p and abs(v - a[(s, y)][0] / p[(s, y)][0]) > 0.06:
            drop.setdefault(y, []).append(s)
    return drop


# scope breaks seen in the PX table itself: keep only the years comparable with the yearbook series
PX_ONLY_YEARS = {'divorces': ({2024}, 'V02.31 counts about 26-32 thousand divorces nationally for 2019-2023 and 182 '
                                      'thousand for 2024, which matches the 2025 yearbook; the earlier years count a '
                                      'narrower set of cases')}
PX_YEAR_CHECK = {'enterprises_per_1000': per1000_check}


def status_of(label):
    return 'prel' if ('Sơ bộ' in label or 'Prel' in label or 'prel' in label) else 'est' if ('Ước' in label or 'Est' in label or 'est.' in label) else 'final'


def px_rows(name):
    tab, flt = PX[name]
    d = json.load(open(f'{ST}/px/{tab}.json', encoding='utf-8'))
    V = d['meta']['variables']
    pi = next(i for i, v in enumerate(V) if len(v['values']) >= 63)
    yi = next(i for i, v in enumerate(V) if v['text'] == 'Năm')
    want = {i: v['values'][v['valueTexts'].index(flt[v['text']])] for i, v in enumerate(V) if v['text'] in flt}
    out = {}
    for r in d['data']['data']:
        k = r['key']
        if any(k[i] != c for i, c in want.items()): continue
        prov = V[pi]['valueTexts'][V[pi]['values'].index(k[pi])]
        ylab = V[yi]['valueTexts'][V[yi]['values'].index(k[yi])]
        s = NAT if prov.strip().upper() == 'CẢ NƯỚC' else std(prov); v = r['values'][0]
        if not s or v in ('', '..', '-', '.', '...'): continue
        y = int(re.search(r'(\d{4})', ylab)[1])
        out[(s, y)] = (float(v), status_of(ylab), f"{d['url']} (PX-Web {tab}, {ylab})")
    return out


NAT = 'CẢ NƯỚC'   # the national row, kept beside the provinces under this key (never written to a series)


# ---------- yearbook text tables (63 former provinces) ----------
NUM = re.compile(r'^-?[\d.]+(,\d+)?$|^-$|^\.\.$|^…$|^\.\.\.$')
def num(t): return None if t in ('-', '..', '…', '...') else float(t.replace('.', '').replace(',', '.'))
YR = re.compile(r'^(19|20)\d\d\**$')
def pages(path):
    P = {}; cur = None
    for l in open(path, encoding='utf-8'):
        m = re.match(r'=====PAGE (\d+)$', l.strip())
        if m: cur = int(m[1]); P[cur] = []; continue
        if cur: P[cur].append(l.rstrip('\n'))
    return P


STATUS_TOK = {'Sơ': 'prel', 'Prel.': 'prel', 'Prel': 'prel', 'Ước': 'est', 'Est.': 'est', 'Est': 'est'}
FILLER = {'bộ', 'tính', '-', '–'}


def norm_title(s):
    s = re.sub(r'\(cont\.?\)|\(tiếp theo\)|\(\*+\)|\*', ' ', s.lower())
    s = re.sub(r'\b(19|20)\d\d\b', ' ', s)
    return ' '.join(re.findall(r'[a-z]+', s))


def en_title(hdr):
    """The English title: the first header line after the chapter line made only of ASCII text with letters."""
    for h in hdr[1:]:
        if re.search(r'[A-Za-z]{3}', h) and all(ord(c) < 128 for c in h) and not re.match(r'^\d', h):
            return norm_title(h)
    return ''


def page_tables(P):
    """[(page, en_title, years [(y, status)], rows {std: (vals, trailing_blank)})] for pages with >= 10 province rows."""
    out = []
    for p, L in sorted(P.items()):
        rows = {}; hdr = []; ys = []; st = 'final'
        for l in L:
            t = l.split(); i = len(t)
            if not rows and t and all(YR.match(x) or x in STATUS_TOK or x in FILLER for x in t):
                for x in t:
                    if x in STATUS_TOK: st = STATUS_TOK[x]
                    elif YR.match(x): ys.append((int(x[:4]), st)); st = 'final'
                continue
            while i > 0 and NUM.match(t[i - 1]): i -= 1
            nm = ' '.join(t[:i]); vals = t[i:]
            if not vals:
                if not rows: hdr.append(l.strip())
                continue
            s = NAT if ('CẢ NƯỚC' in nm or 'WHOLE COUNTRY' in nm) else std(nm) if len(nm) < 40 else None
            if s and s not in rows: rows[s] = ([num(v) for v in vals], bool(re.search(r'\S\s{2,}$', l)))
        if len(rows) >= 10 and ys:   # 10: the second page of a 34-province table
            out.append((p, en_title(hdr), ys, rows))
    return out


def edition_tables(path):
    """{en_title: [(first page, last page, years, rows)]}: consecutive pages with the same title and years are one table."""
    T = {}
    for p, title, ys, rows in page_tables(pages(path)):
        lst = T.setdefault(title, [])
        if lst and lst[-1][1] >= p - 2 and lst[-1][2] == ys:
            a, _, _, r = lst[-1]; lst[-1] = (a, p, ys, {**rows, **r})
        else: lst.append((p, p, ys, rows))
    return T


def table_values(ys, rows):
    """{(std, year): (value, status)} from a table whose value columns are the years."""
    n = len(ys); out = {}
    for s, (vals, trail) in rows.items():
        if len(vals) == n: vv = vals
        elif len(vals) == n - 1 and trail: vv = vals + [None]
        else: continue
        for (y, stt), v in zip(ys, vv):
            if v is not None: out[(s, y)] = (v, stt)
    return out


UNMERGED = {'Hà Nội': 'Hà Nội', 'Huế': 'Thừa Thiên Huế', 'Lai Châu': 'Lai Châu', 'Điện Biên': 'Điện Biên', 'Sơn La': 'Sơn La',
            'Lạng Sơn': 'Lạng Sơn', 'Quảng Ninh': 'Quảng Ninh', 'Thanh Hóa': 'Thanh Hóa', 'Nghệ An': 'Nghệ An',
            'Hà Tĩnh': 'Hà Tĩnh', 'Cao Bằng': 'Cao Bằng'}   # 34-province name -> the one former province it equals


def decimals(x):
    t = repr(float(x)).rstrip('0').rstrip('.')
    return len(t.split('.')[1]) if '.' in t else 0


def agree(new, ref):
    """(years where fewer than 95% of shared provinces agree, shared years). Agreement = equal after rounding the new
    value to the reference's printed decimals (one rounding unit of slack), or within 0.05%."""
    shared = sorted({y for (_, y) in new} & {y for (_, y) in ref}); bad = []
    for y in shared:
        ks = [k for k in ref if k[1] == y and k in new]
        d = max(decimals(ref[k]) for k in ks) if ks else 0
        tol = 10 ** -d + 1e-9
        ok = sum(1 for k in ks if abs(new[k][0] - ref[k]) <= max(tol, abs(ref[k]) * 0.0005))
        if ks and ok < 0.95 * len(ks): bad.append((y, ok, len(ks)))
    return bad, shared


def main():
    have = {}; units = {}; files = sorted(glob.glob(f'{ST}/series/*.csv'))
    for f in files:
        n = os.path.basename(f)[:-4]
        for r in csv.DictReader(open(f, encoding='utf-8')):
            if MARK.search(r['source_url']): continue   # rows of an earlier backfill run: rebuilt below (idempotent)
            have.setdefault(n, {})[(r['province_std'], int(r['level']), int(r['year']))] = r
            units.setdefault((n, r['level']), r['unit'])
    rep = []; added = {}; natl = {}   # natl: (indicator, year) -> (value, status, source, unit), first source wins
    # 0. national rows of the 2025 yearbook tables the series cite
    yb25 = pages(f'{TXT}/NGTK2025.txt'); t25 = {p: (ys, rows) for p, title, ys, rows in page_tables(yb25)}
    for name, ex in have.items():
        for (s, l, y), r in sorted(ex.items(), key=lambda kv: -kv[0][1]):   # level 63 first
            m = re.search(r'NG-TOAN-QUOC-2025-1\.pdf.*table p\.(\d+)-(\d+)', r['source_url'])
            if not m: continue
            for p in range(int(m[1]), int(m[2]) + 1):
                if p in t25 and NAT in t25[p][1]:
                    for (k, yy), (v, stt) in table_values(*t25[p]).items():
                        if k == NAT and yy in YEARS: natl.setdefault((name, yy), (v, stt, r['source_url'], r['unit']))
                    break
    # 1. PX-Web
    for name in PX:
        rows = px_rows(name); ex = have.get(name, {})
        lv63 = {(s, y): float(r['value']) for (s, l, y), r in ex.items() if l == 63}
        via = 'L63'
        if name in PX_REF:   # validate against a latest-year file of the same indicator
            f, y0 = PX_REF[name]; via = f
            lv63 = {(r['province_std'], y0): float(r['value']) for r in csv.DictReader(open(f'{ST}/{f}', encoding='utf-8'))}
        if name in PX_YEAR_CHECK:   # drop whole years that fail an internal check of the PX table itself
            drop = PX_YEAR_CHECK[name](rows)
            if drop: rep.append(f'PX {name}: years {sorted(drop)} dropped (internal check failed: {drop})')
            rows = {k: v for k, v in rows.items() if k[1] not in drop}
        if name in PX_ONLY_YEARS:
            rows = {k: v for k, v in rows.items() if k[1] in PX_ONLY_YEARS[name][0]}
            rep.append(f'PX {name}: only {PX_ONLY_YEARS[name][0]} kept ({PX_ONLY_YEARS[name][1]})')
        if not lv63:   # no 63-level series yet: compare the 11 unmerged provinces with the 34-province series
            via = 'unmerged L34'
            lv63 = {(UNMERGED[s], y): float(r['value']) for (s, l, y), r in ex.items() if l == 34 and s in UNMERGED}
        bad, shared = agree(rows, lv63)
        if bad: rep.append(f'PX {name}: SKIPPED, disagrees with {via} on (year, ok, n) {bad}'); continue
        if not shared: rep.append(f'PX {name}: no shared year to validate against ({via})')
        unit = units.get((name, '63')) or units.get((name, '34')) or PX_UNIT.get(name)
        if not unit: rep.append(f'PX {name}: SKIPPED, no unit'); continue
        for (s, y), (v, stt, url) in rows.items():
            if s == NAT and y in YEARS: natl.setdefault((name, y), (v, stt, url, unit))
        new = [(s, y, v) for (s, y), v in rows.items() if y in YEARS and s != NAT and (s, 63, y) not in ex]
        for s, y, (v, stt, url) in new:
            ex[(s, 63, y)] = {'province_std': s, 'level': '63', 'year': str(y), 'value': v, 'unit': unit, 'source_url': url, 'status': stt}
        have[name] = ex
        added[name] = added.get(name, 0) + len(new)
        rep.append(f"PX {name}: +{len(new)} years={sorted({y for _, y, _ in new})} validated({via})={shared}")
    # 2. older yearbooks: the 2025 table's English title -> the same table in each older edition
    titles25 = {}
    for p, title, ys, rows in page_tables(yb25): titles25[p] = title
    eds = {e: edition_tables(f'{TXT}/NGTK{e}.txt') for e in sorted(YB, reverse=True)}
    for name in sorted(have):
        ex = have[name]
        src = next((r['source_url'] for (s, l, y), r in ex.items() if l == 63 and 'NG-TOAN-QUOC-2025' in r['source_url']), None)
        m = re.search(r'table p\.(\d+)', src or ''); title = titles25.get(int(m[1])) if m else None
        if name in SINGLE: continue
        ref = {(s, y): float(r['value']) for (s, l, y), r in ex.items() if l == 63}
        unit = next((r['unit'] for (s, l, y), r in ex.items() if l == 63), None); got = []
        if not unit: continue   # 34-province-only indicator
        for e, T in eds.items():
            # the same table in edition e: the one whose final years agree with the series (title as tie-break; titles
            # change wording between editions, e.g. "acting" -> "active enterprises")
            cands = []
            for t, lst in T.items():
                for a_, b_, ys, rows in lst:
                    vals = table_values(ys, rows)
                    fin = {k: v for k, v in vals.items() if v[1] == 'final'}
                    bad, shared = agree(fin, ref)
                    if not bad and not shared:   # e.g. HDI: the only reference year is this edition's preliminary one
                        fin = vals; bad, shared = agree(fin, ref)
                    n = len({k[0] for k in fin if k in ref})
                    if bad or not shared or n < 10: continue   # a table split over pages counts page by page
                    cands.append(((t == title, n), a_, b_, vals))
            for _, a_, b_, vals in sorted(cands, key=lambda c: c[0], reverse=True):
                for (s, y), (v, stt) in vals.items():
                    url = f'{YB[e]} (Statistical Yearbook {e}, table p.{a_}-{b_})'
                    if s == NAT:
                        if y in YEARS: natl.setdefault((name, y), (v, stt, url, unit))
                    elif y in YEARS and (s, 63, y) not in ex:
                        ex[(s, 63, y)] = {'province_std': s, 'level': '63', 'year': str(y), 'value': v, 'unit': unit, 'status': stt,
                                          'source_url': url}
                        got.append((e, y)); ref[(s, y)] = v
        added[name] = added.get(name, 0) + len(got)
        if got: rep.append(f"YB {name}: +{len(got)} {sorted(set(got))}")
        else: rep.append(f'YB {name}: nothing added')
    # national.csv (NSO's own national figures of the single-year 2025 tables) for the 2025 rows those tables lack
    for r in csv.DictReader(open(f'{ST}/national.csv', encoding='utf-8')):
        n = NATCSV.get(r['indicator'])
        if n and r['year'][:4] == '2025':
            unit = next(x['unit'] for (s, l, y), x in have[n].items() if y == 2025)
            natl.setdefault((n, 2025), (float(r['value']), status_of(r['year']) if '(' in r['year'] else 'final', r['source_url'], unit))
    appendix_stage(have, added, rep, yb25)
    single_stage(have, units, added, rep, natl)
    derive34(have, added, rep)
    print('\n'.join(rep))
    return have, added, natl


# single-year tables: each edition prints its own year (title regex -> year; column; summable for the national check)
SINGLE = {
    'fdi_projects': (r'foreign direct investment projects licensed in (\d{4}) by province', 0, 2, True),
    'fdi_registered_capital': (r'foreign direct investment projects licensed in (\d{4}) by province', 1, 2, True),
    'income_per_capita_monthly': (r'monthly average income per capita in (\d{4})\b', 0, 5, False),
}


def single_tables(path, rx, ncol):
    """{year: (first page, last page, {std: vals}, national vals)} of the pages whose English title matches rx."""
    out = {}
    for p, L in sorted(pages(path).items()):
        title = next((re.sub(r'^\(cont\.?\)\s*', '', l.strip(), flags=re.I) for l in L if re.match(r'(\(cont\.?\)\s*)?' + rx, l.strip().lower())), None)
        if not title: continue
        y = int(re.match(rx, title.lower())[1]); rows = {}; nat = None
        for l in L:
            t = l.split(); i = len(t)
            while i > 0 and NUM.match(t[i - 1]): i -= 1
            nm = ' '.join(t[:i]); vals = t[i:]
            if not vals: continue
            if 'TOTAL' in nm or 'CẢ NƯỚC' in nm: nat = [num(v) for v in vals]; continue
            s = std(nm) if len(nm) < 40 else None
            if s and s not in rows and len(vals) == ncol: rows[s] = [num(v) for v in vals]
            elif s and s not in rows and ncol == 2 and len(vals) == 1 and re.search(r'\S\s{2,}\S', l):
                rows[s] = [None, num(vals[0])]   # FDI: blank project count (supplementary capital only)
        cont = y in out and out[y][1] >= p - 2
        if len(rows) < (5 if cont else 20): continue
        if cont: a, _, r, n = out[y]; out[y] = (a, p, {**r, **rows}, n or nat)
        elif y not in out: out[y] = (p, p, rows, nat)
    return out


def single_stage(have, units, added, rep, natl):
    for name, (rx, col, ncol, summ) in SINGLE.items():
        ex = have[name]; unit = next(r['unit'] for (s, l, y), r in ex.items() if l == 63)
        unit = re.sub(r' in 20\d\d\b', ' in the year', unit)   # the 2024 file's unit names its year; the series has many
        for k, r in ex.items():
            if k[1] == 63: r['unit'] = unit
        ref = {(s, y): float(r['value']) for (s, l, y), r in ex.items() if l == 63}
        for e in sorted(YB, reverse=True):
            for y, (a, b, rows, nat) in single_tables(f'{TXT}/NGTK{e}.txt', rx, ncol).items():
                vals = {(s, y): (v[col], 'prel' if y == e else 'final') for s, v in rows.items() if v[col] is not None}
                if nat and y in YEARS:
                    natl.setdefault((name, y), (nat[col], 'prel' if y == e else 'final', f'{YB[e]} (Statistical Yearbook {e}, table p.{a}-{b})', unit))
                if any(k[1] == y for k in ref):   # the year we already have: the parse must reproduce it exactly
                    bad, _ = agree(vals, ref)
                    rep.append(f'SINGLE {name} {e}/{y}: {"MISMATCH " + str(bad) if bad else "reproduces existing"}')
                    continue
                tot = sum(v for v, _ in vals.values())
                if summ and (not nat or abs(tot - nat[col]) > max(1, abs(nat[col]) * 0.005)):
                    rep.append(f'SINGLE {name} {e}/{y}: SKIPPED, provinces sum {tot} != national {nat[col] if nat else None}'); continue
                if y not in YEARS: continue
                for (s, yy), (v, stt) in vals.items():
                    ex[(s, 63, yy)] = {'province_std': s, 'level': '63', 'year': str(yy), 'value': v, 'unit': unit, 'status': stt,
                                       'source_url': f'{YB[e]} (Statistical Yearbook {e}, table p.{a}-{b})'}
                ref.update({k: v for k, (v, _) in vals.items()})
                added[name] = added.get(name, 0) + len(vals)
                rep.append(f'SINGLE {name} {e}/{y}: +{len(vals)}' + (f' (sum {tot:.1f} = national {nat[col]})' if summ and nat else ''))


# 34-province appendix tables of the 2025 yearbook that spec34.py does not list: English title -> indicator
APPENDIX = {'number of active enterprises having business outcomes': 'enterprises_with_results',
            'index of industrial production in by province': 'industrial_production_index'}
APP_FIRST = 1141   # first appendix page
URL25 = 'https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf'


def appendix_stage(have, added, rep, yb25):
    to34 = {'Thừa Thiên Huế': 'Huế'}
    tabs = {}
    for p, title, ys, rows in page_tables(yb25):
        if p >= APP_FIRST and title in APPENDIX:
            lst = tabs.setdefault(title, [])
            if lst and lst[-1][1] >= p - 2 and lst[-1][2] == ys: a, _, _, r = lst[-1]; lst[-1] = (a, p, ys, {**r, **rows})
            else: lst.append((p, p, ys, rows))
    for title, lst in tabs.items():
        name = APPENDIX[title]; ex = have[name]
        unit = next(r['unit'] for (s, l, y), r in ex.items() if l == 63)
        ref = {(UNMERGED[s34], y): float(r['value']) for (s, l, y), r in ex.items()
               for s34 in [next((k for k, v in UNMERGED.items() if v == s), None)] if l == 63 and s34}
        for a, b, ys, rows in lst:
            vals = {k: v for k, v in table_values(ys, rows).items() if k[0] != NAT}
            bad, shared = agree({(UNMERGED.get(to34.get(s, s), s) if to34.get(s, s) in UNMERGED else s, y): v
                                 for (s, y), v in vals.items()}, ref)
            if bad or not shared: rep.append(f'APPX {name} p.{a}: not used ({bad or "no shared year"})'); continue
            n = 0
            for (s, y), (v, stt) in vals.items():
                s34 = to34.get(s, s)
                if y in YEARS and (s34, 34, y) not in ex:
                    ex[(s34, 34, y)] = {'province_std': s34, 'level': '34', 'year': str(y), 'value': v, 'unit': unit, 'status': stt,
                                        'source_url': f'{URL25} (Appendix, Statistical Yearbook 2025, table p.{a}-{b})'}
                    n += 1
            added[name] = added.get(name, 0) + n
            rep.append(f'APPX {name} p.{a}-{b}: +{n} years={sorted({y for _, y in vals})} validated(unmerged L63)={shared}')


NATCSV = {'fdi': 'fdi_registered_capital', 'fdi_projects': 'fdi_projects', 'income': 'income_per_capita_monthly'}
SWAPPED = ('cereal_production', 'paddy_area', 'paddy_production')   # as series.py: appendix rows swapped


def derive34(have, added, rep):
    """34-province cereal/paddy for the new years = sums of the 63 former provinces (as series.py does for 2020-2025)."""
    sys.path.insert(0, os.path.dirname(D)); from admin import NEW
    new_of = {std(o.replace('–', ' - ')): n for n, (_, olds) in NEW.items() for o in olds}
    for name in SWAPPED:
        ex = have[name]; by = {}
        for (s, l, y), r in ex.items():
            if l == 63: by.setdefault(y, []).append(r)
        tmpl = next(r for (s, l, y), r in ex.items() if l == 34)
        for y, rs in sorted(by.items()):
            if len(rs) != 63 or any(k[1] == 34 and k[2] == y for k in ex): continue
            agg = {}
            for r in rs: agg[new_of[r['province_std']]] = agg.get(new_of[r['province_std']], 0) + float(r['value'])
            st = 'prel' if any(r['status'] == 'prel' for r in rs) else 'final'
            src = sorted({r['source_url'] for r in rs})[0]
            for n, v in agg.items():
                ex[(n, 34, y)] = {'province_std': n, 'level': '34', 'year': str(y), 'value': round(v, 1), 'unit': tmpl['unit'],
                                  'source_url': src, 'status': st}
            added[name] = added.get(name, 0) + len(agg); rep.append(f'DERIVED {name} L34 {y}: sums of the 63 ({src[-45:]})')


MARK = re.compile(r'\((PX-Web V|Statistical Yearbook 20\d\d, table|Appendix, Statistical Yearbook 2025, table)')
COLS = ['province_std', 'level', 'year', 'value', 'unit', 'source_url', 'status']


def write(have, added, natl):
    with open(f'{ST}/series_national.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['indicator', 'year', 'value', 'unit', 'source_url', 'status'])
        for (n, y), (v, stt, url, unit) in sorted(natl.items()): w.writerow([n, y, v, unit, url, stt])
    print(len(natl), 'national rows')
    for name, n in sorted(added.items()):
        if not n: continue
        rows = sorted(have[name].values(), key=lambda r: (-int(r['level']), r['province_std'], int(r['year'])))
        with open(f'{ST}/series/{name}.csv', 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, COLS, extrasaction='ignore'); w.writeheader(); w.writerows(rows)
    print(sum(added.values()), 'rows added to', sum(1 for n in added.values() if n), 'series')


if __name__ == '__main__':
    write(*main())
