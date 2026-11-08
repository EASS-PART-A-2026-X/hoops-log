// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCelebrations } from './useCelebrations'

let n = 0
const shot = (player: string, over: Record<string, unknown> = {}) => ({
  id: ++n, player, game_date: '2026-11-01', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 8, ...over,
})
type S = ReturnType<typeof shot>

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup(initial: S[] | null, truncated = false) {
  return renderHook((p: { shots: S[] | null; truncated: boolean }) => useCelebrations(p.shots, p.truncated), {
    initialProps: { shots: initial, truncated },
  })
}

describe('useCelebrations', () => {
  it('says nothing while loading and nothing for the first load, even with trophies already earned', () => {
    const { result, rerender } = setup(null)
    expect(result.current.toasts).toEqual([])
    rerender({ shots: Array.from({ length: 30 }, () => shot('A')), truncated: false })
    expect(result.current.toasts).toEqual([])
    expect(result.current.pop).toBeNull()
  })

  it('celebrates what a new shot earns: XP pop and a trophy', () => {
    const first = [shot('A', { made: false })]
    const { result, rerender } = setup(first)
    rerender({ shots: [...first, shot('A')], truncated: false })
    expect(result.current.pop).toMatchObject({ amount: 10, player: 'A' })
    expect(result.current.toasts.map((t) => t.title)).toEqual(['First Bucket'])
  })

  it('announces a level up', () => {
    const first = Array.from({ length: 5 }, () => shot('A', { made: false })) // 10 XP
    const { result, rerender } = setup(first)
    rerender({ shots: [...first, ...Array.from({ length: 6 }, () => shot('A', { shot_type: '3PT', zone: 'top_3' }))], truncated: false })
    expect(result.current.toasts.some((t) => t.kind === 'level' && t.title === 'LEVEL 2')).toBe(true)
    // Several trophies unlocked at the same time must not push the level up out of the stack.
    expect(result.current.toasts.at(-1)?.kind).toBe('level')
  })

  it('a brand new player is celebrated from zero', () => {
    const first = [shot('A')]
    const { result, rerender } = setup(first)
    rerender({ shots: [...first, shot('B')], truncated: false })
    expect(result.current.toasts.map((t) => t.title)).toContain('First Bucket')
    expect(result.current.pop?.player).toBe('B')
  })

  it('does not announce a trophy twice when it is lost and won again', () => {
    const base = Array.from({ length: 4 }, (_, i) => shot('A', { game_date: `2026-10-0${i + 1}` }))
    const { result, rerender } = setup(base)
    const withFifth = [...base, shot('A', { game_date: '2026-10-05' })]
    rerender({ shots: withFifth, truncated: false })
    expect(result.current.toasts.map((t) => t.title)).toContain('Hot Hand')
    for (let i = 0; i < 6; i++) act(() => void vi.advanceTimersByTime(5300))
    expect(result.current.toasts).toEqual([])
    // A miss dated inside the streak breaks it (trophy lost), then it is removed again (trophy back).
    rerender({ shots: [...withFifth, shot('A', { made: false, game_date: '2026-10-03' })], truncated: false })
    rerender({ shots: withFifth, truncated: false })
    expect(result.current.toasts.map((t) => t.title)).not.toContain('Hot Hand')
  })

  it('stays silent while the list is cut short, then quiet about what it already saw', () => {
    const first = [shot('A', { made: false })]
    const { result, rerender } = setup(first, true)
    rerender({ shots: [...first, shot('A')], truncated: true })
    expect(result.current.toasts).toEqual([])
    expect(result.current.pop).toBeNull()
  })

  it('after a cut-short list is whole again, what it showed is not announced late', () => {
    const first = [shot('A', { made: false })]
    const withMake = [...first, shot('A')]
    const { result, rerender } = setup(first, true)
    rerender({ shots: withMake, truncated: true })
    rerender({ shots: withMake, truncated: false })
    expect(result.current.toasts).toEqual([])
    // ...but the next real change is celebrated again.
    rerender({ shots: [...withMake, shot('A')], truncated: false })
    expect(result.current.pop?.amount).toBeGreaterThan(0)
  })

  it('shows at most three toasts, keeping the newest', () => {
    const first = [shot('A', { made: false })]
    const { result, rerender } = setup(first)
    const many = Array.from({ length: 12 }, () => shot('A', { zone: 'left_corner_3', shot_type: '3PT' }))
    rerender({ shots: [...first, ...many], truncated: false })
    expect(result.current.toasts.length).toBeLessThanOrEqual(3)
    expect(result.current.toasts.length).toBeGreaterThan(0)
  })

  it('toasts go away by themselves, one at a time, and the XP pop too', () => {
    const first = [shot('A', { made: false })]
    const { result, rerender } = setup(first)
    rerender({ shots: [...first, shot('A')], truncated: false })
    expect(result.current.toasts).toHaveLength(1)
    act(() => void vi.advanceTimersByTime(1900))
    expect(result.current.pop).toBeNull()
    act(() => void vi.advanceTimersByTime(5300))
    expect(result.current.toasts).toHaveLength(0)
  })

  it('dismiss removes one toast', () => {
    const first = [shot('A', { made: false })]
    const { result, rerender } = setup(first)
    rerender({ shots: [...first, shot('A')], truncated: false })
    const id = result.current.toasts[0]!.id
    act(() => result.current.dismiss(id))
    expect(result.current.toasts).toHaveLength(0)
  })
})
