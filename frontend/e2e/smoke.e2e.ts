import { expect, kpi, makeShots, openApp, test } from './support'

test('the app opens on My log with all three pages and no browser errors', async ({ page }) => {
  await openApp(page)
  const nav = page.getByRole('navigation', { name: 'Pages' })
  await expect(nav.getByRole('button')).toHaveText(['My log', 'vs NBA', 'Players'])
  await expect(page.getByRole('button', { name: 'Hoops Log, go to My log' })).toBeVisible()
})

test('the page has a title, a favicon and one main heading structure a reader can follow', async ({ page }) => {
  await openApp(page)
  await expect(page).toHaveTitle(/Hoops Log/i)
  await expect(page.locator('link[rel~="icon"]')).toHaveCount(1)
  expect(await page.locator('h1').count()).toBeLessThanOrEqual(1)
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
  test('the guard that fails a test on browser errors really sees a script error, a console error and a 500', async ({ page, guard }) => {
    await openApp(page)
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('deliberate boom')
      })
      console.error('deliberate console error')
    })
    await page.evaluate(() => fetch('/__nope__').catch(() => {}))
    await expect.poll(() => guard.seen.length).toBeGreaterThanOrEqual(2)
    expect(guard.unexpected().join('\n')).toContain('pageerror: deliberate boom')
    expect(guard.unexpected().join('\n')).toContain('console.error: deliberate console error')
    // Allowed on purpose, so this test itself passes.
    guard.allow(/deliberate/)
  })

  test('the tests refuse to run against the real dev backend on port 8000', async () => {
    const { assertSafeBackend } = await import('./env')
    expect(() => assertSafeBackend('http://localhost:8000')).toThrow(/real dev backend/)
    expect(() => assertSafeBackend('http://127.0.0.1:8011')).not.toThrow()
  })
})

test.describe('the main screens really render (kept here so the fast run catches a broken screen)', () => {
  test('the 3D court draws a court with the shots on it, not a blank canvas', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 11 }))
    await openApp(page)
    await expect(page.locator('.stage-canvas canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Loading the court…')).toHaveCount(0)
    await page.waitForTimeout(1500) // the court makes its entrance
    // A flat colour compresses to a few kB; a lit court with 40 shots does not.
    expect((await page.locator('.stage-canvas').screenshot()).length).toBeGreaterThan(25_000)
    await expect(kpi(page, 'SHOTS')).toHaveText('40')
  })

  test('vs NBA says who leads, from your real shots', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 21, makeRate: 0.6 }))
    await openApp(page, 'vs NBA')
    await expect(page.getByText('Yuly vs NBA average')).toBeVisible()
    await expect(page.getByRole('img', { name: /^Areas led: Yuly \d+, NBA average \d+/ })).toBeVisible()
  })

  test('Deni opens with a 3D figure and his eight questions', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open Deni, the coach' }).click()
    const dialog = page.getByRole('dialog', { name: 'Deni Avdija' })
    await expect(dialog.locator('.deni-stage canvas')).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByRole('list', { name: 'Ask Deni' }).getByRole('button')).toHaveCount(8)
  })
})
