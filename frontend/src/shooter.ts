/** Whose shots the app shows: the pure rules behind the "Shots of" choice. */

interface HasPlayer {
  player: string
}

/** The identity of a name, as the backend sees it: stripped and case-folded ("Straße" and "STRASSE" match). */
export function shooterKey(name: string): string {
  return name.trim().toUpperCase().toLowerCase()
}

/** True when two names are the same person. */
export function sameShooter(a: string, b: string): boolean {
  return shooterKey(a) === shooterKey(b)
}

/** Each person's key with the spelling to show: the one with the most shots; a tie goes to the first alphabetically. */
export function shooterNames(shots: HasPlayer[] | null): Map<string, string> {
  const spellings = new Map<string, Map<string, number>>()
  for (const s of shots ?? []) {
    const key = shooterKey(s.player)
    const counts = spellings.get(key) ?? new Map<string, number>()
    counts.set(s.player, (counts.get(s.player) ?? 0) + 1)
    spellings.set(key, counts)
  }
  const names = new Map<string, string>()
  for (const [key, counts] of spellings) {
    let best = ''
    let bestCount = 0
    for (const name of [...counts.keys()].sort()) {
      const n = counts.get(name) ?? 0
      if (n > bestCount) {
        best = name
        bestCount = n
      }
    }
    names.set(key, best)
  }
  return names
}

/** Everyone who has at least one shot, once each, sorted by name. */
export function listShooters(shots: HasPlayer[] | null): string[] {
  return [...shooterNames(shots).values()].sort()
}

/** The player with the most shots; a tie goes to the first name alphabetically. '' when there are no shots. */
export function pickDefaultShooter(shots: HasPlayer[] | null): string {
  const counts = new Map<string, number>()
  for (const s of shots ?? []) counts.set(shooterKey(s.player), (counts.get(shooterKey(s.player)) ?? 0) + 1)
  let best = ''
  for (const name of listShooters(shots)) {
    if (best === '' || (counts.get(shooterKey(name)) ?? 0) > (counts.get(shooterKey(best)) ?? 0)) best = name
  }
  return best
}

/**
 * The shooter to show for a choice. null (not chosen yet) and a player who has no shots any more both
 * give the fallback; '' means every player and is always kept.
 */
export function resolveShooter(choice: string | null, shooters: string[], fallback: string): string {
  if (choice === '') return ''
  if (choice !== null) {
    const found = shooters.find((name) => sameShooter(name, choice))
    if (found !== undefined) return found
  }
  return fallback
}
