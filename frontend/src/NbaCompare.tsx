import { useMemo } from 'react'
import type { Shot } from './api'
import { LEAGUE, SMALL_SAMPLE, benchmarkOf, compareOverall, compareZones } from './court/nba'
import { PLAYERS } from './court/players'
import PlayerPicker from './PlayerPicker'

function Diff({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="nba-diff">–</span>
  const sign = diff > 0 ? '+' : ''
  const cls = diff > 0 ? 'nba-diff up' : diff < 0 ? 'nba-diff down' : 'nba-diff'
  return <span className={cls}>{`${sign}${diff} pts`}</span>
}

interface Props {
  shots: Shot[] | null
  benchmarkId: number | null
  onBenchmark: (id: number | null) => void
  onBrowse: () => void
}

export default function NbaCompare({ shots, benchmarkId, onBenchmark, onBrowse }: Props) {
  const player = PLAYERS.find((p) => p.id === benchmarkId) ?? null
  const bench = useMemo(() => (player ? benchmarkOf(player) : LEAGUE), [player])
  const overall = useMemo(() => compareOverall(shots ?? [], bench), [shots, bench])
  const who = player ? player.name.split(' ').slice(-1)[0] : 'NBA average'
  const zones = useMemo(() => compareZones(shots ?? [], bench), [shots, bench])

  return (
    <section aria-labelledby="nba-title">
      <div className="map-head">
        <h2 id="nba-title">You vs {player ? player.name : 'the NBA'}</h2>
        <div className="filters">
          <PlayerPicker value={benchmarkId} onChange={onBenchmark} />
          <button type="button" className="chip" onClick={onBrowse}>
            Browse players
          </button>
        </div>
      </div>
      <p className="nba-note">
        {player ? `${player.name}'s` : 'NBA'} numbers are rounded figures from recent seasons, so read them as
        about. {player && 'The zone tiles below are estimates: the league zone numbers scaled by how he shoots overall. '}Zones with fewer than{' '}
        {SMALL_SAMPLE} shots are a small sample.
      </p>

      {!shots ? (
        <p className="state">Loading shots…</p>
      ) : shots.length === 0 ? (
        <p className="state">No shots yet. Log some on the My log tab and they show up here.</p>
      ) : (
        <>
          <div className="nba-vs">
            {overall.map((o) => {
              const diff = o.mine === null ? null : Math.round((o.mine - o.nba) * 10) / 10
              return (
                <div className="vs-card" key={o.label}>
                  <span className="kpi-label">{o.label.toUpperCase()}</span>
                  <div className="vs-row">
                    <div className="vs-side mine">
                      <span className="vs-num">{o.mine === null ? '–' : `${o.mine}%`}</span>
                      <span className="vs-who">You</span>
                    </div>
                    <span className="vs-mid" aria-hidden="true">
                      vs
                    </span>
                    <div className="vs-side">
                      <span className="vs-num">{o.nba}%</span>
                      <span className="vs-who">{who}</span>
                    </div>
                  </div>
                  <span className="vs-foot">
                    {diff === null
                      ? 'No shots of this kind yet'
                      : diff === 0
                        ? 'Exactly level'
                        : `You are ${Math.abs(diff)} points ${diff > 0 ? 'above' : 'below'}`}
                    {' · '}
                    {o.attempts} {o.attempts === 1 ? 'shot' : 'shots'}
                  </span>
                </div>
              )
            })}
          </div>

          <h3 className="nba-zones-title">{player ? `By zone (estimated for ${who})` : 'By zone (vs league average)'}</h3>
          <ul className="nba-zones">
            {zones.map((z) => (
              <li key={z.zone} className={z.attempts === 0 ? 'nba-zone empty' : 'nba-zone'}>
                <div className="nba-zone-head">
                  <span className="nba-zone-name">{z.label}</span>
                  <Diff diff={z.diff} />
                </div>
                <div className="nba-track" aria-hidden="true">
                  <span className="nba-fill" style={{ width: `${z.mine ?? 0}%` }} />
                  <span className="nba-tick" style={{ left: `${z.nba}%` }} />
                </div>
                <div className="nba-zone-foot">
                  <span>
                    You <strong>{z.mine === null ? '–' : `${z.mine}%`}</strong> · {z.made}/{z.attempts}
                    {z.attempts > 0 && z.attempts < SMALL_SAMPLE ? ' (small sample)' : ''}
                  </span>
                  <span>
                    {who} <strong>{z.nba}%</strong>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
