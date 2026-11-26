import type { Page } from '@playwright/test'
import { BACKEND_URL } from './env'
import { addShotViaForm, closeDrawer, drawer, expect, kpi, makeShots, notice, openApp, openDrawer, shotRow, test } from './support'

// A new account has no shots and no player to pick: it starts empty, and can look at a made-up demo (never stored, never its own).

const welcome = (page: Page) => page.getByRole('region', { name: 'Welcome' })
const banner = (page: Page) => page.locator('.demo-banner')
const demoButton = (page: Page) => page.getByRole('button', { name: 'DEMO', exact: true })
const shown = (page: Page) => page.locator('.bug-name')

test.describe('a new account', () => {
  test('sees an empty court with two ways to start, and is told the shots are only its own', async ({ page, api }) => {
    await openApp(page)
    await expect(welcome(page)).toBeVisible()
    await expect(welcome(page).getByText('YOUR LOG IS EMPTY')).toBeVisible()
    await expect(welcome(page).getByRole('button', { name: 'ADD YOUR FIRST SHOT' })).toBeVisible()
    await expect(welcome(page).getByRole('button', { name: 'TRY THE DEMO' })).toBeVisible()
    await expect(welcome(page).getByText(/only yours\. They never go into the demo/)).toBeVisible()
    await expect(kpi(page, 'SHOTS')).toHaveText('0')
    expect(await api.list()).toEqual([]) // nothing was made up for it
  })

  test('there is nobody to choose: no "Shots of" list, and the top bar shows the username', async ({ page }) => {
    await openApp(page)
    await expect(page.getByRole('combobox', { name: /Shots of/ })).toHaveCount(0)
    await expect(shown(page)).toHaveText('e2e-runner')
  })

  test('ADD YOUR FIRST SHOT opens the form, and the saved shot is its own', async ({ page, api }) => {
    await openApp(page)
    await welcome(page).getByRole('button', { name: 'ADD YOUR FIRST SHOT' }).click()
    await expect(drawer(page)).toBeVisible()
    await expect(drawer(page).getByRole('heading', { name: 'Add a shot' })).toBeVisible()
    await expect(drawer(page).getByLabel('Player')).toHaveCount(0)
    await addShotViaForm(page, { x: 25, y: 8, made: true, note: 'my first' })
    await expect(notice(page)).toContainText(/Saved shot #\d+\./)
    expect(await api.list()).toMatchObject([{ player: 'e2e-runner', note: 'my first' }])
    await expect(welcome(page)).toHaveCount(0)
    await expect(kpi(page, 'SHOTS')).toHaveText('1')
  })

  test('the welcome is there without WebGL too', async ({ page, guard }) => {
    guard.allow(/Error creating WebGL context/)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest) as RenderingContext | null
      } as typeof original
    })
    await openApp(page)
    await expect(page.getByText(/flat chart instead/i)).toBeVisible({ timeout: 20_000 })
    await expect(welcome(page)).toBeVisible()
    await expect(welcome(page).getByRole('button', { name: 'TRY THE DEMO' })).toBeVisible()
  })

  test('a phone-sized screen shows the whole welcome', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await expect(welcome(page)).toBeVisible()
    for (const name of ['ADD YOUR FIRST SHOT', 'TRY THE DEMO']) {
      await welcome(page).getByRole('button', { name }).scrollIntoViewIfNeeded()
      await expect(welcome(page).getByRole('button', { name })).toBeInViewport()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test.describe('the demo', () => {
  test('TRY THE DEMO shows 150 made-up shots under a banner that says they are not yours, and stores nothing', async ({ page, api }) => {
    await openApp(page)
    await welcome(page).getByRole('button', { name: 'TRY THE DEMO' }).click()
    await expect(banner(page)).toBeVisible()
    await expect(banner(page)).toContainText('not yours')
    await expect(banner(page)).toContainText('nothing you do here is saved')
    await expect(kpi(page, 'SHOTS')).toHaveText('150')
    await expect(shown(page)).toHaveText('Demo Player')
    await expect(demoButton(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(welcome(page)).toHaveCount(0)
    expect(await api.list()).toEqual([]) // looking at the demo wrote nothing
  })

  test('its shots can be looked at but not added to, changed or deleted', async ({ page }) => {
    await openApp(page)
    await demoButton(page).click()
    await expect(kpi(page, 'SHOTS')).toHaveText('150')
    await openDrawer(page, 'list')
    await expect(drawer(page).getByRole('button', { name: /Add a shot/ })).toHaveCount(0)
    await expect(drawer(page).getByRole('button', { name: /^Edit/ })).toHaveCount(0)
    await expect(drawer(page).getByRole('button', { name: /^Delete/ })).toHaveCount(0)
    await expect(drawer(page).getByText(/#-\d+/)).toHaveCount(0) // no negative numbers on screen
    const first = drawer(page).getByRole('listitem').first()
    await first.getByRole('button', { name: /^Show on map/ }).click()
    await expect(page.locator('.stage-clear')).toBeVisible() // it can be shown on the court
  })

  test('the other pages work on the demo too, under its name', async ({ page }) => {
    await openApp(page)
    await demoButton(page).click()
    await expect(kpi(page, 'SHOTS')).toHaveText('150')
    // Pages are switched with the tabs (a new page load would end the demo).
    const tab = (name: string) => page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name })
    await tab('vs NBA').click()
    await expect(page.getByRole('heading', { name: /^Demo Player vs / })).toBeVisible()
    await tab('Players').click()
    await expect(page.locator('li.player-you')).toBeVisible()
    await expect(banner(page)).toBeVisible() // still the demo on every page
  })

  test('EXIT DEMO brings back your own shots, untouched, and the demo never mixed with them', async ({ page, api }) => {
    const mine = await api.seed(makeShots(3, { seed: 91 }))
    await openApp(page)
    await expect(kpi(page, 'SHOTS')).toHaveText('3')
    await demoButton(page).click()
    await expect(kpi(page, 'SHOTS')).toHaveText('150') // 150, not 153
    await banner(page).getByRole('button', { name: 'EXIT DEMO' }).click()
    await expect(banner(page)).toHaveCount(0)
    await expect(kpi(page, 'SHOTS')).toHaveText('3')
    await expect(shown(page)).toHaveText('e2e-runner')
    await expect(demoButton(page)).toHaveAttribute('aria-pressed', 'false')
    expect((await api.list()).map((s) => s.id)).toEqual(mine.map((s) => s.id)) // the same three, nothing added or removed
  })

  test('the DEMO button in the top bar turns it on and off', async ({ page }) => {
    await openApp(page)
    await demoButton(page).click()
    await expect(banner(page)).toBeVisible()
    await demoButton(page).click()
    await expect(banner(page)).toHaveCount(0)
    await expect(welcome(page)).toBeVisible() // back to the empty court
  })

  test('the demo is gone after a reload: you are back on your own shots', async ({ page }) => {
    await openApp(page)
    await demoButton(page).click()
    await expect(kpi(page, 'SHOTS')).toHaveText('150')
    await page.reload()
    await expect(kpi(page, 'SHOTS')).toHaveText('0')
    await expect(banner(page)).toHaveCount(0)
  })

  test('looking at the demo earns no XP, trophies or toasts for you', async ({ page }) => {
    await openApp(page)
    await demoButton(page).click()
    await expect(kpi(page, 'SHOTS')).toHaveText('150')
    await page.waitForTimeout(1500)
    await expect(page.locator('.game-toast')).toHaveCount(0)
    await banner(page).getByRole('button', { name: 'EXIT DEMO' }).click()
    await expect(page.getByRole('group', { name: /level 1 rookie/i })).toBeVisible() // your own level, untouched
    await expect(page.getByRole('progressbar', { name: 'XP to next level' })).toHaveAttribute('aria-valuenow', '0')
  })

  test('a shot added after the demo is in your list, and the next demo is still 150', async ({ page, api }) => {
    await openApp(page)
    await demoButton(page).click()
    await demoButton(page).click()
    await addShotViaForm(page, { x: 25, y: 8, made: true, note: 'after the demo' })
    await expect(notice(page)).toContainText('Saved shot')
    await openDrawer(page, 'list')
    await expect(shotRow(page, 'after the demo')).toBeVisible()
    await closeDrawer(page) // the drawer covers the top bar
    await demoButton(page).click()
    await expect(kpi(page, 'SHOTS')).toHaveText('150') // the new shot is not in the demo
    expect(await api.list()).toHaveLength(1)
  })
})

test.describe('the demo over plain HTTP', () => {
  test('needs a login, is the same 150 made-up shots every time, and is never stored or writable', async ({ anonRequest, request, api }) => {
    expect((await anonRequest.get(`${BACKEND_URL}/demo/shots`)).status()).toBe(401)
    const first = (await (await request.get(`${BACKEND_URL}/demo/shots`)).json()) as { id: number; player: string; zone: string }[]
    const second = (await (await request.get(`${BACKEND_URL}/demo/shots`)).json()) as typeof first
    expect(first).toHaveLength(150)
    expect(second).toEqual(first)
    expect(new Set(first.map((s) => s.id)).size).toBe(150)
    expect(first.every((s) => s.id < 0 && s.player === 'Demo Player' && s.zone)).toBe(true)
    expect(await api.list()).toEqual([]) // never mixed into the account's own shots
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await request.fetch(`${BACKEND_URL}/demo/shots`, { method })).status(), method).toBe(405)
    }
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await request.fetch(`${BACKEND_URL}/shots/-1`, { method, data: method === 'PATCH' ? { made: false } : undefined })
      expect(res.status(), `${method} a demo id`).toBe(422)
    }
  })
})
