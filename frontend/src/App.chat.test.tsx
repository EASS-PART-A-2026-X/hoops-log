// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Shot } from './api'

const shots: Shot[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  player: 'Ann',
  x: 25,
  y: 8 + i,
  made: i % 2 === 0,
  game_date: '2026-11-0' + (i + 1),
  note: '',
  zone: 'paint',
  shot_type: '2PT' as const,
}))

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>()
  return {
    ...real,
    listShots: vi.fn(async () => ({ shots, truncated: false })),
    chatAvailable: vi.fn(async () => true),
    sendChat: vi.fn(),
    createShot: vi.fn(),
  }
})
// The 3D figure needs WebGL, which jsdom does not have.
vi.mock('./coach/Deni3D', () => ({ default: () => <div data-testid="deni-3d" /> }))
const api = await import('./api')
const available = vi.mocked(api.chatAvailable)
const chat = vi.mocked(api.sendChat)
const create = vi.mocked(api.createShot)
const list = vi.mocked(api.listShots)

Element.prototype.scrollIntoView = vi.fn()
class FakeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeObserver)
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage({ 'hoops-title-seen': '1' }), configurable: true })
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  available.mockReset()
  available.mockResolvedValue(true)
  chat.mockReset()
  create.mockReset()
  list.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open() {
  const { default: App } = await import('./App')
  const view = render(<App />)
  await waitFor(() => expect(view.container.querySelector('.drawer-count')?.textContent).toBe('6'))
  return view
}
const drawer = () => document.querySelector('#shots-drawer') as HTMLElement
const openDrawer = async () => userEvent.click(screen.getByRole('button', { name: /^Shots\s*6/ }))
const face = () => screen.getByRole('button', { name: /Open Deni/ })
const view = () => within(screen.getByRole('group', { name: 'Drawer view' }))

