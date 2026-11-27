# Emit tidy CSVs from dump.py JSON. spec: (csv name, table key, column (neg = from right), year label, unit, summable)
import json,csv,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
T=json.load(open(sys.argv[1])); OUT=sys.argv[2]; SRC=sys.argv[3]; SPECS=__import__(sys.argv[4]).SPECS
os.makedirs(OUT,exist_ok=True); rep=[]
for sp in SPECS:
    name,tk,col,year,unit,summ=sp[:6]; al=sp[6] if len(sp)>6 else ''
    d=T[tk]; n=max(len(v[1]) for v in d['rows'].values()); rows=[];skipped=[]
    for s,(nm,vals,trail) in d['rows'].items():
        if len(vals)==n: v=vals[col]
        elif al=='R': v=([None]*(n-len(vals))+vals)[col]   # blanks are leading cells
        elif al=='L' and col<len(vals): v=vals[col]          # blanks are after this cell
        elif col==0 or (col==-1 and not trail): v=vals[col]   # leading total present / last cell present
        elif col==-1 and trail: v=None                        # pypdf trailing spaces = blank last cell
        else: skipped.append(s); continue
        if v is not None: rows.append((nm,v,s))
    with open(f"{OUT}/{name}.csv","w",newline='') as f:
        w=csv.writer(f);w.writerow(['province_name_vi','value','year','unit','source_url','province_std'])
        for nm,v,s in rows: w.writerow([nm,v,year,unit,f"{SRC} (table p.{d['pages'][0]}-{d['pages'][-1]})",s])
    nat=d['nat'][col] if d['nat'] and len(d['nat'])==n else None
    tot=round(sum(r[1] for r in rows),2)
    chk='' if not summ or nat is None else f"sum={tot} nat={nat} diff={round(100*(tot-nat)/nat,2) if nat else 'na'}%"
    rep.append(f"{name:40s} {tk:6s} n={len(rows):2d} skipped={skipped} {chk}")
print('\n'.join(rep))
