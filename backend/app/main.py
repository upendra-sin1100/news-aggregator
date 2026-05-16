from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from newspaper import Article
import os
from typing import Any, Optional
import requests
import nltk
import json
import time
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

LOCAL_BOOKMARKS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bookmarks.json')
LOCAL_COLLECTIONS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'collections.json')

# ── ENV ──────────────────────────────────────────────────────────────────────
NEWSAPI_KEY  = os.getenv("NEWSAPI_KEY", "")
GNEWS_KEY    = os.getenv("GNEWS_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", "")
)

CACHE_TTL_SECONDS = 5 * 60 * 60  # 5 hours

# ── CATEGORY MAP ─────────────────────────────────────────────────────────────
# Maps frontend slug → (newsapi_category, gnews_topic, reddit_subreddit)
CATEGORY_MAP = {
    "technology":      ("technology",  "technology",  "technology"),
    "world":           ("general",     "world",       "worldnews"),
    "science":         ("science",     "science",     "science"),
    "business":        ("business",    "business",    "business"),
    "health":          ("health",      "health",      "health"),
    "sports":          ("sports",      "sports",      "sports"),
    "entertainment":   ("entertainment","entertainment","entertainment"),
    "politics":        ("general",     "nation",      "politics"),
}

# ── LOCAL HELPERS ─────────────────────────────────────────────────────────────
def _load_json(path):
    try:
        if not os.path.exists(path):
            return []
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def _save_json(path, items):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False

# ── SUPABASE ──────────────────────────────────────────────────────────────────
try:
    from supabase import create_client
except ImportError as e:
    print(f"⚠️  Supabase import failed: {e}")
    create_client = None

supabase: Any = (
    create_client(SUPABASE_URL, SUPABASE_KEY)
    if create_client and SUPABASE_URL and SUPABASE_KEY
    else None
)

# ── NLTK ──────────────────────────────────────────────────────────────────────
for pkg in ("tokenizers/punkt", "corpora/stopwords"):
    try:
        nltk.data.find(pkg)
    except LookupError:
        nltk.download(pkg.split('/', 1)[1])

# ── FASTAPI ───────────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "UpFeed API is running!"}

# ── NEWS FETCHERS ─────────────────────────────────────────────────────────────

def _fetch_newsapi(category: str, page: int = 1, page_size: int = 20):
    """Fetch from NewsAPI.org — best quality, 100 req/day free."""
    if not NEWSAPI_KEY:
        return []
    newsapi_cat = CATEGORY_MAP.get(category, ("general", "world", "worldnews"))[0]
    url = (
        f"https://newsapi.org/v2/top-headlines"
        f"?category={newsapi_cat}&language=en&pageSize={page_size}&page={page}"
        f"&apiKey={NEWSAPI_KEY}"
    )
    try:
        r = requests.get(url, timeout=10)
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
        return articles
    except Exception as e:
        print(f"NewsAPI error: {e}")
        return []


def _fetch_gnews(category: str, page: int = 1):
    """Fetch from GNews — 100 req/day free, good variety."""
    if not GNEWS_KEY:
        return []
    gnews_topic = CATEGORY_MAP.get(category, ("general", "world", "worldnews"))[1]
    url = (
        f"https://gnews.io/api/v4/top-headlines"
        f"?topic={gnews_topic}&lang=en&max=10&page={page}"
        f"&token={GNEWS_KEY}"
    )
    try:
        r = requests.get(url, timeout=10)
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
        return articles
    except Exception as e:
        print(f"GNews error: {e}")
        return []


def _fetch_reddit(category: str, sort: str = "hot", limit: int = 20, after: str = None):
    """Reddit fallback — always free, no key needed."""
    subreddit = CATEGORY_MAP.get(category, ("general", "world", "worldnews"))[2]
    sort_map = {"hot": "hot", "top": "top", "trending": "rising"}
    reddit_sort = sort_map.get(sort, "hot")
    url = f"https://www.reddit.com/r/{subreddit}/{reddit_sort}.json?limit={limit}"
    if after:
        url += f"&after={after}"
    headers = {"User-Agent": "UpFeedApp/1.0"}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        data = r.json()
        raw = data.get("data", {})
        articles = []
        for post in raw.get("children", []):
            s = post.get("data", {})
            if s.get("is_self"):
                continue
            article_url = s.get("url")
            if not article_url:
                continue
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


