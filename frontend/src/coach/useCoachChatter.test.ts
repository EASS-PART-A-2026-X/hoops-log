// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatterContext } from './lines'
import { setChatterOn } from './prefs'
import { useCoach } from './useCoach'
import { FIRST_MS, GAP_MS, MAX_REMARKS, useCoachChatter } from './useCoachChatter'

beforeEach(() => {
  vi.useFakeTimers()
  setChatterOn(true)
})
afterEach(() => {
  cleanup()
  setChatterOn(true)
  vi.useRealTimers()
})

// Midday on a Tuesday with no shots: the only thing true is the water break, plus the level hint when it is close.
const context = (xpToNext = 100): ChatterContext => ({ shots: [], shooter: 'A', now: new Date('2026-11-10T13:00:00'), dates: [], xpToNext })

function setup(ready = true, ctx: () => ChatterContext = context) {
  return renderHook((p: { ready: boolean }) => {
    const coach = useCoach()
    useCoachChatter({ coach, ready: p.ready, context: ctx })
    return coach
  }, { initialProps: { ready } })
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('useCoachChatter', () => {
  it('stays quiet for the first minute, then speaks up once', () => {
    const { result } = setup()
    advance(FIRST_MS - 6000)
    expect(result.current.said).toBeNull()
    advance(7000)
    expect(result.current.said?.text).toMatch(/Water break/)
  })

  it('waits for the title screen and the loading to be over', () => {
    const { result, rerender } = setup(false)
    advance(FIRST_MS * 3)
    expect(result.current.said).toBeNull()
    rerender({ ready: true })
    advance(CHECK_PAD)
    expect(result.current.said).not.toBeNull()
  })

  it('does nothing when the visitor turned it off', () => {
    setChatterOn(false)
    const { result } = setup()
    advance(FIRST_MS * 3)
    expect(result.current.said).toBeNull()
  })

  it('leaves a few minutes between remarks and stops when it has nothing new to say', () => {
    let hits = 0
    const { result } = setup(true, () => {
      hits++
      return context(25)
    })
    advance(FIRST_MS + 6000)
    const first = result.current.said!.key
    advance(GAP_MS - 20_000)
    expect(result.current.said!.key).toBe(first)
    advance(40_000)
    expect(result.current.said!.key).toBeGreaterThan(first)
    // Two things were true (the next level and the water), so a third gap finds nothing and stays silent.
    const second = result.current.said!.key
    advance(GAP_MS * 3)
    expect(result.current.said!.key).toBe(second)
    expect(hits).toBeGreaterThan(1)
  })

  it('never says more than the limit in one visit', () => {
    expect(MAX_REMARKS).toBeLessThanOrEqual(6)
  })
})

const CHECK_PAD = 6000
