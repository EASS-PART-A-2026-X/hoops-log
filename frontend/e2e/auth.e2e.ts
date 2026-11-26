import type { Page } from '@playwright/test'
import { BACKEND_URL } from './env'
import { E2E_PASSWORD, addShotViaForm, drawer, expect, fillShotForm, makeAccount, notice, openApp, openDrawer, test, uniqueName } from './support'

// Accounts and the login screen, from both sides: the real browser, and plain HTTP for what a stranger could try.

// The login screen's background is animated all the time, and a headless browser on a CI machine has no graphics card, so every click
// there waits for slow frames. These tests ask for reduced motion (the app switches the animations off for it), except the two that
// watch the wipe away. Even so, a test that logs in twice gets more than the usual minute.
test.describe.configure({ timeout: 120_000 })

const PASSWORD = E2E_PASSWORD
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

const loginDialog = (page: Page) => page.getByRole('dialog', { name: /log in/i })
const createDialog = (page: Page) => page.getByRole('dialog', { name: /create account/i })
const nav = (page: Page) => page.getByRole('navigation', { name: 'Pages' })
const logoutButton = (page: Page) => page.getByRole('button', { name: /^Log out/ })
const storedToken = (page: Page) => page.evaluate(() => window.localStorage.getItem('hoops-token'))

async function fillSignUp(page: Page, who: { email: string; username: string; password?: string; confirm?: string }) {
  const password = who.password ?? PASSWORD
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Username').fill(who.username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Repeat password', { exact: true }).fill(who.confirm ?? password)
}

async function signUp(page: Page, username = uniqueName()) {
  await page.goto('/')
  await page.getByRole('button', { name: 'SIGN UP' }).click()
  await fillSignUp(page, { email: `${username.toLowerCase()}@example.com`, username })
  await page.getByRole('button', { name: 'CREATE PLAYER' }).click()
  await expect(nav(page)).toBeVisible()
  return username
}

async function logIn(page: Page, who: string, password = PASSWORD) {
  await page.getByLabel('Username or email').fill(who)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: "LET'S PLAY" }).click()
}

// ---------------------------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------------------------

