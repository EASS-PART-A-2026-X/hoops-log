import { addShotViaForm, dayString, drawer, expect, fillShotForm, notice, openApp, openDrawer, shotRow, test } from './support'

/** Press Add shot and wait for the backend's answer, so what is checked next is not read before the request is done. */
async function submitAndExpectStatus(page: import('@playwright/test').Page, form: import('@playwright/test').Locator, status: number): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/shots')),
    form.getByRole('button', { name: 'Add shot' }).click(),
  ])
  expect(response.status()).toBe(status)
}

/** The browser's own checks (min, max, required) stop most bad input before it is sent; turn them off to meet the backend's. */
async function skipBrowserChecks(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('form.shot-form').first().evaluate((form) => form.setAttribute('novalidate', ''))
}

test.describe('the browser stops bad input before anything is sent', () => {
  test('an empty form and numbers outside the court each stop at the form, and nothing is sent', async ({ page, api }) => {
    let posts = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/shots')) posts += 1
    })
    await openApp(page)
    await openDrawer(page, 'add')
    const form = drawer(page).locator('form.shot-form').first()
    const submit = async () => {
      await form.getByRole('button', { name: 'Add shot' }).click()
      expect(await form.evaluate((f: HTMLFormElement) => f.checkValidity()), 'the form should be invalid').toBe(false)
    }
    const x = form.getByLabel(/^X \(/)
    const y = form.getByLabel(/^Y \(/)
    // Nothing filled in.
    await submit()
    expect(await x.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true)
    // No position.
    await fillShotForm(form, { x: '', y: '' })
    await submit()
    expect(await y.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true)
    // Outside the court, each way.
    for (const [bad, field, flag] of [
      [{ x: 51, y: 10 }, x, 'rangeOverflow'],
      [{ x: 10, y: 48 }, y, 'rangeOverflow'],
      [{ x: -1, y: 10 }, x, 'rangeUnderflow'],
      [{ x: 10, y: -3 }, y, 'rangeUnderflow'],
    ] as const) {
      await fillShotForm(form, { ...bad })
      await submit()
      expect(await field.evaluate((el: HTMLInputElement, f) => el.validity[f as 'rangeOverflow'], flag), `${JSON.stringify(bad)} ${flag}`).toBe(true)
    }
    expect(posts).toBe(0)
    expect(await api.list()).toEqual([])
  })

  test('the result is always one of Made or Missed (Made is chosen from the start, so it cannot be left out)', async ({ page }) => {
    await openApp(page)
    await openDrawer(page, 'add')
    const form = drawer(page).locator('form.shot-form').first()
    await expect(form.getByRole('radio', { name: 'Made' })).toBeChecked()
    await form.getByRole('radio', { name: 'Missed' }).check()
    await expect(form.getByRole('radio', { name: 'Made' })).not.toBeChecked()
  })

  test('there is no player to type: the shot is the account\'s own, and the form says who will see it', async ({ page }) => {
    await openApp(page)
    await openDrawer(page, 'add')
    await expect(drawer(page).getByLabel('Player')).toHaveCount(0)
    await expect(drawer(page).getByText('Only you will see this shot. It never goes into the demo.')).toBeVisible()
  })
})

