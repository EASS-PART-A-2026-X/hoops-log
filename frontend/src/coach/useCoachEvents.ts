import { useEffect, useRef } from 'react'
import type { GameToast } from '../game/useCelebrations'
import { chronological } from '../game/xp'
import { greet, levelUp, saved, streak, tip, trophy } from './lines'
import type { TabName } from './lines'
import type { CoachApi } from './useCoach'

interface EventShot {
  id: number
  player: string
  made: boolean
  game_date: string
}

interface Options {
  coach: CoachApi
  /** Every shot loaded, or null before the first load. */
  shots: EventShot[] | null
  truncated: boolean
  /** False while the title screen covers the app: he says nothing then. */
  ready: boolean
  tab: TabName
  name: string
  shotCount: number
  rank: string
  toasts: GameToast[]
}

/** Makes in a row at the end of a player's shots, in the order they were taken. */
export function currentStreak(shots: EventShot[]): number {
  let run = 0
  for (const s of chronological(shots).reverse()) {
    if (!s.made) break
    run++
  }
  return run
}

/** A run this long is worth a line of its own. */
export const STREAK_LINE = 3

/** How long to wait for a trophy or level toast before saying the plain "saved" line (the toast line wins). */
const SETTLE_MS = 80

/**
 * Lets the coach react to what happens in the app: a greeting when it opens, a hint the first time each page is
 * opened, a line after each saved shot, and a bigger one for a level up or a trophy. The first load is silent
 * about shots (he does not comment on old ones), and so is a list cut short, like the celebrations.
 */
export function useCoachEvents({ coach, shots, truncated, ready, tab, name, shotCount, rank, toasts }: Options) {
  const { say } = coach
  const greeted = useRef(false)
  const seenTabs = useRef(new Set<TabName>(['log']))
  const lastMaxId = useRef<number | null>(null)
  const wasTruncated = useRef(false)
  const seenToast = useRef(0)
  const pending = useRef<number | undefined>(undefined)
  const variant = useRef(0)

  useEffect(() => {
    if (greeted.current || !ready || shots === null) return
    greeted.current = true
    say(greet(name, shotCount, rank, variant.current++))
  }, [ready, shots, name, shotCount, rank, say])

  useEffect(() => {
    if (!greeted.current || seenTabs.current.has(tab)) return
    seenTabs.current.add(tab)
    say(tip(tab))
  }, [tab, say])

  useEffect(() => {
    if (shots === null) return
    const maxId = shots.reduce((m, s) => Math.max(m, s.id), 0)
    const before = lastMaxId.current
    const quiet = truncated || wasTruncated.current
    lastMaxId.current = maxId
    wasTruncated.current = truncated
    if (before === null || quiet || maxId <= before || !greeted.current) return
    const latest = shots.find((s) => s.id === maxId)
    if (!latest) return
    const run = currentStreak(shots.filter((s) => s.player === latest.player))
    const line = latest.made && run >= STREAK_LINE ? streak(run) : saved(latest.made, variant.current++)
    window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => say(line), SETTLE_MS)
  }, [shots, truncated, say])

  useEffect(() => {
    const fresh = toasts.filter((t) => t.id > seenToast.current)
    if (fresh.length === 0) return
    seenToast.current = Math.max(...fresh.map((t) => t.id))
    // The level up is the biggest news, then a trophy.
    const level = fresh.find((t) => t.kind === 'level' && t.level)
    const line = level?.level ? levelUp(level.level.level, level.level.rank) : trophy(fresh[fresh.length - 1]!.title)
    window.clearTimeout(pending.current)
    say(line)
  }, [toasts, say])

  useEffect(() => () => window.clearTimeout(pending.current), [])
}
