import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { QUESTIONS, again, answer } from './lines'
import type { AnswerContext, QuestionId } from './lines'
import { describeShot, isOpen } from './proposals'
import type { ChatApi, ChatMessage } from './useChat'

/** The longest message the backend takes. */
export const MAX_MESSAGE = 2000

/** Questions the AI can answer from the numbers it is given. The rest are about the app, so his written lines answer them. */
const AI_QUESTIONS: ReadonlySet<QuestionId> = new Set(['doing', 'practise', 'best'])

interface Props {
  chat: ChatApi
  /** Is the AI helper there? null = not known yet (treated as there), false = offline. */
  aiAvailable: boolean | null
  /** What his written lines need to answer a tapped question. */
  context: AnswerContext
  /** Who the shots are saved for. */
  player: string
}

/**
 * The chat with Deni. You type (or tap a question); he answers. When you tell him about shots he shows them as
 * cards: nothing is saved until you press Save. When his AI helper is offline he still answers the questions from
 * his written lines, and says so.
 */
export default function ChatPanel({ chat, aiAvailable, context, player }: Props) {
  const { messages, thinking, savingFor, setTypedPlayer, send, cancel, reset, addScripted, save, discard, saveAll } = chat
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLOListElement>(null)
  const offline = aiAvailable === false
  // The question tapped last, so the same one twice gets a remark (his facts rotate, so they are always new).
  const lastQuestion = useRef<QuestionId | null>(null)
  const asked = useRef(0)

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

  function ask(id: QuestionId, label: string) {
    if (thinking) return
    if (AI_QUESTIONS.has(id) && !offline) {
      lastQuestion.current = null
      void send(label)
      return
    }
    const line = answer(id, { ...context, n: asked.current++, aiAvailable: !offline })
    addScripted(label, lastQuestion.current === id && id !== 'fact' ? again(line) : line)
    lastQuestion.current = id
  }

  return (
    <div className="chat">
      <ol className="chat-log" ref={logRef} role="log" aria-label="Conversation with Deni">
        {messages.length === 0 && (
          <li className="chat-hint">
            {offline
              ? 'His AI helper is offline right now. Tap a question below and he answers from what he knows, or add a shot by hand from the Shots button.'
              : 'Ask me about your shots, or tell me about a session: "hit one from the right corner, missed two from the left elbow".'}
          </li>
        )}
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
          <input id="chat-name" value={savingFor} onChange={(e) => setTypedPlayer(e.target.value)} maxLength={50} autoComplete="off" />
        </div>
      )}

      <ul className="coach-questions" aria-label="Quick questions for Deni">
        {QUESTIONS.map((q) => (
          <li key={q.id}>
            <button type="button" onClick={() => ask(q.id, q.label)} disabled={thinking}>
              {q.label}
            </button>
          </li>
        ))}
      </ul>

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
        Your messages and the numbers from your log are sent to an AI model. Do not write anything private.{' '}
        {messages.length > 0 && (
          <button type="button" className="chat-clear" onClick={reset} disabled={thinking}>
            Clear the chat
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
      {cards.length > 0 && (
        <ul className="chat-cards" aria-label="Shots Deni understood">
          {cards.map((card, index) =>
            card.status === 'discarded' ? null : (
              <li key={index} className={card.status === 'saved' ? 'notes-card saved' : 'notes-card'}>
                <strong>{describeShot(card.shot)}</strong>
                {card.shot.note && <span className="notes-note">{card.shot.note}</span>}
                {card.shot.quote && <q className="notes-quote">{card.shot.quote}</q>}
                {card.lookalike && card.status === 'pending' && <span className="notes-hint">Looks like a shot you just saved.</span>}
                {card.status === 'error' && (
                  <span className="form-error" role="alert">
                    {card.message}
                  </span>
                )}
                <span className="actions">
                  {card.status === 'saved' ? (
                    <span className="notes-saved">Saved ✓</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn primary"
                        aria-label={`Save shot ${index + 1}`}
                        disabled={card.status === 'saving' || !player}
                        onClick={() => void onSave(message.id, index)}
                      >
                        {card.status === 'saving' ? 'Saving…' : card.status === 'error' ? 'Try again' : card.lookalike ? 'Save again' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Discard shot ${index + 1}`}
                        disabled={card.status === 'saving'}
                        onClick={() => onDiscard(message.id, index)}
                      >
                        Discard
                      </button>
                    </>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {open > 1 && (
        <button type="button" className="btn primary chat-save-all" disabled={!player || busy} onClick={() => void onSaveAll(message.id)}>
          Save all ({open})
        </button>
      )}
      {cards.length > 0 && !player && <p className="form-error">Type your name below the chat to save these shots.</p>}
    </li>
  )
}
