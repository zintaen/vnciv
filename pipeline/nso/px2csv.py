# PX json (pxget.py) -> tidy CSV of the latest year, 63 provinces; checks sum vs CẢ NƯỚC when summable
import json,csv,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); from names import std
f,out,unit,summ=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]=='1'
d=json.load(open(f)); m=d['meta']['variables']; P,Y=m[0],m[1]
yi=len(Y['values'])-1; ylab=Y['valueTexts'][yi]
rows=[];nat=None
for r in d['data']['data']:
    p,y=r['key'][0],r['key'][1]
    if int(y)!=int(Y['values'][yi]) and y!=Y['values'][yi]: continue
    nm=P['valueTexts'][P['values'].index(p)]; v=r['values'][0]
    if v in('','..','-','.'): continue
    if nm.strip().upper()=='CẢ NƯỚC': nat=float(v); continue
    s=std(nm)
    if s: rows.append((nm,float(v),s))
year=ylab.replace('Sơ bộ ','')+(' (prel.)' if 'Sơ bộ' in ylab else '')
with open(out,'w',newline='') as g:
    w=csv.writer(g); w.writerow(['province_name_vi','value','year','unit','source_url','province_std'])
    for nm,v,s in rows: w.writerow([nm,v,year,unit,d['url'],s])
print(out,len(rows),year, f"sum={sum(r[1] for r in rows)} nat={nat}" if summ else '')
