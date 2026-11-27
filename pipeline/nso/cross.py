# usage: cross.py data/stats
# Cross-check: aggregate 63-province CSVs to the 34 new provinces (pipeline/admin.py NEW) and compare with the appendix CSVs.
import csv,sys,os,glob
D=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,os.path.dirname(D)); sys.path.insert(0,D); ST=sys.argv[1]  # data/stats
from admin import NEW; from names import std
new_of={std(o.replace('–',' - ')):n for n,(_,olds) in NEW.items() for o in olds}
assert None not in new_of and len(new_of)==63, new_of
rd=lambda p:{r['province_std']:float(r['value']) for r in csv.DictReader(open(p))}
for f in sorted(glob.glob(f'{ST}/2025/*.csv')):
    n=os.path.basename(f); g=f'{ST}/p34/'+n
    if not os.path.exists(g): continue
    a=rd(f); b=rd(g); agg={}
    for s,v in a.items(): agg[new_of[s]]=agg.get(new_of[s],0)+v
    # summable only if totals agree; otherwise compare the 11 unmerged provinces
    same=[k for k in b if k in agg and len(NEW[k][1])==1]
    d_un=max((abs(agg[k]-b[k]) for k in same),default=0)
    d_all=max((abs(agg[k]-b[k])/max(abs(b[k]),1e-9) for k in b if k in agg),default=0)
    print(f"{n:38s} unmerged maxabsdiff={d_un:.3g}  merged-sum maxreldiff={100*d_all:.2f}%")
