import type { ProposedShot } from '../api'
import { zoneLabel } from '../court/stats'

/** One shot Deni proposed in a reply, and what the player did with it. */
export interface Card {
  shot: ProposedShot
  status: 'pending' | 'saving' | 'saved' | 'discarded' | 'error'
  /** Why a save failed (status 'error'). */
  message?: string
  /** Looks like a shot saved from this chat a moment ago: it is left out of "Save all". */
  lookalike?: boolean
}

/** "Right corner 3 · 3PT · made · 2026-11-19" */
export function describeShot(shot: ProposedShot): string {
  return `${zoneLabel(shot.zone)} · ${shot.shot_type} · ${shot.made ? 'made' : 'missed'} · ${shot.game_date}`
}

/** What makes two proposals the same shot, for the "you just saved this" marker. */
export const keyOf = (player: string, shot: ProposedShot): string =>
  `${player}|${shot.x}|${shot.y}|${shot.made}|${shot.game_date}`

/**
 * Which of `proposals` look like shots already saved (`savedKeys`). Identical shots in one reply are counted one
 * by one: one saved before means one marked now, not all of them.
 */
export function markLookalikes(player: string, proposals: ProposedShot[], savedKeys: readonly string[]): boolean[] {
  const unmatched = [...savedKeys]
  return proposals.map((shot) => {
    const at = unmatched.indexOf(keyOf(player, shot))
    if (at === -1) return false
    unmatched.splice(at, 1)
    return true
  })
}

/** A card that "Save all" would save: waiting (or failed before), and not a look-alike. */
export const isOpen = (card: Card): boolean => (card.status === 'pending' || card.status === 'error') && !card.lookalike
