// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerPicker from './PlayerPicker'
import { PLAYERS } from './court/players'

// jsdom does not implement scrollIntoView, which the picker calls while open.
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

const pickerButton = () => screen.getByRole('combobox')
const list = () => screen.queryByRole('listbox')

describe('PlayerPicker', () => {
  it('keeps the open list out of the Tab order (tabindex="-1")', async () => {
    const user = userEvent.setup()
    render(<PlayerPicker value={null} onChange={() => {}} />)
    await user.click(pickerButton())
    // Regression guard for "Tab does not close the compare-with list". Chromium makes a scrolling
    // element a Tab stop, so without tabindex="-1" Tab from the button lands on the list, which is
    // still inside the picker, so the wrapper's onBlur never closes it. jsdom has no layout and
    // cannot model that, so asserting the attribute is the only way to protect it here.
    expect(list()?.getAttribute('tabindex')).toBe('-1')
  })

  it('closes on Tab and moves focus to the next control', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PlayerPicker value={null} onChange={() => {}} />
        <button>next</button>
      </>,
    )
    await user.click(pickerButton())
    expect(list()).not.toBeNull()
    await user.tab()
    expect(list()).toBeNull()
    expect(pickerButton().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'next' }))
  })

  it('stays open while focus stays inside the picker', async () => {
    const user = userEvent.setup()
    render(<PlayerPicker value={null} onChange={() => {}} />)
    await user.click(pickerButton())
    await user.keyboard('{ArrowDown}')
    expect(list()).not.toBeNull()
    expect(document.activeElement).toBe(pickerButton())
  })

  it('chooses a player with the mouse, closes and refocuses the button', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PlayerPicker value={null} onChange={onChange} />)
    await user.click(pickerButton())
    const player = PLAYERS[0]
    await user.click(screen.getByRole('option', { name: new RegExp(player.name) }))
    expect(onChange).toHaveBeenCalledWith(player.id)
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(pickerButton())
  })

  it('chooses the NBA average with null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PlayerPicker value={PLAYERS[0].id} onChange={onChange} />)
    await user.click(pickerButton())
    await user.click(screen.getByRole('option', { name: /NBA average/ }))
    expect(onChange).toHaveBeenCalledWith(null)
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(pickerButton())
  })

  it('opens with ArrowDown from the closed button and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<PlayerPicker value={null} onChange={() => {}} />)
    await user.tab()
    expect(document.activeElement).toBe(pickerButton())
    expect(list()).toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(list()).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(list()).toBeNull()
  })
})
