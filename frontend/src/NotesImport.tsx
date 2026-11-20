import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, extractNotes } from './api'
import type { NotesResult, ProposedShot, Shot, ShotInput } from './api'
import { zoneLabel } from './court/stats'
import { today } from './today'

export const MAX_NOTES = 2000 // the backend's limit

type Card = {
  status: 'pending' | 'saving' | 'saved' | 'discarded' | 'error'
  /** Why a save failed (status 'error'). */
  message?: string
  /** Looks like a shot saved from this panel a moment ago: it is not part of "Save all". */
  lookalike?: boolean
}

// What makes two proposals the same shot, for the "you just saved this" marker.
const keyOf = (player: string, shot: ProposedShot) => `${player}|${shot.x}|${shot.y}|${shot.made}|${shot.game_date}`

interface Props {
  /** The player the shots are saved for: the "Shots of" choice, or '' when none is chosen yet. */
  defaultPlayer: string
  /** Create one shot in the backend, nothing else. Rejects with an ApiError when refused. */
  onCreate: (input: ShotInput) => Promise<Shot>
  /** Called ONCE after one shot, or after a whole "Save all", with what was really saved (it refreshes the list and says so). */
  onSaved: (saved: Shot[]) => Promise<void>
}

function describe(shot: ProposedShot): string {
  return `${zoneLabel(shot.zone)} · ${shot.shot_type} · ${shot.made ? 'made' : 'missed'} · ${shot.game_date}`
}

/**
 * Paste what you remember about a session; an AI reads it and PROPOSES shots. Nothing is
 * saved until you press Save on a shot, and that goes through the same path as the form.
 */
