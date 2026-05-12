import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import './App.css'

const CATEGORIES = [
  { id: 'technology', label: 'Tech', icon: '⚡' },
  { id: 'worldnews', label: 'World', icon: '🌍' },
  { id: 'gaming', label: 'Gaming', icon: '🎮' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'business', label: 'Business', icon: '📈' },
]

function NewsCard({ item, index }) {
  const [imgError, setImgError] = useState(false)

  return (
    <article
      className="news-card"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="card-image-wrap">
        {item.image_url && !imgError ? (
          <img
            src={item.image_url}
            alt=""
            className="card-image"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="card-image-placeholder">
            <span className="placeholder-icon">📰</span>
          </div>
        )}
        <span className="card-source">{item.source}</span>
      </div>

      <div className="card-body">
        <h2 className="card-title">{item.title}</h2>
        {item.description && (
          <p className="card-desc">{item.description}</p>
        )}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="card-link"
        >
          Read full story
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 17L17 7M17 7H7M17 7v10"/>
          </svg>
        </a>
      </div>
    </article>
  )
}

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-img" />
      <div className="skeleton-body">
        <div className="skeleton skeleton-line w80" />
        <div className="skeleton skeleton-line w60" />
        <div className="skeleton skeleton-line w40" />
      </div>
    </div>
  )
}

function App() {
  const [news, setNews] = useState([])
  const [genre, setGenre] = useState('technology')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const feedRef = useRef(null)

  const fetchNews = async (selectedGenre) => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get(`http://localhost:8000/api/news/${selectedGenre}`)
      if (response.data.status === 'success') {
        setNews(response.data.data)
      } else {
        setNews([])
      }
    } catch (err) {
      console.error('Error fetching news:', err)
      setError('Could not load news. Make sure the backend is running.')
      setNews([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNews(genre)
  }, [genre])

  const handleCategoryChange = (id) => {
    setGenre(id)
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-mark">U</span>
            <span className="logo-text">pFeed</span>
          </div>
          <p className="tagline">Your daily signal, curated</p>
        </div>

        {/* Category Nav */}
        <nav className="category-nav" aria-label="News categories">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              className={`cat-btn ${genre === cat.id ? 'cat-btn--active' : ''}`}
              aria-current={genre === cat.id ? 'page' : undefined}
            >
              <span className="cat-icon" aria-hidden="true">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Feed */}
      <main className="feed" ref={feedRef}>
        {error && (
          <div className="error-banner" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : news.length > 0 ? (
          <div className="grid">
            {news.map((item, i) => (
              <NewsCard key={item.id ?? item.url ?? i} item={item} index={i} />
            ))}
          </div>
        ) : !error && (
          <div className="empty-state">
            <span className="empty-icon">🗞️</span>
            <p>No stories found for this category.</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App