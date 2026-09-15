import { useCallback, useEffect, useRef, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

export default function useFeed(path, accessToken = null, enabled = true) {
  const scopeKey = `${path}:${accessToken || 'public'}`
  const [state, setState] = useState({ articles: [], loading: true, loadingMore: false, error: '', hasMore: false })
  const request = useRef(null)
  const pageRef = useRef({ page: 1, after: null })
  const scope = useRef(path)

  const load = useCallback(async (more = false, refresh = false) => {
    if (!enabled) return
    if (more && (request.current || !pageRef.current.page)) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    scope.current = path
    const page = more ? pageRef.current.page : 1
    const params = new URLSearchParams({ page: String(page) })
    if (more && pageRef.current.after) params.set('after', pageRef.current.after)
    if (refresh) params.set('refresh', 'true')
    setState(prev => ({ ...prev, error: '', loading: !more, loadingMore: more }))
    const timeout = setTimeout(() => controller.abort('timeout'), 45000)
    try {
      const response = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}${params}`, {
        signal: controller.signal, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      })
      const result = await response.json()
      if (!response.ok || result.status !== 'success') throw new Error(result.detail || result.message || 'Could not load stories.')
      if (request.current !== controller || scope.current !== path) return
      pageRef.current = { page: result.next_page, after: result.next_after }
      setState(prev => {
        const articles = more ? [...prev.articles] : []
        const seen = new Set(articles.map(a => a.url || a.id))
        for (const article of result.data || []) {
          const key = article.url || article.id
          if (!seen.has(key)) { seen.add(key); articles.push(article) }
        }
        return { articles, scopeKey, loading: false, loadingMore: false, error: '',
          hasMore: Boolean(result.has_more && result.next_page),
          updatedAt: result.updated_at, fromCache: result.from_cache }
      })
    } catch (error) {
      if (request.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return
      setState(prev => ({ ...prev, scopeKey, loading: false, loadingMore: false,
        error: controller.signal.reason === 'timeout' ? 'The news sources took too long. Please try again.' : error.message }))
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) request.current = null
    }
  }, [path, accessToken, enabled, scopeKey])

  useEffect(() => {
    request.current?.abort()
    request.current = null
    pageRef.current = { page: 1, after: null }
    const timer = setTimeout(() => {
      setState({ articles: [], loading: enabled, loadingMore: false, error: '', hasMore: false })
      load()
    }, 0)
    return () => { clearTimeout(timer); request.current?.abort(); request.current = null }
  }, [load, enabled])

  const refresh = useCallback(() => load(false, true), [load])
  const loadMore = useCallback(() => load(true), [load])
  const setArticles = useCallback(update => setState(prev => ({ ...prev,
    articles: typeof update === 'function' ? update(prev.articles) : update })), [])
  const visible = enabled && state.scopeKey === scopeKey ? state : { articles: [], loading: enabled, loadingMore: false, error: '', hasMore: false }
  return { ...visible, refresh, loadMore, setArticles }
}
