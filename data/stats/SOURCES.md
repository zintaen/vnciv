# Sources (all values parsed from downloaded files; nothing typed by hand)

All latest-year CSVs have the columns `province_name_vi,value,year,unit,source_url,province_std`.
`province_std` is a canonical spelling of the province name (see `pipeline/nso/names.py`) so the files can be joined
(sources write "Huế" / "Thừa Thiên Huế" / "TT-Huế", "Hoà"/"Hòa", "BRVT", "TP.HCM" and so on). The `year` column says
what is preliminary ("2025 (prel.)", "Sơ bộ") or estimated ("2025 (est.)", "Ước tính"); the table and page are in
each row's `source_url`. Regional and national rows are dropped (NSO's national figures are in `national.csv`).

| Folder | Edition | Unit |
|---|---|---|
| `2025/` | Statistical Yearbook 2025, Part I | the 63 former provinces (before 1 July 2025) |
| `p34/` | Statistical Yearbook 2025, appendix (p.1141–1556) | the 34 provinces of 2025 |
| `p34_2026/` | NSO monthly socio-economic reports, September and October 2026 | the 34 provinces |
| `2024/` | Statistical Yearbook 2024 | the 63 former provinces |
| `series/` | every year column of the tables above, long format | 63 and 34 |
| root | PX-Web population series, PCI, national figures, World Bank exchange rate, `series_national.csv`, `completeness.csv` | |

## 1. NSO Statistical Yearbook 2025 (the main source)
- URL: https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf (bilingual VI/EN, published July 2026).
- Vintage: 2025 values are preliminary ("Sơ bộ"); GRDP per person and GRDP growth for 2025 are estimates ("Ước tính").
  Some tables stop earlier: enterprises, enterprise employment/turnover/profit/wages, cooperatives, household
  businesses and housing floor area built are 2024 (31/12/2024); electricity and permanent housing are 2024
  (the last housing survey round); income per person and the top/bottom quintile ratio are 2025 (single-year tables).
