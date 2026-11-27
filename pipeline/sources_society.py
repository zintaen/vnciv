"""Sources of the society stream (ethnic groups, crops, history)."""

CENSUS_URL = "https://www.nso.gov.vn/wp-content/uploads/2019/12/Ket-qua-toan-bo-Tong-dieu-tra-dan-so-va-nha-o-2019.pdf"

SOURCES = [
    dict(id="nso_census2019", title="Completed results of the 2019 Population and Housing Census",
         publisher="National Statistics Office of Vietnam (NSO, formerly GSO)",
         homepage="https://www.nso.gov.vn/du-lieu-va-so-lieu-thong-ke/2020/11/ket-qua-toan-bo-tong-dieu-tra-dan-so-va-nha-o-nam-2019/",
         license="No licence stated; official statistics, reused with attribution",
         description="Kết quả toàn bộ Tổng điều tra dân số và nhà ở năm 2019 (census day 1 April 2019), Table 2: "
         "population by ethnic group (54 groups, plus foreigners and not stated) for the nation, the 6 regions and the "
         "63 provinces of the time. Parsed by pipeline/nso/census2019.py into data/stats/census2019/; every province's "
         "groups add up to its total and every group's provinces add up to the national row.",
         used_for=["Largest ethnic group lens", "Ethnic minority share lens", "Ethnic groups in the province panels"],
         files=[(CENSUS_URL, "Ket-qua-toan-bo-Tong-dieu-tra-dan-so-va-nha-o-2019.pdf")]),
    dict(id="wikipedia_history", title="Wikipedia articles on Vietnam's capitals, dynasties and provinces",
         publisher="Wikipedia (English and Vietnamese), via the MediaWiki API", homepage="https://www.wikipedia.org/",
         license="CC BY-SA 4.0",
         description="Plain-text extracts and coordinates of the articles cited by the timeline's history events "
         "(capitals from Phong Châu and Cổ Loa to Huế and Hà Nội, dynasties, the French conquest, 1945–1976, and the "
         "province splits and mergers up to the 34 provinces of 2025). Each event keeps the sentence that states its "
         "date; dates before about 1000 CE follow tradition and chronicles.",
         used_for=["History events on the timeline"],
         files=[
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=An_D%C6%B0%C6%A1ng_V%C6%B0%C6%A1ng&format=json&formatversion=2', 'an_duong_vuong.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=C%E1%BB%95_Loa_Citadel&format=json&formatversion=2', 'co_loa.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=%C4%90inh_dynasty&format=json&formatversion=2', 'dinh_dynasty.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Fall_of_Saigon&format=json&formatversion=2', 'fall_saigon.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=French_conquest_of_Vietnam&format=json&formatversion=2', 'french_conquest.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=1954_Geneva_Conference&format=json&formatversion=2', 'geneva.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=H%C3%A0_T%C3%A2y_province&format=json&formatversion=2', 'ha_tay.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Hanoi&format=json&formatversion=2', 'hanoi.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Citadel_of_the_H%E1%BB%93_Dynasty&format=json&formatversion=2', 'ho_citadel.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=H%E1%BB%93_dynasty&format=json&formatversion=2', 'ho_dynasty.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Hoa_L%C6%B0_Ancient_Capital&format=json&formatversion=2', 'hoa_lu_ancient.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Hu%E1%BA%BF&format=json&formatversion=2', 'hue.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Treaty_of_Hu%E1%BA%BF_%281884%29&format=json&formatversion=2', 'hue_treaty.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Imperial_City_of_Hu%E1%BA%BF&format=json&formatversion=2', 'imperial_hue.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Later_L%C3%AA_dynasty&format=json&formatversion=2', 'later_le.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=L%C3%BD_dynasty&format=json&formatversion=2', 'ly_dynasty.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Nguy%E1%BB%85n_dynasty&format=json&formatversion=2', 'nguyen_dynasty.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Proclamation_of_Independence_of_the_Democratic_Republic_of_Vietnam&format=json&formatversion=2', 'proclamation.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=2025_Vietnamese_administrative_reforms&format=json&formatversion=2', 'reforms2025.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=V%C4%83n_Lang&format=json&formatversion=2', 'van_lang.json'),
                ('https://vi.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=%C4%90%C6%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_c%E1%BA%A5p_t%E1%BB%89nh_%28Vi%E1%BB%87t_Nam%29&format=json&formatversion=2', 'vi_captinh.json'),
                ('https://vi.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Ph%C3%A2n_c%E1%BA%A5p_h%C3%A0nh_ch%C3%ADnh_Vi%E1%BB%87t_Nam&format=json&formatversion=2', 'vi_hanhchinh.json'),
                ('https://vi.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=H%C3%A0_T%C3%A2y_%28t%E1%BB%89nh%29&format=json&formatversion=2', 'vi_hatay_tinh.json'),
                ('https://vi.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Ph%C3%BA_Xu%C3%A2n&format=json&formatversion=2', 'vi_phuxuan.json'),
                ('https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=Vietnam&format=json&formatversion=2', 'vietnam.json')]),
]
