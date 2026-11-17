import { describe, expect, it } from 'vitest'
import { chronological, levelInfo, rankTitle, shotXp, totalXp, xpToReach } from './xp'
import type { XpShot } from './xp'

const shot = (id: number, over: Partial<XpShot> = {}): XpShot => ({
  id,
  game_date: '2026-11-01',
  made: true,
  zone: 'paint',
  shot_type: '2PT',
  ...over,
})

describe('shotXp', () => {
  it('pays a little for a miss, more for a make, and a bonus for threes and hard zones', () => {
    expect(shotXp(shot(1, { made: false }), 0)).toBe(2)
    expect(shotXp(shot(1), 0)).toBe(10)
    expect(shotXp(shot(1, { shot_type: '3PT', zone: 'top_3' }), 0)).toBe(15)
    expect(shotXp(shot(1, { zone: 'mid_range' }), 0)).toBe(13)
  })

  it('adds a streak bonus from the third make in a row, capped', () => {
    expect(shotXp(shot(1), 1)).toBe(10)
    expect(shotXp(shot(1), 2)).toBe(15)
    expect(shotXp(shot(1), 3)).toBe(20)
    expect(shotXp(shot(1), 50)).toBe(25)
  })

  it('gives no streak bonus to a miss', () => {
    expect(shotXp(shot(1, { made: false }), 9)).toBe(2)
  })
})

describe('totalXp', () => {
  it('is zero without shots', () => {
    expect(totalXp([])).toBe(0)
  })

  it('counts a streak in date order, not in input order', () => {
    const list = [shot(3), shot(1), shot(2)]
    // 10 + 10 + (10 + 5)
    expect(totalXp(list)).toBe(35)
  })

  it('a miss resets the streak', () => {
    expect(totalXp([shot(1), shot(2), shot(3, { made: false }), shot(4)])).toBe(10 + 10 + 2 + 10)
  })
})

describe('chronological', () => {
  it('sorts by date, then id, without changing the input', () => {
    const input = [shot(2, { game_date: '2026-11-02' }), shot(3), shot(1)]
    expect(chronological(input).map((s) => s.id)).toEqual([1, 3, 2])
    expect(input.map((s) => s.id)).toEqual([2, 3, 1])
  })
})

describe('levelInfo', () => {
  it('starts at level 1 with an empty bar', () => {
    expect(levelInfo(0)).toMatchObject({ level: 1, into: 0, span: 60, fraction: 0, title: 'ROOKIE' })
  })

  it('moves up exactly at each threshold', () => {
    for (let level = 2; level <= 30; level++) {
      const at = xpToReach(level)
      expect(levelInfo(at).level).toBe(level)
      expect(levelInfo(at - 1).level).toBe(level - 1)
    }
  })

  it('reports progress inside a level', () => {
    const info = levelInfo(150) // level 2 spans 60..240
    expect(info).toMatchObject({ level: 2, into: 90, span: 180 })
    expect(info.fraction).toBeCloseTo(0.5)
  })

  it('treats negative and fractional XP safely', () => {
    expect(levelInfo(-5).level).toBe(1)
    expect(levelInfo(59.9).level).toBe(1)
  })
})

describe('rankTitle', () => {
  it('names the rank for a level', () => {
    expect(rankTitle(1)).toBe('ROOKIE')
    expect(rankTitle(2)).toBe('ROOKIE')
    expect(rankTitle(3)).toBe('GYM RAT')
    expect(rankTitle(7)).toBe('SHARPSHOOTER')
    expect(rankTitle(99)).toBe('LEGEND')
  })
})
