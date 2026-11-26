import { BACKEND_URL } from './env'
import { addShotViaForm, closeDrawer, drawer, expect, kpi, makeShots, notice, openApp, openDrawer, shotRow, test } from './support'

test.describe('when the backend is not there', () => {
  test('the court says the shots could not load, the list names the address, and Try again recovers', async ({ page, api, guard }) => {
    // Only the shot list's own request, and the check of the stored login that runs first, are refused on purpose;
    // any other failed request still fails the test.
    guard.allow(/^request failed: GET \S+\/shots\?\S* net::ERR_CONNECTION_REFUSED$/)
    guard.allow(/^request failed: GET \S+\/auth\/me net::ERR_CONNECTION_REFUSED$/)
    await api.seed(makeShots(6, { seed: 81 }))
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
    guard.allow(/^request failed: POST \S+\/shots net::ERR_CONNECTION_REFUSED$/)
    await openApp(page)
    await openDrawer(page, 'add')
    let down = true
    await page.route(`${BACKEND_URL}/shots`, (route) => (down && route.request().method() === 'POST' ? route.abort('connectionrefused') : route.fallback()))
    const form = drawer(page).locator('form.shot-form').first()
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
    guard.allow(/^http 500 POST \S+\/shots$/)
    await openApp(page)
    let fail = true
    await page.route(`${BACKEND_URL}/shots`, (route) =>
      fail && route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }) : route.fallback(),
    )
    await addShotViaForm(page, { x: 20, y: 15, made: true, note: 'retry me' })
    await expect(drawer(page).locator('form.shot-form').first().getByRole('alert')).toBeVisible()
    fail = false
    await drawer(page).locator('form.shot-form').first().getByRole('button', { name: 'Add shot' }).click()
    await expect(notice(page)).toContainText('Saved shot')
    expect(await api.list()).toHaveLength(1)
  })
})

test.describe('when the data changed behind the page’s back', () => {
  test('deleting a shot that someone else already deleted says so, and the list is refreshed', async ({ page, api, guard }) => {
    guard.allow(/^http 404 DELETE \S+\/shots\/\d+$/)
    const [gone] = await api.seed([
      { x: 25, y: 6, made: true, note: 'already gone' },
      { x: 20, y: 20, made: false, note: 'still here' },
    ])
    await openApp(page)
    await openDrawer(page, 'list')
    const row = shotRow(page, 'already gone')
    await row.getByRole('button', { name: /^Delete/ }).click()
    // Someone else deletes it while the confirm button is showing.
    await api.remove(gone!.id)
    await row.getByRole('button', { name: 'Confirm delete' }).click()
    await expect(notice(page)).toContainText('That shot no longer exists. The list has been refreshed.')
    await expect(shotRow(page, 'already gone')).toHaveCount(0)
    await expect(shotRow(page, 'still here')).toBeVisible()
    expect((await api.list()).map((s) => s.note)).toEqual(['still here'])
  })

  test('editing a shot that no longer exists says so and does not bring it back', async ({ page, api, guard }) => {
    guard.allow(/^http 404 PATCH \S+\/shots\/\d+$/)
    const [gone] = await api.seed([{ x: 25, y: 6, made: true, note: 'ghost' }, { x: 10, y: 10, made: true, note: 'other' }])
    await openApp(page)
    await openDrawer(page, 'list')
    await shotRow(page, 'ghost').getByRole('button', { name: /^Edit/ }).click()
    await api.remove(gone!.id)
    const form = drawer(page).locator('li form.shot-form')
    await form.getByLabel('Note (optional)').fill('too late')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(notice(page)).toContainText('That shot no longer exists. The list has been refreshed.')
    await expect(shotRow(page, 'ghost')).toHaveCount(0)
    expect((await api.list()).map((s) => s.note)).toEqual(['other'])
  })
})

test.describe('slow and large', () => {
  test('a slow backend shows a loading state instead of an empty or broken page', async ({ page, api }) => {
    await api.seed(makeShots(8, { seed: 82 }))
    // The backend answers when the test says so, not after a guessed number of seconds, so there is no race with a slow machine.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route(`${BACKEND_URL}/shots*`, async (route) => {
      await gate
      await route.fallback()
    })
    await page.goto('/')
    // While the backend thinks, the page says so: the loading text (in the shot list) is there and no empty-log wording is.
    await openDrawer(page, 'list')
    await expect(drawer(page).getByText('Loading shots…')).toBeVisible()
    await expect(drawer(page).getByText('No shots yet.')).toHaveCount(0)
    release()
    await closeDrawer(page)
    await expect(kpi(page, 'SHOTS')).toHaveText('8', { timeout: 20_000 })
  })

  test('a backend slower than the page’s deadline (10 s) gives up with a message, not a spinner forever', async ({ page, guard }) => {
    // The page gives up on its own request at its 10 s deadline (that cancels it), and the test's route then times it out.
    guard.allow(/^request failed: GET \S+\/shots\?\S* net::(ERR_ABORTED|ERR_TIMED_OUT)$/)
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
    await api.seed(makeShots(300, { seed: 83 }))
    await openApp(page)
    await expect(kpi(page, 'SHOTS')).toHaveText('300')
    await openDrawer(page, 'list')
    await expect(drawer(page).locator('ul.shots > li')).toHaveCount(20)
  })
})
