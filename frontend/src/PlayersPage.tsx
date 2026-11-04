import { useMemo, useState } from 'react'
import type { Shot } from './api'
import { MIN_SHOTS_FOR_MATCH, rankPlayers } from './court/nba'
import { PLAYERS, TEAMS, headshotUrl, initials, logoUrl } from './court/players'
import type { Player } from './court/players'

/** An image that falls back to a drawn badge if it cannot load, so no broken-image icon ever shows. */
function Img({ src, alt, fallback, className }: { src: string; alt: string; fallback: string; className: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className={`${className} img-fallback`} role="img" aria-label={alt}>
        {fallback}
      </span>
    )
  }
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}

function Card({ player, score, best, benchmark, onCompare }: { player: Player; score: number | null; best: boolean; benchmark: boolean; onCompare: (id: number) => void }) {
  const team = TEAMS[player.team]
  return (
    <li className={best ? 'player best' : 'player'} style={{ '--team': team.color } as React.CSSProperties}>
      <div className="player-photo">
        <Img
          className="player-img"
          src={headshotUrl(player.id)}
          alt={`Photo of ${player.name}`}
          fallback={initials(player.name)}
        />
        <Img
          className="player-logo"
          src={logoUrl(team.id)}
          alt={`${team.name} logo`}
          fallback={team.abbr}
        />
      </div>
      <div className="player-body">
        <h3>{player.name}</h3>
        <p className="player-meta">
          {team.name} · {player.position}
        </p>
        <dl className="player-stats">
          <div>
            <dt>FG</dt>
            <dd>{player.fg}%</dd>
          </div>
          <div>
            <dt>3P</dt>
            <dd>{player.three}%</dd>
          </div>
          <div>
            <dt>PPG</dt>
            <dd>{player.ppg}</dd>
          </div>
        </dl>
        <p className="player-style">{player.style}</p>
        <div className="player-foot">
          {score !== null && (
            <span className={best ? 'match best' : 'match'}>{best ? 'Closest to you · ' : ''}{score}% match</span>
          )}
          <button type="button" className="btn" onClick={() => onCompare(player.id)} aria-pressed={benchmark}>
            {benchmark ? 'Comparing' : 'Compare with me'}
            <span className="sr-only"> {player.name}</span>
          </button>
        </div>
      </div>
    </li>
  )
}

interface Props {
  shots: Shot[] | null
  benchmarkId: number | null
  onCompare: (id: number) => void
}

export default function PlayersPage({ shots, benchmarkId, onCompare }: Props) {
  const [team, setTeam] = useState('')
  const teamKeys = [...new Set(PLAYERS.map((p) => p.team))]
  const ranking = useMemo(() => rankPlayers(shots ?? []), [shots])
  const scoreOf = (id: number) => ranking?.find((m) => m.player.id === id)?.score ?? null
  const list = ranking ? ranking.map((m) => m.player) : PLAYERS
  const shown = team ? list.filter((p) => p.team === team) : list
  const top = ranking?.[0]

  return (
    <section aria-labelledby="players-title">
      <div className="map-head">
        <h2 id="players-title">NBA players</h2>
        <div className="chips" role="group" aria-label="Team">
          <button type="button" className="chip" aria-pressed={team === ''} onClick={() => setTeam('')}>
            All teams
          </button>
          {teamKeys.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={team === k} onClick={() => setTeam(k)}>
              {TEAMS[k].name}
            </button>
          ))}
        </div>
      </div>
      <p className="nba-note">
        Numbers are rounded figures from recent seasons, typed in by hand, so read them as about. Teams
        change, so a player may have moved. Photos and logos belong to the NBA and its teams.
      </p>
      <p className="nba-note match-note">
        {top ? (
          <>
            Sorted by how close each player's shooting is to your log: field goal %, three-point % and how
            often you shoot threes. You shoot most like <strong>{top.player.name}</strong> ({top.score}%).
          </>
        ) : (
          <>Log at least {MIN_SHOTS_FOR_MATCH} shots and the players are sorted by how close they are to you.</>
        )}
      </p>
      <ul className="players">
        {shown.map((p) => (
          <Card key={p.id} player={p} score={scoreOf(p.id)} best={top?.player.id === p.id} benchmark={benchmarkId === p.id} onCompare={onCompare} />
        ))}
      </ul>
    </section>
  )
}
