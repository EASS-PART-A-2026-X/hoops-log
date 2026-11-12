import { useCallback, useRef, useState } from 'react'
import CoachDialog from './CoachDialog'
import DeniAvatar from './DeniAvatar'
import { INTRO } from './lines'
import type { AnswerContext } from './lines'
import type { CoachApi } from './useCoach'

interface Props {
  coach: CoachApi
  context: AnswerContext
  /** Told when the big view opens or closes, so the app can rest the court behind it. */
  onOpenChange?: (open: boolean) => void
}

/**
 * The coach in the corner of the page: his face and what he just said as a caption (the voice is a bonus).
 * A click on his face opens the big view with the 3D figure and the questions.
 */
export default function Coach({ coach, context, onOpenChange }: Props) {
  const { said, talking, visible, say, hide } = coach
  const [open, setOpen] = useState(false)
  const faceRef = useRef<HTMLButtonElement>(null)
  const change = useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const close = useCallback(() => change(false), [change])
  const mood = talking || visible ? (said?.mood ?? 'idle') : 'idle'

  return (
    <>
      <aside className="coach" aria-label="Coach Deni, a fan-made coach">
        {/* Always in the page, so a screen reader announces each new line, also while the big view is open. */}
        <div className="coach-live" role="status" aria-live="polite">
          {visible && said ? said.text : ''}
        </div>
        {visible && said && !open && (
          <div className={`coach-bubble mood-${said.mood}`} key={said.key} aria-hidden="true">
            <p>{said.text}</p>
            <button type="button" className="coach-bubble-close" tabIndex={-1} onClick={hide}>
              ✕
            </button>
          </div>
        )}
        <button
          type="button"
          ref={faceRef}
          className={`coach-face${talking ? ' talking' : ''}${said?.mood === 'hype' && visible ? ' hype' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Open Deni, the coach"
          onClick={() => {
            if (!said) say(INTRO)
            change(true)
          }}
        >
          <DeniAvatar mood={mood} talking={talking} />
        </button>
      </aside>
      {open && <CoachDialog coach={coach} context={context} onClose={close} returnTo={faceRef} />}
    </>
  )
}
