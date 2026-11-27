import json,sys,urllib.request,urllib.parse,time
B="https://pxweb.nso.gov.vn/api/v1/vi/"
def get(path):
    u=B+urllib.parse.quote(path)
    for i in range(3):
        try: return json.load(urllib.request.urlopen(u,timeout=40))
        except Exception as e: err=e; time.sleep(1)
    print("ERR",path,err,file=sys.stderr); return []
def walk(path):
    for it in get(path):
        p=path+"/"+it['id'] if path else it.get('dbid')
        if 'dbid' in it: walk(it['dbid']); continue
        if it.get('type')=='l': walk(p)
        else: print(p+"\t"+it['text'],flush=True)
walk("")
