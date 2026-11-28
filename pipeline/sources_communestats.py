"""Sources for the communestats stream: natural area and 2025 population of each of the 3,321 commune-level units.

The official merger map (sapnhap.bando.com.vn) shows, for every unit, its natural area (km²), its population ("Dân số
2025") and the resolution that formed it. The 34 resolutions of 16 June 2025 themselves state no figures (checked for
1656/NQ-UBTVQH15, Hà Nội). The map's data service is a POST API: its responses were saved on 28 November 2026 with
the request recorded per file in data/raw/sapnhap_bando_official/manifest.json (url, retrieved, sha256, bytes, note),
so `fetch` finds them cached; the province table is the page's own Excel export. Every value is checked
(pipeline/build/communestats.py).
"""

B = "https://sapnhap.bando.com.vn/"
PROVINCE_MALK = {  # province code → the map's id for it (the POST form field), as recorded in the manifest
    "01": 108, "04": 135, "08": 121, "11": 109, "12": 113, "14": 110, "15": 114, "19": 101, "20": 105, "22": 106,
    "24": 102, "25": 125, "31": 107, "33": 103, "37": 104, "38": 61, "40": 60, "42": 53, "44": 54, "46": 134,
    "48": 132, "51": 130, "52": 51, "56": 133, "66": 46, "68": 47, "75": 50, "79": 49, "80": 40, "82": 127, "86": 42,
    "91": 131, "92": 1, "96": 39,
}

SOURCES = [
    dict(id="sapnhap_bando_official",
         title="Bản đồ tra cứu các đơn vị hành chính Việt Nam: diện tích và dân số 2025 cấp xã",
         publisher="Ministry of Agriculture and Environment / Vietnam Natural Resources, Environment and Cartography "
                   "Publishing House (sapnhap.bando.com.vn; ISBN 978-632-622-303-3)",
         homepage=B,
         license="Non-commercial public-service publication of the State (\"xuất bản phẩm không kinh doanh, phục vụ "
                 "cộng đồng\"); used with attribution; only the facts are used",
         description="For each commune, ward and special zone of the two-tier local government: natural area (km²), "
                     "population 2025 (people) and the resolution that formed it, as the official merger map's data "
                     "service returned them on 28 November 2026; and the map's table of the 34 provinces with their "
                     "2025 population. Each value is checked against the unit's outline and WorldPop before it is shown "
                     "(communes.json stats.rules).",
         used_for=["Communes & wards layer", "Population density by commune"],
         files=[(B + f"p.co_bangbieu#ma=diaphanhanhchinhcaptinh_sn.{m}", f"co_bangbieu_{c}.txt")
                for c, m in PROVINCE_MALK.items()]
               + [(B + "p.co_dvhc#ma=0", "co_dvhc_ma0.json"),
                  (B + "bangbieu=vn&kieu=0", "bangbieu_vn_provinces.xlsx")]),
]
