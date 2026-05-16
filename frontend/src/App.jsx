import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const REFRESH_INTERVAL = 5 * 60 * 60 * 1000 // 5 hours

// ── Primary tabs (always visible) ────────────────────────────────────────────
const PRIMARY_TABS = [
  { slug: 'technology', label: 'Tech' },
  { slug: 'world', label: 'World' },
  { slug: 'science', label: 'Science' },
]

// ── Dropdown "More" categories ────────────────────────────────────────────────
const MORE_TABS = [
  { slug: 'business', label: '💼 Business' },
  { slug: 'health', label: '🩺 Health' },
  { slug: 'sports', label: '⚽ Sports' },
  { slug: 'entertainment', label: '🎬 Entertainment' },
]

const ALL_TABS = [...PRIMARY_TABS, ...MORE_TABS]

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastId = 0
function useToasts() {
  const [toasts, setToasts] = useState([])
  const add = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++_toastId
    setToasts(p => [...p, { id, message, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration)
  }, [])
  const remove = useCallback(id => setToasts(p => p.filter(t => t.id !== id)), [])
  return { toasts, addToast: add, removeToast: remove }
}

// ── Speech ────────────────────────────────────────────────────────────────────
function speak(text, onEnd) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1.0; u.pitch = 1.0; u.onend = onEnd
  window.speechSynthesis.speak(u)
}
function stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel() }

// ── Share ─────────────────────────────────────────────────────────────────────
async function shareArticle(title, url, addToast) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return } catch (e) { if (e.name === 'AbortError') return }
  }
  navigator.clipboard.writeText(url)
    .then(() => addToast('Link copied!', 'success'))
    .catch(() => addToast('Could not copy link.', 'error'))
}

