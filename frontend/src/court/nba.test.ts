import { describe, expect, it } from 'vitest'
import {
  LEAGUE,
  MIN_SHOTS_FOR_MATCH,
  NBA_ZONE_PCT,
  benchZonePct,
  benchmarkOf,
  compareOverall,
  compareZones,
  rankPlayers,
  typicalOf,
} from './nba'
import type { Benchmark } from './nba'
import { PLAYERS } from './players'
import type { Player } from './players'
import type { MapShot } from './stats'

let nextId = 1
function shot(over: Partial<MapShot> = {}): MapShot {
  return { id: nextId++, player: 'Ann', x: 25, y: 10, made: true, zone: 'paint', shot_type: '2PT', ...over }
}

/** `n` shots of one type, the first `made` of them made. */
function many(n: number, made: number, type: '2PT' | '3PT'): MapShot[] {
  return Array.from({ length: n }, (_, i) =>
    shot({ made: i < made, shot_type: type, zone: type === '3PT' ? 'top_3' : 'paint' }),
  )
}

const player = (over: Partial<Player> = {}): Player => ({
  id: 1,
  name: 'Test',
  team: 'GSW',
  position: 'Guard',
  fg: 50,
  three: 40,
  ppg: 20,
  threeShare: 30,
  style: '',
  ...over,
})

describe('benchZonePct', () => {
  it('returns the typed-in league figure for the league', () => {
    expect(benchZonePct('restricted_area', LEAGUE)).toBe(65)
    expect(benchZonePct('top_3', LEAGUE)).toBe(36)
  })

  it('is 0 for an unknown zone', () => {
    expect(benchZonePct('half_court', LEAGUE)).toBe(0)
  })

  it('scales three-point zones by the player three-point ratio', () => {
    const bench: Benchmark = { ...LEAGUE, label: 'Sniper', three: LEAGUE.three * 1.1 }
    expect(benchZonePct('top_3', bench)).toBeCloseTo(36 * 1.1, 0)
    expect(benchZonePct('left_corner_3', bench)).toBeCloseTo(38.5 * 1.1, 0)
    // two-point zones are untouched because the two-point rate is unchanged
    expect(benchZonePct('paint', bench)).toBe(42)
  })

  it('scales two-point zones by the player two-point ratio, not the three-point one', () => {
    const bench: Benchmark = { ...LEAGUE, label: 'Big', two: LEAGUE.two * 1.2, three: LEAGUE.three * 0.5 }
    expect(benchZonePct('mid_range', bench)).toBeCloseTo(41 * 1.2, 0)
    expect(benchZonePct('top_3', bench)).toBeCloseTo(36 * 0.5, 0)
  })

  it('never goes above 90', () => {
    const bench: Benchmark = { ...LEAGUE, label: 'Cheat', two: 200 }
    expect(benchZonePct('restricted_area', bench)).toBe(90)
  })

  it('rounds to one decimal', () => {
    const bench: Benchmark = { ...LEAGUE, label: 'X', three: 40 }
    const v = benchZonePct('top_3', bench)
    expect(Math.round(v * 10) / 10).toBe(v)
  })
})

describe('compareZones', () => {
  it('lists every known zone, including zones with no shots', () => {
    const rows = compareZones([])
    expect(rows.map((r) => r.zone).sort()).toEqual(Object.keys(NBA_ZONE_PCT).sort())
    expect(rows.every((r) => r.mine === null && r.diff === null && r.attempts === 0)).toBe(true)
  })

  it('puts the busiest zone first and computes the difference to the benchmark', () => {
    const shots = [
      shot({ zone: 'paint', made: true }),
      shot({ zone: 'paint', made: true }),
      shot({ zone: 'top_3', made: false, shot_type: '3PT' }),
    ]
    const rows = compareZones(shots)
    expect(rows[0]).toMatchObject({ zone: 'paint', attempts: 2, made: 2, mine: 100, nba: 42, diff: 58 })
    expect(rows[1]).toMatchObject({ zone: 'top_3', mine: 0, diff: -36 })
  })
})

describe('compareOverall', () => {
  it('has three rows with the benchmark numbers', () => {
    const rows = compareOverall([], LEAGUE)
    expect(rows.map((r) => r.label)).toEqual(['Field goal', 'Three point', 'Share of threes'])
    expect(rows.map((r) => r.nba)).toEqual([LEAGUE.fg, LEAGUE.three, LEAGUE.threeShare])
    expect(rows.every((r) => r.mine === null)).toBe(true)
  })

  it('computes my numbers and attempts', () => {
    const shots = [...many(6, 3, '2PT'), ...many(4, 1, '3PT')]
    const [fg, three, share] = compareOverall(shots)
    expect(fg).toMatchObject({ mine: 40, attempts: 10 })
    expect(three).toMatchObject({ mine: 25, attempts: 4 })
    expect(share).toMatchObject({ mine: 40, attempts: 10 })
  })

  it('has a null three-point rate when there are no threes', () => {
    const [, three, share] = compareOverall(many(5, 2, '2PT'))
    expect(three.mine).toBeNull()
    expect(three.attempts).toBe(0)
    expect(share.mine).toBe(0)
  })

  it('uses the benchmark of a player when given one', () => {
    const p = player({ fg: 55, three: 33, threeShare: 12 })
    const rows = compareOverall([], benchmarkOf(p))
    expect(rows.map((r) => r.nba)).toEqual([55, 33, 12])
  })
})

