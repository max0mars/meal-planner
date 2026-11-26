import { useState, type FormEvent } from 'react'
import { ApiError, clearToken, request, setToken } from '../api/client'
import '../App.css'

/** Asked for once per browser: the token you chose for the planner's server. */
export default function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const [token, setTokenText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function connect(e: FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setMessage(null)
    setToken(token)
    try {
      await request('GET', '/api/settings/1')
      onConnected()
    } catch (err) {
      // 404 means the token was accepted and the planner has no settings yet, which is a fresh start.
      if (err instanceof ApiError && err.status === 404) {
        onConnected()
        return
      }
      clearToken() // do not keep a token that did not work
      if (err instanceof ApiError && err.status === 401) {
        setMessage('That is not the right token. Check it and try again.')
      } else if (err instanceof ApiError && err.status === 0) {
        setMessage('Could not reach the planner server. Check your internet connection and try again.')
      } else {
        setMessage(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      }
      setBusy(false)
    }
  }

  return (
    <main className="content" style={{ maxWidth: 420, margin: '48px auto', padding: '0 16px' }}>
      <h1>Connect to your planner</h1>
      <p>Enter the token you chose for the planner&rsquo;s server. This browser keeps it so you only need to do this once.</p>
      <form onSubmit={connect}>
        <div className="field">
          <label htmlFor="api-token">Token</label>
          <input id="api-token" className="input" type="password" autoComplete="off" value={token} onChange={(e) => setTokenText(e.target.value)} />
        </div>
        {message && (
          <p className="field-error" role="alert">
            {message}
          </p>
        )}
        <button className="btn-primary" type="submit" disabled={busy || !token.trim()}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </main>
  )
}
