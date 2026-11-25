// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import type { User } from './api'
import { clearToken, notifySessionEnded, setToken } from './auth/session'
import { LEAVE_MS } from './game/titleSeen'

const fetchMe = vi.fn()
const loginAccount = vi.fn()
const registerAccount = vi.fn()
const logoutAccount = vi.fn()
vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>()
  return {
    ...real,
    fetchMe: () => fetchMe(),
    loginAccount: (...a: unknown[]) => loginAccount(...a),
    registerAccount: (...a: unknown[]) => registerAccount(...a),
    logoutAccount: () => logoutAccount(),
  }
})

// The real app is heavy (3D, sound, a coach). A stand-in shows what Root gave it.
interface StubProps {
  user?: User | null
  onLogout?: () => void
  skipTitle?: boolean
  hold?: boolean
}
vi.mock('./App', () => ({
  default: function StubApp({ user, onLogout, skipTitle, hold }: StubProps) {
    const [draft, setDraft] = useState('')
    return (
      <main aria-label="the app">
        <p data-testid="who">{user ? user.username : 'nobody'}</p>
        <p data-testid="flags">{`skipTitle=${String(skipTitle)} hold=${String(hold)}`}</p>
        <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" onClick={onLogout}>
          log out
        </button>
      </main>
    )
  },
}))

const YULY: User = { id: 1, email: 'yuly@example.com', username: 'Yuly' }
const NOAM: User = { id: 2, email: 'noam@example.com', username: 'Noam' }

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
}

function setup({ titleSeen = true }: { titleSeen?: boolean } = {}) {
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(titleSeen ? { 'hoops-title-seen': '1' } : {}), configurable: true })
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  window.history.replaceState(null, '', '/')
}

beforeEach(() => {
  fetchMe.mockReset()
  loginAccount.mockReset()
  registerAccount.mockReset()
  logoutAccount.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  setup()
})
afterEach(() => {
  clearToken()
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount() {
  const { default: Root } = await import('./Root')
  return render(<Root />)
}

async function logIn(user: ReturnType<typeof userEvent.setup>, name = 'yuly') {
  await user.type(screen.getByLabelText('Username or email'), name)
  await user.type(screen.getByLabelText('Password'), 'secret-secret')
  await user.click(screen.getByRole('button', { name: "LET'S PLAY" }))
}

describe('a visitor who is not logged in', () => {
  it('sees PRESS START first, and the login only after pressing it', async () => {
    setup({ titleSeen: false })
    const user = userEvent.setup()
    await mount()
    expect(screen.getByRole('button', { name: 'PRESS START' })).toBeTruthy()
    expect(screen.queryByLabelText('Username or email')).toBeNull()
    expect(screen.queryByRole('main', { name: 'the app' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'PRESS START' }))
    expect(await screen.findByLabelText('Username or email')).toBeTruthy()
    expect(screen.queryByRole('main', { name: 'the app' })).toBeNull() // still no app: no login yet
    expect(fetchMe).not.toHaveBeenCalled() // there is no token to check
  })

  it('goes straight to the login when the title was already seen in this tab', async () => {
    await mount()
    expect(screen.getByRole('dialog', { name: /log in/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'PRESS START' })).toBeNull()
  })

  it('after logging in the app opens without a second title, and the login screen leaves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    loginAccount.mockResolvedValue(YULY)
    await mount()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await logIn(user)
    const app = await screen.findByRole('main', { name: 'the app' })
    expect(app).toBeTruthy()
    expect(screen.getByTestId('who').textContent).toBe('Yuly')
    expect(screen.getByTestId('flags').textContent).toContain('skipTitle=true')
    expect(screen.getByTestId('flags').textContent).toContain('hold=true') // the court waits for its entrance
    await waitFor(() => expect(screen.getByTestId('flags').textContent).toContain('hold=false'))
    expect(screen.getByRole('dialog', { name: /log in/i })).toBeTruthy() // still wiping away
    await act(async () => void vi.advanceTimersByTime(LEAVE_MS + 100))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('signing up works the same way', async () => {
    registerAccount.mockResolvedValue(NOAM)
    await mount()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'SIGN UP' }))
    await user.type(screen.getByLabelText('Email'), 'noam@example.com')
    await user.type(screen.getByLabelText('Username'), 'Noam')
    await user.type(screen.getByLabelText('Password'), 'a long enough password')
    await user.type(screen.getByLabelText('Repeat password'), 'a long enough password')
    await user.click(screen.getByRole('button', { name: 'CREATE PLAYER' }))
    expect((await screen.findByTestId('who')).textContent).toBe('Noam')
  })

  it('a failed login keeps the app away', async () => {
    loginAccount.mockRejectedValue(new ApiError('invalid', 'Wrong username, email or password.'))
    await mount()
    await logIn(userEvent.setup())
    expect((await screen.findByRole('alert')).textContent).toContain('Wrong username')
    expect(screen.queryByRole('main', { name: 'the app' })).toBeNull()
  })
})

