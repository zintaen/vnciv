"""Vietnam's administrative units.

* `OLD`: the 63 provinces and centrally-run cities before 1 July 2025 (the units GSO statistics are published for):
  geoBoundaries name → (ISO 3166-2 suffix, display name, seat city).
* `NEW`: the 34 provinces from 1 July 2025 (Resolution 202/2025/QH15): each is a union of whole former provinces.
"""

# geoBoundaries shapeName → (iso suffix, name, seat (the former province's capital city))
OLD = {
    "An Giang": ("44", "An Giang", "Long Xuyên"),
    "Bà Rịa–Vũng Tàu": ("43", "Bà Rịa–Vũng Tàu", "Bà Rịa"),
    "Côn Đảo": ("43", "Bà Rịa–Vũng Tàu", None),  # a separate part in geoBoundaries
    "Bắc Giang": ("54", "Bắc Giang", "Bắc Giang"),
    "Bắc Kạn": ("53", "Bắc Kạn", "Bắc Kạn"),
    "Bạc Liêu": ("55", "Bạc Liêu", "Bạc Liêu"),
    "Bắc Ninh": ("56", "Bắc Ninh", "Bắc Ninh"),
    "Bến Tre": ("50", "Bến Tre", "Bến Tre"),
    "Bình Định": ("31", "Bình Định", "Quy Nhơn"),
    "Bình Dương": ("57", "Bình Dương", "Thủ Dầu Một"),
    "Bình Phước": ("58", "Bình Phước", "Đồng Xoài"),
    "Bình Thuận": ("40", "Bình Thuận", "Phan Thiết"),
    "Cà Mau": ("59", "Cà Mau", "Cà Mau"),
    "Cần Thơ": ("CT", "Cần Thơ", "Cần Thơ"),
    "Cao Bằng": ("04", "Cao Bằng", "Cao Bằng"),
    "Đà Nẵng": ("DN", "Đà Nẵng", "Đà Nẵng"),
    "Đắk Lắk": ("33", "Đắk Lắk", "Buôn Ma Thuột"),
    "Đắk Nông": ("72", "Đắk Nông", "Gia Nghĩa"),
    "Điện Biên": ("71", "Điện Biên", "Điện Biên Phủ"),
    "Đồng Nai": ("39", "Đồng Nai", "Biên Hòa"),
    "Đồng Tháp": ("45", "Đồng Tháp", "Cao Lãnh"),
    "Gia Lai": ("30", "Gia Lai", "Pleiku"),
    "Hà Giang": ("03", "Hà Giang", "Hà Giang"),
    "Hà Nam": ("63", "Hà Nam", "Phủ Lý"),
    "Hà Nội": ("HN", "Hà Nội", "Hà Nội"),
    "Hà Tĩnh": ("23", "Hà Tĩnh", "Hà Tĩnh"),
    "Hải Dương": ("61", "Hải Dương", "Hải Dương"),
    "Hải Phòng": ("HP", "Hải Phòng", "Hải Phòng"),
    "Hậu Giang": ("73", "Hậu Giang", "Vị Thanh"),
    "Ho Chi Minh": ("SG", "TP. Hồ Chí Minh", "TP. Hồ Chí Minh"),
    "Hòa Bình": ("14", "Hòa Bình", "Hòa Bình"),
    "Hưng Yên": ("66", "Hưng Yên", "Hưng Yên"),
    "Khánh Hòa": ("34", "Khánh Hòa", "Nha Trang"),
    "Kiên Giang": ("47", "Kiên Giang", "Rạch Giá"),
    "Kon Tum": ("28", "Kon Tum", "Kon Tum"),
    "Lai Châu": ("01", "Lai Châu", "Lai Châu"),
    "Lâm Đồng": ("35", "Lâm Đồng", "Đà Lạt"),
    "Lạng Sơn": ("09", "Lạng Sơn", "Lạng Sơn"),
    "Lào Cai": ("02", "Lào Cai", "Lào Cai"),
    "Long An": ("41", "Long An", "Tân An"),
    "Nam Định": ("67", "Nam Định", "Nam Định"),
    "Nghệ An": ("22", "Nghệ An", "Vinh"),
    "Ninh Bình": ("18", "Ninh Bình", "Ninh Bình"),
    "Ninh Thuận": ("36", "Ninh Thuận", "Phan Rang–Tháp Chàm"),
    "Phú Thọ": ("68", "Phú Thọ", "Việt Trì"),
    "Phú Yên": ("32", "Phú Yên", "Tuy Hòa"),
    "Quảng Bình": ("24", "Quảng Bình", "Đồng Hới"),
    "Quảng Nam": ("27", "Quảng Nam", "Tam Kỳ"),
    "Quảng Ngãi": ("29", "Quảng Ngãi", "Quảng Ngãi"),
    "Quảng Ninh": ("13", "Quảng Ninh", "Hạ Long"),
    "Quảng Trị": ("25", "Quảng Trị", "Đông Hà"),
    "Sóc Trăng": ("52", "Sóc Trăng", "Sóc Trăng"),
    "Sơn La": ("05", "Sơn La", "Sơn La"),
    "Tây Ninh": ("37", "Tây Ninh", "Tây Ninh"),
    "Thái Bình": ("20", "Thái Bình", "Thái Bình"),
    "Thái Nguyên": ("69", "Thái Nguyên", "Thái Nguyên"),
    "Thanh Hóa": ("21", "Thanh Hóa", "Thanh Hóa"),
    "Thừa Thiên Huế": ("26", "Thừa Thiên Huế", "Huế"),
    "Tiền Giang": ("46", "Tiền Giang", "Mỹ Tho"),
    "Trà Vinh": ("51", "Trà Vinh", "Trà Vinh"),
    "Tuyên Quang": ("07", "Tuyên Quang", "Tuyên Quang"),
    "Vĩnh Long": ("49", "Vĩnh Long", "Vĩnh Long"),
    "Vĩnh Phúc": ("70", "Vĩnh Phúc", "Vĩnh Yên"),
    "Yên Bái": ("06", "Yên Bái", "Yên Bái"),
}

