"""Extract user-facing English strings from web/data/*.json (patterns below); skipped: ids, codes, place names, per-item text."""
import json,glob,os,re
import pathlib; ROOT = pathlib.Path(__file__).resolve().parents[2]; D = str(ROOT / 'web' / 'data')
INCLUDE={
 'citizens.json':[r'\.cities\.\*\.migration\.unit',r'\.national\.migration\.unit',r'\.groups\.\w+\[\]\.(label|lines)',r'\.note',r'\.rows\.\w+',r'\.rule\.text',r'\.vintage'],
 'counties.json':[r'\.fields\[\]\.(description|label|unit)',r'\.vintage'],
 'disasters.json':[r'\.typhoons\.rule',r'\.vintage'],
 'districts.json':[r'\.catalog\[\]\.(badge\.label|description|name)',r'\.cities\.\*\.badge\.label',r'\.rule\.text',r'\.vintage'],
 'infrastructure.json':[r'\.hubs\.\w+',r'\.port_classes\[\]\.name',r'\.rail_tiers\[\]\.name',r'\.road_classes\[\]\.name',r'\.rules\.\w+',r'\.vintage\.\w+'],
 'lenses.json':[r'\.groups\[\]\.name',r'\.lenses\[\]\.(description|name|note|unit)',r'\.vintage'],
 'military.json':[r'\.caveats',r'\.components\[\]\.name',r'\.rule',r'\.rules\.\w+',r'\.vintage\.\w+'],
 'nation.json':[r'\.currency\.note',r'\.gdp_vintage',r'\.industries\.\w+',r'\.jobs_source',r'\.vintage',r'\.yields\[\]\.(description|label)'],
 'resources.json':[r'\.summary\.note',r'\.types\[\]\.(description|name)'],
 'sources.json':[r'\[\]\.(description|license|publisher|title|vintage)',r'\[\]\.used_for\[\]',r'\[\]\.files\[\]\.note'],
 'states.json':[r'\[\]\.energy\.note'],
 'trade.json':[r'\.modes\[\]\.name',r'\.path_note',r'\.rule',r'\.units\.\w+',r'\.vintage'],
 'wonders.json':[r'\.rules\[\]\.text',r'\.vintage\.\w+'],
 'world.json':[r'\.tables\.(cover|relief|water)\[\]\.(name|rule)',r'\.tables\.notes\.\w+'],
}
def candidates():
    out=[]
    for f in sorted(glob.glob(D+'/*.json')):
        b=os.path.basename(f); pats=[re.compile(p+'$') for p in INCLUDE.get(b,[])]
        def walk(x,p):
            if isinstance(x,dict):
                for k,v in x.items(): walk(v,p+'.'+k)
            elif isinstance(x,list):
                for v in x: walk(v,p+'[]')
            elif isinstance(x,str) and re.search('[A-Za-z]{2}',x):
                q=re.sub(r'\.(\d+|[A-Z0-9_-]{2,})(?=\.|\[|$)','.*',p)
                if any(r.match(q) for r in pats) and x not in out: out.append(x)
        walk(json.load(open(f)),'')
    return out
if __name__=='__main__':
    c=candidates(); json.dump(c,open('cands.json','w'),ensure_ascii=False,indent=0); print(len(c))
