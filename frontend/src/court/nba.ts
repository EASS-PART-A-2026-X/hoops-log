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

export function compareOverall(shots: MapShot[]): OverallCompare[] {
  const rate = (list: MapShot[]) => pct(list.filter((s) => s.made).length, list.length)
  const twos = shots.filter((s) => s.shot_type === '2PT')
  const threes = shots.filter((s) => s.shot_type === '3PT')
  return [
    { label: 'Field goal', mine: rate(shots), nba: NBA_OVERALL.fg, attempts: shots.length },
    { label: 'Two point', mine: rate(twos), nba: NBA_OVERALL.two, attempts: twos.length },
    { label: 'Three point', mine: rate(threes), nba: NBA_OVERALL.three, attempts: threes.length },
  ]
}
