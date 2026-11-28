# usage: ext.py BOOK.pdf OUT.txt  (pypdf text, one "=====PAGE n" marker per page; a page pypdf cannot read is left empty)
import pypdf,sys
r=pypdf.PdfReader(sys.argv[1])
with open(sys.argv[2],'w',encoding='utf-8') as f:
    for i,p in enumerate(r.pages,1):
        try: t=p.extract_text() or ''
        except Exception as e: t=''; print('page',i,'unreadable:',e,file=sys.stderr)
        f.write(f"=====PAGE {i}\n"+t+"\n")
