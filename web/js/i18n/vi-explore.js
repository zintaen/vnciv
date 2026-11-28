// Vietnamese strings for ext/explore (place-card photos, Measure and Radius, fly-along journeys, season calendar).
export default {
  // top-bar "More" menu
  "Measure": "Đo",
  "Measure a distance on the map (km)": "Đo khoảng cách trên bản đồ (km)",
  "Radius": "Vòng bán kính",
  "A circle on the map: population, area and places inside": "Một vòng tròn trên bản đồ: dân số, diện tích và các địa điểm bên trong",
  "Fly-along journeys": "Hành trình bay",
  "Fly along the North–South railway, the Mekong or the Red River": "Bay dọc đường sắt Bắc – Nam, sông Mê Kông hoặc sông Hồng",

  // photos
  "Photos of {name}": "Ảnh {name}",
  "Photos near here": "Ảnh quanh đây",
  "Loading photos…": "Đang tải ảnh…",
  "Photos need an internet connection.": "Cần kết nối mạng để xem ảnh.",
  "No freely licensed photos found near here.": "Không tìm thấy ảnh có giấy phép tự do quanh đây.",
  "Photos could not be loaded (offline or Wikimedia Commons is unreachable).": "Không tải được ảnh (mất mạng hoặc không kết nối được Wikimedia Commons).",
  "Unknown author": "Không rõ tác giả",
  "Photos: Wikimedia Commons (free licences); not checked by the atlas.": "Ảnh: Wikimedia Commons (giấy phép tự do); atlas không kiểm duyệt.",

  // measure
  "Measure distance": "Đo khoảng cách",
  "{n} points": "{n} điểm",
  "finished": "đã xong",
  "Click the map to start a new path.": "Bấm lên bản đồ để bắt đầu đường đo mới.",
  "Click the map to add points. Double-click or Enter finishes, Backspace removes the last point, Esc closes.":
    "Bấm lên bản đồ để thêm điểm. Nhấp đúp hoặc Enter để kết thúc, Backspace xóa điểm cuối, Esc để đóng.",
  "+ Point at map centre": "+ Điểm ở giữa bản đồ",
  "Undo": "Hoàn tác",
  "Finish": "Kết thúc",
  "Clear path": "Xóa đường đo",
  "Great-circle distance (haversine on a 6,371 km sphere) between the points, through the map's projection.":
    "Khoảng cách theo vòng tròn lớn (công thức haversine trên mặt cầu bán kính 6.371 km) giữa các điểm, quy đổi qua phép chiếu của bản đồ.",

  // radius
  "Radius (km)": "Bán kính (km)",
  "Centre on map centre": "Đặt tâm ở giữa bản đồ",
  "Click the map to move the centre, Shift-click to set the edge (the radius). Esc closes.":
    "Bấm lên bản đồ để dời tâm, Shift + bấm để đặt mép vòng (bán kính). Esc để đóng.",
  "Click the map to pick the centre (or use the button). Then type or slide the radius.":
    "Bấm lên bản đồ để chọn tâm (hoặc dùng nút). Sau đó nhập hoặc kéo thanh bán kính.",
  "Counting…": "Đang đếm…",
  "not loaded": "chưa tải được",
  "WorldPop 2025, by hex": "WorldPop 2025, theo ô",
  "{n} hexes × {a} km²": "{n} ô × {a} km²",
  "Vietnam's land in it": "Phần đất liền Việt Nam",
  "circle πr² = {a} km²": "hình tròn πr² = {a} km²",
  "Schools": "Trường học",
  "OSM, per hex": "OSM, theo ô",
  "Communes and wards": "Xã, phường",
  "by label point": "theo điểm nhãn",
  "Lakes and reservoirs": "Hồ và hồ chứa",
  "Hex-level approximation: a hex (about {a} km²) is inside when its centre is within the radius (edge hexes counted by their centre); a place counts when its hex is inside. Population = WorldPop 2025 residents per hex (the Population theme's density × hex area), Vietnam's land only. Schools = the Schools theme's OpenStreetMap count per hex. Hospitals, universities, markets: OpenStreetMap points (everyday places); airports and seaports: the transport layers; communes: the 2025 communes' label points; peaks and lakes: the geography layers. OpenStreetMap coverage depends on volunteer mappers.":
    "Ước tính theo ô lục giác: một ô (khoảng {a} km²) được tính là nằm trong vòng khi tâm ô nằm trong bán kính (ô ở mép vòng xét theo tâm ô); một địa điểm được tính khi ô chứa nó nằm trong vòng. Dân số = số dân WorldPop 2025 của từng ô (mật độ của chủ đề Dân số × diện tích ô), chỉ trên đất liền Việt Nam. Trường học = số trường OpenStreetMap theo ô của chủ đề Trường học. Bệnh viện, đại học, chợ: các điểm OpenStreetMap (địa điểm thường ngày); sân bay và cảng biển: các lớp giao thông; xã, phường: điểm nhãn của các xã, phường năm 2025; đỉnh núi và hồ: các lớp địa lý. Độ phủ OpenStreetMap tùy vào người vẽ bản đồ tình nguyện.",

  // fly-along journeys
  "Fly-along journey": "Hành trình bay",
  "Reunification Express: Hà Nội → Sài Gòn": "Tàu Thống Nhất Hà Nội → Sài Gòn",
  "Along the North–South railway": "Dọc tuyến đường sắt Bắc – Nam",
  "The line through the main-line rail hexes (OpenStreetMap, 2026), smoothed: not the exact track. The map's data has no stations, so the caption names the province and the nearest provincial seat.":
    "Đường đi qua các ô có tuyến đường sắt chính (OpenStreetMap, 2026), đã làm mượt: không phải đúng từng mét đường ray. Dữ liệu của bản đồ không có nhà ga, nên chú thích ghi tên tỉnh và tỉnh lỵ gần nhất.",
  "Down the Mekong River": "Xuôi dòng Mê Kông",
  "From Laos to the delta": "Từ Lào về đồng bằng",
  "The river's longest mapped course (OpenStreetMap in Vietnam, Natural Earth outside), smoothed; outside Vietnam the caption says so.":
    "Dòng chảy dài nhất của con sông trên bản đồ (OpenStreetMap trong lãnh thổ Việt Nam, Natural Earth ở ngoài), đã làm mượt; khi ra ngoài lãnh thổ Việt Nam, chú thích sẽ ghi rõ.",
  "Down the Red River (sông Hồng)": "Xuôi dòng sông Hồng",
  "From Yunnan (China) to the sea": "Từ Vân Nam (Trung Quốc) ra biển",
  "The river's longest mapped course (OpenStreetMap in Vietnam, Natural Earth outside), smoothed.":
    "Dòng chảy dài nhất của con sông trên bản đồ (OpenStreetMap trong lãnh thổ Việt Nam, Natural Earth ở ngoài), đã làm mượt.",
  "Beyond Vietnam's borders": "Ngoài lãnh thổ Việt Nam",
  "Over water": "Trên mặt nước",
  "{province} · near {city}": "{province} · gần {city}",
  "Previous waypoint": "Điểm dừng trước",
  "Next waypoint": "Điểm dừng sau",
  "Speed": "Tốc độ",
  "This journey's line is not available.": "Chưa có dữ liệu đường đi của hành trình này.",

  // season calendar
  "Season calendar": "Lịch mùa",
  "Month by month: rice stages, the Mekong flood season, storms, festivals (lunar calendar) and flower seasons, each from a cited source. Click an item to fly there.":
    "Từng tháng: mùa lúa, mùa nước nổi Mê Kông, bão, lễ hội (âm lịch) và mùa hoa, mỗi mục đều có nguồn. Bấm vào một mục để bay tới nơi đó.",
  "{season}: planting": "{season}: gieo cấy",
  "{season}: harvest": "{season}: thu hoạch",
  "Between seasons": "Giữa hai vụ",
  "Winter–spring (Đông Xuân)": "Vụ Đông Xuân",
  "Main season (vụ Mùa)": "Vụ Mùa",
  "Summer–autumn (Hè Thu)": "Vụ Hè Thu",
  "Late summer–autumn / autumn–winter (Thu Đông)": "Vụ Thu Đông",
  "Mekong flood season (mùa nước nổi)": "Mùa nước nổi Mê Kông",
  "The peak of the season": "Đỉnh mùa nước",
  "Water level {p}% of the peak (illustrative)": "Mực nước bằng {p}% lúc đỉnh (minh họa)",
  "Tropical storms": "Bão nhiệt đới",
  "{n} storms came near Vietnam in this month {a}–{b} ({p} a year on average, {s} of typhoon strength)":
    "{n} cơn bão đến gần Việt Nam vào tháng này trong giai đoạn {a}–{b} (trung bình {p} cơn mỗi năm, {s} cơn đạt cấp bão mạnh)",
  "most often: {list}": "thường gặp nhất: {list}",
  "Storm season": "Mùa bão",
  "Storms are rare this month": "Tháng này hiếm có bão",
  "Floods": "Mùa nước",
  "Festivals (lunar calendar)": "Lễ hội (âm lịch)",
  "No listed festival starts this month.": "Không có lễ hội nào trong danh sách bắt đầu vào tháng này.",
  "Solar dates computed for {a}–{b} only.": "Chỉ tính ngày dương lịch cho các năm {a}–{b}.",
  "day {d} of lunar month {m}": "ngày {d} tháng {m} âm lịch",
  "Flowers and fields": "Mùa hoa và ruộng bậc thang",
  "Source: Wikipedia “{title}”": "Nguồn: Wikipedia “{title}”",
  "Rice: USDA FAS crop calendar (North and South rows). Flood season: illustrative months from the Mekong Delta literature. Storms: IBTrACS tracks within 100 km of Vietnam's land, by the month they first came near (“storm season”: at least one storm every four years on average). Festivals: the placed festivals of the Vietnamese Wikipedia list; solar dates from Hồ Ngọc Đức's lunar calendar. Flowers and fields: only those whose months a Vietnamese Wikipedia article states (linked). Typical seasons, not forecasts.":
    "Lúa: lịch thời vụ của USDA FAS (hàng miền Bắc và miền Nam). Mùa nước nổi: các tháng minh họa theo tài liệu về Đồng bằng sông Cửu Long. Bão: quỹ đạo IBTrACS đi trong vòng 100 km quanh đất liền Việt Nam, xếp theo tháng bão bắt đầu đến gần (“mùa bão”: trung bình ít nhất một cơn mỗi bốn năm). Lễ hội: các lễ hội đã định vị trong danh sách của Wikipedia tiếng Việt; ngày dương lịch theo lịch âm của Hồ Ngọc Đức. Mùa hoa và ruộng bậc thang: chỉ những mục có bài Wikipedia tiếng Việt nêu rõ tháng (có liên kết). Là mùa thường lệ, không phải dự báo.",
};
