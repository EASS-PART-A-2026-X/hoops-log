// Every call to the backend lives here. The UI never builds URLs or reads raw
// responses: it gets typed data, or an ApiError whose message is safe to show.

import { clearToken, currentToken, notifySessionEnded, setToken } from './auth/session'

export type ShotType = '2PT' | '3PT'

/** What you send about a shot. There is no player: a shot is always your account's own. */
export interface ShotInput {
  x: number
  y: number
  made: boolean
  game_date: string
  note: string
}

export interface Shot extends ShotInput {
  id: number
  /** The account's username (or "Demo Player" in the demo): the server fills it in. */
  player: string
  zone: string
  shot_type: ShotType
}

export type ErrorKind = 'unreachable' | 'timeout' | 'invalid' | 'not_found' | 'server' | 'unauthorized' | 'conflict' | 'rate_limited'

export class ApiError extends Error {
  kind: ErrorKind
  /** The form field a conflict is about ("email" or "username"), when the backend says. */
  field?: string

  constructor(kind: ErrorKind, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.field = field
  }
}

export interface User {
  id: number
  email: string
  username: string
}

export interface Login {
  token: string
  token_type: string
  expires_at: string
  user: User
}

export interface RegisterInput {
  email: string
  username: string
  password: string
  password_confirm: string
}

// Vite exposes VITE_* variables to browser code at build time. The request leaves the
// user's browser, so this must be an address that works from the user's machine.
export const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'
).replace(/\/+$/, '')

// A browser fetch has no separate connect timeout, so one deadline covers the whole
// call, including reading the reply.
export const TIMEOUT_MS = 10_000
export const PAGE_SIZE = 100 // the backend's maximum page
export const MAX_PAGES = 50 // 5000 shots; past this the list is marked truncated

/** Turn FastAPI's 422 `detail` list into words, never raw JSON. */
export function describeValidation(detail: unknown): string {
  if (!Array.isArray(detail) || detail.length === 0) return 'The server rejected that input.'
  const parts = detail.map((item: unknown) => {
    const entry = (item ?? {}) as { loc?: unknown; msg?: unknown }
    const where = Array.isArray(entry.loc) ? entry.loc.at(-1) : undefined
    // Pydantic prefixes custom checks with "Value error, ": drop that jargon.
    const raw = typeof entry.msg === 'string' ? entry.msg : 'is not valid'
    const msg = raw.replace(/^Value error, /, '')
    if (where === undefined || where === 'body') return msg
    // Some messages already name the field ("game_date cannot be ..."): do not repeat it.
    return msg.startsWith(String(where)) ? msg : `${String(where)}: ${msg}`
  })
  return `Please fix: ${parts.join('; ')}`
}

/** The headers of one request: the content type when there is a body, and the login token when there is one. */
function headersFor(hasBody: boolean, token: string | null): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  // Only requests with a body need Content-Type; leaving it off keeps GETs simple.
  if (hasBody) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  return Object.keys(headers).length > 0 ? headers : undefined
}

/** Seconds to wait, from a 429's Retry-After header (a plain number of seconds). */
function waitFrom(response: Response): number | null {
  const seconds = Number(response.headers.get('Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null
}

interface Options {
  /** A login or register call: it carries no token, and a 401 there means "wrong password", not "session over". */
  anonymous?: boolean
  /** Logging out: a 401 only means the login was already over, which is what was asked for, so nobody is told. */
  quiet401?: boolean
}

async function request<T>(path: string, init: RequestInit = {}, options: Options = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const hasBody = init.body !== undefined
    const response = await fetch(BACKEND_URL + path, {
      ...init,
      signal: controller.signal,
      headers: headersFor(hasBody, options.anonymous ? null : currentToken()),
    })
    if (response.status === 204) return undefined as T
    const body: unknown = await response.json().catch(() => undefined)
    if (response.ok) {
      // A 2xx that is not JSON (a proxy's page, say) must not be passed on as data.
      if (body === undefined) {
        throw new ApiError('server', 'The server sent a reply this app could not read. Try again.')
      }
      return body as T
    }
    if (response.status === 401) {
      if (options.anonymous) throw new ApiError('invalid', 'Wrong username, email or password.')
      if (options.quiet401) throw new ApiError('unauthorized', 'Your login had already ended.')
      // The token is no good any more (expired, or ended on another device): forget it and tell the app.
      clearToken()
      notifySessionEnded()
      throw new ApiError('unauthorized', 'Your login ended. Please log in again.')
    }
    if (response.status === 409) {
      const detail = (body as { detail?: { field?: unknown; message?: unknown } })?.detail
      const field = typeof detail?.field === 'string' ? detail.field : undefined
      const message = typeof detail?.message === 'string' ? detail.message : 'That is already used.'
      throw new ApiError('conflict', message, field)
    }
    if (response.status === 429) {
      const wait = waitFrom(response)
      throw new ApiError('rate_limited', `Too many attempts. Try again in ${wait ?? 'a few'} seconds.`)
    }
    if (response.status === 422) {
      throw new ApiError('invalid', describeValidation((body as { detail?: unknown })?.detail))
    }
    if (response.status === 404) {
      throw new ApiError('not_found', 'That shot no longer exists. The list has been refreshed.')
    }
    throw new ApiError('server', `The server had a problem (status ${response.status}). Try again.`)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) {
      throw new ApiError('timeout', 'The server took too long to answer. Try again.')
    }
    throw new ApiError(
      'unreachable',
      `Can't reach the backend at ${BACKEND_URL}. Is it running?`,
    )
  } finally {
    clearTimeout(timer)
  }
}

