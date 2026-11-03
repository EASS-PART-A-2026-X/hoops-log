import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, createShot, deleteShot, listShots, updateShot } from './api'
import type { Shot, ShotInput } from './api'
import ShotForm from './ShotForm'
import ShotList from './ShotList'

interface Notice {
  kind: 'ok' | 'error'
  text: string
}

export default function App() {
  const [shots, setShots] = useState<Shot[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const latest = useRef(0)

  // Fetch and store the list. Every setState here happens after an await, so it is safe
  // to call from an effect. A ticket makes an older, slower reply unable to overwrite a
  // newer one.
  const load = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const fresh = await listShots()
      if (ticket !== latest.current) return
      setShots(fresh)
      setLoadError(null)
    } catch (caught) {
      if (ticket !== latest.current) return
      setLoadError(caught instanceof ApiError ? caught.message : 'Could not load the shots.')
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [])

  // Re-fetch after a write or a retry. `loading` starts true, so the first load (from
  // the effect below) has no spinner to turn on.
  const refresh = useCallback(() => {
    setLoading(true)
    return load()
  }, [load])

  useEffect(() => {
    // First load. Bumping the ticket on cleanup makes a StrictMode double mount, or an
    // unmount, ignore the older reply.
    const counter = latest // a counter, not a DOM node: the warning about stale refs does not apply
    const ticket = ++counter.current
    listShots()
      .then((fresh) => {
        if (ticket !== latest.current) return
        setShots(fresh)
        setLoadError(null)
      })
      .catch((caught: unknown) => {
        if (ticket !== latest.current) return
        setLoadError(caught instanceof ApiError ? caught.message : 'Could not load the shots.')
      })
      .finally(() => {
        if (ticket === latest.current) setLoading(false)
      })
    return () => {
      counter.current++
    }
  }, [])

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
      if (caught instanceof ApiError && caught.kind === 'not_found') await refresh()
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
