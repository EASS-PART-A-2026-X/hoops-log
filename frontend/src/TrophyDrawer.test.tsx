// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TrophyDrawer from './TrophyDrawer'
import { trophyStatus } from './game/achievements'

afterEach(cleanup)

const shot = { id: 1, game_date: '2026-11-01', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 8 }

function Harness({ narrow = false, partial = false }: { narrow?: boolean; partial?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={ref} onClick={() => setOpen((o) => !o)}>
        Trophies toggle
      </button>
      <button>other page button</button>
      <TrophyDrawer open={open} onClose={() => setOpen(false)} list={trophyStatus([shot])} shooter="Ann" partial={partial} narrow={narrow} toggleRef={ref} />
    </>
  )
}

const drawer = () => document.querySelector('#trophy-drawer') as HTMLElement

describe('TrophyDrawer', () => {
  it('is closed and out of reach until asked for', () => {
    render(<Harness />)
    expect(drawer().className).toBe('drawer')
    expect(drawer().hasAttribute('inert')).toBe(true)
  })

  it('opens with the trophy wall, a heading and focus on its close button', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Trophies toggle'))
    expect(drawer().className).toBe('drawer open')
    expect(drawer().hasAttribute('inert')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Trophies' })).toBeTruthy()
    expect(drawer().textContent).toContain('1 of 12 unlocked · Ann')
    expect(drawer().querySelectorAll('.trophy.got')).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close the trophies' }))
  })

  it('Escape and the close button close it and give focus back to the button that opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const toggle = screen.getByText('Trophies toggle')
    await user.click(toggle)
    await user.keyboard('{Escape}')
    expect(drawer().className).toBe('drawer')
    expect(document.activeElement).toBe(toggle)
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Close the trophies' }))
    expect(drawer().className).toBe('drawer')
    expect(document.activeElement).toBe(toggle)
  })

  it('Escape stops at the drawer: a listener further up (the window) never sees it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Trophies toggle'))
    const up = vi.fn()
    window.addEventListener('keydown', up)
    await user.keyboard('{Escape}')
    window.removeEventListener('keydown', up)
    expect(drawer().className).toBe('drawer')
    expect(up).not.toHaveBeenCalled()
  })

  it('a click on the dimmed page behind it (small screens) closes it', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)
    await user.click(screen.getByText('Trophies toggle'))
    await user.click(container.querySelector('.drawer-scrim')!)
    expect(drawer().className).toBe('drawer')
  })

  it('on a narrow screen it is a modal dialog and Tab stays inside it', async () => {
    const user = userEvent.setup()
    render(<Harness narrow />)
    await user.click(screen.getByText('Trophies toggle'))
    expect(drawer().getAttribute('role')).toBe('dialog')
    expect(drawer().getAttribute('aria-modal')).toBe('true')
    const close = screen.getByRole('button', { name: 'Close the trophies' })
    expect(document.activeElement).toBe(close)
    // The close button is the drawer's only control, so Tab and Shift+Tab must both land on it again,
    // never on the page button behind the drawer.
    await user.tab()
    expect(document.activeElement).toBe(close)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(close)
    expect(document.activeElement).not.toBe(screen.getByText('other page button'))
  })

  it('on a wide screen Tab is not trapped: it can leave the drawer', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Trophies toggle'))
    await user.tab({ shift: true })
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Close the trophies' }))
  })

  it('on a wide screen it is a side panel, not a dialog', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Trophies toggle'))
    expect(drawer().getAttribute('role')).toBeNull()
  })

  it('says when the numbers cover only part of the log', async () => {
    const user = userEvent.setup()
    render(<Harness partial />)
    await user.click(screen.getByText('Trophies toggle'))
    expect(drawer().querySelector('.trophies-note')).not.toBeNull()
  })
})
