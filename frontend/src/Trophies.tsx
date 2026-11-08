import { useMemo } from 'react'
import { trophyStatus } from './game/achievements'
import type { TrophyShot } from './game/achievements'

/** The trophy wall: unlocked ones in foil, locked ones as silhouettes with their progress. */
export default function Trophies({ shots, shooter }: { shots: TrophyShot[]; shooter: string }) {
  const list = useMemo(() => trophyStatus(shots), [shots])
  const got = list.filter((t) => t.unlocked).length
  return (
    <section className="trophies" aria-labelledby="trophies-title">
      <div className="trophies-head">
        <h3 id="trophies-title">Trophies</h3>
        <span className="count">
          {got} of {list.length} unlocked{shooter ? ` · ${shooter}` : ''}
        </span>
      </div>
      <ul>
        {list.map(({ trophy, done, target, unlocked }) => (
          <li key={trophy.id} className={unlocked ? 'trophy got' : 'trophy'}>
            <span className="trophy-medal" aria-hidden="true">
              {unlocked ? '★' : '🔒︎'}
            </span>
            <strong>{trophy.title}</strong>
            <span className="trophy-how">{trophy.how}</span>
            {unlocked ? (
              <span className="trophy-state">Unlocked</span>
            ) : (
              <span className="trophy-state">
                {done} / {target}
                <span className="trophy-bar" aria-hidden="true">
                  <i style={{ width: `${(done / target) * 100}%` }} />
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
