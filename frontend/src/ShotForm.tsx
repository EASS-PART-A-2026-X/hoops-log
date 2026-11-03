import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './api'
import type { Shot, ShotInput } from './api'

interface Props {
  /** Present when editing; absent when adding. */
  shot?: Shot
  submitLabel: string
  onSubmit: (input: ShotInput) => Promise<void>
  onCancel?: () => void
}

// "Today" for the player, in their own time zone, as YYYY-MM-DD.
const today = () => new Date().toLocaleDateString('en-CA')

export default function ShotForm({ shot, submitLabel, onSubmit, onCancel }: Props) {
  const id = useId()
  const [player, setPlayer] = useState(shot?.player ?? '')
  const [x, setX] = useState(shot ? String(shot.x) : '')
  const [y, setY] = useState(shot ? String(shot.y) : '')
  const [made, setMade] = useState(shot?.made ?? true)
  const [date, setDate] = useState(shot?.game_date ?? today())
  const [note, setNote] = useState(shot?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        player: player.trim(),
        x: Number(x),
        y: Number(y),
        made,
        game_date: date,
        note,
      })
      if (!shot) {
        // A new shot saved: empty the form, but keep the date and player for the next one.
        setX('')
        setY('')
        setNote('')
      }
    } catch (caught) {
      // Keep everything the user typed so they can fix it or retry.
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="shot-form" onSubmit={handleSubmit} aria-busy={busy}>
      <div className="field">
        <label htmlFor={`${id}-player`}>Player</label>
        <input
          id={`${id}-player`}
          value={player}
          onChange={(e) => setPlayer(e.target.value)}
          maxLength={50}
          required
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-date`}>Game date</label>
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-x`}>X (0–50 ft, across)</label>
        <input
          id={`${id}-x`}
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          max={50}
          value={x}
          onChange={(e) => setX(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-y`}>Y (0–47 ft, from baseline)</label>
        <input
          id={`${id}-y`}
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          max={47}
          value={y}
          onChange={(e) => setY(e.target.value)}
          required
        />
      </div>
      <fieldset className="field result wide">
        <legend>Result</legend>
        <label className={made ? 'pill on' : 'pill'}>
          <input type="radio" name={`${id}-made`} checked={made} onChange={() => setMade(true)} />
          Made
        </label>
        <label className={!made ? 'pill on miss' : 'pill'}>
          <input type="radio" name={`${id}-made`} checked={!made} onChange={() => setMade(false)} />
          Missed
        </label>
      </fieldset>
      <div className="field wide">
        <label htmlFor={`${id}-note`}>Note (optional)</label>
        <input
          id={`${id}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="form-error wide" role="alert">
          {error}
        </p>
      )}
      <div className="actions wide">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
