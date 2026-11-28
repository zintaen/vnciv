"""Sources of the current air routes (stream fresh2): the "Airlines and destinations" tables of the English and
Vietnamese Wikipedia articles on each Vietnamese airport with scheduled service (current revision, with its id and
timestamp)."""
import json
import urllib.parse

from .fetch import RAW
from .sources import sparql

# IATA → (English title, Vietnamese title): OurAirports' Wikipedia link (redirects followed) and the vi Wikipedia
# title from Wikidata (pipeline/sources.py Q_AIRPORTS), for the 22 airports of infrastructure.json
AIRPORT_ARTICLES = {
    "BMV": ("Buon Ma Thuot Airport", "Sân bay Buôn Ma Thuột"),
    "CAH": ("Ca Mau Airport", "Sân bay Cà Mau"),
    "CXR": ("Cam Ranh International Airport", "Sân bay quốc tế Cam Ranh"),
    "DAD": ("Da Nang International Airport", "Sân bay quốc tế Đà Nẵng"),
    "DIN": ("Dien Bien Airport", "Sân bay Điện Biên"),
    "DLI": ("Lien Khuong International Airport", "Sân bay quốc tế Liên Khương"),
    "HAN": ("Noi Bai International Airport", "Sân bay quốc tế Nội Bài"),
    "HPH": ("Cat Bi International Airport", "Sân bay quốc tế Cát Bi"),
    "HUI": ("Phu Bai International Airport", "Sân bay quốc tế Phú Bài"),
    "PQC": ("Phu Quoc International Airport", "Sân bay quốc tế Phú Quốc"),
    "PXU": ("Pleiku Airport", "Sân bay Pleiku"),
    "SGN": ("Tan Son Nhat International Airport", "Sân bay quốc tế Tân Sơn Nhất"),
    "TBB": ("Tuy Hoa Airport", "Sân bay Tuy Hòa"),
    "THD": ("Tho Xuan Airport", "Sân bay Thọ Xuân"),
    "UIH": ("Phu Cat Airport", "Sân bay Phù Cát"),
    "VCA": ("Can Tho International Airport", "Sân bay quốc tế Cần Thơ"),
    "VCL": ("Chu Lai Airport", "Sân bay Chu Lai"),
    "VCS": ("Con Dao Airport", "Sân bay Côn Đảo"),
    "VDH": ("Dong Hoi Airport", "Sân bay Đồng Hới"),
    "VDO": ("Van Don International Airport", "Sân bay quốc tế Vân Đồn"),
    "VII": ("Vinh International Airport", "Sân bay quốc tế Vinh"),
    "VKG": ("Rach Gia Airport", "Sân bay Rạch Giá"),
}


def rev_url(lang, title):
    return (f"https://{lang}.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent"
            f"&rvslots=main&redirects=1&format=json&formatversion=2&titles=" + urllib.parse.quote(title))


BATCH = 40  # titles per MediaWiki query (keeps the URL short)


def link_targets(lang):
    """Every airline and destination link of the downloaded tables of one language, sorted."""
    from . import airtables
    rows = airtables.en_rows if lang == "en" else airtables.vi_rows
    out = set()
    for iata in AIRPORT_ARTICLES:
        p = RAW / "wikipedia_air_routes" / f"{lang}_{iata}.json"
        if p.exists():
            for airline, dests in rows(airtables.revision(p)[0]):
                out |= {airline} | {d[0] for d in dests}
    return sorted(out)


def _resolve_files():
    """Stage 2 (after the articles): each link → its page and Wikidata item; stage 3 (after that): the IATA codes of
    those items. Empty until the earlier stage is downloaded; re-run the fetch to get the next stage."""
    files, qids = [], set()
    for lang in ("en", "vi"):
        t = link_targets(lang)
        for k in range(0, len(t), BATCH):
            name = f"links_{lang}_{k // BATCH:02d}.json"
            files.append((f"https://{lang}.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item"
                          "&redirects=1&format=json&formatversion=2&titles=" + urllib.parse.quote("|".join(t[k:k + BATCH])), name))
            p = RAW / "wikipedia_air_routes" / name
            if p.exists():
                qids |= {pg["pageprops"]["wikibase_item"] for pg in json.loads(p.read_text())["query"].get("pages", [])
                         if "wikibase_item" in pg.get("pageprops", {})}
    if qids:
        # airports: IATA airport code (P238); airlines: IATA airline designator (P229)
        files.append((sparql("SELECT ?s ?iata ?airline WHERE { VALUES ?s { " + " ".join("wd:" + q for q in sorted(qids)) +
                             " } { ?s wdt:P238 ?iata. } UNION { ?s wdt:P229 ?airline. } }"), "iata.json"))
    return files


SOURCES = [
    dict(id="wikipedia_air_routes", title="Airlines and destinations of Vietnam's airports",
         publisher="Wikipedia (English and Vietnamese)", homepage="https://en.wikipedia.org/wiki/List_of_airports_in_Vietnam",
         license="CC BY-SA 4.0",
         description="The \"Airlines and destinations\" (\"Hãng hàng không và điểm đến\") tables of the English and "
         "Vietnamese Wikipedia articles on the 22 Vietnamese airports with scheduled service, current revision (its "
         "id and timestamp are kept). Each row names an airline and the airports it flies to from that airport, with "
         "seasonal and charter services marked. Wikipedia editors compile the tables from airline announcements; "
         "they are not an official schedule and can lag behind or run ahead of what is flown.",
         used_for=["Air routes (domestic, which airlines fly them)", "Traffic planes"],
         files=[(rev_url(lang, t[i]), f"{lang}_{iata}.json") for iata, t in AIRPORT_ARTICLES.items()
                for i, lang in enumerate(("en", "vi"))] + _resolve_files()),
]

# Minderhoud et al. 2019 (Nature Communications 10:3847): DEM of the Vietnamese Mekong delta from the 2014 national
# topographical map, in the local Hòn Dấu tidal datum (PANGAEA, CC BY 4.0)
MEKONG = "https://store.pangaea.de/Publications/Minderhoud-etal_2019/"
SOURCES.append(dict(
    id="mekong_dem", title="Digital elevation model of the Vietnamese Mekong delta (Topo DEM)",
    publisher="Minderhoud, Coumou, Erkens, Middelkoop & Stouthamer (2019), via PANGAEA",
    homepage="https://doi.pangaea.de/10.1594/PANGAEA.902136", license="CC BY 4.0",
    description="Elevation of the Vietnamese part of the Mekong delta, interpolated (empirical Bayesian kriging) from "
    "almost 20,000 elevation points of a 2014 national topographical map (1:200,000), in metres above the Hòn Dấu "
    "datum (mean sea level at the Hòn Dấu tide gauge); rivers and bedrock outcrops above +10 m are cut out. Published "
    "with Minderhoud et al. 2019, \"Mekong delta much lower than previously assumed in sea-level rise impact "
    "assessments\", Nature Communications 10:3847 (doi:10.1038/s41467-019-11602-1), which finds a mean elevation of "
    "about 0.8 m above sea level instead of the earlier assumed about 2.6 m.",
    used_for=["Sea-level exposure in the Mekong delta (sealevel.json)", "Low-lying land lens (Mekong delta)"],
    files=[(MEKONG + "Topo_DEM_Mekong_delta_excl_rivers_and_bedrock.zip", "Topo_DEM_Mekong_delta.zip"),
           (MEKONG + "README_Topo_DEM_Mekong_Delta_Source_information.txt", "README.txt"),
           ("https://www.nature.com/articles/s41467-019-11602-1", "minderhoud_2019.html")]))
