import { useEffect, useState } from 'react'
import getSupabaseClient from './supabase'

export default function useAuth() {
  const [state, setState] = useState({ session: null, loading: true, configured: true })
  useEffect(() => {
    let active = true
    let subscription
    getSupabaseClient().then(client => {
      if (!active) return
      if (!client) { setState({ session: null, loading: false, configured: false }); return }
      // INITIAL_SESSION also fires after restoring a session from storage.
      subscription = client.auth.onAuthStateChange((_event, session) => {
        if (active) setState({ session, loading: false, configured: true })
      }).data.subscription
    }).catch(() => { if (active) setState({ session: null, loading: false, configured: false }) })
    return () => { active = false; subscription?.unsubscribe() }
  }, [])
  return { ...state, user: state.session?.user || null }
}

export async function accountRequest(path, options = {}) {
  const { expectedUserId, ...requestOptions } = options
  const client = await getSupabaseClient()
  if (!client) throw new Error('Sign-in is not configured yet.')
  const { data, error } = await client.auth.getSession()
  if (error || !data.session) throw new Error('Please sign in to save stories.')
  const owner = data.session.user.id
  if (expectedUserId && owner !== expectedUserId) throw new Error('Your account changed. Please try again.')
  const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'}${path}`, {
    ...requestOptions,
    headers: { 'Content-Type': 'application/json', ...requestOptions.headers, Authorization: `Bearer ${data.session.access_token}` },
  })
  const result = await response.json()
  const current = await client.auth.getSession()
  if (current.data.session?.user.id !== owner) throw new Error('Your account changed. Please try again.')
  if (!response.ok || result.status !== 'success') {
    const message = typeof result.detail === 'string' ? result.detail : result.message
    throw new Error(message || 'Could not save your changes. Please try again.')
  }
  return result.data
}
