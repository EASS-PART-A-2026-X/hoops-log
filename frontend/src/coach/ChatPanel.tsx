import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { describeShot, isOpen } from './proposals'
import type { ChatApi, ChatMessage } from './useChat'

/** The longest message the backend takes. */
export const MAX_MESSAGE = 2000

interface Props {
  chat: ChatApi
  /** Is the AI helper there? null = not known yet (treated as there), false = offline. */
  aiAvailable: boolean | null
  /** Who the shots are saved for. */
  player: string
}

/** What he says first, as his own message, so the chat reads as one conversation and not as an empty box. */
const GREETING = 'Ask me about your shots, or tell me about a session: "hit one from the right corner, missed two from the left elbow".'
const GREETING_OFFLINE = 'My AI helper is offline right now, so I cannot chat. You can still add a shot by hand from the Shots button.'

/** Questions that are sent as they are, and one example that is only typed in (you finish it with your own shots). */
const QUESTIONS = ['How am I shooting overall?', 'Where am I strongest?', 'How do I compare with the NBA?']
const EXAMPLE = 'Hit one from the right corner, missed two from the left elbow'

/** His little round badge beside what he says: the number on his kit. */
function Avatar() {
  return (
    <span className="chat-avatar" aria-hidden="true">
      8
    </span>
  )
}

/**
 * Where a shot is, drawn on a half court (the baseline at the bottom, the basket near it). The court is 50 feet
 * wide and the spot is given in feet from the left sideline and from the baseline, like every shot in the app.
 */
function MiniCourt({ x, y, made }: { x: number; y: number; made: boolean }) {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  return (
    <svg className={`mini-court ${made ? 'made' : 'missed'}`} viewBox="-1 -1 52 49" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="50" height="47" rx="2" className="mc-floor" />
      <rect x="17" y="28" width="16" height="19" className="mc-line" />
      <path d="M3 47 V33 A23.75 23.75 0 0 1 47 33 V47" className="mc-line" />
      <circle cx="25" cy="41.75" r="1.6" className="mc-line" />
      <circle cx={clamp(x, 50)} cy={47 - clamp(y, 47)} r="3.4" className="mc-dot" />
    </svg>
  )
}

/**
 * The chat with Deni: ONE place to talk to him. You type; his AI works out whether you are telling him about shots
 * (he shows them as cards, and nothing is saved until you press Save) or asking about your numbers (he answers).
 */
export default function ChatPanel({ chat, aiAvailable, player }: Props) {
  const { messages, thinking, savingFor, typedPlayer, setTypedPlayer, send, cancel, reset, save, discard, saveAll } = chat
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const offline = aiAvailable === false

  // Keep the newest message in view.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages.length, thinking])

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (text === '' || thinking) return
    setDraft('')
    void send(text)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter makes a new line (and a word being composed by an input method is left alone).
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="chat">
      {/* Not live: each reply is already announced by the caption's live region (Coach.tsx), and both would read it twice. */}
      <ol className="chat-log" ref={logRef} role="log" aria-live="off" aria-label="Conversation with Deni">
        {/* His first words, in his own bubble. They are not part of the conversation sent to the AI. */}
        <li className="chat-msg deni">
          <span className="chat-row">
            <Avatar />
            <span className="chat-bubble">{offline ? GREETING_OFFLINE : GREETING}</span>
          </span>
          {messages.length === 0 && !offline && (
            <div className="chat-suggest">
              {QUESTIONS.map((question) => (
                <button key={question} type="button" className="chat-chip" disabled={thinking} onClick={() => void send(question)}>
                  {question}
                </button>
              ))}
              <button
                type="button"
                className="chat-chip example"
                onClick={() => {
                  setDraft(EXAMPLE)
                  inputRef.current?.focus()
                }}
              >
                Log a session…
              </button>
            </div>
          )}
        </li>
        {messages.map((m) => (
          <Message key={m.id} message={m} player={savingFor} onSave={save} onDiscard={discard} onSaveAll={saveAll} />
        ))}
        {thinking && (
          // Not a message: three moving dots, so it cannot be mistaken for something Deni said. The words are for screen readers.
          <li className="chat-msg deni typing" role="status">
            <Avatar />
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="sr-only">Deni is thinking…</span>
            <SlowHint />
            <button type="button" className="typing-cancel" onClick={cancel}>
              Cancel
            </button>
          </li>
        )}
      </ol>

      {player === '' && (
        <div className="chat-name">
          <label htmlFor="chat-name">Save my shots under the name</label>
          <input id="chat-name" value={typedPlayer} onChange={(e) => setTypedPlayer(e.target.value)} maxLength={50} autoComplete="off" />
        </div>
      )}

      <form className="chat-form" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">
          Message to Deni
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_MESSAGE}
          rows={1}
          placeholder={offline ? 'His AI helper is offline' : 'Message Deni…'}
        />
        <button type="submit" className="chat-send" disabled={thinking || draft.trim() === ''}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="sr-only">Send</span>
        </button>
      </form>
      <p className="chat-note">
        Your messages and the numbers from your log are sent to an AI model, and the conversation is saved with your log. Do not write anything private.{' '}
        {messages.length > 0 && (
          <button type="button" className="chat-clear" onClick={reset} disabled={thinking}>
            Start over
          </button>
        )}
      </p>
    </div>
  )
}

