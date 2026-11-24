import { Suspense, lazy, useEffect, useRef, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import DeniAvatar from './DeniAvatar'
import ChatPanel from './ChatPanel'
import { POKE_SPAM, poke } from './lines'
import type { AnswerContext } from './lines'
import { isVoiceOn, setVoiceOn, speechSupported, subscribeVoice } from './speech'
import type { CoachApi } from './useCoach'
import type { ChatApi } from './useChat'
import { tabTarget } from '../focusTrap'
import { isMuted, subscribeMuted } from '../game/audio'

/** Taps on him that count as poking him, and how close together they must be. */
const POKE_SPAM_COUNT = 6
const POKE_WINDOW_MS = 5000

// Three.js and the 3D figure are only fetched when this dialog is first opened.
const Deni3D = lazy(() => import('./Deni3D'))

interface Props {
  coach: CoachApi
  /** The conversation with him (kept by the app, so it survives closing this view). */
  chat: ChatApi
  /** Is his AI helper there? null = not known yet, false = offline. */
  aiAvailable: boolean | null
  context: AnswerContext
  onClose: () => void
  /** Where focus goes when the dialog closes (his face in the corner). Named, because not every browser focuses a clicked button. */
  returnTo: RefObject<HTMLElement | null>
}

/**
 * The coach up close: the 3D figure on his own floor, what he is saying under him, and the chat. The chat is where
 * shots are added (he proposes them, you press Save) and where you ask about your numbers; his written lines
 * answer the questions about the app, and everything when his AI helper is offline.
 */
export default function CoachDialog({ coach, chat, aiAvailable, context, onClose, returnTo }: Props) {
  const { said, talking, visible, say } = coach
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const voiceOn = useSyncExternalStore(subscribeVoice, isVoiceOn, () => true)
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false)
  const mood = talking || visible ? (said?.mood ?? 'idle') : 'idle'
  const asked = useRef(0)
  // His latest chat reply is already on the right, so the subtitle would only say it twice.
  const lastDeni = [...chat.messages].reverse().find((m) => m.role === 'deni' && !m.failed)
  const repeatsChat = !!said && lastDeni?.text === said.text
  const pokes = useRef<number[]>([])

  function onPoke() {
    const now = Date.now()
    pokes.current = [...pokes.current.filter((t) => now - t < POKE_WINDOW_MS), now]
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
        const items = [...(bodyRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), summary') ?? [])]
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
          <span className="coach-stage-badge" aria-hidden="true">
            <b>8</b> Forward
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
          {visible && said && !repeatsChat && (
            <p className={`coach-caption mood-${said.mood}`} key={said.key} aria-hidden="true">
              {said.text}
            </p>
          )}
        </div>
        <div className="coach-panel">
          <header className="coach-head">
            <span className="coach-head-badge" aria-hidden="true">
              8
            </span>
            <div className="coach-head-text">
              <h2 id="coach-dialog-name">Deni Avdija</h2>
              <p className={`coach-panel-sub ${aiAvailable === false ? 'offline' : ''}`}>
                <i className="coach-dot" aria-hidden="true" />
                {aiAvailable === false ? 'Coach · AI helper offline' : 'Your coach · AI'}
              </p>
            </div>
            {speechSupported() && (
              <button type="button" className="coach-voice" aria-pressed={voiceOn} onClick={() => setVoiceOn(!voiceOn)}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
                  {voiceOn ? (
                    <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  ) : (
                    <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  )}
                </svg>
                <span className="sr-only">
                  Voice: {voiceOn ? 'on' : 'off'}
                  {voiceOn && muted ? ' (the sound button is off)' : ''}
                </span>
              </button>
            )}
            <button type="button" className="drawer-close coach-dialog-close" ref={closeRef} onClick={onClose}>
              <span aria-hidden="true">✕</span>
              <span className="sr-only">Close the coach</span>
            </button>
          </header>
          <ChatPanel chat={chat} aiAvailable={aiAvailable} player={context.shooter} />
          <details className="coach-about">
            <summary>About Deni</summary>
            <p className="coach-note">
              A fan-made coach inspired by Deni Avdija, not the real Deni. His answers come from an AI that is given the numbers from your log, so check anything important.
            </p>
          </details>
        </div>
      </div>
    </div>
  )
}
