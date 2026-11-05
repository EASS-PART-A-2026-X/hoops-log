// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { playerProfile, shooterProfile } from './court/cardData'
import { PLAYERS } from './court/players'
import CardDialog from './CardDialog'
import FaceOff from './FaceOff'
import ShotCard from './ShotCard'

afterEach(cleanup)

type S = { zone: string; made: boolean; shot_type: '2PT' | '3PT' }
const shots = (n: number, made = true): S[] => Array.from({ length: n }, (_, i) => ({ zone: 'restricted_area', made: made && i % 2 === 0, shot_type: '2PT' }))
const curry = PLAYERS.find((p) => p.name === 'Stephen Curry')!

describe('ShotCard', () => {
  it('shows the rating, play style, name and the three numbers of a shooter', () => {
    render(<ShotCard profile={shooterProfile('Yuly', shots(12))} />)
    expect(screen.getByText('Yuly')).toBeTruthy()
    expect(screen.getByText('Rim finisher')).toBeTruthy()
    expect(screen.getByLabelText(/Shooting rating \d+/)).toBeTruthy()
    expect(screen.getByText('Field goal')).toBeTruthy()
    expect(screen.getByText('12 shots')).toBeTruthy()
  })

  it('says a rating needs ten shots instead of inventing one', () => {
    render(<ShotCard profile={shooterProfile('Yuly', shots(4))} />)
    expect(screen.getByLabelText('No rating yet')).toBeTruthy()
    expect(screen.getByText('Needs 10 shots')).toBeTruthy()
    expect(screen.getByText('Rookie')).toBeTruthy()
  })

  it('describes the radar in words, and marks an NBA player zone shape as an estimate', () => {
    render(<ShotCard profile={playerProfile(curry)} />)
    const radar = screen.getByRole('img', { name: /^Shooting by area: Rim .*\(estimated\)$/ })
    expect(radar.getAttribute('aria-label')).toContain('Top 3')
    expect(screen.getByText('Zone shape estimated from league figures')).toBeTruthy()
    expect(screen.getByText('Warriors · Guard')).toBeTruthy()
  })

  it('writes "no data" for an area with too few shots', () => {
    render(<ShotCard profile={shooterProfile('Yuly', shots(12))} />)
    expect(screen.getByRole('img', { name: /Mid-range no data/ })).toBeTruthy()
  })
})

describe('CardDialog', () => {
  it('opens as a dialog named after the player, with Download and Close, and Close has focus', () => {
    render(<CardDialog profile={shooterProfile('Yuly', shots(12))} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Shot card of Yuly' })
    expect(within(dialog).getByRole('button', { name: 'Download card' })).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }))
  })

  it('closes with the button and with Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CardDialog profile={shooterProfile('Yuly', shots(12))} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab and Shift+Tab inside the dialog, also from the body', async () => {
    const user = userEvent.setup()
    render(<CardDialog profile={shooterProfile('Yuly', shots(12))} onClose={vi.fn()} />)
    const download = screen.getByRole('button', { name: 'Download card' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(close)
    await user.tab()
    expect(document.activeElement).toBe(download)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(close)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(download)
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    await user.tab()
    expect(document.activeElement).toBe(download)
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(close)
  })
})

describe('FaceOff', () => {
  it('shows both cards, the four rows with each side beside its own number, and the verdict', () => {
    render(<FaceOff you={shooterProfile('Yuly', shots(12))} them={playerProfile(curry)} verdict="Yuly is ahead of Stephen Curry: leading in 3 of 5 areas." onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Face-off: Yuly against Stephen Curry' })
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Yuly', 'Stephen Curry'])
    expect([...dialog.querySelectorAll('.fo-label')].map((l) => l.textContent)).toEqual(['Shooting rating', 'Field goal', 'Three point', 'Share of threes'])
    expect(within(dialog).getByRole('status').textContent).toBe('Yuly is ahead of Stephen Curry: leading in 3 of 5 areas.')
  })

  it('closes with the See the full comparison button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<FaceOff you={shooterProfile('Yuly', shots(12))} them={playerProfile(curry)} verdict="v" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'See the full comparison' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
