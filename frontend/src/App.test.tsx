// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Shot } from './api'

// The page loads its shots from the backend: a few fixed ones stand in for it.
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
  return { ...real, listShots: vi.fn(async () => ({ shots, truncated: false })) }
})

// jsdom has none of these; the app only needs them not to be missing.
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
  // The title screen is for a tab's first visit: these tests start after it.
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage({ 'hoops-title-seen': '1' }), configurable: true })
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function open() {
  const { default: App } = await import('./App')
  const view = render(<App />)
  // Wait for the shots to load: the Shots button shows their count.
  await waitFor(() => expect(view.container.querySelector('.drawer-count')?.textContent).toBe('6'))
  return view
}

const trophyDrawer = () => document.querySelector('#trophy-drawer') as HTMLElement
const shotsDrawer = () => document.querySelector('#shots-drawer') as HTMLElement
const trophyButton = () => screen.getByRole('button', { name: /^Trophies:/ })
const shotsButton = () => screen.getByRole('button', { name: /^Shots\s*6/ })

describe('App: the two drawers', () => {
  it('start closed', async () => {
    await open()
    expect(trophyDrawer().className).toBe('drawer')
    expect(shotsDrawer().className).toBe('drawer')
  })

  it('the level badge opens the trophies, with focus inside them', async () => {
    await open()
    await userEvent.setup().click(trophyButton())
    expect(trophyDrawer().className).toBe('drawer open')
    expect(trophyDrawer().contains(document.activeElement)).toBe(true)
    expect(trophyButton().getAttribute('aria-expanded')).toBe('true')
  })

  it('only one drawer is open at a time, in both directions', async () => {
    await open()
    const user = userEvent.setup()
    await user.click(shotsButton())
    expect(shotsDrawer().className).toBe('drawer open')
    await user.click(trophyButton())
    expect(trophyDrawer().className).toBe('drawer open')
    expect(shotsDrawer().className).toBe('drawer')
    await user.click(shotsButton())
    expect(shotsDrawer().className).toBe('drawer open')
    expect(trophyDrawer().className).toBe('drawer')
  })

  it('switching from the shot list to the trophies leaves focus in the trophies, not on the Shots button', async () => {
    await open()
    const user = userEvent.setup()
    await user.click(shotsButton())
    await user.click(trophyButton())
    expect(trophyDrawer().contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(shotsButton())
  })

  it('switching from the trophies to the shot list leaves focus in the shot list', async () => {
    await open()
    const user = userEvent.setup()
    await user.click(trophyButton())
    await user.click(shotsButton())
    expect(shotsDrawer().contains(document.activeElement)).toBe(true)
  })

  it('closing the shot list gives focus back to the Shots button', async () => {
    await open()
    const user = userEvent.setup()
    await user.click(shotsButton())
    await user.keyboard('{Escape}')
    expect(shotsDrawer().className).toBe('drawer')
    expect(document.activeElement).toBe(shotsButton())
  })

  it('closing the trophies gives focus back to the level badge', async () => {
    await open()
    const user = userEvent.setup()
    await user.click(trophyButton())
    await user.keyboard('{Escape}')
    expect(trophyDrawer().className).toBe('drawer')
    expect(document.activeElement).toBe(trophyButton())
  })
})

describe('App: a selected shot and Escape', () => {
  const selectedRow = () => document.querySelector('.shot[aria-current]')

  it('Escape with the trophies open closes only them and keeps the selected shot; the next Escape deselects it', async () => {
    await open()
    const user = userEvent.setup()
    // Select a shot from its row in the shot list ("Show on map" selects it and closes the list).
    await user.click(shotsButton())
    await user.click(screen.getAllByRole('button', { name: /Show on map/ })[0]!)
    expect(selectedRow()).not.toBeNull()
    expect(shotsDrawer().className).toBe('drawer')

    await user.click(trophyButton())
    await user.keyboard('{Escape}')
    expect(trophyDrawer().className).toBe('drawer')
    expect(selectedRow()).not.toBeNull() // one press, one thing closed

    await user.keyboard('{Escape}')
    expect(selectedRow()).toBeNull() // nothing open now, so Escape clears the selection
  })

  it('Escape with the shot list open closes it and keeps the selection', async () => {
    await open()
    const user = userEvent.setup()
    await user.click(shotsButton())
    await user.click(screen.getAllByRole('button', { name: /Show on map/ })[0]!)
    await user.click(shotsButton())
    await user.keyboard('{Escape}')
    expect(shotsDrawer().className).toBe('drawer')
    expect(selectedRow()).not.toBeNull()
  })
})
