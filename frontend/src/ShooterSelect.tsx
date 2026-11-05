import { useMemo } from 'react'
import Picker from './Picker'
import type { PickerOption } from './Picker'
import { listShooters } from './shooter'
import { initials } from './court/players'

interface Props {
  /** The shots of the whole log: the list of players and their shot counts come from it. */
  shots: { player: string }[] | null
  /** The chosen shooter; '' means every player's shots together. */
  value: string
  onChange: (player: string) => void
}

const shotsLabel = (n: number) => `${n} ${n === 1 ? 'shot' : 'shots'}`

/** Whose shots the map, the vs NBA tab and the Players tab use. One choice, shown on all three. */
export default function ShooterSelect({ shots, value, onChange }: Props) {
  const options = useMemo<PickerOption[]>(() => {
    const counts = new Map<string, number>()
    for (const s of shots ?? []) counts.set(s.player, (counts.get(s.player) ?? 0) + 1)
    return [
      {
        id: '',
        name: 'Every player',
        sub: shotsLabel(shots?.length ?? 0),
        thumb: (
          <span className="pp-thumb pp-nba" aria-hidden="true">
            All
          </span>
        ),
      },
      ...listShooters(shots).map((name) => ({
        id: name,
        name,
        sub: shotsLabel(counts.get(name) ?? 0),
        thumb: (
          <span className="pp-thumb pp-me" aria-hidden="true">
            {initials(name)}
          </span>
        ),
      })),
    ]
  }, [shots])
  return <Picker options={options} value={value} onChange={onChange} ariaLabel="Shots of" prefix="Shots of" />
}
