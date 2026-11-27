# usage: derive2025.py data/stats
# Derived 2025 files, computed only from the official CSVs already in data/stats/:
# * 2025/grdp_total_derived.csv = GRDP per person (2025 est.) x average population (2025 prel.); NSO publishes no total GRDP by province.
# * p34/{cereal_production,paddy_area,paddy_production,paddy_yield,cereal_per_capita}.csv: the yearbook appendix tables
#   A75-A79 swap the Gia Lai and Khánh Hòa rows, so these 34-province files are rebuilt from the 63 former provinces
#   (Part I) summed with pipeline/admin.py NEW (yield = production / area; per person = cereal / population 2025).
import csv,sys,os
D=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,os.path.dirname(D)); sys.path.insert(0,D)
from admin import NEW; from names import std
ST=sys.argv[1]
HEAD=['province_name_vi','value','year','unit','source_url','province_std']
def load(p): return {r['province_std']:r for r in csv.DictReader(open(p,encoding='utf-8'))}
def write(p,rows):
    with open(p,'w',newline='',encoding='utf-8') as f: w=csv.writer(f);w.writerow(HEAD);w.writerows(rows)
    print(os.path.relpath(p,ST),len(rows))
pop=load(f'{ST}/2025/population_2025.csv'); gpc=load(f'{ST}/2025/grdp_per_capita.csv')
write(f'{ST}/2025/grdp_total_derived.csv',[[p['province_name_vi'],round(float(gpc[s]['value'])*float(p['value'])),'2025 (est.)',
      'billion VND, current prices (DERIVED: grdp_per_capita [mill VND, 2025 est.] x population_2025 [thous., prel.]; per-capita rounded to 0.1 so ~0.1% error)',
      gpc[s]['source_url']+' ; '+p['source_url'],s] for s,p in pop.items()])
new_of={std(o.replace('–',' - ')):n for n,(_,olds) in NEW.items() for o in olds}
assert None not in new_of and len(new_of)==63
def agg(name):
    rows=load(f'{ST}/2025/{name}.csv'); out={}
    for s,r in rows.items(): out[new_of[s]]=out.get(new_of[s],0)+float(r['value'])
    return out,next(iter(rows.values()))
NOTE='(DERIVED: sum of the former provinces in Part I, {src}; replaces appendix {tab}, whose Gia Lai and Khánh Hòa rows are swapped)'
sums={}
for name,tab in (('cereal_production','A75'),('paddy_area','A77'),('paddy_production','A79')):
    v,r0=agg(name); sums[name]=v
    src=r0['source_url'].split(' (table ')[-1].rstrip(')')
    write(f'{ST}/p34/{name}.csv',[[n,round(x,1),r0['year'],r0['unit']+' '+NOTE.format(src='table '+src,tab=tab),r0['source_url'],n] for n,x in v.items()])
p34=load(f'{ST}/p34/population_2025.csv')
pp,pa,cp=sums['paddy_production'],sums['paddy_area'],sums['cereal_production']
write(f'{ST}/p34/paddy_yield.csv',[[n,round(pp[n]/pa[n]*10,1),'2025 (prel.)','quintal/ha (DERIVED: paddy_production / paddy_area of the summed former provinces; replaces appendix A78, Gia Lai/Khánh Hòa swapped)',
      'data/stats/p34/paddy_production.csv ; data/stats/p34/paddy_area.csv',n] for n in pp if pa[n]])
write(f'{ST}/p34/cereal_per_capita.csv',[[n,round(cp[n]*1000/float(p34[n]['value']),1),'2025 (prel.)','kg per person (DERIVED: cereal_production / population_2025; replaces appendix A76)',
      'data/stats/p34/cereal_production.csv ; '+p34[n]['source_url'],n] for n in cp])
