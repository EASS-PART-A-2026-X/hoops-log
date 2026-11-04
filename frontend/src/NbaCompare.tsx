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
    <section aria-labelledby="nba-title">
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

          <h3 className="nba-zones-title">By zone</h3>
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
                    You {z.mine === null ? '–' : `${z.mine}%`} · {z.made}/{z.attempts}
                    {z.attempts > 0 && z.attempts < SMALL_SAMPLE ? ' (small sample)' : ''}
                  </span>
                  <span>NBA {z.nba}%</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
