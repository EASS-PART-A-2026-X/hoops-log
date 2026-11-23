import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, BACKEND_URL, CHAT_TIMEOUT_MS, MAX_TURNS, SENT_TURNS, chatAvailable, sendChat } from './api'
import type { ChatTurn, StatsSummary } from './api'

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
const GOOD = { reply: 'Nice shooting.', proposals: [], model: 'm' }
const TURNS: ChatTurn[] = [{ role: 'user', text: 'how am I doing?' }]
const STATS: StatsSummary = { player: 'Yuly', attempts: 2, made: 1, fg_pct: 50, three_attempts: 0, three_made: 0, three_pct: null, zones: [], nba_fg: 47, nba_three: 36 }
const DAY = '2026-11-20'

describe('sendChat', () => {
  it('posts the conversation, the stats and the date to /chat and returns the answer', async () => {
    const fetch = stubFetch(async () => reply(200, GOOD))
    await expect(sendChat(TURNS, STATS, DAY)).resolves.toEqual(GOOD)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${BACKEND_URL}/chat`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ messages: TURNS, stats: STATS, today: DAY })
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('leaves the stats out when there are none (an empty log)', async () => {
    const fetch = stubFetch(async () => reply(200, GOOD))
    await sendChat(TURNS, null, DAY)
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ messages: TURNS, today: DAY })
  })

  it('takes at most twelve messages, the number the backend allows', () => {
    expect(MAX_TURNS).toBe(12)
    // The app sends fewer (the free AI model has a small token budget), but never more than the backend takes, and enough
    // to carry a question and its answer and the follow-up.
    expect(SENT_TURNS).toBeLessThanOrEqual(MAX_TURNS)
    expect(SENT_TURNS).toBeGreaterThanOrEqual(4)
  })

  it.each([429, 502, 503, 504])('shows the backends own sentence for a %i', async (status) => {
    stubFetch(async () => reply(status, { detail: 'A plain sentence from the backend.' }))
    const error = (await sendChat(TURNS, null, DAY).catch((e: unknown) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('unavailable')
    expect(error.message).toBe('A plain sentence from the backend.')
  })

  it('does not show a detail that is not a sentence (a proxys JSON, say)', async () => {
    stubFetch(async () => reply(503, { detail: { code: 17 } }))
    const error = (await sendChat(TURNS, null, DAY).catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('server')
    expect(error.message).toBe('The server had a problem (status 503). Try again.')
  })

  it('turns a 422 into words', async () => {
    stubFetch(async () => reply(422, { detail: [{ loc: ['body', 'messages'], msg: 'List should have at most 12 items' }] }))
    const error = (await sendChat(TURNS, null, DAY).catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe('Please fix: messages: List should have at most 12 items')
  })

  it('refuses an answer that is not the expected shape', async () => {
    for (const bad of [{ reply: 5, proposals: [] }, { reply: 'x' }, { proposals: [] }, { reply: 'x', proposals: 'none' }, [], 'text']) {
      stubFetch(async () => reply(200, bad))
      const error = (await sendChat(TURNS, null, DAY).catch((e: unknown) => e)) as ApiError
      expect(error.kind).toBe('server')
    }
  })

  it('says the backend cannot be reached when the request fails', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const error = (await sendChat(TURNS, null, DAY).catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('unreachable')
  })

  describe('the deadline', () => {
    const waiting = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(new DOMException('aborted', 'AbortError'))
        if (init?.signal?.aborted) fail() // a real fetch refuses an already aborted signal at once
        else init?.signal?.addEventListener('abort', fail)
      })

    it('is 90 seconds (the backend waits 70), not the 10 of the other calls', async () => {
      vi.useFakeTimers()
      stubFetch(waiting)
      const pending = sendChat(TURNS, null, DAY).catch((e: unknown) => e)
      let settled = false
      void pending.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS - 1000)
      expect(settled).toBe(false) // still waiting after 89 s
      await vi.advanceTimersByTimeAsync(1000)
      expect(((await pending) as ApiError).kind).toBe('timeout')
      expect(CHAT_TIMEOUT_MS).toBe(90_000)
    })

    it('stops the request and fails with kind "cancelled" when the caller gives up', async () => {
      const fetch = stubFetch(waiting)
      const caller = new AbortController()
      const pending = sendChat(TURNS, null, DAY, caller.signal).catch((e: unknown) => e)
      await Promise.resolve()
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
      caller.abort()
      const error = (await pending) as ApiError
      expect(error.kind).toBe('cancelled')
      expect(error.message).toBe('The request was cancelled.')
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    })

    it('does not even wait when the signal is already aborted', async () => {
      stubFetch(waiting)
      const caller = new AbortController()
      caller.abort()
      const error = (await sendChat(TURNS, null, DAY, caller.signal).catch((e: unknown) => e)) as ApiError
      expect(error.kind).toBe('cancelled')
    })

    it('a call nobody cancels still times out as before, with a signal given', async () => {
      vi.useFakeTimers()
      stubFetch(waiting)
      const caller = new AbortController()
      const pending = sendChat(TURNS, null, DAY, caller.signal).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS)
      expect(((await pending) as ApiError).kind).toBe('timeout')
    })

    it('lets go of the signal when the call is over', async () => {
      stubFetch(async () => reply(200, GOOD))
      const caller = new AbortController()
      const remove = vi.spyOn(caller.signal, 'removeEventListener')
      await sendChat(TURNS, null, DAY, caller.signal)
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    })
  })
})

describe('chatAvailable', () => {
  it('asks /chat/status and is true only for {available: true}', async () => {
    const fetch = stubFetch(async () => reply(200, { available: true }))
    await expect(chatAvailable()).resolves.toBe(true)
    expect(fetch.mock.calls[0]![0]).toBe(`${BACKEND_URL}/chat/status`)
  })

  it.each([{ available: false }, { available: 'yes' }, { available: 1 }, {}, [], 'true', null])('is false for %j', async (body) => {
    stubFetch(async () => reply(200, body))
    await expect(chatAvailable()).resolves.toBe(false)
  })

  it('is false, and never throws, when the backend is down, slow or broken', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(chatAvailable()).resolves.toBe(false)
    stubFetch(async () => reply(500, { detail: 'boom' }))
    await expect(chatAvailable()).resolves.toBe(false)
    stubFetch(async () => new Response('<html>proxy</html>', { status: 200 }))
    await expect(chatAvailable()).resolves.toBe(false)
  })
})
