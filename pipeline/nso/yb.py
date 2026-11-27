# Parse by-province tables from NSO Statistical Yearbook 2024 text (pypdf extract).
import re,csv,sys,os
sys.path.insert(0,os.path.dirname(__file__)); from names import std
TXT=sys.argv[1]; OUT=sys.argv[2]
SRC="https://www.nso.gov.vn/wp-content/uploads/2026/01/NG-TONG-CUC-2024_OKIN_Final.pdf"
pages={};cur=None
for l in open(TXT,encoding='utf-8'):
    m=re.match(r'=====PAGE (\d+)$',l.strip())
    if m: cur=int(m[1]);pages[cur]=[];continue
    if cur: pages[cur].append(l.rstrip('\n'))
NUM=re.compile(r'^-?[\d.]+(,\d+)?$|^-$|^\.\.$')
def num(t):
    if t in('-','..'): return None
    return float(t.replace('.','').replace(',','.'))
# name, pages, ncols, col, year, unit, table no
SPECS=[
 ('area_km2',(103,104),3,0,'2023-12-31','km2','T19'),
 ('population_2024',(106,107),5,4,'2024 (prel.)','thousand persons','T21'),
 ('urban_population',(112,113),5,4,'2024 (prel.)','thousand persons','T24'),
 ('labour_force',(163,164),5,4,'2024 (prel.)','thousand persons (15+)','T55'),
 ('employed_workers',(173,174),5,4,'2024 (prel.)','thousand persons','T62'),
 ('literacy_rate_15plus',(147,148),5,4,'2024 (prel.)','%','T45'),
 ('trained_labour_share',(183,184),5,4,'2024 (prel.)','% of labour force 15+','T70'),
 ('labour_productivity',(189,190),5,4,'2024 (prel.)','million VND per employed person','T73'),
 ('unemployment_rate',(194,195),5,4,'2024 (prel.)','% of working-age labour force','T77'),
 ('grdp_per_capita',(254,255),5,4,'2024 (prel.)','million VND','T95'),
 ('fdi_projects_2024',(355,356),2,0,'2024','number of newly licensed projects','T138'),
 ('fdi_registered_capital_2024',(355,356),2,1,'2024','million USD total registered FDI capital in 2024 (new + supplementary + capital contributions; can be negative)','T138'),
 ('paddy_production',(602,603),5,4,'2024 (prel.)','thousand tonnes','T paddy'),
 ('retail_sales',(718,719),5,4,'2024 (prel.)','billion VND (current prices)','T272'),
 ('tourism_travel_turnover',(752,753),5,4,'2024 (prel.)','billion VND (travel agency turnover, current prices)','T294'),
 ('university_students',(933,934),5,4,'2023','persons','T381'),
 ('university_lecturers',(931,932),5,4,'2023','persons','T380'),
 ('income_per_capita_monthly',(1007,1009),None,0,'2024','thousand VND per person per month','T403'),
 ('income_per_employee_monthly',(1022,1023),5,4,'2024 (prel.)','thousand VND per month','T411'),
 ('hdi',(1024,1025),5,4,'2024 (prel.)','index 0-1','T412'),
 ('gini',(1027,1028),5,4,'2024 (prel.)','index 0-1','T414'),
 ('poverty_rate_multidimensional',(1036,1037),5,4,'2024 (prel.)','% of households (MPI standard 2022-2025)','T422'),
]
only=sys.argv[3:]
for name,(a,b),nc,col,year,unit,tab in SPECS:
    if only and name not in only: continue
    rows={};bad=[]
    for p in range(a,b+1):
        for l in pages.get(p,[]):
            t=l.split()
            i=len(t)
            while i>0 and NUM.match(t[i-1]): i-=1
            nm=' '.join(t[:i]); vals=t[i:]
            s=std(nm) if vals else None
            if not s: continue
            if nc and len(vals)!=nc: bad.append((nm,vals))
            if s in rows: continue
            # short rows: blanks are leading (earlier years / project count), so right-align
            if nc and len(vals)<nc and re.search(r'\d\s{2,}$',l): vals=vals+[None]  # pypdf leaves 2+ trailing spaces when the last cell is blank
            vv=vals if (nc is None or len(vals)>=nc) else [None]*(nc-len(vals))+vals
            v=num(vv[col]) if vv[col] is not None else None
            vals=[x for x in vals if x is not None]
            rows[s]=(nm,v,vals)
    with open(f"{OUT}/{name}.csv","w",newline='') as f:
        w=csv.writer(f);w.writerow(['province_name_vi','value','year','unit','source_url','province_std'])
        for s,(nm,v,_) in rows.items():
            if v is not None: w.writerow([nm,v,year,unit,f"{SRC} ({tab}, p.{a}-{b})",s])
    print(f"{name:32s} matched={len(rows)} values={sum(1 for r in rows.values() if r[1] is not None)} bad={bad[:4]}")
