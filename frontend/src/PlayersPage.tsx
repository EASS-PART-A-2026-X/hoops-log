import { useState } from 'react'
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

function Card({ player }: { player: Player }) {
  const team = TEAMS[player.team]
  return (
    <li className="player" style={{ '--team': team.color } as React.CSSProperties}>
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
      </div>
    </li>
  )
}

export default function PlayersPage() {
  const [team, setTeam] = useState('')
  const teamKeys = [...new Set(PLAYERS.map((p) => p.team))]
  const shown = team ? PLAYERS.filter((p) => p.team === team) : PLAYERS

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
      <ul className="players">
        {shown.map((p) => (
          <Card key={p.id} player={p} />
        ))}
      </ul>
    </section>
  )
}
