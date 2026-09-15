import { useEffect, useRef, useState } from 'react'
import getSupabaseClient from './lib/supabase'

export default function AuthModal({ configured, onClose, onSuccess }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [resendAfter, setResendAfter] = useState(0)
  const modalRef = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    modalRef.current?.querySelector('input')?.focus()
    return () => previous?.focus()
  }, [])
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match. Please enter them again.')
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const client = await getSupabaseClient()
      if (!client) throw new Error('Account sign-in has not been configured yet.')
      const result = mode === 'signup'
        ? await client.auth.signUp({ email: email.trim(), password,
            options: { emailRedirectTo: `${window.location.origin}/?welcome=1` } })
        : await client.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) {
        if (result.error.code === 'email_not_confirmed' || /email not confirmed/i.test(result.error.message)) {
          setNeedsConfirmation(true)
          throw new Error('Confirm your email before signing in. Open the confirmation link in your inbox or spam folder, then return here.')
        }
        throw result.error
      }
      if (result.data.session) onSuccess()
      else if (mode === 'signup') { setNeedsConfirmation(true); setMessage('Check your email to confirm your account, then sign in here.'); setMode('signin'); setPassword(''); setConfirmPassword('') }
      else throw new Error('Sign-in did not finish. Please try again.')
    } catch (err) { setError(err.message || 'Sign-in failed. Please try again.') }
    finally { setBusy(false) }
  }
  const resendConfirmation = async () => {
    if (busy) return
    if (!email.trim()) { setError('Enter your email address first.'); return }
    if (Date.now() < resendAfter) { setError('Please wait a minute before requesting another email.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const client = await getSupabaseClient()
      if (!client) throw new Error('Account sign-in has not been configured yet.')
      const { error: resendError } = await client.auth.resend({ type: 'signup', email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/?welcome=1` } })
      if (resendError) throw resendError
      setResendAfter(Date.now() + 60000)
      setMessage('If this account needs confirmation, a new link has been requested. Check your inbox and spam folder.')
    } catch (err) { setError(err.message || 'Could not request the email. Please try again.') }
    finally { setBusy(false) }
  }
  return <div className="overlay overlay--auth" onClick={() => !busy && onClose()}>
    <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" ref={modalRef}
      onClick={e => e.stopPropagation()} onKeyDown={e => {
        if (e.key === 'Escape' && !busy) onClose()
        if (e.key === 'Tab') {
          const controls = [...modalRef.current.querySelectorAll('button:not(:disabled), input, a[href]')]
          const first = controls[0], last = controls.at(-1)
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
        }
      }}>
      <button className="close-x auth-close" aria-label="Close sign in" disabled={busy} onClick={onClose}>×</button>
      <span className="edition-kicker">YOUR PERSONAL READING ROOM</span>
      <h2 id="auth-title">{mode === 'signup' ? 'Make yourself at home.' : 'Welcome back.'}</h2>
      <p>Sign in with your email and password to save stories and manage your collections.</p>
      {!configured ? <p role="alert">Sign-in is not configured yet. Add your Supabase URL and publishable key to the frontend settings.</p> :
        <form onSubmit={submit}>
          <label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
          <label>Password<input type="password" required minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
          {mode === 'signup' && <>
            <small>Use at least 8 characters.</small>
            <label>Confirm password<input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={busy} /></label>
          </>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}
          {needsConfirmation && <button className="auth-switch" type="button" disabled={busy} onClick={resendConfirmation}>Resend confirmation email</button>}
          <button className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
          <button className="auth-switch" type="button" disabled={busy} onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setMessage('') }}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
        </form>}
    </section>
  </div>
}
