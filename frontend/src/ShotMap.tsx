import { useEffect, useMemo, useRef, useState } from 'react'
import { BACKEND_URL } from './api'
import type { Shot } from './api'
import type { CourtScene, MapMode, ViewName } from './court/CourtScene'
import { applyFilters, heatGrid, hottestZone, summarize, zoneStats } from './court/stats'
import type { AreaFilter, ResultFilter } from './court/stats'

interface Props {
  shots: Shot[] | null
  selectedId: number | null
  onSelect: (id: number) => void
}

interface Hover {
  index: number
  x: number
  y: number
  flip: boolean
}

function Chips<T extends string>(props: {
  label: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div className="chips" role="group" aria-label={props.label}>
      {props.options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className="chip"
          aria-pressed={props.value === id}
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
  ['broadcast', 'Broadcast'],
  ['top', 'Top down'],
  ['low', 'Low angle'],
  ['side', 'Sideline'],
]

const fmtPct = (v: number | null) => (v === null ? '–' : `${v}%`)

export default function ShotMap({ shots, selectedId, onSelect }: Props) {
  const [area, setArea] = useState<AreaFilter>('all')
  const [result, setResult] = useState<ResultFilter>('all')
  const [player, setPlayer] = useState('')
  const [mode, setMode] = useState<MapMode>('beams')
  const [view, setView] = useState<ViewName>('broadcast')
  const [auto, setAuto] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CourtScene | null>(null)
  const introDone = useRef(false)

  const players = useMemo(() => [...new Set((shots ?? []).map((s) => s.player))].sort(), [shots])
  // A player who was deleted must not leave the filter stuck on nobody.
  const activePlayer = players.includes(player) ? player : ''
  const filtered = useMemo(
    () => applyFilters(shots ?? [], { area, result, player: activePlayer }),
    [shots, area, result, activePlayer],
  )
  const summary = useMemo(() => summarize(filtered), [filtered])
  const zones = useMemo(() => zoneStats(filtered), [filtered])
  const hottest = useMemo(() => hottestZone(zones), [zones])

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
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    import('./court/CourtScene')
      .then(({ CourtScene }) => {
        if (stop.signal.aborted) return
        try {
          scene = new CourtScene(host, {
            reducedMotion: reduced,
            onHover: (index, x, y) =>
              setHover(index === null ? null : { index, x, y, flip: x > host.clientWidth * 0.55 }),
            onPick: (index) => {
              const shot = filteredRef.current[index]
              if (shot) onSelectRef.current(shot.id)
            },
            onFail: () => setFailed(true),
          })
          sceneRef.current = scene
          if (import.meta.env.DEV) (window as unknown as { __court?: CourtScene }).__court = scene
          setReady(true)
        } catch {
          setFailed(true) // no WebGL: show the flat chart instead
        }
      })
      .catch(() => setFailed(true))
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
        labels: zones.map((z) => ({ x: z.x, y: z.y, title: z.label, detail: `${z.made}/${z.attempts} · ${z.pct}%` })),
        heat: filtered.length > 0 ? heatGrid(filtered) : null,
      },
      !introDone.current && filtered.length > 0,
    )
    if (filtered.length > 0) introDone.current = true
  }, [ready, shots, filtered, zones])

  useEffect(() => sceneRef.current?.setMode(mode), [ready, mode])
  useEffect(() => sceneRef.current?.setAutoRotate(auto), [ready, auto])
  useEffect(() => {
    // The first view is the scene's own default; only move the camera for a real choice.
    if (view !== 'broadcast' || introDone.current) sceneRef.current?.setView(view)
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
  const loading = shots === null
  const label = loading
    ? 'Shot map, loading'
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
          <Chips label="Shot area" value={area} options={AREAS} onChange={setArea} />
          <Chips label="Result" value={result} options={RESULTS} onChange={setResult} />
          <label className="player-filter">
            <span className="sr-only">Player</span>
            <select value={activePlayer} onChange={(e) => setPlayer(e.target.value)}>
              <option value="">Every player</option>
              {players.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
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
        </div>
      </div>

      <div className="map-body">
        <div className="stage">
          {failed ? (
            <div className="stage-fallback">
              <p>The 3D view needs WebGL, which this browser could not start. Here is the flat chart instead.</p>
              <img src={chartUrl} alt={`Shot chart: green circles are made shots, red crosses are misses.`} />
            </div>
          ) : (
            <div className="stage-frame">
              <div ref={hostRef} className="stage-canvas" role="img" aria-label={label} />
              {(loading || !ready) && <p className="stage-msg">Loading the court…</p>}
              {ready && !loading && filtered.length === 0 && (
                <p className="stage-msg">
                  {(shots ?? []).length === 0
                    ? 'No shots yet. Add one and the court lights up.'
                    : 'No shots match these filters.'}
                </p>
              )}
              <p className="stage-hint" aria-hidden="true">
                Drag to orbit · scroll to zoom · click a shot
              </p>
              <ul className="legend" aria-hidden="true">
                <li>
                  <span className="dot made" /> Made
                </li>
                <li>
                  <span className="cross" /> Missed
                </li>
                <li>
                  <span className="ramp" /> Cold → Hot
                </li>
                {mode === 'beams' && <li>Taller beam = three-pointer</li>}
              </ul>
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
                    {hovered.zone.replaceAll('_', ' ')} · {hovered.game_date}
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
