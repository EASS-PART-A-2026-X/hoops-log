import { useEffect, useId, useRef, useState } from 'react'

export interface PickerOption {
  /** Unique within the picker. The empty string is fine (used for "nothing chosen"). */
  id: string
  name: string
  /** Second line under the name, in the list. */
  sub: string
  /** Second line on the closed button, when it differs from `sub` (e.g. "Compare with"). */
  buttonSub?: string
  /** The round picture or badge on the left. */
  thumb: React.ReactNode
}

interface Props {
  options: PickerOption[]
  /** The chosen option's id; an unknown id shows the first option. */
  value: string
  onChange: (id: string) => void
  /** Names the list for screen readers, e.g. "Compare with". */
  ariaLabel: string
  /** A small label before the button, e.g. "Shots of". */
  prefix?: string
}

/**
 * A custom dropdown: the browser's own list cannot show pictures or a second line, and looked bad.
 * Keyboard: ArrowUp/ArrowDown open and move, Enter picks, Escape closes, Tab closes and moves on.
 */
export default function Picker({ options, value, onChange, ariaLabel, prefix }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const current = options.find((o) => o.id === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function show() {
    setActive(Math.max(0, options.findIndex((o) => o.id === value)))
    setOpen(true)
  }
  function choose(index: number) {
    const option = options[index]
    if (option) onChange(option.id)
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

  if (!current) return null
  return (
    <div className="pp-wrap">
      {prefix && <span className="pp-prefix">{prefix}</span>}
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
          aria-label={prefix ? `${prefix}: ${current.name}` : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onClick={() => (open ? setOpen(false) : show())}
        >
          {current.thumb}
          <span className="pp-label">
            <span className="pp-name">{current.name}</span>
            <span className="pp-sub">{current.buttonSub ?? current.sub}</span>
          </span>
          <span className="pp-chev" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && (
          <ul
            className="pp-list"
            role="listbox"
            id={listId}
            aria-label={ariaLabel}
            tabIndex={-1}
            // tabIndex -1: a scrolling list is otherwise a Tab stop, and Tab from the button would land on it, still inside the picker.
            // Keep focus on the button while clicking or dragging the list, so the blur above does not close it first.
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.id === current.id}
                className={i === active ? 'pp-option active' : 'pp-option'}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {o.thumb}
                <span className="pp-label">
                  <span className="pp-name">{o.name}</span>
                  <span className="pp-sub">{o.sub}</span>
                </span>
                {o.id === current.id && (
                  <span className="pp-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
