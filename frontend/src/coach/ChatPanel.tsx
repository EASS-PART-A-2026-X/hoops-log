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

/**
 * The chat with Deni: ONE place to talk to him. You type; his AI works out whether you are telling him about shots
 * (he shows them as cards, and nothing is saved until you press Save) or asking about your numbers (he answers).
 */
export default function ChatPanel({ chat, aiAvailable, player }: Props) {
  const { messages, thinking, savingFor, typedPlayer, setTypedPlayer, send, cancel, reset, save, discard, saveAll } = chat
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLOListElement>(null)
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
          <span className="chat-bubble">{offline ? GREETING_OFFLINE : GREETING}</span>
        </li>
        {messages.map((m) => (
          <Message key={m.id} message={m} player={savingFor} onSave={save} onDiscard={discard} onSaveAll={saveAll} />
        ))}
        {thinking && (
          <li className="chat-msg deni thinking" aria-live="polite">
            <span className="chat-bubble">Deni is thinking… this can take up to a minute.</span>
            <button type="button" className="btn" onClick={cancel}>
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_MESSAGE}
          rows={2}
          placeholder={offline ? 'His AI helper is offline' : 'Message Deni…'}
        />
        <button type="submit" className="btn primary" disabled={thinking || draft.trim() === ''}>
          Send
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
  const busy = cards.some((card) => card.status === 'saving')
  return (
    <li className={`chat-msg ${message.role}${message.failed ? ' failed' : ''}`}>
      {message.failed ? (
        <span className="chat-bubble" role="alert">
          {message.text}
        </span>
      ) : (
        <span className="chat-bubble">{message.text}</span>
      )}
      {cards.length > 0 && (many ? (
        <details className="chat-review">
          <summary>Review {shown} shots</summary>
        <ul className="chat-cards" aria-label="Shots Deni understood">
          {cards.map((card, index) =>
            card.status === 'discarded' ? null : (
              <li key={index} className={card.status === 'saved' ? 'shot-chip saved' : 'shot-chip'}>
                <span className="shot-chip-main">
                  <strong>{describeShot(card.shot)}</strong>
                  {card.shot.note && <span className="notes-note">{card.shot.note}</span>}
                  {card.lookalike && card.status === 'pending' && <span className="notes-hint">Looks like a shot you just saved.</span>}
                  {card.status === 'error' && (
                    <span className="form-error" role="alert">
                      {card.message}
                    </span>
                  )}
                </span>
                <span className="shot-chip-actions">
                  {card.status === 'saved' ? (
                    <span className="notes-saved">Saved ✓</span>
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
        </details>
      ) : (
        <ul className="chat-cards" aria-label="Shots Deni understood">
          {cards.map((card, index) =>
            card.status === 'discarded' ? null : (
              <li key={index} className={card.status === 'saved' ? 'shot-chip saved' : 'shot-chip'}>
                <span className="shot-chip-main">
                  <strong>{describeShot(card.shot)}</strong>
                  {card.shot.note && <span className="notes-note">{card.shot.note}</span>}
                  {card.lookalike && card.status === 'pending' && <span className="notes-hint">Looks like a shot you just saved.</span>}
                  {card.status === 'error' && (
                    <span className="form-error" role="alert">
                      {card.message}
                    </span>
                  )}
                </span>
                <span className="shot-chip-actions">
                  {card.status === 'saved' ? (
                    <span className="notes-saved">Saved ✓</span>
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
