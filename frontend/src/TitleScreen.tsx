import { useEffect, useRef, useState } from 'react'
import Logo from './Logo'
import { play, unlockAudio } from './game/audio'
import { LEAVE_MS, isStartKey, markSeen } from './game/titleSeen'

export interface TitleStats {
  name: string
  level: number
  rank: string
  shots: number
  trophies: number
  trophyTotal: number
}

const LINES: [string, string] = ['HOOPS', 'LOG']
// Floating sparks: fixed numbers, so the screen looks the same every time and tests do not depend on chance.
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37) % 100,
  size: 3 + ((i * 7) % 6),
  delay: -((i * 13) % 11),
  dur: 7 + ((i * 5) % 8),
  blue: i % 3 === 0,
}))

interface Props {
  stats: TitleStats | null
  /** Called the moment the player starts: the court behind begins its entrance. */
  onStart: () => void
  /** Called when the wipe has finished and the screen can go. */
  onDone: () => void
}

/**
 * The game's title screen: a moving court floor, spotlights, a bouncing ball and the logo slamming in.
 * A click or any key starts the game and an iris wipe reveals the app, which is already loaded behind.
 */
export default function TitleScreen({ stats, onStart, onDone }: Props) {
  const [leaving, setLeaving] = useState(false)
  const startRef = useRef<HTMLButtonElement>(null)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  const started = useRef(false)
  function start() {
    // A ref, not the state: Enter on the focused button runs the key handler and the click in one go.
    if (started.current) return
    started.current = true
    setLeaving(true)
    markSeen()
    onStart()
    unlockAudio()
    // The browser resumes sound a moment after the click, so the first sound waits for it.
    window.setTimeout(() => play('start'), 90)
  }
  const startRefFn = useRef(start)
  useEffect(() => {
    startRefFn.current = start
  })

  useEffect(() => {
    startRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (!isStartKey(e)) return // F5, F12, Escape, Tab and the like keep doing what the browser does with them
      if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault() // no page scroll behind the title
      startRefFn.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!leaving) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => doneRef.current(), reduced ? 0 : LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  return (
    <div
      className={leaving ? 'title leaving' : 'title'}
      role="dialog"
      aria-modal="true"
      aria-label="Hoops Log, press start"
      onPointerDown={start}
    >
      <div className="t-bg" aria-hidden="true">
        <div className="t-sky" />
        <div className="t-beam b1" />
        <div className="t-beam b2" />
        <div className="t-beam b3" />
        <div className="t-floor">
          <div className="t-grid">
            <div />
          </div>
          <div className="t-key" />
          <div className="t-arc" />
        </div>
        <div className="t-rings">
          <i />
          <i />
          <i />
        </div>
        {SPARKS.map((s, i) => (
          <b
            key={i}
            className={s.blue ? 'spark blue' : 'spark'}
            style={{ left: `${s.left}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
          />
        ))}
        <div className="t-scan" />
        <div className="t-vignette" />
      </div>

      <div className="t-stage">
        <div className="t-ball-wrap" aria-hidden="true">
          <div className="t-ball">
            <Logo size={150} />
          </div>
          <div className="t-shadow" />
        </div>

        <h1 className="t-logo">
          {LINES.map((word, w) => (
            <span key={word} className={w === 0 ? 'word one' : 'word two'}>
              {[...word].map((ch, i) => (
                <span key={i} className="ltr" data-ch={ch} style={{ animationDelay: `${0.25 + (w * 5 + i) * 0.09}s` }}>
                  {ch}
                </span>
              ))}
            </span>
          ))}
        </h1>
        <p className="t-sub">SHOT CHART · LEVEL UP · GO FOR 100%</p>

        {stats && (
          <div className="t-card">
            <span className="t-p1">PLAYER 1</span>
            <strong>{stats.name || 'ALL PLAYERS'}</strong>
            <span className="t-lvl">
              <small>LVL</small> {stats.level} <em>{stats.rank}</em>
            </span>
            <span className="t-meta">
              {stats.shots} shots · {stats.trophies}/{stats.trophyTotal} trophies
            </span>
          </div>
        )}

        <button ref={startRef} type="button" className="t-start" onClick={start}>
          PRESS START
        </button>
        <p className="t-hint">Click anywhere or press any key</p>
      </div>

      <div className="t-flash" aria-hidden="true" />
    </div>
  )
}
