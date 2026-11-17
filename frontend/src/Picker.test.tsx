// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Picker from './Picker'
import type { PickerOption } from './Picker'

// jsdom does not implement scrollIntoView, which the picker calls while open.
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

const options: PickerOption[] = [
  { id: 'a', name: 'Alpha', sub: 'first', thumb: null },
  { id: 'b', name: 'Beta', sub: 'second', thumb: null },
  { id: 'c', name: 'Gamma', sub: 'third', thumb: null },
]

function setup(value = 'a') {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(
    <>
      <Picker options={options} value={value} onChange={onChange} ariaLabel="Letters" />
      <button>next</button>
    </>,
  )
  const button = screen.getByRole('combobox')
  button.focus()
  return { user, onChange, button }
}

const list = () => screen.queryByRole('listbox')
const activeName = () => document.querySelector('.pp-option.active .pp-name')?.textContent

describe('Picker keyboard', () => {
  it('opens on ArrowDown with the chosen option active', async () => {
    const { user, button } = setup('b')
    expect(list()).toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(list()).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(activeName()).toBe('Beta')
  })

  it('opens on ArrowUp too', async () => {
    const { user } = setup()
    await user.keyboard('{ArrowUp}')
    expect(list()).not.toBeNull()
  })

  it('moves the active option with ArrowDown and ArrowUp, and stops at the ends', async () => {
    const { user } = setup()
    await user.keyboard('{ArrowDown}')
    expect(activeName()).toBe('Alpha')
    await user.keyboard('{ArrowDown}')
    expect(activeName()).toBe('Beta')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(activeName()).toBe('Gamma')
    await user.keyboard('{ArrowUp}')
    expect(activeName()).toBe('Beta')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(activeName()).toBe('Alpha')
  })

  it('chooses the active option on Enter and closes', async () => {
    const { user, onChange, button } = setup()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('b')
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('closes on Escape without choosing', async () => {
    const { user, onChange } = setup()
    await user.keyboard('{ArrowDown}{ArrowDown}{Escape}')
    expect(list()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes on Tab and moves focus on', async () => {
    const { user, onChange } = setup()
    await user.keyboard('{ArrowDown}')
    expect(list()).not.toBeNull()
    await user.tab()
    expect(list()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'next' }))
  })
})

describe('Picker value', () => {
  it('shows the chosen option on the button and marks it selected', async () => {
    const { user, button } = setup('c')
    expect(button.textContent).toContain('Gamma')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Gamma/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('falls back to the first option for an unknown value', async () => {
    const { user, button } = setup('nope')
    expect(button.textContent).toContain('Alpha')
    await user.keyboard('{ArrowDown}')
    expect(activeName()).toBe('Alpha')
    expect(screen.getByRole('option', { name: /Alpha/ }).getAttribute('aria-selected')).toBe('true')
  })
})