// ── Collection Modal ──────────────────────────────────────────────────────────
function CollectionModal({ collections, onSelect, onCreateNew, onSaveAsIs, onClose }) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState('choice')

  const createAndReset = async name => {
    setCreating(true)
    try {
      await onCreateNew(name)
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="collection-modal" onClick={e => e.stopPropagation()}>
        <div className="collection-modal__header">
          <span>Save article</span>
          <button className="close-x" onClick={onClose}>✕</button>
        </div>
        {mode === 'choice' ? (
          <div className="save-choice">
            <button className="save-choice-card save-choice-card--accent" onClick={() => { onSaveAsIs(); onClose() }}>
              <span className="save-choice-card__title">Save as is</span>
              <span className="save-choice-card__desc">Store it in your general saved list.</span>
            </button>
            <button className="save-choice-card" onClick={() => setMode('collection')}>
              <span className="save-choice-card__title">Make a collection</span>
              <span className="save-choice-card__desc">Pick an existing collection or create a new one.</span>
            </button>
          </div>
        ) : (
          <>
            <div className="collection-toolbar">
              <button className="collection-back-btn" onClick={() => setMode('choice')}>← Back</button>
              <span>Save to a collection</span>
            </div>
            <div className="collection-list">
              {collections.map(c => (
                <button key={c.id} className="collection-item" onClick={() => onSelect(c.id)}>
                  <span className="col-dot" style={{ background: c.color || '#c4451e' }} />
                  {c.name}
                </button>
              ))}
            </div>
            <div className="collection-new">
              <input className="collection-input" placeholder="New collection name…"
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createAndReset(newName.trim()) }}
              />
              <button className="collection-create-btn" disabled={!newName.trim() || creating}
                onClick={() => { if (newName.trim()) createAndReset(newName.trim()) }}>
                {creating ? '…' : '+ Create'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [news, setNews] = useState([])
  const [savedArticles, setSavedArticles] = useState([])
  const [collections, setCollections] = useState([])
  const [activeTab, setActiveTab] = useState('technology')
  const [activeColl, setActiveColl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busyIds, setBusyIds] = useState([])
  const [readerData, setReaderData] = useState(null)
  const [isReading, setIsReading] = useState(false)
  const [readerUrl, setReaderUrl] = useState(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('upfeed-theme') === 'dark')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [collPickerFor, setCollPickerFor] = useState(null)
  const [sortMode, setSortMode] = useState('hot')
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMenuStyle, setMoreMenuStyle] = useState(null)
  const [fromCache, setFromCache] = useState(false)

  const { toasts, addToast, removeToast } = useToasts()
  const moreRef = useRef(null)
  const moreButtonRef = useRef(null)
  const refreshTimer = useRef(null)

  const isSavedView = activeTab === 'saved'
  const activeTabLabel = ALL_TABS.find(t => t.slug === activeTab)?.label || activeTab

  // ── Dark mode ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('upfeed-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // ── Close dropdown on outside click ──
  useEffect(() => {
    const handler = e => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!moreOpen || !moreButtonRef.current) return
    const rect = moreButtonRef.current.getBoundingClientRect()
    setMoreMenuStyle({
      top: rect.bottom + window.scrollY + 8,
      left: rect.left + window.scrollX,
      minWidth: rect.width,
    })
  }, [moreOpen, activeTab])

  // ── Fetch news ──
  const fetchNews = useCallback(async (tab, sort, forceRefresh = false) => {
    if (tab === 'saved') {
      setLoading(true)
      try {
        const url = `${API}/api/bookmarks${activeColl !== null ? `?collection_id=${activeColl}` : ''}`
        const res = await fetch(url)
        const data = await res.json()
        if (data.status === 'success') setSavedArticles(data.data || [])
      } catch (err) { console.error(err) }
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const url = `${API}/api/news/${tab}?sort=${sort}${forceRefresh ? '&refresh=true' : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.status === 'success') {
        setNews(data.data || [])
        setFromCache(data.from_cache || false)
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }, [activeColl])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchNews(activeTab, sortMode)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeTab, sortMode, activeColl, fetchNews])

  // ── Auto-refresh every 5 hours ──
  useEffect(() => {
    if (isSavedView || searchActive) return
    clearInterval(refreshTimer.current)
    refreshTimer.current = setInterval(() => {
      fetchNews(activeTab, sortMode, true)
      addToast('Feed refreshed with latest stories', 'info', 4000)
    }, REFRESH_INTERVAL)
    return () => clearInterval(refreshTimer.current)
  }, [activeTab, sortMode, isSavedView, searchActive, fetchNews, addToast])

  // ── Collections ──
  useEffect(() => {
    fetch(`${API}/api/collections`).then(r => r.json())
      .then(d => { if (d.status === 'success') setCollections(d.data || []) })
      .catch(() => { })
  }, [])

  // ── Search ──
  const runSearch = useCallback(async q => {
    if (!q.trim()) return
    setSearchActive(true)
    setSearchLoading(true)
    try {
      const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=20`)
      const data = await res.json()
      if (data.status === 'success') setSearchResults(data.data || [])
    } catch (e) { console.error(e) }
    setSearchLoading(false)
  }, [])

  // ── Bookmark helpers ──
  const setBusy = (id, v) => setBusyIds(cur => v ? [...cur, id] : cur.filter(x => x !== id))

  const saveBookmark = async (article, collectionId = null) => {
    const key = article.id || article.url
    setBusy(key, true)
    try {
      const res = await fetch(`${API}/api/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: article.title, url: article.url, image_url: article.image_url || null, ai_summary: article.ai_summary ?? null, collection_id: collectionId }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        addToast('Article saved!', 'success')
        if (activeTab === 'saved') fetchNews('saved', sortMode)
      }
      else addToast(data.message || 'Could not save.', 'error')
    } catch { addToast('Could not save bookmark.', 'error') }
    setBusy(key, false)
  }

  const removeBookmark = async id => {
    setBusy(id, true)
    try {
      const res = await fetch(`${API}/api/bookmarks/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.status === 'success') { setSavedArticles(cur => cur.filter(i => i.id !== id)); addToast('Removed.', 'info') }
    } catch { addToast('Could not remove.', 'error') }
    setBusy(id, false)
  }

  const createCollection = async name => {
    const res = await fetch(`${API}/api/collections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color: '#c4451e' }) })
    const data = await res.json()
    if (data.status === 'success') { setCollections(p => [...p, data.data]); addToast(`"${name}" created!`, 'success') }
  }

  // ── Reader ──
  const handleRead = async url => {
    setIsReading(true); setReaderData(null); setReaderUrl(url); setIsSpeaking(false); stopSpeech()
    try {
      const res = await fetch(`${API}/api/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()
      if (data.status === 'success') setReaderData(data.data)
      else { addToast('Failed to extract article.', 'error'); setIsReading(false) }
    } catch { setIsReading(false) }
  }

  const closeReader = () => { setIsReading(false); stopSpeech(); setIsSpeaking(false) }

  const toggleSpeech = () => {
    if (isSpeaking) { stopSpeech(); setIsSpeaking(false) }
    else if (readerData) { speak(`${readerData.title}. ${readerData.ai_summary || ''} ${readerData.full_text || ''}`, () => setIsSpeaking(false)); setIsSpeaking(true) }
  }

  const displayArticles = searchActive ? searchResults : (isSavedView ? savedArticles : news)
  const [featured, ...rest] = displayArticles

  const switchTab = slug => {
    setActiveTab(slug)
    setSearchActive(false)
    setSearchQuery('')
    setMoreOpen(false)
  }

  return (
    <div className="app-container">
      {/* Toasts */}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast--${t.type}`} onClick={() => removeToast(t.id)}>{t.message}</div>
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
              <input className="search-input" placeholder="Search stories…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') runSearch(searchQuery)
                  if (e.key === 'Escape') { setSearchQuery(''); setSearchActive(false); setSearchResults([]) }
                }}
              />
              {searchQuery
                ? <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchActive(false); setSearchResults([]) }}>✕</button>
                : <span className="search-icon">⌕</span>
              }
            </div>
            <button className="theme-toggle" onClick={() => setDarkMode(d => !d)}>
              {darkMode ? '☀︎' : '☾'}
            </button>
          </div>
        </div>

        <nav className="genre-tabs">
          {/* Primary tabs */}
          {PRIMARY_TABS.map(t => (
            <button key={t.slug} className={`tab-btn ${activeTab === t.slug && !searchActive ? 'active' : ''}`}
              onClick={() => switchTab(t.slug)}>{t.label}</button>
          ))}

          {/* More dropdown */}
          <div className="more-dropdown" ref={moreRef}>
            <button
              ref={moreButtonRef}
              className={`tab-btn more-btn ${MORE_TABS.some(t => t.slug === activeTab) && !searchActive ? 'active' : ''}`}
              onClick={() => setMoreOpen(o => !o)}
            >
              <span className="more-btn__label">More</span>
              <span className="more-btn__value">{MORE_TABS.some(t => t.slug === activeTab) ? activeTabLabel : 'Select'}</span>
              <span className="more-btn__caret">▾</span>
            </button>
            {moreOpen && (
              <div className="more-menu" style={moreMenuStyle || undefined}>
                {MORE_TABS.map(t => (
                  <button key={t.slug} className={`more-item ${activeTab === t.slug ? 'active' : ''}`}
                    onClick={() => switchTab(t.slug)}>{t.label}</button>
                ))}
              </div>
            )}
          </div>

          <div className="tab-divider" />

          {/* Saved */}
          <button className={`tab-btn tab-saved ${isSavedView && !searchActive ? 'active' : ''}`}
            onClick={() => switchTab('saved')}>⊙ Saved</button>

          {/* Sort pills — hidden in saved/search view */}
          {!isSavedView && !searchActive && (
            <>
              <div className="tab-divider" />
              <div className="sort-pills">
                {['hot', 'trending', 'top'].map(s => (
                  <button key={s} className={`sort-pill ${sortMode === s ? 'active' : ''}`}
                    onClick={() => setSortMode(s)}>
                    {s === 'hot' ? '🔥' : s === 'trending' ? '📈' : '⭐'} {s}
                  </button>
                ))}
              </div>
              {fromCache && (
                <button className="cache-badge" onClick={() => fetchNews(activeTab, sortMode, true)} title="Click to force refresh">
                  ⚡ Cached
                </button>
              )}
            </>
          )}

          {/* Collection filter tabs in saved view */}
          {isSavedView && (
            <>
              <div className="tab-divider" />
              <div className="coll-tabs">
                <button className={`coll-tab ${activeColl === null ? 'active' : ''}`} onClick={() => setActiveColl(null)}>All</button>
                {collections.map(c => (
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
          {searchActive ? <p>No results for "<strong>{searchQuery}</strong>"</p> : <p>No stories found.</p>}
        </div>
      ) : (
        <main className="feed">
          {featured && (
            <ArticleCard article={featured} hero isSavedView={isSavedView} busyIds={busyIds}
              onRead={handleRead} onSave={a => setCollPickerFor(a)} onRemove={removeBookmark}
              onShare={a => shareArticle(a.title, a.url, addToast)} />
          )}
          {rest.length > 0 && (
            <div className="news-grid">
              {rest.map(article => (
                <ArticleCard key={article.id || article.url} article={article}
                  isSavedView={isSavedView} busyIds={busyIds}
                  onRead={handleRead} onSave={a => setCollPickerFor(a)} onRemove={removeBookmark}
                  onShare={a => shareArticle(a.title, a.url, addToast)} />
              ))}
            </div>
          )}
        </main>
      )}

      {/* Collection picker */}
      {collPickerFor && (
        <CollectionModal collections={collections}
          onSelect={id => { saveBookmark(collPickerFor, id); setCollPickerFor(null) }}
          onCreateNew={async name => { await createCollection(name); const r = await fetch(`${API}/api/collections`); const d = await r.json(); if (d.status === 'success') setCollections(d.data || []) }}
          onSaveAsIs={() => saveBookmark(collPickerFor, null)}
          onClose={() => setCollPickerFor(null)} />
      )}

      {/* Reader modal */}
      {isReading && (
        <div className="overlay" onClick={closeReader}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal__close close-x" onClick={closeReader}>✕</button>
            {!readerData ? (
              <div className="modal-loading"><div className="loading-spinner" /><p>Extracting & summarising…</p></div>
            ) : (
              <div className="modal-body">
                <div className="modal-header">
                  <span className="modal-label">AI Reader</span>
                  <h2 className="modal-title">{readerData.title}</h2>
                  <div className="modal-actions">
                    <button className={`tts-btn ${isSpeaking ? 'tts-btn--active' : ''}`} onClick={toggleSpeech}>
                      {isSpeaking ? '⏹ Stop' : '▶ Listen'}
                    </button>
                    <button className="share-btn-modal" onClick={() => shareArticle(readerData.title, readerUrl, addToast)}>↗ Share</button>
                    <button className="save-btn-modal" onClick={() => setCollPickerFor({ title: readerData.title, url: readerUrl, image_url: null, ai_summary: readerData.ai_summary })}>⊙ Save</button>
                  </div>
                </div>
                {readerData.ai_summary && (
                  <div className="modal-summary">
                    <div className="summary-header"><span className="summary-icon">✦</span><span className="summary-title">AI Summary</span></div>
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

// ── Article Card ──────────────────────────────────────────────────────────────
function ArticleCard({ article, hero, isSavedView, busyIds, onRead, onSave, onRemove, onShare }) {
  const key = article.id || article.url
  const isBusy = busyIds.includes(key)
  const fallback = 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1200&auto=format&fit=crop'

  if (hero) {
    return (
      <article className="card card--hero" onClick={() => onRead(article.url)}>
        <div className="card__img-wrap card__img-wrap--hero">
          <img src={article.image_url || fallback} alt="" onError={e => { e.target.onerror = null; e.target.src = fallback }} />
          <div className="card__img-fade" />
        </div>
        <div className="card__body card__body--hero">
          <span className="card__label">Top Story</span>
          <h2 className="card__title card__title--hero">{article.title}</h2>
          {article.description && <p className="card__desc">{article.description}</p>}
          {article.source && <span className="card__source">{article.source}</span>}
          <div className="card__actions">
            <button className="read-btn">Read & Summarize →</button>
            {isSavedView ? (
              <button className="icon-btn icon-btn--remove" onClick={e => { e.stopPropagation(); onRemove(article.id) }} disabled={isBusy}>{isBusy ? '…' : '✕ Remove'}</button>
            ) : (
              <>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); onSave(article) }} disabled={isBusy} title="Save">{isBusy ? '…' : '⊙'}</button>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); onShare(article) }} title="Share">↗</button>
              </>
            )}
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="card card--grid" onClick={() => onRead(article.url)}>
      <div className="card__img-wrap">
        <img src={article.image_url || fallback} alt="" onError={e => { e.target.onerror = null; e.target.src = fallback }} />
      </div>
      <div className="card__body">
        <h3 className="card__title">{article.title}</h3>
        {article.description && <p className="card__desc card__desc--grid">{article.description}</p>}
        {article.source && <span className="card__source">{article.source}</span>}
        <div className="card__actions">
          {isSavedView ? (
            <button className="icon-btn icon-btn--remove" onClick={e => { e.stopPropagation(); onRemove(article.id) }} disabled={isBusy}>{isBusy ? '…' : '✕'}</button>
          ) : (
            <>
              <button className="icon-btn" onClick={e => { e.stopPropagation(); onSave(article) }} disabled={isBusy} title="Save">{isBusy ? '…' : '⊙'}</button>
              <button className="icon-btn" onClick={e => { e.stopPropagation(); onShare(article) }} title="Share">↗</button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}