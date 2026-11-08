import { describe, expect, it } from 'vitest'
import { TROPHIES, ZONE_COUNT, bestStreak, bestWindow, trophyStatus, unlockedIds } from './achievements'
import { ZONE_NAMES } from '../court/stats'
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

  it('Sniper needs 12 makes inside any 20 shots in a row', () => {
    expect(status(many(19), 'sniper').unlocked).toBe(false) // not a full 20 shots yet
    expect(status(many(20), 'sniper').unlocked).toBe(true)
    const ordered = (flags: boolean[]) => flags.map((made, i) => shot({ made, game_date: `2026-10-${String(i + 1).padStart(2, '0')}` }))
    // 11 makes then 9 misses: only 11 in a window of 20
    expect(status(ordered([...Array(11).fill(true), ...Array(9).fill(false)]), 'sniper').unlocked).toBe(false)
    expect(status(ordered([...Array(12).fill(true), ...Array(8).fill(false)]), 'sniper').unlocked).toBe(true)
  })

  it('Sniper stays unlocked when a shot is saved with an earlier game date', () => {
    const date = (i: number) => `2026-10-${String(i + 1).padStart(2, '0')}`
    // 12 makes: the first and last shot and ten in the middle, so dropping either end of the 20 loses one.
    const base = Array.from({ length: 20 }, (_, i) => shot({ made: i === 0 || i === 19 || (i >= 5 && i <= 14), game_date: date(i) }))
    expect(status(base, 'sniper').unlocked).toBe(true)
    // Saved last (highest id) but dated into the middle. In date order this would leave at most 11 makes in
    // any 20 shots in a row and lock the trophy; in save order the first 20 shots are untouched.
    const backdated = shot({ made: false, game_date: date(10) })
    expect(status([...base, backdated], 'sniper').unlocked).toBe(true)
  })

  it('Sniper stays unlocked as more shots are added', () => {
    const base = Array.from({ length: 20 }, (_, i) => shot({ made: i < 12, game_date: `2026-10-${String(i + 1).padStart(2, '0')}` }))
    expect(status(base, 'sniper').unlocked).toBe(true)
    const later = Array.from({ length: 40 }, (_, i) => shot({ made: false, game_date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}` }))
    expect(status([...base, ...later], 'sniper').unlocked).toBe(true)
  })

  it('never reports more progress than the target', () => {
    expect(status(many(200), 'century').done).toBe(100)
  })
})

describe('bestWindow', () => {
  const flags = (list: boolean[]) => list.map((made, i) => shot({ made, game_date: `2026-09-${String(i + 1).padStart(2, '0')}` }))
  it('is the most makes in any run of that many shots', () => {
    expect(bestWindow(flags([true, false, true, true, false, false, true]), 3)).toBe(2)
    expect(bestWindow(flags([true, true, true]), 5)).toBe(3)
    expect(bestWindow([], 5)).toBe(0)
  })

  it('goes by the order the shots were saved (id), not by game date', () => {
    // Saved make, make, miss; but the dates put the miss in the middle.
    const list = [
      shot({ made: true, game_date: '2026-09-01' }),
      shot({ made: true, game_date: '2026-09-03' }),
      shot({ made: false, game_date: '2026-09-02' }),
    ]
    expect(bestWindow(list, 2)).toBe(2)
  })
})

describe('zone list', () => {
  it('Everywhere is unlocked by one shot in each zone the court has, and by no fewer', () => {
    const all = ZONE_NAMES.map((zone) => shot({ zone }))
    expect(ZONE_COUNT).toBeGreaterThan(0)
    expect(status(all, 'everywhere').unlocked).toBe(true)
    expect(status(all.slice(1), 'everywhere').unlocked).toBe(false)
  })
})