/** Shown only while he is thinking (the component is mounted just then), and only once it has taken a while. */
const SLOW_AFTER_MS = 10_000
function SlowHint() {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])
  return late ? <span className="typing-hint">Taking longer than usual…</span> : null
}

interface MessageProps {
  message: ChatMessage
  player: string
  onSave: (messageId: number, index: number) => Promise<void>
  onDiscard: (messageId: number, index: number) => void
  onSaveAll: (messageId: number) => Promise<void>
}

function Message({ message, player, onSave, onDiscard, onSaveAll }: MessageProps) {
  const cards = message.cards ?? []
  const open = cards.filter(isOpen).length
  const shown = cards.filter((card) => card.status !== 'discarded').length
  const many = shown > 3 // a long session stays one line; the list opens on demand
  const list = (
    <ul className="chat-cards" aria-label="Shots Deni understood">
      {cards.map((card, index) =>
        card.status === 'discarded' ? null : (
          <li key={index} className={`shot-chip ${card.shot.made ? 'made' : 'missed'}${card.status === 'saved' ? ' saved' : ''}`}>
            <MiniCourt x={card.shot.x} y={card.shot.y} made={card.shot.made} />
            <span className="shot-chip-main">
              <strong>{describeShot(card.shot)}</strong>
              {card.shot.note && <span className="shot-chip-note">{card.shot.note}</span>}
              {card.lookalike && card.status === 'pending' && <span className="shot-hint">Looks like a shot you just saved.</span>}
              {card.status === 'error' && (
                <span className="form-error" role="alert">
                  {card.message}
                </span>
              )}
            </span>
            <span className="shot-chip-actions">
              {card.status === 'saved' ? (
                <span className="shot-saved">Saved ✓</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="chip-btn save"
                    aria-label={`Save shot ${index + 1}`}
                    disabled={card.status === 'saving' || !player}
                    onClick={() => void onSave(message.id, index)}
                  >
                    {card.status === 'saving' ? 'Saving…' : card.status === 'error' ? 'Retry' : card.lookalike ? 'Save again' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    aria-label={`Discard shot ${index + 1}`}
                    disabled={card.status === 'saving'}
                    onClick={() => onDiscard(message.id, index)}
                  >
                    ✕
                  </button>
                </>
              )}
            </span>
          </li>
        ),
      )}
    </ul>
  )
  const busy = cards.some((card) => card.status === 'saving')
  return (
    <li className={`chat-msg ${message.role}${message.failed ? ' failed' : ''}`}>
      {message.failed ? (
        <span className="chat-bubble" role="alert">
          {message.text}
        </span>
      ) : message.role === 'deni' ? (
        <span className="chat-row">
          <Avatar />
          <span className="chat-bubble">{message.text}</span>
        </span>
      ) : (
        <span className="chat-bubble">{message.text}</span>
      )}
      {cards.length > 0 &&
        (many ? (
          <details className="chat-review">
            <summary>Review {shown} shots</summary>
            {list}
          </details>
        ) : (
          list
        ))}
      {open > 1 && (
        <button type="button" className="chip-btn save chat-save-all" disabled={!player || busy} onClick={() => void onSaveAll(message.id)}>
          Save all ({open})
        </button>
      )}
      {cards.length > 0 && !player && <p className="form-error">Type your name below the chat to save these shots.</p>}
    </li>
  )
}
