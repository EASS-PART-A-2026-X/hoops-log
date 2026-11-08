/** Trophies: each is a rule over the shots, so what is unlocked is always just a function of the data. */
import { ZONE_NAMES } from '../court/stats'
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
export const ZONE_COUNT = ZONE_NAMES.length

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

/** Sniper: this many makes inside any stretch of this many shots in a row. */
export const SNIPER_WINDOW = 20
export const SNIPER_MAKES = 12

/**
 * The most makes in any run of `window` shots in a row, in the order the shots were saved (by id, so a
 * shot with an earlier game date does not move between others). Saving more shots can never lower it.
 */
export function bestWindow(shots: TrophyShot[], window: number): number {
  const made = [...shots].sort((a, b) => a.id - b.id).map((s) => (s.made ? 1 : 0))
  let sum = 0
  let best = 0
  for (let i = 0; i < made.length; i++) {
    sum += made[i]!
    if (i >= window) sum -= made[i - window]!
    best = Math.max(best, sum)
  }
  return best
}

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
    how: `Make ${SNIPER_MAKES} of ${SNIPER_WINDOW} shots in a row`,
    progress: (s) => {
      const best = bestWindow(s, SNIPER_WINDOW)
      // A full stretch of shots is needed: 12 makes in 12 shots is hot, but not yet 12 of 20.
      return { done: s.length < SNIPER_WINDOW ? Math.min(best, SNIPER_MAKES - 1) : best, target: SNIPER_MAKES }
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
