// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, deleteChatHistory, getChatHistory, sendChat } from './api'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

describe('getChatHistory', () => {
  it('asks for one player, with the name safely encoded', async () => {
    fetchMock.mockResolvedValue(json({ lines: [] }))
    await getChatHistory('Noam & Co/ד')
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/chat/history?player=Noam%20%26%20Co%2F%D7%93')
  })

  it('returns the lines, oldest first as sent, and drops ones it cannot use', async () => {
    fetchMock.mockResolvedValue(
      json({ lines: [{ role: 'user', text: 'a' }, { role: 'robot', text: 'x' }, { role: 'deni', text: '' }, { role: 'deni', text: 7 }, null, { role: 'deni', text: 'b' }] }),
    )
    expect(await getChatHistory('Yuly')).toEqual([
      { role: 'user', text: 'a' },
      { role: 'deni', text: 'b' },
    ])
  })

  it('refuses an answer that is not a list of lines', async () => {
    fetchMock.mockResolvedValue(json({ nothing: true }))
    await expect(getChatHistory('Yuly')).rejects.toBeInstanceOf(ApiError)
  })

  it('fails like any other request when the backend says no', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'x' }, 500))
    await expect(getChatHistory('Yuly')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('deleteChatHistory', () => {
  it('sends a DELETE for that player', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await deleteChatHistory('Yuly')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/chat/history?player=Yuly')
    expect(init.method).toBe('DELETE')
  })
})

describe('sendChat with a player', () => {
  const reply = { reply: 'hi', proposals: [], model: 'm' }
  it('sends the player so the backend can keep the conversation', async () => {
    fetchMock.mockResolvedValue(json(reply))
    await sendChat([{ role: 'user', text: 'x' }], null, '2026-11-22', undefined, 'Yuly')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).player).toBe('Yuly')
  })

  it('leaves the player out when there is none, or it is empty (a new log)', async () => {
    fetchMock.mockImplementation(async () => json(reply))
    await sendChat([{ role: 'user', text: 'x' }], null, '2026-11-22')
    await sendChat([{ role: 'user', text: 'x' }], null, '2026-11-22', undefined, '')
    for (const call of fetchMock.mock.calls) expect(JSON.parse(call[1].body)).not.toHaveProperty('player')
  })
})
