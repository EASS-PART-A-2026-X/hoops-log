import { useCallback, useEffect, useRef, useState } from 'react'
import { TROPHIES } from './achievements'
import { byPlayer, diffSnap, EMPTY_SNAP, snapOf } from './celebrate'
import type { Snap } from './celebrate'
import type { TrophyShot } from './achievements'
import { play } from './audio'
import { rankTitle } from './xp'

export interface GameToast {
  id: number
  kind: 'level' | 'trophy'
  title: string
  sub: string
  /** For a level toast: the new level and its rank, so others (the coach) need not read them out of the text. */
  level?: { level: number; rank: string }
}
export interface XpPop {
  key: number
  amount: number
  player: string
}

const TOAST_MS = 5200
const MAX_TOASTS = 3

type Shots = (TrophyShot & { player: string })[]

/**
 * Watches the shots for changes after the first load: XP earned, level ups and new trophies, per player.
 * The first load is silent (you open the app to your existing trophies, not a pile of banners).
 */
export function useCelebrations(shots: Shots | null, truncated = false) {
  const [toasts, setToasts] = useState<GameToast[]>([])
  const [pop, setPop] = useState<XpPop | null>(null)
  const seen = useRef<Map<string, Snap> | null>(null)
  const wasTruncated = useRef(false)
  // Trophies already announced this session, so one that is lost and won again (a shot added in the
  // middle of a streak, say) is not announced twice.
  const announced = useRef<Map<string, Set<string>>>(new Map())
  const nextId = useRef(1)

  useEffect(() => {
    if (!shots) return
    const now = new Map<string, Snap>()
    for (const [player, list] of byPlayer(shots)) now.set(player, snapOf(list))
    const before = seen.current
    const priorAnnounced = new Map([...announced.current].map(([k, v]) => [k, new Set(v)]))
    seen.current = now
    // Everything unlocked so far counts as announced.
    for (const [player, snap] of now) {
      const set = announced.current.get(player) ?? new Set<string>()
      for (const id of snap.unlocked) set.add(id)
      announced.current.set(player, set)
    }
    // The first load is silent, and so is a list cut short (the numbers are not the whole truth then).
    // When the list goes from cut short to whole (or back) the difference is the missing shots, not a new one.
    const quiet = truncated || wasTruncated.current
    wasTruncated.current = truncated
    if (!before || quiet) return

    const fresh: GameToast[] = []
    const announcedBefore = priorAnnounced
    let gain: XpPop | null = null
    for (const [player, snap] of now) {
      const change = diffSnap(before.get(player) ?? EMPTY_SNAP, snap)
      if (change.xpGain > 0) gain = { key: nextId.current++, amount: change.xpGain, player }
      if (change.levelUp !== null) {
        fresh.push({ id: nextId.current++, kind: 'level', title: `LEVEL ${change.levelUp}`, sub: `${rankTitle(change.levelUp)} · ${player}`, level: { level: change.levelUp, rank: rankTitle(change.levelUp) } })
      }
      for (const id of change.newTrophyIds) {
        if (announcedBefore.get(player)?.has(id)) continue
        const trophy = TROPHIES.find((t) => t.id === id)
        if (trophy) fresh.push({ id: nextId.current++, kind: 'trophy', title: trophy.title, sub: `TROPHY UNLOCKED · ${trophy.how}` })
      }
    }
    // State is set from an effect on purpose: it reacts to data that arrived from the server.
    if (gain) setPop(gain)
    if (fresh.length > 0) {
      // The newest toasts stay when there are too many, so a level up (the big news) goes last.
      fresh.sort((a, b) => Number(a.kind === 'level') - Number(b.kind === 'level'))
      setToasts((list) => [...list, ...fresh].slice(-MAX_TOASTS))
      if (fresh.some((t) => t.kind === 'level')) play('levelup', 350)
      else play('trophy', 350)
    }
  }, [shots, truncated])

  useEffect(() => {
    if (toasts.length === 0) return
    const timer = window.setTimeout(() => setToasts((list) => list.slice(1)), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toasts])

  useEffect(() => {
    if (!pop) return
    const timer = window.setTimeout(() => setPop(null), 1800)
    return () => window.clearTimeout(timer)
  }, [pop])

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  return { toasts, pop, dismiss }
}
