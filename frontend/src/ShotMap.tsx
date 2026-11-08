import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BACKEND_URL } from './api'
import type { Shot } from './api'
import type { CourtScene, FilmState, MapMode } from './court/CourtScene'
import { latestIndices, summarizeFilm } from './court/film'
import type { FilmSummary } from './court/film'
import { LEAGUE, benchZonePct } from './court/nba'
import { FilmHud, FilmSummaryCard } from './FilmHud'
import { applyFilters, heatGrid, hexBins, hottestZone, summarize, TYPICAL_FG, zoneLabel, zoneShare, zoneStats } from './court/stats'
import { lastName } from './court/players'
import StyleSelect from './StyleSelect'
import { play } from './game/audio'
import type { HexCell, Typical } from './court/stats'
import type { AreaFilter, ResultFilter } from './court/stats'

interface Props {
  shots: Shot[] | null
  /** Why the shots could not be loaded, if they could not. */
  loadError: string | null
  /** True while a reload is in flight, so the retry button can say so. */
  retrying: boolean
  onRetry: () => void
  selectedId: number | null
  /** A shot was clicked on the map; null means a click on empty space or the clear button. */
  onSelect: (id: number | null) => void
  /** A player the heat map compares each spot with, instead of a typical shooter. */
  baseline: { name: string; typical: Typical } | null
  /** Everyone in the log, and whose shots to show ('' = everyone). The choice lives in App. */
  player: string
  onPlayerChange: (player: string) => void
  /** Whether the log tab is showing. ShotMap stays mounted when it is hidden, and the film must not. */
  visible: boolean
  /** The page is covered (title screen): the 3D court stops drawing. */
  suspended?: boolean
}

interface Hover {
  index: number
  x: number
  y: number
  flip: boolean
}

interface CellHover {
  cell: HexCell
  x: number
  y: number
  flip: boolean
}

const MAX_LABELS = 7 // more than this and the zone names print over each other

