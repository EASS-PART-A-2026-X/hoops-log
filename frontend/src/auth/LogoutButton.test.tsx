// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LogoutButton from './LogoutButton'

afterEach(cleanup)

describe('LogoutButton', () => {
  it('names the account it logs out', () => {
    render(<LogoutButton name="Yuly" onLogout={() => {}} />)
    const button = screen.getByRole('button', { name: 'Log out Yuly' })
    expect(button.getAttribute('title')).toBe('Log out Yuly')
  })

  it('still has a name when the account is not known', () => {
    render(<LogoutButton name={null} onLogout={() => {}} />)
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
  })

  it('asks to log out once, and cannot be pressed again while it works', async () => {
    const onLogout = vi.fn()
    render(<LogoutButton name="Yuly" onLogout={onLogout} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button'))
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
