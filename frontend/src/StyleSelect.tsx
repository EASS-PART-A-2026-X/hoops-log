import { useMemo } from 'react'
import type { MapMode } from './court/CourtScene'
import Picker from './Picker'
import type { PickerOption } from './Picker'

const MODES: { id: MapMode; name: string; sub: string; glyph: string }[] = [
  { id: 'heat', name: 'Heat map', sub: 'Hotter and colder spots', glyph: '▦' },
  { id: 'beams', name: '3D beams', sub: 'A beam for every shot', glyph: '▮' },
  { id: 'arcs', name: 'Flight paths', sub: 'The ball\'s way to the rim', glyph: '⤴' },
]

/** The map style, as a dropdown next to the replay buttons. It opens upward: it sits at the bottom of the court. */
export default function StyleSelect({ value, onChange }: { value: MapMode; onChange: (mode: MapMode) => void }) {
  const options = useMemo<PickerOption[]>(
    () =>
      MODES.map((m) => ({
        id: m.id,
        name: m.name,
        sub: m.sub,
        buttonSub: 'Map style',
        thumb: (
          <span className="pp-thumb pp-mode" aria-hidden="true">
            {m.glyph}
          </span>
        ),
      })),
    [],
  )
  return (
    <Picker
      options={options}
      value={value}
      onChange={(id) => onChange(id as MapMode)}
      ariaLabel="Map style"
      prefix="Map style"
      showPrefix={false}
      up
    />
  )
}
