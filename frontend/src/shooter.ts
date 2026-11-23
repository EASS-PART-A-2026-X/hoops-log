/** Whose shots the app shows: the pure rules behind the "Shots of" choice. */

interface HasPlayer {
  player: string
}

// What Python's str.strip() removes (str.isspace): not the same set as JavaScript's trim().
const PY_SPACE = '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const EDGE_SPACE = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g')

/**
 * The identity of a name. It aims to match the backend's `name.strip().casefold()`: the same whitespace is
 * stripped, and case is folded per character ("Straße", "STRASSE" and "ẞ" fold like Python; the dotless
 * "ı" stays "ı"; a final "ς" folds to "σ"). JavaScript has no casefold, so this covers the cases pinned in
 * shooter.test.ts, not every Unicode character; rarer scripts may still differ from the backend.
 */
export function shooterKey(name: string): string {
  return Array.from(name.replace(EDGE_SPACE, ''), (c) => (c === 'ı' ? c : c.toUpperCase().toLowerCase())).join('').replaceAll('ß', 'ss')
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
  for (const s of shots ?? []) {
    const key = shooterKey(s.player)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = ''
  let bestCount = -1
  for (const name of listShooters(shots)) {
    const n = counts.get(shooterKey(name)) ?? 0
    if (n > bestCount) {
      best = name
      bestCount = n
    }
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
    const key = shooterKey(choice)
    const found = shooters.find((name) => shooterKey(name) === key)
    if (found !== undefined) return found
  }
  return fallback
}
