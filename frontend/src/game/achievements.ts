/** Trophies: each is a rule over the shots, so what is unlocked is always just a function of the data. */
import { chronological } from './xp'
import type { XpShot } from './xp'

export interface TrophyShot extends XpShot {
  x: number
  y: number
}

export interface Trophy {
  id: string
  title: string
  how: string
  /** How far along: `done` of `target`. Unlocked when done >= target. */
  progress: (shots: TrophyShot[]) => { done: number; target: number }
}

const CORNERS = new Set(['left_corner_3', 'right_corner_3'])
const PAINT = new Set(['paint', 'restricted_area'])
const MID = new Set(['mid_range', 'left_elbow', 'right_elbow'])
export const ZONE_COUNT = 10

function count(shots: TrophyShot[], test: (s: TrophyShot) => boolean): number {
  return shots.filter(test).length
}

/** The longest run of makes in a row, oldest shot first. */
export function bestStreak(shots: TrophyShot[]): number {
  let best = 0
  let run = 0
  for (const s of chronological(shots)) {
    run = s.made ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

const MIN_SNIPER_SHOTS = 20
const SNIPER_PCT = 0.6

export const TROPHIES: Trophy[] = [
  { id: 'first-bucket', title: 'First Bucket', how: 'Make your first shot', progress: (s) => ({ done: count(s, (x) => x.made), target: 1 }) },
  { id: 'warm-up', title: 'Warm-Up', how: 'Log 10 shots', progress: (s) => ({ done: s.length, target: 10 }) },
  { id: 'gym-rat', title: 'Gym Rat', how: 'Log 50 shots', progress: (s) => ({ done: s.length, target: 50 }) },
  { id: 'century', title: 'Century Club', how: 'Log 100 shots', progress: (s) => ({ done: s.length, target: 100 }) },
  {
    id: 'corner-assassin',
    title: 'Corner Assassin',
    how: 'Make 5 corner threes',
    progress: (s) => ({ done: count(s, (x) => x.made && CORNERS.has(x.zone)), target: 5 }),
  },
  {
    id: 'downtown',
    title: 'From Downtown',
    how: 'Make 10 threes',
    progress: (s) => ({ done: count(s, (x) => x.made && x.shot_type === '3PT'), target: 10 }),
  },
  {
    id: 'hot-hand',
    title: 'Hot Hand',
    how: 'Make 5 shots in a row',
    progress: (s) => ({ done: bestStreak(s), target: 5 }),
  },
  {
    id: 'paint-boss',
    title: 'Paint Boss',
    how: 'Make 10 shots in the paint',
    progress: (s) => ({ done: count(s, (x) => x.made && PAINT.has(x.zone)), target: 10 }),
  },
  {
    id: 'mid-maestro',
    title: 'Mid-Range Maestro',
    how: 'Make 8 mid-range or elbow shots',
    progress: (s) => ({ done: count(s, (x) => x.made && MID.has(x.zone)), target: 8 }),
  },
  {
    id: 'everywhere',
    title: 'Everywhere',
    how: `Take a shot in all ${ZONE_COUNT} zones`,
    progress: (s) => ({ done: new Set(s.map((x) => x.zone)).size, target: ZONE_COUNT }),
  },
  {
    id: 'regular',
    title: 'Regular',
    how: 'Log shots on 3 different days',
    progress: (s) => ({ done: new Set(s.map((x) => x.game_date)).size, target: 3 }),
  },
  {
    id: 'sniper',
    title: 'Sniper',
    how: `Shoot ${SNIPER_PCT * 100}% or better over ${MIN_SNIPER_SHOTS}+ shots`,
    progress: (s) => {
      if (s.length < MIN_SNIPER_SHOTS) return { done: 0, target: 1 }
      return { done: count(s, (x) => x.made) / s.length >= SNIPER_PCT ? 1 : 0, target: 1 }
    },
  },
]

export interface TrophyStatus {
  trophy: Trophy
  done: number
  target: number
  unlocked: boolean
}

export function trophyStatus(shots: TrophyShot[]): TrophyStatus[] {
  return TROPHIES.map((trophy) => {
    const { done, target } = trophy.progress(shots)
    return { trophy, done: Math.min(done, target), target, unlocked: done >= target }
  })
}

export function unlockedIds(shots: TrophyShot[]): string[] {
  return trophyStatus(shots)
    .filter((t) => t.unlocked)
    .map((t) => t.trophy.id)
}