# ── SUPABASE CACHE HELPERS ────────────────────────────────────────────────────

def _cache_key(category: str, sort: str) -> str:
    return f"{category}_{sort}"


def _get_cached(category: str, sort: str):
    """Return cached articles if fresh, else None."""
    if supabase is None:
        return None
    try:
        key = _cache_key(category, sort)
        res = supabase.table("news_cache").select("*").eq("cache_key", key).execute()
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        cached_at = datetime.fromisoformat(row["cached_at"].replace("Z", "+00:00"))
        age = (datetime.now(tz=timezone.utc) - cached_at).total_seconds()
        if age > CACHE_TTL_SECONDS:
            return None
        return json.loads(row["articles_json"])
    except Exception as e:
        print(f"Cache read error: {e}")
        return None


def _set_cache(category: str, sort: str, articles: list):
    """Upsert articles into Supabase cache."""
    if supabase is None:
        return
    try:
        key = _cache_key(category, sort)
        payload = {
            "cache_key": key,
            "category": category,
            "sort": sort,
            "articles_json": json.dumps(articles),
            "cached_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        supabase.table("news_cache").upsert(payload, on_conflict="cache_key").execute()
    except Exception as e:
        print(f"Cache write error: {e}")


def _fetch_fresh(category: str, sort: str = "hot") -> list:
    """Fetch from all sources, merge, deduplicate."""
    seen_urls = set()
    merged = []

    def add(articles):
        for a in articles:
            key = a.get("url") or a.get("id")
            if key and key not in seen_urls:
                seen_urls.add(key)
                merged.append(a)

    # Primary: NewsAPI
    add(_fetch_newsapi(category, page_size=20))

    # Secondary: GNews (adds variety)
    add(_fetch_gnews(category))

    # Tertiary: Reddit (always works, fills gaps)
    reddit_articles, _ = _fetch_reddit(category, sort=sort, limit=20)
    add(reddit_articles)

    return merged


# ── NEWS ENDPOINT ─────────────────────────────────────────────────────────────

@app.get("/api/news/{category}")
def get_news(
    category: str,
    sort: str = Query(default="hot"),
    refresh: bool = Query(default=False),
    after: Optional[str] = Query(default=None),  # for Reddit pagination only
):
    if category not in CATEGORY_MAP:
        return {"status": "error", "message": f"Unknown category: {category}"}

    # Try cache first (skip if forced refresh or pagination)
    if not refresh and not after:
        cached = _get_cached(category, sort)
        if cached:
            return {
                "status": "success",
                "data": cached,
                "from_cache": True,
                "has_more": False,
                "next_after": None,
            }

    # Fetch fresh
    articles = _fetch_fresh(category, sort)

    # Save to cache
    if not after:
        _set_cache(category, sort, articles)

    return {
        "status": "success",
        "data": articles,
        "from_cache": False,
        "has_more": False,
        "next_after": None,
    }


# ── SEARCH ────────────────────────────────────────────────────────────────────

@app.get("/api/search")
def search_news(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
):
    seen_urls = set()
    results = []

    def add(articles):
        for a in articles:
            key = a.get("url") or a.get("id")
            if key and key not in seen_urls:
                seen_urls.add(key)
                results.append(a)

    # NewsAPI everything search
    if NEWSAPI_KEY:
        try:
            url = (
                f"https://newsapi.org/v2/everything"
                f"?q={requests.utils.quote(q)}&language=en&sortBy=relevancy&pageSize={limit}"
                f"&apiKey={NEWSAPI_KEY}"
            )
            r = requests.get(url, timeout=10)
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

    # GNews search
    if GNEWS_KEY:
        try:
            url = (
                f"https://gnews.io/api/v4/search"
                f"?q={requests.utils.quote(q)}&lang=en&max=10"
                f"&token={GNEWS_KEY}"
            )
            r = requests.get(url, timeout=10)
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

    # Reddit search fallback
    try:
        url = f"https://www.reddit.com/search.json?q={requests.utils.quote(q)}&sort=relevance&limit=15&type=link"
        r = requests.get(url, headers={"User-Agent": "UpFeedApp/1.0"}, timeout=10)
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

    return {"status": "success", "data": results}


# ── ARTICLE READER ────────────────────────────────────────────────────────────

class ArticleRequest(BaseModel):
    url: str

@app.post("/api/read")
def read_and_summarize(req: ArticleRequest):
    try:
        article = Article(req.url, language='en')
        try:
            article.download()
        except Exception:
            resp = requests.get(req.url, headers={"User-Agent": "UpFeedApp/1.0"}, timeout=10)
            resp.raise_for_status()
            article.set_html(resp.text)
        article.parse()
        clean_text = (article.text or "").strip()
        if not clean_text:
            return {"status": "error", "message": "Could not extract text from this site."}
        free_summary = None
        try:
            article.nlp()
            free_summary = getattr(article, 'summary', None)
        except Exception:
            pass
        return {
            "status": "success",
            "data": {
                "title": article.title,
                "full_text": clean_text,
                "ai_summary": free_summary,
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── BOOKMARKS ─────────────────────────────────────────────────────────────────

class BookmarkRequest(BaseModel):
    title: str
    url: str
    image_url: str | None = None
    ai_summary: str | None = None
    collection_id: int | None = None

@app.get("/api/bookmarks")
def get_bookmarks(collection_id: Optional[int] = Query(default=None)):
    try:
        if supabase is None:
            items = _load_json(LOCAL_BOOKMARKS_FILE)
            if collection_id is not None:
                items = [i for i in items if i.get('collection_id') == collection_id]
            return {"status": "success", "data": items}
        query = supabase.table('bookmarks').select('*')
        if collection_id is not None:
            query = query.eq('collection_id', collection_id)
        return {"status": "success", "data": query.execute().data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/bookmarks")
def create_bookmark(req: BookmarkRequest):
    try:
        payload = {"title": req.title, "url": req.url, "image_url": req.image_url,
                   "ai_summary": req.ai_summary, "collection_id": req.collection_id}
        if supabase is None:
            items = _load_json(LOCAL_BOOKMARKS_FILE)
            next_id = 1 + max((i.get('id') or 0) for i in items) if items else 1
            item = {"id": next_id, **payload}
            items.append(item)
            _save_json(LOCAL_BOOKMARKS_FILE, items)
            return {"status": "success", "data": item}
        res = supabase.table('bookmarks').insert(payload).execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.delete("/api/bookmarks/{bookmark_id}")
def delete_bookmark(bookmark_id: int):
    try:
        if supabase is None:
            items = _load_json(LOCAL_BOOKMARKS_FILE)
            remaining = [i for i in items if int(i.get('id', 0)) != bookmark_id]
            _save_json(LOCAL_BOOKMARKS_FILE, remaining)
            return {"status": "success"}
        supabase.table('bookmarks').delete().eq('id', bookmark_id).execute()
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── COLLECTIONS ───────────────────────────────────────────────────────────────

class CollectionRequest(BaseModel):
    name: str
    color: str | None = "#c4451e"

@app.get("/api/collections")
def get_collections():
    try:
        if supabase is None:
            return {"status": "success", "data": _load_json(LOCAL_COLLECTIONS_FILE)}
        return {"status": "success", "data": supabase.table('collections').select('*').execute().data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/collections")
def create_collection(req: CollectionRequest):
    try:
        payload = {"name": req.name, "color": req.color}
        if supabase is None:
            items = _load_json(LOCAL_COLLECTIONS_FILE)
            next_id = 1 + max((i.get('id') or 0) for i in items) if items else 1
            item = {"id": next_id, **payload}
            items.append(item)
            _save_json(LOCAL_COLLECTIONS_FILE, items)
            return {"status": "success", "data": item}
        res = supabase.table('collections').insert(payload).execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.delete("/api/collections/{collection_id}")
def delete_collection(collection_id: int):
    try:
        if supabase is None:
            items = _load_json(LOCAL_COLLECTIONS_FILE)
            remaining = [i for i in items if int(i.get('id', 0)) != collection_id]
            _save_json(LOCAL_COLLECTIONS_FILE, remaining)
            return {"status": "success"}
        supabase.table('collections').delete().eq('id', collection_id).execute()
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}