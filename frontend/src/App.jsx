import { speak, stopSpeech } from './lib/speech'
import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import './edition.css'
import useFeed from './lib/useFeed'
import useAuth, { accountRequest } from './lib/useAuth'
import getSupabaseClient from './lib/supabase'
import AuthModal from './AuthModal'
import { Search, Sun, Moon, RefreshCw, ArrowUpRight, Bookmark, Newspaper } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const REFRESH_INTERVAL = 5 * 60 * 1000 // Check for a fresh edition every five minutes

// ── Primary tabs (always visible) ────────────────────────────────────────────
const PRIMARY_TABS = [
  { slug: 'technology', label: 'Tech' },
  { slug: 'world', label: 'World' },
  { slug: 'india', label: '🇮🇳 India' },
  { slug: 'science', label: 'Science' },
]

// ── Dropdown "More" categories ────────────────────────────────────────────────
const MORE_TABS = [
  { slug: 'business', label: '💼 Business' },
  { slug: 'stock-market', label: '📈 Stock Market' },
  { slug: 'health', label: '🩺 Health' },
  { slug: 'sports', label: '⚽ Sports' },
  { slug: 'entertainment', label: '🎬 Entertainment' },
  { slug: 'politics', label: '🏛️ Politics' },
  { slug: 'gaming', label: '🎮 Gaming' },
  { slug: 'environment', label: '🌿 Environment' },
  { slug: 'cryptocurrency', label: '₿ Crypto' },
  { slug: 'automobile', label: '🚗 Automobile' },
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

// ── Hindi Translation via Google Translate (free endpoint) ────────────────────
async function translateToHindi(text) {
  if (!text) return null
  try {
    // Split text into chunks to avoid URI Too Long (414) errors
    const MAX_LENGTH = 1200
    const chunks = []
    let current = ''
    const parts = text.split(/(?<=[.!?\n])\s+/)

    for (const part of parts) {
      if ((current + part).length > MAX_LENGTH && current.length > 0) {
        chunks.push(current)
        current = part + ' '
      } else {
        current += part + ' '
      }
    }
    if (current.trim()) chunks.push(current)

    let fullTranslation = ''
    for (const chunk of chunks) {
      if (!chunk.trim()) continue
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=hi&dt=t&q=${encodeURIComponent(chunk.trim())}`
      const res = await fetch(url)
      const data = await res.json()
      if (data && data[0]) {
        fullTranslation += data[0].map(c => c[0]).join('') + ' '
      }
    }
    return fullTranslation.trim() || null
  } catch (e) {
    console.error('Translation error:', e)
    return null
  }
}

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
function CollectionModal({ collections, onSelect, onCreateNew, onClose }) {
  const dialogRef = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.querySelector('button')?.focus()
    return () => previous?.focus()
  }, [])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState('choice')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async id => {
    if (saving) return
    setSaving(true); setError('')
    try { await onSelect(id); onClose() }
    catch (err) { setError(err.message || 'Could not save. Please try again.') }
    finally { setSaving(false) }
  }

  const createAndReset = async name => {
    setCreating(true)
    try {
      await onCreateNew(name)
      setNewName('')
    } catch (err) { setError(err.message || 'Could not create collection.') } finally {
      setCreating(false)
    }
  }

  return (
    <div className="overlay overlay--save" onClick={() => !saving && !creating && onClose()}>
      <div className="collection-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Save article" onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape' && !saving && !creating) onClose()
          if (e.key === 'Tab') {
            const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
            const first = controls[0], last = controls.at(-1)
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
          }
        }}>
        <div className="collection-modal__header">
          <span>Save article</span>
          <button className="close-x" onClick={() => !saving && !creating && onClose()}>✕</button>
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {saving && <p role="status">Saving story…</p>}
        {mode === 'choice' ? (
          <div className="save-choice">
            <button className="save-choice-card save-choice-card--accent" disabled={saving || creating} onClick={() => save(null)}>
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
                <button key={c.id} className="collection-item" disabled={saving || creating} onClick={() => save(c.id)}>
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
              <button className="collection-create-btn" disabled={!newName.trim() || creating || saving}
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
  const { user, session, loading: authLoading, configured } = useAuth()
  const [showWelcome, setShowWelcome] = useState(() => new URLSearchParams(window.location.search).get('welcome') === '1')
  useEffect(() => {
    if (!showWelcome || !user) return
    const url = new URL(window.location.href)
    url.searchParams.delete('welcome')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [showWelcome, user])
  const [authOpen, setAuthOpen] = useState(false)
  const [pendingSave, setPendingSave] = useState(null)
  const [library, setLibrary] = useState({ userId: null, collections: [], bookmarks: [] })
  const collections = user && library.userId === user.id ? library.collections : []
  const savedBookmarks = user && library.userId === user.id ? library.bookmarks : []
  const savedUrls = new Set(savedBookmarks.map(a => a.url))
  const [activeTab, setActiveTab] = useState('technology')
  const [activeColl, setActiveColl] = useState(null)
  const [busyIds, setBusyIds] = useState([])
  const [readerData, setReaderData] = useState(null)
  const [readerHindi, setReaderHindi] = useState(null)
  const [readerTranslating, setReaderTranslating] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [readerUrl, setReaderUrl] = useState(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speakLang, setSpeakLang] = useState('en')      // 'en' | 'hi'
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('upfeed-theme') === 'dark')
  const [searchQuery, setSearchQuery] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const searchActive = Boolean(committedQuery)
  const setSearchActive = () => setCommittedQuery('')
  const [freshAvailable, setFreshAvailable] = useState(false)
  const [collPickerFor, setCollPickerFor] = useState(null)
  const [sortMode, setSortMode] = useState('latest')
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMenuStyle, setMoreMenuStyle] = useState(null)

  // Translation states per-article: { [articleId]: { loading, text } }
  const [translations, setTranslations] = useState({})

  const { toasts, addToast, removeToast } = useToasts()
  const moreRef = useRef(null)
  const moreButtonRef = useRef(null)
  const refreshTimer = useRef(null)
  const sentinelRef = useRef(null)   // infinite scroll sentinel
  const readerRequest = useRef(0)

  const isSavedView = activeTab === 'saved'
  const activeTabLabel = ALL_TABS.find(t => t.slug === activeTab)?.label || activeTab

  // ── Dark mode ──
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('upfeed-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // ── Close more dropdown on outside click ──
  useEffect(() => {
    const handler = e => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!moreOpen || !moreButtonRef.current) return
    const rect = moreButtonRef.current.getBoundingClientRect()
    setMoreMenuStyle({
      top: rect.bottom + 8,
      left: Math.min(rect.left, window.innerWidth - 232),
      minWidth: rect.width,
    })
  }, [moreOpen, activeTab])

  const feedPath = searchActive
    ? `/api/search?q=${encodeURIComponent(committedQuery)}&limit=20`
    : isSavedView ? `/api/bookmarks${activeColl !== null ? `?collection_id=${activeColl}` : ''}`
      : `/api/news/${activeTab}?sort=${sortMode}&limit=20`
  const { articles: displayArticles, loading, loadingMore, hasMore, error: feedError,
    updatedAt, fromCache, refresh, loadMore } = useFeed(feedPath, isSavedView && !searchActive ? session?.access_token : null, !isSavedView || searchActive || Boolean(user))
  const fetchNews = () => { setFreshAvailable(false); return refresh() }
  const runSearch = q => {
    if (!q.trim()) return
    setCommittedQuery(q.trim())
    setMoreOpen(false)
    if (q.trim() === committedQuery) refresh()
  }

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || loading || loadingMore || feedError || !hasMore) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore()
    }, { rootMargin: '400px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, loading, loadingMore, feedError, hasMore])

  useEffect(() => {
    if (isSavedView || searchActive) return
    refreshTimer.current = setInterval(() => setFreshAvailable(true), REFRESH_INTERVAL)
    return () => clearInterval(refreshTimer.current)
  }, [activeTab, sortMode, isSavedView, searchActive])

  // Library data belongs to a specific account and never survives an account switch.
  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    const owner = user.id
    const options = { signal: controller.signal, expectedUserId: owner }
    const loadBookmarks = async () => {
      const items = []
      for (let page = 1; ; page++) {
        const batch = await accountRequest(`/api/bookmarks?page=${page}&limit=100`, options)
        items.push(...batch)
        if (batch.length < 100) return items
      }
    }
    Promise.all([accountRequest('/api/collections', options), loadBookmarks()])
      .then(([items, bookmarks]) => {
        if (!controller.signal.aborted) setLibrary({ userId: owner, collections: items, bookmarks })
      }).catch(err => { if (!controller.signal.aborted) addToast(err.message, 'error') })
    return () => controller.abort()
  }, [user, addToast])

  const requestSave = article => {
    if (!user) { setPendingSave(article); setAuthOpen(true); return }
    setCollPickerFor(article)
  }
  const signOut = async () => {
    try {
      const client = await getSupabaseClient()
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
      setLibrary({ userId: null, collections: [], bookmarks: [] })
      setCollPickerFor(null); setPendingSave(null); setActiveColl(null)
      addToast('Signed out.', 'info')
    } catch (err) { addToast(err.message || 'Could not sign out.', 'error') }
  }

  // ── Hindi Translation handler ──
  const handleTranslate = useCallback(async (articleId, text) => {
    setTranslations(prev => ({ ...prev, [articleId]: { loading: true, text: null } }))
    const translated = await translateToHindi(text)
    if (translated) {
      setTranslations(prev => ({ ...prev, [articleId]: { loading: false, text: translated } }))
    } else {
      setTranslations(prev => { const n = { ...prev }; delete n[articleId]; return n })
      addToast('Translation failed. Try again.', 'error')
    }
  }, [addToast])

  const clearTranslation = useCallback(articleId => {
    setTranslations(prev => { const n = { ...prev }; delete n[articleId]; return n })
  }, [])

  // ── Bookmark helpers ──
  const setBusy = (id, v) => setBusyIds(cur => v ? [...cur, id] : cur.filter(x => x !== id))

  const saveBookmark = async (article, collectionId = null) => {
    if (!user) throw new Error('Please sign in to save this story.')
    const key = article.id || article.url
    setBusy(key, true)
    try {
      const saved = await accountRequest('/api/bookmarks', {
        expectedUserId: user.id,
        method: 'POST',
        body: JSON.stringify({ title: article.title, url: article.url, image_url: article.image_url || null,
          ai_summary: article.ai_summary ?? null, description: article.description || null,
          source: article.source || null, published_at: article.published_at || null, collection_id: collectionId }),
      })
      setLibrary(prev => ({ userId: user.id,
        collections: prev.userId === user.id ? prev.collections : [],
        bookmarks: [...(prev.userId === user.id ? prev.bookmarks : []).filter(a => a.url !== saved.url), saved] }))
      addToast('Story saved to your reading room.', 'success')
      if (isSavedView) refresh()
    } finally { setBusy(key, false) }
  }

  const removeBookmark = async id => {
    setBusy(id, true)
    try {
      await accountRequest(`/api/bookmarks/${id}`, { method: 'DELETE', expectedUserId: user.id })
      // Deletion shifts offset-based pages; restart before loading another page.
      refresh()
      setLibrary(prev => ({ ...prev, bookmarks: prev.bookmarks.filter(a => a.id !== id) }))
      addToast('Story removed.', 'info')
    } catch (err) { addToast(err.message || 'Could not remove story.', 'error') }
    finally { setBusy(id, false) }
  }

  const createCollection = async name => {
    const item = await accountRequest('/api/collections', { method: 'POST', expectedUserId: user.id, body: JSON.stringify({ name, color: '#c4451e' }) })
    setLibrary(prev => ({ userId: user.id, bookmarks: prev.userId === user.id ? prev.bookmarks : [],
      collections: [...(prev.userId === user.id ? prev.collections : []).filter(c => c.id !== item.id), item] }))
    addToast(`“${name}” is ready. Select it to save your story.`, 'success')
  }

  const removeCollection = async collection => {
    if (!user || !window.confirm(`Delete “${collection.name}”? Its stories will stay in All saved stories.`)) return
    const key = `collection-${collection.id}`
    setBusy(key, true)
    try {
      await accountRequest(`/api/collections/${collection.id}`, { method: 'DELETE', expectedUserId: user.id })
      setLibrary(prev => ({ ...prev,
        collections: prev.collections.filter(c => c.id !== collection.id),
        bookmarks: prev.bookmarks.map(a => a.collection_id === collection.id ? { ...a, collection_id: null } : a),
      }))
      if (activeColl === collection.id) setActiveColl(null)
      else refresh()
      addToast('Collection deleted. Your saved stories are still in All.', 'info')
    } catch (err) { addToast(err.message || 'Could not delete collection.', 'error') }
    finally { setBusy(key, false) }
  }

  // ── Reader ──
  const handleRead = async article => {
    const url = article.url
    const fallback = { title: article.title, full_text: article.description || '', image_url: article.image_url, content_status: 'preview', message: 'This publisher could not be loaded here. Open the original article to continue reading.' }
    const requestId = ++readerRequest.current
    setIsReading(true); setReaderData(null); setReaderHindi(null); setReaderTranslating(false); setReaderUrl(url); setIsSpeaking(false); setSpeakLang('en'); stopSpeech()
    try {
      const res = await fetch(`${API}/api/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()
      if (requestId !== readerRequest.current) return
      if (data.status === 'success') { setReaderData({ ...fallback, ...data.data, title: data.data.title || article.title }); setReaderUrl(data.data.url || url) }
      else setReaderData({ ...fallback, message: data.message || fallback.message })
    } catch {
      if (requestId !== readerRequest.current) return
      setReaderData(fallback)
    }
  }

  const closeReader = () => { ++readerRequest.current; setIsReading(false); stopSpeech(); setIsSpeaking(false); setReaderHindi(null); }

  const handleTranslateReader = async () => {
    if (readerHindi) {
      setReaderHindi(null) // Toggle back to English
      return
    }
    setReaderTranslating(true)
    const title = await translateToHindi(readerData.title)
    const summary = readerData.ai_summary ? await translateToHindi(readerData.ai_summary) : null
    const full = await translateToHindi(readerData.full_text)

    if (title || full) {
      setReaderHindi({ title: title || readerData.title, ai_summary: summary, full_text: full || readerData.full_text })
    } else {
      addToast('Translation failed.', 'error')
    }
    setReaderTranslating(false)
  }

  // TTS with language support
  const toggleSpeech = async (lang = 'en') => {
    if (isSpeaking && speakLang === lang) {
      stopSpeech(); setIsSpeaking(false); return
    }
    if (!readerData) return
    stopSpeech()

    // Speak the AI summary if available. Fallback to first part of text so it doesn't try to read forever.
    let textToSpeak = readerData.ai_summary
      ? `${readerData.title}. Summary: ${readerData.ai_summary}`
      : `${readerData.title}. ${readerData.full_text?.slice(0, 1000) || ''}`

    if (lang === 'hi') {
      if (readerHindi) {
        textToSpeak = readerHindi.ai_summary ? `${readerHindi.title}. ${readerHindi.ai_summary}` : `${readerHindi.title}. ${readerHindi.full_text?.slice(0, 1000) || ''}`
      } else {
        addToast('Translating to Hindi for speech…', 'info', 2000)
        const hindiText = await translateToHindi(textToSpeak)
        if (!hindiText) { addToast('Translation failed.', 'error'); return }
        textToSpeak = hindiText
      }
    }

    setSpeakLang(lang)
    setIsSpeaking(true)
    speak(textToSpeak, lang, () => setIsSpeaking(false))
  }

  const [featured, ...rest] = displayArticles

  const switchTab = slug => {
    setActiveTab(slug)
    setSearchActive(false)
    setSearchQuery('')
    setMoreOpen(false)
    setTranslations({})
  }

  const showLoadMore = hasMore

  return (
    <div className="app-container">
      {/* Toasts */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast--${t.type}`} onClick={() => removeToast(t.id)}>{t.message}</div>
        ))}
      </div>

      {authOpen && <AuthModal configured={configured}
        onClose={() => { setAuthOpen(false); setPendingSave(null) }}
        onSuccess={() => setAuthOpen(false)} />}
      {/* Header */}
      <header className="site-header">
        <div className="header-top">
          <div className="header-logo">
            <span className="logo-mark">UP</span>
            <div className="logo-text">
              <span className="logo-title">UpFeed</span>
              <span className="logo-sub">A little perspective. Every day.</span>
            </div>
          </div>
          <div className="header-controls">
            {user ? <div className="account-controls"><span title={user.email}>{user.email}</span><button onClick={signOut}>Sign out</button></div>
              : <button className="account-button" disabled={authLoading} onClick={() => setAuthOpen(true)}>{authLoading ? 'Loading account…' : 'Sign in'}</button>}
            <div className="search-wrap">
              <input aria-label="Search stories" className="search-input" placeholder="Search stories…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') runSearch(searchQuery)
                  if (e.key === 'Escape') { setSearchQuery(''); setSearchActive(false) }
                }}
              />
              {searchQuery && <button aria-label="Clear search" className="search-clear" onClick={() => { setSearchQuery(''); setSearchActive(false) }}>×</button>}
              <button className="search-icon" aria-label="Submit search" onClick={() => runSearch(searchQuery)}><Search size={18} /></button>
            </div>
            <button aria-label={darkMode ? "Switch to light theme" : "Switch to dark theme"} className="theme-toggle" onClick={() => setDarkMode(d => !d)}>
              {darkMode ? <Sun size={19} /> : <Moon size={19} />}
            </button>
          </div>
        </div>

        <nav className="genre-tabs">
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
            onClick={() => switchTab('saved')}><Bookmark size={14} /> Saved</button>

          {/* Sort pills */}
          {!isSavedView && !searchActive && (
            <>
              <div className="tab-divider" />
              <div className="sort-pills">
                {['latest', 'hot', 'trending', 'top'].map(s => (
                  <button key={s} className={`sort-pill ${sortMode === s ? 'active' : ''}`}
                    onClick={() => setSortMode(s)}>
                    {s === 'latest' ? 'Latest' : s === 'hot' ? 'Popular' : s === 'trending' ? 'Trending' : 'Top'}
                  </button>
                ))}
              </div>

            </>
          )}

          {/* Collection filter tabs in saved view */}
          {isSavedView && (
            <>
              <div className="tab-divider" />
              <div className="coll-tabs">
                <button className={`coll-tab ${activeColl === null ? 'active' : ''}`} onClick={() => setActiveColl(null)}>All</button>
                {collections.map(c => (
                  <span key={c.id} className="collection-tab-group">
                  <button className={`coll-tab ${activeColl === c.id ? 'active' : ''}`}
                    onClick={() => setActiveColl(c.id)}
                    style={activeColl === c.id ? { borderColor: c.color, color: c.color } : {}}>
                    <span className="col-dot" style={{ background: c.color }} />{c.name}
                  </button>
                  <button className="coll-tab collection-delete" aria-label={`Delete collection ${c.name}`}
                    title={`Delete collection ${c.name}`} disabled={busyIds.includes(`collection-${c.id}`)}
                    onClick={() => removeCollection(c)}>{busyIds.includes(`collection-${c.id}`) ? '…' : '×'}</button>
                  </span>
                ))}
              </div>
            </>
          )}
        </nav>
      </header>

      {showWelcome && user && <section className="welcome-banner" role="status">
        <span className="welcome-check" aria-hidden="true">✓</span>
        <div><strong>Welcome to your reading room.</strong><p>You’re signed in. Discover a story and save something worth coming back to.</p></div>
        <button onClick={() => setShowWelcome(false)}>Start reading <span aria-hidden="true">→</span></button>
      </section>}
      <section className="edition-heading">
        <div>
          <div className="edition-kicker"><span /> THE DAILY PERSPECTIVE <span className="edition-date">{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}</span></div>
          <h1>{searchActive ? 'Follow your curiosity.' : isSavedView ? 'Your reading room.' : 'A world worth reading.'}</h1>
          <p>{searchActive ? `Stories matching “${committedQuery}”` : isSavedView ? 'Good stories, saved for a quieter moment.' : 'Fresh headlines, thoughtful summaries, and the stories that matter to you.'}</p>
        </div>
        <div className="edition-status">
          <button className="refresh-button" disabled={loading} onClick={() => fetchNews()}><RefreshCw size={15} className={loading ? 'spin' : ''} />{freshAvailable ? 'Check latest stories' : 'Refresh feed'}</button>
          {updatedAt && <span>{fromCache ? 'Edition checked' : 'Updated'} {new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
      </section>
      <div className="feed-section-label"><span>{searchActive ? 'Search results' : isSavedView ? 'Saved stories' : `${activeTabLabel} / ${sortMode === 'latest' ? 'The latest' : sortMode}`}</span><span>{displayArticles.length ? `${displayArticles.length} stories loaded` : 'YOUR NEXT GOOD READ'}</span></div>
      {feedError && <div className="feed-error" role="alert"><span>{feedError}</span><button onClick={() => displayArticles.length && hasMore ? loadMore() : fetchNews()}>Try again</button><button onClick={() => fetchNews()}>Start fresh</button></div>}
      {/* Body */}
      {isSavedView && !searchActive && !user ? (
        <section className="saved-signin"><Bookmark size={32} /><h2>Your stories, all in one place.</h2><p>Sign in to save news and build your own collections.</p><button className="auth-submit" disabled={authLoading} onClick={() => setAuthOpen(true)}>Sign in to view saved stories</button></section>
      ) : loading ? (
        <div className="loader-container" role="status">
          <div className="loader-bar" />
          <p className="loader-text">{searchActive ? 'Searching…' : 'Fetching latest stories…'}</p>
        </div>
      ) : displayArticles.length === 0 ? (
        <div className="empty-state">
          {searchActive ? <p>No results for "<strong>{searchQuery}</strong>"</p> : <p>{isSavedView ? "Your reading list starts here. Save a story to find it here later." : "No stories found. Try another topic or refresh the feed."}</p>}
        </div>
      ) : (
        <main className="feed">
          {featured && (
            <ArticleCard article={featured} hero isSavedView={isSavedView} busyIds={busyIds}
              translation={translations[featured.id || featured.url]}
              onRead={handleRead} onSave={requestSave} savedUrls={savedUrls} onRemove={removeBookmark}
              onShare={a => shareArticle(a.title, a.url, addToast)}
              onTranslate={handleTranslate} onClearTranslation={clearTranslation} />
          )}
          {rest.length > 0 && (
            <div className="news-grid">
              {rest.map(article => (
                <ArticleCard key={article.id || article.url} article={article}
                  isSavedView={isSavedView} busyIds={busyIds}
                  translation={translations[article.id || article.url]}
                  onRead={handleRead} onSave={requestSave} savedUrls={savedUrls} onRemove={removeBookmark}
                  onShare={a => shareArticle(a.title, a.url, addToast)}
                  onTranslate={handleTranslate} onClearTranslation={clearTranslation} />
              ))}
            </div>
          )}

          {showLoadMore && !loadingMore && <button className="load-more-button" onClick={loadMore}>Load more stories <ArrowUpRight size={16} /></button>}
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="scroll-sentinel" />

          {/* Load more spinner */}
          {loadingMore && (
            <div className="load-more-spinner">
              <div className="loading-spinner" />
              <span>Loading more stories…</span>
            </div>
          )}

          {/* End of feed */}
          {!showLoadMore && !loadingMore && displayArticles.length > 0 && (
            <div className="end-of-feed">You’ve reached the end of this edition. Check back for more.</div>
          )}
        </main>
      )}

      <footer className="site-footer"><span><strong>UpFeed</strong> / Stay curious.</span><span>Read a little. Understand more.</span><button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top ↑</button></footer>
      {/* Collection picker */}
      {user && (collPickerFor || pendingSave) && (
        <CollectionModal collections={collections}
          onSelect={id => saveBookmark(collPickerFor || pendingSave, id)}
          onCreateNew={createCollection}
          onClose={() => { setCollPickerFor(null); setPendingSave(null) }} />
      )}

      {/* Reader modal */}
      {isReading && (
        <div className="overlay" inert={authOpen || Boolean(user && (collPickerFor || pendingSave))} onClick={closeReader}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Article reader" onClick={e => e.stopPropagation()}>
            <button className="modal__close close-x" onClick={closeReader}>✕</button>
            {!readerData ? (
              <div className="modal-loading"><div className="loading-spinner" /><p>Extracting & summarising…</p></div>
            ) : (
              <div className="modal-body">
                <div className="modal-header">
                  <span className="modal-label">Article reader</span>
                  <a className="reader-original" href={readerUrl} target="_blank" rel="noopener noreferrer">Open original article <ArrowUpRight size={16} /></a>
                  {readerData.content_status === 'preview' && <p className="reader-notice" role="status">{readerData.message}</p>}
                  {readerData.image_url && <img className="reader-image" src={readerData.image_url} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none' }} />}
                  <h2 className={`modal-title ${readerHindi ? 'card__title--hindi' : ''}`}>{readerHindi ? readerHindi.title : readerData.title}</h2>
                  <div className="modal-actions">
                    {/* English TTS */}
                    <button
                      className={`tts-btn ${isSpeaking && speakLang === 'en' ? 'tts-btn--active' : ''}`}
                      onClick={() => toggleSpeech('en')}
                      title="Listen to summary in English"
                    >
                      {isSpeaking && speakLang === 'en' ? '⏹ Stop' : '▶ Listen'}
                    </button>
                    {/* Hindi TTS */}
                    <button
                      className={`tts-btn tts-btn--hindi ${isSpeaking && speakLang === 'hi' ? 'tts-btn--active' : ''}`}
                      onClick={() => toggleSpeech('hi')}
                      title="Listen to summary in Hindi"
                    >
                      {isSpeaking && speakLang === 'hi' ? '⏹ रुकें' : '▶ हिंदी'}
                    </button>
                    {/* Translate Text Button */}
                    <button
                      className={`tts-btn ${readerHindi ? 'tts-btn--active' : ''}`}
                      onClick={handleTranslateReader}
                      disabled={readerTranslating}
                      title="Translate article text to Hindi"
                    >
                      {readerTranslating ? 'अ Translating...' : (readerHindi ? 'A Show English' : 'अ Translate Text')}
                    </button>

                    <button className="share-btn-modal" onClick={() => shareArticle(readerData.title, readerUrl, addToast)}>↗ Share</button>
                    <button className="save-btn-modal" onClick={() => requestSave({ title: readerData.title, url: readerUrl, image_url: readerData.image_url, ai_summary: readerData.ai_summary })}>⊙ Save</button>
                  </div>
                </div>
                {(readerHindi ? readerHindi.ai_summary : readerData.ai_summary) && (
                  <div className="modal-summary">
                    <div className="summary-header"><span className="summary-icon">✦</span><span className="summary-title">{readerHindi ? 'सारांश (Summary)' : 'Quick summary'}</span></div>
                    <p className={readerHindi ? 'card__title--hindi' : ''}>{readerHindi ? readerHindi.ai_summary : readerData.ai_summary}</p>
                  </div>
                )}
                <div className="modal-divider" />
                <div className="modal-full-text">
                  <h4 className="full-text-label">{readerHindi ? 'पूरा लेख' : readerData.content_status === 'preview' ? 'Article preview' : 'Article text'}</h4>
                  <p className={readerHindi ? 'card__title--hindi' : ''}>{readerHindi ? readerHindi.full_text : readerData.full_text}</p>
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
function ArticleCard({ article, hero, isSavedView, busyIds, savedUrls, translation, onRead, onSave, onRemove, onShare, onTranslate, onClearTranslation }) {
  const key = article.id || article.url
  const isBusy = busyIds.includes(key)
  const isBookmarked = savedUrls?.has(article.url)
  const [failedImage, setFailedImage] = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const imageRef = useRef(null)
  const directImage = article.image_url
  const imageUrl = previewImage?.url === article.url ? previewImage.image : directImage
  const imageFailed = !imageUrl || failedImage === imageUrl
  useEffect(() => {
    if (directImage && failedImage !== directImage) return
    const controller = new AbortController()
    const element = imageRef.current
    if (!element) return
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      observer.disconnect()
      fetch(`${API}/api/article-preview?url=${encodeURIComponent(article.url)}`, { signal: controller.signal })
        .then(r => r.json()).then(data => {
          if (!controller.signal.aborted) setPreviewImage({ url: article.url, image: data.data?.image_url })
        }).catch(() => {})
    }, { rootMargin: '100px' })
    observer.observe(element)
    return () => { controller.abort(); observer.disconnect() }
  }, [article.url, directImage, failedImage])
  const published = article.published_at && !Number.isNaN(Date.parse(article.published_at)) ? new Date(article.published_at) : null

  const isTranslated = translation && translation.text
  const isTranslating = translation && translation.loading

  const handleTranslateClick = e => {
    e.stopPropagation()
    if (isTranslated) {
      onClearTranslation(key)
    } else {
      onTranslate(key, `${article.title}. ${article.description || ''}`)
    }
  }

  const displayTitle = isTranslated ? translation.text.split('.')[0] : article.title
  const displayDesc = isTranslated
    ? translation.text.split('.').slice(1).join('.').trim()
    : article.description

  if (hero) {
    return (
      <article className="card card--hero" onClick={() => onRead(article)}>
        <div ref={imageRef} className="card__img-wrap card__img-wrap--hero">
          {!imageFailed ? <img referrerPolicy="no-referrer" src={imageUrl} alt="" loading={hero ? 'eager' : 'lazy'} onError={() => setFailedImage(imageUrl)} /> : <div className="story-placeholder"><Newspaper size={hero ? 68 : 40} strokeWidth={1} /><span>{article.source || 'The daily perspective'}</span><small>UPFEED / THE READING ROOM</small></div>}
          <div className="card__img-fade" />
        </div>
        <div className="card__body card__body--hero">
          <span className="card__label">In focus</span>
          <h2 className={`card__title card__title--hero ${isTranslated ? 'card__title--hindi' : ''}`}>{displayTitle}</h2>
          {displayDesc && <p className="card__desc">{displayDesc}</p>}
          <div className="story-meta"><span className="card__source">{article.source || 'Saved story'}</span>{published && <time dateTime={published.toISOString()} title={published.toLocaleString()}>{published.toLocaleDateString([], { month: 'short', day: 'numeric' })} · {published.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
          <div className="card__actions">
            <a className="source-link" href={article.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} aria-label="Open original article"><ArrowUpRight size={16} /></a>
            <button className="read-btn">Read & Summarize →</button>
            <button
              className={`icon-btn icon-btn--translate ${isTranslated ? 'icon-btn--translated' : ''}`}
              onClick={handleTranslateClick}
              disabled={isTranslating}
              title={isTranslated ? 'Show original' : 'Translate to Hindi'}
            >
              {isTranslating ? '…' : isTranslated ? 'A' : 'अ'}
            </button>
            {isSavedView ? (
              <button className="icon-btn icon-btn--remove" onClick={e => { e.stopPropagation(); onRemove(article.id) }} disabled={isBusy}>{isBusy ? '…' : '✕ Remove'}</button>
            ) : (
              <>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); onSave(article) }} disabled={isBusy} title={isBookmarked ? "Saved — change collection" : "Save story"} aria-label={isBookmarked ? "Saved — change collection" : "Save story"} aria-pressed={isBookmarked}>{isBusy ? '…' : isBookmarked ? '✓' : '⊙'}</button>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); onShare(article) }} title="Share">↗</button>
              </>
            )}
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="card card--grid" onClick={() => onRead(article)}>
      <div ref={imageRef} className="card__img-wrap">
        {!imageFailed ? <img referrerPolicy="no-referrer" src={imageUrl} alt="" loading={hero ? 'eager' : 'lazy'} onError={() => setFailedImage(imageUrl)} /> : <div className="story-placeholder"><Newspaper size={hero ? 68 : 40} strokeWidth={1} /><span>{article.source || 'The daily perspective'}</span><small>UPFEED / THE READING ROOM</small></div>}
      </div>
      <div className="card__body">
        <h3 className={`card__title ${isTranslated ? 'card__title--hindi' : ''}`}><button className="title-button" onClick={e => { e.stopPropagation(); onRead(article) }}>{displayTitle}</button></h3>
        {displayDesc && <p className="card__desc card__desc--grid">{displayDesc}</p>}
        <div className="story-meta"><span className="card__source">{article.source || 'Saved story'}</span>{published && <time dateTime={published.toISOString()} title={published.toLocaleString()}>{published.toLocaleDateString([], { month: 'short', day: 'numeric' })} · {published.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
        <div className="card__actions">
            <a className="source-link" href={article.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} aria-label="Open original article"><ArrowUpRight size={16} /></a>
          <button
            className={`icon-btn icon-btn--translate ${isTranslated ? 'icon-btn--translated' : ''}`}
            onClick={handleTranslateClick}
            disabled={isTranslating}
            title={isTranslated ? 'Show original' : 'Translate to Hindi'}
          >
            {isTranslating ? '…' : isTranslated ? 'A' : 'अ'}
          </button>
          {isSavedView ? (
            <button className="icon-btn icon-btn--remove" onClick={e => { e.stopPropagation(); onRemove(article.id) }} disabled={isBusy}>{isBusy ? '…' : '✕'}</button>
          ) : (
            <>
              <button className="icon-btn" onClick={e => { e.stopPropagation(); onSave(article) }} disabled={isBusy} title={isBookmarked ? "Saved — change collection" : "Save story"} aria-label={isBookmarked ? "Saved — change collection" : "Save story"} aria-pressed={isBookmarked}>{isBusy ? '…' : isBookmarked ? '✓' : '⊙'}</button>
              <button className="icon-btn" onClick={e => { e.stopPropagation(); onShare(article) }} title="Share">↗</button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}
