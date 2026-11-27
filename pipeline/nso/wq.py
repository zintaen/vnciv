import json,sys,urllib.request,urllib.parse
def api(lang,**p):
    p.setdefault('format','json')
    u=f"https://{lang}.wikipedia.org/w/api.php?"+urllib.parse.urlencode(p)
    r=urllib.request.Request(u,headers={'User-Agent':'vnciv-research/0.1 (data research)'})
    return json.load(urllib.request.urlopen(r,timeout=30))
if __name__=='__main__':
    lang,q=sys.argv[1],sys.argv[2]
    for x in api(lang,action='query',list='search',srsearch=q,srlimit=50)['query']['search']: print(x['title'])