test.describe('the login screen', () => {
  test.use({ loggedIn: false, reducedMotion: 'reduce' })

  test.describe('after the title screen', () => {
    test.use({ seenTitle: false })

    test('PRESS START comes first, then the login screen, and the app stays out of sight until you are in', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('button', { name: 'PRESS START' })).toBeVisible()
      await expect(loginDialog(page)).toHaveCount(0)
      await page.getByRole('button', { name: 'PRESS START' }).click({ force: true })
      await expect(loginDialog(page)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'PLAYER SELECT' })).toBeVisible()
      await expect(page.getByLabel('Username or email')).toBeFocused()
      await expect(page.getByRole('button', { name: 'PRESS START' })).toHaveCount(0)
      await expect(nav(page)).toHaveCount(0)
    })
  })

  test('the app is behind the login: nothing is asked of the backend and nothing of the app is on the page', async ({ page }) => {
    const asked: string[] = []
    page.on('request', (r) => {
      if (r.url().startsWith(BACKEND_URL) && !r.url().endsWith('/health')) asked.push(`${r.method()} ${r.url()}`)
    })
    await page.goto('/')
    await expect(loginDialog(page)).toBeVisible()
    await expect(nav(page)).toHaveCount(0)
    await expect(page.locator('button.drawer-toggle')).toHaveCount(0)
    await expect(page.getByText('Where your shots live')).toHaveCount(0)
    expect(asked).toEqual([])
  })

  test('signing up asks for email, username, password and the password again, and every password field is hidden', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    await expect(createDialog(page)).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('Email')).toBeFocused()
    await expect(page.getByLabel('Username')).toHaveAttribute('autocomplete', 'username')
    for (const label of [page.getByLabel('Password', { exact: true }), page.getByLabel('Repeat password', { exact: true })]) {
      await expect(label).toHaveAttribute('type', 'password')
      await expect(label).toHaveAttribute('autocomplete', 'new-password')
    }
    await page.getByLabel('Password', { exact: true }).fill('visible?never')
    expect(await page.locator('input[type=password]').count()).toBe(2)
    expect(await page.locator('input[name=password], input[name=password_confirm]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).type))).toEqual([
      'password',
      'password',
    ])
    await page.getByRole('button', { name: 'LOG IN', exact: true }).click()
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
  })

  test('the eye on a password box shows what is typed, and hides it again', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    const password = page.getByLabel('Password', { exact: true })
    const repeat = page.getByLabel('Repeat password', { exact: true })
    await password.fill('look at me 123')
    await repeat.fill('look at me 123')
    await expect(password).toHaveAttribute('type', 'password') // hidden until you ask
    await page.getByRole('button', { name: 'Show password', exact: true }).click()
    await expect(password).toHaveAttribute('type', 'text')
    await expect(password).toHaveValue('look at me 123')
    await expect(repeat).toHaveAttribute('type', 'password') // the other box has its own eye
    await expect(page.getByText('Enter a password.')).toHaveCount(0) // pressing it is not "leaving" the box
    await page.getByRole('button', { name: 'Hide password', exact: true }).click()
    await expect(password).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show repeated password' }).click()
    await expect(repeat).toHaveAttribute('type', 'text')
    // Back on the log in form everything is hidden again.
    await page.getByRole('button', { name: 'LOG IN', exact: true }).click()
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
  })

  test('every mistake is named before anything is sent', async ({ page }) => {
    const sent: string[] = []
    page.on('request', (r) => {
      if (r.url().startsWith(BACKEND_URL) && r.url().includes('/auth/')) sent.push(r.url())
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    await page.getByRole('button', { name: 'CREATE PLAYER' }).click()
    for (const text of ['Enter your email.', 'Pick a username.', 'Enter a password.', 'Type the password again.']) await expect(page.getByText(text)).toBeVisible()
    await expect(page.getByLabel('Email')).toBeFocused() // the cursor goes to the first problem
    await fillSignUp(page, { email: 'nope', username: 'a b', password: 'short', confirm: 'other' })
    await page.getByRole('button', { name: 'CREATE PLAYER' }).click()
    await expect(page.getByText('That does not look like an email address.')).toBeVisible()
    await expect(page.getByText(/Use 3 to 30 letters/)).toBeVisible()
    await expect(page.getByText('Use at least 10 characters (5 so far).')).toBeVisible()
    await expect(page.getByText('The two passwords do not match.')).toBeVisible()
    expect(sent).toEqual([])
  })

  test('the password meter follows what you type', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('short')
    await expect(page.getByText('POWER: TOO SHORT')).toBeVisible()
    await password.fill('Abcdefghijklm1')
    await expect(page.getByText('POWER: STRONG')).toBeVisible()
  })

  test('the backend refuses a common password even though the form allowed it', async ({ page, guard }) => {
    guard.allow(/http 422 POST .*\/auth\/register/)
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    const name = uniqueName()
    await fillSignUp(page, { email: `${name}@example.com`, username: name, password: 'basketball' })
    await page.getByRole('button', { name: 'CREATE PLAYER' }).click()
    await expect(page.getByRole('alert')).toContainText('too common')
    expect(await storedToken(page)).toBeNull()
    await expect(nav(page)).toHaveCount(0)
  })

  test('signing up logs you in, and a reload keeps you in', async ({ page }) => {
    const name = await signUp(page)
    expect(await storedToken(page)).toMatch(/^[\w-]{40,}$/)
    await expect(logoutButton(page)).toHaveAccessibleName(`Log out ${name}`)
    await page.reload()
    await expect(nav(page)).toBeVisible()
    await expect(loginDialog(page)).toHaveCount(0)
    await expect(logoutButton(page)).toHaveAccessibleName(`Log out ${name}`)
  })

  test('the first shot of a new account is its own, and it is still there after a reload', async ({ page }) => {
    await signUp(page)
    await addShotViaForm(page, { x: 25, y: 10, made: true, note: 'my first one' })
    await expect(notice(page)).toContainText(/Saved shot #\d+\./)
    await page.reload()
    await expect(nav(page)).toBeVisible()
    await expect(page.locator('button.drawer-toggle .drawer-count')).toHaveText('1')
  })

  test('a username that is taken is reported on its field, in any capitals', async ({ page, anonRequest, guard }) => {
    guard.allow(/http 409 POST .*\/auth\/register/)
    const taken = await makeAccount(anonRequest, uniqueName('taken'))
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    await fillSignUp(page, { email: `${uniqueName()}@example.com`, username: taken.username.toUpperCase() })
    await page.getByRole('button', { name: 'CREATE PLAYER' }).click()
    await expect(page.getByText('That username is already used')).toBeVisible()
    await expect(page.getByLabel('Username')).toBeFocused()
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(PASSWORD) // the rest of the form is kept
    expect(await storedToken(page)).toBeNull()
  })

  test('an email that is taken is reported on its field', async ({ page, anonRequest, guard }) => {
    guard.allow(/http 409 POST .*\/auth\/register/)
    const taken = await makeAccount(anonRequest, uniqueName('mail'))
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    await fillSignUp(page, { email: taken.email.toUpperCase(), username: uniqueName() })
    await page.getByRole('button', { name: 'CREATE PLAYER' }).click()
    await expect(page.getByText('That email is already used')).toBeVisible()
  })

  test('a wrong password says so without saying which part was wrong, and the right one gets in', async ({ page, anonRequest, guard }) => {
    guard.allow(/http 401 POST .*\/auth\/login/)
    const who = await makeAccount(anonRequest, uniqueName('login'))
    await page.goto('/')
    await logIn(page, who.username, 'definitely not it')
    await expect(page.getByRole('alert')).toHaveText('Wrong username, email or password.')
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
    await expect(page.getByText('Enter your password.')).toHaveCount(0)
    expect(await storedToken(page)).toBeNull()
    await logIn(page, who.username)
    await expect(nav(page)).toBeVisible()
    await expect(logoutButton(page)).toHaveAccessibleName(`Log out ${who.username}`)
  })

  test.describe('while the screen wipes away', () => {
    // The wipe only exists with motion: these two watch it.
    test.use({ reducedMotion: 'no-preference' })

    // Samples the screen every 20 ms from the moment it is called until the login screen is gone.
    const watchForErrors = (page: Page) =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const seen = new Set<string>()
            const timer = setInterval(() => {
              document.querySelectorAll('.au-error, .au-form-error').forEach((e) => seen.add(e.textContent ?? ''))
              if (!document.querySelector('.title.auth')) {
                clearInterval(timer)
                resolve([...seen])
              }
            }, 20)
          }),
      )

    test('no error shows while the login screen wipes away after logging in', async ({ page, anonRequest }) => {
      const who = await makeAccount(anonRequest, uniqueName('wipe'))
      await page.goto('/')
      await page.getByLabel('Username or email').fill(who.username)
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      const watching = watchForErrors(page)
      await page.getByRole('button', { name: "LET'S PLAY" }).click()
      await expect(nav(page)).toBeVisible()
      expect(await watching).toEqual([]) // the emptied password box is not "Enter your password"
    })

    test('no error shows while the sign up screen wipes away either', async ({ page }) => {
      const name = uniqueName('wipe')
      await page.goto('/')
      await page.getByRole('button', { name: 'SIGN UP' }).click()
      await fillSignUp(page, { email: `${name}@example.com`, username: name })
      const watching = watchForErrors(page)
      await page.getByRole('button', { name: 'CREATE PLAYER' }).click()
      await expect(nav(page)).toBeVisible()
      expect(await watching).toEqual([])
    })
  })

  test('an unknown user gets exactly the same answer as a wrong password', async ({ page, guard }) => {
    guard.allow(/http 401 POST .*\/auth\/login/)
    await page.goto('/')
    await logIn(page, `nobody-${uniqueName()}`, 'whatever whatever')
    await expect(page.getByRole('alert')).toHaveText('Wrong username, email or password.')
  })

  test('logging in works with the email too, in any capitals', async ({ page, anonRequest }) => {
    const who = await makeAccount(anonRequest, uniqueName('mailin'))
    await page.goto('/')
    await logIn(page, who.email.toUpperCase())
    await expect(nav(page)).toBeVisible()
  })

  test('the Enter key sends the form', async ({ page, anonRequest }) => {
    const who = await makeAccount(anonRequest, uniqueName('enter'))
    await page.goto('/')
    await page.getByLabel('Username or email').fill(who.username)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Password', { exact: true }).press('Enter')
    await expect(nav(page)).toBeVisible()
  })

  test('the keyboard alone is enough to sign up', async ({ page }) => {
    const name = uniqueName('kbd')
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).press('Enter')
    await expect(page.getByLabel('Email')).toBeFocused()
    await page.keyboard.type(`${name}@example.com`)
    await page.keyboard.press('Tab')
    await page.keyboard.type(name)
    await page.keyboard.press('Tab')
    await page.keyboard.type(PASSWORD)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Show password', exact: true })).toBeFocused() // the eye is reachable by keyboard
    await page.keyboard.press('Tab')
    await page.keyboard.type(PASSWORD)
    await page.keyboard.press('Enter')
    await expect(nav(page)).toBeVisible()
  })

  test('logging out shows the login screen, forgets the token everywhere, and a reload does not let you back in', async ({ page, anonRequest }) => {
    await signUp(page)
    const token = (await storedToken(page)) ?? ''
    await logoutButton(page).click()
    await expect(loginDialog(page)).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
    await expect(nav(page)).toHaveCount(0)
    expect(await storedToken(page)).toBeNull()
    await page.reload()
    await expect(loginDialog(page)).toBeVisible()
    await expect(nav(page)).toHaveCount(0)
    // The token is dead on the server too, not just forgotten by the page.
    expect((await anonRequest.get(`${BACKEND_URL}/auth/me`, { headers: auth(token) })).status()).toBe(401)
    expect((await anonRequest.get(`${BACKEND_URL}/shots`, { headers: auth(token) })).status()).toBe(401)
  })

  test('logging out with a login that had already ended just shows the login screen, with no "login ended" notice', async ({ page, anonRequest, guard }) => {
    guard.allow(/http 401 POST .*\/auth\/logout/)
    await signUp(page)
    const token = (await storedToken(page)) ?? ''
    expect((await anonRequest.post(`${BACKEND_URL}/auth/logout`, { headers: auth(token) })).status()).toBe(204) // ended elsewhere
    await logoutButton(page).click()
    await expect(loginDialog(page)).toBeVisible()
    await expect(page.getByText('Your login ended')).toHaveCount(0) // you asked to log out: nothing "ended" on you
    expect(await storedToken(page)).toBeNull()
  })

  test('the next person on the same computer gets an empty app, not the last one’s shots', async ({ page, anonRequest }) => {
    const first = await makeAccount(anonRequest, uniqueName('first'))
    for (let i = 0; i < 3; i++) {
      const r = await anonRequest.post(`${BACKEND_URL}/shots`, { headers: auth(first.token), data: { note: 'First Player shot', x: 20 + i, y: 10, made: true } })
      expect(r.status()).toBe(201)
    }
    const second = await makeAccount(anonRequest, uniqueName('second'))
    await page.goto('/')
    await logIn(page, first.username)
    await expect(page.locator('button.drawer-toggle .drawer-count')).toHaveText('3')
    await logoutButton(page).click()
    await expect(loginDialog(page)).toBeVisible()
    await logIn(page, second.username)
    await expect(nav(page)).toBeVisible()
    await openDrawer(page, 'list')
    await expect(drawer(page).getByText('No shots yet. Open "Add a shot" to log your first one, or try the demo to see a full court.')).toBeVisible()
    await expect(page.getByText('First Player shot')).toHaveCount(0)
  })

  test('when the login ends while you are typing a shot, the login screen opens on top and the half-typed shot is still there afterwards', async ({ page, anonRequest, guard }) => {
    guard.allow(/http 401 (POST|GET) /)
    const who = await signUp(page)
    const token = (await storedToken(page)) ?? ''
    await openDrawer(page, 'add')
    await fillShotForm(drawer(page), { x: 31, y: 12, note: 'Half Typed' })
    // Somewhere else (another device, say) this login is ended.
    expect((await anonRequest.post(`${BACKEND_URL}/auth/logout`, { headers: auth(token) })).status()).toBe(204)
    await drawer(page).getByRole('button', { name: 'Add shot' }).click()
    await expect(loginDialog(page)).toBeVisible()
    await expect(page.getByText('Your login ended. Please log in again.').first()).toBeVisible()
    expect(await storedToken(page)).toBeNull()
    await logIn(page, who)
    await expect(loginDialog(page)).toHaveCount(0)
    await expect(drawer(page).getByLabel('Note (optional)')).toHaveValue('Half Typed')
    await expect(drawer(page).getByLabel(/^X \(/)).toHaveValue('31')
    // And it saves now.
    await drawer(page).getByRole('button', { name: 'Add shot' }).click()
    await expect(notice(page)).toContainText(/Saved shot #\d+\./)
  })

  test('a login that is no longer good at page load goes to the login screen with a sentence about it', async ({ page, anonRequest, guard }) => {
    guard.allow(/http 401 GET .*\/auth\/me/)
    const who = await makeAccount(anonRequest, uniqueName('stale'))
    await anonRequest.post(`${BACKEND_URL}/auth/logout`, { headers: auth(who.token) })
    await page.addInitScript((token) => window.localStorage.setItem('hoops-token', token), who.token)
    await page.goto('/')
    await expect(loginDialog(page)).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Your login ended' })).toBeVisible()
    await expect(nav(page)).toHaveCount(0)
  })

  test('a phone-sized screen can reach every field and the button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'CREATE PLAYER' }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'CREATE PLAYER' })).toBeInViewport()
    await page.getByLabel('Email').scrollIntoViewIfNeeded()
    await expect(page.getByLabel('Email')).toBeInViewport()
  })

  test('a short window scrolls to the button instead of cutting it off', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 520 })
    await page.goto('/')
    await page.getByRole('button', { name: 'SIGN UP' }).click()
    await page.getByRole('button', { name: 'CREATE PLAYER' }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'CREATE PLAYER' })).toBeInViewport()
  })
})

