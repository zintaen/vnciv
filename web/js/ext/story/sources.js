// Facts the story chapters quote that are not in web/data, each copied from a page fetched on 2026-11-28 (the raw
// downloads are in the phase-D scratchpad, story/dl/). Values are exactly as published; nothing is interpolated.
// World Bank WDI (CC BY 4.0), API https://api.worldbank.org/v2/country/VNM/indicator/<id>?format=json, last updated
// 2026-11-11. Wikipedia (CC BY-SA 4.0) sentences are paraphrased in the captions; the URL is the article.

const WB = (id) => `https://data.worldbank.org/indicator/${id}?locations=VN`;

export const WORLD_BANK = {
  title: "World Bank, World Development Indicators",
  license: "CC BY 4.0",
  updated: "2026-11-11",
  // GDP per capita, constant 2015 US$ (real growth, free of the late-1980s exchange-rate swings of the current-$ series)
  gdp_pc_const: { id: "NY.GDP.PCAP.KD", url: WB("NY.GDP.PCAP.KD"), unit: "constant 2015 US$", values: { 1986: 608, 2025: 4308 } },
  // Urban population, % of total
  urban: { id: "SP.URB.TOTL.IN.ZS", url: WB("SP.URB.TOTL.IN.ZS"), unit: "%", values: { 1986: 19.06, 2025: 38.83 } },
  // Poverty headcount at $3.00 a day (2021 PPP), % of population: first and latest survey years
  poverty_300: { id: "SI.POV.DDAY", url: WB("SI.POV.DDAY"), unit: "%", values: { 1992: 57.5, 2022: 1.6 } },
};

export const WIKI = {
  // "The 6th National Congress of the Communist Party of Vietnam (CPV) was held in Ba Đình Hall, Hanoi, between 15 and
  // 18 December 1986." + vi "Đổi Mới": "Chính sách này chính thức được thông qua tại Đại hội Đảng Cộng sản Việt Nam
  // lần thứ VI vào tháng 12 năm 1986"
  doimoi: { url: "https://vi.wikipedia.org/wiki/%C4%90%E1%BB%95i_M%E1%BB%9Bi", url_en: "https://en.wikipedia.org/wiki/6th_National_Congress_of_the_Communist_Party_of_Vietnam" },
  // Typhoon Yagi (revision of 2026-11-23): "made landfall over Haiphong and Quảng Ninh, Vietnam, on September 7";
  // "In Vietnam, over 329,000 structures were affected and 325 people died, with 24 more missing; a majority of the
  // casualties were caused by landslides."; "the government estimated the cost of the typhoon was exceeding 84.543
  // trillion đồng (US$3.47 billion, 2024 USD)"; "the strongest typhoon in 70 years to strike Vietnam according to the
  // country's government"; "Quảng Ninh was the hardest hit province".
  yagi: { url: "https://en.wikipedia.org/wiki/Typhoon_Yagi", deaths: 325, missing: 24, structures: 329000, cost_trillion_vnd: 84.543, cost_busd: 3.47 },
  // Đơn vị hành chính cấp tỉnh (Việt Nam): "Đến cuối năm 2024, Việt Nam có 63 đơn vị hành chính cấp tỉnh, gồm 57 tỉnh
  // và 6 thành phố trực thuộc trung ương." / "Tính đến ngày 20 tháng 9 năm 2026, Việt Nam có 34 đơn vị hành chính cấp
  // tỉnh, bao gồm 25 tỉnh và 9 thành phố trực thuộc trung ương."
  units: { url: "https://vi.wikipedia.org/wiki/%C4%90%C6%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_c%E1%BA%A5p_t%E1%BB%89nh_(Vi%E1%BB%87t_Nam)",
    end2024: { units: 63, provinces: 57, cities: 6 }, sep2026: { units: 34, provinces: 25, cities: 9 } },
};
