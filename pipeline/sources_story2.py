"""Sources of the story2 stream: the Wikipedia articles cited by web/data/history.json.

data/stats/history/articles.json lists them ({raw file: {lang, title}}); each is fetched through the MediaWiki API
with its plain-text extract, coordinates and current revision id, so every event cites the revision it was checked
against. `fetch_article` adds one (several helpers may run at once: the list and the manifest are locked).
"""
from __future__ import annotations

import fcntl
import json
import pathlib
import time
import urllib.error
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTICLES = ROOT / "data" / "stats" / "history" / "articles.json"
SOURCE = "wikipedia_events"
WEB = ROOT / "data" / "stats" / "history" / "web.json"  # {raw file: url}: official pages cited where Wikipedia is not enough
WEB_SOURCE = "history_web"


def api_url(lang: str, title: str) -> str:
    return (f"https://{lang}.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates|revisions&rvprop=ids|timestamp"
            f"&explaintext=1&redirects=1&titles={urllib.parse.quote(title.replace(' ', '_'), safe='()')}&format=json&formatversion=2")


def _articles():
    return json.loads(ARTICLES.read_text(encoding="utf-8")) if ARTICLES.exists() else {}


def fetch_article(name: str, lang: str, title: str):
    """Register and download one article (cached); returns the page dict of the API response."""
    from . import fetch
    lock = open(ARTICLES.with_suffix(".lock"), "w")
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        arts = _articles()
        old = arts.get(name)
        assert old in (None, {"lang": lang, "title": title}), f"{name} is already {old}"
        for k in range(6):  # Wikipedia answers 429 to bursts: back off (downloads are serialised by the lock)
            try:
                p = fetch.download(SOURCE, api_url(lang, title), name)
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or k == 5:
                    raise
                time.sleep(5 * 2 ** k)
        page = json.loads(p.read_text(encoding="utf-8"))["query"]["pages"][0]
        assert not page.get("missing"), f"{lang}:{title} does not exist"
        arts[name] = {"lang": lang, "title": title}
        ARTICLES.write_text(json.dumps(dict(sorted(arts.items())), ensure_ascii=False, indent=1), encoding="utf-8")
        return page
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)


SOURCES = [
    dict(id=SOURCE, title="Wikipedia articles cited by the History list",
         publisher="Wikipedia (English and Vietnamese), via the MediaWiki API", homepage="https://www.wikipedia.org/",
         license="CC BY-SA 4.0",
         description="Plain-text extracts, coordinates and revision ids of the articles cited by the History list "
         "(web/data/history.json): dynasties and capitals, the modern era, every change to the province map, "
         "railways, bridges, expressways, airports and ports, disasters, UNESCO heritage, economic integration, science "
         "and sport. Each event keeps the sentence of the article that states its date, and the revision it was checked "
         "against; dates before about 1000 CE follow tradition and chronicles.",
         used_for=["History list and timeline events", "Story chapters (related events)"],
         files=[(api_url(a["lang"], a["title"]), name) for name, a in _articles().items()]),
    dict(id=WEB_SOURCE, title="Official notices cited by the History list",
         publisher="Government of Vietnam (xaydungchinhsach.chinhphu.vn); National Assembly newspaper (daibieunhandan.vn)",
         homepage="https://xaydungchinhsach.chinhphu.vn/",
         license="No licence stated; official news, quoted with attribution",
         description="Pages announcing National Assembly Standing Committee resolutions on new wards (2026), cited by "
         "History events whose details are not yet on Wikipedia. Each event keeps the page's sentence that states them.",
         used_for=["History list and timeline events"],
         files=[(u, n) for n, u in json.loads(WEB.read_text(encoding="utf-8")).items()] if WEB.exists() else []),
]
