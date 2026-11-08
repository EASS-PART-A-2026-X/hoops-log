/** What changed between two looks at a player's shots: the XP earned, a new level, new trophies. */
import { unlockedIds } from './achievements'
import type { TrophyShot } from './achievements'
import { levelInfo, totalXp } from './xp'

export interface Snap {
  xp: number
  level: number
  unlocked: string[]
}

export function snapOf(shots: TrophyShot[]): Snap {
  const xp = totalXp(shots)
  return { xp, level: levelInfo(xp).level, unlocked: unlockedIds(shots) }
}

export const EMPTY_SNAP: Snap = { xp: 0, level: 1, unlocked: [] }

export interface Change {
  xpGain: number
  /** The new level when it went up, otherwise null. */
  levelUp: number | null
  newTrophyIds: string[]
}

/** Only increases count: deleting a shot never celebrates, and a trophy that comes back after a delete is new again. */
export function diffSnap(prev: Snap, next: Snap): Change {
  return {
    xpGain: Math.max(0, next.xp - prev.xp),
    levelUp: next.level > prev.level ? next.level : null,
    newTrophyIds: next.unlocked.filter((id) => !prev.unlocked.includes(id)),
  }
}

/** The shots of each player, in the order the players first appear. */
export function byPlayer<T extends { player: string }>(shots: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const s of shots) {
    const list = map.get(s.player)
    if (list) list.push(s)
    else map.set(s.player, [s])
  }
  return map
}
