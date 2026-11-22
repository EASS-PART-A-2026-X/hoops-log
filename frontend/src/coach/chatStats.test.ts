import { describe, expect, it } from 'vitest'
import { NBA_OVERALL, NBA_ZONE_PCT } from '../court/nba'
import type { MapShot } from '../court/stats'
import { buildStats } from './chatStats'

const shot = (id: number, zone: string, made: boolean, shot_type: '2PT' | '3PT' = '2PT'): MapShot => ({ id, player: 'Yuly', x: 25, y: 6, made, zone, shot_type })

describe('buildStats', () => {
  it('is null when there are no shots, so the AI is told the log is empty', () => {
    expect(buildStats([], 'Yuly')).toBeNull()
  })

  it('counts attempts, makes and threes the way the rest of the app does', () => {
    const stats = buildStats(
      [shot(1, 'paint', true), shot(2, 'paint', false), shot(3, 'top_3', true, '3PT'), shot(4, 'top_3', false, '3PT')],
      'Yuly',
    )!
    expect(stats).toMatchObject({ player: 'Yuly', attempts: 4, made: 2, fg_pct: 50, three_attempts: 2, three_made: 1, three_pct: 50 })
  })

  it('has no three-point percentage before a three is logged', () => {
    const stats = buildStats([shot(1, 'paint', true)], 'Yuly')!
    expect(stats.three_attempts).toBe(0)
    expect(stats.three_pct).toBeNull()
    expect(stats.fg_pct).toBe(100)
  })

  it('lists only the zones the player has shot from, the busiest first, with the league estimate next to each', () => {
    const stats = buildStats(
      [shot(1, 'paint', true), shot(2, 'left_elbow', false), shot(3, 'left_elbow', true), shot(4, 'left_elbow', true)],
      'Yuly',
    )!
    expect(stats.zones).toEqual([
      { zone: 'left_elbow', attempts: 3, made: 2, pct: 67, nba_pct: NBA_ZONE_PCT.left_elbow },
      { zone: 'paint', attempts: 1, made: 1, pct: 100, nba_pct: NBA_ZONE_PCT.paint },
    ])
  })

  it('carries the league numbers, which are estimates, from the one place they are kept', () => {
    const stats = buildStats([shot(1, 'paint', true)], 'Yuly')!
    expect(stats.nba_fg).toBe(NBA_OVERALL.fg)
    expect(stats.nba_three).toBe(NBA_OVERALL.three)
  })

  it('fits what the backend takes: a name of at most 50 characters and at most 12 zones', () => {
    const everyZone = Object.keys(NBA_ZONE_PCT).map((zone, i) => shot(i, zone, true))
    const stats = buildStats(everyZone, 'x'.repeat(80))!
    expect(stats.player).toHaveLength(50)
    expect(stats.zones.length).toBe(Object.keys(NBA_ZONE_PCT).length)
    expect(stats.zones.length).toBeLessThanOrEqual(12)
  })

  it('only has counts that add up, as the backend insists', () => {
    const stats = buildStats([shot(1, 'paint', true), shot(2, 'top_3', true, '3PT'), shot(3, 'top_3', false, '3PT')], 'Yuly')!
    expect(stats.made).toBeLessThanOrEqual(stats.attempts)
    expect(stats.three_made).toBeLessThanOrEqual(stats.three_attempts)
    expect(stats.three_attempts).toBeLessThanOrEqual(stats.attempts)
    for (const z of stats.zones) expect(z.made).toBeLessThanOrEqual(z.attempts)
  })
})