test.describe('someone who is logged in', () => {
  test('goes straight to the app and sees only their own shots', async ({ page, api, anonRequest }) => {
    await api.add({ x: 25, y: 10, made: true, note: 'Mine only' })
    const other = await makeAccount(anonRequest, uniqueName('other'))
    await anonRequest.post(`${BACKEND_URL}/shots`, { headers: auth(other.token), data: { note: 'Theirs only', x: 30, y: 12, made: false } })
    await openApp(page)
    await expect(page.locator('button.drawer-toggle .drawer-count')).toHaveText('1')
    await openDrawer(page, 'list')
    await expect(page.getByText('Mine only').first()).toBeVisible()
    await expect(page.getByText('Theirs only')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Plain HTTP: what a stranger with curl can and cannot do
// ---------------------------------------------------------------------------------------------

test.describe('the API is locked', () => {
  const LOCKED: [string, string, Record<string, unknown> | undefined][] = [
    ['GET', '/shots', undefined],
    ['POST', '/shots', { x: 1, y: 1, made: true }],
    ['GET', '/shots/1', undefined],
    ['PATCH', '/shots/1', { made: false }],
    ['DELETE', '/shots/1', undefined],
    ['GET', '/chart.svg', undefined],
    ['GET', '/demo/shots', undefined],
    ['GET', '/auth/me', undefined],
    ['POST', '/auth/logout', undefined],
  ]

  test('without a token every route but health, register and login says 401', async ({ anonRequest }) => {
    for (const [method, path, data] of LOCKED) {
      const res = await anonRequest.fetch(`${BACKEND_URL}${path}`, { method, data })
      expect(res.status(), `${method} ${path}`).toBe(401)
      expect(res.headers()['www-authenticate'], `${method} ${path}`).toBe('Bearer')
    }
    expect((await anonRequest.get(`${BACKEND_URL}/health`)).status()).toBe(200)
  })

  test('a made-up, empty, wrong-scheme or query-string token does not work', async ({ anonRequest }) => {
    const real = await makeAccount(anonRequest, uniqueName('real'))
    for (const header of ['Bearer made-up', 'Bearer', 'Basic dXNlcjpwYXNz', real.token, `Token ${real.token}`]) {
      const res = await anonRequest.get(`${BACKEND_URL}/shots`, { headers: { Authorization: header } })
      expect(res.status(), header).toBe(401)
    }
    // A token in the address would end up in logs and history: it is not accepted there.
    expect((await anonRequest.get(`${BACKEND_URL}/shots?token=${real.token}`)).status()).toBe(401)
    expect((await anonRequest.get(`${BACKEND_URL}/shots`, { headers: auth(real.token) })).status()).toBe(200)
  })

  test('register, who am I, log out: the token works until it is ended and then it is dead', async ({ anonRequest }) => {
    const name = uniqueName('life')
    const made = await makeAccount(anonRequest, name)
    const me = await anonRequest.get(`${BACKEND_URL}/auth/me`, { headers: auth(made.token) })
    expect(await me.json()).toEqual({ id: made.id, email: `${name}@example.com`, username: name })
    const again = await anonRequest.post(`${BACKEND_URL}/auth/login`, { data: { login: name, password: PASSWORD } })
    const second = ((await again.json()) as { token: string }).token
    expect(second).not.toBe(made.token)
    expect((await anonRequest.post(`${BACKEND_URL}/auth/logout`, { headers: auth(made.token) })).status()).toBe(204)
    expect((await anonRequest.get(`${BACKEND_URL}/auth/me`, { headers: auth(made.token) })).status()).toBe(401)
    expect((await anonRequest.get(`${BACKEND_URL}/auth/me`, { headers: auth(second) })).status()).toBe(200) // only that login ended
  })

  test('a login answer is never cached and carries no password, hash or salt', async ({ anonRequest }) => {
    const name = uniqueName('safe')
    const res = await anonRequest.post(`${BACKEND_URL}/auth/register`, {
      data: { email: `${name}@example.com`, username: name, password: PASSWORD, password_confirm: PASSWORD },
    })
    expect(res.status()).toBe(201)
    expect(res.headers()['cache-control']).toBe('no-store')
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
    const text = await res.text()
    for (const secret of [PASSWORD, 'scrypt', 'password_hash']) expect(text).not.toContain(secret)
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['expires_at', 'token', 'token_type', 'user'])
    expect((await anonRequest.get(`${BACKEND_URL}/health`)).headers()['x-content-type-options']).toBe('nosniff')
  })

  test('two accounts never see, change, delete or draw each other’s shots', async ({ anonRequest }) => {
    const a = await makeAccount(anonRequest, uniqueName('alice'))
    const b = await makeAccount(anonRequest, uniqueName('bob'))
    const made = await anonRequest.post(`${BACKEND_URL}/shots`, { headers: auth(a.token), data: { note: 'Alice Only', x: 25, y: 10, made: true } })
    const shot = (await made.json()) as { id: number }
    expect((await anonRequest.get(`${BACKEND_URL}/shots`, { headers: auth(b.token) })).status()).toBe(200)
    expect(await (await anonRequest.get(`${BACKEND_URL}/shots`, { headers: auth(b.token) })).json()).toEqual([])
    const missing = await anonRequest.get(`${BACKEND_URL}/shots/99999999`, { headers: auth(b.token) })
    for (const [method, data] of [['GET', undefined], ['PATCH', { made: false }], ['DELETE', undefined]] as const) {
      const res = await anonRequest.fetch(`${BACKEND_URL}/shots/${shot.id}`, { method, data, headers: auth(b.token) })
      expect(res.status(), method).toBe(404)
      expect(await res.json(), method).toEqual(await missing.json()) // the same words as a shot that does not exist
    }
    // The chart is drawn from the caller's own shots and titles each mark with the account's name.
    expect(await (await anonRequest.get(`${BACKEND_URL}/chart.svg`, { headers: auth(b.token) })).text()).not.toContain(`${a.username}:`)
    expect(await (await anonRequest.get(`${BACKEND_URL}/chart.svg`, { headers: auth(a.token) })).text()).toContain(`${a.username}:`)
    const still = await anonRequest.get(`${BACKEND_URL}/shots/${shot.id}`, { headers: auth(a.token) })
    expect(await still.json()).toMatchObject({ id: shot.id, player: a.username, note: 'Alice Only', made: true })
  })

  test('nobody can say whose a shot is: the owner is not a field, in or out', async ({ anonRequest }) => {
    const a = await makeAccount(anonRequest, uniqueName('owner'))
    const post = await anonRequest.post(`${BACKEND_URL}/shots`, { headers: auth(a.token), data: { x: 1, y: 1, made: true, owner_id: 1 } })
    expect(post.status()).toBe(422)
    const ok = await anonRequest.post(`${BACKEND_URL}/shots`, { headers: auth(a.token), data: { x: 1, y: 1, made: true } })
    expect(await ok.json()).not.toHaveProperty('owner_id')
    expect(await ok.json()).toMatchObject({ player: a.username }) // the server puts the account's name on the shot
    const named = await anonRequest.post(`${BACKEND_URL}/shots`, { headers: auth(a.token), data: { player: 'Someone Else', x: 1, y: 1, made: true } })
    expect(named.status()).toBe(422) // the name cannot be chosen
    const { id } = (await ok.json()) as { id: number }
    expect((await anonRequest.patch(`${BACKEND_URL}/shots/${id}`, { headers: auth(a.token), data: { owner_id: 1 } })).status()).toBe(422)
  })

  test('sign-up rules hold over HTTP too, and nothing is created by a refused one', async ({ anonRequest }) => {
    const name = uniqueName('rules')
    const base = { email: `${name}@example.com`, username: name, password: PASSWORD, password_confirm: PASSWORD }
    const refused: [string, Record<string, unknown>][] = [
      ['passwords differ', { password_confirm: PASSWORD + 'x' }],
      ['too short', { password: 'short', password_confirm: 'short' }],
      ['too long', { password: 'x'.repeat(129), password_confirm: 'x'.repeat(129) }],
      ['too common', { password: 'password123', password_confirm: 'password123' }],
      ['bad email', { email: 'not-an-email' }],
      ['bad username', { username: 'a b' }],
      ['unknown field', { is_admin: true }],
      ['a null byte in the password', { password: `${PASSWORD}\u0000`, password_confirm: `${PASSWORD}\u0000` }],
    ]
    for (const [what, change] of refused) {
      const res = await anonRequest.post(`${BACKEND_URL}/auth/register`, { data: { ...base, ...change } })
      expect(res.status(), what).toBe(422)
    }
    // None of them made an account: the name is still free.
    expect((await anonRequest.post(`${BACKEND_URL}/auth/register`, { data: base })).status()).toBe(201)
    const twice = await anonRequest.post(`${BACKEND_URL}/auth/register`, { data: { ...base, email: `other-${name}@example.com`, username: name.toUpperCase() } })
    expect(twice.status()).toBe(409)
  })

  test('strange login input is a 401 or a 422, never a 500', async ({ anonRequest }) => {
    for (const login of ["' OR 1=1 --", '"; DROP TABLE account; --', '%', '<script>alert(1)</script>', 'null', '\u0000', '🏀'.repeat(50), 'עברית']) {
      const res = await anonRequest.post(`${BACKEND_URL}/auth/login`, { data: { login, password: 'whatever whatever' } })
      expect([401, 422], JSON.stringify(login)).toContain(res.status())
    }
    for (const data of [{}, { login: 'x' }, { password: 'x' }, { login: 'x'.repeat(300), password: 'x' }, { login: 1, password: 2 }, 'text', []]) {
      const res = await anonRequest.post(`${BACKEND_URL}/auth/login`, { data: data as Record<string, unknown> })
      expect(res.status(), JSON.stringify(data)).toBe(422)
    }
  })

  test('wrong-password and unknown-user answers are identical', async ({ anonRequest }) => {
    const who = await makeAccount(anonRequest, uniqueName('same'))
    const wrong = await anonRequest.post(`${BACKEND_URL}/auth/login`, { data: { login: who.username, password: 'not the password' } })
    const unknown = await anonRequest.post(`${BACKEND_URL}/auth/login`, { data: { login: `nobody-${uniqueName()}`, password: 'not the password' } })
    expect(wrong.status()).toBe(401)
    expect(unknown.status()).toBe(401)
    expect(await wrong.json()).toEqual(await unknown.json())
  })
})
