/**
 * XP and trophies for a set of shots that may hold several players. Streaks and trophy rules only make
 * sense inside one player's shots, so each player is worked out alone and the results are combined:
 * XP adds up, and a trophy is unlocked when any player has it (progress is the best player's).
 */
import { TROPHIES, trophyStatus } from './achievements'
import type { TrophyShot, TrophyStatus } from './achievements'
import { byPlayer } from './celebrate'
import { totalXp } from './xp'

type PlayerShot = TrophyShot & { player: string }

export function xpOf(shots: PlayerShot[]): number {
  let xp = 0
  for (const list of byPlayer(shots).values()) xp += totalXp(list)
  return xp
}

export function trophiesOf(shots: PlayerShot[]): TrophyStatus[] {
  const groups = [...byPlayer(shots).values()].map((list) => trophyStatus(list))
  return TROPHIES.map((trophy, i) => {
    let best: TrophyStatus = { trophy, done: 0, target: trophy.progress([]).target, unlocked: false }
    for (const g of groups) {
      const s = g[i]!
      if (s.unlocked && !best.unlocked) best = s
      else if (s.unlocked === best.unlocked && s.done > best.done) best = s
    }
    return best
  })
}
