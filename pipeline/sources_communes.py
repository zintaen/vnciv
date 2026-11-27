"""Sources for the communes stream: the 3,321 communes and wards of the two-tier local government (from 1 July 2025)."""

VPD = "https://raw.githubusercontent.com/ThangLeQuoc/vietnamese-provinces-database/v5.2.0/json/"

SOURCES = [
    dict(id="vn_wards_gis", title="Vietnamese Provinces Database v5.2.0: wards GIS (GeoJSON)",
         publisher="Thang Le Quoc (GitHub), from the Vietnam Administrative Units Reference Map (sapnhap.bando.com.vn, "
                   "Vietnam Natural Resources, Environment and Cartography Publishing House) and the NSO/GSO unit codes",
         homepage="https://github.com/ThangLeQuoc/vietnamese-provinces-database", license="MIT",
         description="Boundaries, names, kinds and official codes of the 34 provinces and 3,321 communes, wards and "
                     "special zones of the two-tier local government that took effect on 1 July 2025, as updated to "
                     "Resolution 388/NQ-UBTVQH16 (September 2026: twelve Bắc Ninh communes became wards; the count of "
                     "units is unchanged). Geometry derived from the official reference map at sapnhap.bando.com.vn.",
         used_for=["Communes & wards layer", "Search"],
         files=[(VPD + "vn_provinces_wards_geojson.zip", "vn_provinces_wards_geojson.zip"),
                (VPD + "full_json_generated_data_vn_units.json", "full_json_generated_data_vn_units.json")]),
    dict(id="hdx_cod_ab_vnm", title="Viet Nam - Subnational Administrative Boundaries (COD-AB, v02)",
         publisher="OCHA / Humanitarian Data Exchange", homepage="https://data.humdata.org/dataset/cod-ab-vnm",
         license="CC BY-IGO",
         description="The 34 provinces of 2025 (admin level 1, valid from 2025-09-25), sourced from the Government "
                     "of Viet Nam: the map's province outlines, coast and land/water mask. It has no commune level.",
         used_for=["Land vs. water", "Province borders", "Province outline check"],
         files=[("https://data.humdata.org/dataset/3cb544a9-9d04-4f54-94e2-93230efd8ceb/resource/"
                 "cb274bdf-f332-48bd-bfcc-d6fe3a5e4334/download/vnm_admin_boundaries.shp.zip", "vnm_admin_boundaries.shp.zip")]),
    dict(id="vtc_communes_2025", title="Ủy ban Thường vụ Quốc hội quyết định cả nước còn 3.321 xã, phường, đặc khu",
         publisher="VTC News (16 June 2025), summarising the 34 resolutions of the National Assembly Standing Committee",
         homepage="https://vtcnews.vn/uy-ban-thuong-vu-quoc-hoi-quyet-dinh-ca-nuoc-con-3-321-xa-phuong-dac-khu-ar949200.html",
         license="© VTC News; only the published counts (facts) are used",
         description="The official number of communes, wards and special zones of each of the 34 provinces as decided "
                     "in June 2025 (3,321 = 2,621 communes + 687 wards + 13 special zones); used to check the boundary file.",
         used_for=["Commune count check"],
         files=[("https://vtcnews.vn/uy-ban-thuong-vu-quoc-hoi-quyet-dinh-ca-nuoc-con-3-321-xa-phuong-dac-khu-ar949200.html",
                 "vtc_3321.html")]),
]