describe('adding shots: by telling Deni, or by hand when his AI helper is not there', () => {
  it('offers no manual form while the AI helper is there, only a way to tell Deni', async () => {
    await open()
    await openDrawer()
    await waitFor(() => expect(available).toHaveBeenCalled())
    expect(view().queryByRole('button', { name: 'Add a shot' })).toBeNull()
    expect(view().queryByRole('button', { name: /Paste notes/ })).toBeNull()
    expect(within(drawer()).getByRole('button', { name: 'Tell Deni about a shot' })).toBeTruthy()
  })

  it('opens Deni\'s chat from the drawer and closes the drawer', async () => {
    await open()
    await openDrawer()
    await userEvent.click(within(drawer()).getByRole('button', { name: 'Tell Deni about a shot' }))
    expect(screen.getByRole('dialog', { name: 'Deni Avdija' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message to Deni' })).toBeTruthy()
    expect(drawer().className).toBe('drawer')
  })

  it('shows the manual form, and no Tell Deni button, when his AI helper is not available', async () => {
    available.mockResolvedValue(false)
    await open()
    await openDrawer()
    await waitFor(() => expect(view().getByRole('button', { name: 'Add a shot' })).toBeTruthy())
    expect(within(drawer()).queryByRole('button', { name: 'Tell Deni about a shot' })).toBeNull()
    await userEvent.click(view().getByRole('button', { name: 'Add a shot' }))
    expect(within(drawer()).getByRole('button', { name: 'Add shot' })).toBeTruthy()
    expect(within(drawer()).getByText(/AI helper is not available right now, so add the shot by hand/)).toBeTruthy()
  })

  it('treats "not known yet" as there: no form flashes up while the answer is awaited', async () => {
    available.mockReturnValue(new Promise(() => {}))
    await open()
    await openDrawer()
    expect(view().queryByRole('button', { name: 'Add a shot' })).toBeNull()
    expect(within(drawer()).getByRole('button', { name: 'Tell Deni about a shot' })).toBeTruthy()
  })

  it('treats the backend being unreachable like the helper being offline', async () => {
    // chatAvailable never throws: it answers false.
    available.mockResolvedValue(false)
    await open()
    await openDrawer()
    await waitFor(() => expect(view().getByRole('button', { name: 'Add a shot' })).toBeTruthy())
  })

  it('says how to log the first shot in words that match what is on offer', async () => {
    list.mockResolvedValue({ shots: [], truncated: false })
    const { default: App } = await import('./App')
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /^Shots\s*0/ }))
    expect(await screen.findByText('No shots yet. Tell Deni about your first shot.')).toBeTruthy()
    cleanup()
    available.mockResolvedValue(false)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /^Shots\s*0/ }))
    expect(await screen.findByText('No shots yet. Open "Add a shot" to log your first one.')).toBeTruthy()
    list.mockResolvedValue({ shots, truncated: false })
  })

  it('asks again when his view opens, so a helper that came back is noticed and the form goes away', async () => {
    available.mockResolvedValueOnce(false).mockResolvedValue(true)
    await open()
    await openDrawer()
    await userEvent.click(await view().findByRole('button', { name: 'Add a shot' }))
    expect(within(drawer()).getByRole('button', { name: 'Add shot' })).toBeTruthy()
    await userEvent.click(face())
    await waitFor(() => expect(view().queryByRole('button', { name: 'Add a shot' })).toBeNull())
    expect(available.mock.calls.length).toBeGreaterThanOrEqual(2)
    // The list shows again instead of an empty drawer.
    expect(view().getByRole('button', { name: /^Shots/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('marks him as there once he has answered, and as not there once he fails and the backend agrees', async () => {
    await open()
    await userEvent.click(face())
    chat.mockRejectedValue(new api.ApiError('unavailable', 'Deni\'s AI helper is not available right now. You can still add shots by hand.'))
    available.mockResolvedValue(false)
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to Deni' }), 'hello{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('not available right now')
    await waitFor(() => expect(screen.getByPlaceholderText('His AI helper is offline')).toBeTruthy())
  })
})

describe('adding a shot through the chat', () => {
  const corner = { x: 47.5, y: 3, made: true, game_date: '2026-11-19', note: 'caught and shot', quote: 'hit one from the right corner', zone: 'right_corner_3', shot_type: '3PT' as const }

  it('sends the conversation and the numbers from the log, shows the proposal, and saves only on Save', async () => {
    chat.mockResolvedValue({ reply: 'Got it: a made three from the right corner. Tap Save to log it.', proposals: [corner], model: 'm' })
    create.mockImplementation(async (input) => ({ ...input, id: 99, zone: 'right_corner_3', shot_type: '3PT' }) as Shot)
    await open()
    await userEvent.click(face())
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to Deni' }), 'hit one from the right corner{Enter}')
    expect(await screen.findByText('Right corner 3 · 3PT · made · 2026-11-19')).toBeTruthy()
    // What the AI was given: the message and the numbers the app worked out for the shown player (Ann).
    const [turns, stats] = chat.mock.calls[0]!
    expect(turns).toEqual([{ role: 'user', text: 'hit one from the right corner' }])
    expect(stats).toMatchObject({ player: 'Ann', attempts: 6, made: 3 })
    // Understanding is not saving.
    expect(create).not.toHaveBeenCalled()
    const listed = list.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Save shot 1' }))
    expect(create).toHaveBeenCalledWith({ player: 'Ann', x: 47.5, y: 3, made: true, game_date: '2026-11-19', note: 'caught and shot' })
    expect(await screen.findByText('Saved ✓')).toBeTruthy()
    // The list is refreshed from the backend, once, and the app says so.
    await waitFor(() => expect(list.mock.calls.length).toBe(listed + 1))
    expect(await screen.findByText('Saved shot #99 for Ann.')).toBeTruthy()
  })

  it('does not say the shown player has no shots left when only the capitals of the shown spelling change', async () => {
    const mk = (id: number, player: string): Shot => ({ id, player, x: 25, y: 8, made: false, game_date: '2026-11-01', note: '', zone: 'paint', shot_type: '2PT' })
    // Three 'ann' and three 'Ann' (the tie shows 'Ann'); after the save, six 'ann' make 'ann' the most used spelling.
    const before = [1, 2, 3].map((i) => mk(i, 'ann')).concat([4, 5, 6].map((i) => mk(i, 'Ann')))
    const after = before.concat([7, 8, 9].map((i) => mk(i, 'ann')))
    chat.mockResolvedValue({ reply: 'Got it.', proposals: [corner], model: 'm' })
    create.mockImplementation(async (input) => ({ ...input, id: 99, zone: 'right_corner_3', shot_type: '3PT' }) as Shot)
    list.mockResolvedValue({ shots: before, truncated: false })
    try {
      await open()
      await userEvent.click(face())
      await userEvent.type(screen.getByRole('textbox', { name: 'Message to Deni' }), 'one{Enter}')
      list.mockResolvedValue({ shots: after, truncated: false })
      await userEvent.click(await screen.findByRole('button', { name: 'Save shot 1' }))
      await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('9'))
      expect(await screen.findByText(/Saved shot #99 for/)).toBeTruthy()
      expect(screen.queryByText(/has no shots left/)).toBeNull()
    } finally {
      list.mockResolvedValue({ shots, truncated: false })
    }
  })

  it('refreshes the list once and says one thing for a whole Save all', async () => {
    chat.mockResolvedValue({ reply: 'Two shots.', proposals: [corner, { ...corner, x: 17, y: 19, zone: 'left_elbow', shot_type: '2PT' as const }], model: 'm' })
    let id = 100
    create.mockImplementation(async (input) => ({ ...input, id: id++, zone: 'x', shot_type: '2PT' }) as Shot)
    await open()
    await userEvent.click(face())
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to Deni' }), 'two shots{Enter}')
    const saveAll = await screen.findByRole('button', { name: 'Save all (2)' })
    const listed = list.mock.calls.length
    await userEvent.click(saveAll)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Saved 2 shots for Ann.')).toBeTruthy()
    await waitFor(() => expect(list.mock.calls.length).toBe(listed + 1))
  })

  it('keeps the conversation when his view is closed and opened again', async () => {
    chat.mockResolvedValue({ reply: 'You made 3 of 6.', proposals: [], model: 'm' })
    await open()
    await userEvent.click(face())
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to Deni' }), 'how am I doing?{Enter}')
    await screen.findAllByText('You made 3 of 6.')
    await userEvent.click(screen.getByRole('button', { name: 'Close the coach' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(face())
    expect(within(screen.getByRole('log')).getByText('how am I doing?')).toBeTruthy()
    expect(within(screen.getByRole('log')).getByText('You made 3 of 6.')).toBeTruthy()
  })
})
