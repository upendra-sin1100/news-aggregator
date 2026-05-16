# UpFeed – AI-Powered News Aggregator

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen.svg)](https://up-feed.vercel.app/)

A full-stack news aggregation and reading app that pulls trending stories from Reddit, extracts & summarizes articles, and lets users save bookmarks to collections.

**Live deployment:** [https://up-feed.vercel.app/](https://up-feed.vercel.app/)

## Features

- 📰 **Multi-genre feed** – Tech, Science, AI/ML, World News with hot/trending/top sorting
- 🔍 **Search** – Find articles across Reddit with infinite scroll
- 💾 **Bookmarks & Collections** – Save articles to custom collections with color tags
- 🤖 **AI Summarization** – Extract article text and auto-summarize using NLTK
- 🎙️ **Text-to-Speech** – Listen to summaries and articles
- 📱 **Responsive UI** – Works on desktop and mobile (Capacitor support)
- 🌙 **Dark Mode** – Built-in theme toggle
- 💾 **Fallback Storage** – Local JSON storage if Supabase unavailable

## Architecture

```
├── backend/                  # FastAPI server
│   ├── app/
│   │   ├── main.py          # API endpoints
│   │   ├── database.py       # Supabase client
│   │   └── models.py         # Pydantic models
│   ├── bookmarks.json        # Local backup storage
│   ├── collections.json      # Local backup storage
│   ├── requirements.txt      # Python dependencies
│   └── .env                  # Backend config
├── frontend/                 # React + Vite app
│   ├── src/
│   │   ├── App.jsx           # Main component
│   │   ├── App.css           # Styling
│   │   ├── lib/
│   │   │   └── supabase.js   # Supabase client initializer
│   │   ├── main.jsx          # Entry point
│   │   └── index.css         # Global styles
│   ├── package.json          # Node dependencies
│   ├── vite.config.js        # Vite config
│   └── .env                  # Frontend config
└── docker-compose.yml        # Docker setup
```

## Prerequisites

- **Node.js 18+** (frontend)
- **Python 3.10+** (backend)
- **Supabase account** (optional; app falls back to local JSON storage)

## Setup

### Backend

1. Create and activate a Python virtual environment:
   ```bash
   cd backend
   python -m venv venv
   venv\Scripts\activate  # Windows
   # or: source venv/bin/activate  # macOS/Linux
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create `.env` file in `backend/` with:
   ```env
   NEWS_API_KEY=your_news_api_key_here
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   SUPABASE_URL=https://your-project.supabase.co
   DATABASE_URL=postgresql://user:password@host:5432/dbname
   ```

4. Download NLTK data:
   ```bash
   python -m nltk.downloader punkt stopwords
   ```

5. Run the server:
   ```bash
   uvicorn app.main:app --port 8001 --reload
   ```

### Frontend

1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

2. Create `.env` file in `frontend/` with:
   ```env
   VITE_API_URL=http://127.0.0.1:8001
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   ```

3. Run dev server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5173 in your browser.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Example |
|----------|-------------|----------|
| `NEWS_API_KEY` | NewsAPI key for article search (optional) | `abc123...` |
| `VITE_SUPABASE_URL` | Supabase project URL | `https://proj.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key (fallback) | `sb_publishable_...` |
| `SUPABASE_URL` | Supabase project URL (primary) | `https://proj.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (if available) | `eyJhbGc...` |
| `DATABASE_URL` | PostgreSQL connection string (optional) | `postgresql://...` |

### Frontend (`frontend/.env`)

| Variable | Description | Example |
|----------|-------------|----------|
| `VITE_API_URL` | Backend API endpoint | `http://127.0.0.1:8001` |
| `VITE_SUPABASE_URL` | Supabase project URL | `https://proj.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key | `sb_publishable_...` |

## API Endpoints

### News
- `GET /api/news/{genre}?limit=15&sort=hot&after=cursor` – Fetch feed by genre
- `GET /api/search?q=query&limit=15&after=cursor` – Search Reddit

### Articles
- `POST /api/read` – Extract & summarize article from URL

### Bookmarks
- `GET /api/bookmarks?collection_id=123` – Get all/filtered bookmarks
- `POST /api/bookmarks` – Create bookmark
- `DELETE /api/bookmarks/{id}` – Delete bookmark

### Collections
- `GET /api/collections` – Get all collections
- `POST /api/collections` – Create collection
- `DELETE /api/collections/{id}` – Delete collection

## Development

### Run backend in watch mode:
```bash
cd backend
uvicorn app.main:app --reload --port 8001
```

### Run frontend in dev mode:
```bash
cd frontend
npm run dev
```

### Build frontend for production:
```bash
cd frontend
npm run build
npm run preview
```

### Lint frontend code:
```bash
cd frontend
npm run lint
```

## Testing

Try the API with curl or Postman:
```bash
# Get tech news
curl http://localhost:8001/api/news/technology?limit=5

# Search for "AI"
curl http://localhost:8001/api/search?q=AI&limit=5

# Save an article
curl -X POST http://localhost:8001/api/bookmarks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "AI News",
    "url": "https://example.com/article",
    "image_url": "https://example.com/image.jpg"
  }'
```

## Technologies

**Backend:**
- FastAPI (web framework)
- Supabase (PostgreSQL + auth)
- NLTK (NLP/summarization)
- Newspaper3k (article extraction)
- PRAW (Reddit API)
- SQLAlchemy (ORM)

**Frontend:**
- React 19
- Vite (build tool)
- CSS3 (styling)
- Capacitor (mobile support)

## Deployment

### Docker
```bash
docker-compose up
```

### Manual
1. Deploy backend to Heroku, Railway, or similar
2. Deploy frontend to Vercel, Netlify, or GitHub Pages
3. Update `.env` variables in production

## License

MIT

## Contributing

Feel free to submit issues and PRs!
