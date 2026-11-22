import { BACKEND_URL } from './env'
import { expect, kpi, makeShots, openApp, test } from './support'

test('the app opens on My log with all three pages and no browser errors', async ({ page }) => {
  await openApp(page)
  const nav = page.getByRole('navigation', { name: 'Pages' })
  await expect(nav.getByRole('button')).toHaveText(['My log', 'vs NBA', 'Players'])
  await expect(page.getByRole('button', { name: 'Hoops Log, go to My log' })).toBeVisible()
})

test('the page has a title, a favicon, and a heading for the page it is showing', async ({ page }) => {
  await openApp(page)
  await expect(page).toHaveTitle(/Hoops Log/i)
  await expect(page.locator('link[rel~="icon"]')).toHaveCount(1)
  // The My log page is headed by its own h2. (The only h1 in the app is on the PRESS START screen, so the page itself has
  // none: a possible accessibility gap, written down here so it is a known thing rather than an accident.)
  await expect(page.getByRole('heading', { level: 2, name: 'Where your shots live' })).toBeVisible()
  await expect(page.locator('h1')).toHaveCount(0)
})

test.describe('the PRESS START title screen', () => {
  test.use({ seenTitle: false })

  test('shows first, starts with a click, and does not come back in the same tab', async ({ page }) => {
    await page.goto('/')
    const title = page.getByRole('dialog', { name: 'Hoops Log, press start' })
    await expect(title).toBeVisible()
    await title.getByRole('button').first().click({ force: true })
    await expect(title).toBeHidden({ timeout: 25_000 })
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible()
    await expect(title).toHaveCount(0)
  })

  test('starts with a letter key, but not with Tab or a browser shortcut', async ({ page }) => {
    await page.goto('/')
    const title = page.getByRole('dialog', { name: 'Hoops Log, press start' })
    await expect(title).toBeVisible()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Control+r')
    await expect(title).toBeVisible()
    await page.keyboard.press('x')
    await expect(title).toBeHidden({ timeout: 25_000 })
  })

  test('comes back with ?title even after it was seen', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Hoops Log, press start' })).toBeHidden({ timeout: 25_000 })
    await page.goto('/?title')
    await expect(page.getByRole('dialog', { name: 'Hoops Log, press start' })).toBeVisible()
  })
})

test.describe('the safety net itself', () => {
  test('the guard that fails a test on browser errors sees a script error, a console error, a 500, a failed request, a 404, an alert and a request to the real backend', async ({
    page,
    guard,
  }) => {
    await openApp(page)
    await page.route('**/__boom__', (route) => route.fulfill({ status: 500, body: 'boom' }))
    await page.route('**/__fail__', (route) => route.abort('connectionrefused'))
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('deliberate script error')
      })
      console.error('deliberate console error')
      window.alert('deliberate alert')
    })
    await page.evaluate((backend) => Promise.allSettled([fetch('/__boom__'), fetch('/__fail__'), fetch(`${backend}/shots/999999`), fetch('http://127.0.0.1:8000/shots')]), BACKEND_URL)
    const origin = new URL(page.url()).origin
    const seen = () => guard.seen.join('\n')
    await expect.poll(seen).toContain('blocked: the page asked for http://127.0.0.1:8000/shots')
    for (const line of [
      'pageerror: deliberate script error',
      'console.error: deliberate console error',
      'dialog: alert "deliberate alert"',
      `http 500 GET ${origin}/__boom__`,
      `request failed: GET ${origin}/__fail__`,
      `http 404 GET ${BACKEND_URL}/shots/999999`,
    ]) {
      expect(seen(), line).toContain(line)
    }
    // All of it was on purpose, so this test itself passes (and nothing else is waved through).
    for (const pattern of [/deliberate/, /__boom__|__fail__/, /shots\/999999$/, /:8000\/shots/]) guard.allow(pattern)
    expect(guard.unexpected()).toEqual([])
  })

  test('the tests refuse a backend that is not on this machine, has no port, or is the real dev one', async () => {
    const { assertSafeBackend, assertSafeFrontend } = await import('./env')
    for (const bad of ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://localhost', 'https://example.com:8011', 'http://192.168.1.5:8011', 'nonsense']) {
      expect(() => assertSafeBackend(bad), bad).toThrow(/Refusing/)
    }
    expect(() => assertSafeBackend('http://127.0.0.1:8011')).not.toThrow()
    expect(() => assertSafeFrontend('http://localhost:5173')).toThrow(/Refusing/)
    expect(() => assertSafeFrontend('http://127.0.0.1:5199')).not.toThrow()
  })
})

test.describe('the main screens really render (kept here so the fast run catches a broken screen)', () => {
  test('the 3D court draws a court with the shots on it, not a blank canvas', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 11 }))
    await openApp(page)
    await expect(page.locator('.stage-canvas canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Loading the court…')).toHaveCount(0)
    await expect(kpi(page, 'SHOTS')).toHaveText('40')
    // The canvas really draws something: a picture of the court with the canvas hidden must differ from the normal one
    // (a blank canvas would look the same either way, and an overlay on top shows in both). The court makes its entrance
    // first, so wait for the difference instead of for a fixed time.
    const stage = page.locator('.stage-canvas')
    await expect
      .poll(async () => !(await stage.screenshot()).equals(await stage.screenshot({ style: 'canvas { visibility: hidden !important }' })), { timeout: 20_000 })
      .toBe(true)
  })

  test('vs NBA says who leads, from your real shots', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 21, makeRate: 0.6 }))
    await openApp(page, 'vs NBA')
    await expect(page.getByText('Yuly vs NBA average')).toBeVisible()
    await expect(page.getByRole('img', { name: /^Areas led: Yuly \d+, NBA average \d+/ })).toBeVisible()
  })

  test('Deni opens with a 3D figure and his chat', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open Deni, the coach' }).click()
    const dialog = page.getByRole('dialog', { name: 'Deni Avdija' })
    await expect(dialog.locator('.deni-stage canvas')).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByRole('log', { name: 'Conversation with Deni' })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Message to Deni' })).toBeVisible()
  })
})
