import { useMemo } from 'react'
import FallbackImage from './FallbackImage'
import Picker from './Picker'
import type { PickerOption } from './Picker'
import { PLAYERS, TEAMS, headshotUrl, initials } from './court/players'

/** A small round headshot that falls back to initials. */
function Thumb({ id, name }: { id: number; name: string }) {
  return (
    <FallbackImage
      className="pp-thumb"
      fallbackClassName="pp-thumb-fallback"
      src={headshotUrl(id)}
      alt=""
      fallback={initials(name)}
    />
  )
}

interface Props {
  /** The chosen player's id, or null for the NBA average. */
  value: number | null
  onChange: (id: number | null) => void
}

/** Pick the NBA average or a player. A custom list, because a native dropdown cannot show photos. */
export default function PlayerPicker({ value, onChange }: Props) {
  const options = useMemo<PickerOption[]>(
    () => [
      {
        id: '',
        name: 'NBA average',
        sub: 'League-wide figures',
        buttonSub: 'Compare with',
        thumb: (
          <span className="pp-thumb pp-nba" aria-hidden="true">
            NBA
          </span>
        ),
      },
      ...PLAYERS.map((p) => ({
        id: String(p.id),
        name: p.name,
        sub: `${TEAMS[p.team].name} · ${p.position}`,
        thumb: <Thumb key={p.id} id={p.id} name={p.name} />,
      })),
    ],
    [],
  )
  return (
    <Picker
      options={options}
      value={value === null ? '' : String(value)}
      onChange={(id) => onChange(id === '' ? null : Number(id))}
      ariaLabel="Compare with"
    />
  )
}
