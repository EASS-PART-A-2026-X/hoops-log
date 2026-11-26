// The checks the sign-up form runs before it asks the backend. They only save a round trip and
// say what is wrong early: the backend repeats every one of them and is the one that decides.

export const MIN_PASSWORD = 10
export const MAX_PASSWORD = 128

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME = /^[A-Za-z0-9_.-]{3,30}$/

export function checkEmail(value: string): string | null {
  const email = value.trim()
  if (email === '') return 'Enter your email.'
  if (email.length > 254 || !EMAIL.test(email)) return 'That does not look like an email address.'
  return null
}

export function checkUsername(value: string): string | null {
  const name = value.trim()
  if (name === '') return 'Pick a username.'
  if (!USERNAME.test(name)) return 'Use 3 to 30 letters, digits, _ . or - (no spaces).'
  return null
}

export function checkPassword(value: string, username = '', email = ''): string | null {
  if (value === '') return 'Enter a password.'
  if (value.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters (${value.length} so far).`
  if (value.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`
  const same = [username.trim(), email.trim().split('@')[0] ?? ''].map((s) => s.toLowerCase())
  if (same.includes(value.toLowerCase())) return 'The password cannot be your username or your email.'
  return null
}

export function checkConfirm(password: string, confirm: string): string | null {
  if (confirm === '') return 'Type the password again.'
  if (confirm !== password) return 'The two passwords do not match.'
  return null
}

export interface Strength {
  /** 0 to 4 bars. */
  bars: number
  label: string
}

/**
 * A rough guide, not a promise: length counts most, then how many kinds of characters are used.
 * The backend only enforces the length and a short list of common passwords.
 */
export function passwordStrength(value: string): Strength {
  if (value === '') return { bars: 0, label: '' }
  if (value.length < MIN_PASSWORD) return { bars: 1, label: 'TOO SHORT' }
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length
  const bars = 1 + (value.length >= 14 ? 1 : 0) + (kinds >= 2 ? 1 : 0) + (kinds >= 3 && value.length >= 12 ? 1 : 0)
  return { bars, label: ['', 'WEAK', 'OK', 'GOOD', 'STRONG'][bars] ?? '' }
}
