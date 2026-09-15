"""Bounded publisher-page fetching and resilient article extraction."""
import ipaddress
import json
import re
import socket
from functools import lru_cache
from time import time
from urllib.parse import urljoin, urlsplit
import requests
from bs4 import BeautifulSoup
from newspaper import Article


def validate_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Please use a public article URL.')
    if parsed.port not in (None, 80, 443):
        raise ValueError('Please use a standard publisher URL.')
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Only public publisher pages are supported.')


def fetch_page(url):
    for _ in range(5):
        validate_url(url)
        with requests.get(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; UpFeed/1.0)',
                          'Accept': 'text/html,application/xhtml+xml'},
                          timeout=(4, 10), allow_redirects=False, stream=True) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers['Location'])
                continue
            response.raise_for_status()
            if 'html' not in response.headers.get('Content-Type', '').lower():
                raise ValueError('This link is not an article page.')
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 3_000_000:
                    raise ValueError('This page is too large for the reader.')
                chunks.append(chunk)
            return url, b''.join(chunks)
    raise ValueError('The publisher redirected too many times.')


def extract_page(url, html):
    soup = BeautifulSoup(html, 'html.parser')
    def meta(*names):
        for name in names:
            tag = soup.find('meta', attrs={'property': name}) or soup.find('meta', attrs={'name': name})
            if tag and tag.get('content'):
                return tag['content'].strip()
        return ''
    title = meta('og:title', 'twitter:title') or (soup.title.get_text(strip=True) if soup.title else '')
    image = meta('og:image', 'twitter:image', 'twitter:image:src')
    image = urljoin(url, image) if image else None
    if image and urlsplit(image).scheme not in ('http', 'https'):
        image = None
    description = meta('og:description', 'description', 'twitter:description')
    bodies = []
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get('articleBody'), str):
                bodies.append(value['articleBody'])
            for child in value.values():
                if isinstance(child, (list, dict)):
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    for script in soup.find_all('script', type='application/ld+json'):
        try:
            visit(json.loads(script.string or script.get_text()))
        except (ValueError, TypeError):
            pass
    text = max(bodies, key=len, default='')
    if len(text) < 200:
        try:
            article = Article(url, language='en')
            article.set_html(html)
            article.parse()
            if len(article.text or '') > len(text):
                text = article.text
            title = title or article.title
            image = image or article.top_image or None
        except Exception:
            pass
    if len(text) < 200:
        for tag in soup.select('script, style, nav, footer, header, aside, form'):
            tag.decompose()
        body = soup.find('article') or soup.find('main')
        if body:
            paragraphs = [p.get_text(' ', strip=True) for p in body.find_all('p')]
            fallback = '\n\n'.join(dict.fromkeys(p for p in paragraphs if len(p) > 40))
            if len(fallback) > len(text):
                text = fallback
    text = text.strip()
    # Never present consent or access-block pages as article content.
    blocked = re.search(r'access denied|just a moment|verify you are human|robot or human|consent required', title, re.I)
    if blocked:
        text = ''
    full = len(text) >= 200
    sentences = re.split(r'(?<=[.!?])\s+', text)
    summary = ' '.join(sentences[:3])[:1500] if full else None
    return dict(title=title, url=url, image_url=image, full_text=text if full else description,
        ai_summary=summary, content_status='full' if full else 'preview',
        message=None if full else 'This publisher does not provide the full article to the reader. You can continue on its website.')


@lru_cache(maxsize=64)
def _read(url, bucket):
    resolved, html = fetch_page(url)
    return extract_page(resolved, html)


def read_article(url):
    return dict(_read(url, int(time() // 600)))
