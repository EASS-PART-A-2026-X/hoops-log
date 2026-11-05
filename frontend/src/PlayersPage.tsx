import { useMemo, useState } from 'react'
import type { Shot } from './api'
import { MIN_SHOTS_FOR_MATCH, compareOverall, rankPlayers } from './court/nba'
import { PLAYERS, TEAMS, headshotUrl, initials, logoUrl } from './court/players'
import type { Player } from './court/players'
import { shooterProfile } from './court/cardData'
import CardDialog from './CardDialog'
import FallbackImage from './FallbackImage'
import ShotCard from './ShotCard'

interface Mine {
  fg: number | null
  three: number | null
}

/** "You 44%" under a player's number, with how far apart you are. */
function Yours({ mine, theirs }: { mine: number | null | undefined; theirs: number }) {
  if (mine === null || mine === undefined) return <span className="you">You –</span>
  const diff = mine - theirs
  const cls = diff > 0 ? 'you up' : diff < 0 ? 'you down' : 'you'
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '='
  return (
    <span className={cls}>
      You {mine}% <span aria-hidden="true">{arrow}</span>
      <span className="sr-only">{diff > 0 ? ', above them' : diff < 0 ? ', below them' : ', the same'}</span>
    </span>
  )
}

function Card({
  player,
  score,
  best,
  benchmark,
  mine,
  onCompare,
}: {
  player: Player
  score: number | null
  best: boolean
  benchmark: boolean
  mine: Mine | null
  onCompare: (id: number) => void
}) {
  const team = TEAMS[player.team]
  return (
    <li className={best ? 'player best' : 'player'} style={{ '--team': team.color } as React.CSSProperties}>
      <div className="player-photo">
        <FallbackImage
          className="player-img"
          fallbackClassName="img-fallback"
          src={headshotUrl(player.id)}
          alt={`Photo of ${player.name}`}
          fallback={initials(player.name)}
        />
        {score !== null && (
          <div className={best ? 'match-badge best' : 'match-badge'}>
            <strong>{score}%</strong>
            <span>{best ? 'closest to you' : 'like you'}</span>
          </div>
        )}
        <FallbackImage
          className="player-logo"
          fallbackClassName="img-fallback"
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
            {mine && <Yours mine={mine.fg} theirs={player.fg} />}
          </div>
          <div>
            <dt>3P</dt>
            <dd>{player.three}%</dd>
            {mine && <Yours mine={mine.three} theirs={player.three} />}
          </div>
          <div>
            <dt>PPG</dt>
            <dd>{player.ppg}</dd>
          </div>
        </dl>
        <p className="player-style">{player.style}</p>
        <div className="player-foot">
          <button type="button" className="btn" onClick={() => onCompare(player.id)} aria-pressed={benchmark}>
            {benchmark ? 'Comparing now' : 'Compare my shots'}
            <span className="sr-only"> with {player.name}</span>
          </button>
        </div>
      </div>
    </li>
  )
}

interface Props {
  shots: Shot[] | null
  /** Whose shots these are ('' = every player's). */
  shooter: string
  shooterPicker: React.ReactNode
  benchmarkId: number | null
  onCompare: (id: number) => void
}

export default function PlayersPage({ shots, shooter, shooterPicker, benchmarkId, onCompare }: Props) {
  const [team, setTeam] = useState('')
  const [cardOpen, setCardOpen] = useState(false)
  const teamKeys = [...new Set(PLAYERS.map((p) => p.team))]
  const ranking = useMemo(() => rankPlayers(shots ?? []), [shots])
  const scoreOf = (id: number) => ranking?.find((m) => m.player.id === id)?.score ?? null
  const list = ranking ? ranking.map((m) => m.player) : PLAYERS
  const shown = team ? list.filter((p) => p.team === team) : list
  const top = ranking?.[0]
  const whose = shooter ? `${shooter}'s` : "the whole log's"
  // Your card: the chosen shooter's shots, as a trading card.
  const myCard = useMemo(() => (shots && shots.length > 0 ? shooterProfile(shooter, shots) : null), [shots, shooter])
  const mine = useMemo<Mine | null>(() => {
    if (!shots || shots.length === 0) return null
    const [fg, three] = compareOverall(shots)
    return { fg: fg.mine, three: three.mine }
  }, [shots])

  return (
    <section aria-labelledby="players-title">
      <div className="map-head">
        <h2 id="players-title">NBA players</h2>
        <div className="filters">
          {shooterPicker}
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
      </div>
      <p className="nba-note">
        Numbers are rounded figures from recent seasons, typed in by hand, so read them as about. Teams
        change, so a player may have moved. Photos and logos belong to the NBA and its teams.
      </p>
      <p className="nba-note match-note">
        {top ? (
          <>
            The big number on each photo is how alike {whose} shooting is, from 0 to 100%. Under each stat,
            "You" is {whose} number from the log: ▲ means better than the player, ▼ means the player is better.{' '}
            {shooter || 'The whole log'} shoots most like <strong>{top.player.name}</strong> ({top.score}%). Press "Compare my shots" to colour the heat map
            and the vs NBA tab against that player.
          </>
        ) : (
          <>Log at least {MIN_SHOTS_FOR_MATCH} shots and the players are sorted by how close they are to {shooter || 'the whole log'}.</>
        )}
      </p>
      <ul className="players">
        {myCard && (
          <li className="player-you" onClick={() => setCardOpen(true)}>
            <ShotCard profile={myCard} size="tile" />
            <button type="button" className="card-open" onClick={(e) => { e.stopPropagation(); setCardOpen(true) }}>
              <span className="sr-only">Open {myCard.name}'s shot card at full size</span>
            </button>
          </li>
        )}
        {shown.map((p) => (
          <Card key={p.id} player={p} score={scoreOf(p.id)} best={top?.player.id === p.id} benchmark={benchmarkId === p.id} mine={mine} onCompare={onCompare} />
        ))}
      </ul>
      {cardOpen && myCard && <CardDialog profile={myCard} onClose={() => setCardOpen(false)} />}
    </section>
  )
}
