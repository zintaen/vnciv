import openpyxl,csv,sys,os
sys.path.insert(0,os.path.dirname(__file__)); from names import std
src,out,YEAR,URL,fn=sys.argv[1:6]
ws=openpyxl.load_workbook(src,read_only=True,data_only=True)['Tổng hợp']
rows=list(ws.iter_rows(values_only=True)); hdr=rows[0]
miss=[];n=0;seen=set()
with open(f'{out}/{fn}','w',newline='') as f:
    w=csv.writer(f);w.writerow(['province_name_vi','value','year','unit','source_url','province_std'])
    for r in rows[1:]:
        if not r[0]: continue
        s=std(r[0])
        if not s: print('skip row',r[0]); continue
        if s in seen: print('dup row',r[:2]); continue
        seen.add(s)
        if r[1] is None: miss.append(r[0]); continue
        w.writerow([r[0],round(r[1],2),YEAR,'PCI composite score (0-100)',URL+" (sheet Tổng hợp)",s]); n+=1
print('pci',n,'missing composite:',miss)
