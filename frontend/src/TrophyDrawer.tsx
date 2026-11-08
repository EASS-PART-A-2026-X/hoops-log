import { useEffect, useRef } from 'react'
import { tabTarget } from './focusTrap'
import type { TrophyStatus } from './game/achievements'
import Trophies from './Trophies'

interface Props {
  open: boolean
  onClose: () => void
  list: TrophyStatus[]
  shooter: string
  partial: boolean
  /** The drawer covers the page (small screens): it is a dialog and Tab stays inside it. */
  narrow: boolean
  /** The button that opened it: focus goes back there when it closes. */
  toggleRef: React.RefObject<HTMLButtonElement | null>
}

/** The trophy wall, in a drawer from the right (the same drawer as the shot list), closed until asked for. */
export default function TrophyDrawer({ open, onClose, list, shooter, partial, narrow, toggleRef }: Props) {
  const drawerRef = useRef<HTMLElement>(null)
  const wasOpen = useRef(false)

  // Focus moves into the drawer when it opens and back to its button when it closes.
  useEffect(() => {
    if (open) drawerRef.current?.querySelector<HTMLElement>('button')?.focus()
    else if (wasOpen.current) toggleRef.current?.focus()
    wasOpen.current = open
  }, [open, toggleRef])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // This press is the drawer's: stop it here so the app's own Escape handling (close the shot list,
        // deselect a shot), which can be registered while this event is still travelling, never sees it.
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      const drawer = drawerRef.current
      if (!narrow || e.key !== 'Tab' || !drawer) return
      const items = [...drawer.querySelectorAll<HTMLElement>('button, a[href]')].filter((el) => !(el as HTMLButtonElement).disabled)
      const active = document.activeElement as HTMLElement | null
      const target = tabTarget(items, active, !!active && items.includes(active), e.shiftKey)
      if (target) {
        e.preventDefault()
        target.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, narrow, onClose])

  return (
    <>
      {open && <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />}
      <aside
        id="trophy-drawer"
        ref={drawerRef}
        className={open ? 'drawer open' : 'drawer'}
        role={narrow && open ? 'dialog' : undefined}
        aria-modal={narrow && open ? true : undefined}
        aria-labelledby="trophies-title"
        tabIndex={-1}
        inert={!open}
      >
        <div className="drawer-head">
          <h2 id="trophies-title" className="drawer-title">
            Trophies
          </h2>
          <button type="button" className="drawer-close" onClick={onClose}>
            <span aria-hidden="true">✕</span>
            <span className="sr-only">Close the trophies</span>
          </button>
        </div>
        <div className="drawer-body">
          <Trophies list={list} shooter={shooter} partial={partial} />
        </div>
      </aside>
    </>
  )
}
