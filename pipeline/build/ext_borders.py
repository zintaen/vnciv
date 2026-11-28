"""borders_history.json (lazy): the province map at each change since 1976, hex by hex, for the "Historical
boundaries" mode (web/js/ext/borders).

Every frame before 2025 is built from the 708 districts of OCHA COD-AB 2020 (admin 2): a historical province is a set
of 2020 districts, and a land hex takes the province of its 2020 district (the district under most of its 7 sample
points, among the districts of the hex's former province on world.json). The district sets are not typed in: the 1976
map is written as unions of 2020 provinces (Wikipedia's list of the 38 units, the 1975 resolution, the 1976 decree), and
every later frame applies the resolution's moves to the frame before (FRAMES below). Each change carries the sentence
of its source that states it; the build fails when that sentence is not in the downloaded file. The 2025 and 2026
frames are world.json's 34 provinces as they are.
"""
from __future__ import annotations

import gzip
import html
import json
import math
import re
import zipfile
from collections import Counter

import numpy as np
from rasterio import features
from rasterio.enums import MergeAlg
from rasterio.transform import from_origin

from ..admin import new_units, old_units
from ..fetch import RAW
from ..sources_borders import page_url
from ..store import load_web, write_web
from .common import World
from .world import LAT1, LON0, NCOL, NROW, RES, R, _key

ADM2 = ("vnm_adm_gov_20201027_shp.zip", "vnm_admbnda_adm2_gov_20201027")
CITY, PROV, ZONE = "city", "province", "zone"  # thành phố trực thuộc TW, tỉnh, đặc khu

# --- the 2020 districts that the province map split differently -----------------------------------------------------
HN_CORE = ["Quận Ba Đình", "Quận Bắc Từ Liêm", "Quận Cầu Giấy", "Huyện Đông Anh", "Quận Đống Đa", "Huyện Gia Lâm",
           "Quận Hai Bà Trưng", "Quận Hoàn Kiếm", "Quận Hoàng Mai", "Quận Long Biên", "Quận Nam Từ Liêm", "Quận Tây Hồ",
           "Huyện Thanh Trì", "Quận Thanh Xuân"]
HA_TAY = ["Quận Hà Đông", "Thị xã Sơn Tây", "Huyện Ba Vì", "Huyện Phúc Thọ", "Huyện Đan Phượng", "Huyện Hoài Đức",
          "Huyện Quốc Oai", "Huyện Thạch Thất", "Huyện Chương Mỹ", "Huyện Thanh Oai", "Huyện Thường Tín",
          "Huyện Phú Xuyên", "Huyện Ứng Hòa", "Huyện Mỹ Đức"]  # Hà Tây's 14 units in Resolution 15/2008 (2020 names)
HN_1978 = ["Huyện Ba Vì", "Huyện Phúc Thọ", "Huyện Thạch Thất", "Huyện Đan Phượng", "Huyện Hoài Đức", "Thị xã Sơn Tây",
           "Quận Hà Đông"]
d = lambda prov, *names: [f"{prov}|{n}" for n in names]  # 2020 district keys

# --- frames -----------------------------------------------------------------------------------------------------------
# A province is (name, kind, [2020 provinces or "Province|District" keys]); a later frame lists operations on the one
# before: ("split", old, [(new, kind, [units])]) — the last new one takes whatever is left of old;
# ("move", [units], from, to); ("new", name, kind, [(from, [units])]); ("rename", old, new, kind); ("merge", [olds], new, kind).
# `cite` = (file, sentence that must be in the file): the evidence for the change.
P = lambda *names: list(names)
NORTH_1976 = [
    ("Hà Nội", CITY, d("Hà Nội", *HN_CORE)),
    ("Hải Phòng", CITY, P("Hải Phòng")),
    ("Bắc Thái", PROV, P("Bắc Kạn", "Thái Nguyên")),
    ("Cao Lạng", PROV, P("Cao Bằng", "Lạng Sơn")),  # less Đình Lập (Quảng Ninh's until 1978): see below
    ("Hà Bắc", PROV, P("Bắc Giang", "Bắc Ninh")),
    ("Hà Nam Ninh", PROV, P("Hà Nam", "Nam Định", "Ninh Bình")),
    ("Hà Sơn Bình", PROV, P("Hòa Bình") + d("Hà Nội", *HA_TAY)),
    ("Hà Tuyên", PROV, P("Hà Giang", "Tuyên Quang")),
    ("Hải Hưng", PROV, P("Hải Dương", "Hưng Yên")),
    ("Hoàng Liên Sơn", PROV, P("Lào Cai", "Yên Bái") + d("Lai Châu", "Huyện Than Uyên", "Huyện Tân Uyên")),
    ("Lai Châu", PROV, P("Lai Châu", "Điện Biên")),
    ("Nghệ Tĩnh", PROV, P("Nghệ An", "Hà Tĩnh")),
    ("Quảng Ninh", PROV, P("Quảng Ninh") + d("Lạng Sơn", "Huyện Đình Lập")),
    ("Sơn La", PROV, P("Sơn La")),
    ("Thanh Hóa", PROV, P("Thanh Hóa")),
    ("Thái Bình", PROV, P("Thái Bình")),
    ("Vĩnh Phú", PROV, P("Vĩnh Phúc", "Phú Thọ") + d("Hà Nội", "Huyện Mê Linh", "Huyện Sóc Sơn")),
]
SOUTH_1976 = [
    ("TP. Hồ Chí Minh", CITY, P("TP. Hồ Chí Minh") + d("Bà Rịa–Vũng Tàu", "Huyện Côn Đảo")),  # less Cần Giờ (Duyên Hải)
    ("An Giang", PROV, P("An Giang")),
    ("Bến Tre", PROV, P("Bến Tre")),
    ("Bình Trị Thiên", PROV, P("Quảng Bình", "Quảng Trị", "Thừa Thiên Huế")),
    ("Cửu Long", PROV, P("Vĩnh Long", "Trà Vinh")),
    ("Đắk Lắk", PROV, P("Đắk Lắk", "Đắk Nông")),
    ("Đồng Nai", PROV, P("Đồng Nai", "Bà Rịa–Vũng Tàu") + d("TP. Hồ Chí Minh", "Huyện Cần Giờ") + d("Khánh Hòa", "Huyện Trường Sa")),
    ("Đồng Tháp", PROV, P("Đồng Tháp")),
    ("Gia Lai – Kon Tum", PROV, P("Gia Lai", "Kon Tum")),
    ("Hậu Giang", PROV, P("Cần Thơ", "Hậu Giang", "Sóc Trăng")),
    ("Kiên Giang", PROV, P("Kiên Giang")),
    ("Lâm Đồng", PROV, P("Lâm Đồng")),
    ("Long An", PROV, P("Long An")),
    ("Minh Hải", PROV, P("Bạc Liêu", "Cà Mau")),
    ("Nghĩa Bình", PROV, P("Quảng Ngãi", "Bình Định")),
    ("Phú Khánh", PROV, P("Phú Yên", "Khánh Hòa")),
    ("Quảng Nam – Đà Nẵng", PROV, P("Quảng Nam", "Đà Nẵng")),
    ("Sông Bé", PROV, P("Bình Dương", "Bình Phước")),
    ("Tây Ninh", PROV, P("Tây Ninh")),
    ("Thuận Hải", PROV, P("Ninh Thuận", "Bình Thuận")),
    ("Tiền Giang", PROV, P("Tiền Giang")),
]
# units listed twice above go to the later province (Đình Lập → Quảng Ninh, Côn Đảo → HCMC, Cần Giờ and Trường Sa →
# Đồng Nai); the builder checks that no unit is left out or claimed by two provinces after these overrides.

