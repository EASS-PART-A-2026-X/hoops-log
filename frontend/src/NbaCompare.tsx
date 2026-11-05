import { useCallback, useMemo, useState } from 'react'
import type { Shot } from './api'
import FallbackImage from './FallbackImage'
import { LEAGUE, SMALL_SAMPLE, benchmarkOf, compareOverall, compareZones } from './court/nba'
import type { ZoneCompare } from './court/nba'
import { PLAYERS, TEAMS, headshotUrl, initials, lastName } from './court/players'
import { describeTally, gapPts, judge, sideOf, tally } from './court/verdict'
import type { Side } from './court/verdict'
import { playerProfile, shooterProfile } from './court/cardData'
import FaceOff from './FaceOff'
import PlayerPicker from './PlayerPicker'

interface Props {
  shots: Shot[] | null
  /** Whose shots these are ('' = every player's). */
  shooter: string
  shooterPicker: React.ReactNode
  benchmarkId: number | null
  onBenchmark: (id: number | null) => void
  onBrowse: () => void
  /** Pairs the face-off has already played for this session ("shooter|player id"), kept above this page so it does not replay each visit. */
  faceOffSeen: string[]
  onFaceOffSeen: (key: string) => void
}

const fmt = (v: number | null) => (v === null ? '–' : `${v}%`)

/** Who leads in a zone; null below the minimum number of shots (see `judge`). */
const zoneSideOf = (z: ZoneCompare): Side | null => judge(z.mine, z.nba, z.attempts)

/** Who is ahead, as a coloured pill: orange for the shooter, blue for the other side. */
function Lead({ side, mineName, theirName, mine, theirs }: { side: Side | null; mineName: string; theirName: string; mine: number | null; theirs: number }) {
  if (side === null || mine === null) return <span className="win-chip none">No shots</span>
  if (side === 'tie') return <span className="win-chip tie">Level</span>
  const gap = gapPts(mine, theirs)
  return side === 'you' ? (
    <span className="win-chip you">
      <span aria-hidden="true">▲ </span>
      {mineName} +{gap}
    </span>
  ) : (
    <span className="win-chip them">
      <span aria-hidden="true">▼ </span>
      {theirName} +{gap}
    </span>
  )
}

/** Two bars on the same 0-100% scale, one per side, the leading one bold. */
function Bars({ mineName, theirName, mine, theirs, side }: { mineName: string; theirName: string; mine: number | null; theirs: number; side: Side | null }) {
  return (
    <div className="vs-bars">
      <div className={side === 'you' ? 'vs-bar-row you lead' : 'vs-bar-row you'}>
        <span className="vs-bar-name">{mineName}</span>
        <span className="vs-track" aria-hidden="true">
          <span style={{ width: `${mine ?? 0}%` }} />
        </span>
        <strong>{fmt(mine)}</strong>
      </div>
      <div className={side === 'them' ? 'vs-bar-row them lead' : 'vs-bar-row them'}>
        <span className="vs-bar-name">{theirName}</span>
        <span className="vs-track" aria-hidden="true">
          <span style={{ width: `${theirs}%` }} />
        </span>
        <strong>{fmt(theirs)}</strong>
      </div>
    </div>
  )
}

