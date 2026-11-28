"""Sources for the communes388 stream: the official current list of commune-level units and the 2026 resolutions
that turned communes into wards (237/NQ-UBTVQH16 in Đồng Nai, 388/NQ-UBTVQH16 in Bắc Ninh).

The NSO list is a SOAP web service (POST), so its two files were saved by hand and recorded in
data/raw/nso_dvhc/manifest.json (url, retrieved, sha256, bytes, and the request in `note`); `fetch` finds them cached.
"""

NSO = "https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx"

SOURCES = [
    dict(id="nso_dvhc", title="Danh mục đơn vị hành chính Việt Nam (commune-level units)",
         publisher="National Statistics Office of Viet Nam (Cục Thống kê), danhmuchanhchinh.nso.gov.vn",
         homepage="https://danhmuchanhchinh.nso.gov.vn/",
         license="Official state register; no licence stated, used with attribution",
         description="The official register of administrative units: code, name, type (xã, phường, đặc khu) and province "
                     "of every commune-level unit, queried for the list in force on 28 November 2026 and on 1 July 2025. "
                     "Both lists have 3,321 units; between them 22 communes became wards (10 in Đồng Nai, 12 in Bắc Ninh) "
                     "and nothing else changed. Every unit's type and code on the map is checked against it.",
         used_for=["Communes & wards layer", "Commune count check"],
         files=[(NSO + "#DanhMucPhuongXa?DenNgay=28/11/2026", "DanhMucPhuongXa_2026-11-28.xml"),
                (NSO + "#DanhMucPhuongXa?DenNgay=01/07/2025", "DanhMucPhuongXa_2025-07-01.xml")]),
    dict(id="nq_wards_2026", title="Resolutions 237/NQ-UBTVQH16 and 388/NQ-UBTVQH16 establishing wards",
         publisher="National Assembly Standing Committee; texts as published by the Government portal (chinhphu.vn), "
                   "the National Assembly's newspaper (Đại biểu Nhân dân, via VNA), VTC News and Thương hiệu & Công luận "
                   "(the Bắc Ninh announcement ceremony)",
         homepage="https://xaydungchinhsach.chinhphu.vn/thanh-lap-10-phuong-thuoc-tinh-dong-nai-119260421072221129.htm",
         license="Official state documents, cited with attribution; only the facts are used",
         description="Resolution 237/NQ-UBTVQH16 (adopted 14 April 2026, in force 30 April 2026) made 10 Đồng Nai "
                     "communes wards; Resolution 388/NQ-UBTVQH16 (of 4 August 2026, in force 20 September 2026) made "
                     "12 Bắc Ninh communes wards, each on its former commune's area and population. The names they list are checked against "
                     "the units whose type changed in the NSO register.",
         used_for=["Communes & wards layer"],
         files=[("https://xaydungchinhsach.chinhphu.vn/thanh-lap-10-phuong-thuoc-tinh-dong-nai-119260421072221129.htm",
                 "chinhphu_237.html"),
                ("https://vtcnews.vn/danh-sach-12-phuong-moi-cua-tinh-bac-ninh-ar1034834.html", "vtc_388.html"),
                ("https://en.daibieunhandan.vn/print/10427784.html", "dbnd_388.html"),
                ("https://thuonghieucongluan.com.vn/le-cong-bo-nghi-quyet-thanh-lap-phuong-bo-ha-tinh-bac-ninh-a334003.html",
                 "thcl_388_bo_ha.html")]),
]