WP_CAP = "wp_captinh.json"
FRAMES = [
    dict(id="1976", date="1976-07-02", count=38, kinds={PROV: 35, CITY: 3},
         title_vi="Sau ngày thống nhất: 38 tỉnh, thành", title_en="After reunification: 38 provinces and cities",
         legal=[("ws_1975_hop_nhat.json", "Nghị quyết của Quốc hội (27/12/1975) về việc hợp nhất một số tỉnh",
                 "National Assembly resolution of 27 Dec 1975 on merging provinces (the North)"),
                ("wp_minh_hai.json", "Nghị định số 3/NQ/1976 (24/2/1976) của Chính phủ Cách mạng lâm thời về giải thể khu, hợp nhất tỉnh ở miền Nam",
                 "Decree 3/NQ/1976 (24 Feb 1976) of the Provisional Revolutionary Government on merging provinces in the South")],
         base=NORTH_1976 + SOUTH_1976,
         changes=[
             dict(vi="Miền Bắc: hợp nhất Cao Bằng và Lạng Sơn (Cao Lạng), Tuyên Quang và Hà Giang (Hà Tuyên), Hòa Bình và Hà Tây (Hà Sơn Bình), Nam Hà và Ninh Bình (Hà Nam Ninh), Nghệ An và Hà Tĩnh (Nghệ Tĩnh), Yên Bái, Lào Cai và Nghĩa Lộ (Hoàng Liên Sơn).",
                  en="North: Cao Bằng and Lạng Sơn merged (Cao Lạng), Tuyên Quang and Hà Giang (Hà Tuyên), Hòa Bình and Hà Tây (Hà Sơn Bình), Nam Hà and Ninh Bình (Hà Nam Ninh), Nghệ An and Hà Tĩnh (Nghệ Tĩnh), Yên Bái, Lào Cai and Nghĩa Lộ (Hoàng Liên Sơn).",
                  cite=("ws_1975_hop_nhat.json", "Hợp nhất tỉnh Cao Bằng và tỉnh Lạng Sơn thành một tỉnh mới, lấy tên là tỉnh Cao Lạng")),
             dict(vi="Miền Nam và miền Trung: 21 đơn vị, trong đó Bình Trị Thiên, Quảng Nam – Đà Nẵng, Nghĩa Bình, Phú Khánh, Thuận Hải, Gia Lai – Kon Tum, Đồng Nai, Sông Bé, Hậu Giang, Minh Hải, Cửu Long; Sài Gòn – Gia Định đổi tên thành Thành phố Hồ Chí Minh (2/7/1976).",
                  en="South and centre: 21 units, among them Bình Trị Thiên, Quảng Nam – Đà Nẵng, Nghĩa Bình, Phú Khánh, Thuận Hải, Gia Lai – Kon Tum, Đồng Nai, Sông Bé, Hậu Giang, Minh Hải and Cửu Long; Sài Gòn – Gia Định renamed Hồ Chí Minh City (2 Jul 1976).",
                  cite=(WP_CAP, "Việt Nam|Cộng hòa Xã hội chủ nghĩa Việt Nam]] có 38 đơn vị hành chính cấp tỉnh, gồm 35 tỉnh và 3 thành phố trực thuộc trung ương")),
         ]),
    dict(id="1977", date="1977-01-15", count=38, kinds={PROV: 35, CITY: 3},
         title_vi="Côn Đảo về tỉnh Hậu Giang", title_en="Côn Đảo joins Hậu Giang",
         legal=[("ws_1977_con_dao.json", "Nghị quyết của Quốc hội (15/1/1977) phê chuẩn việc sáp nhập huyện Côn Đảo vào tỉnh Hậu Giang",
                 "National Assembly resolution of 15 Jan 1977 moving Côn Đảo district to Hậu Giang")],
         ops=[("move", d("Bà Rịa–Vũng Tàu", "Huyện Côn Đảo"), "TP. Hồ Chí Minh", "Hậu Giang")],
         changes=[dict(vi="Huyện Côn Đảo của Thành phố Hồ Chí Minh sáp nhập vào tỉnh Hậu Giang.", en="Côn Đảo district moved from Hồ Chí Minh City to Hậu Giang.",
                       cite=(WP_CAP, "sáp nhập huyện [[Côn Đảo]] của [[Thành phố Hồ Chí Minh]] vào tỉnh [[Hậu Giang]]"))]),
    dict(id="1978", date="1978-12-29", count=39, kinds={PROV: 36, CITY: 3},
         title_vi="Hà Nội mở rộng; chia Cao Lạng", title_en="Hà Nội expands; Cao Lạng split",
         legal=[("ws_1978_dia_gioi.json", "Nghị quyết của Quốc hội (29/12/1978) phê chuẩn việc phân vạch lại địa giới thành phố Hà Nội, thành phố Hồ Chí Minh, các tỉnh Hà Sơn Bình, Vĩnh Phú, Cao Lạng, Bắc Thái, Quảng Ninh và Đồng Nai",
                 "National Assembly resolution of 29 Dec 1978 redrawing Hà Nội, Hồ Chí Minh City, Hà Sơn Bình, Vĩnh Phú, Cao Lạng, Bắc Thái, Quảng Ninh and Đồng Nai")],
         ops=[("move", d("Hà Nội", *HN_1978), "Hà Sơn Bình", "Hà Nội"),
              ("move", d("Hà Nội", "Huyện Sóc Sơn", "Huyện Mê Linh") + d("Vĩnh Phúc", "Thị xã Phúc Yên"), "Vĩnh Phú", "Hà Nội"),
              ("split", "Cao Lạng", [("Cao Bằng", PROV, P("Cao Bằng")), ("Lạng Sơn", PROV, [])]),
              ("move", d("Bắc Kạn", "Huyện Ngân Sơn", "Huyện Ba Bể", "Huyện Pác Nặm"), "Bắc Thái", "Cao Bằng"),
              ("move", d("Lạng Sơn", "Huyện Đình Lập"), "Quảng Ninh", "Lạng Sơn"),
              ("move", d("TP. Hồ Chí Minh", "Huyện Cần Giờ"), "Đồng Nai", "TP. Hồ Chí Minh")],
         changes=[
             dict(vi="Hà Nội nhận các huyện Ba Vì, Phúc Thọ, Thạch Thất, Đan Phượng, Hoài Đức, thị xã Sơn Tây và Hà Đông (của Hà Sơn Bình), huyện Sóc Sơn và phần lớn huyện Mê Linh cùng thị trấn Phúc Yên (của Vĩnh Phú).",
                  en="Hà Nội gains Ba Vì, Phúc Thọ, Thạch Thất, Đan Phượng, Hoài Đức and the towns of Sơn Tây and Hà Đông (from Hà Sơn Bình), and Sóc Sơn, most of Mê Linh and Phúc Yên town (from Vĩnh Phú).",
                  cite=("ws_1978_dia_gioi.json", "Các huyện Ba Vì, Phúc Thọ, Thạch Thất, Đan Phượng, Hoài Đức, thị xã Sơn Tây và thị xã Hà Đông")),
             dict(vi="Chia Cao Lạng thành Cao Bằng và Lạng Sơn; Ngân Sơn và Chợ Rã (Ba Bể) từ Bắc Thái về Cao Bằng; Đình Lập từ Quảng Ninh về Lạng Sơn.",
                  en="Cao Lạng split into Cao Bằng and Lạng Sơn; Ngân Sơn and Chợ Rã (Ba Bể) move from Bắc Thái to Cao Bằng; Đình Lập from Quảng Ninh to Lạng Sơn.",
                  cite=("ws_1978_dia_gioi.json", "Sáp nhập huyện Ngân Sơn và huyện Chợ Rã của Bắc Thái vào tỉnh Cao Bằng")),
             dict(vi="Huyện Duyên Hải (nay là Cần Giờ) của Đồng Nai về Thành phố Hồ Chí Minh.", en="Duyên Hải district (now Cần Giờ) moves from Đồng Nai to Hồ Chí Minh City.",
                  cite=("ws_1978_dia_gioi.json", "Sáp nhập huyện Duyên Hải của tỉnh Đồng Nai vào thành phố Hồ Chí Minh")),
         ]),
    dict(id="1979", date="1979-05-30", count=40, kinds={PROV: 36, CITY: 3, ZONE: 1},
         title_vi="Đặc khu Vũng Tàu – Côn Đảo", title_en="Vũng Tàu – Côn Đảo special zone",
         legal=[("ws_1979_vung_tau.json", "Nghị quyết của Quốc hội (30/5/1979) về việc thành lập đặc khu Vũng Tàu – Côn Đảo trực thuộc Trung ương",
                 "National Assembly resolution of 30 May 1979 creating the Vũng Tàu – Côn Đảo special zone")],
         ops=[("new", "Vũng Tàu – Côn Đảo", ZONE, [("Đồng Nai", d("Bà Rịa–Vũng Tàu", "TP. Vũng Tàu")), ("Hậu Giang", d("Bà Rịa–Vũng Tàu", "Huyện Côn Đảo"))])],
         changes=[dict(vi="Thị xã Vũng Tàu, xã Long Sơn (Đồng Nai) và huyện Côn Đảo (Hậu Giang) thành đặc khu trực thuộc Trung ương.",
                       en="Vũng Tàu town, Long Sơn commune (Đồng Nai) and Côn Đảo district (Hậu Giang) become a special zone under the central government.",
                       cite=("ws_1979_vung_tau.json", "thị xã Vũng Tàu, xã Long Sơn thuộc huyện Châu Thành, tỉnh Đồng Nai, và huyện Côn Đảo thuộc tỉnh Hậu Giang"))]),
    dict(id="1982", date="1982-12-28", count=40, kinds={PROV: 36, CITY: 3, ZONE: 1},
         title_vi="Huyện Trường Sa về Phú Khánh", title_en="Trường Sa district joins Phú Khánh",
         legal=[("ws_1982_truong_sa.json", "Nghị quyết của Quốc hội (28/12/1982) về việc sáp nhập huyện Trường Sa thuộc tỉnh Đồng Nai vào tỉnh Phú Khánh",
                 "National Assembly resolution of 28 Dec 1982 moving Trường Sa district from Đồng Nai to Phú Khánh")],
         ops=[("move", d("Khánh Hòa", "Huyện Trường Sa"), "Đồng Nai", "Phú Khánh")],
         changes=[dict(vi="Huyện Trường Sa của Đồng Nai sáp nhập vào tỉnh Phú Khánh.", en="Trường Sa district moves from Đồng Nai to Phú Khánh.",
                       cite=("ws_1982_truong_sa.json", "Sáp nhập huyện Trường - Sa thuộc tỉnh Đồng Nai vào tỉnh Phú Khánh"))]),
    dict(id="1989", date="1989-06-30", count=44, kinds={PROV: 40, CITY: 3, ZONE: 1},
         title_vi="Chia Nghĩa Bình, Phú Khánh, Bình Trị Thiên", title_en="Nghĩa Bình, Phú Khánh and Bình Trị Thiên split",
         legal=[("tvpl_1989.html", "Nghị quyết của Quốc hội (30/6/1989) về việc phân vạch địa giới hành chính của các tỉnh Nghĩa Bình, Phú Khánh và Bình Trị Thiên",
                 "National Assembly resolution of 30 Jun 1989 dividing Nghĩa Bình, Phú Khánh and Bình Trị Thiên")],
         ops=[("split", "Nghĩa Bình", [("Quảng Ngãi", PROV, P("Quảng Ngãi")), ("Bình Định", PROV, [])]),
              ("split", "Phú Khánh", [("Phú Yên", PROV, P("Phú Yên")), ("Khánh Hòa", PROV, [])]),
              ("split", "Bình Trị Thiên", [("Quảng Bình", PROV, P("Quảng Bình")), ("Quảng Trị", PROV, P("Quảng Trị")), ("Thừa Thiên Huế", PROV, [])])],
         changes=[
             dict(vi="Nghĩa Bình chia thành Quảng Ngãi và Bình Định.", en="Nghĩa Bình split into Quảng Ngãi and Bình Định.",
                  cite=("tvpl_1989.html", "Chia tỉnh Nghĩa Bình thành 2 tỉnh mới lấy tên là tỉnh Quảng Ngãi và tỉnh Bình Định")),
             dict(vi="Phú Khánh chia thành Phú Yên và Khánh Hòa.", en="Phú Khánh split into Phú Yên and Khánh Hòa.",
                  cite=("tvpl_1989.html", "Chia tỉnh Phú Khánh thành 2 tỉnh mới lấy tên là tỉnh Phú Yên và tỉnh Khánh Hòa")),
             dict(vi="Bình Trị Thiên chia thành Quảng Bình, Quảng Trị và Thừa Thiên Huế.", en="Bình Trị Thiên split into Quảng Bình, Quảng Trị and Thừa Thiên Huế.",
                  cite=("tvpl_1989.html", "Chia tỉnh Bình Trị Thiên thành 3 tỉnh mới lấy tên là tỉnh Quảng Bình, tỉnh Quảng Trị và tỉnh Thừa Thiên Huế")),
         ]),
    dict(id="1991-08", date="1991-08-12", count=49, count_note="derived", kinds={PROV: 46, CITY: 3},
         title_vi="Tái lập năm cặp tỉnh; tỉnh Bà Rịa – Vũng Tàu", title_en="Five provinces split; Bà Rịa – Vũng Tàu formed",
         legal=[("tvpl_1991_08.html", "Nghị quyết của Quốc hội (12/8/1991) về việc điều chỉnh địa giới hành chính một số tỉnh, thành phố trực thuộc trung ương",
                 "National Assembly resolution of 12 Aug 1991 adjusting the boundaries of some provinces and centrally governed cities")],
         ops=[("split", "Nghệ Tĩnh", [("Nghệ An", PROV, P("Nghệ An")), ("Hà Tĩnh", PROV, [])]),
              ("split", "Hoàng Liên Sơn", [("Yên Bái", PROV, P("Yên Bái")), ("Lào Cai", PROV, [])]),
              ("split", "Hà Tuyên", [("Hà Giang", PROV, P("Hà Giang")), ("Tuyên Quang", PROV, [])]),
              ("split", "Gia Lai – Kon Tum", [("Gia Lai", PROV, P("Gia Lai")), ("Kon Tum", PROV, [])]),
              ("split", "Hà Sơn Bình", [("Hòa Bình", PROV, P("Hòa Bình")), ("Hà Tây", PROV, [])]),
              ("move", d("Hà Nội", *HN_1978), "Hà Nội", "Hà Tây"),
              ("move", d("Hà Nội", "Huyện Mê Linh") + d("Vĩnh Phúc", "Thị xã Phúc Yên"), "Hà Nội", "Vĩnh Phú"),
              ("new", "Bà Rịa – Vũng Tàu", PROV, [("Vũng Tàu – Côn Đảo", d("Bà Rịa–Vũng Tàu", "TP. Vũng Tàu", "Huyện Côn Đảo")), ("Đồng Nai", P("Bà Rịa–Vũng Tàu"))]),
              ("drop", "Vũng Tàu – Côn Đảo")],
         changes=[
             dict(vi="Chia Nghệ Tĩnh (Nghệ An, Hà Tĩnh), Hoàng Liên Sơn (Yên Bái, Lào Cai), Hà Tuyên (Hà Giang, Tuyên Quang), Gia Lai – Kon Tum (Gia Lai, Kon Tum), Hà Sơn Bình (Hòa Bình, Hà Tây).",
                  en="Nghệ Tĩnh (Nghệ An, Hà Tĩnh), Hoàng Liên Sơn (Yên Bái, Lào Cai), Hà Tuyên (Hà Giang, Tuyên Quang), Gia Lai – Kon Tum (Gia Lai, Kon Tum) and Hà Sơn Bình (Hòa Bình, Hà Tây) split.",
                  cite=("tvpl_1991_08.html", "Chia tỉnh Nghệ Tĩnh thành 2 tỉnh, lấy tên là tỉnh Nghệ An và tỉnh Hà Tĩnh")),
             dict(vi="Thành lập tỉnh Bà Rịa – Vũng Tàu từ đặc khu Vũng Tàu – Côn Đảo và ba huyện Long Đất, Châu Thành, Xuyên Mộc của Đồng Nai.",
                  en="Bà Rịa – Vũng Tàu province formed from the Vũng Tàu – Côn Đảo zone and Đồng Nai's Long Đất, Châu Thành and Xuyên Mộc districts.",
                  cite=("tvpl_1991_08.html", "Thành lập tỉnh Bà Rịa - Vũng Tàu gồm đặc khu Vũng Tàu - Côn Đảo và 3 huyện Long Đất, Châu Thành, Xuyên Mộc của tỉnh Đồng Nai")),
             dict(vi="Hà Nội trả huyện Mê Linh về Vĩnh Phú; thị xã Sơn Tây và các huyện Hoài Đức, Phúc Thọ, Đan Phượng, Ba Vì, Thạch Thất về Hà Tây.",
                  en="Hà Nội returns Mê Linh to Vĩnh Phú, and Sơn Tây with Hoài Đức, Phúc Thọ, Đan Phượng, Ba Vì and Thạch Thất to Hà Tây.",
                  cite=("tvpl_1991_08.html", "Chuyển thị xã Sơn Tây và 5 huyện: Hoài Đức, Phúc Thọ, Đan Phượng, Ba Vì, Thạch Thất của thành phố Hà Nội về tỉnh Hà Tây")),
         ]),
    dict(id="1991-12", date="1991-12-26", count=53, kinds={PROV: 50, CITY: 3},
         title_vi="Chia Thuận Hải, Hậu Giang, Cửu Long, Hà Nam Ninh", title_en="Thuận Hải, Hậu Giang, Cửu Long and Hà Nam Ninh split",
         legal=[("tvpl_1991_12.html", "Nghị quyết của Quốc hội (26/12/1991) về việc phân vạch lại địa giới hành chính một số tỉnh",
                 "National Assembly resolution of 26 Dec 1991 redrawing some provinces")],
         ops=[("split", "Thuận Hải", [("Ninh Thuận", PROV, P("Ninh Thuận")), ("Bình Thuận", PROV, [])]),
              ("split", "Hậu Giang", [("Sóc Trăng", PROV, P("Sóc Trăng")), ("Cần Thơ", PROV, [])]),
              ("split", "Cửu Long", [("Vĩnh Long", PROV, P("Vĩnh Long")), ("Trà Vinh", PROV, [])]),
              ("split", "Hà Nam Ninh", [("Ninh Bình", PROV, P("Ninh Bình")), ("Nam Hà", PROV, [])])],
         changes=[dict(vi="Chia Thuận Hải (Ninh Thuận, Bình Thuận), Hậu Giang (Cần Thơ, Sóc Trăng), Cửu Long (Vĩnh Long, Trà Vinh), Hà Nam Ninh (Nam Hà, Ninh Bình).",
                       en="Thuận Hải (Ninh Thuận, Bình Thuận), Hậu Giang (Cần Thơ, Sóc Trăng), Cửu Long (Vĩnh Long, Trà Vinh) and Hà Nam Ninh (Nam Hà, Ninh Bình) split.",
                       cite=("tvpl_1991_12.html", "Chia tỉnh Thuận Hải thành 2 tỉnh, lấy tên là tỉnh Ninh Thuận và tỉnh Bình Thuận"))]),
    dict(id="1996", date="1996-11-06", count=61, kinds={PROV: 57, CITY: 4},
         title_vi="Tách tám tỉnh; Đà Nẵng trực thuộc Trung ương", title_en="Eight provinces split; Đà Nẵng a central city",
         legal=[("tvpl_1996.html", "Nghị quyết của Quốc hội (6/11/1996) về việc chia và điều chỉnh địa giới hành chính một số tỉnh",
                 "National Assembly resolution of 6 Nov 1996 on dividing and adjusting some provinces")],
         ops=[("split", "Bắc Thái", [("Thái Nguyên", PROV, P("Thái Nguyên")), ("Bắc Kạn", PROV, [])]),
              ("move", d("Bắc Kạn", "Huyện Ngân Sơn", "Huyện Ba Bể", "Huyện Pác Nặm"), "Cao Bằng", "Bắc Kạn"),
              ("split", "Hà Bắc", [("Bắc Giang", PROV, P("Bắc Giang")), ("Bắc Ninh", PROV, [])]),
              ("split", "Hải Hưng", [("Hải Dương", PROV, P("Hải Dương")), ("Hưng Yên", PROV, [])]),
              ("split", "Minh Hải", [("Bạc Liêu", PROV, P("Bạc Liêu")), ("Cà Mau", PROV, [])]),
              ("split", "Nam Hà", [("Hà Nam", PROV, P("Hà Nam")), ("Nam Định", PROV, [])]),
              ("split", "Quảng Nam – Đà Nẵng", [("Đà Nẵng", CITY, P("Đà Nẵng")), ("Quảng Nam", PROV, [])]),
              ("split", "Sông Bé", [("Bình Dương", PROV, P("Bình Dương")), ("Bình Phước", PROV, [])]),
              ("split", "Vĩnh Phú", [("Phú Thọ", PROV, P("Phú Thọ")), ("Vĩnh Phúc", PROV, [])])],
         changes=[
             dict(vi="Chia Bắc Thái (Bắc Kạn, Thái Nguyên; Ngân Sơn và Ba Bể từ Cao Bằng về Bắc Kạn), Hà Bắc (Bắc Giang, Bắc Ninh), Hải Hưng (Hải Dương, Hưng Yên), Minh Hải (Bạc Liêu, Cà Mau), Nam Hà (Hà Nam, Nam Định), Sông Bé (Bình Dương, Bình Phước), Vĩnh Phú (Phú Thọ, Vĩnh Phúc).",
                  en="Bắc Thái (Bắc Kạn, Thái Nguyên; Ngân Sơn and Ba Bể return from Cao Bằng to Bắc Kạn), Hà Bắc (Bắc Giang, Bắc Ninh), Hải Hưng (Hải Dương, Hưng Yên), Minh Hải (Bạc Liêu, Cà Mau), Nam Hà (Hà Nam, Nam Định), Sông Bé (Bình Dương, Bình Phước) and Vĩnh Phú (Phú Thọ, Vĩnh Phúc) split.",
                  cite=("tvpl_1996.html", "hai huyện Ngân Sơn, Ba Bể do tỉnh Cao Bằng quản lý, nay chuyển giao cho tỉnh Bắc Kạn quản lý")),
             dict(vi="Tách Quảng Nam – Đà Nẵng thành tỉnh Quảng Nam và thành phố Đà Nẵng trực thuộc Trung ương.", en="Quảng Nam – Đà Nẵng split into Quảng Nam province and the centrally governed city of Đà Nẵng.",
                  cite=("tvpl_1996.html", "Tách tỉnh Quảng Nam - Đà Nẵng thành tỉnh Quảng Nam và thành phố Đà Nẵng trực thuộc Trung ương")),
         ]),
    dict(id="2003", date="2003-11-26", count=64, kinds={PROV: 59, CITY: 5},
         title_vi="Chia Cần Thơ, Đắk Lắk, Lai Châu", title_en="Cần Thơ, Đắk Lắk and Lai Châu split",
         legal=[("vbpl_2003.html", "Nghị quyết số 22/2003/QH11 (26/11/2003) về việc chia và điều chỉnh địa giới hành chính một số tỉnh",
                 "Resolution 22/2003/QH11 (26 Nov 2003) on dividing and adjusting some provinces")],
         ops=[("split", "Cần Thơ", [("Cần Thơ", CITY, P("Cần Thơ")), ("Hậu Giang", PROV, [])]),
              ("split", "Đắk Lắk", [("Đắk Nông", PROV, P("Đắk Nông")), ("Đắk Lắk", PROV, [])]),
              ("split", "Lai Châu", [("Điện Biên", PROV, P("Điện Biên")), ("Lai Châu", PROV, [])]),
              ("move", d("Lai Châu", "Huyện Than Uyên", "Huyện Tân Uyên"), "Lào Cai", "Lai Châu")],
         changes=[
             dict(vi="Cần Thơ chia thành thành phố Cần Thơ trực thuộc Trung ương và tỉnh Hậu Giang; Đắk Lắk chia thành Đắk Lắk và Đắk Nông.",
                  en="Cần Thơ split into the centrally governed city of Cần Thơ and Hậu Giang province; Đắk Lắk into Đắk Lắk and Đắk Nông.",
                  cite=("vbpl_2003.html", "Chia tỉnh Cần Thơ thành thành phố Cần Thơ trực thuộc trung ương và tỉnh Hậu Giang")),
             dict(vi="Lai Châu chia thành Lai Châu và Điện Biên; huyện Than Uyên từ Lào Cai về Lai Châu.", en="Lai Châu split into Lai Châu and Điện Biên; Than Uyên district moves from Lào Cai to Lai Châu.",
                  cite=("vbpl_2003.html", "Chuyển huyện Than Uyên thuộc tỉnh Lào Cai về tỉnh Lai Châu quản lý")),
         ]),
    dict(id="2008", date="2008-08-01", adopted="2008-05-29", count=63, kinds={PROV: 58, CITY: 5},
         title_vi="Hà Tây hợp nhất vào Hà Nội", title_en="Hà Tây merged into Hà Nội",
         legal=[("tvpl_2008.html", "Nghị quyết số 15/2008/QH12 (29/5/2008, hiệu lực 1/8/2008) về việc điều chỉnh địa giới hành chính thành phố Hà Nội và một số tỉnh có liên quan",
                 "Resolution 15/2008/QH12 (29 May 2008, in force 1 Aug 2008) adjusting the boundaries of Hà Nội and related provinces")],
         ops=[("merge", ["Hà Tây"], "Hà Nội", CITY),
              ("move", d("Hà Nội", "Huyện Mê Linh"), "Vĩnh Phúc", "Hà Nội")],
         changes=[dict(vi="Hợp nhất toàn bộ tỉnh Hà Tây, huyện Mê Linh (Vĩnh Phúc) và bốn xã của huyện Lương Sơn (Hòa Bình) vào Hà Nội.",
                       en="All of Hà Tây, Mê Linh district (Vĩnh Phúc) and four communes of Lương Sơn (Hòa Bình) join Hà Nội.",
                       cite=("tvpl_2008.html", "Chuyển toàn bộ huyện Mê Linh, tĩnh Vĩnh Phúc về thành phố Hà Nội"))]),
    dict(id="2024", date="2024-11-30", count=63, kinds={PROV: 57, CITY: 6},
         title_vi="Huế thành thành phố trực thuộc Trung ương", title_en="Huế becomes a centrally governed city",
         legal=[(WP_CAP, "Nghị quyết của Quốc hội (30/11/2024) thành lập thành phố Huế trực thuộc trung ương (theo Wikipedia)",
                 "National Assembly resolution of 30 Nov 2024 creating the centrally governed city of Huế (per Wikipedia)")],
         ops=[("rename", "Thừa Thiên Huế", "Huế", CITY)],
         changes=[dict(vi="Tỉnh Thừa Thiên Huế trở thành thành phố Huế trực thuộc Trung ương; địa giới không đổi.", en="Thừa Thiên Huế province becomes the centrally governed city of Huế; same boundaries.",
                       status=True, cite=(WP_CAP, "thành lập thành phố [[Huế]] là thành phố trực thuộc trung ương trên cơ sở tỉnh [[Thừa Thiên – Huế|Thừa Thiên Huế]]"))]),
    dict(id="2025", date="2025-06-12", count=34, kinds={PROV: 28, CITY: 6}, map34=True,
         title_vi="Sắp xếp còn 34 tỉnh, thành", title_en="Rearranged into 34 provinces and cities",
         legal=[(WP_CAP, "Nghị quyết số 202/2025/QH15 (12/6/2025) về việc sắp xếp đơn vị hành chính cấp tỉnh",
                 "Resolution 202/2025/QH15 (12 Jun 2025) on rearranging the province-level units")],
         changes=[dict(vi="23 tỉnh, thành mới hợp nhất từ 52 tỉnh, thành cũ; 11 tỉnh, thành giữ nguyên (ranh giới theo OCHA COD-AB 2025, như bản đồ hiện tại).",
                       en="23 new provinces and cities merge 52 former ones; 11 stay as they were (boundaries from OCHA COD-AB 2025, as on the current map).",
                       cite=(WP_CAP, "Tính đến ngày 12 tháng 6 năm 2025, Việt Nam có 34 đơn vị hành chính cấp tỉnh, gồm 28 tỉnh và 6 thành phố trực thuộc trung ương"))]),
    dict(id="2026", date="2026-09-20", count=34, kinds={PROV: 25, CITY: 9}, map34=True,
         title_vi="Ba tỉnh lên thành phố trực thuộc Trung ương", title_en="Three provinces become central cities",
         legal=[(WP_CAP, "Các nghị quyết của Quốc hội khóa XVI năm 2026 thành lập thành phố Đồng Nai, Quảng Ninh, Bắc Ninh (theo Wikipedia)",
                 "National Assembly resolutions of 2026 creating the cities of Đồng Nai, Quảng Ninh and Bắc Ninh (per Wikipedia)")],
         status_cities=["Đồng Nai", "Quảng Ninh", "Bắc Ninh"],
         changes=[
             dict(vi="30/4/2026: tỉnh Đồng Nai thành thành phố Đồng Nai trực thuộc Trung ương; địa giới không đổi.", en="30 Apr 2026: Đồng Nai province becomes a centrally governed city; same boundaries.",
                  status=True, cite=(WP_CAP, "thành lập [[Đồng Nai|thành phố Đồng Nai]] trực thuộc trung ương trên cơ sở toàn bộ diện tích tự nhiên và quy mô dân số của tỉnh Đồng Nai")),
             dict(vi="1/9/2026: tỉnh Quảng Ninh thành thành phố Quảng Ninh (Nghị quyết 36/2026/QH16); địa giới không đổi.", en="1 Sep 2026: Quảng Ninh becomes a centrally governed city (Resolution 36/2026/QH16); same boundaries.",
                  status=True, cite=(WP_CAP, "Nghị quyết số 36/2026/QH16 về việc thành lập [[Quảng Ninh|thành phố Quảng Ninh]]")),
             dict(vi="20/9/2026: tỉnh Bắc Ninh thành thành phố Bắc Ninh (Nghị quyết 39/2026/QH16); địa giới không đổi.", en="20 Sep 2026: Bắc Ninh becomes a centrally governed city (Resolution 39/2026/QH16); same boundaries.",
                  status=True, cite=(WP_CAP, "Nghị quyết 39/2026/QH16 về việc thành lập [[Bắc Ninh|thành phố Bắc Ninh]]")),
         ]),
]

