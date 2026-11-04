import { PLAYERS } from './players'
import type { Player } from './players'
import { pct, zoneLabel } from './stats'
import type { MapShot } from './stats'

/**
 * Rounded league-wide field-goal percentages from recent NBA seasons. They are approximate
 * (a season moves them by a point or two), so the page calls them "about".
 */
export const NBA_OVERALL = { fg: 47, two: 54, three: 36.5 } as const

export const NBA_ZONE_PCT: Record<string, number> = {
  restricted_area: 65,
  paint: 42,
  mid_range: 41,
  left_elbow: 42,
  right_elbow: 42,
  left_corner_3: 38.5,
  right_corner_3: 38.5,
  left_wing_3: 36,
  right_wing_3: 36,
  top_3: 36,
}

/** Few shots tell little: under this many attempts a zone is marked as a small sample. */
export const SMALL_SAMPLE = 5

export interface ZoneCompare {
  zone: string
  label: string
  made: number
  attempts: number
  mine: number | null
  nba: number
  /** Percentage points above (+) or below (-) the NBA average; null with no shots. */
  diff: number | null
}

export function compareZones(shots: MapShot[]): ZoneCompare[] {
  return Object.entries(NBA_ZONE_PCT)
    .map(([zone, nba]) => {
      const inZone = shots.filter((s) => s.zone === zone)
      const made = inZone.filter((s) => s.made).length
      const mine = pct(made, inZone.length)
      return {
        zone,
        label: zoneLabel(zone),
        made,
        attempts: inZone.length,
        mine,
        nba,
        diff: mine === null ? null : Math.round((mine - nba) * 10) / 10,
      }
    })
    .sort((a, b) => b.attempts - a.attempts || a.zone.localeCompare(b.zone))
}

export interface OverallCompare {
  label: string
  mine: number | null
  nba: number
  attempts: number
}

export function compareOverall(shots: MapShot[], bench: Benchmark = LEAGUE): OverallCompare[] {
  const rate = (list: MapShot[]) => pct(list.filter((s) => s.made).length, list.length)
  const threes = shots.filter((s) => s.shot_type === '3PT')
  return [
    { label: 'Field goal', mine: rate(shots), nba: bench.fg, attempts: shots.length },
    { label: 'Three point', mine: rate(threes), nba: bench.three, attempts: threes.length },
    { label: 'Share of threes', mine: pct(threes.length, shots.length), nba: bench.threeShare, attempts: shots.length },
  ]
}

/** About what share of NBA shots are threes (rounded, recent seasons). */
export const NBA_THREE_SHARE = 40

/** What the vs NBA tab compares you with: the league, or one player. */
export interface Benchmark {
  label: string
  fg: number
  three: number
  threeShare: number
}

export const LEAGUE: Benchmark = {
  label: 'NBA average',
  fg: NBA_OVERALL.fg,
  three: NBA_OVERALL.three,
  threeShare: NBA_THREE_SHARE,
}

export function benchmarkOf(p: Player): Benchmark {
  return { label: p.name, fg: p.fg, three: p.three, threeShare: p.threeShare }
}

/** Fewer shots than this and "who you shoot like" would be a guess. */
export const MIN_SHOTS_FOR_MATCH = 10

export interface Match {
  player: Player
  /** 0..100, higher is closer. */
  score: number
}

/**
 * Rank players by how close their rounded profile is to yours: field goal %, three-point %
 * and how often you shoot threes. Null when there are too few shots to say anything.
 */
export function rankPlayers(shots: MapShot[]): Match[] | null {
  if (shots.length < MIN_SHOTS_FOR_MATCH) return null
  const threes = shots.filter((s) => s.shot_type === '3PT')
  const fg = (shots.filter((s) => s.made).length / shots.length) * 100
  // With no threes, the three-point % is unknown: leave it out of the distance instead of using 0.
  const three = threes.length === 0 ? null : (threes.filter((s) => s.made).length / threes.length) * 100
  const share = (threes.length / shots.length) * 100
  return PLAYERS.map((player) => {
    const parts = [Math.abs(fg - player.fg), Math.abs(share - player.threeShare)]
    if (three !== null) parts.push(Math.abs(three - player.three))
    const dist = parts.reduce((a, b) => a + b, 0) / parts.length
    return { player, score: Math.max(0, Math.round(100 - dist * 2)) }
  }).sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))
}
