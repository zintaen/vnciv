"""Read the "Airlines and destinations" tables of Wikipedia airport articles (English {{Airport-dest-list}}, Vietnamese
wikitables) into rows of (airline link, [(destination link, label, flags, note)]).

Flags come from the table's own markers: "Seasonal:", "Charter:", "Seasonal charter:" (en), "Theo mùa:", "Thuê
chuyến:" (vi). Notes are the bracketed text after a destination: "begins 15 January 2027", "(Đã ngừng)", "(*)".
"""
from __future__ import annotations

import datetime as dt
import json
import re

COMMENT = re.compile(r"<!--.*?-->", re.S)
REF = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.S | re.I)
LINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]")
FLAG = re.compile(r"(?i)\b(seasonal charter|seasonal|charter|theo mùa|thuê chuyến(?: theo mùa)?|mùa)\s*:")
HEAD = re.compile(r"^(=+)\s*(.*?)\s*=+\s*$", re.M)
VI_SECTION = re.compile(r"(?i)hãng hàng không|tuyến bay|đường bay|điểm đến")
VI_SKIP = re.compile(r"(?i)lịch sử|từng|ngừng|mở tuyến|đường bay vàng|hàng hóa")
MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                          "september", "october", "november", "december"])}


def revision(path):
    """(content, title, revid, timestamp) of a MediaWiki query?prop=revisions download."""
    p = json.loads(path.read_text())["query"]["pages"][0]
    r = p["revisions"][0]
    return r["slots"]["main"]["content"], p["title"], r["revid"], r["timestamp"]


def clean(s):
    s = REF.sub("", COMMENT.sub("", s))
    s = re.sub(r"\{\{\s*nowrap\s*\|", "{{", s, flags=re.I)  # {{nowrap|[[X]]}}: keep the link
    s = re.sub(r"\{\{\s*date\s*\|\s*([\d-]+)[^}]*\}\}", r"\1", s, flags=re.I)  # {{date|2026-11-1}} → 2026-11-1
    return re.sub(r"<br\s*/?>", ", ", s.replace("'''", "").replace("''", ""), flags=re.I)


def split_top(s, sep):
    """Split on sep outside [[…]], {{…}} and (…)."""
    out, cur, depth, i = [], [], 0, 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("[[", "{{", "]]", "}}"):
            depth += 1 if two in ("[[", "{{") else -1
            cur.append(two)
            i += 2
            continue
        c = s[i]
        depth += (c == "(") - (c == ")")
        if c == sep and depth <= 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    return out + ["".join(cur)]


def dest_items(s):
    """[(link target, label, flags, note)] of one destinations cell; flags hold from a marker to the next marker."""
    parts, flags, pos = [], "", 0
    for m in FLAG.finditer(s):
        parts.append((flags, s[pos:m.start()]))
        flags, pos = m.group(1).lower(), m.end()
    parts.append((flags, s[pos:]))
    items = []
    for fl, seg in parts:
        f = set()
        if re.search(r"seasonal|mùa", fl):
            f.add("seasonal")
        if re.search(r"charter|thuê chuyến", fl):
            f.add("charter")
        for piece in split_top(seg, ","):
            m = LINK.search(piece)
            if not m:
                continue
            note = " ".join(x.strip() for x in re.findall(r"\(([^)]*)\)", piece[m.end():]))
            items.append((m.group(1).strip(), (m.group(2) or m.group(1)).strip(), sorted(f), note))
    return items


def template_body(text):
    m = re.search(r"\{\{\s*airport[- ]dest(?:ination)?[- ]list", text, re.I)
    if not m:
        return None
    i, depth = m.start(), 0
    while i < len(text):
        if text.startswith("{{", i) or text.startswith("}}", i):
            depth += 1 if text[i] == "{" else -1
            i += 2
            if depth == 0:
                return text[m.end():i - 2]
            continue
        i += 1
    return None


def en_rows(text):
    body = template_body(clean(text))
    if body is None:
        return []
    cells = [c.strip() for c in split_top(body, "|")][1:]
    cells = [c for c in cells if not re.match(r"^\w+\s*=", c)]  # named parameters (3rdcoltitle=…)
    rows = []
    for airline, dests in zip(cells[0::2], cells[1::2]):
        al = LINK.search(airline)
        if al:
            rows.append((al.group(1).strip(), dest_items(dests)))
    return rows


def vi_section(text):
    """The text of the airlines-and-destinations section, minus history / former-airline / cargo subsections."""
    heads = list(HEAD.finditer(text))
    for k, h in enumerate(heads):
        if VI_SECTION.search(h.group(2)) and not VI_SKIP.search(h.group(2)):
            level, out, skip = len(h.group(1)), [], None
            for j in range(k, len(heads)):
                hj = heads[j]
                if j > k and len(hj.group(1)) <= level:
                    break
                lv = len(hj.group(1))
                if skip is not None and lv <= skip:
                    skip = None
                if j > k and skip is None and VI_SKIP.search(hj.group(2)):
                    skip = lv
                end = heads[j + 1].start() if j + 1 < len(heads) else len(text)
                if skip is None:
                    out.append(text[hj.end():end])
            return "\n".join(out)
    return ""


def vi_rows(text):
    sec = clean(vi_section(text))
    rows = []
    for table in re.findall(r"\{\|(.*?)(?:\n\|\}|\Z)", sec, re.S):  # an unclosed table runs to the section end
        for row in re.split(r"\n\|-[^\n]*", table)[1:]:
            cells = []
            for line in row.strip().split("\n"):
                if line.startswith("|") and not line.startswith("|}"):
                    cells += [split_top(c, "|")[-1].strip() for c in line[1:].split("||")]
            al = LINK.search(cells[0]) if cells else None
            if al and len(cells) > 1:
                rows.append((al.group(1).strip(), dest_items(", ".join(cells[1:]))))
    return rows


def parse_date(s):
    """The first date in a note: 2026-11-1, 15 January 2027, January 2027, 31/03/2025; else None."""
    if m := re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s):
        return dt.date(int(m[1]), int(m[2]), int(m[3]))
    if m := re.search(r"(?:(\d{1,2}) )?([A-Za-z]+) (\d{4})", s):
        if m[2].lower() in MONTHS:
            return dt.date(int(m[3]), MONTHS[m[2].lower()], int(m[1] or 1))
    if m := re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", s):
        return dt.date(int(m[3]), int(m[2]), int(m[1]))
    return None


def status(note, today):
    """listed | future (begins/resumes after `today`) | ended (ended, stopped or suspended)."""
    n = note.lower()
    d = parse_date(note)
    if re.search(r"begins|resumes|\btừ\b|bắt đầu|khai trương", n) and (d is None or d > today):
        return "future"
    if re.search(r"ngừng|dừng|ngưng|suspended|terminated|ended", n) or (re.search(r"\bends\b|đến hết", n) and d and d <= today):
        return "ended"
    return "listed"
