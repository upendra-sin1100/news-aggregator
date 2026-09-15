from fastapi import FastAPI, Query, HTTPException
from .feed import edition, fetch_rss
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .reader import read_article
import os
from typing import Optional
import requests
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))


# ── ENV ──────────────────────────────────────────────────────────────────────
NEWSAPI_KEY  = os.getenv("NEWSAPI_KEY") or os.getenv("NEWS_API_KEY", "")
GNEWS_KEY    = os.getenv("GNEWS_KEY", "")
PAGE_SIZE = 20
REQUEST_TIMEOUT_SECONDS = 5

DEFAULT_REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}

# Reddit blocks generic browser User-Agents for unauthenticated JSON requests
REDDIT_HEADERS = {
    "User-Agent": "UpFeed_App/1.0 (by /u/UpFeed)",
    "Accept": "application/json",
}

# ── CATEGORY MAP ─────────────────────────────────────────────────────────────
# Maps frontend slug → (newsapi_category, gnews_topic, reddit_subreddit, newsapi_q)
# newsapi_q is an optional keyword query for categories not natively in NewsAPI
CATEGORY_MAP = {
    "technology":    ("technology",  "technology",    "technology",      None),
    "world":         ("general",     "world",         "worldnews",       None),
    "science":       ("science",     "science",       "science",         None),
    "business":      ("business",    "business",      "business",        None),
    "health":        ("health",      "health",        "health",          None),
    "sports":        ("sports",      "sports",        "sports",          None),
    "entertainment": ("entertainment","entertainment", "entertainment",   None),
    "politics":      ("general",     "nation",        "politics",        None),
    # ── New categories ──
    "india":         ("general",     "nation",        "indianews",       "india"),
    # Keep search keywords simple to prevent HTTP 400 on Free-Tier News APIs
    "stock-market":  ("business",    "business",      "StockMarket",     "stock market"),
    "gaming":        ("technology",  "technology",    "Games",           "gaming"),
    "environment":   ("science",     "science",       "environment",     "environment"),
    "cryptocurrency":("business",    "business",      "CryptoMarkets",   "cryptocurrency"),
    "automobile":    ("general",     "world",         "cars",            "automobile"),
}

CATEGORY_ALIASES = {
    "crypto": "cryptocurrency",
    "stockmarket": "stock-market",
}


def _normalize_category(category: str) -> str:
    return CATEGORY_ALIASES.get(category, category)

# ── FASTAPI ───────────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://up-feed.vercel.app",
        "https://upfeed.onrender.com",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "UpFeed API is running!"}

# ── NEWS FETCHERS ─────────────────────────────────────────────────────────────

