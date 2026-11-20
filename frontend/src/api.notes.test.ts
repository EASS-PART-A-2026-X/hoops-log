import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, BACKEND_URL, NOTES_TIMEOUT_MS, extractNotes } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}
const GOOD = { proposals: [], questions: [], skipped: [], model: 'm' }

describe('extractNotes', () => {
  it('posts the text and the date to /notes/extract and returns the answer', async () => {
    const fetch = stubFetch(async () => reply(200, GOOD))
    await expect(extractNotes('hit one', '2026-11-20')).resolves.toEqual(GOOD)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${BACKEND_URL}/notes/extract`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'hit one', today: '2026-11-20' })
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it.each([429, 502, 503, 504])('shows the backends own sentence for a %i', async (status) => {
    stubFetch(async () => reply(status, { detail: 'A plain sentence from the backend.' }))
    const error = await extractNotes('x', '2026-11-20').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('unavailable')
    expect((error as ApiError).message).toBe('A plain sentence from the backend.')
  })

  it('does not show a detail that is not a sentence (a proxys JSON, say)', async () => {
    stubFetch(async () => reply(503, { detail: { code: 17 } }))
    const error = (await extractNotes('x', '2026-11-20').catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('server')
    expect(error.message).toBe('The server had a problem (status 503). Try again.')
  })

  it('turns a 422 into words', async () => {
    stubFetch(async () => reply(422, { detail: [{ loc: ['body', 'text'], msg: 'String should have at most 2000 characters' }] }))
    const error = (await extractNotes('x', '2026-11-20').catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe('Please fix: text: String should have at most 2000 characters')
  })

  it('refuses an answer that is not the expected shape', async () => {
    for (const bad of [{ proposals: 'none', questions: [], skipped: [], model: 'm' }, { proposals: [], skipped: [] }, [], 'text']) {
      stubFetch(async () => reply(200, bad))
      const error = (await extractNotes('x', '2026-11-20').catch((e: unknown) => e)) as ApiError
      expect(error.kind).toBe('server')
    }
  })

  it('says the backend cannot be reached when the request fails', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const error = (await extractNotes('x', '2026-11-20').catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('unreachable')
  })

  it('waits 90 seconds, not the 10 seconds of the other calls', async () => {
    vi.useFakeTimers()
    stubFetch((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const pending = extractNotes('x', '2026-11-20').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(NOTES_TIMEOUT_MS - 1000)
    let settled = false
    void pending.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false) // still waiting after 89 s
    await vi.advanceTimersByTimeAsync(1000)
    const error = (await pending) as ApiError
    expect(error.kind).toBe('timeout')
    expect(NOTES_TIMEOUT_MS).toBe(90_000)
  })
})
