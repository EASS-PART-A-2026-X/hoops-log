// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameToast } from '../game/useCelebrations'
import type { TabName } from './lines'
import { useCoach } from './useCoach'
import { currentStreak, useCoachEvents } from './useCoachEvents'

let n = 0
const shot = (made = true, over: Record<string, unknown> = {}) => ({ id: ++n, player: 'A', game_date: '2026-11-01', made, ...over })
type S = ReturnType<typeof shot>
interface Props {
  shots: S[] | null
  truncated?: boolean
  ready?: boolean
  tab?: TabName
  toasts?: GameToast[]
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup(initial: Props) {
  return renderHook(
    (p: Props) => {
      const coach = useCoach()
      useCoachEvents({ coach, shots: p.shots, truncated: p.truncated ?? false, ready: p.ready ?? true, tab: p.tab ?? 'log', name: 'A', shotCount: p.shots?.length ?? 0, rank: 'Rookie', toasts: p.toasts ?? [] })
      return coach
    },
    { initialProps: initial },
  )
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('currentStreak', () => {
  it('counts the makes at the end, in the order they were taken, not the order of the list', () => {
    const early = shot(false, { game_date: '2026-10-01' })
    const a = shot(true)
    const b = shot(true)
    expect(currentStreak([a, early, b])).toBe(2)
    expect(currentStreak([])).toBe(0)
    expect(currentStreak([shot(true), shot(false)])).toBe(0)
  })
})

describe('useCoachEvents', () => {
  it('greets once when the app is ready and the shots are loaded, and not before', () => {
    const { result, rerender } = setup({ shots: null, ready: false })
    expect(result.current.said).toBeNull()
    rerender({ shots: [shot()], ready: false })
    expect(result.current.said).toBeNull() // the title screen is still up
    rerender({ shots: [shot()], ready: true })
    expect(result.current.said?.text).toMatch(/Welcome back, A/)
    const key = result.current.said!.key
    rerender({ shots: [shot()], ready: true })
    expect(result.current.said!.key).toBe(key)
  })

  it('gives a page hint the first time only, and not for the page it starts on', () => {
    const base = [shot()]
    const { result, rerender } = setup({ shots: base })
    const greeting = result.current.said!.key
    rerender({ shots: base, tab: 'nba' })
    expect(result.current.said?.text).toMatch(/NBA average/)
    const hint = result.current.said!.key
    rerender({ shots: base, tab: 'log' })
    rerender({ shots: base, tab: 'nba' })
    expect(result.current.said!.key).toBe(hint)
    expect(hint).toBeGreaterThan(greeting)
  })

  it('reacts to a new shot after the first load, but not to the first load itself', () => {
    const first = [shot(false)]
    const { result, rerender } = setup({ shots: first })
    const greeting = result.current.said!.key
    advance(200)
    expect(result.current.said!.key).toBe(greeting)
    rerender({ shots: [...first, shot(false)] })
    advance(200)
    expect(result.current.said!.key).toBeGreaterThan(greeting)
    expect(result.current.said!.mood).toBe('hmm')
  })

  it('makes a fuss over a streak of three or more makes', () => {
    const first = [shot(true), shot(true)]
    const { result, rerender } = setup({ shots: first })
    rerender({ shots: [...first, shot(true)] })
    advance(200)
    expect(result.current.said?.text).toMatch(/3 in a row/)
    expect(result.current.said?.mood).toBe('hype')
  })

  it('does not comment on a list that is cut short, or on shots appearing when it stops being cut short', () => {
    const first = [shot()]
    const { result, rerender } = setup({ shots: first, truncated: true })
    const greeting = result.current.said!.key
    rerender({ shots: [...first, shot()], truncated: true })
    rerender({ shots: [...first, shot(), shot()], truncated: false })
    advance(200)
    expect(result.current.said!.key).toBe(greeting)
  })

  it('does not comment when a shot is deleted or edited', () => {
    const list = [shot(), shot(), shot()]
    const { result, rerender } = setup({ shots: list })
    const greeting = result.current.said!.key
    rerender({ shots: list.slice(0, 2) })
    rerender({ shots: [list[0]!, { ...list[1]!, made: false }] })
    advance(200)
    expect(result.current.said!.key).toBe(greeting)
  })

  it('lets a level up or trophy win over the plain saved line', () => {
    const first = [shot(false)]
    const { result, rerender } = setup({ shots: first })
    const toast: GameToast = { id: 1, kind: 'level', title: 'LEVEL 2', sub: 'x', level: { level: 2, rank: 'Rookie' } }
    rerender({ shots: [...first, shot(true)] })
    rerender({ shots: [...first, shot(true)], toasts: [toast] })
    expect(result.current.said?.text).toMatch(/Level 2, Rookie/)
    advance(200)
    expect(result.current.said?.text).toMatch(/Level 2, Rookie/)
  })

  it('announces a trophy by name and each toast only once', () => {
    const first = [shot(false)]
    const { result, rerender } = setup({ shots: first })
    const toast: GameToast = { id: 1, kind: 'trophy', title: 'First Bucket', sub: 'x' }
    rerender({ shots: first, toasts: [toast] })
    expect(result.current.said?.text).toContain('First Bucket')
    const key = result.current.said!.key
    rerender({ shots: first, toasts: [toast] })
    expect(result.current.said!.key).toBe(key)
  })

  it('celebrates a round number of shots, ahead of a streak and a plain save', () => {
    const first = Array.from({ length: 24 }, () => shot(true))
    const { result, rerender } = setup({ shots: first })
    rerender({ shots: [...first, shot(true)] })
    advance(200)
    expect(result.current.said?.text).toMatch(/Shot number 25 /)
    expect(result.current.said?.mood).toBe('hype')
    // The next one is just a save (or a streak), not another milestone.
    rerender({ shots: [...first, shot(true), shot(false)] })
    advance(200)
    expect(result.current.said?.text).not.toMatch(/Shot number/)
  })

  it('counts a milestone per player, not across everyone', () => {
    const others = Array.from({ length: 30 }, () => shot(true, { player: 'B' }))
    const mine = [shot(false), shot(false)]
    const { result, rerender } = setup({ shots: [...others, ...mine] })
    rerender({ shots: [...others, ...mine, shot(false)] })
    advance(200)
    expect(result.current.said?.text).not.toMatch(/Shot number/)
  })

  it('greets someone who has been away for days with how long, and others normally', () => {
    const old = (daysAgo: number) => {
      const d = new Date()
      d.setDate(d.getDate() - daysAgo)
      const p = (v: number) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const away = setup({ shots: [shot(true, { game_date: old(9) }), shot(true, { game_date: old(10) })] })
    expect(away.result.current.said?.text).toMatch(/9 days since your last shot/)
    cleanup()
    const near = setup({ shots: [shot(true, { game_date: old(1) })] })
    expect(near.result.current.said?.text).toMatch(/Welcome back, A\. 1 shots logged/)
  })
})
