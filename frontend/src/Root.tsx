import { useCallback, useEffect, useRef, useState } from 'react'
import App from './App'
import { fetchMe, logoutAccount } from './api'
import type { User } from './api'
import AuthScreen from './auth/AuthScreen'
import { currentToken, onSessionEnded } from './auth/session'
import { shouldShowTitle } from './game/titleSeen'
import TitleScreen from './TitleScreen'

const ENDED = 'Your login ended. Please log in again.'

/**
 * What comes first: the title screen, then (unless you are already logged in) the login screen, then the app.
 *
 * A returning visitor with a working login goes straight to the app, which shows its own title screen as before.
 * Everyone else sees PRESS START, then the login screen, which wipes away into the app once you are in.
 */
export default function Root() {
  // A stored token has to be checked with the backend before the app is shown.
  const [checking, setChecking] = useState(() => currentToken() !== null)
  const [signedIn, setSignedIn] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  // The title screen the app shows itself is only for a visitor who arrives already logged in.
  const [ownTitle, setOwnTitle] = useState(false)
  const [titleVisible, setTitleVisible] = useState(() => currentToken() === null && shouldShowTitle())
  const [titleStarted, setTitleStarted] = useState(false)
  const [authShown, setAuthShown] = useState(() => currentToken() === null)
  // Bumped every time the login screen opens again, so it starts with an empty form. The ref always holds the
  // latest number: a login screen that has been replaced must not hide the new one when its wipe timer fires late.
  const [authRun, setAuthRun] = useState(0)
  const authRunRef = useRef(0)
  const openAuth = useCallback(() => {
    authRunRef.current += 1
    setAuthRun(authRunRef.current)
    setAuthShown(true)
  }, [])
  const [notice, setNotice] = useState<string | null>(null)
  // The login ended while the app was open: it stays mounted underneath, so a half-typed shot is not lost.
  const [ended, setEnded] = useState(false)
  // True for a moment after a login, so the court makes its entrance once the login screen starts to leave.
  const [hold, setHold] = useState(false)
  const userRef = useRef<User | null>(null)
  useEffect(() => {
    userRef.current = user
  })

  // On load: is the stored token still good?
  useEffect(() => {
    if (currentToken() === null) return
    let cancelled = false
    void fetchMe()
      .then((me) => {
        if (cancelled) return
        if (me) {
          setUser(me)
          setSignedIn(true)
          setOwnTitle(true)
        } else {
          setNotice(ENDED)
          setTitleVisible(shouldShowTitle())
          setAuthShown(true)
        }
      })
      .catch(() => {
        // The backend cannot be reached, so the token cannot be checked. Show the app: it says plainly
        // that it cannot reach the backend, and works again once the backend is back.
        if (cancelled) return
        setSignedIn(true)
        setOwnTitle(true)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Any request that finds the login over puts the login screen on top of the app.
  useEffect(
    () =>
      onSessionEnded(() => {
        setNotice(ENDED)
        setEnded(true)
        openAuth()
      }),
    [openAuth],
  )

  useEffect(() => {
    if (!hold) return
    const timer = window.setTimeout(() => setHold(false), 80)
    return () => window.clearTimeout(timer)
  }, [hold])

  const logout = useCallback(async () => {
    await logoutAccount()
    setSignedIn(false)
    setUser(null)
    setEnded(false)
    setNotice(null)
    setOwnTitle(false)
    openAuth()
  }, [openAuth])

  function authenticated(next: User) {
    const same = ended && userRef.current?.id === next.id
    setUser(next)
    setSignedIn(true)
    setEnded(false)
    setNotice(null)
    if (!same) setHold(true)
  }

  if (checking) return <div className="boot" role="status" aria-label="Loading" />

  return (
    <>
      {authShown && (!titleVisible || titleStarted) && (
        <AuthScreen
          key={authRun}
          notice={notice}
          autoFocus={!titleVisible}
          onAuthenticated={authenticated}
          onDone={() => {
            if (authRunRef.current === authRun) setAuthShown(false)
          }}
        />
      )}
      {titleVisible && (
        <TitleScreen stats={null} onStart={() => setTitleStarted(true)} onDone={() => setTitleVisible(false)} />
      )}
      {signedIn && (
        // A different account gets a fresh app (key); the same one after an ended login keeps its state.
        <div inert={ended || (titleVisible && !titleStarted)} style={{ display: 'contents' }}>
          <App key={user?.id ?? 'unknown'} user={user} onLogout={() => void logout()} skipTitle={!ownTitle} hold={hold} />
        </div>
      )}
    </>
  )
}
