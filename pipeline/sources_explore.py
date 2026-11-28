"""Sources of the explore extension (web/js/ext/explore, pipeline/build/ext_seasons.py): the season calendar's sights
(month ranges quoted from Vietnamese Wikipedia articles, places from their coordinates) and the place-card photos
(Wikimedia Commons, fetched by the browser at runtime, each shown with its author and licence)."""

_WP = "https://vi.wikipedia.org/w/api.php?action=query&format=json&redirects=1&"


def _extract(title, name):
    from urllib.parse import quote
    return (_WP + "prop=extracts|pageprops|coordinates&explaintext=1&titles=" + quote(title), name)


SOURCES = [
    dict(id="wikipedia_vi_seasons", title="Vietnamese Wikipedia: seasonal sights (Mù Cang Chải, Hà Giang, Mộc Châu, "
         "Điện Biên, Quảng trường Lâm Viên)", publisher="Wikipedia tiếng Việt", homepage="https://vi.wikipedia.org/",
         license="CC BY-SA 4.0",
         description="Month ranges of seasonal sights, each quoted word for word from the article's text: the terraced "
         "fields of Mù Cang Chải (water season May–June, ripe rice September–October) and Hoàng Su Phì (planting April–June, "
         "ripe rice August to mid-October), Mộc Châu's seasons (white mustard flowers November–January, plum and peach "
         "blossom January–March, bauhinia in April, ripe plums in May), the Điện Biên bauhinia festival (mid-March) and the "
         "wild sunflowers of Đà Lạt (late November). Places: the coordinates of the articles about those districts.",
         used_for=["Season calendar: flowers and terraced fields"],
         files=[_extract("Ruộng bậc thang Mù Cang Chải", "mu_cang_chai_terraces.json"),
                _extract("Hà Giang", "ha_giang.json"),
                _extract("Mộc Châu (thị xã)", "moc_chau.json"),
                _extract("Điện Biên", "dien_bien.json"),
                _extract("Quảng trường Lâm Viên", "lam_vien_square.json"),
                (_WP + "prop=coordinates|pageprops&titles=M%C3%B9%20Cang%20Ch%E1%BA%A3i%20(huy%E1%BB%87n)%7C"
                 "Ho%C3%A0ng%20Su%20Ph%C3%AC%20(huy%E1%BB%87n)", "district_coords.json")]),
    dict(id="wikidata_seasons", title="Wikidata: Quảng trường Lâm Viên (Q56072444) coordinates", publisher="Wikidata",
         homepage="https://www.wikidata.org/wiki/Q56072444", license="CC0 1.0",
         description="The coordinates (P625) of Lâm Viên Square in Đà Lạt, where the wild-sunflower entry is placed.",
         used_for=["Season calendar: place of the Đà Lạt wild sunflowers"],
         files=[("https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q56072444&props=claims|labels&languages=vi"
                 "&format=json", "Q56072444.json")]),
    dict(id="wikimedia_commons", title="Wikimedia Commons photos (place cards)", publisher="Wikimedia Commons contributors",
         homepage="https://commons.wikimedia.org/", license="Each file's own free licence (CC0, public domain, CC BY, CC BY-SA)",
         description="The photos in a place card are fetched by the browser when the card opens (MediaWiki API: the place's "
         "Wikidata image, P18, when it has one; files found by the place's name near it; geotagged files nearest the point). Only files whose licence is CC0, public domain, CC BY or "
         "CC BY-SA are shown, each with its author, licence and a link to its file page; maps, logos, flags and diagrams "
         "are skipped by their file names. Nothing is stored by the atlas.",
         used_for=["Place cards: photos"], files=[]),
]
