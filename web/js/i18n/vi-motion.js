// Vietnamese translations (motion: ambient map motion and chart entrances). Keys are the exact English strings passed to t().
export default {
  // motion-core (main.js Effects switch)
  "Effects": "Hiệu ứng",
  "Display": "Hiển thị",
  "Animations and map effects. When off (or when the system asks for reduced motion) the map stays still and shows the same information.":
    "Chuyển động và hiệu ứng bản đồ. Khi tắt (hoặc khi hệ thống yêu cầu giảm chuyển động), bản đồ đứng yên và vẫn hiển thị đầy đủ thông tin.",
  // motion-ambient
  "Living map": "Bản đồ sống động",
  "Sea shimmer, surf, flowing rivers and drifting cloud shadows. Illustrative only: not weather, currents or real-time data. Off with Effects off or reduced motion.":
    "Mặt biển lấp lánh, sóng vỗ bờ, sông chảy và bóng mây trôi. Chỉ để minh họa: không phải thời tiết, dòng chảy hay dữ liệu thời gian thực. Tắt khi tắt Hiệu ứng hoặc khi bật giảm chuyển động.",
  // motion-history (ext/timeline/replay.js: storm, merger and forest-loss replays)
  "Play": "Phát",
  "Follow the eye": "Bám theo mắt bão",
  "Tropical depression (under 34 kt)": "Áp thấp nhiệt đới, dưới cấp 8 (dưới 34 kt)",
  "Tropical storm (34–63 kt)": "Bão nhiệt đới, cấp 8–11 (34–63 kt)",
  "Typhoon (64 kt or more)": "Từ cấp 12 (64 kt trở lên)",
  "no estimate": "không có ước tính",
  "wind: no estimate": "gió: không có ước tính",
  "Hexes light up when the eye passes within 100 km at 34 kt or more (the lens's rule). Wind: the agency's best-track estimate at each fix.":
    "Các ô sáng lên khi mắt bão đi qua trong vòng 100 km với sức gió từ 34 kt (cấp 8) trở lên (cùng quy tắc với bản đồ chủ đề). Sức gió: ước tính quỹ đạo tốt nhất của cơ quan khí tượng tại mỗi lần định vị.",
  "Next storm ⏭": "Cơn bão tiếp theo ⏭",
  "Speed ×{n}": "Tốc độ ×{n}",
  "Vietnam time (UTC+7)": "giờ Việt Nam (UTC+7)",
  "Replay the track": "Phát lại đường đi của bão",
  "Replay {name}": "Phát lại bão {name}",
  "all storms of {year}": "tất cả các cơn bão năm {year}",
  "Watch the merger": "Xem sáp nhập",
  "1 July 2025: 63 provinces become 34": "1/7/2025: từ 63 tỉnh, thành còn 34",
  "The 23 new provinces merge their former provinces one after another (in the order Resolution 202/2025/QH15 lists them, per Wikipedia); the 11 that stay as they were pulse once.":
    "23 tỉnh, thành mới lần lượt hợp nhất các tỉnh cũ (theo thứ tự Nghị quyết 202/2025/QH15 liệt kê, theo Wikipedia); 11 tỉnh, thành giữ nguyên sáng lên một lần.",
  "Skip ⏭": "Bỏ qua ⏭",
  "{n} of {m} merged": "đã sáp nhập {n}/{m}",
  "Forest loss {a}–{b}": "Mất rừng {a}–{b}",
  "Forest loss, {a}→{b}": "Mất rừng, {a}→{b}",
  "Skip to {year} ⏭": "Đến năm {year} ⏭",
  "{ha} ha lost": "mất {ha} ha",
  "({pct} of the 2000 forest)": "({pct} diện tích rừng năm 2000)",
  "Play the forest loss adding up year by year, {a}→{b}": "Xem diện tích rừng bị mất cộng dồn qua từng năm, {a}→{b}",
  // forest_loss.json note (shown in the forest replay; that file is not scanned by tools/i18n/gen.py)
  "A relative indicator of trends, not an official statistic: the producers warn that Landsat sensors and the method changed over time (year-to-year steps can be artefacts) and that pixel counts are not definitive area estimates. Much loss in Vietnam is the harvest of plantations (acacia, rubber) that are replanted.":
    "Chỉ số tương đối về xu hướng, không phải số liệu thống kê chính thức: nhóm tác giả lưu ý rằng cảm biến Landsat và phương pháp đã thay đổi theo thời gian (chênh lệch giữa các năm có thể là sai lệch kỹ thuật) và số điểm ảnh không phải là ước tính diện tích chính xác. Phần lớn diện tích rừng mất ở Việt Nam là do khai thác rừng trồng (keo, cao su) rồi trồng lại.",
  // motion-traffic (ext/traffic: planes, ships and trains)
  "Moving traffic": "Giao thông chuyển động",
  "Planes on the air routes, ships at the seaports and trains on the railways. Illustrative, not a flight schedule; air routes from OpenFlights (2014). Ship and train frequency are illustrative too. Off with Effects off or reduced motion.":
    "Máy bay trên các tuyến bay, tàu thuyền ở các cảng biển và tàu hỏa trên đường sắt. Minh họa, không phải lịch bay; tuyến bay OpenFlights 2014. Tần suất tàu thuyền và tàu hỏa cũng chỉ để minh họa. Tắt khi tắt Hiệu ứng hoặc khi bật giảm chuyển động.",
  "Illustrative, not a flight schedule; air routes from OpenFlights (2014)": "Minh họa, không phải lịch bay; tuyến bay OpenFlights 2014",
  "Illustrative ship movement, not real shipping lanes or traffic": "Tàu thuyền minh họa, không phải luồng hàng hải hay lượt tàu thật",
  "Illustrative train frequency, not a timetable": "Tần suất tàu minh họa, không phải lịch chạy tàu",
  "North–South railway": "Đường sắt Bắc – Nam",
  "Railway {a} – {b}": "Đường sắt {a} – {b}",
  // motion-3d (ext/view3d: the tilted 3D view)
  "3D view": "Nhìn 3D",
  "Tilted 3D view: hexes rise with elevation, or with the lens's values (Esc leaves)": "Góc nhìn 3D nghiêng: các ô nhô cao theo độ cao địa hình, hoặc theo giá trị của bản đồ chủ đề (Esc để thoát)",
  "3D view of the hex map": "Bản đồ ô lục giác nhìn 3D",
  "Height: the mean elevation of each hex (ETOPO1), exaggerated ×{n}. Colours: terrain, as in 2D. Water is flat.":
    "Chiều cao: độ cao trung bình của mỗi ô (ETOPO1), phóng đại ×{n}. Màu: địa hình, như bản đồ 2D. Mặt nước phẳng.",
  "Height: none, {lens} is a category lens. Colours as in 2D.": "Chiều cao: không có, {lens} là bản đồ phân loại. Màu như bản đồ 2D.",
  "Height: {lens}, on the legend's colour scale (logarithmic): flat at its low end, tallest at its high end. Hexes without data and neighbouring countries are flat.":
    "Chiều cao: {lens}, theo thang màu của chú giải (thang logarit): thấp nhất ở đầu thấp, cao nhất ở đầu cao. Ô không có dữ liệu và các nước láng giềng để phẳng.",
  "Height: {lens}, on the legend's colour scale (linear): flat at its low end, tallest at its high end. Hexes without data and neighbouring countries are flat.":
    "Chiều cao: {lens}, theo thang màu của chú giải (thang tuyến tính): thấp nhất ở đầu thấp, cao nhất ở đầu cao. Ô không có dữ liệu và các nước láng giềng để phẳng.",
  "Drag to orbit and tilt, Shift-drag or right-drag (two fingers) to pan, wheel or pinch to zoom, double-click to centre.":
    "Kéo để xoay và nghiêng, Shift + kéo hoặc kéo chuột phải (hai ngón tay) để di chuyển, cuộn chuột hoặc chụm ngón để thu phóng, nhấp đúp để đưa vào giữa.",
  "Reset view": "Đặt lại góc nhìn",
  "2D map": "Bản đồ 2D",
  // motion-tour (ext/daynight: day–night shading and city lights; ext/tour: "Hành trình Việt Nam")
  "Day–night": "Ngày – đêm",
  "Shades the map by the real position of the sun right now, with a Vietnam-time clock. The night lights are derived from population density (WorldPop), not satellite data.":
    "Tô sáng tối bản đồ theo vị trí thật của Mặt Trời lúc này, kèm đồng hồ giờ Việt Nam. Ánh đèn ban đêm được ước tính từ mật độ dân số (WorldPop), không phải ảnh vệ tinh.",
  "Lights derived from population, not satellite data": "Ánh đèn ước tính từ dân số, không phải ảnh vệ tinh",
  "▶ 24 h": "▶ 24 giờ",
  "Play one day in about 20 seconds": "Xem trọn một ngày trong khoảng 20 giây",
  "Back to now": "Về hiện tại",
  "Vietnam journey": "Hành trình Việt Nam",
  "a 2-minute camera tour, Lũng Cú to Cà Mau": "chuyến bay 2 phút qua bản đồ, từ Lũng Cú đến Cà Mau",
  "Facts from this map's data: see the Almanac for sources": "Số liệu lấy từ dữ liệu của bản đồ; nguồn xem trong Niên giám",
  "Previous stop (←)": "Điểm trước (←)",
  "Next stop (→)": "Điểm tiếp theo (→)",
  "{n} of {m}": "{n}/{m}",
  "End of the journey": "Kết thúc hành trình",
  "↺ Start again": "↺ Xem lại từ đầu",
  "{lat}° N, {lon}° E": "Vĩ độ {lat}° Bắc, kinh độ {lon}° Đông",
  "Population of {name}: {pop} ({year})": "Dân số {name}: {pop} người ({year})",
  "Part of {name} since the 2025 merger": "Thuộc {name} từ đợt sáp nhập năm 2025",
  "{site}: Vietnam's first UNESCO World Heritage site, inscribed in {year}": "{site}: Di sản Thế giới UNESCO đầu tiên của Việt Nam, được công nhận năm {year}",
  "{site}: UNESCO World Heritage site since {year}": "{site}: Di sản Thế giới UNESCO từ năm {year}",
  "{park} covers {area} km²": "{park} rộng {area} km²",
  "Among them: {list}": "Trong đó có {list}",
  "{n} islands and reefs on the map, part of {owner}": "{n} đảo, đá được đánh dấu trên bản đồ, thuộc {owner}",
  "Highest hex of Vietnam on the map: {m} m (ETOPO1)": "Ô cao nhất của Việt Nam trên bản đồ: {m} m (ETOPO1)",
  "Sa Pa and the Hoàng Liên Sơn range": "Sa Pa và dãy Hoàng Liên Sơn",
  "Hà Nội, the capital": "Thủ đô Hà Nội",
  "Đà Nẵng and Hội An": "Đà Nẵng và Hội An",
  "Average height of its hex: {m} m above sea level": "Độ cao trung bình của ô: {m} m so với mực nước biển",
  "Mean temperature {v} °C ({year} average)": "Nhiệt độ trung bình {v} °C (trung bình {year})",
  "Ho Chi Minh City": "TP. Hồ Chí Minh",
  "{d} people per km², the densest of the 63 former provinces": "{d} người/km², đông đúc nhất trong 63 tỉnh, thành cũ",
  "{d} people per km²": "{d} người/km²",
  "The Mekong Delta: Cần Thơ": "Đồng bằng sông Cửu Long: Cần Thơ",
  "Rice harvest: {v} tonnes per km² of the province ({year})": "Sản lượng lúa: {v} tấn trên mỗi km² diện tích tỉnh ({year})",
  "Cape Cà Mau": "Mũi Cà Mau",
};
