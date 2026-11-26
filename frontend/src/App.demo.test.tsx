// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Shot, ShotInput } from './api'

const make = (id: number, player: string): Shot => ({
  id,
  player,
  x: 25,
  y: 8 + (Math.abs(id) % 10),
  made: id % 2 === 0,
  game_date: '2026-11-0' + ((Math.abs(id) % 8) + 1),
  note: '',
  zone: 'paint',
  shot_type: '2PT',
})

let mine: Shot[] = []
const demoShots = Array.from({ length: 12 }, (_, i) => make(-(i + 1), 'Demo Player'))
const listShots = vi.fn(async () => ({ shots: mine, truncated: false }))
const listDemoShots = vi.fn(async () => demoShots)
const createShot = vi.fn(async (input: ShotInput) => ({ ...make(99, 'yuly'), ...input, id: 99 }))
const updateShot = vi.fn()
const deleteShot = vi.fn()
vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>()
  return {
    ...real,
    listShots: () => listShots(),
    listDemoShots: () => listDemoShots(),
    createShot: (input: ShotInput) => createShot(input),
    updateShot: (...a: unknown[]) => updateShot(...a),
    deleteShot: (...a: unknown[]) => deleteShot(...a),
  }
})

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

// The first test would otherwise pay for loading the whole app (Three.js and all) inside its own 5 seconds, and
// fail on a slow or busy machine. Load it once here, with a limit that fits.
beforeAll(async () => {
  await import('./App')
}, 60_000)

beforeEach(() => {
  mine = []
  listShots.mockClear()
  listDemoShots.mockClear()
  createShot.mockClear()
  vi.stubGlobal('ResizeObserver', FakeObserver)
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage({ 'hoops-title-seen': '1' }), configurable: true })
  Object.defineProperty(window, 'localStorage', { value: memoryStorage({ 'coach-chatter': '0' }), configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const USER = { id: 1, email: 'yuly@example.com', username: 'yuly' }

async function open() {
  const { default: App } = await import('./App')
  const view = render(<App user={USER} onLogout={() => {}} skipTitle />)
  await waitFor(() => expect(listShots).toHaveBeenCalled())
  return view
}

const shotsDrawer = () => document.querySelector('#shots-drawer') as HTMLElement
const demoButton = () => screen.getByRole('button', { name: 'DEMO' })
const shotsButton = () => document.querySelector('button.drawer-toggle') as HTMLButtonElement

describe('there is nobody to choose: the shots are the account’s own', () => {
  it('has no "Shots of" dropdown, and the top bar shows the username', async () => {
    mine = [make(1, 'yuly'), make(2, 'yuly')]
    await open()
    expect(screen.queryByRole('combobox', { name: /Shots of/ })).toBeNull()
    expect(document.querySelector('.bug-name')?.textContent).toBe('yuly')
  })

  it('the add form has no player field, and sends none', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(shotsButton())
    await user.click(screen.getByRole('button', { name: 'Add a shot' }))
    const form = within(shotsDrawer())
    expect(form.queryByLabelText('Player')).toBeNull()
    expect(form.getByText('Only you will see this shot. It never goes into the demo.')).toBeTruthy()
    await user.type(form.getByLabelText(/^X \(/), '25')
    await user.type(form.getByLabelText(/^Y \(/), '10')
    await user.click(form.getByRole('button', { name: 'Add shot' }))
    await waitFor(() => expect(createShot).toHaveBeenCalledTimes(1))
    const sent = createShot.mock.calls[0]![0]
    expect(Object.keys(sent).sort()).toEqual(['game_date', 'made', 'note', 'x', 'y'])
    expect(screen.getByText('Saved shot #99.')).toBeTruthy()
  })

  it('shots of any other name that the list holds are all shown as the account’s', async () => {
    mine = [make(1, 'yuly'), make(2, 'Old Name'), make(3, 'Another')]
    await open()
    await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('3'))
  })
})

describe('a new account', () => {
  it('sees an empty court with two ways to start and who the shots belong to', async () => {
    await open()
    const welcome = await screen.findByRole('region', { name: 'Welcome' })
    expect(within(welcome).getByText('YOUR LOG IS EMPTY')).toBeTruthy()
    expect(within(welcome).getByRole('button', { name: 'ADD YOUR FIRST SHOT' })).toBeTruthy()
    expect(within(welcome).getByRole('button', { name: 'TRY THE DEMO' })).toBeTruthy()
    expect(within(welcome).getByText(/only yours\. They never go into the demo/)).toBeTruthy()
    expect(document.querySelector('.drawer-count')?.textContent).toBe('0')
    expect(listDemoShots).not.toHaveBeenCalled() // the demo is only fetched when asked for
  })

  it('ADD YOUR FIRST SHOT opens the add form', async () => {
    await open()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'ADD YOUR FIRST SHOT' }))
    expect(shotsDrawer().className).toBe('drawer open')
    expect(within(shotsDrawer()).getByRole('heading', { name: 'Add a shot' })).toBeTruthy()
    expect(within(shotsDrawer()).getByRole('button', { name: 'Add shot' })).toBeTruthy()
  })

  it('the welcome goes away once there is a shot', async () => {
    mine = [make(1, 'yuly')]
    await open()
    await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('1'))
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull()
  })
})

