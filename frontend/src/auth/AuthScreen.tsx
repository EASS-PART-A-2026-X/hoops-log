import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError, loginAccount, registerAccount } from '../api'
import type { User } from '../api'
import Logo from '../Logo'
import TitleBackdrop from '../TitleBackdrop'
import { play } from '../game/audio'
import { LEAVE_MS } from '../game/titleSeen'
import { MAX_PASSWORD, checkConfirm, checkEmail, checkPassword, checkUsername, passwordStrength } from './validate'

export type AuthMode = 'login' | 'register'

interface Props {
  mode?: AuthMode
  /** A sentence above the form, for example "Your login ended. Please log in again." */
  notice?: string | null
  /** False while the title screen is still on top: the first field is focused once this turns true. */
  autoFocus?: boolean
  /** The account is in: the app behind starts its entrance now. */
  onAuthenticated: (user: User) => void
  /** The wipe has finished and the screen can go. */
  onDone: () => void
}

interface FieldProps {
  id: string
  label: string
  error: string | null
  hint?: ReactNode
  children: (describedBy: string | undefined) => ReactNode
}

/** A label, the input (from `children`), and the error or hint under it, wired together for screen readers. */
function Field({ id, label, error, hint, children }: FieldProps) {
  const noteId = `${id}-note`
  const describedBy = error || hint ? noteId : undefined
  return (
    <div className={error ? 'au-field bad' : 'au-field'}>
      <label htmlFor={id}>{label}</label>
      {children(describedBy)}
      {error ? (
        <p id={noteId} className="au-error">
          {error}
        </p>
      ) : hint ? (
        <div id={noteId} className="au-hint">
          {hint}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The player-select screen: log in, or create an account. It sits on the same moving court as the title screen
 * and wipes away the same way once you are in.
 */
export default function AuthScreen({ mode: startMode = 'login', notice = null, autoFocus = true, onAuthenticated, onDone }: Props) {
  const uid = useId()
  const [mode, setMode] = useState<AuthMode>(startMode)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [login, setLogin] = useState('')
  // Which fields the person has already left, so an empty form does not start out covered in errors.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })

  const register = mode === 'register'
  const id = (name: string) => `${uid}-${name}`

  // Focus the first field when the screen opens and when the form switches.
  useEffect(() => {
    if (autoFocus) firstRef.current?.focus()
  }, [mode, autoFocus])

  useEffect(() => {
    if (!leaving) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => doneRef.current(), reduced ? 0 : LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  const errors: Record<string, string | null> = register
    ? {
        email: checkEmail(email),
        username: checkUsername(username),
        password: checkPassword(password, username, email),
        confirm: checkConfirm(password, confirm),
      }
    : {
        login: login.trim() === '' ? 'Enter your username or email.' : null,
        password: password === '' ? 'Enter your password.' : null,
      }
  // A field shows its own problem once it was left, and the backend's answer (a taken name) until it is edited.
  // Once you are in, nothing is a mistake any more: the boxes were emptied on purpose, so no error shows while the screen wipes away.
  const shown = (name: string) => (leaving ? null : (serverErrors[name] ?? (touched[name] ? errors[name] : null) ?? null))
  const touch = (name: string) => setTouched((t) => ({ ...t, [name]: true }))
  const edit = (name: string, set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value)
    setServerErrors((prev) => {
      if (!(name in prev)) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
    setFormError(null)
  }

  function switchMode(next: AuthMode) {
    if (busy || next === mode) return
    setMode(next)
    setTouched({})
    setServerErrors({})
    setFormError(null)
    setPassword('')
    setConfirm('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || leaving) return
    const names = register ? ['email', 'username', 'password', 'confirm'] : ['login', 'password']
    setTouched(Object.fromEntries(names.map((n) => [n, true])))
    const first = names.find((n) => errors[n])
    if (first) {
      document.getElementById(id(first))?.focus()
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const user = register
        ? await registerAccount({ email: email.trim(), username: username.trim(), password, password_confirm: confirm })
        : await loginAccount(login.trim(), password)
      play('start')
      setPassword('')
      setConfirm('')
      setLeaving(true)
      onAuthenticated(user)
    } catch (caught) {
      setBusy(false)
      if (caught instanceof ApiError && caught.kind === 'conflict' && caught.field) {
        setServerErrors({ [caught.field]: caught.message })
        document.getElementById(id(caught.field))?.focus()
        return
      }
      setFormError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
      if (!register) {
        // A wrong password is retyped, not edited: the empty field is not an error yet, and it has the cursor.
        setPassword('')
        setTouched((t) => ({ ...t, password: false }))
        document.getElementById(id('password'))?.focus()
      }
    }
  }

  const strength = passwordStrength(password)
  const label = register ? 'Create account' : 'Log in'

  return (
    <div className={leaving ? 'title auth leaving' : 'title auth'} role="dialog" aria-modal="true" aria-label={`Hoops Log, ${label.toLowerCase()}`}>
      <TitleBackdrop />
      <div className="au-stage">
        <header className="au-brand">
          <Logo size={64} />
          <div>
            <span className="au-kicker">HOOPS LOG</span>
            <h1>{register ? 'NEW PLAYER' : 'PLAYER SELECT'}</h1>
          </div>
        </header>

        <div className="au-card">
          <div className="au-switch" role="group" aria-label="Log in or create an account">
            <button type="button" aria-pressed={!register} onClick={() => switchMode('login')}>
              LOG IN
            </button>
            <button type="button" aria-pressed={register} onClick={() => switchMode('register')}>
              SIGN UP
            </button>
          </div>

          {notice && (
            <p className="au-notice" role="status">
              {notice}
            </p>
          )}

          <form onSubmit={(e) => void submit(e)} noValidate aria-label={label}>
            {register ? (
              <>
                <Field id={id('email')} label="Email" error={shown('email')}>
                  {(d) => (
                    <input
                      ref={firstRef}
                      id={id('email')}
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={254}
                      required
                      aria-required="true"
                      aria-invalid={!!shown('email')}
                      aria-describedby={d}
                      value={email}
                      onChange={edit('email', setEmail)}
                      onBlur={() => touch('email')}
                    />
                  )}
                </Field>
                <Field id={id('username')} label="Username" error={shown('username')} hint="3 to 30 letters, digits, _ . or -">
                  {(d) => (
                    <input
                      id={id('username')}
                      name="username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={30}
                      required
                      aria-required="true"
                      aria-invalid={!!shown('username')}
                      aria-describedby={d}
                      value={username}
                      onChange={edit('username', setUsername)}
                      onBlur={() => touch('username')}
                    />
                  )}
                </Field>
              </>
            ) : (
              <Field id={id('login')} label="Username or email" error={shown('login')}>
                {(d) => (
                  <input
                    ref={firstRef}
                    id={id('login')}
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={254}
                    required
                    aria-required="true"
                    aria-invalid={!!shown('login')}
                    aria-describedby={d}
                    value={login}
                    onChange={edit('login', setLogin)}
                    onBlur={() => touch('login')}
                  />
                )}
              </Field>
            )}

            <Field
              id={id('password')}
              label="Password"
              error={shown('password')}
              hint={
                register ? (
                  <span className="au-meter" data-bars={strength.bars}>
                    <span className="au-bars" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{strength.label ? `POWER: ${strength.label}` : 'At least 10 characters'}</span>
                  </span>
                ) : undefined
              }
            >
              {(d) => (
                <input
                  id={id('password')}
                  name="password"
                  type="password"
                  autoComplete={register ? 'new-password' : 'current-password'}
                  maxLength={MAX_PASSWORD}
                  required
                  aria-required="true"
                  aria-invalid={!!shown('password')}
                  aria-describedby={d}
                  value={password}
                  onChange={edit('password', setPassword)}
                  onBlur={() => touch('password')}
                />
              )}
            </Field>

            {register && (
              <Field id={id('confirm')} label="Repeat password" error={shown('confirm')}>
                {(d) => (
                  <input
                    id={id('confirm')}
                    name="password_confirm"
                    type="password"
                    autoComplete="new-password"
                    maxLength={MAX_PASSWORD}
                    required
                    aria-required="true"
                    aria-invalid={!!shown('confirm')}
                    aria-describedby={d}
                    value={confirm}
                    onChange={edit('confirm', setConfirm)}
                    onBlur={() => touch('confirm')}
                  />
                )}
              </Field>
            )}

            <div role="alert" className="au-form-error-slot">
              {formError && <p className="au-form-error">{formError}</p>}
            </div>

            <button type="submit" className="au-go" disabled={busy || leaving}>
              {busy ? 'ONE MOMENT…' : register ? 'CREATE PLAYER' : "LET'S PLAY"}
            </button>
          </form>

          <p className="au-foot">
            {register ? 'Already have a player? ' : 'New here? '}
            <button type="button" className="au-link" onClick={() => switchMode(register ? 'login' : 'register')}>
              {register ? 'Log in' : 'Create an account'}
            </button>
          </p>
        </div>
        <p className="au-privacy">Your shots are private to your account.</p>
      </div>
      <div className="t-flash" aria-hidden="true" />
    </div>
  )
}
