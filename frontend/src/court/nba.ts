import { PLAYERS } from './players'
import type { Player } from './players'
import { TYPICAL_FG, pct, zoneLabel } from './stats'
import type { Typical } from './stats'
import type { MapShot } from './stats'

/**
 * Rounded league-wide field-goal percentages from recent NBA seasons. They are approximate
 * (a season moves them by a point or two), so the page calls them "about".
 */
export const NBA_OVERALL = {
  fg: 47,
  two: Math.round(TYPICAL_FG['2PT'] * 1000) / 10,
  three: Math.round(TYPICAL_FG['3PT'] * 1000) / 10,
}

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

/**
 * The benchmark's percentage for one zone. For the league these are the typed-in zone figures.
 * For a player there is no zone data, so the league zone figure is scaled by how much better or
 * worse than the league that player is on threes (for the three-point zones) or on twos (for
 * the rest). It is an estimate, and the page says so.
 */
export function benchZonePct(zone: string, bench: Benchmark): number {
  const base = NBA_ZONE_PCT[zone] ?? 0
  if (bench === LEAGUE) return base
  const factor = zone.endsWith('_3') ? bench.three / LEAGUE.three : bench.two / LEAGUE.two
  return Math.min(90, Math.round(base * factor * 10) / 10)
}

export function compareZones(shots: MapShot[], bench: Benchmark = LEAGUE): ZoneCompare[] {
  return Object.keys(NBA_ZONE_PCT)
    .map((zone) => {
      const nba = benchZonePct(zone, bench)
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
  two: number
  three: number
  threeShare: number
}

export const LEAGUE: Benchmark = {
  label: 'NBA average',
  fg: NBA_OVERALL.fg,
  two: NBA_OVERALL.two,
  three: NBA_OVERALL.three,
  threeShare: NBA_THREE_SHARE,
}

export function benchmarkOf(p: Player): Benchmark {
  return { label: p.name, fg: p.fg, two: Math.round(typicalOf(p)['2PT'] * 1000) / 10, three: p.three, threeShare: p.threeShare }
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

/**
 * The make rates the map compares a spot to when a player is the baseline. Only the overall
 * and three-point % are known, so the two-point rate is what is left of the overall %
 * once the threes are taken out.
 */
export function typicalOf(p: Player): Typical {
  const three = p.three / 100
  const s = p.threeShare / 100
  const two = s >= 1 ? 0.5 : (p.fg / 100 - s * three) / (1 - s)
  return { '2PT': Math.min(0.75, Math.max(0.3, two)), '3PT': three }
}