export default function NotesImport({ defaultPlayer, onCreate, onSaved }: Props) {
  const id = useId()
  const [text, setText] = useState('')
  const [typedPlayer, setTypedPlayer] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const [result, setResult] = useState<NotesResult | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [error, setError] = useState<string | null>(null)
  // A ticket per search: a search that was cancelled, or replaced by a newer one, is ignored when it ends.
  const latest = useRef(0)
  // The request in flight, so Cancel (or leaving the page) really stops it and not only the waiting.
  const pending = useRef<AbortController | null>(null)
  // Shots saved from this panel, so a new search that finds the same shots can say so.
  const savedKeys = useRef<string[]>([])
  useEffect(() => () => pending.current?.abort(), [])

  const player = (typedPlayer ?? defaultPlayer).trim()
  const loading = phase === 'loading'
  const saving = cards.some((card) => card.status === 'saving')

  async function find(event: FormEvent) {
    event.preventDefault()
    const ticket = ++latest.current
    const controller = new AbortController()
    pending.current = controller
    setPhase('loading')
    setError(null)
    try {
      const found = await extractNotes(text.trim(), today(), controller.signal)
      if (ticket !== latest.current) return
      // Proposals that look like shots just saved are marked (identical shots in one answer are counted one by one).
      const unmatched = [...savedKeys.current]
      const marks = found.proposals.map((shot) => {
        const at = unmatched.indexOf(keyOf(player, shot))
        if (at === -1) return false
        unmatched.splice(at, 1)
        return true
      })
      setResult(found)
      setCards(marks.map((lookalike) => ({ status: 'pending', lookalike })))
      setPhase('done')
    } catch (caught) {
      if (ticket !== latest.current) return
      // The text stays in the box, so the user can try again or add the shots by hand.
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
      setPhase(result ? 'done' : 'idle')
    }
  }

  function cancel() {
    latest.current++
    pending.current?.abort()
    setPhase(result ? 'done' : 'idle')
  }

  const setCard = (index: number, card: Card) => setCards((all) => all.map((old, i) => (i === index ? card : old)))

  /** Create one proposed shot; the card shows how it went. Returns the saved shot, or null when it failed. */
  async function create(index: number): Promise<Shot | null> {
    const shot = result?.proposals[index]
    if (!shot) return null
    setCard(index, { status: 'saving' })
    try {
      const saved = await onCreate({ player, x: shot.x, y: shot.y, made: shot.made, game_date: shot.game_date, note: shot.note })
      savedKeys.current.push(keyOf(player, shot))
      setCard(index, { status: 'saved' })
      return saved
    } catch (caught) {
      setCard(index, { status: 'error', message: caught instanceof ApiError ? caught.message : 'Could not save this shot.' })
      return null
    }
  }

  async function save(index: number) {
    const saved = await create(index)
    if (saved) await onSaved([saved])
  }

  async function saveAll() {
    // One at a time, in order, so the shot numbers follow the order of the notes; then ONE refresh and ONE notice.
    const todo = cards.flatMap((card, index) => ((card.status === 'pending' || card.status === 'error') && !card.lookalike ? [index] : []))
    const saved: Shot[] = []
    for (const index of todo) {
      const one = await create(index)
      if (one) saved.push(one)
    }
    if (saved.length > 0) await onSaved(saved)
  }

  const open = cards.flatMap((card, index) => ((card.status === 'pending' || card.status === 'error') && !card.lookalike ? [index] : []))
  const nothingFound = result && result.proposals.length === 0 && result.questions.length === 0 && result.skipped.length === 0

  return (
    <div className="notes">
      <p className="notes-help">
        Paste what you remember about a session, in your own words. An AI proposes the shots; nothing is saved until you press Save.
      </p>
      <form className="notes-form" onSubmit={(event) => void find(event)} aria-busy={loading}>
        <div className="field">
          <label htmlFor={`${id}-text`}>Your notes</label>
          <textarea
            id={`${id}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_NOTES}
            rows={6}
            placeholder="Hit one from the right corner, missed two from the left elbow, 2 free throws…"
          />
          <span className="notes-count">
            {text.length} / {MAX_NOTES}
          </span>
        </div>
        <div className="field">
          <label htmlFor={`${id}-player`}>Save the shots for</label>
          <input
            id={`${id}-player`}
            value={typedPlayer ?? defaultPlayer}
            onChange={(e) => setTypedPlayer(e.target.value)}
            maxLength={50}
            autoComplete="off"
          />
        </div>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={loading || saving || text.trim() === ''}>
            {loading ? 'Reading…' : 'Find shots'}
          </button>
          {loading && (
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <p className="notes-privacy">Your notes are sent to an AI model to be read. Do not paste anything private.</p>

      <div role="status" aria-live="polite">
        {loading && <p className="state">Reading your notes… this can take up to a minute.</p>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {result && !loading && (
        <section className="notes-result" aria-label="What the AI found">
          {result.model === 'test' ? (
            <p className="notes-model warn">Test model: these answers are fake.</p>
          ) : (
            <p className="notes-model">Read by {result.model}</p>
          )}

          {nothingFound && <p className="state">Nothing was found in those notes.</p>}

          {result.proposals.length > 0 && (
            <>
              <h3>Proposed shots</h3>
              {!player && <p className="form-error">Enter the player above to save these shots.</p>}
              <ul className="notes-list">
                {result.proposals.map((shot, index) => {
                  const card = cards[index] ?? { status: 'pending' }
                  if (card.status === 'discarded') return null
                  return (
                    <li key={index} className={card.status === 'saved' ? 'notes-card saved' : 'notes-card'}>
                      <strong>{describe(shot)}</strong>
                      {shot.note && <span className="notes-note">{shot.note}</span>}
                      {shot.quote && <q className="notes-quote">{shot.quote}</q>}
                      {card.status === 'error' && (
                        <span className="form-error" role="alert">
                          {card.message}
                        </span>
                      )}
                      {card.lookalike && card.status === 'pending' && <span className="notes-hint">Looks like a shot you just saved.</span>}
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
                              onClick={() => void save(index)}
                            >
                              {card.status === 'saving' ? 'Saving…' : card.status === 'error' ? 'Try again' : card.lookalike ? 'Save again' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className="btn"
                              aria-label={`Discard shot ${index + 1}`}
                              disabled={card.status === 'saving'}
                              onClick={() => setCard(index, { status: 'discarded' })}
                            >
                              Discard
                            </button>
                          </>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {open.length > 1 && (
                <button type="button" className="btn primary" disabled={!player || saving} onClick={() => void saveAll()}>
                  Save all ({open.length})
                </button>
              )}
            </>
          )}

          {result.questions.length > 0 && (
            <>
              <h3>The AI needs to know</h3>
              <ul className="notes-questions">
                {result.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
              <p className="notes-hint">Add the answers to your notes above and press Find shots again.</p>
            </>
          )}

          {result.skipped.length > 0 && (
            <>
              <h3>Not logged</h3>
              <ul className="notes-skipped">
                {result.skipped.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}