function Chips<T extends string>(props: {
  /** Names the group for screen readers. */
  label: string
  /** The short word shown at the start of the box. */
  short: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  // One segmented control per choice: a label, then the options in one rounded box, one of them filled.
  // The box is what tells you "pick one of these"; the old loose pills all looked like one long row.
  return (
    <div className="seg" role="group" aria-label={props.label}>
      <span className="seg-label" aria-hidden="true">
        {props.short}
      </span>
      {props.options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className="seg-btn"
          aria-pressed={props.value === id}
          disabled={props.disabled}
          onClick={() => props.onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

const AREAS: [AreaFilter, string][] = [
  ['all', 'All shots'],
  ['threes', 'Threes'],
  ['mid', 'Mid-range'],
  ['paint', 'Paint'],
]
const RESULTS: [ResultFilter, string][] = [
  ['all', 'Made + missed'],
  ['made', 'Made'],
  ['missed', 'Missed'],
]
const fmtPct = (v: number | null) => (v === null ? '–' : `${v}%`)

export default function ShotMap({ shots, loadError, retrying, onRetry, selectedId, onSelect, baseline, player, onPlayerChange, visible, suspended = false }: Props) {
  const [area, setArea] = useState<AreaFilter>('all')
  const [result, setResult] = useState<ResultFilter>('all')
  const [mode, setMode] = useState<MapMode>('beams')
  const [ready, setReady] = useState(false)
  // Why the 3D view is not running: it never started, or the browser took the context away.
  const [failed, setFailed] = useState<'start' | 'lost' | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [cellHover, setCellHover] = useState<CellHover | null>(null)
  // The shot film: what it is doing now, the shots it plays, and the card shown after it.
  const [film, setFilm] = useState<FilmState | null>(null)
  const [filmDone, setFilmDone] = useState<{ summary: FilmSummary; bestZoneName: string | null } | null>(null)
  const filmShots = useRef<Shot[]>([])
  // The last film moment that made a sound, so a pause or a resume does not repeat it.
  const filmBeat = useRef('')
  /** Swish or clang when the ball drops, cheer or groan when the result shows, a buzzer at the end. */
  function filmSound(state: FilmState) {
    if (!state.active) {
      if (state.finished && filmShots.current.length > 1 && filmBeat.current !== 'end') play('buzzer')
      filmBeat.current = state.finished ? 'end' : ''
      return
    }
    const beat = `${state.k}:${state.phase}`
    if (beat === filmBeat.current) return
    filmBeat.current = beat
    const made = filmShots.current[state.k]?.made
    if (made === undefined) return
    if (state.phase === 'drop') play(made ? 'swish' : 'rim')
    else if (state.phase === 'hold') play(made ? 'cheer' : 'groan')
  }
  const [filmResults, setFilmResults] = useState<boolean[]>([]) // made or missed, for the strip beside the controls

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CourtScene | null>(null)
  const introDone = useRef(false)

  const activePlayer = player
  const filtered = useMemo(
    () => applyFilters(shots ?? [], { area, result, player: activePlayer }),
    [shots, area, result, activePlayer],
  )
  const summary = useMemo(() => summarize(filtered), [filtered])
  const zones = useMemo(() => zoneStats(filtered), [filtered])
  const hottest = useMemo(() => hottestZone(zones), [zones])
  const typical = baseline?.typical ?? TYPICAL_FG
  const hexes = useMemo(
    () => hexBins(filtered, undefined, typical),
    [filtered, typical],
  )
  const baseWord = baseline ? lastName(baseline.name) : 'typical'

  // Latest values for scene callbacks, which outlive any one render.
  const filteredRef = useRef(filtered)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    filteredRef.current = filtered
    onSelectRef.current = onSelect
  })

  // Create the 3D scene once. Three.js is a separate chunk: the list never waits for it.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const stop = new AbortController()
    let scene: CourtScene | null = null
    // Without WebGL the flat chart can only filter by player, so the other filters go back to
    // their defaults. A scene that was running is stopped, not left drawing to nobody.
    const fail = (reason: 'start' | 'lost') => {
      sceneRef.current?.dispose()
      sceneRef.current = null
      setFailed(reason)
      setReady(false)
      setArea('all')
      setResult('all')
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    import('./court/CourtScene')
      .then(({ CourtScene }) => {
        if (stop.signal.aborted) return
        try {
          scene = new CourtScene(host, {
            reducedMotion: reduced,
            onHover: (index, x, y) =>
              setHover(index === null ? null : { index, x, y, flip: x > host.clientWidth * 0.55 }),
            onHoverCell: (cell, x, y) =>
              setCellHover(cell === null ? null : { cell, x, y, flip: x > host.clientWidth * 0.55 }),
            onPick: (index) => {
              const shot = index === null ? undefined : filteredRef.current[index]
              onSelectRef.current(shot ? shot.id : null)
            },
            onFail: () => fail('lost'),
            onFilm: (state) => {
              setFilm(state.active ? state : null)
              filmSound(state)
              // A single shot needs no summary; a session gets one.
              if (state.finished && filmShots.current.length > 1) {
                const summary = summarizeFilm(filmShots.current)
                setFilmDone({ summary, bestZoneName: summary.bestZone ? zoneLabel(summary.bestZone.zone) : null })
              }
            },
          })
          sceneRef.current = scene
          if (import.meta.env.DEV) (window as unknown as { __court?: CourtScene }).__court = scene
          setReady(true)
        } catch {
          fail('start') // no WebGL: show the flat chart instead
        }
      })
      .catch(() => fail('start'))
    return () => {
      stop.abort()
      sceneRef.current = null
      scene?.dispose()
      setReady(false)
    }
  }, [])

  // Feed the scene whenever the visible shots change.
  useEffect(() => {
    const scene = sceneRef.current
    if (!ready || !scene || !shots) return
    scene.setData(
      {
        points: filtered.map((s) => ({ x: s.x, y: s.y, made: s.made, three: s.shot_type === '3PT' })),
        // Only the busiest zones get a label: the rest are in the Zones list beside the court.
        labels: zones.slice(0, MAX_LABELS).map((z) => ({
          x: z.labelX,
          y: z.labelY,
          title: z.label,
          value: `${z.pct}%`,
          sub: `${z.made}/${z.attempts}`,
        })),
        heat: filtered.length > 0 ? heatGrid(filtered) : null,
        hexes: filtered.length > 0 ? hexes : null,
      },
      !introDone.current && filtered.length > 0,
    )
    if (filtered.length > 0) introDone.current = true
  }, [ready, shots, filtered, zones, hexes])

  useEffect(() => sceneRef.current?.setMode(mode), [ready, mode])
  const selectedIndex = useMemo(
    () => (selectedId === null ? -1 : filtered.findIndex((s) => s.id === selectedId)),
    [filtered, selectedId],
  )
  useEffect(
    () => sceneRef.current?.setSelected(selectedIndex >= 0 ? selectedIndex : null),
    [ready, selectedIndex, filtered],
  )

  const hovered = hover ? filtered[hover.index] : undefined
  // "Show on map" for a shot the map hides: either its player is not the shown shooter, or the
  // area/result filters hide it.
  const selectedShot = selectedId === null ? undefined : (shots ?? []).find((s) => s.id === selectedId)
  const hiddenByPlayer = !!selectedShot && !!activePlayer && selectedShot.player !== activePlayer
  const hiddenSelected = !!selectedShot && !filtered.some((s) => s.id === selectedId)
  // Only the map's own filters; "Shots of" is shared with the other tabs and is not touched.
  const clearFilters = () => {
    setArea('all')
    setResult('all')
  }
  // Watch the selected shot, or if none is selected the latest shots of the session.
  const watch = () => {
    const scene = sceneRef.current
    if (!scene || filtered.length === 0) return
    setFilmDone(null)
    if (selectedIndex >= 0) {
      filmShots.current = [filtered[selectedIndex]!]
      setFilmResults([filtered[selectedIndex]!.made])
      scene.startFilm([selectedIndex], 'shot')
    } else {
      const indices = latestIndices(filtered)
      filmShots.current = indices.map((i) => filtered[i]!)
      setFilmResults(filmShots.current.map((s) => s.made))
      scene.startFilm(indices, 'session')
    }
  }
  const closeFilm = useCallback(() => {
    sceneRef.current?.stopFilm()
    setFilm(null)
    setFilmDone(null)
  }, [])
  const filmShot = film && film.index !== null ? filtered[film.index] : undefined
  // The shooter's record from the shot's zone: the player filter applies, the Area and Result chips do not.
  const shooterShots = useMemo(() => applyFilters(shots ?? [], { area: 'all', result: 'all', player: activePlayer }), [shots, activePlayer])
  const filmZone = filmShot ? zoneShare(shooterShots, filmShot.zone) : null
  const watchLabel = selectedIndex >= 0 ? 'Watch shot' : 'Watch session'

  // While a film plays or its card is open the keyboard drives it: Space pauses, the arrows change
  // shot, Escape closes. Registered in the capture phase so the app's own Escape (close the drawer,
  // deselect) does not also fire.
  const filmOpen = film !== null || filmDone !== null
  // Leaving the log tab ends the film: nothing is drawn there and its keys must not be swallowed.
  // When the cover lifts (the title screen was started), the court makes its entrance in front of the player.
  const wasSuspended = useRef(suspended)
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.setSuspended(suspended)
    if (wasSuspended.current && !suspended) scene.playEntrance()
    wasSuspended.current = suspended
  }, [suspended, ready])

  const [wasVisible, setWasVisible] = useState(visible)
  if (wasVisible !== visible) {
    setWasVisible(visible)
    if (!visible) {
      setFilm(null)
      setFilmDone(null)
    }
  }
  useEffect(() => {
    if (!visible) sceneRef.current?.stopFilm()
  }, [visible])
  useEffect(() => {
    if (!filmOpen || !visible) return
    const onKey = (e: KeyboardEvent) => {
      const scene = sceneRef.current
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === 'Escape') {
        closeFilm()
      } else if (film && e.key === ' ') {
        scene?.pauseFilm(!film.paused)
      } else if (film && e.key === 'ArrowRight') {
        scene?.stepFilm(1)
      } else if (film && e.key === 'ArrowLeft') {
        scene?.stepFilm(-1)
      } else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [filmOpen, visible, film, closeFilm])
  const loading = shots === null
  const label = loading
    ? loadError
      ? 'Shot map. The shots could not be loaded.'
      : 'Shot map, loading'
    : `Shot map. ${summary.attempts} shots, ${summary.made} made${hottest ? `, hottest zone ${hottest.label}` : ''}. The shot list and zone breakdown give the same data as text.`
  const chartUrl = `${BACKEND_URL}/chart.svg${activePlayer ? `?player=${encodeURIComponent(activePlayer)}` : ''}`

  return (
    <section className="map card" aria-labelledby="map-title">
      <div className="map-head">
        <div>
          <h2 id="map-title">Where your shots live</h2>
        </div>
        <div className="filters">
          <Chips label="Shot area" short="Area" value={area} options={AREAS} onChange={setArea} disabled={failed !== null} />
          <Chips label="Result" short="Result" value={result} options={RESULTS} onChange={setResult} disabled={failed !== null} />
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">FIELD GOAL</span>
          <span className="kpi-value">{fmtPct(summary.fg)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">THREE POINT</span>
          <span className="kpi-value">{fmtPct(summary.three)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">SHOTS</span>
          <span className="kpi-value">{summary.attempts}</span>
        </div>
        <div className="kpi hot">
          <span className="kpi-label">HOTTEST ZONE</span>
          <span className="kpi-value small">{hottest ? hottest.label : '–'}</span>
          {hottest && (
            <span className="kpi-sub">
              {hottest.made}/{hottest.attempts} made · {hottest.pct}%
            </span>
          )}
        </div>
      </div>

      <div className="map-body">
        <div className="stage">
          {failed ? (
            <div className="stage-fallback">
              <p>
                {failed === 'lost'
                  ? 'The browser took the 3D drawing context away (a GPU reset, or the tab sat in the background). '
                  : 'The 3D view needs WebGL, which this browser could not start. '}
                Here is the flat chart instead. It can only be filtered by player, and its colours
                (green made, red missed) come from the backend.
              </p>
              {failed === 'lost' && (
                <button type="button" className="btn" onClick={() => window.location.reload()}>
                  Reload to try 3D again
                </button>
              )}
              <img src={chartUrl} alt={`Shot chart: green circles are made shots, red crosses are misses.`} />
            </div>
          ) : (
            <div className={`stage-frame${cellHover && mode === 'heat' ? ' cell-hover' : ''}${film ? ' film-on' : ''}`}>
              <div ref={hostRef} className="stage-canvas" role="img" aria-label={label} />
              {!shots && loadError ? (
                <div className="stage-msg stage-msg-error" role="alert">
                  <p>Could not load the shots, so there is nothing to draw.</p>
                  <button type="button" className="btn" onClick={onRetry} disabled={retrying}>
                    {retrying ? 'Trying…' : 'Try again'}
                  </button>
                </div>
              ) : (
                (loading || !ready) && <p className="stage-msg">Loading the court…</p>
              )}
              {selectedId !== null && !hiddenSelected && (
                <button type="button" className="btn stage-clear" onClick={() => onSelect(null)}>
                  Clear selection<span className="sr-only"> (shot #{selectedId})</span>
                </button>
              )}
              {hiddenSelected && selectedShot && (
                <div className="stage-notice">
                  {hiddenByPlayer
                    ? `Shot #${selectedId} is by ${selectedShot.player}, not ${activePlayer}.`
                    : `Shot #${selectedId} is hidden by the area or result filter.`}
                  {hiddenByPlayer ? (
                    <button type="button" className="link" onClick={() => onPlayerChange(selectedShot.player)}>
                      Show {selectedShot.player}'s shots
                    </button>
                  ) : (
                    <button type="button" className="link" onClick={clearFilters}>
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              {ready && !loading && filtered.length === 0 && (
                <p className="stage-msg">
                  {(shots ?? []).length === 0
                    ? 'No shots yet. Add one and the court lights up.'
                    : 'No shots match these filters.'}
                </p>
              )}
              <p className="stage-hint" aria-hidden="true">
                {mode === 'heat' ? 'Drag to orbit · scroll to zoom · hover a hex' : 'Drag to orbit · scroll to zoom · click a shot'}
              </p>
            {/* The court's tools: watch, replay and the map style dropdown. */}
            <div className="tools" role="group" aria-label="Tools">
              <button type="button" className="tool film-start" onClick={watch} disabled={!ready || filtered.length === 0}>
                ▶ {watchLabel}
              </button>
              <button
                type="button"
                className="tool"
                onClick={() => sceneRef.current?.replay()}
                disabled={!ready || filtered.length === 0}
              >
                ▶ Replay
              </button>
              <StyleSelect value={mode} onChange={setMode} />
            </div>
              {film && (
                <FilmHud
                  state={film}
                  shot={filmShot}
                  zone={filmZone}
                  nbaPct={filmShot ? benchZonePct(filmShot.zone, LEAGUE) : null}
                  results={filmResults}
                  onPause={(paused) => sceneRef.current?.pauseFilm(paused)}
                  onStep={(delta) => sceneRef.current?.stepFilm(delta)}
                  onClose={closeFilm}
                />
              )}
              {filmDone && !film && (
                <FilmSummaryCard
                  summary={filmDone.summary}
                  bestZoneName={filmDone.bestZoneName}
                  onAgain={() => {
                    setFilmDone(null)
                    sceneRef.current?.restartFilm()
                  }}
                  onClose={closeFilm}
                />
              )}
              <ul className="legend" aria-hidden="true">
                {mode === 'heat' ? (
                  <>
                    <li>
                      <span className="ramp" /> Colder · typical · hotter
                    </li>
                    <li>Bigger, taller hex = more shots</li>
                    <li className="legend-note">
                      vs {baseline ? `${baseline.name}'s` : 'a typical'} {Math.round(typical['2PT'] * 100)}% on twos, {Math.round(typical['3PT'] * 100)}% on threes
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <span className="dot made" /> Made
                    </li>
                    <li>
                      <span className="cross" /> Missed
                    </li>
                    {mode === 'beams' && <li>Taller beam = three-pointer</li>}
                  </>
                )}
              </ul>
              {cellHover && mode === 'heat' && (
                <div
                  className="tip plain"
                  aria-hidden="true"
                  style={{
                    left: cellHover.x,
                    top: cellHover.y,
                    transform: `translate(${cellHover.flip ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
                  }}
                >
                  <strong>
                    {cellHover.cell.made} of {cellHover.cell.attempts} made
                  </strong>
                  <span className={cellHover.cell.heat >= 0.5 ? 'tip-made' : 'tip-missed'}>
                    {Math.round((cellHover.cell.made / cellHover.cell.attempts) * 100)}% here · {baseWord}{' '}
                    {cellHover.cell.expectedPct}%
                  </span>
                  <span className="tip-note">
                    {cellHover.cell.heat >= 0.58
                      ? `Hotter than ${baseWord}`
                      : cellHover.cell.heat <= 0.42
                        ? `Colder than ${baseWord}`
                        : `About ${baseWord}`}
                    {cellHover.cell.attempts < 4 ? ' (only a few shots)' : ''}
                  </span>
                </div>
              )}
              {hovered && hover && (
                <div
                  className="tip"
                  aria-hidden="true"
                  style={{
                    left: hover.x,
                    top: hover.y,
                    transform: `translate(${hover.flip ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
                  }}
                >
                  <strong>{hovered.player}</strong>
                  <span className={hovered.made ? 'tip-made' : 'tip-missed'}>
                    {hovered.made ? 'Made' : 'Missed'} · {hovered.shot_type}
                  </span>
                  <span>
                    {zoneLabel(hovered.zone)} · {hovered.game_date}
                  </span>
                  {hovered.note && <span className="tip-note">{hovered.note}</span>}
                </div>
              )}
            </div>
          )}

        </div>

        <aside className="zones" aria-label="Zone breakdown">
          <h3>Zones</h3>
          {zones.length === 0 ? (
            <p className="state">Nothing to break down yet.</p>
          ) : (
            <ul>
              {zones.map((z) => (
                <li key={z.zone}>
                  <div className="zone-row">
                    <span>{z.label}</span>
                    <span className="zone-num">
                      {z.made}/{z.attempts} · {z.pct}%
                    </span>
                  </div>
                  <div className="zone-bar" aria-hidden="true">
                    <span style={{ width: `${z.pct}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  )
}
