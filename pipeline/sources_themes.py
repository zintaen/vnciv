"""Sources of the themes stream (extra lenses: ageing, disaster deaths, PM2.5)."""

MIDCENSUS_URL = "https://www.nso.gov.vn/wp-content/uploads/2024/12/Dieu-tra-Dan-so-giua-ky-2024-31.12-2.pdf"
DESINVENTAR_URL = "https://www.desinventar.net/DesInventar/download/DI_export_vnm.zip"
SATPM_URL = ("https://satpmdata.s3.amazonaws.com/V6GL03/CNNPM25/Annual/AS/V6GL03.CNNPM25.AS.202401-202412.nc")

SOURCES = [
    dict(id="nso_midcensus2024", title="Key results of the 2024 Intercensal Population and Housing Survey (1 April 2024)",
         publisher="National Statistics Office of Vietnam (NSO, formerly GSO)",
         homepage="https://www.nso.gov.vn/du-lieu-va-so-lieu-thong-ke/2025/01/thong-cao-bao-chi-ket-qua-dieu-tra-dan-so-va-nha-o-giua-ky-nam-2024/",
         license="No licence stated; official statistics, reused with attribution",
         description="Kết quả chủ yếu Điều tra dân số và nhà ở giữa kỳ thời điểm 0 giờ 01/4/2024 (a sample survey), "
         "Table 5 (printed p.121-122): sex ratio, dependency ratio, age structure and ageing index (people aged 60 "
         "and over per 100 under 15) for the nation, the 6 regions and the 63 provinces of the time.",
         used_for=["Ageing index lens"],
         files=[(MIDCENSUS_URL, "Dieu-tra-Dan-so-giua-ky-2024-31.12-2.pdf")]),
    dict(id="desinventar_vnm", title="DesInventar disaster loss database of Viet Nam",
         publisher="UNDRR DesInventar; records of Viet Nam's Central Committee for Flood and Storm Control (CCFSC)",
         homepage="https://www.desinventar.net/",
         license="No licence stated; shared publicly by the contributing government, reused with attribution",
         description="One record per event and province, 1989-2010 (plus one record of 2019): event type, date, "
         "deaths, missing, injured, houses destroyed. The 63 former provinces (Hà Tây, merged into Hà Nội in 2008, "
         "is added to Hà Nội).",
         used_for=["Storm and flood deaths lens"],
         files=[(DESINVENTAR_URL, "DI_export_vnm.zip")]),
    dict(id="satpm_v6gl03", title="SatPM2.5 V6.GL.03 annual surface PM2.5, Asia, 0.01°",
         publisher="Atmospheric Composition Analysis Group, Washington University in St. Louis (van Donkelaar, Martin et al.)",
         homepage="https://www.satpm.org/v6-gl-03", license="CC BY 4.0",
         description="Annual mean ground-level fine particulate matter (PM2.5, µg/m³) for 2024 at 0.01° (~1.1 km), "
         "estimated from satellite aerosol optical depth, the GEOS-Chem model and ground monitors (Shen et al. 2024, "
         "ACS ES&T Air, doi:10.1021/acsestair.3c00054). Averaged per hex.",
         used_for=["Air quality (PM2.5) lens"],
         files=[(SATPM_URL, "V6GL03.CNNPM25.AS.202401-202412.nc")]),
]
