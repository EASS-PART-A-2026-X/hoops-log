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

  it('has a visible "Shots of" label, or in the top bar only a name for screen readers', () => {
    const { container, rerender } = render(<ShooterSelect shots={shots} value="Yuly" onChange={() => {}} />)
    expect(container.querySelector('.pp-prefix')?.textContent).toBe('Shots of')
    expect(container.querySelector('.pp-left')).toBeNull()
    rerender(<ShooterSelect compact shots={shots} value="Yuly" onChange={() => {}} />)
    expect(container.querySelector('.pp-prefix')).toBeNull()
    expect(container.querySelector('.pp-left')).not.toBeNull()
    expect(screen.getByRole('combobox').getAttribute('aria-label')).toBe('Shots of: Yuly')
  })

  it('in the top bar the closed button is just the name and an arrow, and the open list looks the same as elsewhere', async () => {
    const user = userEvent.setup()
    render(<ShooterSelect compact shots={shots} value="Yuly" onChange={() => {}} />)
    const button = screen.getByRole('combobox')
    expect(button.textContent).toBe('Yuly▾')
    expect(button.querySelector('.pp-thumb')).toBeNull()
    expect(button.querySelector('.pp-sub')).toBeNull()
    await user.click(button)
    const first = within(screen.getByRole('listbox')).getAllByRole('option')[0]!
    expect(first.querySelector('.pp-thumb')).not.toBeNull()
    expect(first.querySelector('.pp-sub')?.textContent).toBe('4 shots')
  })

  it('says All players on the closed top-bar button when everyone is chosen', () => {
    render(<ShooterSelect compact shots={shots} value="" onChange={() => {}} />)
    expect(screen.getByRole('combobox').textContent).toBe('All players▾')
  })
})
