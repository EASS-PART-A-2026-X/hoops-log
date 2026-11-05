// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Shot } from './api'
import PlayersPage from './PlayersPage'

afterEach(cleanup)

const shots = Array.from({ length: 12 }, (_, i) => ({ id: i, shooter: 'Yuly', zone: 'restricted_area', made: i % 2 === 0, shot_type: '2PT' })) as unknown as Shot[]
const page = () => render(<PlayersPage shots={shots} shooter="Yuly" shooterPicker={null} benchmarkId={null} onCompare={() => {}} />)

describe('your card tile', () => {
  it('is plain readable content with a separate button, not a button around the card', () => {
    page()
    const tile = document.querySelector('.player-you') as HTMLElement
    const open = within(tile).getByRole('button', { name: "Open Yuly's shot card at full size" })
    expect(open.closest('.shot-card')).toBeNull()
    expect(open.contains(tile.querySelector('h3'))).toBe(false)
    expect(tile.querySelector('button button, button h3, button dl, button svg')).toBeNull()
    expect(within(tile).getByText('Yuly')).toBeTruthy()
    expect(within(tile).getByText('Field goal')).toBeTruthy()
  })

  it('opens the full-size card from the button and from a click on the card', async () => {
    const user = userEvent.setup()
    page()
    const tile = document.querySelector('.player-you') as HTMLElement
    await user.click(within(tile).getByRole('button', { name: /Open Yuly/ }))
    expect(screen.getByRole('dialog', { name: 'Shot card of Yuly' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(within(tile).getByText('Field goal'))
    expect(screen.getByRole('dialog', { name: 'Shot card of Yuly' })).toBeTruthy()
  })
})
