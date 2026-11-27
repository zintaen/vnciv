"""sources.json: the Almanac's bibliography from the source registry and download manifests."""
from __future__ import annotations

from ..fetch import manifest
from ..sources import SOURCES
from ..store import write_web

EXTRA = [
    dict(id="nso_yearbook", title="Statistical Yearbook of Vietnam 2024 and PX-Web database",
         publisher="National Statistics Office of Vietnam (NSO, formerly GSO)", homepage="https://www.nso.gov.vn/",
         license="Official statistics, free to reuse with attribution",
         description="Province population, area, GRDP per person, labour force, employment, unemployment, trained "
         "labour, literacy, income, HDI, Gini, poverty, FDI, paddy rice, retail sales, travel turnover, university "
         "students (2024, preliminary; students 2023), plus PX-Web tables for population 2019–2025, informal employment, "
         "life expectancy, migration and employment by industry. Parsed into data/stats/ by pipeline/nso/.",
         used_for=["Yields", "City and province panels", "Province lenses", "Districts", "Citizens"],
         files=[{"file": "NG-TONG-CUC-2024_OKIN_Final.pdf", "url": "https://www.nso.gov.vn/wp-content/uploads/2026/01/NG-TONG-CUC-2024_OKIN_Final.pdf"},
                {"file": "PX-Web API", "url": "https://pxweb.nso.gov.vn/api/v1/vi/"}]),
    dict(id="pci", title="Provincial Competitiveness Index (PCI) 2022", publisher="VCCI",
         homepage="https://pcivietnam.vn/", license="Free to reuse with attribution",
         description="Survey-based business-climate score per province; 2022 is the last year scored for all 63.",
         used_for=["Business climate lens"],
         files=[{"file": "Appendix_1_Table_Indicator_PCI2022_VN_web.xlsx", "url": "https://pcivietnam.vn/data_pci_file/general_file/1681152283-Appendix_1_Table_Indicator_PCI2022_VN_web.xlsx"}]),
    dict(id="worldbank_fx", title="Official exchange rate (PA.NUS.FCRF)", publisher="World Bank",
         homepage="https://data.worldbank.org/indicator/PA.NUS.FCRF", license="CC BY 4.0",
         description="VND per USD, period average; every dong figure is converted at the 2024 rate.",
         used_for=["Money in US dollars"],
         files=[{"file": "wb_fx.json", "url": "https://api.worldbank.org/v2/country/VNM/indicator/PA.NUS.FCRF?format=json&date=2020:2025"}]),
]


def build():
    out = []
    for s in SOURCES:
        man = manifest(s["id"])
        files = [{"file": k, **v} for k, v in man.items()]
        out.append({k: v for k, v in s.items() if k != "files"} | {"vintage": None, "files": files})
    for s in EXTRA:
        out.append(s | {"vintage": None, "files": [f | {"retrieved": None, "sha256": None, "bytes": None} for f in s["files"]]})
    write_web("sources.json", out)
