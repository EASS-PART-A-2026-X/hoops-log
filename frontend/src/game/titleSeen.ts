/** How long the iris wipe takes: the screen is removed after it. */
export const LEAVE_MS = 900
const SESSION_KEY = 'hoops-title-seen'

/** The title screen shows once per browser tab (open the page with ?title to see it again). */
export function shouldShowTitle(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('title')) return true
    return window.sessionStorage.getItem(SESSION_KEY) !== '1'
  } catch {
    return true
  }
}

export function markSeen(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* not remembered, so it shows again next time */
  }
}
