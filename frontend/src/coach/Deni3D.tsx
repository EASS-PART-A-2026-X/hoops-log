import { useEffect, useRef, useState } from 'react'
import DeniAvatar from './DeniAvatar'
import { DeniStage } from './deni3d/DeniStage'
import type { Mood } from './lines'

interface Props {
  mood: Mood
  talking: boolean
  /** Changes with every new line, so the same mood twice in a row plays its move again. */
  beat: number
  /** The visitor tapped him. */
  onPoke?: () => void
}

/**
 * The 3D coach. This file (and Three.js with it) is only loaded when the dialog opens. If the browser cannot
 * make a 3D picture, the drawn face is shown instead and the dialog still works.
 */
export default function Deni3D({ mood, talking, beat, onPoke }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const stage = useRef<DeniStage | null>(null)
  const [failed, setFailed] = useState(false)
  const poke = useRef(onPoke)
  useEffect(() => {
    poke.current = onPoke
  })

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let made: DeniStage | null = null
    try {
      made = new DeniStage(el, reduced)
      stage.current = made
      made.onPoke = () => poke.current?.()
    } catch {
      // No WebGL here (or it is switched off). Set from the effect on purpose: only trying tells.
      // oxlint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true)
    }
    return () => {
      made?.dispose()
      stage.current = null
    }
  }, [])

  useEffect(() => {
    stage.current?.setTalking(talking)
  }, [talking])
  useEffect(() => {
    stage.current?.setMood(mood)
  }, [mood, beat])

  return (
    <div className="deni-stage" ref={holder}>
      {failed && (
        <div className="deni-stage-flat">
          <DeniAvatar mood={mood} talking={talking} />
          <p>This browser cannot show the 3D view, so here is the drawn one.</p>
        </div>
      )}
    </div>
  )
}
