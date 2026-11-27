# Dump every by-province table of the NSO yearbook text into JSON: {table_key: {pages, title, header, rows{std:[nm,vals]}, nat}}
import re,sys,json,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); from names import key,CANON
NEW=['Hà Nội','Huế','Lai Châu','Điện Biên','Sơn La','Lạng Sơn','Quảng Ninh','Thanh Hóa','Nghệ An','Hà Tĩnh','Cao Bằng','Tuyên Quang','Lào Cai','Thái Nguyên','Phú Thọ','Bắc Ninh','Hưng Yên','Hải Phòng','Ninh Bình','Quảng Trị','Đà Nẵng','Quảng Ngãi','Gia Lai','Khánh Hòa','Lâm Đồng','Đắk Lắk','TP. Hồ Chí Minh','Đồng Nai','Tây Ninh','Cần Thơ','Vĩnh Long','Đồng Tháp','Cà Mau','An Giang']
def k2(s): return key(s).replace('thừathiên','')
KN={k2(n):n for n in NEW}; KN.update({'hồchíminh':'TP. Hồ Chí Minh','hcm':'TP. Hồ Chí Minh'})
KO={key(c):c for c in CANON}; KO.update({'brvt':'Bà Rịa - Vũng Tàu','hồchíminh':'TP. Hồ Chí Minh','huế':'Thừa Thiên Huế'})
TXT,APP,OUT=sys.argv[1],int(sys.argv[2]),sys.argv[3]   # APP = first page of the 34-province appendix (0 = none)
pages={};cur=None
for l in open(TXT,encoding='utf-8'):
    m=re.match(r'=====PAGE (\d+)$',l.strip())
    if m: cur=int(m[1]);pages[cur]=[];continue
    if cur: pages[cur].append(l.rstrip('\n'))
NUM=re.compile(r'^-?[\d.]+(,\d+)?$|^-$|^\.\.$|^…$|^\.\.\.$')
def num(t):
    if t in('-','..','…','...'): return None
    return float(t.replace('.','').replace(',','.'))
T={}
for p,L in sorted(pages.items()):
    ne=[x.strip() for x in L if x.strip()]
    if len(ne)<5 or not re.fullmatch(r'\d{1,3}|[\d]+ ?\(?[a-z]?\)?',ne[-1]): continue
    tab=ne[-1].split()[0]
    app=APP and p>=APP
    K=KN if app else KO
    rows={};nat=None;hdr=[];seen_data=False
    for l in L:
        t=l.split(); i=len(t)
        while i>0 and NUM.match(t[i-1]): i-=1
        nm=' '.join(t[:i]); vals=t[i:]
        if not vals:
            if not seen_data: hdr.append(l.strip())
            continue
        if 'CẢ NƯỚC' in nm or 'WHOLE COUNTRY' in nm: nat=[num(v) for v in vals]; seen_data=True; continue
        s=K.get(key(nm).replace('thừathiên','') if app else key(nm))
        if s and len(nm)<40:
            seen_data=True
            trail=bool(re.search(r'\S\s{2,}$',l))
            rows.setdefault(s,[nm,[num(v) for v in vals],trail])
    if not rows: continue
    tk=('A' if app else 'P')+tab
    # same footer number can recur in Part I across chapters: split when pages not contiguous
    while tk in T and T[tk]['pages'][-1] < p-3: tk+="'"
    d=T.setdefault(tk,{'pages':[],'title':' '.join(h for h in hdr[:4] if h)[:200],'header':' | '.join(h for h in hdr if h)[:600],'rows':{},'nat':None})
    d['pages'].append(p)
    for s,v in rows.items(): d['rows'].setdefault(s,v)
    if nat and d['nat'] is None: d['nat']=nat
json.dump(T,open(OUT,'w'),ensure_ascii=False,indent=0)
for k,d in T.items(): print(k,d['pages'][0],len(d['rows']),d['title'][:110])
