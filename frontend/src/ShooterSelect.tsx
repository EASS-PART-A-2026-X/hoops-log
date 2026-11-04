interface Props {
  /** Everyone who has shots in the log. */
  players: string[]
  /** The chosen shooter; '' means every player's shots together. */
  value: string
  onChange: (player: string) => void
}

/** Whose shots the map, the vs NBA tab and the Players tab use. One choice, shown on all three. */
export default function ShooterSelect({ players, value, onChange }: Props) {
  return (
    <label className="player-filter shooter">
      <span className="shooter-label">Shots of</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Every player</option>
        {players.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  )
}