# Where the map is coarser than the law (district-level hexes, or a source that does not settle it).
APPROX = [
    dict(frames=["1976", "1977"], vi="Bốn xã của Thường Tín và xã Hữu Hòa (Thanh Oai) thuộc Hà Sơn Bình đến 1978 nay nằm trong huyện Thanh Trì; bản đồ vẽ cả huyện Thanh Trì thuộc Hà Nội.",
         en="Four Thường Tín communes and Hữu Hòa (Thanh Oai), Hà Sơn Bình's until 1978, now lie in Thanh Trì; the map draws all of Thanh Trì in Hà Nội."),
    dict(frames=["1978", "1979", "1982", "1989"], vi="Năm 1978 Hà Nội còn nhận một số xã của Quốc Oai, Chương Mỹ, Thanh Oai; ở cấp huyện của năm 2020, các huyện này vẫn vẽ thuộc Hà Sơn Bình.",
         en="In 1978 Hà Nội also took some communes of Quốc Oai, Chương Mỹ and Thanh Oai; at the 2020 district level these districts stay with Hà Sơn Bình."),
    dict(frames=["1978", "1979", "1982", "1989"], vi="Thị xã Hà Đông vào Hà Nội năm 1978; Nghị quyết 12/8/1991 liệt kê Hà Đông trong tỉnh Hà Tây nhưng không ghi việc chuyển từ Hà Nội về. Nguồn không cho biết Hà Đông về lại Hà Sơn Bình lúc nào; bản đồ giữ Hà Đông thuộc Hà Nội đến 1991.",
         en="Hà Đông town joined Hà Nội in 1978; the 12 Aug 1991 resolution lists it in Hà Tây without moving it from Hà Nội. The sources do not say when it went back to Hà Sơn Bình; the map keeps it in Hà Nội until 1991."),
    dict(frames=["1976", "1977", "1978", "1979"], vi="Trường Sa: Nghị quyết 28/12/1982 chuyển huyện Trường Sa từ Đồng Nai về Phú Khánh; các mốc trước 1982 vẽ Trường Sa thuộc Đồng Nai theo nghị quyết đó (bản thân huyện Trường Sa thành lập năm 1982).",
         en="Trường Sa: the 28 Dec 1982 resolution moved Trường Sa district from Đồng Nai to Phú Khánh; frames before 1982 draw it with Đồng Nai on that basis (the district itself was set up in 1982)."),
    dict(frames=["1976", "1977", "1978", "1979", "1982", "1989", "1991-08", "1991-12"], vi="Hoàng Sa vẽ thuộc Quảng Nam – Đà Nẵng (nay Đà Nẵng) ở mọi mốc trước 1996; ngày lập huyện Hoàng Sa không có trong các nguồn trên.",
         en="Hoàng Sa is drawn with Quảng Nam – Đà Nẵng (now Đà Nẵng) in every frame before 1996; the date the Hoàng Sa district was set up is not in these sources."),
    dict(frames=["1976", "1977", "1978", "1979", "1982", "1989", "1991-08", "1991-12", "1996", "2003"],
         vi="Bốn xã Đông Xuân, Tiến Xuân, Yên Bình, Yên Trung (Lương Sơn, Hòa Bình) vào Hà Nội năm 2008 nay thuộc Quốc Oai và Thạch Thất; bản đồ vẽ hai huyện này thuộc Hà Tây (hoặc Hà Nội, Hà Sơn Bình) cả trước 2008.",
         en="The four Lương Sơn communes (Đông Xuân, Tiến Xuân, Yên Bình, Yên Trung) that joined Hà Nội in 2008 now lie in Quốc Oai and Thạch Thất; before 2008 the map draws them with those districts, not with Hòa Bình."),
    dict(frames=None, vi="Các điều chỉnh cấp xã khác (ví dụ xã Đồng Nai 1981, thôn Vũng Rô 1993, xã Tân Đức và ấp C10 năm 2008) nhỏ hơn một ô lục giác và không được vẽ.",
         en="Other commune-level moves (e.g. Đồng Nai commune 1981, Vũng Rô hamlet 1993, Tân Đức commune and hamlet C10 in 2008) are smaller than a hex and are not drawn."),
]