def _fetch_newsapi(category: str, page: int = 1, page_size: int = PAGE_SIZE):
    """Fetch from NewsAPI.org — best quality, 100 req/day free."""
    if not NEWSAPI_KEY:
        return []
    category = _normalize_category(category)
    cat_tuple = CATEGORY_MAP.get(category, ("general", "world", "worldnews", None))
    newsapi_cat = cat_tuple[0]
    keyword_q   = cat_tuple[3] if len(cat_tuple) > 3 else None

    try:
        if keyword_q:
            # Use /everything for keyword-based categories
            url = (
                f"https://newsapi.org/v2/everything"
                f"?q={requests.utils.quote(keyword_q)}&language=en"
                f"&sortBy=publishedAt&pageSize={page_size}&page={page}"
                f"&apiKey={NEWSAPI_KEY}"
            )
        else:
            url = (
                f"https://newsapi.org/v2/top-headlines"
                f"?category={newsapi_cat}&language=en&pageSize={page_size}&page={page}"
                f"&apiKey={NEWSAPI_KEY}"
            )
        r = requests.get(url, headers=DEFAULT_REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        data = r.json()
        articles = []
        for a in data.get("articles", []):
            if not a.get("url") or a.get("title") == "[Removed]":
                continue
            articles.append({
                "id": a.get("url"),
                "title": a.get("title", ""),
                "url": a.get("url", ""),
                "image_url": a.get("urlToImage"),
                "source": a.get("source", {}).get("name", "NewsAPI"),
                "description": a.get("description", ""),
                "published_at": a.get("publishedAt", ""),
                "score": 0,
            })

        if not articles and keyword_q:
            fallback_url = (
                f"https://newsapi.org/v2/top-headlines"
                f"?category={newsapi_cat}&language=en&pageSize={page_size}&page={page}"
                f"&apiKey={NEWSAPI_KEY}"
            )
            r = requests.get(fallback_url, headers=DEFAULT_REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
            data = r.json()
            for a in data.get("articles", []):
                if not a.get("url") or a.get("title") == "[Removed]":
                    continue
                articles.append({
                    "id": a.get("url"),
                    "title": a.get("title", ""),
                    "url": a.get("url", ""),
                    "image_url": a.get("urlToImage"),
                    "source": a.get("source", {}).get("name", "NewsAPI"),
                    "description": a.get("description", ""),
                    "published_at": a.get("publishedAt", ""),
                    "score": 0,
                })
        return articles
    except Exception as e:
        print(f"NewsAPI error: {e}")
        return []


def _fetch_gnews(category: str, page: int = 1):
    """Fetch from GNews — 100 req/day free, good variety."""
    if not GNEWS_KEY:
        return []
    category = _normalize_category(category)
    cat_tuple  = CATEGORY_MAP.get(category, ("general", "world", "worldnews", None))
    gnews_topic = cat_tuple[1]
    keyword_q   = cat_tuple[3] if len(cat_tuple) > 3 else None

    try:
        if keyword_q:
            url = (
                f"https://gnews.io/api/v4/search"
                f"?q={requests.utils.quote(keyword_q)}&lang=en&max=10&page={page}"
                f"&token={GNEWS_KEY}"
            )
        else:
            url = (
                f"https://gnews.io/api/v4/top-headlines"
                f"?topic={gnews_topic}&lang=en&max=10&page={page}"
                f"&token={GNEWS_KEY}"
            )
        r = requests.get(url, headers=DEFAULT_REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        data = r.json()
        articles = []
        for a in data.get("articles", []):
            if not a.get("url"):
                continue
            articles.append({
                "id": a.get("url"),
                "title": a.get("title", ""),
                "url": a.get("url", ""),
                "image_url": a.get("image"),
                "source": a.get("source", {}).get("name", "GNews"),
                "description": a.get("description", ""),
                "published_at": a.get("publishedAt", ""),
                "score": 0,
            })

        if not articles and keyword_q:
            fallback_url = (
                f"https://gnews.io/api/v4/top-headlines"
                f"?topic={gnews_topic}&lang=en&max=10&page={page}"
                f"&token={GNEWS_KEY}"
            )
            r = requests.get(fallback_url, headers=DEFAULT_REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
            data = r.json()
            for a in data.get("articles", []):
                if not a.get("url"):
                    continue
                articles.append({
                    "id": a.get("url"),
                    "title": a.get("title", ""),
                    "url": a.get("url", ""),
                    "image_url": a.get("image"),
                    "source": a.get("source", {}).get("name", "GNews"),
                    "description": a.get("description", ""),
                    "published_at": a.get("publishedAt", ""),
                    "score": 0,
                })
        return articles
    except Exception as e:
        print(f"GNews error: {e}")
        return []


def _fetch_reddit(category: str, sort: str = "hot", limit: int = PAGE_SIZE, after: str = None):
    """Reddit fallback — always free, no key needed."""
    category = _normalize_category(category)
    cat_tuple  = CATEGORY_MAP.get(category, ("general", "world", "worldnews", None))
    subreddit  = cat_tuple[2]
    sort_map   = {"hot": "hot", "top": "top", "trending": "rising", "latest": "new"}
    reddit_sort = sort_map.get(sort, "hot")
    url = f"https://www.reddit.com/r/{subreddit}/{reddit_sort}.json?limit=100"
    if after:
        url += f"&after={after}"
    try:
        r = requests.get(url, headers=REDDIT_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        data = r.json()
        raw = data.get("data", {})
        articles = []
        for post in raw.get("children", []):
            if len(articles) >= limit:
                break
            s = post.get("data", {})
            article_url = s.get("url")
            # Include discussion/text posts if they lack an external link. Fallback to permalink.
            if not article_url or s.get("is_self"):
                article_url = f"https://www.reddit.com{s.get('permalink', '')}"
            image_url = None
            try:
                if "preview" in s and s["preview"].get("images"):
                    image_url = s["preview"]["images"][0]["source"]["url"].replace("&amp;", "&")
            except Exception:
                pass
            thumb = s.get("thumbnail")
            if not image_url and thumb and thumb.startswith("http"):
                image_url = thumb
            articles.append({
                "id": s.get("id"),
                "title": s.get("title", ""),
                "url": article_url,
                "image_url": image_url,
                "source": f"r/{subreddit}",
                "description": s.get("selftext", "")[:200],
                "published_at": datetime.fromtimestamp(s.get("created_utc", 0), tz=timezone.utc).isoformat(),
                "score": s.get("score", 0),
            })
        return articles, raw.get("after")
    except Exception as e:
        print(f"Reddit error: {e}")
        return [], None


def _fetch_fresh(category: str, sort: str = "hot", page: int = 1) -> list:
    """Fetch from all sources, merge, deduplicate."""
    seen_urls = set()
    merged = []

    def add(articles):
        for a in articles:
            key = a.get("url") or a.get("id")
            if key and key not in seen_urls:
                seen_urls.add(key)
                merged.append(a)

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(_fetch_newsapi, category, page, 100),
            executor.submit(_fetch_gnews, category, page),
            executor.submit(_fetch_reddit, category, sort, 100, None),
            executor.submit(fetch_rss, category.replace("-", " ")),
        ]

        for future in futures:
            result = future.result()
            if isinstance(result, tuple):
                articles = result[0]
            else:
                articles = result
            add(articles)

    return merged


# ── NEWS ENDPOINT ─────────────────────────────────────────────────────────────

@app.get("/api/news/{category}")
def get_news(
    category: str,
    sort: str = Query(default="latest", pattern="^(latest|hot|trending|top)$"),
    refresh: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    after: Optional[str] = Query(default=None, max_length=64),
):
    category = _normalize_category(category)
    if category not in CATEGORY_MAP:
        raise HTTPException(404, f"Unknown category: {category}")
    return edition(f"news:{category}:{sort}", lambda: _fetch_fresh(category, sort),
        page, limit, after, refresh, latest=sort == "latest")


@app.get("/api/search")
def search_news(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    page: int = Query(default=1, ge=1),
    after: Optional[str] = Query(default=None, max_length=64),
):
    q = q.strip()
    if not q:
        raise HTTPException(422, "Enter a search term.")
    return edition(f"search:{q.casefold()}", lambda: _search_sources(q),
        page, limit, after, latest=True, allow_empty=True)


def _search_sources(q: str, limit: int = 100, page: int = 1):
    seen_urls = set()
    results = []

    def add(articles):
        for a in articles:
            key = a.get("url") or a.get("id")
            if key and key not in seen_urls:
                seen_urls.add(key)
                results.append(a)

    if NEWSAPI_KEY:
        try:
            url = (
                f"https://newsapi.org/v2/everything"
                f"?q={requests.utils.quote(q)}&language=en&sortBy=relevancy"
                f"&pageSize={limit}&page={page}"
                f"&apiKey={NEWSAPI_KEY}"
            )
            r = requests.get(url, headers=DEFAULT_REQUEST_HEADERS, timeout=10)
            data = r.json()
            for a in data.get("articles", []):
                if not a.get("url") or a.get("title") == "[Removed]":
                    continue
                add([{
                    "id": a.get("url"),
                    "title": a.get("title", ""),
                    "url": a.get("url", ""),
                    "image_url": a.get("urlToImage"),
                    "source": a.get("source", {}).get("name", "NewsAPI"),
                    "description": a.get("description", ""),
                    "published_at": a.get("publishedAt", ""),
                    "score": 0,
                }])
        except Exception as e:
            print(f"NewsAPI search error: {e}")

    if GNEWS_KEY:
        try:
            url = (
                f"https://gnews.io/api/v4/search"
                f"?q={requests.utils.quote(q)}&lang=en&max=10"
                f"&token={GNEWS_KEY}"
            )
            r = requests.get(url, headers=DEFAULT_REQUEST_HEADERS, timeout=10)
            data = r.json()
            for a in data.get("articles", []):
                add([{
                    "id": a.get("url"),
                    "title": a.get("title", ""),
                    "url": a.get("url", ""),
                    "image_url": a.get("image"),
                    "source": a.get("source", {}).get("name", "GNews"),
                    "description": a.get("description", ""),
                    "published_at": a.get("publishedAt", ""),
                    "score": 0,
                }])
        except Exception as e:
            print(f"GNews search error: {e}")

    try:
        url = f"https://www.reddit.com/search.json?q={requests.utils.quote(q)}&sort=new&limit=100&type=link"
        r = requests.get(url, headers=REDDIT_HEADERS, timeout=10)
        data = r.json()
        for post in data.get("data", {}).get("children", []):
            s = post.get("data", {})
            if s.get("is_self") or not s.get("url"):
                continue
            image_url = None
            try:
                if "preview" in s and s["preview"].get("images"):
                    image_url = s["preview"]["images"][0]["source"]["url"].replace("&amp;", "&")
            except Exception:
                pass
            add([{
                "id": s.get("id"),
                "title": s.get("title", ""),
                "url": s.get("url"),
                "image_url": image_url,
                "source": f"r/{s.get('subreddit', '')}",
                "description": "",
                "published_at": datetime.fromtimestamp(s.get("created_utc", 0), tz=timezone.utc).isoformat(),
                "score": s.get("score", 0),
            }])
    except Exception as e:
        print(f"Reddit search error: {e}")

    add(fetch_rss(q, search=True))
    return results


# ── ARTICLE READER ────────────────────────────────────────────────────────────

class ArticleRequest(BaseModel):
    url: str

@app.post("/api/read")
def read_and_summarize(req: ArticleRequest):
    try:
        return {"status": "success", "data": read_article(req.url)}
    except (ValueError, requests.RequestException, OSError):
        return {"status": "error", "message": "This publisher could not be loaded. Open the original article to continue reading."}


@app.get("/api/article-preview")
def article_preview(url: str = Query(..., max_length=4096)):
    try:
        data = read_article(url)
        return {"status": "success", "data": {"image_url": data["image_url"]}}
    except (ValueError, requests.RequestException, OSError):
        return {"status": "success", "data": {"image_url": None}}


from .saved import router as saved_router
app.include_router(saved_router)
