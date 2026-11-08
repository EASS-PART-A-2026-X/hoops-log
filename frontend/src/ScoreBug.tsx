import { useSyncExternalStore } from 'react'
import { useTicker } from './game/useTicker'
import { isMuted, play, setMuted, subscribeMuted } from './game/audio'
import type { XpPop } from './game/useCelebrations'
import type { LevelInfo } from './game/xp'

interface Props {
  /** False while the title screen covers the app: the numbers wait at zero, then count up when it starts. */
  armed: boolean
  name: string
  made: number
  attempts: number
  level: LevelInfo
  pop: XpPop | null
}

/** The top bar's TV score bug: whose shots, their field goal percent, and level with an XP bar. */
export default function ScoreBug({ armed, name, made, attempts, level, pop }: Props) {
  const pct = !armed || attempts === 0 ? 0 : Math.round((made / attempts) * 100)
  const shownPct = useTicker(pct)
  const shownXp = useTicker(armed ? level.into : 0)
  const fill = level.span === 0 ? 0 : Math.min(100, (shownXp / level.span) * 100)
  const showPop = pop !== null && (name === '' || pop.player === name)

  return (
    <div className="scorebug-wrap">
    <div className="scorebug" role="group" aria-label={`${name || 'Everyone'}: level ${level.level} ${level.title}`}>
      <span className="bug-live" aria-hidden="true">
        <i /> LIVE
      </span>
      <span className="bug-name">{name || 'ALL PLAYERS'}</span>
      <span className="bug-fg" title="Field goal percent">
        <b>{attempts === 0 ? '–' : shownPct}</b>
        {attempts > 0 && <small>%</small>}
        <em>FG</em>
      </span>
      <span className="bug-level">
        <span className="bug-lvl">
          <small>LVL</small>
          <b>{level.level}</b>
        </span>
        <span className="bug-xp">
          <span className="bug-rank">{level.title}</span>
          <span className="bug-bar" role="progressbar" aria-label="XP to next level" aria-valuemin={0} aria-valuemax={level.span} aria-valuenow={level.into}>
            <i style={{ width: `${fill}%` }} />
          </span>
          <span className="bug-xpnum">
            {level.into} / {level.span} XP
          </span>
        </span>
      </span>
    </div>
      {showPop && (
        <span key={pop.key} className="xp-pop" aria-hidden="true">
          +{pop.amount} XP
        </span>
      )}
    </div>
  )
}

/** Sound on / off, in the top bar. */
export function MuteButton() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false)
  return (
    <button
      type="button"
      className="mute-btn"
      aria-pressed={muted}
      aria-label={muted ? 'Sound is off, turn it on' : 'Sound is on, turn it off'}
      onClick={() => {
        setMuted(!muted)
        if (muted) play('tick')
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
        {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
      </svg>
    </button>
  )
}