# 2025 province: (abbr, [former provinces' display names])
NEW = {
    "Hà Nội": ("HN", ["Hà Nội"]),
    "Huế": ("HUE", ["Thừa Thiên Huế"]),
    "Lai Châu": ("LCH", ["Lai Châu"]),
    "Điện Biên": ("DBI", ["Điện Biên"]),
    "Sơn La": ("SLA", ["Sơn La"]),
    "Lạng Sơn": ("LSO", ["Lạng Sơn"]),
    "Quảng Ninh": ("QNI", ["Quảng Ninh"]),
    "Thanh Hóa": ("THO", ["Thanh Hóa"]),
    "Nghệ An": ("NAN", ["Nghệ An"]),
    "Hà Tĩnh": ("HTI", ["Hà Tĩnh"]),
    "Cao Bằng": ("CBA", ["Cao Bằng"]),
    "Tuyên Quang": ("TQU", ["Tuyên Quang", "Hà Giang"]),
    "Lào Cai": ("LCA", ["Yên Bái", "Lào Cai"]),
    "Thái Nguyên": ("TNG", ["Thái Nguyên", "Bắc Kạn"]),
    "Phú Thọ": ("PTH", ["Vĩnh Phúc", "Phú Thọ", "Hòa Bình"]),
    "Bắc Ninh": ("BNI", ["Bắc Giang", "Bắc Ninh"]),
    "Hưng Yên": ("HYE", ["Hưng Yên", "Thái Bình"]),
    "Hải Phòng": ("HPH", ["Hải Phòng", "Hải Dương"]),
    "Ninh Bình": ("NBI", ["Ninh Bình", "Hà Nam", "Nam Định"]),
    "Quảng Trị": ("QTR", ["Quảng Bình", "Quảng Trị"]),
    "Đà Nẵng": ("DNA", ["Đà Nẵng", "Quảng Nam"]),
    "Quảng Ngãi": ("QNG", ["Quảng Ngãi", "Kon Tum"]),
    "Gia Lai": ("GLA", ["Bình Định", "Gia Lai"]),
    "Khánh Hòa": ("KHO", ["Khánh Hòa", "Ninh Thuận"]),
    "Lâm Đồng": ("LDO", ["Lâm Đồng", "Đắk Nông", "Bình Thuận"]),
    "Đắk Lắk": ("DLA", ["Đắk Lắk", "Phú Yên"]),
    "TP. Hồ Chí Minh": ("HCM", ["TP. Hồ Chí Minh", "Bình Dương", "Bà Rịa–Vũng Tàu"]),
    "Đồng Nai": ("DNI", ["Đồng Nai", "Bình Phước"]),
    "Tây Ninh": ("TNI", ["Long An", "Tây Ninh"]),
    "Cần Thơ": ("CTH", ["Cần Thơ", "Sóc Trăng", "Hậu Giang"]),
    "Vĩnh Long": ("VLO", ["Vĩnh Long", "Bến Tre", "Trà Vinh"]),
    "Đồng Tháp": ("DTH", ["Tiền Giang", "Đồng Tháp"]),
    "Cà Mau": ("CMA", ["Cà Mau", "Bạc Liêu"]),
    "An Giang": ("AGI", ["Kiên Giang", "An Giang"]),
}

CAPITAL_ISO = "HN"  # Hà Nội, the national capital


def fold(s: str) -> str:
    """Lower-case ASCII fold for matching and sorting Vietnamese names (đ → d)."""
    import unicodedata
    s = s.replace("Đ", "D").replace("đ", "d")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def old_units():
    """[{iso, name, seat, new}] for the 63 former provinces, sorted by folded name."""
    new_of = {o: n for n, (_, olds) in NEW.items() for o in olds}
    seen, out = set(), []
    for iso, name, seat in OLD.values():
        if iso in seen:
            continue
        seen.add(iso)
        out.append({"iso": iso, "name": name, "seat": seat, "new": new_of[name]})
    assert len(out) == 63 and all(u["new"] for u in out), "admin tables out of sync"
    return sorted(out, key=lambda u: fold(u["name"]))


def new_units():
    """[{abbr, name, olds}] for the 34 provinces, sorted by folded name."""
    out = [{"abbr": a, "name": n, "olds": olds} for n, (a, olds) in NEW.items()]
    assert len(out) == 34 and sum(len(u["olds"]) for u in out) == 63
    return sorted(out, key=lambda u: fold(u["name"]))
