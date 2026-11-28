"""Sources of the series2010 stream: the NSO Statistical Yearbooks 2010-2018, whose by-province tables print the
years 2010-2018 (pipeline/nso/backfill.py takes each year from the newest edition that prints it)."""

NSO = "https://www.nso.gov.vn/wp-content/uploads/2019/10/"
LIC = "No licence stated; official statistics, reused with attribution"
YB_OLD = {2010: "NGTK-2010-pdf.pdf", 2011: "Ni%C3%AAn-gi%C3%A1m-2011-pdf-1.pdf", 2012: "Nien-giam-2012-pdf-1.pdf",
          2013: "NGTK-2013.pdf", 2014: "Nien-giam-2014-pdf.pdf", 2015: "Nien-giam-Thong-ke-2015-1.pdf",
          2016: "Nien-giam-Thong-ke-2016.pdf", 2017: "Nien-giam-2017-pdf.pdf", 2018: "Nien-giam-2018.pdf"}

SOURCES = [
    dict(id="nso_yearbooks_2010_2018", title="Statistical Yearbooks of Vietnam 2010-2018 (full editions)",
         publisher="National Statistics Office of Vietnam (NSO, formerly GSO)",
         homepage="https://www.nso.gov.vn/nien-giam-thong-ke/", license=LIC,
         description="Full yearbooks 2010 to 2018 (bilingual). Their by-province tables give the years 2010-2018 for "
         "the 63 provinces. Each year comes from the newest edition that prints it, and an edition is used only if it "
         "agrees with the newer editions on the years both print. Parsed by pipeline/nso/backfill.py into "
         "data/stats/series/; each row cites its edition and page.",
         used_for=["Timeline year series 2010-2018"],
         files=[(NSO + f, f"NGTK{y}.pdf") for y, f in YB_OLD.items()]),
]
