import { useEffect, useRef } from 'react'
import type { Shot } from './api'
import type { FilmState } from './court/CourtScene'
import type { FilmSummary } from './court/film'
import { SMALL_SAMPLE } from './court/nba'
import { zoneLabel } from './court/stats'

interface HudProps {
  state: FilmState
  /** The shot on screen, or undefined while the film changes shot. */
  shot: Shot | undefined
  /** The shown shooter's record from this shot's zone. The percentage and the league figure show only from SMALL_SAMPLE attempts. */
  zone: { pct: number; made: number; attempts: number } | null
  /** The league's percentage from the same zone. */
  nbaPct: number | null
  /** Made (true) or missed (false) for every shot in the film, in order, for the strip along the controls. */
  results: boolean[]
  onPause: (paused: boolean) => void
  onStep: (delta: 1 | -1) => void
  onClose: () => void
}

/** The broadcast graphic and the controls while a shot film plays. */
export function FilmHud({ state, shot, zone, nbaPct, results, onPause, onStep, onClose }: HudProps) {
  // The result shows once the ball has reached the rim, and stays while the camera goes back.
  const showResult = state.phase === 'drop' || state.phase === 'hold' || state.phase === 'outro'
  return (
    <>
      <div className="film-bars" aria-hidden="true" />
      {shot && (
        <div
          key={state.k}
          className={`film-lower ${shot.made ? 'made' : 'missed'}`}
          role="region"
          aria-label={`Shot ${state.k + 1} of ${state.total}: ${shot.player}, ${zoneLabel(shot.zone)}`}
        >
          <div className="film-lower-main">
            <strong className="film-name">{shot.player}</strong>
            <span className="film-where">
              {zoneLabel(shot.zone)}, {shot.shot_type === '3PT' ? 'three-pointer' : 'two-pointer'} · {shot.game_date}
            </span>
            {zone && (
              <span className="film-stat">
                {zone.attempts >= SMALL_SAMPLE ? (
                  <>
                    {zone.pct}% from here ({zone.made} of {zone.attempts})
                    {nbaPct !== null && <> · NBA {nbaPct}%</>}
                  </>
                ) : (
                  <>
                    {zone.made} of {zone.attempts} from here
                  </>
                )}
              </span>
            )}
          </div>
          <div className="film-result" aria-live="polite">
            {showResult ? (shot.made ? 'Made' : 'Missed') : ''}
          </div>
        </div>
      )}
      <div className="film-controls" role="toolbar" aria-label="Film controls">
        <div className="film-ribbon" aria-hidden="true">
          {results.map((made, i) => (
            <span key={i} className={`${made ? 'made' : 'missed'}${i === state.k ? ' current' : ''}`} />
          ))}
        </div>
        <div className="film-buttons">
          <button type="button" aria-label="Previous shot" onClick={() => onStep(-1)}>
            ‹
          </button>
          <button type="button" aria-label={state.paused ? 'Play' : 'Pause'} onClick={() => onPause(!state.paused)}>
            {state.paused ? '▶' : '❚❚'}
          </button>
          <button type="button" aria-label="Next shot" onClick={() => onStep(1)}>
            ›
          </button>
          <span className="film-count">
            Shot {state.k + 1} of {state.total}
          </span>
          <button type="button" aria-label="Close the film" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
    </>
  )
}

interface SummaryProps {
  summary: FilmSummary
  /** The best zone's name, if there is one. */
  bestZoneName: string | null
  onAgain: () => void
  onClose: () => void
}

/** The card after a film: how it went. */
export function FilmSummaryCard({ summary, bestZoneName, onAgain, onClose }: SummaryProps) {
  const again = useRef<HTMLButtonElement>(null)
  useEffect(() => again.current?.focus(), [])
  return (
    <div className="film-summary" role="dialog" aria-label="Film summary">
      <p className="film-sum-big">
        {summary.made} of {summary.total} made
      </p>
      <p className="film-sum-sub">
        {summary.pct === null ? '' : `${summary.pct}%`}
        {summary.bestZone && bestZoneName && ` · best from ${bestZoneName}: ${summary.bestZone.made} of ${summary.bestZone.total}`}
      </p>
      <div className="film-sum-actions">
        <button type="button" className="btn" ref={again} onClick={onAgain}>
          Watch again
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
