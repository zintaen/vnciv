"""Sources of the living map (web/js/ext/living, pipeline/build/ext_living.py). The pages were fetched on 2026-11-28
into data/raw/living_refs/ (manifest.json there lists each file's URL, date and sha256); `files` is empty so
`pipeline fetch` does not re-download them (several are Wayback copies of pages that are gone)."""

SOURCES = [
    dict(id="usda_ipad_cropcal", title="Southeast Asia crop calendar: Vietnam rice", publisher="USDA Foreign Agricultural "
         "Service, International Production Assessment Division (IPAD)",
         homepage="https://ipad.fas.usda.gov/rssiws/al/crop_calendar/seasia.aspx", license="Public domain (U.S. Government work)",
         description="Planting, mid-season and harvest months of Vietnam's rice seasons (North: winter–spring, main season; "
         "South: winter–spring, summer–autumn early and late) with each season's share of production. The chart was read "
         "against its month gridlines (the page has no table); the live host no longer resolves, so the Wayback Machine copy "
         "was used.",
         used_for=["Living map: rice paddies by month"], files=[]),
    dict(id="fao_giews_vnm", title="GIEWS country brief: Viet Nam (26 February 2026)", publisher="FAO Global Information "
         "and Early Warning System", homepage="https://www.fao.org/giews/countrybrief/country.jsp?code=VNM",
         license="© FAO (cited, not redistributed)",
         description="FAO's crop calendar for Viet Nam's rice seasons, used as a cross-check of the USDA calendar.",
         used_for=["Living map: rice paddies by month (cross-check)"], files=[]),
    dict(id="hcmue_flood_2016", title="Lũ ở Đồng bằng sông Cửu Long (Phạm Thị Huyền Trang & Trương Văn Tuấn)",
         publisher="Tạp chí Khoa học Trường ĐHSP TP. Hồ Chí Minh 3(81), 2016", homepage="https://journal.hcmue.edu.vn/",
         license="Cited (journal article)",
         description="The annually flooded upper Mekong Delta: '1.632.000 ha thuộc 8 tỉnh: Đồng Tháp, An Giang, Long An, "
         "Kiên Giang, Cần Thơ, Tiền Giang và một phần của Vĩnh Long, Bến Tre', and the season: inflow July–August, peak in "
         "September or early October at Tân Châu / Châu Đốc, recession from October to the end of December.",
         used_for=["Living map: Mekong flood season (illustrative)"], files=[]),
    dict(id="fao_mrc_flood", title="Flood forecasting in the Mekong (FAO document ac146e03)", publisher="FAO / Mekong River "
         "Commission", homepage="https://www.fao.org/", license="© FAO (cited)",
         description="'every flood season from July to November' in the Mekong Delta: corroborates the season's months.",
         used_for=["Living map: Mekong flood season (illustrative)"], files=[]),
    dict(id="nd26_2019", title="Nghị định 26/2019/NĐ-CP (Luật Thủy sản implementing decree), Articles 42–43",
         publisher="Chính phủ Việt Nam (via FAOLEX)", homepage="https://faolex.fao.org/docs/pdf/vie191156.pdf",
         license="Vietnamese legal text (not subject to copyright)",
         description="Fishing zones: vùng ven bờ (coastal; around islands to 6 nautical miles), vùng lộng (inshore) and "
         "vùng khơi (offshore, to the outer limit of the EEZ), and which boats fish in each. The zone lines' coordinates "
         "are not in the decree body, so the boat lights are generic.",
         used_for=["Living map: fishing-boat lights (illustrative)"], files=[]),
    dict(id="hnd_amlich", title="Âm lịch Việt Nam (Vietnamese lunar calendar tables and rules)", publisher="Hồ Ngọc Đức",
         homepage="https://www.informatik.uni-leipzig.de/~duc/amlich/", license="Free for personal, non-commercial use "
         "(the dates themselves are facts)",
         description="The year codes (TK20, TK21) of his amlich JavaScript, computed for 105°E (UTC+7): Tết = 1 January + "
         "the code's offset. His notes give the years Vietnam's Tết differs from China's (2007: 17 vs 18 February; 2030: "
         "2 vs 3 February). Wayback copy (the live site returns 404).",
         used_for=["Living map: Tết fireworks (Tết eve dates)"], files=[]),
    dict(id="hko_calendar", title="Gregorian–Lunar Calendar Conversion Tables", publisher="Hong Kong Observatory",
         homepage="https://www.hko.gov.hk/en/gts/time/conversion.htm", license="© HKO (cross-check only)",
         description="The Chinese calendar (UTC+8) for 1990–2040, a cross-check of the Vietnamese Tết dates.",
         used_for=["Living map: Tết dates (cross-check)"], files=[]),
]
