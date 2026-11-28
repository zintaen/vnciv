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

// Wikipedia articles fetched through the MediaWiki API for the newer chapters (data/raw/wikipedia_events/<raw>, listed in
// data/stats/history/articles.json). `quote` is verbatim from revision `rev`; tests/test_story2.py checks each quote is
// in the cached extract and each number below is in its quote.
const W = (t) => `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_")).replace(/%28/g, "(").replace(/%29/g, ")")}`;
export const ARTICLES = {
  rail: { raw: "story_rail.json", rev: 1384680358, url: W("North–South railway (Vietnam)"), km: 1726, from: 1899, to: 1936, share2007: { passengers: 85, cargo: 60 },
    quotes: [
      "It is a single-track metre gauge line connecting the capital Hanoi in the north to Ho Chi Minh City in the south, for a total length of 1,726 km (1,072 mi).",
      "The line was established during French colonial rule, and was completed over a period of nearly forty years, from 1899 to 1936.",
      "As of 2007, 85% of the network's passenger volume and 60% of its cargo volume was transported along the line.",
    ] },
  rail_vinh_hue: { raw: "story_rail.json", rev: 1384680358, url: W("North–South railway (Vietnam)"), from: 1913, to: 1927, last_from: 1930, last_to: 1936,
    quotes: ["The Vinh-Huế section was constructed from 1913 to 1927, and finally, the remaining Huế–Nha Trang section was constructed from 1930 to 1936."] },
  rail_1936: { raw: "story_rail.json", rev: 1384680358, url: W("North–South railway (Vietnam)"), date: "1936-10-02",
    quotes: ["On 2 October 1936, the entire 1,726 km (1,072 mi) Hanoi–Saigon link was formally put into full operation."] },
  rail_1976: { raw: "story_rail.json", rev: 1384680358, url: W("North–South railway (Vietnam)"), date: "1976-12-31",
    quotes: ["Heavily damaged, the war-torn North–South railway line was nevertheless restored and returned to service on 31 December 1976, promoted as a symbol of Vietnamese unity."] },
  highlands: { raw: "story_highlands.json", rev: 1378528282, url: W("Central Highlands (Vietnam)"), basalt_mha: 2, basalt_share: 60, coffee_kha: 290, coffee_share: 80,
    quotes: [
      "The region is home to nearly 2 million hectares of fertile basalt, making up for 60% of the national basalt soil, which is very suitable for industrial crops such as coffee, cocoa, pepper, mulberry, and tea.",
      "The current coffee area here is over 290 thousand hectares, accounting for 80% of the country's coffee area.",
    ] },
  highlands_provinces: { raw: "story_highlands.json", rev: 1378528282, url: W("Central Highlands (Vietnam)"), abbr: ["DLA", "GLA", "LDO", "QNG"],
    quotes: ["Lâm Đồng (before were Lâm Đồng and Đắk Nông)"] },
  coffee: { raw: "story_coffee.json", rev: 1388220226, url: W("Coffee production in Vietnam"), robusta: 97,
    quotes: ["Vietnam is the second largest producer in the world after Brazil, with Robusta coffee accounting to 97 per cent of Vietnam's total output."] },
};
