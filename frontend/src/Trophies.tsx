import type { TrophyStatus } from './game/achievements'

/** The trophy wall: unlocked ones in foil, locked ones as silhouettes with their progress. */
export default function Trophies({
  list,
  shooter,
  partial = false,
}: {
  list: TrophyStatus[]
  shooter: string
  /** The shot list was cut short, so the numbers cover only part of the log. */
  partial?: boolean
}) {
  const got = list.filter((t) => t.unlocked).length
  return (
    <section className="trophies" aria-labelledby="trophies-title">
      <p className="count trophies-count">
        {got} of {list.length} unlocked{shooter ? ` · ${shooter}` : ''}
      </p>
      {partial && <p className="trophies-note">Based on the first shots only: the log is longer than what is loaded.</p>}
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