RULES = {
    "frames": "One frame per change of the province map from 1976 to 2026, dated by the resolution (adoption; the 2008 "
              "merger by its date in force). A year shows the last frame dated in or before it.",
    "cells": "Each frame's `cells` is a run-length list [province, run, province, run, …] over the map's land hexes in hex "
             "order (world.json owner ≥ 0), so its runs add up to `n_land`. Province is an index into the frame's `provinces`.",
    "districts": "Before 2025 a province is a set of 2020 districts (OCHA COD-AB 2020, admin 2); a land hex takes the "
                 "province of its district: the district under most of the hex's 7 sample points (centre and 6 points "
                 "0.6 hex radius out), among the districts of the hex's former province on world.json (so the 63 nest "
                 "exactly); a hex none of whose points falls in such a district takes its neighbours' commonest one.",
    "members": "`from` lists the 2020 provinces wholly inside, `plus` the 2020 districts added to them and `minus` the "
               "2020 districts taken out. Districts are named as in 2020; historical names are in the change texts.",
    "2025": "The 2025 and 2026 frames are world.json's 34 provinces (OCHA COD-AB 2025) hex for hex.",
    "counts": "`count` is the number of province-level units the sources give for the end of that change "
              "(Wikipedia's year-by-year list); the 12 Aug 1991 count (49) is derived from the resolution (44 + 5 splits; "
              "Bà Rịa – Vũng Tàu replaces the Vũng Tàu – Côn Đảo zone), as the list gives only the year-end 53.",
}
RULES_VI = {
    "frames": "Mỗi mốc là một lần bản đồ tỉnh thay đổi từ 1976 đến 2026, ghi theo ngày thông qua nghị quyết (riêng việc hợp "
              "nhất năm 2008 theo ngày có hiệu lực). Một năm hiển thị mốc gần nhất trong hoặc trước năm đó.",
    "districts": "Trước 2025, mỗi tỉnh là một tập hợp huyện của năm 2020 (OCHA COD-AB 2020, cấp 2); mỗi ô đất thuộc tỉnh "
                 "chứa huyện của nó: huyện có nhiều trong 7 điểm mẫu của ô nhất, trong số các huyện của tỉnh cũ của ô.",
    "2025": "Mốc 2025 và 2026 là đúng 34 tỉnh, thành của bản đồ hiện tại (OCHA COD-AB 2025).",
    "counts": "Số tỉnh, thành mỗi mốc theo danh sách từng năm của Wikipedia; số 49 ngày 12/8/1991 được suy ra từ nghị quyết "
              "(44 + 5 tỉnh tách; Bà Rịa – Vũng Tàu thay đặc khu), vì danh sách chỉ cho số cuối năm 53.",
}


