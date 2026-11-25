import { useState } from 'react'

/** The way out, in the top bar next to the sound button: ends this login on the server and shows the login screen. */
export default function LogoutButton({ name, onLogout }: { name: string | null; onLogout: () => void }) {
  const [busy, setBusy] = useState(false)
  const label = name ? `Log out ${name}` : 'Log out'
  return (
    <button
      type="button"
      className="mute-btn account-btn"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        onLogout()
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4" />
        <path d="M16 8l4 4-4 4M20 12H9" />
      </svg>
    </button>
  )
}
