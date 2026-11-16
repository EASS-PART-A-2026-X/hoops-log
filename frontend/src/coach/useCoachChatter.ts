import { useEffect, useRef } from 'react'
import { chatter } from './lines'
import type { ChatterContext } from './lines'
import { isChatterOn } from './prefs'
import type { CoachApi } from './useCoach'

/**
 * At most one remark every GAP_MS, and never more than MAX_REMARKS a visit. A line of his own (the greeting, a
 * reaction) counts as him having just spoken, so after a greeting the first remark comes GAP_MS later. Only when
 * he has said nothing at all does the first remark come after FIRST_SILENT_MS.
 */
export const FIRST_SILENT_MS = 60_000
export const GAP_MS = 180_000
export const MAX_REMARKS = 5
const CHECK_MS = 5_000

interface Options {
  coach: CoachApi
  /** False while the title screen is up or the log is still loading. */
  ready: boolean
  /** How many remarks a visit may have (the default is MAX_REMARKS; a test can lower it). */
  maxRemarks?: number
  /** Builds the context when it is time to speak (called only then, so it always sees fresh data). */
  context: () => ChatterContext
}

/**
 * Lets him speak up now and then without being asked, about something true right now: the time of day, how
 * close the next level is, the shooter's best and weakest areas. He waits while he is already talking, while the
 * page is hidden, and when the visitor has turned it off.
 */
export function useCoachChatter({ coach, ready, context, maxRemarks = MAX_REMARKS }: Options) {
  const { say, visible, talking } = coach
  const used = useRef(new Set<string>())
  const count = useRef(0)
  const lastAt = useRef<number | null>(null)
  const turn = useRef(0)
  // The latest values, read by the timer without restarting it on every render.
  const live = useRef({ visible, talking, context, say, ready, maxRemarks })
  useEffect(() => {
    live.current = { visible, talking, context, say, ready, maxRemarks }
  })

  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now()
      const cur = live.current
      if (!cur.ready || !isChatterOn() || document.hidden || cur.visible || cur.talking || count.current >= cur.maxRemarks) return
      if (now - (lastAt.current ?? started) < (lastAt.current === null ? FIRST_SILENT_MS : GAP_MS)) return
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
