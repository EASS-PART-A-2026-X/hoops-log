// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TitleScreen from './TitleScreen'
import { LEAVE_MS, shouldShowTitle } from './game/titleSeen'

const stats = { name: 'Demo Yuly', level: 4, rank: 'GYM RAT', shots: 150, trophies: 7, trophyTotal: 12 }

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true })
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TitleScreen', () => {
  it('shows the player, with the start button focused', () => {
    render(<TitleScreen stats={stats} onStart={() => {}} onDone={() => {}} />)
    expect(screen.getByRole('dialog', { name: /press start/i })).toBeTruthy()
    expect(screen.getByText('Demo Yuly')).toBeTruthy()
    expect(screen.getByText(/150 shots · 7\/12 trophies/)).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'PRESS START' }))
  })

  it('works without any shots loaded', () => {
    render(<TitleScreen stats={null} onStart={() => {}} onDone={() => {}} />)
    expect(screen.getByRole('button', { name: 'PRESS START' })).toBeTruthy()
  })

  it('a click starts the wipe, and the screen is done after it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onDone = vi.fn()
    const onStart = vi.fn()
    render(<TitleScreen stats={stats} onStart={onStart} onDone={onDone} />)
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'PRESS START' }))
    expect(screen.getByRole('dialog').className).toContain('leaving')
    expect(onDone).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(LEAVE_MS + 10))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('any key starts it, and pressing twice does not finish twice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onDone = vi.fn()
    const onStart = vi.fn()
    render(<TitleScreen stats={stats} onStart={onStart} onDone={onDone} />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.keyboard('x')
    await user.keyboard('{Enter}')
    act(() => void vi.advanceTimersByTime(LEAVE_MS + 10))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('remembers that it was seen for this tab', async () => {
    expect(shouldShowTitle()).toBe(true)
    render(<TitleScreen stats={stats} onStart={() => {}} onDone={() => {}} />)
    await userEvent.setup().keyboard('a')
    expect(shouldShowTitle()).toBe(false)
  })

  it('?title shows it again', () => {
    window.sessionStorage.setItem('hoops-title-seen', '1')
    window.history.replaceState(null, '', '/?title')
    expect(shouldShowTitle()).toBe(true)
  })

  it('shows it when storage is blocked', () => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('blocked')
      },
      configurable: true,
    })
    expect(shouldShowTitle()).toBe(true)
  })
})
