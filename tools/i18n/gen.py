"""Build web/js/i18n/vi-data.js from extract.candidates() + vi.txt ("N|translation", "=" keeps the English proper name)."""
import json
import pathlib
from extract import candidates
c=candidates()
tr={}
for line in open(pathlib.Path(__file__).with_name('vi.txt'),encoding='utf-8'):
    i,_,v=line.rstrip('\n').partition('|'); tr[int(i)]=v
assert len(tr)==len(c) and set(tr)==set(range(len(c))), (len(tr),len(c))
d={k:(k if tr[i]=='=' else tr[i]) for i,k in enumerate(c)}
miss=[k for k in c if not d.get(k)]
print('entries',len(d),'untranslated',len(miss))
body=',\n'.join(f'  {json.dumps(k,ensure_ascii=False)}: {json.dumps(v,ensure_ascii=False)}' for k,v in d.items())
open(pathlib.Path(__file__).resolve().parents[2] / 'web/js/i18n/vi-data.js','w',encoding='utf-8').write(
 '// Vietnamese translations (data). Keys are the exact English strings passed to t().\n'
 '// Generated from web/data/*.json strings; proper names (publishers, licences, dataset titles) map to themselves.\n'
 f'export default {{\n{body},\n}};\n')
