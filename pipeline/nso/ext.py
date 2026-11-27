# usage: ext.py BOOK.pdf OUT.txt  (pypdf text, one "=====PAGE n" marker per page)
import pypdf,sys
r=pypdf.PdfReader(sys.argv[1])
with open(sys.argv[2],'w',encoding='utf-8') as f:
    for i,p in enumerate(r.pages,1):
        f.write(f"=====PAGE {i}\n"+(p.extract_text() or '')+"\n")
