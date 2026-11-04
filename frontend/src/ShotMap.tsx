import { useEffect, useMemo, useRef, useState } from 'react'
import { BACKEND_URL } from './api'
import type { Shot } from './api'
import type { CourtScene, MapMode, ViewName } from './court/CourtScene'
import { applyFilters, heatGrid, hexBins, hottestZone, summarize, TYPICAL_FG, zoneLabel, zoneStats } from './court/stats'
import { lastName } from './court/players'
import ShooterSelect from './ShooterSelect'
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
  players: string[]
  player: string
  onPlayerChange: (player: string) => void
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
  label: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="chips" role="group" aria-label={props.label}>
      {props.options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className="chip"
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
const MODES: [MapMode, string][] = [
  ['heat', 'Heat map'],
  ['beams', '3D beams'],
  ['arcs', 'Flight paths'],
]
const VIEWS: [ViewName, string][] = [
  ['shooter', 'Shooter view'],
  ['top', 'Top down'],
  ['low', 'Low angle'],
  ['side', 'Sideline'],
]

const fmtPct = (v: number | null) => (v === null ? '–' : `${v}%`)

export default function ShotMap({ shots, loadError, retrying, onRetry, selectedId, onSelect, baseline, players, player, onPlayerChange }: Props) {
  const [area, setArea] = useState<AreaFilter>('all')
  const [result, setResult] = useState<ResultFilter>('all')
  const [mode, setMode] = useState<MapMode>('beams')
  const [view, setView] = useState<ViewName>('shooter')
  const [auto, setAuto] = useState(false)
  const [ready, setReady] = useState(false)
  // Why the 3D view is not running: it never started, or the browser took the context away.
  const [failed, setFailed] = useState<'start' | 'lost' | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [cellHover, setCellHover] = useState<CellHover | null>(null)

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
          x: z.x,
          y: z.y,
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
  useEffect(() => sceneRef.current?.setAutoRotate(auto), [ready, auto])
  useEffect(() => {
    // The first view is the scene's own default; only move the camera for a real choice.
    if (view !== 'shooter' || introDone.current) sceneRef.current?.setView(view)
  }, [ready, view])
  const selectedIndex = useMemo(
    () => (selectedId === null ? -1 : filtered.findIndex((s) => s.id === selectedId)),
    [filtered, selectedId],
  )
  useEffect(
    () => sceneRef.current?.setSelected(selectedIndex >= 0 ? selectedIndex : null),
    [ready, selectedIndex, filtered],
  )

  const hovered = hover ? filtered[hover.index] : undefined
  // "Show on map" for a shot the current filters hide: say so, and offer the way out.
  const hiddenSelected =
    selectedId !== null && (shots ?? []).some((s) => s.id === selectedId) && !filtered.some((s) => s.id === selectedId)
  const clearFilters = () => {
    setArea('all')
    setResult('all')
    onPlayerChange('')
  }
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
          <p className="eyebrow">SHOT MAP</p>
          <h2 id="map-title">Where your shots live</h2>
        </div>
        <div className="filters">
          <Chips label="Shot area" value={area} options={AREAS} onChange={setArea} disabled={failed !== null} />
          <Chips label="Result" value={result} options={RESULTS} onChange={setResult} disabled={failed !== null} />
          <ShooterSelect players={players} value={player} onChange={onPlayerChange} />
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
            <div className="stage-frame">
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
              {hiddenSelected && (
                <div className="stage-notice">
                  Shot #{selectedId} is hidden by the current filters.
                  <button type="button" className="link" onClick={clearFilters}>
                    Show all shots
                  </button>
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

          {!failed && (
            <div className="toolbar">
              <Chips label="Map style" value={mode} options={MODES} onChange={setMode} />
              <Chips label="Camera angle" value={view} options={VIEWS} onChange={setView} />
              <div className="chips">
                <button
                  type="button"
                  className="chip"
                  onClick={() => sceneRef.current?.replay()}
                  disabled={!ready || filtered.length === 0}
                >
                  ▶ Replay
                </button>
                <button type="button" className="chip" aria-pressed={auto} onClick={() => setAuto(!auto)}>
                  Auto-rotate
                </button>
              </div>
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
