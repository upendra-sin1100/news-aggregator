import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import getSupabaseClient from './lib/supabase'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001'
const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes

// ── Toast System ──────────────────────────────────────────
let toastId = 0
function useToasts() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++toastId
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}

// ── Text-to-Speech ────────────────────────────────────────
let activeSpeech = null
function speak(text, onEnd) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 1.0
    utter.pitch = 1.0
    utter.onend = onEnd
    activeSpeech = utter
    window.speechSynthesis.speak(utter)
  }
}
function stopSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

// ── Share ─────────────────────────────────────────────────
async function shareArticle(title, url, addToast) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url })
    } catch (e) {
      if (e.name !== 'AbortError') copyToClipboard(url, addToast)
    }
  } else {
    copyToClipboard(url, addToast)
  }
}
function copyToClipboard(text, addToast) {
  navigator.clipboard.writeText(text).then(
    () => addToast('Link copied to clipboard!', 'success'),
    () => addToast('Could not copy link.', 'error')
  )
}

// ── Collection picker modal ───────────────────────────────
function CollectionModal({ collections, onSelect, onCreateNew, onClose }) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="collection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="collection-modal__header">
          <span>Save to Collection</span>
          <button className="close-x" onClick={onClose}>✕</button>
        </div>
        <div className="collection-list">
          <button className="collection-item collection-item--none" onClick={() => onSelect(null)}>
            <span className="col-dot" style={{ background: '#888' }} />
            No collection (general saved)
          </button>
          {collections.map((c) => (
            <button key={c.id} className="collection-item" onClick={() => onSelect(c.id)}>
              <span className="col-dot" style={{ background: c.color || '#c4451e' }} />
              {c.name}
            </button>
          ))}
        </div>
        <div className="collection-new">
          <input
            className="collection-input"
            placeholder="New collection name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                setCreating(true)
                onCreateNew(newName.trim()).finally(() => setCreating(false))
                setNewName('')
              }
            }}
          />
          <button
            className="collection-create-btn"
            disabled={!newName.trim() || creating}
            onClick={() => {
              if (newName.trim()) {
                setCreating(true)
                onCreateNew(newName.trim()).finally(() => setCreating(false))
                setNewName('')
              }
            }}
          >
            {creating ? '…' : '+ Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [news, setNews] = useState([])
  const [savedArticles, setSavedArticles] = useState([])
  const [collections, setCollections] = useState([])
  const [activeTab, setActiveTab] = useState('technology')
  const [activeColl, setActiveColl] = useState(null) // null = all saved
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextAfter, setNextAfter] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [busyIds, setBusyIds] = useState([])
  const [readerData, setReaderData] = useState(null)
  const [isReading, setIsReading] = useState(false)
  const [readerUrl, setReaderUrl] = useState(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('upfeed-theme') === 'dark')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchNextAfter, setSearchNextAfter] = useState(null)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [collPickerFor, setCollPickerFor] = useState(null) // article waiting for collection pick
  const [sortMode, setSortMode] = useState('hot') // hot | trending | top

  const { toasts, addToast, removeToast } = useToasts()
  const sentinelRef = useRef(null)
  const searchRef = useRef(null)
  const refreshTimer = useRef(null)
  const seenNewsIds = useRef(new Set())   // dedup tracker for current feed
  const seenSearchIds = useRef(new Set())  // dedup tracker for search results

  const genres = ['technology', 'science', 'machinelearning', 'worldnews']
  const isSavedView = activeTab === 'saved'
  const tabLabels = {
    technology: 'Tech', science: 'Science', machinelearning: 'AI/ML',
    worldnews: 'World', saved: 'Saved',
  }

  // ── Dark mode ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('upfeed-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // ── Fetch news (initial + tab change) ──
  const fetchNews = useCallback(async (tab, sort, replace = true) => {
    if (replace) setLoading(true)
    else setLoadingMore(true)
    try {
      const endpoint = isSavedView || tab === 'saved'
        ? `${API}/api/bookmarks${activeColl !== null ? `?collection_id=${activeColl}` : ''}`
        : `${API}/api/news/${tab}?limit=15&sort=${sort}${!replace && nextAfter ? `&after=${nextAfter}` : ''}`

      const res = await fetch(endpoint)
      const data = await res.json()
      if (data.status === 'success') {
        if (tab === 'saved') {
          setSavedArticles(data.data || [])
        } else {
          const incoming = data.data || []
          if (replace) {
            seenNewsIds.current = new Set(incoming.map((a) => a.id || a.url))
            setNews(incoming)
          } else {
            const fresh = incoming.filter((a) => {
              const key = a.id || a.url
              if (seenNewsIds.current.has(key)) return false
              seenNewsIds.current.add(key)
              return true
            })
            if (fresh.length > 0) setNews((prev) => [...prev, ...fresh])
          }
          setNextAfter(data.next_after || null)
          setHasMore(!!data.has_more && incoming.length > 0)
        }
      }
    } catch (err) {
      console.error('Fetch failed', err)
    }
    if (replace) setLoading(false)
    else setLoadingMore(false)
  }, [activeColl, nextAfter, isSavedView])

  useEffect(() => {
    setNews([])
    setNextAfter(null)
    setHasMore(true)
    seenNewsIds.current = new Set()
    setSearchActive(false)
    setSearchQuery('')
    fetchNews(activeTab, sortMode, true)
  }, [activeTab, sortMode, activeColl])

  // ── Auto-refresh ──
  useEffect(() => {
    if (isSavedView || searchActive) return
    clearInterval(refreshTimer.current)
    refreshTimer.current = setInterval(() => {
      addToast('🔄 Feed refreshed with latest stories', 'info', 4000)
      fetchNews(activeTab, sortMode, true)
    }, REFRESH_INTERVAL)
    return () => clearInterval(refreshTimer.current)
  }, [activeTab, sortMode, isSavedView, searchActive])

  // ── Collections ──
  useEffect(() => {
    fetch(`${API}/api/collections`)
      .then((r) => r.json())
      .then((d) => { if (d.status === 'success') setCollections(d.data || []) })
      .catch(() => { })
  }, [])

  // ── Infinite scroll sentinel ──
  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading && !isSavedView && !searchActive) {
          fetchNews(activeTab, sortMode, false)
        }
      },
      { threshold: 0.1 }
    )
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loadingMore, loading, activeTab, sortMode, isSavedView, searchActive, nextAfter])

  // ── Search ──
  const runSearch = useCallback(async (q, replace = true) => {
    if (!q.trim()) return
    setSearchActive(true)
    if (replace) setSearchLoading(true)
    try {
      const after = replace ? '' : `&after=${searchNextAfter || ''}`
      const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=15${after}`)
      const data = await res.json()
      if (data.status === 'success') {
        const incoming = data.data || []
        if (replace) {
          seenSearchIds.current = new Set(incoming.map((a) => a.id || a.url))
          setSearchResults(incoming)
        } else {
          const fresh = incoming.filter((a) => {
            const key = a.id || a.url
            if (seenSearchIds.current.has(key)) return false
            seenSearchIds.current.add(key)
            return true
          })
          if (fresh.length > 0) setSearchResults((prev) => [...prev, ...fresh])
        }
        setSearchNextAfter(data.next_after || null)
        setSearchHasMore(!!data.has_more && incoming.length > 0)
      }
    } catch (e) { }
    if (replace) setSearchLoading(false)
  }, [searchNextAfter])

  // ── Bookmark helpers ──
  const setBusy = (id, v) =>
    setBusyIds((cur) => v ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id))

  const saveBookmark = async (article, collectionId = null) => {
    const key = article.id || article.url
    setBusy(key, true)
    try {
      const res = await fetch(`${API}/api/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.title, url: article.url,
          image_url: article.image_url || null,
          ai_summary: article.ai_summary ?? null,
          collection_id: collectionId,
        }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        addToast('Article saved!', 'success')
      } else {
        addToast(data.message || 'Could not save.', 'error')
      }
    } catch {
      addToast('Could not save bookmark.', 'error')
    }
    setBusy(key, false)
  }

  const removeBookmark = async (bookmarkId) => {
    setBusy(bookmarkId, true)
    try {
      const res = await fetch(`${API}/api/bookmarks/${bookmarkId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.status === 'success') {
        setSavedArticles((cur) => cur.filter((i) => i.id !== bookmarkId))
        addToast('Removed from saved.', 'info')
      } else {
        addToast(data.message || 'Could not remove.', 'error')
      }
    } catch {
      addToast('Could not remove bookmark.', 'error')
    }
    setBusy(bookmarkId, false)
  }

  const createCollection = async (name) => {
    const res = await fetch(`${API}/api/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: '#c4451e' }),
    })
    const data = await res.json()
    if (data.status === 'success') {
      setCollections((prev) => [...prev, data.data])
      addToast(`Collection "${name}" created!`, 'success')
    }
  }

  // ── Reader ──
  const handleReadArticle = async (url) => {
    setIsReading(true)
    setReaderData(null)
    setReaderUrl(url)
    setIsSpeaking(false)
    stopSpeech()
    try {
      const res = await fetch(`${API}/api/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (data.status === 'success') setReaderData(data.data)
      else { addToast('Failed to extract article.', 'error'); setIsReading(false) }
    } catch { setIsReading(false) }
  }

  const closeReader = () => {
    setIsReading(false)
    stopSpeech()
    setIsSpeaking(false)
  }

  const toggleSpeech = () => {
    if (isSpeaking) {
      stopSpeech()
      setIsSpeaking(false)
    } else if (readerData) {
      const text = `${readerData.title}. ${readerData.ai_summary || ''} ${readerData.full_text || ''}`
      speak(text, () => setIsSpeaking(false))
      setIsSpeaking(true)
    }
  }

  const displayArticles = searchActive ? searchResults : (isSavedView ? savedArticles : news)
  const [featured, ...rest] = displayArticles

  // ── Render ──
  return (
    <div className="app-container">
      {/* Toast container */}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`} onClick={() => removeToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="site-header">
        <div className="header-top">
          <div className="header-logo">
            <span className="logo-mark">UP</span>
            <div className="logo-text">
              <span className="logo-title">UpFeed</span>
              <span className="logo-sub">AI News Reader</span>
            </div>
          </div>
          <div className="header-controls">
            <div className="search-wrap">
              <input
                ref={searchRef}
                className="search-input"
                placeholder="Search stories…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch(searchQuery, true)
                  if (e.key === 'Escape') {
                    setSearchQuery('')
                    setSearchActive(false)
                    setSearchResults([])
                  }
                }}
              />
              {searchQuery ? (
                <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchActive(false); setSearchResults([]) }}>✕</button>
              ) : (
                <span className="search-icon">⌕</span>
              )}
            </div>
            <button
              className="theme-toggle"
              onClick={() => setDarkMode((d) => !d)}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? '☀︎' : '☾'}
            </button>
          </div>
        </div>

        <nav className="genre-tabs">
          {genres.map((g) => (
            <button key={g} className={`tab-btn ${activeTab === g && !searchActive ? 'active' : ''}`}
              onClick={() => { setActiveTab(g); setSearchActive(false); setSearchQuery('') }}>
              {tabLabels[g]}
            </button>
          ))}
          <div className="tab-divider" />
          <button className={`tab-btn tab-saved ${isSavedView && !searchActive ? 'active' : ''}`}
            onClick={() => { setActiveTab('saved'); setSearchActive(false); setSearchQuery('') }}>
            ⊙ Saved
          </button>

          {!isSavedView && !searchActive && (
            <>
              <div className="tab-divider" />
              <div className="sort-pills">
                {['hot', 'trending', 'top'].map((s) => (
                  <button key={s} className={`sort-pill ${sortMode === s ? 'active' : ''}`}
                    onClick={() => setSortMode(s)}>
                    {s === 'hot' ? '🔥' : s === 'trending' ? '📈' : '⭐'} {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {isSavedView && (
            <>
              <div className="tab-divider" />
              <div className="coll-tabs">
                <button className={`coll-tab ${activeColl === null ? 'active' : ''}`}
                  onClick={() => setActiveColl(null)}>All</button>
                {collections.map((c) => (
                  <button key={c.id} className={`coll-tab ${activeColl === c.id ? 'active' : ''}`}
                    onClick={() => setActiveColl(c.id)}
                    style={activeColl === c.id ? { borderColor: c.color, color: c.color } : {}}>
                    <span className="col-dot" style={{ background: c.color }} />{c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </nav>
      </header>

      {/* Body */}
      {(loading || searchLoading) ? (
        <div className="loader-container">
          <div className="loader-bar" />
          <p className="loader-text">{searchActive ? 'Searching…' : 'Fetching latest stories…'}</p>
        </div>
      ) : displayArticles.length === 0 ? (
        <div className="empty-state">
          {searchActive
            ? <p>No results for "<strong>{searchQuery}</strong>"</p>
            : <p>No stories found.</p>}
        </div>
      ) : (
        <main className="feed">
          {featured && (
            <ArticleCard
              article={featured}
              hero
              isSavedView={isSavedView}
              busyIds={busyIds}
              onRead={handleReadArticle}
              onSave={(a) => { setCollPickerFor(a) }}
              onRemove={removeBookmark}
              onShare={(a) => shareArticle(a.title, a.url, addToast)}
            />
          )}

          {rest.length > 0 && (
            <div className="news-grid">
              {rest.map((article) => (
                <ArticleCard
                  key={article.id || article.url}
                  article={article}
                  isSavedView={isSavedView}
                  busyIds={busyIds}
                  onRead={handleReadArticle}
                  onSave={(a) => setCollPickerFor(a)}
                  onRemove={removeBookmark}
                  onShare={(a) => shareArticle(a.title, a.url, addToast)}
                />
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          {!isSavedView && !searchActive && (
            <div ref={sentinelRef} className="scroll-sentinel">
              {loadingMore && (
                <div className="load-more-indicator">
                  <div className="loading-spinner" />
                  <span>Loading more…</span>
                </div>
              )}
              {!hasMore && news.length > 0 && (
                <p className="end-of-feed">You've reached the end of this feed.</p>
              )}
            </div>
          )}

          {/* Search load more */}
          {searchActive && searchHasMore && (
            <div className="load-more-wrap">
              <button className="load-more-btn"
                onClick={() => runSearch(searchQuery, false)}>
                Load more results
              </button>
            </div>
          )}
        </main>
      )}

      {/* Collection picker */}
      {collPickerFor && (
        <CollectionModal
          collections={collections}
          onSelect={(collId) => {
            saveBookmark(collPickerFor, collId)
            setCollPickerFor(null)
          }}
          onCreateNew={async (name) => {
            await createCollection(name)
            // re-fetch collections
            const r = await fetch(`${API}/api/collections`)
            const d = await r.json()
            if (d.status === 'success') setCollections(d.data || [])
          }}
          onClose={() => setCollPickerFor(null)}
        />
      )}

      {/* Reader modal */}
      {isReading && (
        <div className="overlay" onClick={closeReader}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal__close close-x" onClick={closeReader}>✕</button>

            {!readerData ? (
              <div className="modal-loading">
                <div className="loading-spinner" />
                <p>Extracting & summarising…</p>
              </div>
            ) : (
              <div className="modal-body">
                <div className="modal-header">
                  <span className="modal-label">AI Reader</span>
                  <h2 className="modal-title">{readerData.title}</h2>
                  <div className="modal-actions">
                    <button className={`tts-btn ${isSpeaking ? 'tts-btn--active' : ''}`} onClick={toggleSpeech}>
                      {isSpeaking ? '⏹ Stop' : '▶ Listen'}
                    </button>
                    <button className="share-btn-modal"
                      onClick={() => shareArticle(readerData.title, readerUrl, addToast)}>
                      ↗ Share
                    </button>
                    <button className="save-btn-modal"
                      onClick={() => {
                        setCollPickerFor({ title: readerData.title, url: readerUrl, image_url: null, ai_summary: readerData.ai_summary })
                      }}>
                      ⊙ Save
                    </button>
                  </div>
                </div>

                {readerData.ai_summary && (
                  <div className="modal-summary">
                    <div className="summary-header">
                      <span className="summary-icon">✦</span>
                      <span className="summary-title">AI Summary</span>
                    </div>
                    <p>{readerData.ai_summary}</p>
                  </div>
                )}

                <div className="modal-divider" />

                <div className="modal-full-text">
                  <h4 className="full-text-label">Full Article</h4>
                  <p>{readerData.full_text}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Article Card component ─────────────────────────────────
function ArticleCard({ article, hero, isSavedView, busyIds, onRead, onSave, onRemove, onShare }) {
  const key = article.id || article.url
  const isBusy = busyIds.includes(key)
  const fallback = 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1200&auto=format&fit=crop'

  if (hero) {
    return (
      <article className="card card--hero" onClick={() => onRead(article.url)}>
        <div className="card__img-wrap card__img-wrap--hero">
          <img src={article.image_url} alt="" onError={(e) => { e.target.onerror = null; e.target.src = fallback }} />
          <div className="card__img-fade" />
        </div>
        <div className="card__body card__body--hero">
          <span className="card__label">Top Story</span>
          <h2 className="card__title card__title--hero">{article.title}</h2>
          {article.source && <span className="card__source">{article.source}</span>}
          <div className="card__actions">
            <button className="read-btn">Read & Summarize →</button>
            {isSavedView ? (
              <button className="icon-btn icon-btn--remove" onClick={(e) => { e.stopPropagation(); onRemove(article.id) }} disabled={isBusy}>
                {isBusy ? '…' : '✕ Remove'}
              </button>
            ) : (
              <>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onSave(article) }} disabled={isBusy} title="Save">
                  {isBusy ? '…' : '⊙'}
                </button>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onShare(article) }} title="Share">
                  ↗
                </button>
              </>
            )}
          </div>
        </div>
      </article>
    )
  }

  return (
    <article key={key} className="card card--grid" onClick={() => onRead(article.url)}>
      <div className="card__img-wrap">
        <img src={article.image_url} alt="" onError={(e) => { e.target.onerror = null; e.target.src = fallback }} />
      </div>
      <div className="card__body">
        <h3 className="card__title">{article.title}</h3>
        {article.source && <span className="card__source">{article.source}</span>}
        <div className="card__actions">
          {isSavedView ? (
            <button className="icon-btn icon-btn--remove" onClick={(e) => { e.stopPropagation(); onRemove(article.id) }} disabled={isBusy}>
              {isBusy ? '…' : '✕'}
            </button>
          ) : (
            <>
              <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onSave(article) }} disabled={isBusy} title="Save to collection">
                {isBusy ? '…' : '⊙'}
              </button>
              <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onShare(article) }} title="Share">
                ↗
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}