export default function NbaCompare({ shots, shooter, shooterPicker, benchmarkId, onBenchmark, onBrowse, faceOffSeen, onFaceOffSeen }: Props) {
  const player = PLAYERS.find((p) => p.id === benchmarkId) ?? null
  const bench = useMemo(() => (player ? benchmarkOf(player) : LEAGUE), [player])
  const overall = useMemo(() => compareOverall(shots ?? [], bench), [shots, bench])
  const zones = useMemo(() => compareZones(shots ?? [], bench), [shots, bench])
  const mineName = shooter || 'Everyone'
  // The face-off plays by itself the first time a pair is compared (unless the person asked for less
  // motion), and any time from its button.
  const [manualFaceOff, setManualFaceOff] = useState(false)
  const pairKey = player && shots && shots.length > 0 ? `${shooter}|${player.id}` : null
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const faceOffOpen = pairKey !== null && (manualFaceOff || (!reducedMotion && !faceOffSeen.includes(pairKey)))
  const closeFaceOff = useCallback(() => {
    setManualFaceOff(false)
    if (pairKey) onFaceOffSeen(pairKey)
  }, [pairKey, onFaceOffSeen])
  const theirName = player ? player.name : 'NBA average'
  const theirShort = player ? lastName(player.name) : 'NBA'

  const [fg, three, share] = overall
  const score = useMemo(() => {
    const areas = [fg, three].map((o) => (o ? judge(o.mine, o.nba, o.attempts) : null))
    return tally([...areas, ...zones.map(zoneSideOf)])
  }, [fg, three, zones])

  return (
    <section aria-labelledby="nba-title">
      <div className="map-head">
        <h2 id="nba-title">
          {mineName} vs {theirName}
        </h2>
        <div className="filters">
          {shooterPicker}
          <PlayerPicker value={benchmarkId} onChange={onBenchmark} />
          <button type="button" className="chip" onClick={onBrowse}>
            Browse players
          </button>
          {player && pairKey && (
            <button type="button" className="chip" onClick={() => setManualFaceOff(true)}>
              Face-off
            </button>
          )}
        </div>
      </div>

      {faceOffOpen && player && shots && (
        <FaceOff you={shooterProfile(shooter, shots)} them={playerProfile(player)} verdict={describeTally(mineName, theirName, score)} onClose={closeFaceOff} />
      )}

      {!shots ? (
        <p className="state">Loading shots…</p>
      ) : shots.length === 0 ? (
        <p className="state">{shooter ? `No shots for ${shooter} yet.` : 'No shots yet.'} Log some on the My log tab and they show up here.</p>
      ) : (
        <>
          <div className="vs-head">
            <div className="vs-id you">
              <span className="vs-avatar you" aria-hidden="true">
                {initials(mineName)}
              </span>
              <span className="vs-id-text">
                <strong>{mineName}</strong>
                <small>
                  {shots.length} {shots.length === 1 ? 'shot' : 'shots'} · orange
                </small>
              </span>
            </div>
            <div className="vs-score" role="img" aria-label={`Areas led: ${mineName} ${score.you}, ${theirName} ${score.them}`}>
              <span className="vs-score-num you">{score.you}</span>
              <span className="vs-score-dash" aria-hidden="true">
                –
              </span>
              <span className="vs-score-num them">{score.them}</span>
              <small>areas led</small>
            </div>
            <div className="vs-id them">
              <span className="vs-id-text right">
                <strong>{theirName}</strong>
                <small>{player ? `${TEAMS[player.team].name} · ${player.position} · blue` : 'League-wide · blue'}</small>
              </span>
              {player ? (
                <FallbackImage
                  className="vs-avatar them"
                  fallbackClassName="vs-avatar-fallback"
                  src={headshotUrl(player.id)}
                  alt=""
                  fallback={initials(player.name)}
                />
              ) : (
                <span className="vs-avatar them" aria-hidden="true">
                  NBA
                </span>
              )}
            </div>
          </div>
          <p className="vs-verdict">{describeTally(mineName, theirName, score)}</p>
          <p className="nba-note">
            Orange is {mineName}, blue is {theirName}; the pill says who leads and by how many points. {player ? `${player.name}'s numbers are` : 'NBA numbers are'} rounded figures from recent seasons.
            {player && ' Zone numbers for a player are estimates: the league zone figures scaled by how he shoots overall.'} Counted: field goal, three point and each zone, when at least {SMALL_SAMPLE} shots; these areas overlap, a zone's shots are also in the field goal.
          </p>

          <div className="nba-vs">
            {[fg, three].map((o) =>
              o ? (
                <div className="vs-card" key={o.label}>
                  <div className="vs-card-head">
                    <span className="kpi-label">{o.label.toUpperCase()}</span>
                    <Lead side={judge(o.mine, o.nba, o.attempts)} mineName={mineName} theirName={theirShort} mine={o.mine} theirs={o.nba} />
                  </div>
                  <Bars mineName={mineName} theirName={theirShort} mine={o.mine} theirs={o.nba} side={judge(o.mine, o.nba, o.attempts)} />
                  <span className="vs-foot">{o.attempts} {o.attempts === 1 ? 'shot' : 'shots'} taken</span>
                </div>
              ) : null,
            )}
            {share && (
              <div className="vs-card">
                <div className="vs-card-head">
                  <span className="kpi-label">SHARE OF THREES</span>
                  <span className="win-chip tie">
                    {share.mine === null
                      ? 'No shots'
                      : sideOf(share.mine, share.nba) === 'tie'
                        ? 'Same style'
                        : share.mine > share.nba
                          ? `More threes than ${theirShort}`
                          : `Fewer threes than ${theirShort}`}
                  </span>
                </div>
                <Bars mineName={mineName} theirName={theirShort} mine={share.mine} theirs={share.nba} side={null} />
                <span className="vs-foot">Style, not skill: how often each side shoots a three. Nobody wins this one.</span>
              </div>
            )}
          </div>

          <h3 className="nba-zones-title">{player ? `By zone (estimated for ${theirShort})` : 'By zone (vs league average)'}</h3>
          <ul className="nba-zones">
            {zones.map((z) => {
              const side = zoneSideOf(z)
              return (
                <li key={z.zone} className={z.attempts === 0 ? 'nba-zone empty' : 'nba-zone'}>
                  <div className="nba-zone-head">
                    <span className="nba-zone-name">{z.label}</span>
                    {z.attempts === 0 ? (
                      <span className="win-chip none">No shots</span>
                    ) : z.attempts < SMALL_SAMPLE ? (
                      <span className="win-chip none">Small sample</span>
                    ) : (
                      <Lead side={side} mineName={mineName} theirName={theirShort} mine={z.mine} theirs={z.nba} />
                    )}
                  </div>
                  <Bars mineName={mineName} theirName={theirShort} mine={z.mine} theirs={z.nba} side={side} />
                  <span className="vs-foot">
                    {z.made}/{z.attempts} made
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
