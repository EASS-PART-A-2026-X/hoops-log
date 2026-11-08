/** XP and levels, worked out from the shots alone: nothing is stored, so the same shots always give the same level. */

export interface XpShot {
  id: number
  game_date: string
  made: boolean
  zone: string
  shot_type: '2PT' | '3PT'
}

export const XP_LOG = 2 // every logged shot, made or missed
export const XP_MAKE = 10
export const XP_THREE_BONUS = 5
export const XP_HARD_ZONE_BONUS = 3 // a made mid-range or elbow shot
export const XP_STREAK_BONUS = 5 // per make in a row from the third on
export const XP_STREAK_CAP = 15

const HARD_ZONES = new Set(['mid_range', 'left_elbow', 'right_elbow'])

/** Oldest first: by game date, then by id, which is how the shots were saved. */
export function chronological<T extends { id: number; game_date: string }>(shots: T[]): T[] {
  return [...shots].sort((a, b) => (a.game_date < b.game_date ? -1 : a.game_date > b.game_date ? 1 : a.id - b.id))
}

/** The XP one shot is worth, given how many makes in a row came right before it. */
export function shotXp(shot: XpShot, streakBefore: number): number {
  if (!shot.made) return XP_LOG
  let xp = XP_MAKE
  if (shot.shot_type === '3PT') xp += XP_THREE_BONUS
  if (HARD_ZONES.has(shot.zone)) xp += XP_HARD_ZONE_BONUS
  if (streakBefore >= 2) xp += Math.min(XP_STREAK_CAP, (streakBefore - 1) * XP_STREAK_BONUS)
  return xp
}

export function totalXp(shots: XpShot[]): number {
  let streak = 0
  let xp = 0
  for (const shot of chronological(shots)) {
    xp += shotXp(shot, streak)
    streak = shot.made ? streak + 1 : 0
  }
  return xp
}

/** Total XP needed to reach a level: level 1 is 0, level 2 is 60, level 3 is 240, level 4 is 540... */
export function xpToReach(level: number): number {
  return 60 * (level - 1) ** 2
}

export const RANKS: { from: number; title: string }[] = [
  { from: 1, title: 'ROOKIE' },
  { from: 3, title: 'GYM RAT' },
  { from: 5, title: 'SHARPSHOOTER' },
  { from: 8, title: 'STARTER' },
  { from: 12, title: 'ALL-STAR' },
  { from: 17, title: 'MVP' },
  { from: 25, title: 'LEGEND' },
]

export function rankTitle(level: number): string {
  let title = RANKS[0]!.title
  for (const r of RANKS) if (level >= r.from) title = r.title
  return title
}

export interface LevelInfo {
  xp: number
  level: number
  title: string
  /** XP earned inside this level, and the XP this level needs in all. */
  into: number
  span: number
  /** 0 to 1, for the bar. */
  fraction: number
}

export function levelInfo(xp: number): LevelInfo {
  const safe = Math.max(0, Math.floor(xp))
  let level = Math.floor(Math.sqrt(safe / 60)) + 1
  // Guard against floating point at the exact thresholds.
  while (xpToReach(level + 1) <= safe) level++
  while (level > 1 && xpToReach(level) > safe) level--
  const start = xpToReach(level)
  const span = xpToReach(level + 1) - start
  const into = safe - start
  return { xp: safe, level, title: rankTitle(level), into, span, fraction: span === 0 ? 0 : into / span }
}
