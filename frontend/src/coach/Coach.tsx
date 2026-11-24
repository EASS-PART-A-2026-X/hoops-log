import { useCallback, useEffect, useRef, useState } from 'react'
import CoachDialog from './CoachDialog'
import { INTRO, KONAMI, KONAMI_CODE } from './lines'
import type { AnswerContext } from './lines'
import type { CoachApi } from './useCoach'
import type { ChatApi } from './useChat'
import { play } from '../game/audio'


interface Props {
  coach: CoachApi
  /** The conversation with him, kept by the app so it survives closing the big view. */
  chat: ChatApi
  /** Is his AI helper there? null = not known yet, false = offline. */
  aiAvailable: boolean | null
  context: AnswerContext
  /** When given, the app decides whether the big view is open (so it can open it from elsewhere). */
  open?: boolean
  /** Told when the big view opens or closes, so the app can rest the court behind it. */
  onOpenChange?: (open: boolean) => void
}

/**
 * The coach in the corner of the page: his portrait and what he just said as a caption (the voice is a bonus).
 * A click on his face opens the big view with the 3D figure and the questions.
 */
export default function Coach({ coach, chat, aiAvailable, context, open: controlledOpen, onOpenChange }: Props) {
  const { said, talking, visible, say, hide } = coach
  const [ownOpen, setOpen] = useState(false)
  const open = controlledOpen ?? ownOpen
  const faceRef = useRef<HTMLButtonElement>(null)
  const change = useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const close = useCallback(() => change(false), [change])

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
          <div className={`coach-bubble mood-${said.mood}`} key={said.key}>
            {/* The live region above already reads the line, so the text is hidden here; the button stays reachable. */}
            <p aria-hidden="true">{said.text}</p>
            <button type="button" className="coach-bubble-close" aria-label="Dismiss" onClick={hide}>
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
          {/* A portrait made from the same 3D model he has in his dialog (the button has its own label). */}
          <img src={`${import.meta.env.BASE_URL}deni-face.webp`} alt="" width="76" height="76" draggable={false} />
        </button>
      </aside>
      {open && <CoachDialog coach={coach} chat={chat} aiAvailable={aiAvailable} context={context} onClose={close} returnTo={faceRef} />}
    </>
  )
}