- Part I (63 former provinces) → `2025/` (70 files): population_2025 (p.105), population_density, urban_population (p.111),
  sex_ratio, crude birth/death rates, total_fertility_rate, infant_mortality, population_growth_rate, in/out/net
  migration (p.136–141), life_expectancy (p.143), mean_age_first_marriage, labour_force (p.153), employed_workers (p.163),
  informal_employment_rate (p.169), trained_labour_share (p.173), labour_productivity (p.179), unemployment_rate (p.184),
  underemployment_rate, grdp_growth (p.242, index previous year = 100), grdp_per_capita (p.245), industrial_production_index,
  enterprise and household-business tables (2024), farms, cereal/paddy/maize/sugarcane, livestock, wood, fishery
  (p.650), retail_sales (p.687), tourism_travel_turnover (p.715; Bắc Kạn's 2025 cell is blank), passengers, freight,
  income_per_capita_monthly (p.908, total column), income_quintile_ratio, income_per_employee_monthly (p.923), gini (p.926),
  poverty_rate_multidimensional (p.935), hygienic_water_share (p.941), hygienic_latrine_share, electricity_households (2024),
  computer_households (p.951), mobile_phone_users, internet_users (p.959), internet_households, it_skills_share (p.966),
  social_network_users, permanent_housing_share (p.973, 2024).
  `active_enterprises`, `enterprises_per_1000` and `new_enterprises` in `2025/` are 2024 values for the 63 former
  provinces from PX-Web (`Doanh nghiệp/V05.04.px`, `V05.05.px`, `V05.02.px`; JSON in `px/`), read by `pipeline/nso/px2csv.py`.
- Appendix (34 provinces) → `p34/` (115 files): the same indicators by the 34 provinces, plus indicators NSO now
  publishes **only** at that level: hdi (A164, p.1484), fdi_projects_2025 / fdi_registered_capital_2025 (A49, p.1244;
  Lai Châu, Lạng Sơn and Cao Bằng have no row = none licensed), fdi_accumulated_*, active_enterprises /
  enterprises_per_1000 (A53/A54, 31/12/2025), new_enterprises 2025, schools/teachers/pupils, pupils_per_teacher (A147,
  30/9/2025), permanent_classrooms_share, doctors_public (A149, State sector), vaccination, child malnutrition (33/34),
  HIV, heritage sites, social/health/unemployment insurance coverage, forest_area / forest_cover (A110, 31/12/2025),
  markets/supermarkets/shopping centres, cost_of_living_index, traffic accidents and deaths (A203),
  road_accidents_per_100k / road_deaths_per_100k (A205, columns 1 and 2), criminal cases, industrial parks, land use.
- **Known NSO error, fixed here:** in the appendix rice and cereal tables A75 (cereal production), A76 (cereal per
  person), A77 (paddy area), A78 (paddy yield) and A79 (paddy production) the Gia Lai and Khánh Hòa rows are swapped
  (Gia Lai = Bình Định + Gia Lai produces about 1.07 million t of paddy, the appendix gives it 0.53). These five
  `p34/` files are therefore **not** the appendix values: `pipeline/nso/derive2025.py` rebuilds them by summing the
  63 former provinces of Part I with `pipeline/admin.py` NEW (yield = production ÷ area; per person = cereal ÷
  population 2025), and each row's unit says so. Maize (A91) and the other crop tables agree with Part I.
  The pipeline sums provinces from the 63 former provinces anyway, so the map was never affected.
- How it was parsed: `pipeline/nso/ext.py` (pypdf text) → `dump.py BOOK.txt 1141 BOOK.json` (every by-province table;
  1141 = first appendix page) → `emit.py BOOK.json OUTDIR "<URL> (Part I, 63 provinces)" spec63` and the same with
  `"(Appendix, 34 provinces)" spec34` → `derive2025.py data/stats` → `series.py BOOK.json BOOK.txt data/stats`.
  `cross.py data/stats` compares the 63-province files summed to 34 provinces with the appendix.
  Checks: summed over provinces, population, urban population, labour force, employed, paddy, retail, tourism, FDI
  and the other summable tables match the national row (within 0.1%); the 11 unmerged provinces match between
  Part I and the appendix exactly, or within one rounding unit (electricity, GRDP growth, income), except the
  enterprise files, which are 2024 (PX-Web) at 63 provinces and 2025 at 34.
- `2025/grdp_total_derived.csv` = grdp_per_capita (2025 est.) × population_2025: NSO publishes GRDP per person only.
  The sum is 12,780,342 billion VND (NSO's national per-person figure × population gives 12,844,000; per-person
  values are rounded to 0.1 million VND).

## 2. NSO monthly socio-economic reports 2026 → `p34_2026/`
- https://www.nso.gov.vn/wp-content/uploads/2026/10/02.-Bieu-thang-9.2026.xlsx (sheet "3.TDT GRDP"):
  grdp_growth_9M2026 (estimate, January–September 2026 vs the same period of 2025 = 100, constant 2020 prices),
  grdp_growth_Q3_2026 (estimate), grdp_growth_6M2026 (preliminary); all 34/34.
- https://www.nso.gov.vn/wp-content/uploads/2026/11/2.-Bieu-thang-10.2026.xlsx: industrial_employment_index_Oct2026
  (sheet "5. LĐCN_DP", 1/10/2026 vs 1/10/2025 = 100, 34/34); FDI registered and projects 10M2026 and State-budget
  investment 10M2026 list only the top 20–21 provinces (`*_top.csv`, not used on the map).
- Parsed by `pipeline/nso/se2026.py DIR data/stats/p34_2026`.

## 3. NSO Statistical Yearbook 2024 → `2024/`
- URL: https://www.nso.gov.vn/wp-content/uploads/2026/01/NG-TONG-CUC-2024_OKIN_Final.pdf (published Jan 2026), parsed
  by `pipeline/nso/yb.py` (and `derive.py` for the derived files). Kept for what the 2025 yearbook no longer publishes
  for the 63 former provinces: area_km2 (T19, 31/12/2023), literacy_rate_15plus (T45, 2024), hdi (T412, 2024),
  fdi_projects_2024 / fdi_registered_capital_2024 (T138), university_students / university_lecturers (T380–381, 2023;
  the 2025 yearbook has no university tables by province). The other 2024 files are superseded by `2025/` and kept as
  history (income per person 2024 feeds `series/`).

## 4. Year series → `series/<indicator>.csv`
- Columns `province_std, level (63|34), year, value, unit, source_url, status (final|prel|est)`, written by
  `pipeline/nso/series.py` from every year column of the 2025 yearbook tables: Part I usually 2020, 2022, 2023, 2024,
  2025; the appendix 2020–2025; VHLSS-based tables (electricity) 2016–2024 every two years; internet/phone/IT-skill
  tables 2024–2025; enterprise tables 2020–2024. Single-year files added: income per person (63: 2024 from the 2024
  yearbook, 2025; 34: 2025), HDI (63: 2024), FDI capital and projects (63: 2024; 34: 2025), quintile ratio (2025).
- `status` is read from each table's column header ("Sơ bộ" → prel, "Ước tính" → est); for the single-year files it
  comes from the file's year column. Income per person (2024 and 2025) and the quintile ratio are preliminary: their
  tables' footnote reads "(*) Số sơ bộ - Preliminary data".
- Missing years are absent (no row; never filled). Short table rows whose blank cell cannot be placed are skipped
  (sugarcane 4, tourism 2, shrimp 4, shopping centres 1). Raw NSO units as in the latest-year files; money is in VND
  (convert each year at that year's World Bank rate, `wb_fx.json`).
- The 34-province cereal, paddy area and paddy production series are sums of the 63 former provinces (years where all
  63 are published: 2020, 2022–2025); the appendix's swapped rows (and its 2021 column) are not used.

## 4b. Back-filled years (2010-2019, 2021 and the rest NSO publishes) → `series/`, `series_national.csv`, `completeness.csv`
Run `pipeline/nso/backfill.py data/stats data/interim/nso_dc` **after** `series.py` (it is idempotent: it drops the
rows it wrote before and rebuilds them). Sources, all downloaded on 28 Nov 2026:
- PX-Web (63 former provinces, every by-province table of the databases "Dân số và lao động", "Doanh nghiệp",
  "Công nghiệp"; JSON in `px/`, fetched with `pxget.py`): population and urban population (V02.03-07), crude birth/death
  rates (V02.12-14), total fertility (V02.16), infant mortality (V02.18), population growth (V02.20), migration
  (V02.21-23), life expectancy (V02.25), literacy (V02.27, new series `literacy_rate_15plus` 2010-2024), age at first
  marriage (V02.30), divorces (V02.31, 2024 only), labour force (V02.37), employed (V02.45), informal (V02.51), trained
  (V02.55), productivity (V02.58), unemployment (V02.63), underemployment (V02.70), industrial production index (V07.02),
  enterprises (V05.02, V05.04, V05.05 2021-2024, V05.08, V05.11, V05.23, V05.35, V05.38), cooperatives (V05.51),
  household businesses and their workers (V05.54, V05.56). The "Đầu tư", "Giáo dục" and English databases answer 404.
- Statistical Yearbooks 2019-2024 (registered as `nso_yearbooks_2019_2024` in `pipeline/sources_data_completeness.py`,
  in `data/raw/`; text by `ext.py` into `data/interim/nso_dc/`): 2019 and 2021 columns of the agriculture, GRDP,
  trade, transport, living-standard and household tables; HDI 2019-2023 (63); FDI projects and capital and income per
  person 2019-2023 (each edition's own year; the 2022 edition's page 583 cannot be read by pypdf and is skipped).
- Statistical Yearbooks 2010-2018 (registered as `nso_yearbooks_2010_2018` in `pipeline/sources_series2010.py`, in
  `data/raw/nso_yearbooks_2010_2018/`, downloaded 28 Nov 2026 from https://www.nso.gov.vn/wp-content/uploads/2019/10/):
  text by `ext.py`, then `tcvn3.py` (the 2010-2016 editions set Vietnamese in TCVN3 fonts, which pypdf reads as Latin-1
  look-alikes: "§µ N½ng" = "Đà Nẵng"; a line is decoded when it has TCVN3-only characters and no Unicode Vietnamese
  letters) into `data/interim/nso_dc/NGTK<edition>.txt`. Their by-province tables give 2010-2018: the same matching and
  95% agreement rules, so an edition is used only when it agrees with the newer ones on the years both print (each
  edition prints the base year 2010 and its last four years). Single-year tables: FDI 2010-2015 (a table title that
  wraps after its year is read; the "Oil and gas" row counts in the national total, not as a province), income per
  person 2010, 2012, 2014, 2016 (VHLSS, every two years until 2018; each from the next year's edition). The 2016
  edition's FDI pages give no text (font), so FDI 2016 is missing.
- PX-Web years 2010-2018 of the tables above (population, births, deaths, fertility, infant mortality, growth,
  migration, literacy, age at first marriage, labour force, trained share 2010 on; industrial production index 2012 on;
  enterprises 2010 and 2015 on). PX-Web's population 2010-2018 is NSO's series revised to the 2019 census: it differs
  from the 2010-2018 yearbooks' estimates (Hà Nội 2018: 7,914.5 against 7,520.7 thousand), so the yearbook population
  tables are not combined with it.
- Not combined (older editions disagree with the newer ones on the years both print): livestock, fishery and wood
  before 2018 except 2015 (NSO revised the series in the 2021 yearbook; e.g. cattle 2015 agrees in 20 of 63 provinces).
  Not published by province before 2018 in any 2010-2021 edition: GRDP, Gini, HDI, clean water, latrines, income per
  worker, labour productivity, unemployment, life expectancy (PX-Web from 2018). Every remaining gap and its reason is
  in `completeness.csv` (KNOWN_GAPS in `tests/test_data_completeness.py`).
- Poverty: the yearbook tables print income poverty (households below the Government's 2011-2015 line, CPI-updated;
  2018 yearbook p.853 footnote) up to 2015 and multidimensional poverty from 2016 (2016-2020 standard; the 2022-2025
  standard from 2022, 2025 yearbook p.934 footnote), sometimes in one table. `backfill.py` (SPLIT) writes the years
  before 2016 to their own series `poverty_rate_income` (2010-2015, no lens); `poverty_rate_multidimensional` (the
  poverty lens) starts in 2016. Both carry their definition as the timeline note.
- 2025 yearbook appendix tables that `spec34.py` does not list: enterprises with business outcomes (A p.1258, 34
  provinces 2020-2024) and the index of industrial production 2025 (A p.1240).
- Rules: only years 2010-2026 the series lacks are added, existing rows are never replaced. A source is used for an
  indicator only if, on every year it shares with the series (final values only), at least 95% of the provinces agree
  within one rounding unit; a table is matched by that agreement (its English title only breaks ties: titles change,
  e.g. "acting" → "active enterprises"). Without a 63-province series the 11 unmerged provinces are compared with the
  34-province series. The newest edition that prints a year wins. FDI tables must add up to their national row.
  The 34-province cereal/paddy rows for 2019 and 2021 are sums of the 63 (as in §4).
- Not used, with the reason: PX V02.09 sex ratio (disagrees with the 2025 yearbook for 8 provinces in 2023; the
  2019/2021 values come from the 2023 yearbook instead); V05.05 2017-2020 (Bắc Ninh and Quảng Ninh differ from
  V05.04 ÷ V02.03); V02.31 2019-2023 (about 26-32 thousand divorces a year nationally against 182 thousand in 2024:
  a change of scope); farms 2019 (the 2019-2023 yearbooks' footnote: up to 2019 the farm criteria of Circular
  27/2011/TT-BNNPTNT, from 2020 Circular 02/2020/TT-BNNPTNT; 31,908 farms nationally in 2019 against 23,680 in 2020).
- Breaks noted in timeline.json (`series[id].note`): labour figures from 2021 follow ICLS19 (2025 yearbook p.151
  footnote); HDI from 2020 uses 2017 PPPs (p.1485 footnote); population is adjusted to the 2019 census.
- USD: `wb_fx.json` (World Bank PA.NUS.FCRF, `date=2010:2026`, fetched 28 Nov 2026) has 2010-2024; each year's money values use that
  year's rate (2025 uses 2024's, recorded in timeline.json `fx_used`).
- `series_national.csv`: NSO's national row ("CẢ NƯỚC") of each series' cited table, per year (2025 yearbook first,
  then PX-Web, then the older editions, then `national.csv`); nation.json `series`.
- `completeness.csv`: indicator × level × year 2010-2026, provinces present, and the reason for every gap
  (`python3 tests/test_data_completeness.py`; the test fails on an unexplained gap).

## 5. NSO PX-Web API
- API root: https://pxweb.nso.gov.vn/api/v1/vi/ . A GET on a table returns its metadata; a POST returns the data as JSON
  (`pipeline/nso/pxget.py`; the local DNS often fails for this host, so the script pins 210.245.31.110).
- population_series.csv: `Dân số và lao động/V02.03-07.px`, average population, total and urban, 2019–2024 plus
  "Sơ bộ 2025" (agrees with the 2025 yearbook within 0.05 thousand). Growth 2019→2025 uses its 2019 value and the
  yearbook's 2025 value.
- px/: V02.42 (employed by industry, national, 2025 preliminary) read by `pipeline/build/cities.py`; V05.02/V05.04/V05.05
  (enterprises 2024, see §1). V02.21-23, V02.25, V02.51 (2024 migration, life expectancy, informal employment) are
  superseded by the 2025 yearbook. Also downloaded but unused: V02.01, V02.20, V02.27, V02.37, V02.45, V02.55, V02.58,
  V02.63, V07.02.

## 6. national.csv
NSO's own national figures (the "CẢ NƯỚC" rows of the 2025 yearbook tables; table and page in `source_url`): HDI
0.765, Gini 0.323, multidimensional poverty 1.3%, income 6,005 thousand VND per person per month, income per worker,
life expectancy, informal, trained and unemployment rates, GRDP growth, FDI 2025, enterprises per 1,000, internet
users, IT skills, clean water, permanent housing (2024), State-sector doctors, forest cover, road deaths per 100,000,
pupils per teacher; gdp, NSO's national GDP 2025 at current prices (12,847,571 billion VND, estimate, table 76 p.229 — nation.json `gdp`; the provinces' GRDP sum is kept as `gdp_provinces`); plus hdi_2024 (0.752, yearbook 2024 overview) for comparing with the former provinces' 2024 HDI.

## 7. VCCI Provincial Competitiveness Index (PCI)
- 2022, the last year with a composite score for all 63 provinces:
  https://pcivietnam.vn/data_pci_file/general_file/1681152283-Appendix_1_Table_Indicator_PCI2022_VN_web.xlsx (Đồng Tháp row duplicated in the source; dropped).
- 2024: https://pcivietnam.vn/data_pci_file/general_file/1746527576-Appendix_1_Table_Indicator_PCI_2024_VN_web.xlsx
  (composite score for the top 30 only).
- 2025 (34 provinces): https://pcivietnam.vn/data_pci_file/general_file/1778745497-06.%20Du%20lieu%20PCI%202025.xlsx has the nine
  sub-indices and a rank group (Tốt, Khá, Trung bình…) but no composite score. `p34/pci_2025.csv` is the composite
  computed by the atlas (`python -m pipeline.nso.pci2025`): 10 × Σ weight × sub-index, weights 0.05 / 0.10 / 0.15 from
  the PCI 2025 report (https://pcivietnam.vn/data_pci_file/general_file/1779092272-05.%20Bao%20cao%20PCI%202025.pdf,
  Hình A1.1 p.138, Bảng 4.2 p.105). It reproduces all 34 published rank groups by the cut-offs of Bảng 4.3 p.107
  (mean 63.76, SD 3.52). VCCI chose not to publish this score; the lens says it is computed.
  `pci_series.csv` holds 2022 and 2024 (63) and 2025 (34) for the timeline.
- Licence: VCCI asks users to cite it as the source (https://pcivietnam.vn/gioi-thieu/chinh-sach-trich-dan-du-lieu.html).

## 8. World Bank official exchange rate → `wb_fx.json`
https://api.worldbank.org/v2/country/VNM/indicator/PA.NUS.FCRF?format=json&date=2019:2026 (fetched 28 Nov 2026,
last updated 11 Nov 2026): 2020–2024 published, **2025 not yet published (null)**, so 2025 VND figures are converted
at the 2024 rate (24,164.89 VND per USD); nation.json's `currency.note` says so.

## Tried and not used
- gso.gov.vn and pxweb.gso.gov.vn time out. nso.gov.vn and pxweb.nso.gov.vn work.
- Wikipedia vi "Danh sách đơn vị hành chính Việt Nam theo GRDP": 63-province GRDP for 2022 only, from provincial news. Not used.
- Employment by sector for each province: not in the yearbooks (national only) nor in the LFS reports (regions only).
