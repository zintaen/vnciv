"""Sources for the boundaries stream: the outlines behind the map's provinces (34 of 2025) and former provinces (63)."""

HDX_2020 = ("http://web.archive.org/web/20220826100109id_/https://data.humdata.org/dataset/"
            "3cb544a9-9d04-4f54-94e2-93230efd8ceb/resource/d2265e4f-7814-493e-9d60-60a4d05ecfad/download/"
            "vnm_adm_gov_20201027_shp.zip")

SOURCES = [
    dict(id="hdx_cod_ab_vnm_2020", title="Viet Nam - Subnational Administrative Boundaries (COD-AB, 2020-10-27 release)",
         publisher="OCHA / Humanitarian Data Exchange; sourced from the Government of Viet Nam, vetted by ITOS (USAID). "
                   "Copy retrieved from the Internet Archive (snapshot of 26 August 2022), as HDX no longer serves it",
         homepage="https://data.humdata.org/dataset/cod-ab-vnm", license="CC BY-IGO",
         description="The 63 provinces and centrally-run cities before 1 July 2025 (admin level 1, "
                     "vnm_admbnda_adm1_gov_20201027). Used for the inner borders between former provinces inside "
                     "each 2025 province; the outer outlines come from the 2025 release.",
         used_for=["Former-province lookup"],
         files=[(HDX_2020, "vnm_adm_gov_20201027_shp.zip")]),
]