export interface ShotListResult {
  shots: Shot[]
  /** True when there are more shots than this app loads (MAX_PAGES pages). */
  truncated: boolean
}

/** All shots, oldest id first. The backend pages at 100, so follow the pages. */
export async function listShots(): Promise<ShotListResult> {
  // Keyed by id: if another client writes while we page, an offset can repeat a row.
  const byId = new Map<number, Shot>()
  const fetchPage = async (offset: number, limit: number) => {
    const batch = await request<Shot[]>(`/shots?offset=${offset}&limit=${limit}`)
    if (!Array.isArray(batch)) {
      throw new ApiError('server', 'The server sent a reply this app could not read. Try again.')
    }
    return batch
  }
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(page * PAGE_SIZE, PAGE_SIZE)
    for (const shot of batch) byId.set(shot.id, shot)
    if (batch.length < PAGE_SIZE) return { shots: [...byId.values()], truncated: false }
  }
  // Every page was full. Truncated only if at least one more shot exists beyond them.
  const extra = await fetchPage(MAX_PAGES * PAGE_SIZE, 1)
  return { shots: [...byId.values()], truncated: extra.length > 0 }
}

export function createShot(input: ShotInput): Promise<Shot> {
  return request<Shot>('/shots', { method: 'POST', body: JSON.stringify(input) })
}

export function updateShot(id: number, input: ShotInput): Promise<Shot> {
  return request<Shot>(`/shots/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deleteShot(id: number): Promise<void> {
  return request<void>(`/shots/${id}`, { method: 'DELETE' })
}

// --- accounts ---------------------------------------------------------------------------

/** Make an account and log in (the token is kept for the next requests). */
export async function registerAccount(input: RegisterInput): Promise<User> {
  const login = await request<Login>('/auth/register', { method: 'POST', body: JSON.stringify(input) }, { anonymous: true })
  setToken(login.token)
  return login.user
}

/** Log in with a username or an email. */
export async function loginAccount(login: string, password: string): Promise<User> {
  const result = await request<Login>('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) }, { anonymous: true })
  setToken(result.token)
  return result.user
}

/** Who the stored token belongs to, or null when there is no token or it no longer works. */
export async function fetchMe(): Promise<User | null> {
  if (!currentToken()) return null
  try {
    return await request<User>('/auth/me')
  } catch (caught) {
    if (caught instanceof ApiError && caught.kind === 'unauthorized') return null
    throw caught
  }
}

/**
 * End this login on the server, then forget the token here. A server that cannot be reached still logs you out here
 * (an unreachable server must not trap you in the app), but then the token stays valid on the server until it expires
 * (7 days): it was only forgotten on this device. A 401 means it had already ended, so that is not an error either.
 */
export async function logoutAccount(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST' }, { quiet401: true })
  } catch {
    /* the token is dropped below either way */
  } finally {
    clearToken()
  }
}

/** The flat shot chart (SVG) for the no-WebGL fallback. An <img> cannot send the token, so it is fetched here. */
export async function fetchChartSvg(player: string): Promise<string> {
  const query = player ? `?player=${encodeURIComponent(player)}` : ''
  const token = currentToken()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${BACKEND_URL}/chart.svg${query}`, { signal: controller.signal, headers: headersFor(false, token) })
    if (response.status === 401) {
      clearToken()
      notifySessionEnded()
      throw new ApiError('unauthorized', 'Your login ended. Please log in again.')
    }
    if (!response.ok) throw new ApiError('server', `The server had a problem (status ${response.status}). Try again.`)
    return await response.text()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('unreachable', `Can't reach the backend at ${BACKEND_URL}. Is it running?`)
  } finally {
    clearTimeout(timer)
  }
}

/** The built-in demo: made-up shots (negative ids, never stored) to see what a full court looks like. */
export function listDemoShots(): Promise<Shot[]> {
  return request<Shot[]>('/demo/shots').then((shots) => {
    if (!Array.isArray(shots)) throw new ApiError('server', 'The server sent a reply this app could not read. Try again.')
    return shots
  })
}
