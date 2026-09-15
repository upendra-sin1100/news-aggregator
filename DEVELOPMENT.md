# Feed and frontend update

The feed opens in Latest order, using actual publication timestamps. NewsAPI,
GNews, Reddit, and direct publisher RSS contribute to a deduplicated edition. RSS
works without API keys. NewsAPI accepts either NEWSAPI_KEY or NEWS_API_KEY.
Upstream subscriptions may delay articles or limit results; the UI displays the
publisher's publication time instead of implying every story is breaking news.

## Scrolling and freshness

First requests create or reuse an edition cached for five minutes. Each response
returns at most 20 stories by default, plus `next_page` and `next_after`. Pass
both to continue, preserving the same category, sort, search, and limit:

```text
GET /api/news/technology?sort=latest&limit=20
GET /api/news/technology?sort=latest&limit=20&page=2&after=<next_after>
GET /api/search?q=space&limit=20
GET /api/search?q=space&limit=20&page=2&after=<next_after>
```

Scrolling stops when the available edition ends. Each edition includes the
initial provider batches (up to 100 NewsAPI, 100 Reddit, 10 GNews, and publisher RSS
stories before deduplication); it is not an unlimited historical archive.
Refresh creates a new edition without changing another reader's pages.
The frontend offers a refresh after five minutes instead of replacing stories
underneath someone reading. Requests are aborted on category or search changes.

Editions live in a bounded, process-local cache (128 editions, 30-minute lifetime).
Use one backend worker with the current configuration. A restart or expired
edition returns HTTP 410; choose Start fresh to recover. Before scaling across
workers or replicas, move editions into shared storage such as Redis. Source
failure returns HTTP 503 with retry controls. Empty searches remain valid.

## Local verification

Run the backend with `python backend/main.py`, or use the existing Uvicorn
command. The reader fetches the publisher page with timeouts and size limits, then tries
structured article data, Newspaper, and semantic article paragraphs. Summaries
are short extracts from the article and do not require NLTK downloads. Blocked
pages remain labelled previews with a link to the original article.

RSS fallback now uses direct BBC and Guardian feeds, including media thumbnails
and descriptions, rather than Google News redirect links. RSS search matches
terms in recent publisher titles and descriptions; it is not a full web search.
See the [Guardian feed documentation](https://www.theguardian.com/help/feeds).
Visible cards without a working image try cached publisher image metadata once.
Restart the backend and refresh the feed to discard older Google News editions.

```sh
cd backend
python -m unittest discover -s tests -v
cd ../frontend
npm run lint
npm run build
```

`frontend/check-browser.cjs` is an optional browser regression check. With
Playwright available and the frontend running at http://127.0.0.1:5173, run it
from the repository root. It uses mock stories to exercise pagination, retries,
category switching, submitted searches, themes, and mobile overflow. It writes
screenshots under `artifacts/`. Set PLAYWRIGHT_MODULE if Playwright is installed
outside the project, and BROWSER_CHANNEL to use an installed browser such as
`msedge` or `chrome`.
