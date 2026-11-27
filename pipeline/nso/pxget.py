# usage: pxget.py OUTDIR "db/table.px" ...  -> saves meta + data json
import json,sys,urllib.request,urllib.parse,os,time
import socket
_g=socket.getaddrinfo
# ponytail: pinned IP because local DNS SERVFAILs intermittently for this host
socket.getaddrinfo=lambda h,*a,**k:_g("210.245.31.110" if h=="pxweb.nso.gov.vn" else h,*a,**k)
B="https://pxweb.nso.gov.vn/api/v1/vi/"
out=sys.argv[1]
def op(r,**k):
    for i in range(5):
        try: return json.load(urllib.request.urlopen(r,**k))
        except Exception as e: print('retry',e,file=sys.stderr); time.sleep(3)
    raise SystemExit('fail')
for t in sys.argv[2:]:
    n=t.split('/')[-1].replace('.px','')
    if os.path.exists(f"{out}/{n}.json"): continue
    u=B+urllib.parse.quote(t)
    meta=op(u,timeout=60)
    q={"query":[{"code":v['code'],"selection":{"filter":"all","values":["*"]}} for v in meta['variables']],"response":{"format":"json"}}
    req=urllib.request.Request(u,data=json.dumps(q).encode(),headers={'Content-Type':'application/json'})
    data=op(req,timeout=120)
    n=t.split('/')[-1].replace('.px','')
    json.dump({"url":u,"meta":meta,"data":data},open(f"{out}/{n}.json","w"),ensure_ascii=False)
    print(n,meta['title'],[ (v['code'],len(v['values'])) for v in meta['variables']],len(data['data']))
    time.sleep(0.5)
