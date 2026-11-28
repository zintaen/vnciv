"""Sources of the borders stream (web/data/borders_history.json): the legal texts behind each province-map change since
1975, and the Wikipedia revisions that list the province-level units year by year.

Wikisource and Wikipedia pages are fetched through the MediaWiki API pinned to one revision (revids=…), so the file
is the exact text that was checked. thuvienphapluat.vn and vbpl.vn refuse scripts; their copies come from the Internet
Archive (the id_ form returns the page as archived).
"""
from __future__ import annotations

import urllib.parse


def _api(site: str, revid: int) -> str:
    return (f"https://{site}/w/api.php?action=query&prop=revisions&rvprop=ids|timestamp|content&rvslots=main"
            f"&revids={revid}&format=json&formatversion=2")


def _wb(stamp: str, url: str) -> str:
    return f"https://web.archive.org/web/{stamp}id_/{url}"


TVPL = "https://thuvienphapluat.vn/van-ban/"
# file name → (Wikisource revision, title): the resolutions of 1975–1982
WIKISOURCE = {
    "ws_1975_hop_nhat.json": (105691, "Nghị quyết của Quốc hội nước Việt Nam Dân chủ Cộng hòa về việc hợp nhất một số tỉnh"),
    "ws_1977_con_dao.json": (105701, "Nghị quyết … phê chuẩn việc sáp nhập huyện Côn Đảo vào tỉnh Hậu Giang"),
    "ws_1978_dia_gioi.json": (105710, "Nghị quyết phê chuẩn việc phân vạch lại địa giới thành phố Hà Nội, thành phố Hồ Chí Minh, các tỉnh Hà Sơn Bình, Vĩnh Phú, Cao Lạng, Bắc Thái, Quảng Ninh và Đồng Nai"),
    "ws_1979_vung_tau.json": (105713, "Nghị quyết … về việc thành lập đặc khu Vũng Tàu - Côn Đảo trực thuộc Trung ương"),
    "ws_1982_truong_sa.json": (105736, "Nghị quyết … về việc sáp nhập huyện Trường Sa thuộc tỉnh Đồng Nai vào tỉnh Phú Khánh"),
}
# file name → archived official page: 1989–2008
OFFICIAL = {
    "tvpl_1989.html": _wb("20260130045455", TVPL + "Bo-may-hanh-chinh/Nghi-quyet-phan-vach-dai-gioi-hanh-chinh-cua-cac-tinh-Nghia-Binh-Phu-Khanh-va-Binh-Tri-Thien-42792.aspx"),
    "tvpl_1991_08.html": _wb("20260114115927", TVPL + "Bo-may-hanh-chinh/Nghi-quyet-dieu-chinh-dia-gioi-hanh-chinh-mot-so-tinh-thanh-pho-truc-thuoc-Trung-uong-42808.aspx"),
    "tvpl_1991_12.html": _wb("20260106054001", TVPL + "Bo-may-hanh-chinh/Nghi-quyet-phan-vach-lai-dia-gioi-hanh-chinh-tinh-42812.aspx"),
    "tvpl_1996.html": _wb("20260109101738", TVPL + "bo-may-hanh-chinh/Nghi-quyet-chia-va-dieu-chinh-dia-gioi-hanh-chinh-tinh-40091.aspx"),
    "vbpl_2003.html": _wb("20260201070707", "https://vbpl.vn/bonoivu/Pages/vbpq-toanvan.aspx?ItemID=19397"),
    "tvpl_2008.html": _wb("20251217210546", TVPL + "Bat-dong-san/Nghi-quyet-15-2008-QH12-dieu-chinh-dia-gioi-hanh-chinh-thanh-pho-Ha-Noi-va-mot-so-tinh-co-lien-quan-68076.aspx"),
}
# file name → (Vietnamese Wikipedia revision, title)
WIKIPEDIA = {
    "wp_captinh.json": (75732571, "Đơn vị hành chính cấp tỉnh (Việt Nam)"),
    "wp_phancap.json": (75642140, "Phân cấp hành chính Việt Nam"),
    "wp_ha_dong.json": (75736995, "Hà Đông (quận)"),
    "wp_ha_son_binh.json": (75740278, "Hà Sơn Bình"),
    "wp_me_linh.json": (75740714, "Mê Linh (huyện)"),
    "wp_minh_hai.json": (75689793, "Minh Hải (tỉnh)"),
    "wp_cuu_long.json": (75703102, "Cửu Long (tỉnh)"),
}


def page_url(name: str) -> str:
    """The human-readable page of a source file (the card's link)."""
    if name in WIKISOURCE:
        return "https://vi.wikisource.org/w/index.php?oldid=" + str(WIKISOURCE[name][0])
    if name in WIKIPEDIA:
        return "https://vi.wikipedia.org/w/index.php?oldid=" + str(WIKIPEDIA[name][0])
    return OFFICIAL[name].replace("id_/", "/")


SOURCES = [
    dict(id="borders_legal", title="Resolutions on province-level boundaries, 1975–2008",
         publisher="National Assembly of Vietnam; texts from Wikisource (vi) and from thuvienphapluat.vn and vbpl.vn "
                   "(Ministry of Justice) via the Internet Archive",
         homepage="https://vi.wikisource.org/wiki/Chủ_đề:Văn_kiện_lập_pháp",
         license="Public domain (legal documents are not protected by copyright in Vietnam)",
         description="The National Assembly resolutions that merged, split or moved provinces: 27 Dec 1975 (northern "
                     "mergers), 15 Jan 1977 (Côn Đảo), 29 Dec 1978 (Hà Nội, Cao Lạng, Duyên Hải), 30 May 1979 (Vũng "
                     "Tàu – Côn Đảo), 28 Dec 1982 (Trường Sa), 30 Jun 1989, 12 Aug 1991, 26 Dec 1991, 6 Nov 1996, "
                     "22/2003/QH11 and 15/2008/QH12. Each lists the districts of the provinces it creates.",
         used_for=["Historical province boundaries"],
         files=[(_api("vi.wikisource.org", r), n) for n, (r, _) in WIKISOURCE.items()] + [(u, n) for n, u in OFFICIAL.items()]),
    dict(id="borders_wiki", title="Vietnamese Wikipedia: province-level units year by year",
         publisher="Wikipedia (Vietnamese), via the MediaWiki API",
         homepage="https://vi.wikipedia.org/wiki/Đơn_vị_hành_chính_cấp_tỉnh_(Việt_Nam)",
         license="CC BY-SA 4.0",
         description="The history section of “Đơn vị hành chính cấp tỉnh (Việt Nam)” (the number of province-level "
                     "units at the end of each year and the changes behind it, with references), “Phân cấp hành chính "
                     "Việt Nam” (the 1975–1976 mergers), and the pages of Hà Đông, Hà Sơn Bình, Mê Linh, Minh Hải and "
                     "Cửu Long for the district moves the resolutions above do not spell out. Each file is one revision.",
         used_for=["Historical province boundaries"],
         files=[(_api("vi.wikipedia.org", r), n) for n, (r, _) in WIKIPEDIA.items()]),
]
