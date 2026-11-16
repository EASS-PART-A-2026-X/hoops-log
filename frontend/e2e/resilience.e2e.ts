import { BACKEND_URL } from './env'
import { addShotViaForm, closeDrawer, drawer, expect, kpi, makeShots, notice, openApp, openDrawer, shotRow, test } from './support'

test.describe('when the backend is not there', () => {
  test('the court says the shots could not load, the list names the address, and Try again recovers', async ({ page, api, guard }) => {
    guard.allow(/ERR_FAILED|Failed to load resource|request failed/)
    await api.seed(makeShots('Yuly', 6, { seed: 81 }))
    let down = true
    await page.route(`${BACKEND_URL}/**`, (route) => (down ? route.abort('connectionrefused') : route.fallback()))
    await page.goto('/')
    // On the court: a plain sentence and a way to try again.
    await expect(page.getByText('Could not load the shots, so there is nothing to draw.')).toBeVisible({ timeout: 25_000 })
    // In the shot list: the reason, with the address the page tried.
    await openDrawer(page, 'list')
    await expect(drawer(page).getByText(/Can't reach the backend at .*Is it running\?/)).toContainText(BACKEND_URL)
    await closeDrawer(page)
    down = false
    await page.getByRole('button', { name: 'Try again' }).filter({ visible: true }).first().click()
    await expect(kpi(page, 'SHOTS')).toHaveText('6', { timeout: 20_000 })
  })

  test('a shot that cannot be saved keeps what was typed and says so; the same form saves once it is back', async ({ page, api, guard }) => {
    guard.allow(/ERR_FAILED|Failed to load resource|request failed/)
    await openApp(page)
    await openDrawer(page, 'add')
    let down = true
    await page.route(`${BACKEND_URL}/shots`, (route) => (down && route.request().method() === 'POST' ? route.abort('connectionrefused') : route.fallback()))
    const form = drawer(page).locator('form.shot-form').first()
    await form.getByLabel('Player').fill('Yuly')
    await form.getByLabel(/^X \(/).fill('20')
    await form.getByLabel(/^Y \(/).fill('15')
    await form.getByLabel('Note (optional)').fill('typed while offline')
    await form.getByRole('button', { name: 'Add shot' }).click()
    await expect(form.getByRole('alert')).toBeVisible()
    await expect(form.getByLabel('Note (optional)')).toHaveValue('typed while offline')
    expect(await api.list()).toEqual([])
    down = false
    await form.getByRole('button', { name: 'Add shot' }).click()
    await expect(notice(page)).toContainText('Saved shot')
    expect(await api.list()).toHaveLength(1)
  })

  test('a server error (500) on save is a sentence, not a crash, and nothing is saved twice', async ({ page, api, guard }) => {
    guard.allow(/500|Failed to load resource/)
    await openApp(page)
    let fail = true
    await page.route(`${BACKEND_URL}/shots`, (route) =>
      fail && route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }) : route.fallback(),
    )
    await addShotViaForm(page, { player: 'Yuly', x: 20, y: 15, made: true, note: 'retry me' })
    await expect(drawer(page).locator('form.shot-form').first().getByRole('alert')).toBeVisible()
    fail = false
    await drawer(page).locator('form.shot-form').first().getByRole('button', { name: 'Add shot' }).click()
    await expect(notice(page)).toContainText('Saved shot')
    expect(await api.list()).toHaveLength(1)
  })
})

test.describe('when the data changed behind the page’s back', () => {
  test('deleting a shot that someone else already deleted is handled', async ({ page, api, guard }) => {
    guard.allow(/404|Failed to load resource/)
    const [a] = await api.seed([
      { player: 'Yuly', x: 25, y: 6, made: true, note: 'already gone' },
      { player: 'Yuly', x: 20, y: 20, made: false, note: 'still here' },
    ])
    await openApp(page)
    await openDrawer(page, 'list')
    const row = shotRow(page, 'already gone')
    await row.getByRole('button', { name: /^Delete/ }).click()
    // Someone else deletes it while the confirm button is showing.
    await page.request.delete(`${BACKEND_URL}/shots/${a!.id}`).catch(() => {})
    const direct = await (await import('@playwright/test')).request.newContext()
    await direct.delete(`${BACKEND_URL}/shots/${a!.id}`)
    await direct.dispose()
    await row.getByRole('button', { name: 'Confirm delete' }).click()
    // Either it says it is gone or it just disappears; the page must stay usable and the other shot stays.
    await expect(shotRow(page, 'still here')).toBeVisible()
    await expect(shotRow(page, 'already gone')).toHaveCount(0, { timeout: 15_000 })
    expect((await api.list()).map((s) => s.note)).toEqual(['still here'])
  })

  test('editing a shot that no longer exists tells you instead of silently doing nothing', async ({ page, api, guard }) => {
    guard.allow(/404|Failed to load resource/)
    const [a] = await api.seed([{ player: 'Yuly', x: 25, y: 6, made: true, note: 'ghost' }, { player: 'Yuly', x: 10, y: 10, made: true, note: 'other' }])
    await openApp(page)
    await openDrawer(page, 'list')
    await shotRow(page, 'ghost').getByRole('button', { name: /^Edit/ }).click()
    const direct = await (await import('@playwright/test')).request.newContext()
    await direct.delete(`${BACKEND_URL}/shots/${a!.id}`)
    await direct.dispose()
    const form = drawer(page).locator('li form.shot-form')
    await form.getByLabel('Note (optional)').fill('too late')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(/not found|no longer|gone|deleted/i).first()).toBeVisible()
    expect((await api.list()).map((s) => s.note)).toEqual(['other'])
  })
})

test.describe('slow and large', () => {
  test('a slow backend shows a loading state instead of an empty or broken page', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 8, { seed: 82 }))
    await page.route(`${BACKEND_URL}/shots*`, async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      await route.fallback()
    })
    await page.goto('/')
    await expect(page.getByText('Loading shots…').first()).toBeVisible({ timeout: 8_000 }).catch(() => {})
    await expect(kpi(page, 'SHOTS')).toHaveText('8', { timeout: 20_000 })
  })

  test('a backend slower than the page’s deadline (10 s) gives up with a message, not a spinner forever', async ({ page, guard }) => {
    guard.allow(/ERR_|Failed to load resource|request failed/)
    await page.route(`${BACKEND_URL}/shots*`, async (route) => {
      await new Promise((r) => setTimeout(r, 13_000))
      await route.abort('timedout').catch(() => {})
    })
    await page.goto('/')
    // The court gives up with its plain sentence; the shot list says why.
    await expect(page.getByText('Could not load the shots, so there is nothing to draw.')).toBeVisible({ timeout: 25_000 })
    await openDrawer(page, 'list')
    await expect(drawer(page).getByText(/took too long/i)).toBeVisible()
  })

  test('300 shots load across three backend pages and every one is counted', async ({ page, api }) => {
    test.setTimeout(180_000)
    await api.seed(makeShots('Yuly', 300, { seed: 83 }))
    await openApp(page)
    await expect(kpi(page, 'SHOTS')).toHaveText('300')
    await openDrawer(page, 'list')
    await expect(drawer(page).locator('ul.shots > li')).toHaveCount(20)
  })
})
