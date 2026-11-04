import { useEffect, useId, useRef, useState } from 'react'
import FallbackImage from './FallbackImage'
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
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0) // 0 is "NBA average", then the players
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const current = PLAYERS.find((p) => p.id === value) ?? null
  const options = [null, ...PLAYERS]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function show() {
    setActive(Math.max(0, options.findIndex((p) => (p?.id ?? null) === value)))
    setOpen(true)
  }
  function choose(index: number) {
    onChange(options[index]?.id ?? null)
    setOpen(false)
    root.current?.querySelector('button')?.focus()
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
    }
  }

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  return (
    <div
      className="pp"
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Tab (or anything else) moved focus out of the picker: close the list.
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="pp-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {current ? <Thumb key={current.id} id={current.id} name={current.name} /> : <span className="pp-thumb pp-nba" aria-hidden="true">NBA</span>}
        <span className="pp-label">
          <span className="pp-name">{current ? current.name : 'NBA average'}</span>
          <span className="pp-sub">{current ? TEAMS[current.team].name : 'Compare with'}</span>
        </span>
        <span className="pp-chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className="pp-list" role="listbox" id={listId} aria-label="Compare with"
          // Keep focus on the button while clicking or dragging the list, so the blur above does not close it first.
          onMouseDown={(e) => e.preventDefault()}>
          {options.map((p, i) => (
            <li
              key={p?.id ?? 'nba'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={(p?.id ?? null) === value}
              className={i === active ? 'pp-option active' : 'pp-option'}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {p ? <Thumb key={p.id} id={p.id} name={p.name} /> : <span className="pp-thumb pp-nba" aria-hidden="true">NBA</span>}
              <span className="pp-label">
                <span className="pp-name">{p ? p.name : 'NBA average'}</span>
                <span className="pp-sub">{p ? `${TEAMS[p.team].name} · ${p.position}` : 'League-wide figures'}</span>
              </span>
              {(p?.id ?? null) === value && (
                <span className="pp-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
