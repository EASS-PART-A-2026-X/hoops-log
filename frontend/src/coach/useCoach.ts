import { useCallback, useEffect, useRef, useState } from 'react'
import type { Line } from './lines'
import { speak, stopSpeaking } from './speech'

export interface Said extends Line {
  /** Changes with every line, so the same words said twice still replay the animation. */
  key: number
}

/** How long the bubble stays up: a read time that grows with the line. */
export const bubbleMs = (text: string) => 6000 + text.length * 45

/** Without a voice the mouth still moves for about as long as the line takes to read aloud. */
const talkMs = (text: string) => Math.min(6000, 600 + text.length * 55)

/**
 * The coach's current line, whether the mouth is moving and `say`. A new line replaces the old one (and cuts
 * its voice off), because a coach that talks over itself is worse than one that skips a line.
 */
export function useCoach() {
  const [said, setSaid] = useState<Said | null>(null)
  const [talking, setTalking] = useState(false)
  const [visible, setVisible] = useState(false)
  const key = useRef(0)
  const talkTimer = useRef<number | undefined>(undefined)
  const hideTimer = useRef<number | undefined>(undefined)

  const say = useCallback((line: Line) => {
    window.clearTimeout(talkTimer.current)
    window.clearTimeout(hideTimer.current)
    key.current += 1
    setSaid({ ...line, key: key.current })
    setVisible(true)
    setTalking(false)
    const spoke = speak(line.text, {
      onStart: () => setTalking(true),
      onEnd: () => setTalking(false),
    })
    if (!spoke) {
      setTalking(true)
      talkTimer.current = window.setTimeout(() => setTalking(false), talkMs(line.text))
    }
    hideTimer.current = window.setTimeout(() => setVisible(false), bubbleMs(line.text))
  }, [])

  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    setVisible(false)
  }, [])

  useEffect(
    () => () => {
      window.clearTimeout(talkTimer.current)
      window.clearTimeout(hideTimer.current)
      stopSpeaking()
    },
    [],
  )

  return { said, talking, visible, say, hide }
}

export type CoachApi = ReturnType<typeof useCoach>
