# Derived indicators, computed only from downloaded official values in out/.
import csv,sys
O=sys.argv[1]
def load(f,**flt):
    return {r['province_std']:r for r in csv.DictReader(open(f'{O}/{f}')) if all(r.get(k)==v for k,v in flt.items())}
def write(name,rows):
    with open(f'{O}/{name}.csv','w',newline='') as f:
        w=csv.writer(f);w.writerow(['province_name_vi','value','year','unit','source_url','province_std']);w.writerows(rows)
    print(name,len(rows))
pop=load('population_2024.csv');urb=load('urban_population.csv');gpc=load('grdp_per_capita.csv')
write('urbanisation_rate',[[p['province_name_vi'],round(float(urb[s]['value'])/float(p['value'])*100,1),'2024 (prel.)','% of average population living in urban areas (DERIVED: urban_population / population_2024)',urb[s]['source_url']+' ; '+p['source_url'],s] for s,p in pop.items()])
write('grdp_total_derived',[[p['province_name_vi'],round(float(gpc[s]['value'])*float(p['value'])),'2024 (prel.)','billion VND, current prices (DERIVED: grdp_per_capita [mill VND] x population_2024 [thous.]; per-capita rounded to 0.1 so ~0.1% error)',gpc[s]['source_url'],s] for s,p in pop.items()])
t19=load('population_series.csv',series='total',year='2019');t24=load('population_series.csv',series='total',year='2024')
write('population_growth_2019_2024',[[r['province_name_vi'],round((float(t24[s]['value'])/float(r['value'])-1)*100,2),'2019-2024','% change in average population (DERIVED from population_series)',r['source_url'],s] for s,r in t19.items()])
