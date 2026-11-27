"""Audit checks on places.json and the seaport table (round 1): towns are where GeoNames' own district puts them, and the
seaport classes match the signed scan of Quyết định 804/QĐ-TTg (independent transcription)."""
import json
import math
import unittest
from pathlib import Path

from pipeline.build.infrastructure import SEAPORTS

DATA = Path(__file__).resolve().parent.parent / "web" / "data"

# Phụ lục, Quyết định 804/QĐ-TTg (8 July 2022), STT 1–34, "Xếp loại"
QD804 = {"Quảng Ninh": "I", "Hải Phòng": "special", "Nam Định": "III", "Thái Bình": "III", "Thanh Hóa": "I",
         "Nghệ An": "I", "Hà Tĩnh": "I", "Quảng Bình": "II", "Quảng Trị": "II", "Thừa Thiên Huế": "II", "Đà Nẵng": "I",
         "Quảng Nam": "III", "Quảng Ngãi": "I", "Bình Định": "I", "Phú Yên": "III", "Khánh Hòa": "I", "Ninh Thuận": "III",
         "Bình Thuận": "II", "TP. Hồ Chí Minh": "I", "Bà Rịa–Vũng Tàu": "special", "Đồng Nai": "I", "Bình Dương": "III",
         "Long An": "III", "Tiền Giang": "III", "Bến Tre": "III", "Đồng Tháp": "II", "Sóc Trăng": "III",
         "Hậu Giang": "II", "Cần Thơ": "I", "An Giang": "III", "Vĩnh Long": "III", "Cà Mau": "III", "Kiên Giang": "III",
         "Trà Vinh": "II"}


class TestPlacesAudit(unittest.TestCase):
    def test_seaport_classes_match_qd804(self):
        self.assertEqual({s: c for s, c, _ in SEAPORTS}, QD804)
        self.assertEqual([s for s, _, _ in SEAPORTS], list(QD804), "in the decision's order")

    def test_port_areas_belong_to_their_seaport(self):
        # Quyết định 1579 lists the Vĩnh Thái terminals under the Vĩnh Long seaport, not Hậu Giang
        areas = {s: [a for a, _ in ar] for s, _, ar in SEAPORTS}
        self.assertNotIn("Vĩnh Thái", areas["Hậu Giang"])

    def test_towns_not_misplaced(self):
        towns = json.loads((DATA / "places.json").read_text())["towns"]
        names = [t["name"] for t in towns]
        self.assertEqual(len(names), len(set(names)))
        # GeoNames rows placed far from their own district: Hải Châu (Đà Nẵng's centre) in rural Quảng Nam,
        # Xuân Lộc on top of Long Khánh
        self.assertNotIn("Hải Châu", names)
        self.assertNotIn("Xuân Lộc", names)
        for i, a in enumerate(towns):
            for b in towns[i + 1:]:
                self.assertGreater(math.dist((a["x"], a["y"]), (b["x"], b["y"])), 25, (a["name"], b["name"]))


if __name__ == "__main__":
    unittest.main()
