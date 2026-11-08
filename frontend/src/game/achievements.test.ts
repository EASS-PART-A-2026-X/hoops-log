import { describe, expect, it } from 'vitest'
import { TROPHIES, bestStreak, trophyStatus, unlockedIds } from './achievements'
import type { TrophyShot } from './achievements'

let n = 0
const shot = (over: Partial<TrophyShot> = {}): TrophyShot => ({
  id: ++n,
  game_date: '2026-11-01',
  made: true,
  zone: 'paint',
  shot_type: '2PT',
  x: 25,
  y: 8,
  ...over,
})
const many = (count: number, over: Partial<TrophyShot> = {}) => Array.from({ length: count }, () => shot(over))
const status = (shots: TrophyShot[], id: string) => trophyStatus(shots).find((t) => t.trophy.id === id)!

describe('trophies', () => {
  it('has unique ids', () => {
    expect(new Set(TROPHIES.map((t) => t.id)).size).toBe(TROPHIES.length)
  })

  it('unlocks nothing without shots', () => {
    expect(unlockedIds([])).toEqual([])
  })

  it('First Bucket needs a make, not just a shot', () => {
    expect(status([shot({ made: false })], 'first-bucket').unlocked).toBe(false)
    expect(status([shot()], 'first-bucket').unlocked).toBe(true)
  })

  it('counts shots logged for Warm-Up, Gym Rat and Century', () => {
    expect(status(many(9), 'warm-up').unlocked).toBe(false)
    expect(status(many(10), 'warm-up').unlocked).toBe(true)
    expect(status(many(49), 'gym-rat').unlocked).toBe(false)
    expect(status(many(50), 'gym-rat').unlocked).toBe(true)
    expect(status(many(100), 'century').unlocked).toBe(true)
  })

  it('Corner Assassin counts made corner threes on both sides only', () => {
    const corners = [
      ...many(3, { zone: 'left_corner_3', shot_type: '3PT' }),
      ...many(2, { zone: 'right_corner_3', shot_type: '3PT' }),
    ]
    expect(status(corners.slice(0, 4), 'corner-assassin').unlocked).toBe(false)
    expect(status(corners, 'corner-assassin').unlocked).toBe(true)
    expect(status([...corners.slice(0, 4), shot({ zone: 'left_corner_3', made: false })], 'corner-assassin').unlocked).toBe(false)
    expect(status([...corners.slice(0, 4), shot({ zone: 'top_3', shot_type: '3PT' })], 'corner-assassin').unlocked).toBe(false)
  })

  it('From Downtown counts made threes', () => {
    expect(status(many(10, { shot_type: '3PT', zone: 'top_3' }), 'downtown').unlocked).toBe(true)
    expect(status(many(10, { shot_type: '3PT', zone: 'top_3', made: false }), 'downtown').done).toBe(0)
  })

  it('Hot Hand needs five makes in a row in date order', () => {
    const run = [1, 2, 3, 4].map((i) => shot({ game_date: `2026-11-0${i}` }))
    const miss = shot({ made: false, game_date: '2026-11-05' })
    const last = shot({ game_date: '2026-11-06' })
    expect(bestStreak([...run, miss, last])).toBe(4)
    expect(status([...run, miss, last], 'hot-hand').unlocked).toBe(false)
    expect(bestStreak([...run, shot({ game_date: '2026-11-05' })])).toBe(5)
    expect(status([last, miss, ...run, shot({ game_date: '2026-11-05' })].filter((s) => s !== miss && s !== last), 'hot-hand').unlocked).toBe(true)
  })

  it('Everywhere needs all ten zones', () => {
    const zones = [
      'left_corner_3', 'left_wing_3', 'top_3', 'right_wing_3', 'right_corner_3',
      'left_elbow', 'right_elbow', 'mid_range', 'paint', 'restricted_area',
    ]
    expect(status(zones.slice(0, 9).map((zone) => shot({ zone })), 'everywhere').unlocked).toBe(false)
    expect(status(zones.map((zone) => shot({ zone, made: false })), 'everywhere').unlocked).toBe(true)
  })

  it('Regular counts distinct days', () => {
    expect(status(many(5), 'regular').done).toBe(1)
    expect(status(['01', '02', '03'].map((d) => shot({ game_date: `2026-11-${d}` })), 'regular').unlocked).toBe(true)
  })

  it('Sniper needs 20 shots and 60 percent', () => {
    expect(status(many(19), 'sniper').unlocked).toBe(false)
    expect(status([...many(12), ...many(8, { made: false })], 'sniper').unlocked).toBe(true)
    expect(status([...many(11), ...many(9, { made: false })], 'sniper').unlocked).toBe(false)
  })

  it('never reports more progress than the target', () => {
    expect(status(many(200), 'century').done).toBe(100)
  })
})
