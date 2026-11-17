/** Whose shots the app shows: the pure rules behind the "Shots of" choice. */

interface HasPlayer {
  player: string
}

/** Everyone who has at least one shot, sorted by name. */
export function listShooters(shots: HasPlayer[] | null): string[] {
  return [...new Set((shots ?? []).map((s) => s.player))].sort()
}

/** The player with the most shots; a tie goes to the first name alphabetically. '' when there are no shots. */
export function pickDefaultShooter(shots: HasPlayer[] | null): string {
  const counts = new Map<string, number>()
  for (const s of shots ?? []) counts.set(s.player, (counts.get(s.player) ?? 0) + 1)
  let best = ''
  for (const name of listShooters(shots)) {
    if (best === '' || (counts.get(name) ?? 0) > (counts.get(best) ?? 0)) best = name
  }
  return best
}

/**
 * The shooter to show for a choice. null (not chosen yet) and a player who has no shots any more both
 * give the fallback; '' means every player and is always kept.
 */
export function resolveShooter(choice: string | null, shooters: string[], fallback: string): string {
  if (choice === '') return ''
  if (choice !== null && shooters.includes(choice)) return choice
  return fallback
}
