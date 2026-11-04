import { useState } from 'react'
import type { Shot, ShotInput } from './api'
import { zoneLabel } from './court/stats'
import ShotForm from './ShotForm'

interface Props {
  shots: Shot[]
  selectedId: number | null
  onLocate: (id: number | null) => void
  onSave: (id: number, input: ShotInput) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

function Row({
  shot,
  selected,
  onLocate,
  onSave,
  onDelete,
}: { shot: Shot; selected: boolean } & Pick<Props, 'onLocate' | 'onSave' | 'onDelete'>) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (editing) {
    return (
      <li className="shot editing" id={`shot-${shot.id}`}>
        <h3 className="edit-title">Edit shot #{shot.id}</h3>
        <ShotForm
          shot={shot}
          submitLabel="Save changes"
          onSubmit={async (input) => {
            await onSave(shot.id, input)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className={selected ? 'shot selected' : 'shot'} id={`shot-${shot.id}`} aria-current={selected || undefined}>
      <span className={shot.made ? 'mark made' : 'mark missed'} aria-hidden="true">
        {shot.made ? '●' : '✕'}
      </span>
      <div className="shot-main">
        <div className="shot-title">
          {/* React renders text as text, so a name like <b>x</b> shows literally. */}
          <strong>{shot.player}</strong>
          <span className="sr-only">{shot.made ? ' made' : ' missed'}</span>
          <span className={shot.shot_type === '3PT' ? 'badge three' : 'badge'}>
            {shot.shot_type}
          </span>
        </div>
        <div className="shot-meta">
          {shot.game_date} · {zoneLabel(shot.zone)} · ({shot.x}, {shot.y})
        </div>
        {shot.note && <div className="shot-note">{shot.note}</div>}
      </div>
      <div className="row-actions">
        {confirming ? (
          <>
            <button
              type="button"
              className="btn danger"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true)
                try {
                  await onDelete(shot.id)
                } finally {
                  setDeleting(false)
                  setConfirming(false)
                }
              }}
            >
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button type="button" className="btn" disabled={deleting} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => onLocate(selected ? null : shot.id)}>
              {selected ? 'Unselect' : 'Show on map'}
              <span className="sr-only"> shot #{shot.id}</span>
            </button>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit<span className="sr-only"> shot #{shot.id}</span>
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(true)}>
              Delete<span className="sr-only"> shot #{shot.id}</span>
            </button>
          </>
        )}
      </div>
    </li>
  )
}

const PAGE = 100

export default function ShotList({ shots, selectedId, onLocate, onSave, onDelete }: Props) {
  const [shown, setShown] = useState(PAGE)
  // Render a page at a time: 5000 rows of DOM make the whole page slow. A selected shot
  // is always shown, however far down it is.
  const selectedAt = selectedId === null ? -1 : shots.findIndex((s) => s.id === selectedId)
  const count = Math.min(shots.length, Math.max(shown, selectedAt + 1))
  return (
    <>
      <ul className="shots">
        {shots.slice(0, count).map((shot) => (
          // The key is the record's id, never its position: an edit form must stay
          // attached to its own shot when the list changes.
          <Row
            key={shot.id}
            shot={shot}
            selected={shot.id === selectedId}
            onLocate={onLocate}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}
      </ul>
      {count < shots.length && (
        <button type="button" className="btn more" onClick={() => setShown(count + PAGE)}>
          Show {Math.min(PAGE, shots.length - count)} more ({shots.length - count} not shown)
        </button>
      )}
    </>
  )
}
