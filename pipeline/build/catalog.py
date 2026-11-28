"""sources.json: the Almanac's bibliography from the source registry and download manifests."""
from __future__ import annotations

from ..fetch import manifest
from ..sources import SOURCES
from ..store import write_web

EXTRA = [
    dict(id="nso_yearbook", title="Statistical Yearbook of Vietnam 2025 (and 2024) and PX-Web database",
         publisher="National Statistics Office of Vietnam (NSO, formerly GSO)", homepage="https://www.nso.gov.vn/",
         license="No licence stated; official statistics, reused with attribution",
         description="Yearbook 2025, Part I (63 former provinces, 2025 preliminary): population, urban population, "
         "labour force, employment, unemployment, trained and informal labour, productivity, GRDP per person and growth, "
         "income, Gini, poverty, paddy rice, maize, cassava, sugarcane, tea, orange, retail sales, travel turnover, life expectancy, migration, internet use, IT "
         "skills, clean water, housing (2024). Its appendix (34 provinces of 2025): HDI, FDI, enterprises, doctors, forest "
         "cover, road deaths, pupils per teacher and the official 34-province rates. Yearbook 2024: area, literacy, HDI "
         "and FDI for the 63 former provinces (2024), university students (2023). PX-Web: population 2019–2025, "
         "enterprises 2024, employment by industry. Parsed into data/stats/ by pipeline/nso/; the appendix rice tables "
         "(Gia Lai and Khánh Hòa rows swapped) are replaced by sums of the former provinces.",
         used_for=["Yields", "City and province panels", "Province lenses", "Districts", "Citizens"],
         files=[{"file": "NG-TOAN-QUOC-2025-1.pdf", "url": "https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf"},
                {"file": "NG-TONG-CUC-2024_OKIN_Final.pdf", "url": "https://www.nso.gov.vn/wp-content/uploads/2026/01/NG-TONG-CUC-2024_OKIN_Final.pdf"},
                {"file": "PX-Web API", "url": "https://pxweb.nso.gov.vn/api/v1/vi/"}]),
    dict(id="nso_monthly_2026", title="Socio-economic situation reports, September and October 2026 (statistical tables)",
         publisher="National Statistics Office of Vietnam (NSO)", homepage="https://www.nso.gov.vn/",
         license="No licence stated; official statistics, reused with attribution",
         description="Estimated GRDP growth for the first 9 months of 2026 (constant 2020 prices) and the index of "
         "industrial-enterprise employment at 1 October 2026, by the 34 provinces.",
         used_for=["Growth 2026 and factory jobs 2026 lenses", "Province panels"],
         files=[{"file": "02.-Bieu-thang-9.2026.xlsx", "url": "https://www.nso.gov.vn/wp-content/uploads/2026/10/02.-Bieu-thang-9.2026.xlsx"},
                {"file": "2.-Bieu-thang-10.2026.xlsx", "url": "https://www.nso.gov.vn/wp-content/uploads/2026/11/2.-Bieu-thang-10.2026.xlsx"}]),
    dict(id="pci", title="Provincial Competitiveness Index (PCI) 2022 (2024 where published)", publisher="VCCI",
         homepage="https://pcivietnam.vn/", license="Free to reuse with attribution",
         description="Survey-based business-climate score per province; 2022 is the last year scored for all 63. PCI 2025 "
         "(34 provinces) publishes sub-indices and rank groups only, no composite score.",
         used_for=["Business climate lens"],
         files=[{"file": "Appendix_1_Table_Indicator_PCI2022_VN_web.xlsx", "url": "https://pcivietnam.vn/data_pci_file/general_file/1681152283-Appendix_1_Table_Indicator_PCI2022_VN_web.xlsx"},
                {"file": "Appendix_1_Table_Indicator_PCI_2024_VN_web.xlsx", "url": "https://pcivietnam.vn/data_pci_file/general_file/1746527576-Appendix_1_Table_Indicator_PCI_2024_VN_web.xlsx"}]),
    dict(id="worldbank_fx", title="Official exchange rate (PA.NUS.FCRF)", publisher="World Bank",
         homepage="https://data.worldbank.org/indicator/PA.NUS.FCRF", license="CC BY 4.0",
         description="VND per USD, period average; every dong figure is converted at the 2024 rate (the 2025 rate is not yet published).",
         used_for=["Money in US dollars"],
         files=[{"file": "wb_fx.json", "url": "https://api.worldbank.org/v2/country/VNM/indicator/PA.NUS.FCRF?format=json&date=2019:2026"}]),
]


# What edition of each source the map shows.
VINTAGE = {
    "hdx_cod_ab_vnm": "COD-AB admin 1, valid from 25 September 2025 (34 provinces)",
    "hdx_cod_ab_vnm_2020": "COD-AB admin 1 of 27 October 2020 (63 provinces)", "natural_earth": "Natural Earth v5.1.2",
    "etopo": "ETOPO1", "worldcover": "ESA WorldCover 2021 v200", "worldpop": "WorldPop 2025 (R2025A)",
    "gppd": "WRI Global Power Plant Database v1.3.0 (2021), capacity fill only", "ourairports": "OurAirports", "geonames": "GeoNames",
    "ibtracs": "IBTrACS v04r01", "wikidata": "Wikidata", "osm_rivers": "OpenStreetMap", "osm_military": "OpenStreetMap",
    "openflights_routes": "OpenFlights routes (June 2014)", "wikipedia_airports": "ACV passengers via Wikipedia",
    "nso_yearbook": "NSO Statistical Yearbook 2025 (2025 preliminary) and 2024",
    "nso_monthly_2026": "NSO monthly reports, September–October 2026 (estimates)", "pci": "PCI 2022 (2024 where published)",
    "worldbank_fx": "World Bank official exchange rate, 2024",
    "osm_power": "OpenStreetMap (27 Nov 2026)", "osm_ports": "OpenStreetMap (27 Nov 2026)",
    "osm_roads": "OpenStreetMap (27 Nov 2026)", "osm_rail": "OpenStreetMap (27 Nov 2026)",
    "osm_parks": "OpenStreetMap (27 Nov 2026)", "qd804": "Decision 804/QĐ-TTg (2022) and 1579/QĐ-TTg (2021)",
    "wikipedia_vi_parks": "Vietnamese Wikipedia, list of national parks (Nov 2026)",
}


def vintage(sid, files):
    return VINTAGE.get(sid)  # download dates are listed per file (files[].retrieved), so this string stays stable


def build():
    out = []
    for s in SOURCES:
        man = manifest(s["id"])
        files = [{"file": k, **v} for k, v in man.items()]
        out.append({k: v for k, v in s.items() if k != "files"} | {"vintage": vintage(s["id"], files), "files": files})
    for s in EXTRA:
        out.append(s | {"vintage": VINTAGE.get(s["id"]), "files": [f | {"retrieved": None, "sha256": None, "bytes": None} for f in s["files"]]})
    write_web("sources.json", out)
