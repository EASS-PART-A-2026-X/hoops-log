import { useState } from 'react'
import { ApiError, MAX_PAGES, PAGE_SIZE, createShot, deleteShot, updateShot } from './api'
import type { ShotInput } from './api'
import ShotForm from './ShotForm'
import ShotList from './ShotList'
import { useShots } from './useShots'

interface Notice {
  kind: 'ok' | 'error'
  text: string
}

export default function App() {
  const { shots, truncated, loading, loadError, refresh } = useShots()
  const [notice, setNotice] = useState<Notice | null>(null)

  // After a write, show the backend's fresh data, not our guess of it.
  async function add(input: ShotInput) {
    const saved = await createShot(input)
    setNotice({ kind: 'ok', text: `Saved shot #${saved.id} for ${saved.player}.` })
    await refresh()
  }

  async function save(id: number, input: ShotInput) {
    try {
      await updateShot(id, input)
    } catch (caught) {
      if (caught instanceof ApiError && caught.kind === 'not_found') {
        // The refresh removes this row, and its form with it, so say it here as well.
        setNotice({ kind: 'error', text: caught.message })
        await refresh()
      }
      throw caught // the form shows it and keeps the draft
    }
    setNotice({ kind: 'ok', text: `Updated shot #${id}.` })
    await refresh()
  }

  async function remove(id: number) {
    try {
      await deleteShot(id)
      setNotice({ kind: 'ok', text: `Deleted shot #${id}.` })
    } catch (caught) {
      const text = caught instanceof ApiError ? caught.message : 'Could not delete the shot.'
      setNotice({ kind: 'error', text })
    }
    await refresh()
  }

  const made = shots?.filter((s) => s.made).length ?? 0

  return (
    <>
      <header className="topbar">
        <span className="brand">HOOPS LOG</span>
      </header>

      <main className="page">
        <section className="intro">
          <p className="eyebrow">YOUR SHOT LOG</p>
          <h1>Every shot, on the record.</h1>
        </section>

        <div role="status" aria-live="polite" className="notice-slot">
          {notice && (
            <p className={`notice ${notice.kind}`}>
              {notice.text}
              <button type="button" className="link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          )}
        </div>

        <div className="columns">
          <section className="card" aria-labelledby="add-title">
            <h2 id="add-title">Add a shot</h2>
            <ShotForm submitLabel="Add shot" onSubmit={add} />
          </section>

          <section className="card" aria-labelledby="list-title" aria-busy={loading}>
            <div className="list-head">
              <h2 id="list-title">Shots</h2>
              {shots && shots.length > 0 && (
                <span className="count">
                  {made} made of {shots.length}
                </span>
              )}
            </div>

            {truncated && (
              <p className="state error">
                Showing the first {MAX_PAGES * PAGE_SIZE} shots only; there are more.
              </p>
            )}

            {loadError && (
              <div className="state error" role="alert">
                <p>{loadError}</p>
                <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
                  {loading ? 'Trying…' : 'Try again'}
                </button>
              </div>
            )}

            {!shots && loading && <p className="state">Loading shots…</p>}

            {shots && shots.length === 0 && !loadError && (
              <p className="state">No shots yet. Add your first one on the left.</p>
            )}

            {shots && shots.length > 0 && (
              <ShotList shots={shots} onSave={save} onDelete={remove} />
            )}
          </section>
        </div>
      </main>
    </>
  )
}
