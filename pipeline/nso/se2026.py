# usage: se2026.py DIR_WITH_XLSX data/stats/p34_2026
# NSO monthly socio-economic report Excel (2026) -> tidy CSVs by the 34 provinces
import openpyxl,csv,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); from names import key
NEW=['Hà Nội','Huế','Lai Châu','Điện Biên','Sơn La','Lạng Sơn','Quảng Ninh','Thanh Hóa','Nghệ An','Hà Tĩnh','Cao Bằng','Tuyên Quang','Lào Cai','Thái Nguyên','Phú Thọ','Bắc Ninh','Hưng Yên','Hải Phòng','Ninh Bình','Quảng Trị','Đà Nẵng','Quảng Ngãi','Gia Lai','Khánh Hòa','Lâm Đồng','Đắk Lắk','TP. Hồ Chí Minh','Đồng Nai','Tây Ninh','Cần Thơ','Vĩnh Long','Đồng Tháp','Cà Mau','An Giang']
KN={key(n).replace('thừathiên',''):n for n in NEW}
D,OUT=sys.argv[1].rstrip('/')+'/',sys.argv[2]; U9='https://www.nso.gov.vn/wp-content/uploads/2026/10/02.-Bieu-thang-9.2026.xlsx'; U10='https://www.nso.gov.vn/wp-content/uploads/2026/11/2.-Bieu-thang-10.2026.xlsx'
# (out, file, url, sheet, value col index in non-empty row, year label, unit, rounding)
SPECS=[
('grdp_growth_9M2026',D+'02.-Bieu-thang-9.2026.xlsx',U9,'3.TDT GRDP',4,'9M2026 (est.)','index, same period 2025 = 100, constant 2020 prices',2),
('grdp_growth_Q3_2026',D+'02.-Bieu-thang-9.2026.xlsx',U9,'3.TDT GRDP',3,'Q3 2026 (est.)','index, same quarter 2025 = 100, constant 2020 prices',2),
('grdp_growth_6M2026',D+'02.-Bieu-thang-9.2026.xlsx',U9,'3.TDT GRDP',2,'6M2026 (prel.)','index, same period 2025 = 100, constant 2020 prices',2),
('industrial_employment_index_Oct2026',D+'2.-Bieu-thang-10.2026.xlsx',U10,'5. LĐCN_DP',2,'2026-10-01 (est.)','index, same date 2025 = 100 (industrial enterprises)',2),
('fdi_registered_10M2026_top',D+'2.-Bieu-thang-10.2026.xlsx',U10,'12.FDI',2,'10M2026 (1 Jan-31 Oct, official)','million USD total registered (top provinces only)',1),
('fdi_projects_10M2026_top',D+'2.-Bieu-thang-10.2026.xlsx',U10,'12.FDI',1,'10M2026 (1 Jan-31 Oct, official)','new projects (top provinces only)',0),
('state_budget_investment_10M2026_top',D+'2.-Bieu-thang-10.2026.xlsx',U10,'11.VĐT',3,'10M2026 (est.)','billion VND realised from State budget (top provinces only)',0),
]
for name,f,url,sh,ci,year,unit,rnd in SPECS:
    ws=openpyxl.load_workbook(f,data_only=True,read_only=True)[sh]; rows=[]
    for r in ws.iter_rows(values_only=True):
        r=[c for c in r if c is not None]
        if len(r)>ci and isinstance(r[0],str) and isinstance(r[ci],(int,float)):
            s=KN.get(key(r[0].strip()).replace('thừathiên',''))
            if s and s not in [x[2] for x in rows]: rows.append((r[0].strip(),round(r[ci],rnd) if rnd else int(r[ci]),s))
    with open(f'{OUT}/{name}.csv','w',newline='') as g:
        w=csv.writer(g); w.writerow(['province_name_vi','value','year','unit','source_url','province_std'])
        for nm,v,s in rows: w.writerow([nm,v,year,unit,f'{url} (sheet {sh.strip()})',s])
    print(name,len(rows))