describe('a visitor who has a token', () => {
  it('goes to the app, which keeps its own title screen, once the backend says the token is good', async () => {
    setToken('good')
    fetchMe.mockResolvedValue(YULY)
    await mount()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(await screen.findByRole('main', { name: 'the app' })).toBeTruthy()
    expect(screen.getByTestId('who').textContent).toBe('Yuly')
    expect(screen.getByTestId('flags').textContent).toContain('skipTitle=false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a token the backend refuses leads to the login, with a sentence about it', async () => {
    setToken('stale')
    fetchMe.mockResolvedValue(null)
    await mount()
    expect(await screen.findByRole('dialog', { name: /log in/i })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Your login ended. Please log in again.')
    expect(screen.queryByRole('main', { name: 'the app' })).toBeNull()
  })

  it('with the title not yet seen, a refused token shows PRESS START and then the login', async () => {
    setup({ titleSeen: false })
    setToken('stale')
    fetchMe.mockResolvedValue(null)
    await mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'PRESS START' }))
    expect(await screen.findByLabelText('Username or email')).toBeTruthy()
  })

  it('a backend that cannot be reached still shows the app, which reports it', async () => {
    setToken('maybe')
    fetchMe.mockRejectedValue(new ApiError('unreachable', "Can't reach the backend"))
    await mount()
    expect(await screen.findByRole('main', { name: 'the app' })).toBeTruthy()
    expect(screen.getByTestId('who').textContent).toBe('nobody')
  })
})

describe('logging out', () => {
  async function loggedIn() {
    setToken('good')
    fetchMe.mockResolvedValue(YULY)
    await mount()
    await screen.findByRole('main', { name: 'the app' })
  }

  it('ends the login, removes the app and shows an empty login form', async () => {
    await loggedIn()
    await userEvent.setup().click(screen.getByRole('button', { name: 'log out' }))
    expect(logoutAccount).toHaveBeenCalledTimes(1)
    expect(await screen.findByLabelText('Username or email')).toBeTruthy()
    expect(screen.queryByRole('main', { name: 'the app' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull() // no "your login ended" for a deliberate log out
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  })

  it('the next person gets a clean app', async () => {
    await loggedIn()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('draft'), 'half a shot')
    await user.click(screen.getByRole('button', { name: 'log out' }))
    loginAccount.mockResolvedValue(NOAM)
    await logIn(user, 'noam')
    expect((await screen.findByTestId('who')).textContent).toBe('Noam')
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('')
  })
})

describe('logging out while the login screen is still wiping away', () => {
  it('the old wipe does not hide the new login screen (this used to leave a blank page)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    loginAccount.mockResolvedValue(YULY)
    let finishLogout: () => void = () => {}
    logoutAccount.mockReturnValue(new Promise<void>((resolve) => (finishLogout = resolve)))
    await mount()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await logIn(user)
    await screen.findByRole('main', { name: 'the app' })
    expect(screen.getByRole('dialog', { name: /log in/i })).toBeTruthy() // the first login screen is wiping away
    await user.click(screen.getByRole('button', { name: 'log out' }))
    // A busy page: the logout answer and the old wipe's timer are both due before React draws again.
    await act(async () => {
      finishLogout()
      await Promise.resolve()
      await Promise.resolve()
      vi.advanceTimersByTime(LEAVE_MS + 100)
    })
    expect(await screen.findByLabelText('Username or email')).toBeTruthy()
    expect(screen.queryByRole('main', { name: 'the app' })).toBeNull()
  })
})

describe('a login that ends while the app is open', () => {
  async function loggedIn() {
    setToken('good')
    fetchMe.mockResolvedValue(YULY)
    await mount()
    await screen.findByRole('main', { name: 'the app' })
  }

  it('puts the login screen on top and keeps the app (and a half-typed draft) underneath', async () => {
    await loggedIn()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('draft'), 'half a shot')
    act(() => notifySessionEnded())
    expect(await screen.findByRole('dialog', { name: /log in/i })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Your login ended. Please log in again.')
    const app = document.querySelector('[inert]')
    expect(app?.querySelector('main')).toBeTruthy() // the app is still there, but cannot be used
    expect(app?.querySelector('input')?.value).toBe('half a shot')
  })

  it('the same person logging back in gets the same app, draft and all', async () => {
    await loggedIn()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('draft'), 'half a shot')
    act(() => notifySessionEnded())
    loginAccount.mockResolvedValue(YULY)
    await logIn(user)
    await waitFor(() => expect(document.querySelector('[inert]')).toBeNull())
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('half a shot')
    expect(screen.getByTestId('flags').textContent).toContain('hold=false') // no second entrance
  })

  it('another person logging in gets a fresh app, without the first one’s draft', async () => {
    await loggedIn()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('draft'), 'half a shot')
    act(() => notifySessionEnded())
    loginAccount.mockResolvedValue(NOAM)
    await logIn(user, 'noam')
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('Noam'))
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('')
  })
})
