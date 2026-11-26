// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import AuthScreen from './AuthScreen'
import { LEAVE_MS } from '../game/titleSeen'

const loginAccount = vi.fn()
const registerAccount = vi.fn()
vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return { ...real, loginAccount: (...a: unknown[]) => loginAccount(...a), registerAccount: (...a: unknown[]) => registerAccount(...a) }
})

const USER = { id: 1, email: 'yuly@example.com', username: 'Yuly' }

beforeEach(() => {
  loginAccount.mockReset()
  registerAccount.mockReset()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function open(props: Partial<React.ComponentProps<typeof AuthScreen>> = {}) {
  const onAuthenticated = vi.fn()
  const onDone = vi.fn()
  render(<AuthScreen onAuthenticated={onAuthenticated} onDone={onDone} {...props} />)
  return { onAuthenticated, onDone, user: userEvent.setup() }
}

/** The same, with the clock under the test's control (call after vi.useFakeTimers). */
function openWithClock() {
  const view = open()
  return { ...view, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) }
}

const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement

describe('the log in form', () => {
  it('asks for a username or email and a password, and focuses the first', () => {
    open()
    expect(screen.getByRole('dialog', { name: /log in/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'PLAYER SELECT' })).toBeTruthy()
    expect(document.activeElement).toBe(field('Username or email'))
    expect(field('Password').type).toBe('password')
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByLabelText('Repeat password')).toBeNull()
    expect(screen.getByRole('button', { name: "LET'S PLAY" })).toBeTruthy()
  })

  it('tells the browser what each field is, so a password manager can help', () => {
    open()
    expect(field('Username or email').autocomplete).toBe('username')
    expect(field('Password').autocomplete).toBe('current-password')
    expect(field('Username or email').getAttribute('autocapitalize')).toBe('none')
  })

  it('logs in with the trimmed name and the password as typed', async () => {
    loginAccount.mockResolvedValue(USER)
    const { user, onAuthenticated } = open()
    await user.type(field('Username or email'), '  yuly  ')
    await user.type(field('Password'), 'my pass ')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    expect(loginAccount).toHaveBeenCalledWith('yuly', 'my pass ')
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(USER))
  })

  it('Enter in the password field submits', async () => {
    loginAccount.mockResolvedValue(USER)
    const { user, onAuthenticated } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'secret-secret{Enter}')
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled())
  })

  it('an empty form shows both problems, focuses the first and asks the backend nothing', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    expect(screen.getByText('Enter your username or email.')).toBeTruthy()
    expect(screen.getByText('Enter your password.')).toBeTruthy()
    expect(field('Username or email').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Username or email'))
    expect(loginAccount).not.toHaveBeenCalled()
  })

  it('a field is only marked once it was left', async () => {
    const { user } = open()
    expect(screen.queryByText('Enter your password.')).toBeNull()
    await user.click(field('Password'))
    expect(screen.queryByText('Enter your password.')).toBeNull()
    await user.tab()
    expect(screen.getByText('Enter your password.')).toBeTruthy()
    expect(field('Password').getAttribute('aria-describedby')).toBeTruthy()
  })

  it('a wrong password says so, empties the password and keeps the name', async () => {
    loginAccount.mockRejectedValue(new ApiError('invalid', 'Wrong username, email or password.'))
    const { user, onAuthenticated } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'wrong-wrong')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong username, email or password.')
    expect(field('Password').value).toBe('')
    expect(field('Username or email').value).toBe('yuly')
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: "LET'S PLAY" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('after a wrong password the empty field is not an error, and it has the cursor', async () => {
    loginAccount.mockRejectedValue(new ApiError('invalid', 'Wrong username, email or password.'))
    const { user } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'wrong-wrong')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    await screen.findByRole('alert')
    expect(screen.queryByText('Enter your password.')).toBeNull()
    expect(field('Password').getAttribute('aria-invalid')).toBe('false')
    expect(document.activeElement).toBe(field('Password'))
  })

  it('does not take the cursor while the title screen is still on top', () => {
    const { rerender } = render(<AuthScreen autoFocus={false} onAuthenticated={() => {}} onDone={() => {}} />)
    expect(document.activeElement).not.toBe(field('Username or email'))
    rerender(<AuthScreen autoFocus onAuthenticated={() => {}} onDone={() => {}} />)
    expect(document.activeElement).toBe(field('Username or email'))
  })

  it('too many tries is shown as it is', async () => {
    loginAccount.mockRejectedValue(new ApiError('rate_limited', 'Too many attempts. Try again in 30 seconds.'))
    const { user } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'x')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    expect((await screen.findByRole('alert')).textContent).toContain('30 seconds')
  })

  it('an unexpected error becomes a sentence', async () => {
    loginAccount.mockRejectedValue(new Error('boom'))
    const { user } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'x')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.')
  })

  it('shows the notice it was given', () => {
    open({ notice: 'Your login ended. Please log in again.' })
    expect(screen.getByRole('status').textContent).toBe('Your login ended. Please log in again.')
  })

  it('cannot be sent twice while it waits', async () => {
    let finish: (u: typeof USER) => void = () => {}
    loginAccount.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { user } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'secret-secret')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    const wait = screen.getByRole('button', { name: 'ONE MOMENT…' }) as HTMLButtonElement
    expect(wait.disabled).toBe(true)
    await user.type(field('Password'), '{Enter}')
    expect(loginAccount).toHaveBeenCalledTimes(1)
    await act(async () => finish(USER))
  })
})

