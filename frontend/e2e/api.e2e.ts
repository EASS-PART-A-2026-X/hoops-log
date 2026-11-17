import { expect, makeShots, test } from './support'
import { BACKEND_URL } from './env'

// The backend on its own, over plain HTTP: what any other client (or the frontend) can rely on.

test.describe('the API contract the frontend relies on', () => {
  test('health answers ok', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/health`)
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  test('the frontend origins in the allow-list may call it, and other origins and methods may not', async ({ request }) => {
    const ask = (origin: string, method = 'POST') =>
      request.fetch(`${BACKEND_URL}/shots`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type' },
      })
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const ok = await ask(origin)
      expect(ok.status(), origin).toBe(200)
      expect(ok.headers()['access-control-allow-origin'], origin).toBe(origin)
    }
    // This is the one thing the browser tests cannot show: they run from another port, with the headers added by the test.
    for (const origin of ['https://evil.example', 'http://localhost:5199', 'http://localhost:5174']) {
      expect((await ask(origin)).headers()['access-control-allow-origin'], origin).toBeUndefined()
    }
    const odd = await ask('http://localhost:5173', 'PUT')
    expect(odd.status()).toBe(400)
  })

  test('create, read, change and delete one shot; ids are never reused', async ({ api, request }) => {
    const a = await api.add({ player: 'Yuly', x: 25, y: 6, made: true })
    expect(a).toMatchObject({ zone: 'restricted_area', shot_type: '2PT' })
    const got = await request.get(`${BACKEND_URL}/shots/${a.id}`)
    expect(got.status()).toBe(200)
    const patched = await request.patch(`${BACKEND_URL}/shots/${a.id}`, { data: { made: false, y: 30 } })
    expect(await patched.json()).toMatchObject({ made: false, y: 30, x: 25, zone: 'top_3' })
    expect((await request.delete(`${BACKEND_URL}/shots/${a.id}`)).status()).toBe(204)
    expect((await request.get(`${BACKEND_URL}/shots/${a.id}`)).status()).toBe(404)
    expect((await request.delete(`${BACKEND_URL}/shots/${a.id}`)).status()).toBe(404)
    const b = await api.add({ player: 'Yuly', x: 25, y: 6, made: true })
    expect(b.id).toBeGreaterThan(a.id)
  })

  test('bad input is a 422 with a readable detail, never a 500', async ({ request }) => {
    const bad: unknown[] = [
      {},
      { player: '', x: 1, y: 1, made: true },
      { player: 'A', x: 51, y: 1, made: true },
      { player: 'A', x: 1, y: 48, made: true },
      { player: 'A', x: 'left', y: 1, made: true },
      { player: 'A', x: 1, y: 1, made: 'maybe' },
      { player: 'A'.repeat(51), x: 1, y: 1, made: true },
      { player: 'A', x: 1, y: 1, made: true, zone: 'paint' },
      { player: 'A', x: 1, y: 1, made: true, game_date: '2999-01-01' },
      { player: 'A', x: 1, y: 1, made: true, note: 'n'.repeat(201) },
      { player: 'A\u0000B', x: 1, y: 1, made: true },
      { player: 'A', x: Number.MAX_SAFE_INTEGER, y: 1, made: true },
    ]
    for (const body of bad) {
      const res = await request.post(`${BACKEND_URL}/shots`, { data: body as Record<string, unknown> })
      expect(res.status(), JSON.stringify(body)).toBe(422)
    }
    for (const id of ['0', '-1', 'abc', '99999999999999999999']) {
      expect((await request.get(`${BACKEND_URL}/shots/${id}`)).status(), id).toBe(422)
    }
    for (const q of ['limit=0', 'limit=101', 'offset=-1', 'limit=x']) {
      expect((await request.get(`${BACKEND_URL}/shots?${q}`)).status(), q).toBe(422)
    }
  })

  test('the list is paged, oldest id first, and a page past the end is empty', async ({ api, request }) => {
    const rows = await api.seed(makeShots('Yuly', 130, { seed: 41 }))
    const first = (await (await request.get(`${BACKEND_URL}/shots?limit=100`)).json()) as { id: number }[]
    const second = (await (await request.get(`${BACKEND_URL}/shots?limit=100&offset=100`)).json()) as { id: number }[]
    expect(first).toHaveLength(100)
    expect(second).toHaveLength(30)
    expect([...first, ...second].map((s) => s.id)).toEqual(rows.map((r) => r.id))
    expect(await (await request.get(`${BACKEND_URL}/shots?offset=5000`)).json()).toEqual([])
  })

  test('/chart.svg is a valid SVG with one mark per shot, can be filtered by player (any capitals), and an unknown player gets an empty chart', async ({ api, request }) => {
    await api.seed([
      ...[true, true, true, true, false].map((made, i) => ({ player: 'Yuly', x: 10 + i * 6, y: 12 + i, made })),
      ...[true, true, false].map((made, i) => ({ player: 'Noam', x: 40 - i * 5, y: 20 + i, made })),
    ])
    const marks = (svg: string) => ({ made: (svg.match(/fill="#1a7f37"/g) ?? []).length, missed: (svg.match(/stroke="#cf222e"/g) ?? []).length })
    const chart = async (query = '') => {
      const res = await request.get(`${BACKEND_URL}/chart.svg${query}`)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toContain('image/svg+xml')
      const text = await res.text()
      expect(text).toMatch(/^<svg[\s\S]*<\/svg>\s*$/)
      return marks(text)
    }
    expect(await chart()).toEqual({ made: 6, missed: 2 })
    expect(await chart('?player=Yuly')).toEqual({ made: 4, missed: 1 })
    expect(await chart('?player=yuly')).toEqual({ made: 4, missed: 1 })
    expect(await chart('?player=NOAM')).toEqual({ made: 2, missed: 1 })
    expect(await chart('?player=Nobody')).toEqual({ made: 0, missed: 0 })
    expect((await request.get(`${BACKEND_URL}/chart.svg?player=${'x'.repeat(51)}`)).status()).toBe(422)
  })

  test('the zone is computed on the line the way the rules say (on the three-point line is a two)', async ({ api }) => {
    expect(await api.add({ player: 'A', x: 3, y: 5, made: true })).toMatchObject({ shot_type: '2PT' })
    expect(await api.add({ player: 'A', x: 2.9, y: 5, made: true })).toMatchObject({ shot_type: '3PT', zone: 'left_corner_3' })
    // Top of the key: exactly 23.75 ft from the hoop is a two, a hair more is a three.
    expect(await api.add({ player: 'A', x: 25, y: 29, made: true })).toMatchObject({ shot_type: '2PT' })
    expect(await api.add({ player: 'A', x: 25, y: 29.1, made: true })).toMatchObject({ shot_type: '3PT', zone: 'top_3' })
  })

  test('twenty requests at once all succeed and every shot is stored once', async ({ api, request }) => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => request.post(`${BACKEND_URL}/shots`, { data: { player: `P${i}`, x: 20, y: 20, made: i % 2 === 0 } })),
    )
    expect(results.map((r) => r.status())).toEqual(Array(20).fill(201))
    const rows = await api.list()
    expect(new Set(rows.map((r) => r.id)).size).toBe(20)
  })
})
