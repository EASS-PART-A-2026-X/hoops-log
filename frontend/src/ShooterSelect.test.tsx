// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShooterSelect from './ShooterSelect'

// jsdom does not implement scrollIntoView, which the picker calls while open.
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

const shots = [{ player: 'Noam' }, { player: 'Yuly' }, { player: 'Yuly' }, { player: 'Yuly' }]

describe('ShooterSelect', () => {
  it('lists everyone with their shot counts, "Every player" first', async () => {
    const user = userEvent.setup()
    render(<ShooterSelect shots={shots} value="Yuly" onChange={() => {}} />)
    await user.click(screen.getByRole('combobox'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Every player'),
      expect.stringContaining('Noam'),
      expect.stringContaining('Yuly'),
    ])
    expect(options[0]?.textContent).toContain('4 shots')
    expect(options[1]?.textContent).toContain('1 shot')
    expect(options[1]?.textContent).not.toContain('1 shots')
    expect(options[2]?.textContent).toContain('3 shots')
  })

  it('marks the chosen player and shows them on the closed button', () => {
    render(<ShooterSelect shots={shots} value="Yuly" onChange={() => {}} />)
    const button = screen.getByRole('combobox')
    expect(button.textContent).toContain('Yuly')
    expect(button.textContent).toContain('3 shots')
  })

  it('reports the player name, or an empty string for every player', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ShooterSelect shots={shots} value="Yuly" onChange={onChange} />)
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Noam/ }))
    expect(onChange).toHaveBeenLastCalledWith('Noam')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Every player/ }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('still works with no shots yet', async () => {
    const user = userEvent.setup()
    render(<ShooterSelect shots={null} value="" onChange={() => {}} />)
    await user.click(screen.getByRole('combobox'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]?.textContent).toContain('0 shots')
  })
})
