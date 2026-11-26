// The login token lives in this one place: the API layer reads it for every request,
// and the app listens here to find out that the login ended.
//
// It is kept in localStorage so a reload (or tomorrow) keeps you logged in. The cost of
// that choice: any script running on this page could read it. React escapes every name
// and note it draws, and the e2e tests try HTML in names, but a stolen token is the
// price of "stay logged in". It stops working after 7 days or when you log out.

const KEY = 'hoops-token'

// Fallback for a browser that blocks storage, so a login still works until the tab closes.
let memory: string | null = null

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null // storage blocked: the app then asks for a login every time
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token)
  } catch {
    /* not remembered: still logged in until the page closes */
    memory = token
  }
}

export function clearToken(): void {
  memory = null
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* nothing stored, nothing to remove */
  }
}

export function currentToken(): string | null {
  return getToken() ?? memory
}

type Listener = () => void
const listeners = new Set<Listener>()

/** Called when a request finds that the login is no longer valid. Returns the way to stop listening. */
export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifySessionEnded(): void {
  for (const listener of [...listeners]) listener()
}