test.describe('the backend has the last word, and the form says what it said', () => {
  test('numbers outside the court come back as a plain sentence, and what you typed stays', async ({ page, api, guard }) => {
    guard.allow(/^http 422 POST \S+\/shots$/)
    await openApp(page)
    await openDrawer(page, 'add')
    await skipBrowserChecks(page)
    const form = drawer(page).locator('form.shot-form').first()
    await fillShotForm(form, { x: 60, y: 10, note: 'keep me' })
    await submitAndExpectStatus(page, form, 422)
    const alert = form.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).not.toContainText('{')
    await expect(alert).not.toContainText('loc')
    await expect(form.getByLabel(/^X \(/)).toHaveValue('60')
    await expect(form.getByLabel('Note (optional)')).toHaveValue('keep me')
    expect(await api.list()).toEqual([])
    // Fix the number and the same form saves.
    await form.getByLabel(/^X \(/).fill('40')
    await form.getByRole('button', { name: 'Add shot' }).click()
    await expect(notice(page)).toContainText('Saved shot')
    expect(await api.list()).toHaveLength(1)
  })

  test('a game date in the future is refused', async ({ page, api, guard }) => {
    guard.allow(/^http 422 POST \S+\/shots$/)
    await openApp(page)
    await openDrawer(page, 'add')
    await skipBrowserChecks(page)
    const form = drawer(page).locator('form.shot-form').first()
    await fillShotForm(form, { date: '2999-01-01', x: 20, y: 20 })
    await submitAndExpectStatus(page, form, 422)
    await expect(form.getByRole('alert')).toContainText(/future/i)
    expect(await api.list()).toEqual([])
  })

  test('a note longer than 200 characters is refused by the backend, not cut silently', async ({ page, api, guard }) => {
    guard.allow(/^http 422 POST \S+\/shots$/)
    await openApp(page)
    await openDrawer(page, 'add')
    await skipBrowserChecks(page)
    const form = drawer(page).locator('form.shot-form').first()
    await fillShotForm(form, { x: 20, y: 20 })
    // The input's own maxLength stops typing at 200, so set the value the way a script would.
    await form.getByLabel('Note (optional)').evaluate((el: HTMLInputElement) => {
      el.removeAttribute('maxlength')
    })
    await form.getByLabel('Note (optional)').fill('n'.repeat(201))
    await submitAndExpectStatus(page, form, 422)
    await expect(form.getByRole('alert')).toBeVisible()
    expect(await api.list()).toEqual([])
  })
})

test.describe('odd but valid text is stored as typed and drawn as text, never run', () => {
  test('Hebrew, emoji and accents round-trip', async ({ page, api }) => {
    await openApp(page)
    await addShotViaForm(page, { x: 25, y: 8, made: true, note: 'זריקה יפה 🏀 café' })
    await expect(notice(page)).toContainText('Saved shot')
    expect(await api.list()).toMatchObject([{ note: 'זריקה יפה 🏀 café' }])
    await openDrawer(page, 'list')
    await expect(shotRow(page, 'זריקה יפה')).toBeVisible()
    await page.reload()
    await openDrawer(page, 'list')
    await expect(shotRow(page, 'זריקה יפה')).toBeVisible()
  })

  test('HTML in a note is shown as text and does not run', async ({ page, api }) => {
    let dialogs = 0
    page.on('dialog', (d) => {
      dialogs += 1
      void d.dismiss()
    })
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    await openApp(page)
    await addShotViaForm(page, { x: 25, y: 8, made: true, note: evil })
    await expect(notice(page)).toContainText('Saved shot')
    await openDrawer(page, 'list')
    await expect(shotRow(page, '<script>')).toBeVisible()
    await page.reload()
    await openDrawer(page, 'list')
    await expect(shotRow(page, '<script>')).toBeVisible()
    expect(dialogs).toBe(0)
    expect(await page.locator('img[src="x"]').count()).toBe(0)
    expect(await api.list()).toHaveLength(1)
  })

  test('SQL in the text is just text, and the table is still there afterwards', async ({ page, api }) => {
    await openApp(page)
    await addShotViaForm(page, { x: 25, y: 8, made: true, note: "Robert'); DROP TABLE shot;--" })
    await expect(notice(page)).toContainText('Saved shot')
    await addShotViaForm(page, { x: 20, y: 20, made: false, note: "' OR 1=1 --" })
    await expect(notice(page)).toContainText('Saved shot')
    expect((await api.list()).map((s) => s.note)).toEqual(["Robert'); DROP TABLE shot;--", "' OR 1=1 --"])
  })

  test('spaces around a note are trimmed', async ({ page, api }) => {
    await openApp(page)
    await addShotViaForm(page, { x: 25, y: 8, made: true, note: '   padded   ' })
    await expect(notice(page)).toContainText('Saved shot')
    expect((await api.list())[0]!.note).toBe('padded')
  })
})

test('dates: a shot with a date a week ago is kept as that date', async ({ page, api }) => {
  await openApp(page)
  await addShotViaForm(page, { date: dayString(7), x: 25, y: 8, made: true })
  await expect(notice(page)).toContainText('Saved shot')
  expect((await api.list())[0]!.game_date).toBe(dayString(7))
})
