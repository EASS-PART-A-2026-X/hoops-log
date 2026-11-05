/** Who is ahead in a comparison. Pure rules, so the page can say it in words and the tests can check it. */

/** Closer than this many percentage points counts as level. */
export const LEVEL_PTS = 0.5

export type Side = 'you' | 'them' | 'tie'

/** Who has the higher percentage; null when there are no shots to judge (mine is null). */
export function sideOf(mine: number | null, theirs: number): Side | null {
  if (mine === null) return null
  const diff = mine - theirs
  if (Math.abs(diff) < LEVEL_PTS) return 'tie'
  return diff > 0 ? 'you' : 'them'
}

/** How far apart two percentages are, in points, to one decimal (always positive). */
export function gapPts(mine: number, theirs: number): number {
  return Math.round(Math.abs(mine - theirs) * 10) / 10
}

export interface Tally {
  you: number
  them: number
  ties: number
}

/** Count who leads where; areas that could not be judged (null) are left out. */
export function tally(sides: (Side | null)[]): Tally {
  const t: Tally = { you: 0, them: 0, ties: 0 }
  for (const s of sides) {
    if (s === 'you') t.you++
    else if (s === 'them') t.them++
    else if (s === 'tie') t.ties++
  }
  return t
}

/** The one-sentence verdict shown under the scoreboard. */
export function describeTally(mineName: string, theirName: string, t: Tally): string {
  const total = t.you + t.them + t.ties
  if (total === 0) return 'Not enough shots yet to say who is ahead.'
  const counted = `${total} ${total === 1 ? 'area' : 'areas'}`
  if (t.you > t.them) return `${mineName} is ahead of ${theirName}: leading in ${t.you} of ${counted}.`
  if (t.them > t.you) return `${theirName} is ahead of ${mineName}: leading in ${t.them} of ${counted}.`
  return `${mineName} and ${theirName} are level: ${t.you} areas each out of ${counted}.`
}