# --- source texts ---------------------------------------------------------------------------------------------------
def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def source_text(name: str) -> str:
    folder = "borders_wiki" if name.startswith("wp_") else "borders_legal"
    data = (RAW / folder / name).read_bytes()
    if data[:2] == b"\x1f\x8b":  # the Internet Archive's id_ copies arrive gzip-encoded
        data = gzip.decompress(data)
    raw = data.decode("utf-8", errors="ignore")
    if name.endswith(".json"):
        page = json.loads(raw)["query"]["pages"][0]
        return _norm(page["revisions"][0]["slots"]["main"]["content"])
    raw = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S)
    return _norm(html.unescape(re.sub(r"<[^>]+>", " ", raw)))


# --- hex → 2020 district ----------------------------------------------------------------------------------------------
def districts_2020():
    """[(key "Province|District", province name (old_units), rings)] of COD-AB 2020 admin 2."""
    from .ext_communes import read_shp_polygons
    names = {_key(u["name"]): u["name"] for u in old_units()}
    with zipfile.ZipFile(RAW / "hdx_cod_ab_vnm_2020" / ADM2[0]) as z:
        shp, dbf = z.read(ADM2[1] + ".shp"), z.read(ADM2[1] + ".dbf")
    out = []
    for (dn, rings), (pn, _) in zip(read_shp_polygons(shp, dbf, "ADM2_VI"), read_shp_polygons(shp, dbf, "ADM1_VI")):
        prov = names[_key(pn)]
        out.append((f"{prov}|{dn}", prov, rings))
    return out


