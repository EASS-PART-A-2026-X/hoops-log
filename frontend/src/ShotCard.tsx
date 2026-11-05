import { useRef } from 'react'
import FallbackImage from './FallbackImage'
import { RADAR_AXES, radarPoint, radarPolygon } from './court/cardData'
import type { CardProfile } from './court/cardData'
import { headshotUrl, initials } from './court/players'

const R = 66 // radar radius in the 200 x 200 drawing
const C = 100

/** The five-axis radar: rings at 25, 50, 75 and 100% of the outer ring (70% shooting), the shooter's shape on top. */
function Radar({ profile }: { profile: CardProfile }) {
  const n = RADAR_AXES.length
  const ring = (f: number) =>
    RADAR_AXES.map((_, i) => radarPoint(i, n, f, C, C, R))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ')
  const shape = radarPolygon(profile.radar, C, C, R)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const summary = RADAR_AXES.map((a, i) => `${a.label} ${profile.radar[i] === null ? 'no data' : `${profile.radar[i]}%`}`).join(', ')
  return (
    <svg className="card-radar" viewBox="0 0 200 200" role="img" aria-label={`Shooting by area: ${summary}${profile.estimated ? ' (estimated)' : ''}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} className={f === 1 ? 'radar-ring outer' : 'radar-ring'} />
      ))}
      {RADAR_AXES.map((_, i) => {
        const [x, y] = radarPoint(i, n, 1, C, C, R)
        return <line key={i} x1={C} y1={C} x2={x} y2={y} className="radar-axis" />
      })}
      <polygon points={shape} className="radar-shape" />
      {RADAR_AXES.map((axis, i) => {
        const [x, y] = radarPoint(i, n, 1, C, C, R + 17)
        return (
          <text key={axis.key} x={x} y={y + 3} textAnchor="middle" className={profile.radar[i] === null ? 'radar-label empty' : 'radar-label'}>
            {axis.label}
          </text>
        )
      })}
    </svg>
  )
}

interface CardProps {
  profile: CardProfile
  /** tile: in the Players grid; big: the large view; versus: one fighter in the face-off. */
  size?: 'tile' | 'big' | 'versus'
  /** Tilt with the pointer and move the foil shine. Off in the face-off, where the card is part of an animation. */
  tilt?: boolean
}

/** A trading-card view of a shooter: rating, play style, where they score, and three numbers. */
export default function ShotCard({ profile, size = 'tile', tilt = true }: CardProps) {
  const ref = useRef<HTMLDivElement>(null)

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el || !tilt) return
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    el.style.setProperty('--mx', `${Math.round(px * 100)}%`)
    el.style.setProperty('--my', `${Math.round(py * 100)}%`)
    el.style.setProperty('--rx', `${((0.5 - py) * 14).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${((px - 0.5) * 16).toFixed(2)}deg`)
  }
  function onLeave() {
    const el = ref.current
    if (!el) return
    for (const v of ['--mx', '--my', '--rx', '--ry']) el.style.removeProperty(v)
  }

  const accent = profile.kind === 'you' ? undefined : profile.teamColor
  return (
    <div
      ref={ref}
      className={`shot-card ${size} ${profile.kind}${tilt ? ' tilt' : ''}`}
      style={accent ? ({ '--card-accent': accent } as React.CSSProperties) : undefined}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <div className="card-top">
        <div className="card-rating">
          <strong aria-label={profile.rating === null ? 'No rating yet' : `Shooting rating ${profile.rating}`}>{profile.rating ?? '–'}</strong>
          <span>{profile.rating === null ? 'Needs 10 shots' : 'Shooting rating'}</span>
          <em className="card-style">{profile.style}</em>
        </div>
        {profile.kind === 'you' ? (
          <span className="card-portrait you" aria-hidden="true">
            {initials(profile.name)}
          </span>
        ) : (
          <FallbackImage
            className="card-portrait nba"
            fallbackClassName="card-portrait-fallback"
            src={headshotUrl(profile.playerId ?? 0)}
            alt=""
            fallback={initials(profile.name)}
          />
        )}
      </div>
      <h3 className="card-name">{profile.name}</h3>
      <p className="card-sub">{profile.subtitle}</p>
      <Radar profile={profile} />
      <dl className="card-stats">
        <div>
          <dt>Field goal</dt>
          <dd>{profile.fg === null ? '–' : `${profile.fg}%`}</dd>
        </div>
        <div>
          <dt>Three point</dt>
          <dd>{profile.three === null ? '–' : `${profile.three}%`}</dd>
        </div>
        <div>
          <dt>Threes</dt>
          <dd>{profile.threeShare === null ? '–' : `${profile.threeShare}%`}</dd>
        </div>
      </dl>
      <p className="card-foot">{profile.estimated ? 'Zone shape estimated from league figures' : `${profile.shots ?? 0} ${profile.shots === 1 ? 'shot' : 'shots'}`}</p>
      <span className="card-foil" aria-hidden="true" />
    </div>
  )
}
