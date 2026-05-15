from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from newspaper import Article
import os
from typing import Any, Optional
import requests
import nltk
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

import json

LOCAL_BOOKMARKS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bookmarks.json')
LOCAL_COLLECTIONS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'collections.json')

def _load_local_bookmarks():
    try:
        if not os.path.exists(LOCAL_BOOKMARKS_FILE):
            return []
        with open(LOCAL_BOOKMARKS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def _save_local_bookmarks(items):
    try:
        with open(LOCAL_BOOKMARKS_FILE, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False

def _load_local_collections():
    try:
        if not os.path.exists(LOCAL_COLLECTIONS_FILE):
            return []
        with open(LOCAL_COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def _save_local_collections(items):
    try:
        with open(LOCAL_COLLECTIONS_FILE, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False

try:
    from supabase import create_client
except ImportError as e:
    print(f"⚠️  Supabase import failed: {e}")
    create_client = None

for pkg in ("tokenizers/punkt", "corpora/stopwords"):
    try:
        nltk.data.find(pkg)
    except LookupError:
        nltk.download(pkg.split('/', 1)[1])

supabase_url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
supabase_key = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
)
supabase: Any = create_client(supabase_url, supabase_key) if create_client and supabase_url and supabase_key else None

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
    return {"message": "UpFeed API is running perfectly!"}


# --- 1. FEED ENDPOINT with Infinite Scroll + Trending Sort ---
@app.get("/api/news/{genre}")
def get_news(
    genre: str,
    limit: int = Query(default=15, ge=1, le=50),
    after: Optional[str] = Query(default=None),   # Reddit "after" cursor for pagination
    sort: str = Query(default="hot"),              # hot | top | trending (top == trending)
):
    # Reddit sort: hot, top, rising — "trending" maps to "rising"
    sort_map = {"hot": "hot", "top": "top", "trending": "rising"}
    reddit_sort = sort_map.get(sort, "hot")

    url = f"https://www.reddit.com/r/{genre}/{reddit_sort}.json?limit={limit}"
    if after:
        url += f"&after={after}"

    headers = {"User-Agent": "UpFeedApp/1.0"}

    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        return {"status": "error", "message": "Failed to fetch from Reddit"}

    data = response.json()
    raw_data = data.get('data', {})
    news_list = []

    for post in raw_data.get('children', []):
        submission = post.get('data', {})

        if submission.get('is_self'):
            continue

        actual_article_url = submission.get('url')
        image_url = None

        try:
            if 'preview' in submission and submission['preview'].get('images'):
                image_url = submission['preview']['images'][0]['source']['url'].replace('&amp;', '&')
        except Exception:
            image_url = None

        thumb = submission.get('thumbnail')
        if not image_url and thumb and thumb.startswith('http'):
            image_url = thumb

        if not actual_article_url:
            continue

        news_list.append({
            "id": submission.get('id'),
            "title": submission.get('title'),
            "url": actual_article_url,
            "image_url": image_url,
            "source": f"r/{genre}",
            "score": submission.get('score', 0),
            "num_comments": submission.get('num_comments', 0),
            "created_utc": submission.get('created_utc', 0),
        })

    # Deduplicate by id (Reddit can return the same post across pages)
    seen_ids: set = set()
    unique_list = []
    for item in news_list:
        key = item.get('id') or item.get('url')
        if key and key not in seen_ids:
            seen_ids.add(key)
            unique_list.append(item)

    # Next cursor for infinite scroll
    next_after = raw_data.get('after')

    return {
        "status": "success",
        "data": unique_list,
        "next_after": next_after,
        "has_more": next_after is not None,
    }


# --- 2. SEARCH ENDPOINT ---
@app.get("/api/search")
def search_reddit(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=15, ge=1, le=50),
    after: Optional[str] = Query(default=None),
):
    url = f"https://www.reddit.com/search.json?q={requests.utils.quote(q)}&sort=relevance&limit={limit}&type=link"
    if after:
        url += f"&after={after}"

    headers = {"User-Agent": "UpFeedApp/1.0"}
    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        return {"status": "error", "message": "Failed to search Reddit"}

    data = response.json()
    raw_data = data.get('data', {})
    results = []

    for post in raw_data.get('children', []):
        submission = post.get('data', {})
        if submission.get('is_self'):
            continue

        actual_url = submission.get('url')
        if not actual_url:
            continue

        image_url = None
        try:
            if 'preview' in submission and submission['preview'].get('images'):
                image_url = submission['preview']['images'][0]['source']['url'].replace('&amp;', '&')
        except Exception:
            pass

        thumb = submission.get('thumbnail')
        if not image_url and thumb and thumb.startswith('http'):
            image_url = thumb

        results.append({
            "id": submission.get('id'),
            "title": submission.get('title'),
            "url": actual_url,
            "image_url": image_url,
            "source": f"r/{submission.get('subreddit', '')}",
            "score": submission.get('score', 0),
            "num_comments": submission.get('num_comments', 0),
            "created_utc": submission.get('created_utc', 0),
        })

    return {
        "status": "success",
        "data": results,
        "next_after": raw_data.get('after'),
        "has_more": raw_data.get('after') is not None,
    }


# --- 3. ARTICLE EXTRACTION & SUMMARY ---
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
            free_summary = None

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


# --- 4. BOOKMARKS ---
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
            items = _load_local_bookmarks()
            if collection_id is not None:
                items = [i for i in items if i.get('collection_id') == collection_id]
            return {"status": "success", "data": items}

        query = supabase.table('bookmarks').select('*')
        if collection_id is not None:
            query = query.eq('collection_id', collection_id)
        response = query.execute()
        return {"status": "success", "data": response.data}

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/bookmarks")
def create_bookmark(req: BookmarkRequest):
    try:
        payload = {
            "title": req.title,
            "url": req.url,
            "image_url": req.image_url,
            "ai_summary": req.ai_summary,
            "collection_id": req.collection_id,
        }

        if supabase is None:
            items = _load_local_bookmarks()
            next_id = 1 + max((item.get('id') or 0) for item in items) if items else 1
            item = {"id": next_id, **payload}
            items.append(item)
            ok = _save_local_bookmarks(items)
            if not ok:
                return {"status": "error", "message": "Failed to write local bookmarks file."}
            return {"status": "success", "data": item}

        response = supabase.table('bookmarks').insert(payload).execute()
        err = getattr(response, 'error', None)
        if err:
            return {"status": "error", "message": str(err)}
        return {"status": "success", "data": response.data}

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.delete("/api/bookmarks/{bookmark_id}")
def delete_bookmark(bookmark_id: int):
    try:
        if supabase is None:
            items = _load_local_bookmarks()
            remaining = [it for it in items if int(it.get('id', 0)) != int(bookmark_id)]
            if len(remaining) == len(items):
                return {"status": "error", "message": "Bookmark not found."}
            ok = _save_local_bookmarks(remaining)
            if not ok:
                return {"status": "error", "message": "Failed to write local bookmarks file."}
            return {"status": "success", "data": {"deleted": int(bookmark_id)}}

        response = supabase.table('bookmarks').delete().eq('id', bookmark_id).execute()
        err = getattr(response, 'error', None)
        if err:
            return {"status": "error", "message": str(err)}
        return {"status": "success", "data": response.data}

    except Exception as e:
        return {"status": "error", "message": str(e)}


# --- 5. COLLECTIONS / FOLDERS ---
class CollectionRequest(BaseModel):
    name: str
    color: str | None = "#c4451e"


@app.get("/api/collections")
def get_collections():
    try:
        if supabase is None:
            items = _load_local_collections()
            return {"status": "success", "data": items}

        response = supabase.table('collections').select('*').execute()
        return {"status": "success", "data": response.data}

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/collections")
def create_collection(req: CollectionRequest):
    try:
        payload = {"name": req.name, "color": req.color}

        if supabase is None:
            items = _load_local_collections()
            next_id = 1 + max((item.get('id') or 0) for item in items) if items else 1
            item = {"id": next_id, **payload}
            items.append(item)
            ok = _save_local_collections(items)
            if not ok:
                return {"status": "error", "message": "Failed to write local collections file."}
            return {"status": "success", "data": item}

        response = supabase.table('collections').insert(payload).execute()
        err = getattr(response, 'error', None)
        if err:
            return {"status": "error", "message": str(err)}
        return {"status": "success", "data": response.data}

    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.delete("/api/collections/{collection_id}")
def delete_collection(collection_id: int):
    try:
        if supabase is None:
            items = _load_local_collections()
            remaining = [it for it in items if int(it.get('id', 0)) != int(collection_id)]
            if len(remaining) == len(items):
                return {"status": "error", "message": "Collection not found."}
            _save_local_collections(remaining)
            return {"status": "success", "data": {"deleted": int(collection_id)}}

        response = supabase.table('collections').delete().eq('id', collection_id).execute()
        err = getattr(response, 'error', None)
        if err:
            return {"status": "error", "message": str(err)}
        return {"status": "success", "data": response.data}

    except Exception as e:
        return {"status": "error", "message": str(e)}