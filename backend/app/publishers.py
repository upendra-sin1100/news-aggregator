"""Direct publisher RSS links and media, without aggregator redirect pages."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from time import time
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree
from bs4 import BeautifulSoup
import requests

TOPICS = {
    'technology': ('technology', 'technology'),
    'world': ('world', 'world'),
    'india': ('world/asia/india', 'world/india'),
    'science': ('science_and_environment', 'science'),
    'business': ('business', 'business'),
    'health': ('health', 'society/health'),
    'sports': (None, 'sport'),
    'entertainment': ('entertainment_and_arts', 'culture'),
    'politics': ('politics', 'politics'),
    'stock-market': ('business', 'business/stock-markets'),
    'gaming': (None, 'games'),
    'environment': ('science_and_environment', 'environment'),
    'cryptocurrency': (None, 'technology/cryptocurrencies'),
    'automobile': (None, 'technology/motoring'),
}


def parse_feed(xml, feed_url):
    root = ElementTree.fromstring(xml)
    source = root.findtext('./channel/title') or urlsplit(feed_url).hostname
    articles = []
    for item in root.findall('./channel/item'):
        url, title = item.findtext('link'), item.findtext('title')
        if not url or not title:
            continue
        description = BeautifulSoup(item.findtext('description') or '', 'html.parser')
        candidates = []
        for node in item.iter():
            name = node.tag.rsplit('}', 1)[-1]
            if name in ('thumbnail', 'content', 'enclosure') and node.get('url'):
                if name == 'enclosure' and not node.get('type', '').startswith('image/'):
                    continue
                if node.get('type', '').startswith(('audio/', 'video/')):
                    continue
                try:
                    width = int(node.get('width', '0'))
                except ValueError:
                    width = 0
                candidates.append((width, node.get('url')))
        for img in description.find_all('img', src=True):
            candidates.append((0, img['src']))
        image = urljoin(url, max(candidates, key=lambda x: x[0])[1]) if candidates else None
        if image and urlsplit(image).scheme not in ('http', 'https'):
            image = None
        try:
            date = parsedate_to_datetime(item.findtext('pubDate'))
            published = date.replace(tzinfo=date.tzinfo or timezone.utc).isoformat()
        except (TypeError, ValueError):
            published = None
        articles.append(dict(id=url, url=url, title=title, source=source,
            description=description.get_text(' ', strip=True)[:800],
            image_url=image, published_at=published, score=0))
    return articles


@lru_cache(maxsize=96)
def _fetch(url, bucket):
    response = requests.get(url, timeout=8, headers={'User-Agent': 'UpFeed/1.0 RSS reader'})
    response.raise_for_status()
    return parse_feed(response.content, url)


def fetch_publisher_feeds(query, search=False):
    topic = query.replace(' ', '-')
    topics = list(TOPICS) if search else [topic if topic in TOPICS else 'world']
    urls = set()
    for key in topics:
        bbc, guardian = TOPICS[key]
        if bbc:
            urls.add(f'https://feeds.bbci.co.uk/news/{bbc}/rss.xml')
        urls.add(f'https://www.theguardian.com/{guardian}/rss')

    def fetch(url):
        try:
            return _fetch(url, int(time() // 300))
        except (requests.RequestException, ElementTree.ParseError):
            return []

    with ThreadPoolExecutor(max_workers=8) as executor:
        articles = [a for group in executor.map(fetch, sorted(urls)) for a in group]
    if search:
        terms = query.casefold().split()
        articles = [a for a in articles if all(term in (a['title'] + ' ' + a['description']).casefold() for term in terms)]
    return articles
