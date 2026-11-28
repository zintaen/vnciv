"""Sources of the data-completeness stream: the older NSO Statistical Yearbooks that publish 2019 and 2021 columns.

The 2025 yearbook's Part I prints 2020, 2022-2025 for the 63 former provinces; the 2024 yearbook prints 2020-2024 (so
2021); the 2019-2023 yearbooks print 2019. Each year is taken from the newest yearbook that prints it
(pipeline/nso/backfill.py).
"""

NSO = "https://www.nso.gov.vn/wp-content/uploads/"
LIC = "No licence stated; official statistics, reused with attribution"

SOURCES = [
    dict(id="nso_yearbooks_2019_2024", title="Statistical Yearbooks of Vietnam 2019-2025 (full editions)",
         publisher="National Statistics Office of Vietnam (NSO, formerly GSO)",
         homepage="https://www.nso.gov.vn/nien-giam-thong-ke/", license=LIC,
         description="Full yearbooks 2019 to 2025 (bilingual). Their by-province tables give the years the 2025 yearbook "
         "no longer prints for the 63 former provinces (2019 and 2021; HDI 2019-2023; FDI and income per person "
         "2019-2023, one year per edition). Each year comes from the newest edition that prints it, and an edition is "
         "used only if it agrees with the 2025 yearbook on the years both print. Parsed by pipeline/nso/backfill.py "
         "into data/stats/series/; each row cites its edition and page.",
         used_for=["Timeline year series 2019-2025"],
         files=[(NSO + "2020/09/Nien-giam-thong-ke-day-du-2019.pdf", "NGTK2019.pdf"),
                (NSO + "2021/07/Sach-NGTK-2020Ban-quyen.pdf", "NGTK2020.pdf"),
                (NSO + "2022/08/Sach-Nien-giam-TK-2021-1.pdf", "NGTK2021.pdf"),
                (NSO + "2023/06/Sach-Nien-giam-TK-2022-final.pdf", "NGTK2022.pdf"),
                (NSO + "2024/06/NIEN-GIAM-THONG-KE-2023_Ban-quyen-1.pdf", "NGTK2023.pdf"),
                (NSO + "2026/01/NG-TONG-CUC-2024_OKIN_Final.pdf", "NGTK2024.pdf"),
                (NSO + "2026/07/NG-TOAN-QUOC-2025-1.pdf", "NGTK2025.pdf")]),
]
