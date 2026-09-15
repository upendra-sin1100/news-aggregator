"""Short-lived, stable editions: scrolling never reshuffles a reader's feed."""
from collections import OrderedDict
from datetime import datetime, timezone
from threading import RLock
from time import monotonic
from uuid import uuid4
import re
from fastapi import HTTPException

FRESH_SECONDS = 300
EDITION_SECONDS = 1800
MAX_EDITIONS = 128
_editions = OrderedDict()
_lock = RLock()


from .publishers import fetch_publisher_feeds as fetch_rss


def edition(scope, fetcher, page=1, limit=20, after=None, refresh=False, latest=False, allow_empty=False):
    now = monotonic()
    with _lock:
        for key in list(_editions):
            if now - _editions[key]['created'] > EDITION_SECONDS:
                del _editions[key]
        if after:
            entry = _editions.get(after)
            if not entry or entry['scope'] != scope or entry['limit'] != limit:
                raise HTTPException(410, 'This edition expired. Refresh to load the latest stories.')
            token = after
            cached = True
        else:
            if page != 1:
                raise HTTPException(400, 'Pass next_after to continue this edition.')
            found = next(((k, v) for k, v in reversed(_editions.items())
                if v['scope'] == scope and v['limit'] == limit and now - v['created'] < FRESH_SECONDS), None)
            token, entry = found if found and not refresh else (None, None)
            cached = entry is not None
    if entry is None:
        articles = fetcher()
        seen_urls, seen_titles, unique = set(), set(), []
        for article in articles:
            url = article.get('url')
            title = re.sub(r'\W+', ' ', article.get('title', '').lower()).strip()
            if not url or not title or url in seen_urls or title in seen_titles:
                continue
            seen_urls.add(url)
            seen_titles.add(title)
            unique.append(article)
        if not unique and not allow_empty:
            raise HTTPException(503, 'News sources are temporarily unavailable. Please try again.')
        if latest:
            def timestamp(article):
                try:
                    return datetime.fromisoformat((article.get('published_at') or '').replace('Z', '+00:00')).timestamp()
                except (ValueError, TypeError):
                    return 0
            unique.sort(key=timestamp, reverse=True)
        token = uuid4().hex
        entry = dict(scope=scope, limit=limit, created=monotonic(), articles=unique,
            updated_at=datetime.now(timezone.utc).isoformat())
        with _lock:
            _editions[token] = entry
            while len(_editions) > MAX_EDITIONS:
                _editions.popitem(last=False)
    start = (page - 1) * limit
    more = start + limit < len(entry['articles'])
    return dict(status='success', data=entry['articles'][start:start + limit],
        has_more=more, next_page=page + 1 if more else None,
        next_after=token if more else None, from_cache=cached, updated_at=entry['updated_at'])
