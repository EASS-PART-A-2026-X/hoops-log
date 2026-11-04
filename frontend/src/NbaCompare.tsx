import { useMemo } from 'react'
import type { Shot } from './api'
import { SMALL_SAMPLE, compareOverall, compareZones } from './court/nba'

function Diff({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="nba-diff">–</span>
  const sign = diff > 0 ? '+' : ''
  const cls = diff > 0 ? 'nba-diff up' : diff < 0 ? 'nba-diff down' : 'nba-diff'
  return <span className={cls}>{`${sign}${diff} pts`}</span>
}

export default function NbaCompare({ shots }: { shots: Shot[] | null }) {
  const overall = useMemo(() => compareOverall(shots ?? []), [shots])
  const zones = useMemo(() => compareZones(shots ?? []), [shots])

  return (
    <section className="nba" aria-labelledby="nba-title">
      <div className="map-head">
        <h2 id="nba-title">You vs the NBA</h2>
      </div>
      <p className="nba-note">
        NBA numbers are rounded league averages from recent seasons, so read them as about. Zones with
        fewer than {SMALL_SAMPLE} shots are a small sample.
      </p>

      {!shots ? (
        <p className="state">Loading shots…</p>
      ) : shots.length === 0 ? (
        <p className="state">No shots yet. Log some on the My log tab and they show up here.</p>
      ) : (
        <>
          <div className="kpis nba-kpis">
            {overall.map((o) => (
              <div className="kpi" key={o.label}>
                <span className="kpi-label">{o.label.toUpperCase()}</span>
                <span className="kpi-value">{o.mine === null ? '–' : `${o.mine}%`}</span>
                <span className="kpi-sub">
                  NBA about {o.nba}% · {o.attempts} {o.attempts === 1 ? 'shot' : 'shots'}
                </span>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 className="nba-sub">By zone</h3>
            <table className="nba-table">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">Your shots</th>
                  <th scope="col">You</th>
                  <th scope="col">NBA</th>
                  <th scope="col">Difference</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.zone} className={z.attempts === 0 ? 'empty' : undefined}>
                    <th scope="row">{z.label}</th>
                    <td>
                      {z.made}/{z.attempts}
                      {z.attempts > 0 && z.attempts < SMALL_SAMPLE && (
                        <span className="nba-small"> small sample</span>
                      )}
                    </td>
                    <td>
                      <span className="nba-bars" aria-hidden="true">
                        <span className="nba-bar mine" style={{ width: `${z.mine ?? 0}%` }} />
                        <span className="nba-bar nba" style={{ width: `${z.nba}%` }} />
                      </span>
                      {z.mine === null ? '–' : `${z.mine}%`}
                    </td>
                    <td>{z.nba}%</td>
                    <td>
                      <Diff diff={z.diff} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
