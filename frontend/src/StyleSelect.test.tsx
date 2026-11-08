// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StyleSelect from './StyleSelect'

Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

describe('StyleSelect', () => {
  it('shows the chosen style on the button and names the list', () => {
    render(<StyleSelect value="beams" onChange={() => {}} />)
    const button = screen.getByRole('combobox')
    expect(button.textContent).toContain('3D beams')
    expect(button.getAttribute('aria-label')).toBe('Map style: 3D beams')
  })

  it('lists the three styles, opens upward, and reports the choice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<StyleSelect value="beams" onChange={onChange} />)
    expect(container.querySelector('.pp-up')).not.toBeNull()
    await user.click(screen.getByRole('combobox'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.querySelector('.pp-name')?.textContent)).toEqual(['Heat map', '3D beams', 'Flight paths'])
    await user.click(options[0]!)
    expect(onChange).toHaveBeenCalledWith('heat')
  })

  it('works with the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StyleSelect value="beams" onChange={onChange} />)
    screen.getByRole('combobox').focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('arcs')
  })
})