def district_raster(dists):
    """int16 lookup raster (world.py's grid) of the district index, -1 outside; each district filled even–odd inside
    its own bounding window (so holes stay holes)."""
    out = np.full((NROW, NCOL), -1, "int16")
    for k, (_, _, rings) in enumerate(dists):
        pts = np.array([p for r in rings for p in r])
        c0, c1 = max(int((pts[:, 0].min() - LON0) / RES) - 1, 0), min(int((pts[:, 0].max() - LON0) / RES) + 2, NCOL)
        r0, r1 = max(int((LAT1 - pts[:, 1].max()) / RES) - 1, 0), min(int((LAT1 - pts[:, 1].min()) / RES) + 2, NROW)
        if c1 <= c0 or r1 <= r0:
            continue
        tr = from_origin(LON0 + c0 * RES, LAT1 - r0 * RES, RES, RES)
        shp = [({"type": "Polygon", "coordinates": [r]}, 1) for r in rings if len(r) >= 4]
        m = features.rasterize(shp, out_shape=(r1 - r0, c1 - c0), transform=tr, fill=0, dtype="int16",
                               merge_alg=MergeAlg.add) % 2 == 1
        out[r0:r1, c0:c1][m] = k
    return out


def hex_districts(W, dists):
    """District index per hex (-1 off Vietnam's land); see RULES["districts"]."""
    ras = district_raster(dists)
    olds = [u["name"] for u in old_units()]
    prov_of = [p for _, p, _ in dists]
    offsets = [(0.0, 0.0)] + [(0.6 * R * math.cos(math.radians(60 * k - 30)), 0.6 * R * math.sin(math.radians(60 * k - 30)))
                              for k in range(6)]
    n = W.grid.size
    out = [-1] * n
    todo = []
    for i in range(n):
        if W.owner[i] < 0:
            continue
        want = olds[W.county[i]]
        cx, cy = W.grid.center(*W.grid.col_row(i))
        got = []
        for dx, dy in offsets:
            lon, lat = W.proj.inverse(cx + dx, cy + dy)
            r, c = int((LAT1 - lat) / RES), int((lon - LON0) / RES)
            k = int(ras[r, c]) if 0 <= r < NROW and 0 <= c < NCOL else -1
            if k >= 0 and prov_of[k] == want:
                got.append(k)
        if got:
            cnt = Counter(got)
            top = max(cnt.values())
            out[i] = got[0] if cnt[got[0]] == top else cnt.most_common(1)[0][0]
        else:
            todo.append(i)
    # hexes with no in-province sample (coast slivers, island hexes): the commonest district of same-province neighbours
    for _ in range(50):
        left = []
        for i in todo:
            want = olds[W.county[i]]
            nb = [out[j] for j in W.grid.neighbours(i) if out[j] >= 0 and prov_of[out[j]] == want]
            if nb:
                out[i] = Counter(nb).most_common(1)[0][0]
            else:
                left.append(i)
        if not left or len(left) == len(todo):
            todo = left
            break
        todo = left
    # isolated island hexes: the province's district nearest by centroid
    for i in todo:
        want = olds[W.county[i]]
        cx, cy = W.grid.center(*W.grid.col_row(i))
        lon, lat = W.proj.inverse(cx, cy)
        best = min((k for k in range(len(dists)) if prov_of[k] == want),
                   key=lambda k: min((p[0] - lon) ** 2 + (p[1] - lat) ** 2 for r in dists[k][2] for p in r[::25] or r))
        out[i] = best
    return out, len(todo)


