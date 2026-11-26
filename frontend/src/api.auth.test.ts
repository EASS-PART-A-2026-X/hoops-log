// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createShot, fetchChartSvg, fetchMe, listShots, loginAccount, logoutAccount, registerAccount } from './api'
import { clearToken, currentToken, onSessionEnded, setToken } from './auth/session'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

const USER = { id: 3, email: 'yuly@example.com', username: 'Yuly' }
const LOGIN = { token: 'tok-123', token_type: 'bearer', expires_at: '2026-12-01T00:00:00Z', user: USER }

function reply(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers })
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  clearToken()
  vi.unstubAllGlobals()
})

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? []
  return { url: String(url), init: init ?? {}, headers: (init?.headers ?? {}) as Record<string, string> }
}

describe('the token on requests', () => {
  it('is sent as a Bearer header when there is one', async () => {
    setToken('abc')
    fetchMock.mockResolvedValue(reply(200, []))
    await listShots()
    expect(lastCall().headers).toEqual({ Authorization: 'Bearer abc' })
  })

  it('is not sent when there is none (a GET then has no headers at all)', async () => {
    fetchMock.mockResolvedValue(reply(200, []))
    await listShots()
    expect(lastCall().init.headers).toBeUndefined()
  })

  it('goes with the content type on a write', async () => {
    setToken('abc')
    fetchMock.mockResolvedValue(reply(201, { id: 1 }))
    await createShot({ x: 1, y: 1, made: true, game_date: '2026-11-01', note: '' })
    expect(lastCall().headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer abc' })
  })
})

describe('a 401 on a normal request', () => {
  it('forgets the token, tells the app, and throws a plain sentence', async () => {
    setToken('old')
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    fetchMock.mockResolvedValue(reply(401, { detail: 'Not logged in' }))
    const error = await listShots().catch((e: unknown) => e)
    stop()
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('unauthorized')
    expect((error as ApiError).message).toBe('Your login ended. Please log in again.')
    expect(currentToken()).toBeNull()
    expect(ended).toHaveBeenCalledTimes(1)
  })
})

describe('registerAccount', () => {
  const input = { email: 'yuly@example.com', username: 'Yuly', password: 'a long enough password', password_confirm: 'a long enough password' }

  it('posts the form without any token, then keeps the new one', async () => {
    setToken('stale')
    fetchMock.mockResolvedValue(reply(201, LOGIN))
    const user = await registerAccount(input)
    expect(user).toEqual(USER)
    const { url, init, headers } = lastCall()
    expect(url).toMatch(/\/auth\/register$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(input)
    expect(headers).toEqual({ 'Content-Type': 'application/json' }) // no Authorization
    expect(currentToken()).toBe('tok-123')
  })

  it('turns a taken name into a conflict that names the field', async () => {
    fetchMock.mockResolvedValue(reply(409, { detail: { field: 'username', message: 'That username is already used' } }))
    const error = (await registerAccount(input).catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('conflict')
    expect(error.field).toBe('username')
    expect(error.message).toBe('That username is already used')
    expect(currentToken()).toBeNull()
  })

  it('copes with a conflict that has no details', async () => {
    fetchMock.mockResolvedValue(reply(409, { detail: 'x' }))
    const error = (await registerAccount(input).catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('conflict')
    expect(error.field).toBeUndefined()
    expect(error.message).toBe('That is already used.')
  })

  it('shows validation problems as words', async () => {
    fetchMock.mockResolvedValue(reply(422, { detail: [{ loc: ['body', 'password'], msg: 'Value error, that password is too common, pick another one' }] }))
    const error = (await registerAccount(input).catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe('Please fix: password: that password is too common, pick another one')
  })

  it('says how long to wait after too many tries', async () => {
    fetchMock.mockResolvedValue(reply(429, { detail: 'x' }, { 'Retry-After': '42' }))
    const error = (await registerAccount(input).catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('rate_limited')
    expect(error.message).toBe('Too many attempts. Try again in 42 seconds.')
  })

  it('still says something when Retry-After is missing or nonsense', async () => {
    for (const value of [undefined, 'soon', '0', '-5']) {
      fetchMock.mockResolvedValue(reply(429, {}, value === undefined ? {} : { 'Retry-After': value }))
      const error = (await registerAccount(input).catch((e: unknown) => e)) as ApiError
      expect(error.message).toBe('Too many attempts. Try again in a few seconds.')
    }
  })
})

describe('loginAccount', () => {
  it('sends the username or email and the password, and keeps the token', async () => {
    fetchMock.mockResolvedValue(reply(200, LOGIN))
    expect(await loginAccount('yuly', 'pw')).toEqual(USER)
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ login: 'yuly', password: 'pw' })
    expect(currentToken()).toBe('tok-123')
  })

  it('a wrong password is an ordinary error, not "your login ended"', async () => {
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    fetchMock.mockResolvedValue(reply(401, { detail: 'Wrong username, email or password' }))
    const error = (await loginAccount('yuly', 'nope').catch((e: unknown) => e)) as ApiError
    stop()
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe('Wrong username, email or password.')
    expect(ended).not.toHaveBeenCalled()
    expect(currentToken()).toBeNull()
  })

  it('reports an unreachable backend in plain words', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = (await loginAccount('a', 'b').catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('unreachable')
  })
})

describe('fetchMe', () => {
  it('is null without a token, and does not even ask', async () => {
    expect(await fetchMe()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the user for a good token', async () => {
    setToken('good')
    fetchMock.mockResolvedValue(reply(200, USER))
    expect(await fetchMe()).toEqual(USER)
    expect(lastCall().headers).toEqual({ Authorization: 'Bearer good' })
  })

  it('is null for a token the backend refuses, and the token is dropped', async () => {
    setToken('bad')
    fetchMock.mockResolvedValue(reply(401, { detail: 'x' }))
    expect(await fetchMe()).toBeNull()
    expect(currentToken()).toBeNull()
  })

  it('passes on the other errors (a backend that is down)', async () => {
    setToken('good')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchMe()).rejects.toMatchObject({ kind: 'unreachable' })
    expect(currentToken()).toBe('good') // not logged out just because the server is away
  })
})

describe('logoutAccount', () => {
  it('ends the login on the server and forgets the token', async () => {
    setToken('mine')
    fetchMock.mockResolvedValue(reply(204))
    await logoutAccount()
    expect(lastCall().url).toMatch(/\/auth\/logout$/)
    expect(lastCall().init.method).toBe('POST')
    expect(lastCall().headers).toEqual({ Authorization: 'Bearer mine' })
    expect(currentToken()).toBeNull()
  })

  it('a 401 on logout means it had already ended: nobody is told "your login ended"', async () => {
    setToken('mine')
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    fetchMock.mockResolvedValue(reply(401, { detail: 'Not logged in' }))
    await expect(logoutAccount()).resolves.toBeUndefined()
    stop()
    expect(ended).not.toHaveBeenCalled()
    expect(currentToken()).toBeNull()
  })

  it('still logs out here when the server cannot be reached', async () => {
    setToken('mine')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(logoutAccount()).resolves.toBeUndefined()
    expect(currentToken()).toBeNull()
  })
})

describe('fetchChartSvg', () => {
  it('asks for the chart with the token and returns the SVG text', async () => {
    setToken('t')
    fetchMock.mockResolvedValue(new Response('<svg/>', { status: 200 }))
    expect(await fetchChartSvg('Yuly Cohen')).toBe('<svg/>')
    expect(lastCall().url).toMatch(/\/chart\.svg\?player=Yuly%20Cohen$/)
    expect(lastCall().headers).toEqual({ Authorization: 'Bearer t' })
  })

  it('asks for every player when none is chosen', async () => {
    fetchMock.mockResolvedValue(new Response('<svg/>', { status: 200 }))
    await fetchChartSvg('')
    expect(lastCall().url).toMatch(/\/chart\.svg$/)
  })

  it('a 401 ends the login like any other request', async () => {
    setToken('t')
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    fetchMock.mockResolvedValue(new Response('no', { status: 401 }))
    await expect(fetchChartSvg('')).rejects.toMatchObject({ kind: 'unauthorized' })
    stop()
    expect(ended).toHaveBeenCalled()
    expect(currentToken()).toBeNull()
  })

  it('other failures are plain sentences', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(fetchChartSvg('')).rejects.toMatchObject({ kind: 'server', message: 'The server had a problem (status 500). Try again.' })
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchChartSvg('')).rejects.toMatchObject({ kind: 'unreachable' })
  })
})
