'use client'

/**
 * The join call-to-action.
 *
 * Joining requires a session and the native experience, so the web landing's job is to
 * hand off to the app rather than reimplement auth in the browser. The button opens the
 * photu:// deep link, which +native-intent in the app maps to the in-app join screen.
 *
 * A pure <a href="photu://…"> is deliberately avoided: if the app is not installed the
 * browser shows an ugly "cannot open" error. Instead we trigger the scheme via a
 * hidden navigation and, if nothing took over the tab after a beat, reveal the store
 * links — the standard "did the app open?" fallback.
 */
import { useState } from 'react'

export function OpenInApp({ code }: { code: string }) {
  const [triedApp, setTriedApp] = useState(false)

  const open = () => {
    setTriedApp(true)
    // A timeout that only fires if the app did NOT take over the tab reveals the store
    // links; if the app opened, the page is backgrounded and the timer is throttled.
    window.location.href = `photu://join/${code}`
  }

  return (
    <div
      style={{ width: '100%', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <button
        onClick={open}
        style={{
          width: '100%',
          height: 52,
          border: 'none',
          borderRadius: 999,
          background: 'var(--accent)',
          color: 'var(--accent-ink)',
          fontSize: 16,
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
        }}
        type="button"
      >
        Open in the photu app
      </button>

      {triedApp && (
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>
          Don't have the app?{' '}
          <a href="https://photu.app" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Get photu
          </a>{' '}
          to join.
        </p>
      )}
    </div>
  )
}
