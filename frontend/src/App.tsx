import { useEffect, useMemo, useState } from 'react'
import { ApiError, MAX_PAGES, PAGE_SIZE, createShot, deleteShot, updateShot } from './api'
import type { ShotInput } from './api'
import NbaCompare from './NbaCompare'
import { PLAYERS } from './court/players'
import { typicalOf } from './court/nba'
import ShooterSelect from './ShooterSelect'
import PlayersPage from './PlayersPage'
import ShotForm from './ShotForm'
import ShotList from './ShotList'
import ShotMap from './ShotMap'
import { useShots } from './useShots'

interface Notice {
  kind: 'ok' | 'error'
  text: string
}

export default function App() {
  const { shots, truncated, loading, loadError, refresh } = useShots()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [tab, setTab] = useState<'log' | 'nba' | 'players'>('log')
  // The player the vs NBA tab compares you with; null means the league average.
  // Whose shots everything shows. null = not chosen yet, so use the default (the player with the
  // most shots); '' = every player's shots together; otherwise a player's name.
  const [shooterChoice, setShooterChoice] = useState<string | null>(null)
  const [benchmarkId, setBenchmarkId] = useState<number | null>(null)
  // The side drawer with the shot list and the add form: closed by default, so the page is just the map.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerView, setDrawerView] = useState<'list' | 'add'>('list')
  const [pickedId, setPickedId] = useState<number | null>(null)
  // Where to scroll after the next render: the target row or the map only exists once the
  // selection has been drawn (a row past the first 100, say), so scrolling cannot happen in the click.
  const [scrollTarget, setScrollTarget] = useState<{ id: string; block: ScrollLogicalPosition } | null>(null)
  // A deleted shot cannot stay selected.
  const selectedId = shots?.some((s) => s.id === pickedId) ? pickedId : null

  // After a write, show the backend's fresh data, not our guess of it.
  async function add(input: ShotInput) {
    const saved = await createShot(input)
    setNotice({ kind: 'ok', text: `Saved shot #${saved.id} for ${saved.player}.` })
    await refresh()
    setDrawerView('list') // show the new row
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

  // Escape closes the drawer if it is open, otherwise deselects. Only on the log tab: the other
  // tabs show neither.
  useEffect(() => {
    if (tab !== 'log' || (!drawerOpen && selectedId === null)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (drawerOpen) setDrawerOpen(false)
      else setPickedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, tab, drawerOpen])

  useEffect(() => {
    if (!scrollTarget) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document
      .getElementById(scrollTarget.id)
      ?.scrollIntoView({ block: scrollTarget.block, behavior: reduced ? 'auto' : 'smooth' })
  }, [scrollTarget])

  // Clicked a shot on the map: highlight its row. Clicked "Show on map": highlight the shot.
  function pickFromMap(id: number | null) {
    // Clicking the selected shot again, empty space, or "Clear selection" deselects.
    if (id === null || id === selectedId) {
      setPickedId(null)
      return
    }
    setPickedId(id)
    // The row only exists on screen while the drawer is open.
    if (drawerOpen) setScrollTarget({ id: `shot-${id}`, block: 'nearest' })
  }
  function locate(id: number | null) {
    setPickedId(id)
    if (id === null) return
    setDrawerOpen(false) // the drawer would cover the map
    setScrollTarget({ id: 'map-title', block: 'start' })
  }

  const shooters = useMemo(() => [...new Set((shots ?? []).map((s) => s.player))].sort(), [shots])
  const defaultShooter = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of shots ?? []) counts.set(s.player, (counts.get(s.player) ?? 0) + 1)
    // Most shots wins; ties go to the first name alphabetically (shooters is sorted).
    return shooters.reduce((best, p) => ((counts.get(p) ?? 0) > (counts.get(best) ?? 0) ? p : best), shooters[0] ?? '')
  }, [shots, shooters])
  // A chosen player who was deleted falls back to the default.
  const shooter = shooterChoice === '' ? '' : shooterChoice !== null && shooters.includes(shooterChoice) ? shooterChoice : defaultShooter
  const shooterShots = useMemo(() => (shots === null || !shooter ? shots : shots.filter((s) => s.player === shooter)), [shots, shooter])
  const shooterPicker = <ShooterSelect players={shooters} value={shooter} onChange={setShooterChoice} />

  const benchPlayer = PLAYERS.find((p) => p.id === benchmarkId)
  const baseline = useMemo(
    () => (benchPlayer ? { name: benchPlayer.name, typical: typicalOf(benchPlayer) } : null),
    [benchPlayer],
  )

  const made = shots?.filter((s) => s.made).length ?? 0

  return (
    <>
      <header className="topbar">
        <span className="brand">HOOPS LOG</span>
        <nav className="tabs" aria-label="Pages">
          <button type="button" aria-current={tab === 'log' ? 'page' : undefined} onClick={() => setTab('log')}>
            My log
          </button>
          <button type="button" aria-current={tab === 'nba' ? 'page' : undefined} onClick={() => setTab('nba')}>
            vs NBA
          </button>
          <button type="button" aria-current={tab === 'players' ? 'page' : undefined} onClick={() => setTab('players')}>
            Players
          </button>
        </nav>
      </header>

      <main className="page">
        {tab === 'players' && (
          <PlayersPage
            shots={shooterShots}
            shooter={shooter}
            shooterPicker={shooterPicker}
            benchmarkId={benchmarkId}
            onCompare={(id) => {
              setBenchmarkId(id)
              setTab('nba')
            }}
          />
        )}
        {tab === 'nba' && (
          <NbaCompare shots={shooterShots} shooter={shooter} shooterPicker={shooterPicker} benchmarkId={benchmarkId} onBenchmark={setBenchmarkId} onBrowse={() => setTab('players')} />
        )}
        {/* Always mounted, only hidden, so the form, row edits and map filters survive a tab switch.
            The map's scene stops drawing while hidden and re-measures when shown again. */}
        <div hidden={tab !== 'log'}>
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

          <ShotMap
            shots={shots}
            players={shooters}
            player={shooter}
            onPlayerChange={setShooterChoice}
            loadError={loadError}
            retrying={loading}
            onRetry={() => void refresh()}
            selectedId={selectedId}
            onSelect={pickFromMap}
            baseline={baseline}
          />

          <button
            type="button"
            className="drawer-toggle"
            aria-expanded={drawerOpen}
            aria-controls="shots-drawer"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? 'Close' : 'Shots'}
            {!drawerOpen && shots && <span className="drawer-count">{shots.length}</span>}
          </button>

          {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
          {/* Always mounted (only hidden when closed), so a half-typed shot survives closing the drawer. */}
          <aside
            id="shots-drawer"
            className={drawerOpen ? 'drawer open' : 'drawer'}
            aria-label="Shots"
            aria-busy={loading}
            inert={!drawerOpen}
          >
            <div className="drawer-head">
              <div className="chips" role="group" aria-label="Drawer view">
                <button type="button" className="chip" aria-pressed={drawerView === 'list'} onClick={() => setDrawerView('list')}>
                  Shots{shots ? ` (${shots.length})` : ''}
                </button>
                <button type="button" className="chip" aria-pressed={drawerView === 'add'} onClick={() => setDrawerView('add')}>
                  Add a shot
                </button>
              </div>
              <button type="button" className="drawer-close" onClick={() => setDrawerOpen(false)}>
                <span aria-hidden="true">✕</span>
                <span className="sr-only">Close the shot list</span>
              </button>
            </div>

            <div className="drawer-body">
              <section hidden={drawerView !== 'add'} aria-labelledby="add-title">
                <h2 id="add-title">Add a shot</h2>
                <ShotForm submitLabel="Add shot" onSubmit={add} />
              </section>

              <section hidden={drawerView !== 'list'} aria-labelledby="list-title">
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
                  <p className="state">No shots yet. Open "Add a shot" to log your first one.</p>
                )}

                {shots && shots.length > 0 && (
                  <ShotList
                    shots={shots}
                    selectedId={selectedId}
                    onLocate={locate}
                    onSave={save}
                    onDelete={remove}
                  />
                )}
              </section>
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}
