import { useEffect, useRef } from 'react'
import { chatter } from './lines'
import type { ChatterContext } from './lines'
import { isChatterOn } from './prefs'
import type { CoachApi } from './useCoach'

/** The first remark comes after a minute, then at most one every few minutes, and never more than this many a visit. */
export const FIRST_MS = 60_000
export const GAP_MS = 180_000
export const MAX_REMARKS = 5
const CHECK_MS = 5_000

interface Options {
  coach: CoachApi
  /** False while the title screen is up or the log is still loading. */
  ready: boolean
  /** Builds the context when it is time to speak (called only then, so it always sees fresh data). */
  context: () => ChatterContext
}

/**
 * Lets him speak up now and then without being asked, about something true right now: the time of day, how
 * close the next level is, the shooter's best and weakest areas. He waits while he is already talking, while the
 * page is hidden, and when the visitor has turned it off.
 */
export function useCoachChatter({ coach, ready, context }: Options) {
  const { say, visible, talking } = coach
  const used = useRef(new Set<string>())
  const count = useRef(0)
  const lastAt = useRef<number | null>(null)
  const turn = useRef(0)
  // The latest values, read by the timer without restarting it on every render.
  const live = useRef({ visible, talking, context, say, ready })
  useEffect(() => {
    live.current = { visible, talking, context, say, ready }
  })

  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now()
      const cur = live.current
      if (!cur.ready || !isChatterOn() || document.hidden || cur.visible || cur.talking || count.current >= MAX_REMARKS) return
      if (now - (lastAt.current ?? started) < (lastAt.current === null ? FIRST_MS : GAP_MS)) return
      const found = chatter(cur.context(), used.current, turn.current++)
      if (!found) return
      used.current.add(found.id)
      count.current += 1
      lastAt.current = now
      cur.say(found.line)
    }, CHECK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // A line of his own (a greeting, a reaction) counts as him having just spoken.
  const said = coach.said
  useEffect(() => {
    if (said) lastAt.current = Date.now()
  }, [said])
}