# --- frames → district sets ---------------------------------------------------------------------------------------------
def expand(units, by_prov, all_keys):
    out = set()
    for u in units:
        if "|" in u:
            assert u in all_keys, f"unknown 2020 district {u}"
            out.add(u)
        else:
            assert u in by_prov, f"unknown 2020 province {u}"
            out |= by_prov[u]
    return out


def build_frames(dists):
    all_keys = {k for k, _, _ in dists}
    by_prov = {}
    for k, p, _ in dists:
        by_prov.setdefault(p, set()).add(k)
    # 1976: whole provinces first, then the explicit districts win (moved out of whichever province held them)
    state = {}
    for name, kind, units in FRAMES[0]["base"]:
        state[name] = [kind, expand([u for u in units if "|" not in u], by_prov, all_keys)]
    for name, kind, units in FRAMES[0]["base"]:
        for u in units:
            if "|" in u:
                for other in state.values():
                    other[1].discard(u)
                state[name][1].add(u)
    out = []
    for f in FRAMES:
        if f.get("map34"):
            out.append(None)
            continue
        for op in f.get("ops", []):
            kind = op[0]
            if kind == "move":
                _, units, src, dst = op
                u = expand(units, by_prov, all_keys)
                assert u <= state[src][1], f"{f['id']}: {sorted(u - state[src][1])} not in {src}"
                state[src][1] -= u
                state[dst][1] |= u
            elif kind == "split":
                _, old, news = op
                rest = state.pop(old)[1]
                for k, (name, knd, units) in enumerate(news):
                    u = rest if k == len(news) - 1 else expand(units, by_prov, all_keys)
                    assert u <= rest, f"{f['id']}: {name} takes units outside {old}"
                    rest = rest - u
                    state[name] = [knd, u]
            elif kind == "new":
                _, name, knd, parts = op
                acc = set()
                for src, units in parts:
                    u = expand(units, by_prov, all_keys) & state[src][1]
                    assert u, f"{f['id']}: nothing of {units} in {src}"
                    state[src][1] -= u
                    acc |= u
                state[name] = [knd, acc]
            elif kind == "drop":
                assert not state[op[1]][1], f"{f['id']}: {op[1]} not empty"
                del state[op[1]]
            elif kind == "merge":
                _, olds, new, knd = op
                acc = set().union(*(state.pop(o)[1] for o in olds))
                state.setdefault(new, [knd, set()])[1] |= acc
                state[new][0] = knd
            elif kind == "rename":
                _, old, new, knd = op
                state[new] = [knd, state.pop(old)[1]]
            else:
                raise ValueError(op)
        union = set().union(*(v[1] for v in state.values()))
        assert union == all_keys and sum(len(v[1]) for v in state.values()) == len(all_keys), f"{f['id']}: districts lost or doubled"
        out.append({n: (k, set(u)) for n, (k, u) in state.items()})
    return out, by_prov


