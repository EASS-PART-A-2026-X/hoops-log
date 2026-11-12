import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import DeniAvatar from './DeniAvatar'
import { INTRO, QUESTIONS, answer } from './lines'
import type { AnswerContext } from './lines'
import { isVoiceOn, setVoiceOn, speechSupported, subscribeVoice } from './speech'
import type { CoachApi } from './useCoach'
import { isMuted, subscribeMuted } from '../game/audio'

interface Props {
  coach: CoachApi
  context: AnswerContext
}

/**
 * The coach, in the corner of the page: his face, what he just said as a caption (the voice is a bonus), and a
 * list of questions to tap. The questions are fixed on purpose: this version has no AI, so he can only answer
 * what he was written to answer, and he says so.
 */
export default function Coach({ coach, context }: Props) {
  const { said, talking, visible, say, hide } = coach
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const voiceOn = useSyncExternalStore(subscribeVoice, isVoiceOn, () => true)
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false)
  const canTalk = speechSupported()

  // Escape closes the question list and puts focus back on his face.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      toggleRef.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const mood = talking || visible ? (said?.mood ?? 'idle') : 'idle'

  return (
    <aside className="coach" aria-label="Coach Deni, a fan-made coach">
      {/* Always in the page, so a screen reader announces each new line. */}
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
      {open && (
        <div className="coach-menu" id={menuId} role="group" aria-label="Ask Deni">
          <p className="coach-menu-title">Ask Deni</p>
          <ul>
            {QUESTIONS.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => {
                    say(answer(q.id, context))
                    setOpen(false)
                  }}
                >
                  {q.label}
                </button>
              </li>
            ))}
          </ul>
          {canTalk && (
            <button type="button" className="coach-voice" aria-pressed={voiceOn} onClick={() => setVoiceOn(!voiceOn)}>
              Voice: {voiceOn ? 'on' : 'off'}
              {voiceOn && muted ? ' (the sound button is off)' : ''}
            </button>
          )}
          <p className="coach-note">
            A fan-made coach inspired by Deni Avdija. Not the real Deni, and no AI: his lines are written in advance and use your own shots.
          </p>
        </div>
      )}
      <button
        type="button"
        ref={toggleRef}
        className={`coach-face${talking ? ' talking' : ''}${said?.mood === 'hype' && visible ? ' hype' : ''}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Ask Deni, the coach"
        onClick={() => {
          if (!open && !said) say(INTRO)
          setOpen((o) => !o)
        }}
      >
        <DeniAvatar mood={mood} talking={talking} />
      </button>
    </aside>
  )
}