describe('the demo', () => {
  it('TRY THE DEMO shows made-up shots under a banner that says they are not yours', async () => {
    mine = []
    await open()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'TRY THE DEMO' }))
    await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('12'))
    expect(listDemoShots).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/They are not yours/).textContent).toContain('nothing you do here is saved')
    expect(document.querySelector('.bug-name')?.textContent).toBe('Demo Player')
    expect(demoButton().getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull()
  })

  it('its shots can be looked at but not added to, changed or deleted', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(demoButton())
    await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('12'))
    await user.click(shotsButton())
    const drawer = within(shotsDrawer())
    expect(drawer.queryByRole('button', { name: 'Add a shot' })).toBeNull()
    expect(drawer.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(drawer.queryByRole('button', { name: /^Delete/ })).toBeNull()
    expect(drawer.getAllByRole('button', { name: /Show on map/ }).length).toBeGreaterThan(0)
    expect(drawer.queryByText('#-1')).toBeNull() // no negative ids on screen
  })

  it('EXIT DEMO brings back the account’s own shots, untouched', async () => {
    mine = [make(1, 'yuly'), make(2, 'yuly'), make(3, 'yuly')]
    const user = userEvent.setup()
    await open()
    await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('3'))
    await user.click(demoButton())
    await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('12'))
    await user.click(screen.getByRole('button', { name: 'EXIT DEMO' }))
    await waitFor(() => expect(document.querySelector('.drawer-count')?.textContent).toBe('3'))
    expect(screen.queryByText(/not yours/)).toBeNull()
    expect(document.querySelector('.bug-name')?.textContent).toBe('yuly')
    expect(demoButton().getAttribute('aria-pressed')).toBe('false')
    expect(createShot).not.toHaveBeenCalled()
    expect(deleteShot).not.toHaveBeenCalled()
  })

  it('the demo is only fetched once, however often it is switched on', async () => {
    const user = userEvent.setup()
    await open()
    for (let i = 0; i < 3; i++) {
      await user.click(demoButton())
      await user.click(demoButton())
    }
    expect(listDemoShots).toHaveBeenCalledTimes(1)
  })

  it('the add form is available again after leaving the demo', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(demoButton())
    await user.click(demoButton())
    await user.click(shotsButton())
    expect(within(shotsDrawer()).getByRole('button', { name: 'Add a shot' })).toBeTruthy()
  })

  it('says so when the demo cannot be loaded', async () => {
    listDemoShots.mockRejectedValueOnce(new Error('down'))
    await open()
    await userEvent.setup().click(demoButton())
    await waitFor(() => expect(document.body.textContent).toContain('Could not load the demo.'))
  })
})
