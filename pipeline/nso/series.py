# usage: series.py YB2025.json YB2025.txt data/stats
# Long-format year series (data/stats/series/<indicator>.csv) from every year column of the 2025 yearbook tables listed in
# spec63.py (Part I, level 63) and spec34.py (appendix, level 34), plus the single-year files listed in EXTRA.
# Columns: province_std, level, year, value, unit, source_url, status (final | prel | est). Missing years have no row.
# Raw NSO units (as in the latest-year files); money stays in VND (convert each year at its own World Bank rate).
# The appendix rice/cereal tables (A75-A79) swap Gia Lai and Khánh Hòa, so their 34-province series are rebuilt by
# summing the 63 former provinces (pipeline/admin.py NEW), only for years where all 63 are published.
import csv,json,os,re,sys
D=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,os.path.dirname(D)); sys.path.insert(0,D)
from admin import NEW; from names import std
import spec63,spec34
T=json.load(open(sys.argv[1],encoding='utf-8')); TXT=sys.argv[2]; ST=sys.argv[3]
URL='https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf'
SWAPPED={'cereal_production','paddy_area','paddy_production'}   # rebuilt from level 63; A76/A78 (per capita, yield) dropped
DROP={'cereal_per_capita','paddy_yield'}
# indicator: [(csv relative to data/stats, level, year, status)] single-year values from other files
# indicator: [(csv relative to data/stats, level, year)] single-year values from other files; the status comes from each
# file's year column ("2025 (prel.)" → prel), as its table's footnote says
EXTRA={'income_per_capita_monthly':[('2024/income_per_capita_monthly.csv',63,2024),('2025/income_per_capita_monthly.csv',63,2025),('p34/income_per_capita_monthly.csv',34,2025)],
       'hdi':[('2024/hdi.csv',63,2024)],
       'fdi_registered_capital':[('2024/fdi_registered_capital_2024.csv',63,2024),('p34/fdi_registered_capital_2025.csv',34,2025)],
       'fdi_projects':[('2024/fdi_projects_2024.csv',63,2024),('p34/fdi_projects_2025.csv',34,2025)],
       'income_quintile_ratio':[('2025/income_quintile_ratio.csv',63,2025),('p34/income_quintile_ratio.csv',34,2025)]}
def status_of(year_label): return 'prel' if 'prel' in year_label else 'est' if 'est' in year_label else 'final'
pages={};cur=None
for l in open(TXT,encoding='utf-8'):
    m=re.match(r'=====PAGE (\d+)$',l.strip())
    if m: cur=int(m[1]);pages[cur]=[];continue
    if cur: pages[cur].append(l.rstrip('\n'))
STATUS={'Sơ':'prel','Ước':'est'}
def years(tk,n):
    """[(year, status)] of the table's value columns, read from its first page's column header; None if not years."""
    d=T[tk]; out=[]; st='final'
    for l in pages[d['pages'][0]]:
        t=l.split()
        if not t or not all(re.fullmatch(r'20\d\d\**',x) or x in('Sơ','bộ','Prel.','Ước','tính','Est.') for x in t): continue
        for x in t:
            if x in STATUS: st=STATUS[x]
            elif re.fullmatch(r'20\d\d\**',x): out.append([int(x[:4]),st]); st='final'
        if len(out)>=n: break
    if len(out)!=n: return None
    if 'Sơ bộ' in d['header'] and all(s=='final' for _,s in out): out[-1][1]='prel'   # "Sơ bộ" set apart above the last year
    return out
def table_rows(tk,level,unit):
    d=T[tk]; n=max(len(v[1]) for v in d['rows'].values()); ys=years(tk,n)
    if not ys or n<2: return None,0
    rows=[];skipped=0
    for s,(nm,vals,trail) in d['rows'].items():
        if len(vals)==n: vv=vals
        elif len(vals)==n-1 and trail: vv=vals+[None]          # pypdf trailing spaces: the last cell is blank
        else: skipped+=1; continue
        for (y,stt),v in zip(ys,vv):
            if v is not None: rows.append([s,level,y,v,unit,f"{URL} ({'Part I' if level==63 else 'Appendix'}, table p.{d['pages'][0]}-{d['pages'][-1]})",stt])
    return rows,skipped
def norm(name): return re.sub(r'_20\d\d$','',name)
out={};rep=[]
for level,specs in ((63,spec63.SPECS),(34,spec34.SPECS)):
    seen=set()
    for sp in specs:
        name,tk,unit=norm(sp[0]),sp[1],sp[4]
        if (name,tk) in seen or name in DROP or (level==34 and name in SWAPPED): continue
        seen.add((name,tk))
        if sum(1 for x in specs if x[1]==tk)>1: continue   # several indicators share the table: columns are not years
        rows,sk=table_rows(tk,level,unit)
        if rows: out.setdefault(name,[]).extend(rows); rep.append(f"{name} L{level} {tk} years={sorted({r[2] for r in rows})} skipped_rows={sk}")
new_of={std(o.replace('–',' - ')):n for n,(_,olds) in NEW.items() for o in olds}
for name in SWAPPED:
    by={}
    for r in out.get(name,[]):
        if r[1]==63: by.setdefault(r[2],[]).append(r)
    for y,rs in sorted(by.items()):
        if len(rs)!=63: continue
        agg={}
        for r in rs: agg[new_of[r[0]]]=agg.get(new_of[r[0]],0)+r[3]
        out[name]+= [[n,34,y,round(v,1),rs[0][4]+' (DERIVED: sum of former provinces; appendix rows for Gia Lai/Khánh Hòa are swapped)',rs[0][5],rs[0][6]] for n,v in agg.items()]
    rep.append(f"{name} L34 rebuilt from L63 years={sorted(y for y,rs in by.items() if len(rs)==63)}")
for name,srcs in EXTRA.items():
    have={(r[1],r[2]) for r in out.get(name,[])}
    for f,level,y in srcs:
        if (level,y) in have: continue
        for r in csv.DictReader(open(f'{ST}/{f}',encoding='utf-8')):
            out.setdefault(name,[]).append([r['province_std'],level,y,float(r['value']),r['unit'],r['source_url'],status_of(r['year'])])
    rep.append(f"{name} extra {[(l,y) for _,l,y in srcs]}")
os.makedirs(f'{ST}/series',exist_ok=True)
for name,rows in sorted(out.items()):
    rows.sort(key=lambda r:(-r[1],r[0],r[2]))
    with open(f'{ST}/series/{name}.csv','w',newline='',encoding='utf-8') as f:
        w=csv.writer(f);w.writerow(['province_std','level','year','value','unit','source_url','status']);w.writerows(rows)
print('\n'.join(rep)); print(len(out),'series files')