describe('the sign up form', () => {
  async function toSignUp() {
    const view = open()
    await view.user.click(screen.getByRole('button', { name: 'SIGN UP' }))
    return view
  }

  it('asks for email, username, password and the password again, all passwords hidden', async () => {
    await toSignUp()
    expect(screen.getByRole('heading', { name: 'NEW PLAYER' })).toBeTruthy()
    expect(document.activeElement).toBe(field('Email'))
    expect(field('Email').type).toBe('email')
    expect(field('Email').autocomplete).toBe('email')
    expect(field('Username').autocomplete).toBe('username')
    expect(field('Password').type).toBe('password')
    expect(field('Password').autocomplete).toBe('new-password')
    expect(field('Repeat password').type).toBe('password')
    expect(field('Repeat password').autocomplete).toBe('new-password')
    expect(screen.getByRole('button', { name: 'CREATE PLAYER' })).toBeTruthy()
  })

  it('the buttons say which form is open', async () => {
    await toSignUp()
    expect(screen.getByRole('button', { name: 'SIGN UP' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'LOG IN' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('switching forms empties the passwords and the errors, and the link does the same', async () => {
    const { user } = await toSignUp()
    await user.type(field('Password'), 'something-long')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByRole('heading', { name: 'PLAYER SELECT' })).toBeTruthy()
    expect(field('Password').value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(field('Password').value).toBe('')
    expect(screen.getByRole('heading', { name: 'NEW PLAYER' })).toBeTruthy()
  })

  it('names every problem once the fields are left, and mismatching passwords', async () => {
    const { user } = await toSignUp()
    await user.type(field('Email'), 'nope')
    await user.type(field('Username'), 'a b')
    await user.type(field('Password'), 'short')
    await user.type(field('Repeat password'), 'different')
    await user.tab()
    expect(screen.getByText('That does not look like an email address.')).toBeTruthy()
    expect(screen.getByText(/3 to 30 letters, digits/, { selector: '.au-error' })).toBeTruthy()
    expect(screen.getByText('Use at least 10 characters (5 so far).')).toBeTruthy()
    expect(screen.getByText('The two passwords do not match.')).toBeTruthy()
  })

  it('shows how strong the password is while typing', async () => {
    const { user } = await toSignUp()
    expect(screen.getByText('At least 10 characters')).toBeTruthy()
    await user.type(field('Password'), 'short')
    expect(screen.getByText('POWER: TOO SHORT')).toBeTruthy()
    await user.clear(field('Password'))
    await user.type(field('Password'), 'Abcdefghijklm1')
    expect(screen.getByText('POWER: STRONG')).toBeTruthy()
  })

  it('an empty submit focuses the first problem and calls nothing', async () => {
    const { user } = await toSignUp()
    await user.click(screen.getByRole('button', { name: 'CREATE PLAYER' }))
    expect(screen.getByText('Enter your email.')).toBeTruthy()
    expect(screen.getByText('Pick a username.')).toBeTruthy()
    expect(screen.getByText('Enter a password.')).toBeTruthy()
    expect(screen.getByText('Type the password again.')).toBeTruthy()
    expect(document.activeElement).toBe(field('Email'))
    expect(registerAccount).not.toHaveBeenCalled()
  })

  it('creates the account with every field, the email and username trimmed', async () => {
    registerAccount.mockResolvedValue(USER)
    const { user, onAuthenticated } = await toSignUp()
    await user.type(field('Email'), ' yuly@example.com ')
    await user.type(field('Username'), ' Yuly ')
    await user.type(field('Password'), 'a long enough password')
    await user.type(field('Repeat password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'CREATE PLAYER' }))
    expect(registerAccount).toHaveBeenCalledWith({
      email: 'yuly@example.com',
      username: 'Yuly',
      password: 'a long enough password',
      password_confirm: 'a long enough password',
    })
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(USER))
  })

  it('a taken username is shown under that field, focused, and goes away when edited', async () => {
    registerAccount.mockRejectedValue(new ApiError('conflict', 'That username is already used', 'username'))
    const { user } = await toSignUp()
    await user.type(field('Email'), 'yuly@example.com')
    await user.type(field('Username'), 'Yuly')
    await user.type(field('Password'), 'a long enough password')
    await user.type(field('Repeat password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'CREATE PLAYER' }))
    expect(await screen.findByText('That username is already used')).toBeTruthy()
    expect(document.activeElement).toBe(field('Username'))
    expect(field('Username').getAttribute('aria-invalid')).toBe('true')
    expect(field('Password').value).toBe('a long enough password') // the rest is kept
    await user.type(field('Username'), '2')
    expect(screen.queryByText('That username is already used')).toBeNull()
  })

  it('a validation answer from the backend is shown above the button', async () => {
    registerAccount.mockRejectedValue(new ApiError('invalid', 'Please fix: password: that password is too common, pick another one'))
    const { user } = await toSignUp()
    await user.type(field('Email'), 'yuly@example.com')
    await user.type(field('Username'), 'Yuly')
    await user.type(field('Password'), 'basketball1')
    await user.type(field('Repeat password'), 'basketball1')
    await user.click(screen.getByRole('button', { name: 'CREATE PLAYER' }))
    expect((await screen.findByRole('alert')).textContent).toContain('too common')
  })
})

describe('the eye on the password boxes', () => {
  const eye = (name: string) => screen.getByRole('button', { name })

  it('starts hidden, shows what is typed on a click, and hides it again on the next', async () => {
    const { user } = open()
    await user.type(field('Password'), 'my secret pass')
    expect(field('Password').type).toBe('password')
    expect(eye('Show password').getAttribute('aria-pressed')).toBe('false')
    await user.click(eye('Show password'))
    expect(field('Password').type).toBe('text')
    expect(field('Password').value).toBe('my secret pass')
    expect(eye('Hide password').getAttribute('aria-pressed')).toBe('true')
    await user.click(eye('Hide password'))
    expect(field('Password').type).toBe('password')
  })

  it('works from the keyboard (Tab to the eye, Enter or Space)', async () => {
    const { user } = open()
    await user.click(field('Password'))
    await user.tab()
    expect(document.activeElement).toBe(eye('Show password'))
    await user.keyboard('{Enter}')
    expect(field('Password').type).toBe('text')
    await user.keyboard(' ')
    expect(field('Password').type).toBe('password')
  })

  it('pressing it does not count as leaving the box (no error appears)', async () => {
    const { user } = open()
    await user.click(field('Password'))
    await user.click(eye('Show password'))
    expect(screen.queryByText('Enter your password.')).toBeNull()
    expect(document.activeElement).toBe(field('Password'))
  })

  it('each box on the sign up form has its own eye', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'SIGN UP' }))
    await user.type(field('Password'), 'first password')
    await user.type(field('Repeat password'), 'first password')
    await user.click(eye('Show password'))
    expect(field('Password').type).toBe('text')
    expect(field('Repeat password').type).toBe('password') // the other box stays hidden
    await user.click(eye('Show repeated password'))
    expect(field('Repeat password').type).toBe('text')
  })

  it('switching between the forms hides it again', async () => {
    const { user } = open()
    await user.click(eye('Show password'))
    expect(field('Password').type).toBe('text')
    await user.click(screen.getByRole('button', { name: 'SIGN UP' }))
    expect(field('Password').type).toBe('password')
    expect(eye('Show password')).toBeTruthy()
  })

  it('what is typed still goes to the backend when it is shown', async () => {
    loginAccount.mockResolvedValue(USER)
    const { user, onAuthenticated } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'visible-pass')
    await user.click(eye('Show password'))
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    expect(loginAccount).toHaveBeenCalledWith('yuly', 'visible-pass')
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled())
  })
})

describe('after it works', () => {
  it('wipes away like the title screen and then says it is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    loginAccount.mockResolvedValue(USER)
    const { user, onDone } = openWithClock()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'secret-secret')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    await waitFor(() => expect(screen.getByRole('dialog').className).toContain('leaving'))
    expect(onDone).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: /one moment|let's play/i }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => void vi.advanceTimersByTime(LEAVE_MS + 100))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('with reduced motion it is done at once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }))
    loginAccount.mockResolvedValue(USER)
    const { user, onDone } = openWithClock()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'secret-secret')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 400 }) // not after the 900 ms wipe
  })

  it('shows no error while it wipes away (the emptied password is not a mistake)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    loginAccount.mockResolvedValue(USER)
    const { user } = openWithClock()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'secret-secret')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    await waitFor(() => expect(screen.getByRole('dialog').className).toContain('leaving'))
    expect(document.querySelector('.au-error')).toBeNull()
    expect(screen.queryByText('Enter your password.')).toBeNull()
    expect(document.querySelector('.au-field.bad')).toBeNull()
  })

  it('the same for the sign up form (no "type the password again" while leaving)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    registerAccount.mockResolvedValue(USER)
    const { user } = openWithClock()
    await user.click(screen.getByRole('button', { name: 'SIGN UP' }))
    await user.type(field('Email'), 'yuly@example.com')
    await user.type(field('Username'), 'Yuly')
    await user.type(field('Password'), 'a long enough password')
    await user.type(field('Repeat password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'CREATE PLAYER' }))
    await waitFor(() => expect(screen.getByRole('dialog').className).toContain('leaving'))
    expect(document.querySelector('.au-error')).toBeNull()
    expect(document.querySelector('.au-field.bad')).toBeNull()
  })

  it('forgets the password it was holding', async () => {
    loginAccount.mockResolvedValue(USER)
    const { user, onAuthenticated } = open()
    await user.type(field('Username or email'), 'yuly')
    await user.type(field('Password'), 'secret-secret')
    await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled())
    expect(field('Password').value).toBe('')
  })
})
