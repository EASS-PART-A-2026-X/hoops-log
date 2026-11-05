import { benchZonePct, benchmarkOf } from './nba'
import type { Player } from './players'
import { TEAMS } from './players'

/**
 * The numbers on a shot card: a shooting rating, a play style and a five-axis radar of where the
 * shooter scores. Pure functions, so the rules can be tested and the card is only drawing.
 */

/** The five areas of the radar, each a group of court zones. */
export const RADAR_AXES = [
  { key: 'rim', label: 'Rim', zones: ['restricted_area', 'paint'] },
  { key: 'mid', label: 'Mid-range', zones: ['mid_range', 'left_elbow', 'right_elbow'] },
  { key: 'corner', label: 'Corner 3', zones: ['left_corner_3', 'right_corner_3'] },
  { key: 'wing', label: 'Wing 3', zones: ['left_wing_3', 'right_wing_3'] },
  { key: 'top', label: 'Top 3', zones: ['top_3'] },
] as const

export type AxisKey = (typeof RADAR_AXES)[number]['key']

/** A rating needs this many shots. */
export const MIN_SHOTS_FOR_CARD = 10
/** An area on the radar needs this many shots, or it is drawn as "no data". */
export const MIN_SHOTS_PER_AXIS = 3
/** The radar's outer ring is this percentage. */
export const RADAR_MAX_PCT = 70
/** League effective field-goal percentage: 47% overall with about 40% of shots from three at 36.5%. */
const LEAGUE_EFG = 54.3

export interface CardProfile {
  kind: 'you' | 'nba'
  name: string
  /** "Your log" or "Warriors · Guard". */
  subtitle: string
  /** The shooting rating, or null when there are too few shots. */
  rating: number | null
  style: string
  fg: number | null
  three: number | null
  /** Share of shots that are threes, in percent. */
  threeShare: number | null
  /** How many shots the card is built from (null for an NBA player). */
  shots: number | null
  /** Field-goal percentage of each radar area, or null with too few shots. */
  radar: (number | null)[]
  /** True when the radar is an estimate (an NBA player has no zone data). */
  estimated: boolean
  teamColor?: string
  playerId?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Effective field-goal percentage: a three counts as one and a half twos. */
export function effectiveFg(fg: number, three: number, threeSharePct: number): number {
  return fg + 0.5 * three * (threeSharePct / 100)
}

/** The shooting rating, 30 to 99. The league average shooter is 70. Efficiency only: it says nothing about how often someone shoots. */
export function shootingRating(fg: number, three: number, threeSharePct: number): number {
  return clamp(Math.round(70 + 3.2 * (effectiveFg(fg, three, threeSharePct) - LEAGUE_EFG)), 30, 99)
}

/** Where a percentage sits on the radar, 0 (centre) to 1 (outer ring); null with no data. */
export function radarFraction(pct: number | null): number | null {
  return pct === null ? null : clamp(pct / RADAR_MAX_PCT, 0, 1)
}

interface ShotForCard {
  zone: string
  made: boolean
  shot_type: '2PT' | '3PT'
}

const pctOf = (made: number, total: number) => (total === 0 ? null : Math.round((made / total) * 100))

/** The play style of a shooter from their own shots. */
export function styleOfShots(total: number, share: Record<AxisKey, number>, threePct: number | null, cornerPct: number | null): string {
  if (total < MIN_SHOTS_FOR_CARD) return 'Rookie'
  const threes = share.corner + share.wing + share.top
  if (share.rim >= 0.45) return 'Rim finisher'
  if (threes >= 0.5) return threePct !== null && threePct >= 38 ? 'Sharpshooter' : 'Volume three-shooter'
  if (share.corner >= 0.2 && cornerPct !== null && cornerPct >= 40) return 'Corner specialist'
  if (share.mid >= 0.3) return 'Mid-range artist'
  return 'All-rounder'
}

/** The play style of an NBA player from the rounded figures we have (no zone data). */
export function styleOfPlayer(p: Pick<Player, 'fg' | 'three' | 'threeShare'>): string {
  if (p.threeShare >= 50) return p.three >= 38 ? 'Sharpshooter' : 'Volume three-shooter'
  if (p.threeShare <= 15) return 'Rim finisher'
  if (p.fg >= 54) return 'Efficient scorer'
  return 'All-rounder'
}

/** The card of the person whose shots these are. */
export function shooterProfile(name: string, shots: ShotForCard[]): CardProfile {
  const total = shots.length
  const made = shots.filter((s) => s.made).length
  const threes = shots.filter((s) => s.shot_type === '3PT')
  const threesMade = threes.filter((s) => s.made).length
  const fg = pctOf(made, total)
  const three = pctOf(threesMade, threes.length)
  const share = total === 0 ? null : Math.round((threes.length / total) * 100)

  const perAxis = RADAR_AXES.map((axis) => {
    const inAxis = shots.filter((s) => (axis.zones as readonly string[]).includes(s.zone))
    return { key: axis.key, attempts: inAxis.length, made: inAxis.filter((s) => s.made).length }
  })
  const radar = perAxis.map((a) => (a.attempts >= MIN_SHOTS_PER_AXIS ? pctOf(a.made, a.attempts) : null))
  const shareByAxis = Object.fromEntries(perAxis.map((a) => [a.key, total === 0 ? 0 : a.attempts / total])) as Record<AxisKey, number>
  const corner = perAxis.find((a) => a.key === 'corner')!
  const cornerPct = corner.attempts >= MIN_SHOTS_PER_AXIS ? pctOf(corner.made, corner.attempts) : null

  const enough = total >= MIN_SHOTS_FOR_CARD && fg !== null && share !== null
  return {
    kind: 'you',
    name: name || 'Everyone',
    subtitle: name ? 'Your log' : 'The whole log',
    // No threes taken: the three-point part of the rating is zero, never a guess.
    rating: enough ? shootingRating(fg, three ?? 0, share) : null,
    style: styleOfShots(total, shareByAxis, three, cornerPct),
    fg,
    three,
    threeShare: share,
    shots: total,
    radar,
    estimated: false,
  }
}

/** The card of an NBA player. Their zone numbers are estimates: the league zone figures scaled by how they shoot. */
export function playerProfile(p: Player): CardProfile {
  const bench = benchmarkOf(p)
  const radar = RADAR_AXES.map((axis) => {
    const values = axis.zones.map((z) => benchZonePct(z, bench))
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
  })
  const team = TEAMS[p.team]
  return {
    kind: 'nba',
    name: p.name,
    subtitle: team ? `${team.name} · ${p.position}` : p.position,
    rating: shootingRating(p.fg, p.three, p.threeShare),
    style: styleOfPlayer(p),
    fg: p.fg,
    three: p.three,
    threeShare: p.threeShare,
    shots: null,
    radar,
    estimated: true,
    teamColor: team?.color,
    playerId: p.id,
  }
}
