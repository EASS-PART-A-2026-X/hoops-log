import { useCallback, useEffect, useRef, useState } from 'react'
import CoachDialog from './CoachDialog'
import DeniAvatar from './DeniAvatar'
import { INTRO, KONAMI, KONAMI_CODE } from './lines'
import type { AnswerContext } from './lines'
import type { CoachApi } from './useCoach'
import { play } from '../game/audio'


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

  // The cheat code works anywhere, except while typing in a field.
  useEffect(() => {
    // The last keys pressed, as many as the code is long: the code is the last ten keys, whatever came before.
    let recent: string[] = []
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = e.key.toLowerCase()
      recent = [...recent, key].slice(-KONAMI_CODE.length)
      if (recent.join(' ') === KONAMI_CODE.join(' ')) {
        recent = []
        play('levelup')
        say(KONAMI)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [say])

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
