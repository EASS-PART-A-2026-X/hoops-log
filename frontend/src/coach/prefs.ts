/** Whether he may speak up on his own. Kept in localStorage (the app works when that is blocked). */
const KEY = 'coach-chatter'
let on = read()
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function isChatterOn(): boolean {
  return on
}

export function setChatterOn(value: boolean): void {
  on = value
  try {
    window.localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    /* only means the choice is not remembered */
  }
  for (const l of listeners) l()
}

export function subscribeChatter(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
