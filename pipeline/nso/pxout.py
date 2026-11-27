# Tidy export of PX-Web json (from pxget.py): population series by province.
import json,csv,sys,os
sys.path.insert(0,os.path.dirname(__file__)); from names import std
d=json.load(open(sys.argv[1])); out=sys.argv[2]
V=d['meta']['variables']; txt=[dict(zip(v['values'],v['valueTexts'])) for v in V]
rows=[]
for r in d['data']['data']:
    k=[txt[i][c] for i,c in enumerate(r['key'])]; val=r['values'][0]
    rows.append((k,val))
with open(f'{out}/population_series.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['province_name_vi','value','year','unit','source_url','province_std','series'])
    n=0
    for (prov,ser,yr),val in rows:
        s=std(prov)
        if not s or ser not in('Tổng số','Thành thị') or val in('..','-',''): continue
        y=yr.replace('Sơ bộ ','')
        if int(y)<2019: continue
        w.writerow([prov,float(val),yr,'thousand persons (average population)',d['url'],s,'total' if ser=='Tổng số' else 'urban']); n+=1
print('rows',n)