def members(units, by_prov):
    """{from, plus, minus} of a district set in 2020 terms (see RULES["members"])."""
    frm, plus, minus = [], [], []
    for p, ds in sorted(by_prov.items()):
        k = len(units & ds)
        if k == len(ds):
            frm.append(p)
        elif k * 2 > len(ds):
            frm.append(p)
            minus += sorted(f"{x.split('|')[1]} ({p})" for x in ds - units)
        elif k:
            plus += sorted(f"{x.split('|')[1]} ({p})" for x in units & ds)
    return {"from": frm, **({"plus": plus} if plus else {}), **({"minus": minus} if minus else {})}


def rle(vals):
    out = []
    for v in vals:
        if out and out[-2] == v:
            out[-1] += 1
        else:
            out += [v, 1]
    return out


def build():
    W = World()
    world = load_web("world.json")
    assert world["owner"] == W.owner, "world.json and the _world interim differ: rebuild world first"
    land = [i for i, o in enumerate(W.owner) if o >= 0]
    dists = districts_2020()
    hd, isolated = hex_districts(W, dists)
    print(f"    {len(land)} land hexes, {len(dists)} districts ({isolated} hexes placed by nearest district)")
    frames, by_prov = build_frames(dists)
    texts = {}
    cite_ok = lambda name, quote: _norm(quote) in texts.setdefault(name, source_text(name))
    news = new_units()
    out = []
    for f, st in zip(FRAMES, frames):
        for ch in f["changes"]:
            assert cite_ok(*ch["cite"]), f"{f['id']}: the sentence is not in {ch['cite'][0]}: {ch['cite'][1]}"
        if st is None:  # the 34 of world.json
            cities = {"Hà Nội", "Hải Phòng", "Huế", "Đà Nẵng", "TP. Hồ Chí Minh", "Cần Thơ"} | set(f.get("status_cities", []))
            provs = [{"name": u["name"], "kind": CITY if u["name"] in cities else PROV, "from": sorted(u["olds"])} for u in news]
            vals = [W.owner[i] for i in land]
        else:
            names = sorted(st, key=lambda n: (st[n][0] != CITY, n))
            idx = {}
            for k, n in enumerate(names):
                for u in st[n][1]:
                    idx[u] = k
            provs = [{"name": n, "kind": st[n][0], **members(st[n][1], by_prov)} for n in names]
            vals = [idx[dists[hd[i]][0]] for i in land]
        used = Counter(vals)
        assert len(provs) == f["count"] == len(used), f"{f['id']}: {len(provs)} provinces, {len(used)} on the map, want {f['count']}"
        kinds = Counter(p["kind"] for p in provs)
        assert dict(kinds) == f["kinds"], f"{f['id']}: kinds {dict(kinds)} != {f['kinds']}"
        for p, k in zip(provs, range(len(provs))):
            p["hexes"] = used[k]
        out.append({
            "id": f["id"], "date": f["date"], **({"adopted": f["adopted"]} if "adopted" in f else {}),
            "count": f["count"], **({"count_note": f["count_note"]} if "count_note" in f else {}),
            "kinds": dict(kinds), "title": f["title_en"], "title_vi": f["title_vi"],
            "legal": [{"text_vi": vi, "text": en, "url": page_url(src), "file": src,
                       "source": "borders_wiki" if src.startswith("wp_") else "borders_legal"} for src, vi, en in f["legal"]],
            "changes": [{"text": c["en"], "text_vi": c["vi"], "status": bool(c.get("status")), "url": page_url(c["cite"][0]),
                         "evidence": c["cite"][1]} for c in f["changes"]],
            "approx": [{"text": a["en"], "text_vi": a["vi"]} for a in APPROX if a["frames"] is None or f["id"] in a["frames"]],
            "provinces": provs, "cells": rle(vals)})
    # the 2008 frame is the 63 former provinces of world.json, hex for hex
    f08 = next(o for o in out if o["id"] == "2008")
    olds = [u["name"] for u in old_units()]
    names08 = [p["name"] for p in f08["provinces"]]
    vals08 = [v for k in range(0, len(f08["cells"]), 2) for v in [f08["cells"][k]] * f08["cells"][k + 1]]
    assert all(names08[v].replace(" – ", "–") == olds[W.county[i]] for v, i in zip(vals08, land)), "2008 ≠ the 63"
    write_web("borders_history.json", {
        "version": 1, "sources": ["borders_legal", "borders_wiki", "hdx_cod_ab_vnm_2020", "hdx_cod_ab_vnm"],
        "n_land": len(land), "rules": RULES, "rules_vi": RULES_VI, "frames": out})
