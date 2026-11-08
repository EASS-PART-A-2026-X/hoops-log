import { describe, expect, it } from 'vitest'
import { EMPTY_SNAP, byPlayer, diffSnap, snapOf } from './celebrate'
import type { TrophyShot } from './achievements'

let n = 0
const shot = (over: Partial<TrophyShot> = {}): TrophyShot => ({
  id: ++n, game_date: '2026-11-01', made: true, zone: 'paint', shot_type: '2PT', x: 25, y: 8, ...over,
})

describe('diffSnap', () => {
  it('reports the XP, level and trophies a first make earns', () => {
    const change = diffSnap(EMPTY_SNAP, snapOf([shot()]))
    expect(change).toEqual({ xpGain: 10, levelUp: null, newTrophyIds: ['first-bucket'] })
  })

  it('reports a level up when the XP crosses a threshold', () => {
    const before = snapOf(Array.from({ length: 5 }, () => shot({ made: false }))) // 10 XP
    const after = snapOf([...Array.from({ length: 5 }, () => shot({ made: false })), ...Array.from({ length: 6 }, () => shot({ shot_type: '3PT', zone: 'top_3' }))])
    expect(diffSnap(before, after).levelUp).toBe(2)
  })

  it('never celebrates a decrease', () => {
    const big = snapOf(Array.from({ length: 12 }, () => shot()))
    expect(diffSnap(big, EMPTY_SNAP)).toEqual({ xpGain: 0, levelUp: null, newTrophyIds: [] })
  })

  it('says nothing when nothing changed', () => {
    const s = snapOf([shot()])
    expect(diffSnap(s, s)).toEqual({ xpGain: 0, levelUp: null, newTrophyIds: [] })
  })
})

describe('byPlayer', () => {
  it('groups shots by player', () => {
    const groups = byPlayer([{ player: 'A', id: 1 }, { player: 'B', id: 2 }, { player: 'A', id: 3 }])
    expect([...groups.keys()]).toEqual(['A', 'B'])
    expect(groups.get('A')!.map((s) => s.id)).toEqual([1, 3])
  })
})