describe('rankPlayers', () => {
  it('is null below the minimum number of shots and a list at the minimum', () => {
    expect(rankPlayers(many(MIN_SHOTS_FOR_MATCH - 1, 5, '2PT'))).toBeNull()
    expect(rankPlayers([])).toBeNull()
    expect(rankPlayers(many(MIN_SHOTS_FOR_MATCH, 5, '2PT'))).not.toBeNull()
  })

  it('returns every player sorted by score, then name', () => {
    const out = rankPlayers([...many(12, 6, '2PT'), ...many(8, 3, '3PT')])
    expect(out).toHaveLength(PLAYERS.length)
    for (let i = 1; i < out!.length; i++) {
      const a = out![i - 1]
      const b = out![i]
      expect(a.score).toBeGreaterThanOrEqual(b.score)
      if (a.score === b.score) expect(a.player.name.localeCompare(b.player.name)).toBeLessThanOrEqual(0)
    }
    for (const m of out!) {
      expect(m.score).toBeGreaterThanOrEqual(0)
      expect(m.score).toBeLessThanOrEqual(100)
    }
  })

  it('ranks the closest profile first', () => {
    // A heavy three-point shooter: 55% threes, 41% from three, 47% overall (Curry's rounded profile).
    // 100 shots: 55 threes (23 made = 42%), 45 twos (24 made): 47 of 100 made.
    const curryLike = [...many(55, 23, '3PT'), ...many(45, 24, '2PT')]
    expect(rankPlayers(curryLike)![0].player.name).toBe('Stephen Curry')
    // A rim-running big: few threes, high percentage inside.
    const bigLike = [...many(80, 50, '2PT'), ...many(20, 7, '3PT')]
    const top = rankPlayers(bigLike)![0]
    expect(top.player.threeShare).toBeLessThanOrEqual(20)
  })

  it('still ranks when there are no threes, ignoring the unknown three-point rate', () => {
    const out = rankPlayers(many(20, 10, '2PT'))!
    expect(out).toHaveLength(PLAYERS.length)
    // Without three-point attempts, three-point percentage must not drag scores toward 0 for everyone.
    expect(out.every((m) => Number.isFinite(m.score))).toBe(true)
    // The closest player is the one with the lowest three share and fg nearest 50.
    const best = out[0]
    expect(best.score).toBeGreaterThan(out[out.length - 1].score)
    expect(best.player.threeShare).toBeLessThanOrEqual(20)
  })

  it('gives a different result with three-point shots than without when the three rate is far off', () => {
    const twosOnly = many(20, 10, '2PT')
    const withMissedThrees = [...many(10, 5, '2PT'), ...many(10, 0, '3PT')]
    const a = rankPlayers(twosOnly)!.find((m) => m.player.name === 'Stephen Curry')!
    const b = rankPlayers(withMissedThrees)!.find((m) => m.player.name === 'Stephen Curry')!
    expect(a.score).not.toBe(b.score)
  })
})

describe('typicalOf', () => {
  it('removes the threes from the overall rate to get the two-point rate', () => {
    // fg .50 = 0.7 * two + 0.3 * 0.40  ->  two = 0.38 / 0.7
    const t = typicalOf(player({ fg: 50, three: 40, threeShare: 30 }))
    expect(t['3PT']).toBeCloseTo(0.4)
    expect(t['2PT']).toBeCloseTo(0.38 / 0.7)
  })

  it('clamps an implausibly high two-point rate to 0.75', () => {
    // fg 60, all from a 20% three-point shooter who takes 10% threes: two would be 0.64 / 0.9 = 0.71, so push it further
    const t = typicalOf(player({ fg: 80, three: 20, threeShare: 10 }))
    expect(t['2PT']).toBe(0.75)
  })

  it('clamps an implausibly low two-point rate to 0.3', () => {
    const t = typicalOf(player({ fg: 30, three: 60, threeShare: 60 }))
    expect(t['2PT']).toBe(0.3)
  })

  it('does not divide by zero for a player who only shoots threes', () => {
    const t = typicalOf(player({ fg: 40, three: 40, threeShare: 100 }))
    expect(t['2PT']).toBe(0.5)
    expect(t['3PT']).toBeCloseTo(0.4)
  })

  it('works for every listed player', () => {
    for (const p of PLAYERS) {
      const t = typicalOf(p)
      expect(t['2PT']).toBeGreaterThanOrEqual(0.3)
      expect(t['2PT']).toBeLessThanOrEqual(0.75)
    }
  })
})
