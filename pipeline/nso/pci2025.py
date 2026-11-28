"""PCI 2025 composite score computed by the atlas (VCCI does not publish it).

python -m pipeline.nso.pci2025   reads data/raw/pci/du_lieu_pci_2025.xlsx (sheet PCI: 34 provinces, nine sub-indices on
a 1–10 scale, rank group) and writes data/stats/p34/pci_2025.csv and the 2022 / 2024 / 2025 rows of
data/stats/pci_series.csv.

Composite = 10 × Σ weight × sub-index, with the weights of the PCI 2025 report (Báo cáo PCI 2025, Hình A1.1 p.138;
weight groups in Bảng 4.2 p.105): Gia nhập thị trường 0.05; Tiếp cận đất đai/nguồn lực, Chi phí tuân thủ, Chi phí
không chính thức, Cạnh tranh bình đẳng, Thiết chế pháp lý 0.10; Tính minh bạch, Hỗ trợ doanh nghiệp, Chính quyền kiến
tạo 0.15. The rank group each score falls in by the published cut-offs (Bảng 4.3 p.107) must equal VCCI's group.
"""
import csv

import openpyxl

from ..admin import NEW, fold
from ..fetch import RAW, ROOT, manifest

STATS = ROOT / "data" / "stats"
XLSX = RAW / "pci" / "du_lieu_pci_2025.xlsx"
# columns 1–9 of sheet PCI ("Chỉ số 1: Gia nhập thị trường" … "Chỉ số 9: Chính quyền kiến tạo")
WEIGHTS = [0.05, 0.10, 0.15, 0.10, 0.10, 0.10, 0.15, 0.10, 0.15]
# Bảng 4.3 p.107: lower bound of each group (mean ± k SD of the 2025 composite)
CUTS = [(70.80, "Rất tốt"), (67.28, "Tốt"), (63.76, "Khá"), (60.23, "Trung bình"), (56.71, "Tương đối thấp"), (float("-inf"), "Thấp")]
WEIGHT_CITE = "weights: Báo cáo PCI 2025, Hình A1.1 p.138 and Bảng 4.2 p.105; groups: Bảng 4.3 p.107"


def group(score):
    return next(g for lo, g in CUTS if round(score, 2) >= lo)


def composite(subs):
    assert abs(sum(WEIGHTS) - 1) < 1e-9
    return 10 * sum(w * s for w, s in zip(WEIGHTS, subs))


def main():
    url = manifest("pci")[XLSX.name]["url"]
    rows = list(openpyxl.load_workbook(XLSX, read_only=True, data_only=True)["PCI"].iter_rows(values_only=True))
    head = rows[0]
    assert head[1].startswith("Chỉ số 1: Gia nhập") and head[9].startswith("Chỉ số 9: Chính quyền kiến tạo"), head
    names = {fold(n): n for n in NEW}
    out = []
    for r in rows[1:]:
        if not r or not r[0] or len(r) < 11:  # the summary rows (Thấp nhất, Cao nhất, Trung vị) have no group
            continue
        name = names[fold(r[0])]
        subs = [float(x) for x in r[1:10]]
        s = composite(subs)
        assert group(s) == r[10], (name, s, r[10])
        out.append([r[0], round(s, 2), 2025, "PCI composite (0-100), computed by the atlas", f"{url} (sheet PCI; {WEIGHT_CITE})",
                    name, r[10], *[round(x, 4) for x in subs]])
    assert len(out) == 34, len(out)
    with open(STATS / "p34" / "pci_2025.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["province_name_vi", "value", "year", "unit", "source_url", "province_std", "group"] + [f"sub{k}" for k in range(1, 10)])
        w.writerows(out)
    with open(STATS / "pci_series.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["province_std", "level", "year", "value", "unit", "source_url", "status"])
        for fn in ("pci_score_2022", "pci_score_2024"):
            for r in csv.DictReader(open(STATS / f"{fn}.csv", encoding="utf-8")):
                w.writerow([r["province_std"], "63", r["year"], r["value"], "PCI score (0-100)", r["source_url"], "final"])
        for r in out:
            w.writerow([r[5], "34", 2025, r[1], "PCI score (0-100), computed by the atlas", r[4], "final"])
    print("pci 2025:", len(out), "provinces, groups reproduced; range", min(r[1] for r in out), "–", max(r[1] for r in out))


if __name__ == "__main__":
    main()
