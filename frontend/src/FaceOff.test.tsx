// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { playerProfile, shooterProfile } from './court/cardData'
import { FACE_OFF_MS } from './court/faceoff'
import { PLAYERS } from './court/players'
import FaceOff from './FaceOff'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const you = shooterProfile(
  'Yuly',
  Array.from({ length: 12 }, (_, i) => ({ zone: 'restricted_area', made: i % 2 === 0, shot_type: '2PT' as const })),
)
const them = playerProfile(PLAYERS.find((p) => p.name === 'Stephen Curry')!)
const ui = (onClose: () => void) => <FaceOff you={you} them={them} verdict="v" onClose={onClose} />
const button = () => screen.getByRole('button', { name: 'See the full comparison' })

describe('FaceOff timer', () => {
  it('does not restart when the parent re-renders with a new onClose', () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(ui(first))
    vi.advanceTimersByTime(5000)
    rerender(ui(second))
    vi.advanceTimersByTime(FACE_OFF_MS - 5000 - 100)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200) // 7.5 s after the FIRST mount
    // It calls the latest onClose, once.
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10000)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('takes focus once and gives it back to the opener only when it closes', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { rerender, unmount } = render(ui(vi.fn()))
    expect(document.activeElement).toBe(button())
    rerender(ui(vi.fn()))
    expect(document.activeElement).toBe(button())
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('FaceOff keyboard', () => {
  it('closes with Escape and keeps the key from reaching other handlers', () => {
    const onClose = vi.fn()
    const other = vi.fn()
    window.addEventListener('keydown', other)
    render(ui(onClose))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', other)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
  })

  it('keeps Tab and Shift+Tab on the button', () => {
    render(ui(vi.fn()))
    expect(document.activeElement).toBe(button())
    for (const shiftKey of [false, true]) {
      const notCancelled = fireEvent.keyDown(button(), { key: 'Tab', shiftKey })
      expect(notCancelled).toBe(false) // preventDefault was called
      expect(document.activeElement).toBe(button())
    }
  })

  it('pulls focus back to the button when it is on the body, so it cannot go to the page behind', () => {
    render(ui(vi.fn()))
    act(() => (document.activeElement as HTMLElement).blur())
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Tab' })
    expect(document.activeElement).toBe(button())
    act(() => button().blur())
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(button())
  })
})
