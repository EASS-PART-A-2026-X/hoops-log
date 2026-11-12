import { Suspense, lazy, useEffect, useRef, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import DeniAvatar from './DeniAvatar'
import { POKE_SPAM, QUESTIONS, again, answer, poke } from './lines'
import type { AnswerContext } from './lines'
import { isChatterOn, setChatterOn, subscribeChatter } from './prefs'
import { isVoiceOn, setVoiceOn, speechSupported, subscribeVoice } from './speech'
import type { CoachApi } from './useCoach'
import { tabTarget } from '../focusTrap'
import { isMuted, subscribeMuted } from '../game/audio'

/** Taps on him that count as poking him, and how close together they must be. */
const POKE_SPAM_COUNT = 6
const POKE_WINDOW_MS = 5000

// Three.js and the 3D figure are only fetched when this dialog is first opened.
const Deni3D = lazy(() => import('./Deni3D'))

interface Props {
  coach: CoachApi
  context: AnswerContext
  onClose: () => void
  /** Where focus goes when the dialog closes (his face in the corner). Named, because not every browser focuses a clicked button. */
  returnTo: RefObject<HTMLElement | null>
}

/**
 * The coach up close: the 3D figure on his own floor, what he is saying under him, and the questions to tap.
 * The questions are fixed on purpose: this version has no AI, so he can only answer what he was written to
 * answer, and the note says so.
 */
export default function CoachDialog({ coach, context, onClose, returnTo }: Props) {
  const { said, talking, visible, say } = coach
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const voiceOn = useSyncExternalStore(subscribeVoice, isVoiceOn, () => true)
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false)
  const chatterOn = useSyncExternalStore(subscribeChatter, isChatterOn, () => true)
  const mood = talking || visible ? (said?.mood ?? 'idle') : 'idle'
  const lastQuestion = useRef<string | null>(null)
  const asked = useRef(0)
  const pokes = useRef<number[]>([])

  function ask(id: (typeof QUESTIONS)[number]['id']) {
    const line = answer(id, { ...context, n: asked.current++ })
    // The same question twice in a row gets a remark. (Facts rotate, so they are always new.)
    say(lastQuestion.current === id && id !== 'fact' ? again(line) : line)
    lastQuestion.current = id
  }

  function onPoke() {
    const now = Date.now()
    pokes.current = [...pokes.current.filter((t) => now - t < POKE_WINDOW_MS), now]
    lastQuestion.current = null
    say(pokes.current.length >= POKE_SPAM_COUNT ? POKE_SPAM : poke(asked.current++))
  }

  useEffect(() => {
    const opener = returnTo.current
    closeRef.current?.focus()
    return () => opener?.focus()
  }, [returnTo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const items = [...(bodyRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
        const active = document.activeElement as HTMLElement | null
        const target = tabTarget(items, active, !!active && items.includes(active), e.shiftKey)
        if (target) {
          e.preventDefault()
          target.focus()
        }
        return
      }
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="coach-dialog" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="coach-dialog-body" ref={bodyRef} role="dialog" aria-modal="true" aria-labelledby="coach-dialog-name">
        <div className="coach-stage">
          <span className="coach-stage-number" aria-hidden="true">
            8
          </span>
          <Suspense
            fallback={
              <div className="deni-stage">
                <div className="deni-stage-flat">
                  <DeniAvatar mood={mood} talking={talking} />
                </div>
              </div>
            }
          >
            <Deni3D mood={mood} talking={talking} beat={said?.key ?? 0} onPoke={onPoke} />
          </Suspense>
          <p className="coach-stage-hint" aria-hidden="true">
            Drag to turn him round
          </p>
          {/* What he says, as a subtitle. The live region in the corner widget announces it to screen readers. */}
          {visible && said && (
            <p className={`coach-caption mood-${said.mood}`} key={said.key} aria-hidden="true">
              {said.text}
            </p>
          )}
        </div>
        <div className="coach-panel">
          <button type="button" className="drawer-close coach-dialog-close" ref={closeRef} onClick={onClose}>
            <span aria-hidden="true">✕</span>
            <span className="sr-only">Close the coach</span>
          </button>
          <h2 id="coach-dialog-name">Deni Avdija</h2>
          <p className="coach-panel-sub">Forward, number 8. Your coach here.</p>
          <ul className="coach-questions" aria-label="Ask Deni">
            {QUESTIONS.map((q) => (
              <li key={q.id}>
                <button type="button" onClick={() => ask(q.id)}>
                  {q.label}
                </button>
              </li>
            ))}
          </ul>
          {speechSupported() && (
            <button type="button" className="coach-voice" aria-pressed={voiceOn} onClick={() => setVoiceOn(!voiceOn)}>
              Voice: {voiceOn ? 'on' : 'off'}
              {voiceOn && muted ? ' (the sound button is off)' : ''}
            </button>
          )}
          <button type="button" className="coach-voice" aria-pressed={chatterOn} onClick={() => setChatterOn(!chatterOn)}>
            Let him chime in: {chatterOn ? 'on' : 'off'}
          </button>
          <p className="coach-note">
            A fan-made coach inspired by Deni Avdija. Not the real Deni, and no AI: his lines are written in advance and use your own shots.
          </p>
        </div>
      </div>
    </div>
  )
}
