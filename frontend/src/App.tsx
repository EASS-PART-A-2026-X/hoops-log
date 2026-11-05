import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, MAX_PAGES, PAGE_SIZE, createShot, deleteShot, updateShot } from './api'
import type { ShotInput } from './api'
import NbaCompare from './NbaCompare'
import { PLAYERS } from './court/players'
import { typicalOf } from './court/nba'
import Logo from './Logo'
import ShooterSelect from './ShooterSelect'
import { tabTarget } from './focusTrap'
import { deletedText, withShooterSwitch } from './notices'
import { listShooters, pickDefaultShooter, resolveShooter } from './shooter'
import PlayersPage from './PlayersPage'
import ShotForm from './ShotForm'
import ShotList from './ShotList'
import ShotMap from './ShotMap'
import { useShots } from './useShots'

/** The drawer covers the page below this width (the layout breakpoint in index.css). */
const NARROW = '(max-width: 960px)'

interface Notice {
  kind: 'ok' | 'error'
  text: string
}

export default function App() {
  const { shots, truncated, loading, loadError, refresh } = useShots()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [tab, setTab] = useState<'log' | 'nba' | 'players'>('log')
  // Whose shots everything shows. null = not chosen yet, so use the default (the player with the
  // most shots); '' = every player's shots together; otherwise a player's name.
  const [shooterChoice, setShooterChoice] = useState<string | null>(null)
  // The player the vs NBA tab compares you with; null means the league average.
  const [benchmarkId, setBenchmarkId] = useState<number | null>(null)
  // The side drawer with the shot list and the add form: closed by default, so the page is just the map.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerView, setDrawerView] = useState<'list' | 'add'>('list')
  const toggleRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const appRef = useRef<HTMLDivElement>(null)
  const topbarRef = useRef<HTMLElement>(null)
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
    // The map shows one player's shots: switch to the saved shot's player so the new shot is visible.
    setShooterChoice(saved.player)
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
      setNotice({ kind: 'ok', text: deletedText(id) })
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

  // The toast sits just under the top bar, which is taller when its tabs wrap on a phone.
  useEffect(() => {
    const bar = topbarRef.current
    const app = appRef.current
    if (!bar || !app) return
    const sync = () => app.style.setProperty('--topbar-h', `${bar.offsetHeight}px`)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  // Good news goes away by itself; errors stay until dismissed.
  useEffect(() => {
    if (notice?.kind !== 'ok') return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // A drawer that covers the page (small screens) is a dialog; on desktop it stays a side panel
  // next to the usable map.
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const onChange = () => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Focus moves into the drawer when it opens and back to the "Shots" button when it closes.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.querySelector<HTMLElement>('button')?.focus()
    else if (wasOpen.current) toggleRef.current?.focus()
    wasOpen.current = drawerOpen
  }, [drawerOpen])

  // While the drawer covers the page, Tab stays inside it, wherever focus is (even on the body,
  // after a click on plain text or after the focused button went away). Only a focusable element
  // of the drawer counts as being in it; the drawer itself (focused by that click) does not.
  useEffect(() => {
    if (!narrow || !drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      const drawer = drawerRef.current
      if (e.key !== 'Tab' || !drawer) return
      const items = [...drawer.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter(
        (el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled,
      )
      const active = document.activeElement as HTMLElement | null
      const target = tabTarget(items, active, !!active && items.includes(active), e.shiftKey)
      if (target) {
        e.preventDefault()
        target.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [narrow, drawerOpen])

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
    // A shot by someone else is hidden on the map, so show that player's shots.
    const player = shots?.find((s) => s.id === id)?.player
    if (player !== undefined && shooter !== '' && player !== shooter) setShooterChoice(player)
    setDrawerOpen(false) // the drawer would cover the map
    setScrollTarget({ id: 'map-title', block: 'start' })
  }

  const shooters = useMemo(() => listShooters(shots), [shots])
  const defaultShooter = useMemo(() => pickDefaultShooter(shots), [shots])
  const shooter = resolveShooter(shooterChoice, shooters, defaultShooter)
  // Make the shown shooter the explicit choice, so a save or delete never silently changes whose
  // shots are shown. A chosen player with no shots left is replaced by the default, and the user is told.
  // (Set during render, which React allows for a component's own state.)
  if (shooters.length > 0 && !loadError && shooter !== shooterChoice) {
    setShooterChoice(shooter)
    if (shooterChoice !== null) {
      // A delete confirmation stays visible: the sentence is added to it (and adding twice is a no-op).
      setNotice((prev) => ({
        kind: 'ok',
        text: withShooterSwitch(prev?.kind === 'ok' ? prev.text : null, shooterChoice, shooter),
      }))
    }
  }
  const shooterShots = useMemo(() => (shots === null || !shooter ? shots : shots.filter((s) => s.player === shooter)), [shots, shooter])
  const shooterPicker = <ShooterSelect shots={shots} value={shooter} onChange={setShooterChoice} />

  const benchPlayer = PLAYERS.find((p) => p.id === benchmarkId)
  const baseline = useMemo(
    () => (benchPlayer ? { name: benchPlayer.name, typical: typicalOf(benchPlayer) } : null),
    [benchPlayer],
  )

  // The drawer shows the same shots as the map: the chosen player's, or everyone's.
  const listed = shooterShots
  const made = listed?.filter((s) => s.made).length ?? 0

  return (
    <div className="app" ref={appRef}>
      <header className="topbar" ref={topbarRef}>
        <button type="button" className="brand" onClick={() => setTab('log')} aria-label="Hoops Log, go to My log">
          <Logo />
          <span aria-hidden="true">HOOPS LOG</span>
        </button>
        {tab === 'log' && (
          <button
            type="button"
            ref={toggleRef}
            className="drawer-toggle"
            aria-expanded={drawerOpen}
            aria-controls="shots-drawer"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            Shots
            {listed && <span className="drawer-count">{listed.length}</span>}
          </button>
        )}
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

      {/* Outside the tab views, so a notice is seen (and its timer is not wasted) on every tab. */}
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

      <main className={tab === 'log' ? 'page fit' : 'page'}>
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
        <div className="log-view" hidden={tab !== 'log'}>
          <ShotMap
            shots={shots}
            player={shooter}
            onPlayerChange={setShooterChoice}
            loadError={loadError}
            retrying={loading}
            onRetry={() => void refresh()}
            selectedId={selectedId}
            onSelect={pickFromMap}
            baseline={baseline}
          />

          {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
          {/* Always mounted (only hidden when closed), so a half-typed shot survives closing the drawer. */}
          <aside
            id="shots-drawer"
            ref={drawerRef}
            className={drawerOpen ? 'drawer open' : 'drawer'}
            role={narrow && drawerOpen ? 'dialog' : undefined}
            aria-modal={narrow && drawerOpen ? true : undefined}
            tabIndex={-1}
            aria-label="Shots"
            aria-busy={loading}
            inert={!drawerOpen}
          >
            <div className="drawer-head">
              <div className="chips" role="group" aria-label="Drawer view">
                <button type="button" className="chip" aria-pressed={drawerView === 'list'} onClick={() => setDrawerView('list')}>
                  Shots{listed ? ` (${listed.length})` : ''}
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
                  {listed && listed.length > 0 && (
                    <span className="count">
                      {made} made of {listed.length}
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

                {listed && listed.length === 0 && !loadError && (
                  <p className="state">No shots yet. Open "Add a shot" to log your first one.</p>
                )}

                {listed && listed.length > 0 && (
                  <ShotList
                    // A new key starts the list again at its first page when another player is chosen.
                    key={shooter}
                    shots={listed}
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
    </div>
  )
}
