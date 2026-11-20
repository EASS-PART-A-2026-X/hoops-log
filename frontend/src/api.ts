// Every call to the backend lives here. The UI never builds URLs or reads raw
// responses: it gets typed data, or an ApiError whose message is safe to show.

export type ShotType = '2PT' | '3PT'

export interface ShotInput {
  player: string
  x: number
  y: number
  made: boolean
  game_date: string
  note: string
}

export interface Shot extends ShotInput {
  id: number
  zone: string
  shot_type: ShotType
}

export type ErrorKind = 'unreachable' | 'timeout' | 'invalid' | 'not_found' | 'server' | 'unavailable' | 'cancelled'

export class ApiError extends Error {
  kind: ErrorKind

  constructor(kind: ErrorKind, message: string) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
  }
}

// Vite exposes VITE_* variables to browser code at build time. The request leaves the
// user's browser, so this must be an address that works from the user's machine.
export const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'
).replace(/\/+$/, '')

// A browser fetch has no separate connect timeout, so one deadline covers the whole
// call, including reading the reply.
export const TIMEOUT_MS = 10_000
// Reading notes goes through an AI model, which can take a while. The deadlines are nested so the
// inner one fires first (30 s a model call, 60 s the AI service, 70 s the backend, then this 90 s).
export const NOTES_TIMEOUT_MS = 90_000
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

interface RequestOptions {
  /** The deadline for the whole call; defaults to TIMEOUT_MS. */
  timeoutMs?: number
  /** Show the backend's own `detail` sentence for 429, 502, 503 and 504 (it writes them for people). */
  useDetail?: boolean
  /** Lets the caller give up early: the call then fails with kind 'cancelled'. */
  signal?: AbortSignal
}

async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS)
  const giveUp = () => controller.abort()
  if (options.signal?.aborted) giveUp()
  else options.signal?.addEventListener('abort', giveUp, { once: true })
  try {
    const hasBody = init.body !== undefined
    const response = await fetch(BACKEND_URL + path, {
      ...init,
      signal: controller.signal,
      // Only requests with a body need Content-Type; leaving it off keeps GETs simple.
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
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
    if (response.status === 422) {
      throw new ApiError('invalid', describeValidation((body as { detail?: unknown })?.detail))
    }
    if (response.status === 404) {
      throw new ApiError('not_found', 'That shot no longer exists. The list has been refreshed.')
    }
    if (options.useDetail && [429, 502, 503, 504].includes(response.status)) {
      const detail = (body as { detail?: unknown } | undefined)?.detail
      if (typeof detail === 'string') throw new ApiError('unavailable', detail)
    }
    throw new ApiError('server', `The server had a problem (status ${response.status}). Try again.`)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (options.signal?.aborted) throw new ApiError('cancelled', 'The request was cancelled.')
    if (controller.signal.aborted) {
      throw new ApiError('timeout', 'The server took too long to answer. Try again.')
    }
    throw new ApiError(
      'unreachable',
      `Can't reach the backend at ${BACKEND_URL}. Is it running?`,
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', giveUp)
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

/** A shot the AI found in the player's notes. NOT saved: the user confirms it first. */
export interface ProposedShot {
  x: number
  y: number
  made: boolean
  game_date: string
  note: string
  /** The words of the notes it came from. */
  quote: string
  /** Worked out by the backend from x and y, like for any saved shot. */
  zone: string
  shot_type: ShotType
}

export interface NotesResult {
  proposals: ProposedShot[]
  /** Things the AI could not tell and asks about. */
  questions: string[]
  /** Things in the notes that are not logged (free throws, assists...). */
  skipped: string[]
  /** Which model answered. "test" means a fake one. */
  model: string
}

/** Ask the backend (which asks the AI service) to read pasted notes. Saves nothing. */
export async function extractNotes(text: string, today: string, signal?: AbortSignal): Promise<NotesResult> {
  const result = await request<NotesResult>(
    '/notes/extract',
    { method: 'POST', body: JSON.stringify({ text, today }) },
    { timeoutMs: NOTES_TIMEOUT_MS, useDetail: true, signal },
  )
  if (!result || !Array.isArray(result.proposals) || !Array.isArray(result.questions) || !Array.isArray(result.skipped)) {
    throw new ApiError('server', 'The server sent a reply this app could not read. Try again.')
  }
  return result
}
