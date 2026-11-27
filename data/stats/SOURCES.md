# Sources (all values parsed from downloaded files; nothing typed by hand)

All CSVs have the columns `province_name_vi,value,year,unit,source_url,province_std`.
`province_std` is a canonical spelling of the province name (see `pipeline/nso/names.py`) so the files can be joined
(sources write "Huế" / "Thừa Thiên Huế" / "TT-Huế", "Hoà"/"Hòa", "BRVT", "TP.HCM" and so on). `population_series.csv` also has a `series` column (total or urban).
Unit: the 63 provinces as they stood before the July 2025 merger. Regional and national rows are dropped.

## 1. NSO (formerly GSO) Statistical Yearbook 2024, the main source
- URL: https://www.nso.gov.vn/wp-content/uploads/2026/01/NG-TONG-CUC-2024_OKIN_Final.pdf
  (landing page https://www.nso.gov.vn/default/2026/01/nien-giam-thong-ke-2024-2/). Bilingual VI/EN, 1268 pages, published Jan 2026.
- Vintage: 2024 values are preliminary ("Sơ bộ"). Education is 2023, area is as of 31/12/2023, FDI covers licences issued in 2024.
- Licence: none stated (Vietnamese government publication).
- How it was parsed: text extracted with pypdf, then `pipeline/nso/yb.py`. A blank cell is detected from pypdf's trailing whitespace. Check: summed over provinces, population, urban population, employed, labour force, paddy, retail, tourism, students and FDI capital each match the national row (area is 12 km² short of the national 331,338.3 km²).
- Files and their tables: area_km2 (T19), population_2024 (T21), urban_population (T24), literacy_rate_15plus (T45),
  labour_force (T55), employed_workers (T62), trained_labour_share (T70), labour_productivity (T73), unemployment_rate (T77),
  grdp_per_capita (T95), fdi_projects_2024 and fdi_registered_capital_2024 (T138), paddy_production (p.602), retail_sales (T272),
  tourism_travel_turnover (T294, travel-agency turnover only), university_lecturers (T380), university_students (T381),
  income_per_capita_monthly (T403, total column), income_per_employee_monthly (T411), hdi (T412), gini (T414),
  poverty_rate_multidimensional (T422, multidimensional poverty standard for 2022-2025).
  The table number and page are in each row's source_url.

## 2. NSO PX-Web API (machine-readable; it also has 2025 preliminary figures)
- API root: https://pxweb.nso.gov.vn/api/v1/vi/ . A GET on a table returns its metadata; a POST returns the data as JSON (`pipeline/nso/pxget.py`).
  The local DNS often fails for this host, so the script pins 210.245.31.110.
- population_series.csv comes from `Dân số và lao động/V02.03-07.px`: average population, total and urban, 2019-2024 plus "Sơ bộ 2025".
- Kept as raw JSON in data/stats/px/ and read directly by the pipeline (no CSV): V02.21-23 (migration), V02.25 (life
  expectancy) and V02.51 (informal employment) by `pipeline/build/stats.py`, including NSO's national rows; V02.42
  (employed by industry, national) by `pipeline/build/cities.py`. Also downloaded but unused: V02.01, V02.20, V02.27,
  V02.37, V02.45, V02.55, V02.58, V02.63, V07.02.
- national.csv: NSO's own national HDI, Gini and multidimensional poverty rate for 2024, quoted from the yearbook's
  overview chapter (used for the nation instead of averaging provinces).
- Not on this server: national accounts (GRDP), living standards, investment. The "Đầu tư" and "Giáo dục" databases return 404.

## 3. VCCI Provincial Competitiveness Index (PCI)
- 2024: https://pcivietnam.vn/data_pci_file/general_file/1746527576-Appendix_1_Table_Indicator_PCI_2024_VN_web.xlsx (sheet "Tổng hợp").
  Since 2023 VCCI publishes the composite score only for the top 30 provinces; https://pcivietnam.vn/bang-xep-hang shows N/A for the rest.
  pci_score_2024.csv therefore has 30 rows.
- 2022, the last year with all 63 provinces: https://pcivietnam.vn/data_pci_file/general_file/1681152283-Appendix_1_Table_Indicator_PCI2022_VN_web.xlsx.
  The source repeats the Đồng Tháp row; the duplicate was dropped.
- The 2023 file has sub-indices only and no composite score. The 2025 file uses the new 34 provinces.
- Licence: VCCI asks users to cite it as the source (https://pcivietnam.vn/gioi-thieu/chinh-sach-trich-dan-du-lieu.html).

## 4. Derived files (`pipeline/nso/derive.py`, computed from the official files above)
- urbanisation_rate = urban_population / population_2024 × 100
- grdp_total_derived = grdp_per_capita × population_2024. The yearbook publishes GRDP per capita only, not total GRDP, by province.
  Error is about 0.1% because per capita is rounded to 0.1 million VND. The sum is 11,394,555 billion VND.
- population_growth_2019_2024 = % change in average population, 2019 to 2024 (PX V02.03-07)

## Tried and not used
- gso.gov.vn and pxweb.gso.gov.vn time out. nso.gov.vn and pxweb.nso.gov.vn work.
- Wikipedia vi "Danh sách đơn vị hành chính Việt Nam theo GRDP" (revision 75583915): 63-province GRDP for 2022 only,
  taken from a mix of provincial news reports. Not used. The en "List of Vietnamese subdivisions by GDP" page now shows the 34-province 2025 data.
- Employment split by sector for each province: not in the yearbook (sector splits are national only) and not in the LFS 2024 report
  (https://www.nso.gov.vn/wp-content/uploads/2026/05/02-Sach-Bao-cao-lao-dong-viec-lam-tieng-Viet.pdf, which splits by region only).
