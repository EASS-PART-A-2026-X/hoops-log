import { addShotViaForm, dayString, drawer, expect, fillShotForm, kpi, notice, openApp, openDrawer, shotRow, test } from './support'

/** The browser's own checks (min, max, required) stop most bad input before it is sent; turn them off to meet the backend's. */
async function skipBrowserChecks(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('form.shot-form').first().evaluate((form) => form.setAttribute('novalidate', ''))
}

test.describe('the browser stops bad input before anything is sent', () => {
  test('numbers outside the court, an empty player and a missing result cannot be submitted', async ({ page, api }) => {
    await openApp(page)
    await openDrawer(page, 'add')
    const form = drawer(page).locator('form.shot-form').first()
    // Empty everything: nothing is sent.
    await form.getByRole('button', { name: 'Add shot' }).click()
    // Out of range.
    await fillShotForm(form, { player: 'Yuly', x: 51, y: 10 })
    await form.getByRole('button', { name: 'Add shot' }).click()
    await fillShotForm(form, { player: 'Yuly', x: 10, y: 48 })
    await form.getByRole('button', { name: 'Add shot' }).click()
    await fillShotForm(form, { player: 'Yuly', x: -1, y: 10 })
    await form.getByRole('button', { name: 'Add shot' }).click()
    expect(await api.list()).toEqual([])
    expect(await form.getByLabel(/^X \(/).evaluate((el: HTMLInputElement) => el.validity.rangeUnderflow)).toBe(true)
  })

  test('the player name stops at 50 characters', async ({ page }) => {
    await openApp(page)
    await openDrawer(page, 'add')
    const player = drawer(page).locator('form.shot-form').first().getByLabel('Player')
    await player.pressSequentially('x'.repeat(60))
    await expect(player).toHaveValue('x'.repeat(50))
  })
})

test.describe('the backend has the last word, and the form says what it said', () => {
  test('numbers outside the court come back as a plain sentence, and what you typed stays', async ({ page, api, guard }) => {
    guard.allow(/422/)
    await openApp(page)
    await openDrawer(page, 'add')
    await skipBrowserChecks(page)
    const form = drawer(page).locator('form.shot-form').first()
    await fillShotForm(form, { player: 'Yuly', x: 60, y: 10, note: 'keep me' })
    await form.getByRole('button', { name: 'Add shot' }).click()
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
    guard.allow(/422/)
    await openApp(page)
    await openDrawer(page, 'add')
    await skipBrowserChecks(page)
    const form = drawer(page).locator('form.shot-form').first()
    await fillShotForm(form, { player: 'Yuly', date: '2999-01-01', x: 20, y: 20 })
    await form.getByRole('button', { name: 'Add shot' }).click()
    await expect(form.getByRole('alert')).toContainText(/future/i)
    expect(await api.list()).toEqual([])
  })

  test('a note longer than 200 characters is refused by the backend, not cut silently', async ({ page, api, guard }) => {
    guard.allow(/422/)
    await openApp(page)
    await openDrawer(page, 'add')
    await skipBrowserChecks(page)
    const form = drawer(page).locator('form.shot-form').first()
    await fillShotForm(form, { player: 'Yuly', x: 20, y: 20 })
    // The input's own maxLength stops typing at 200, so set the value the way a script would.
    await form.getByLabel('Note (optional)').evaluate((el: HTMLInputElement) => {
      el.removeAttribute('maxlength')
    })
    await form.getByLabel('Note (optional)').fill('n'.repeat(201))
    await form.getByRole('button', { name: 'Add shot' }).click()
    await expect(form.getByRole('alert')).toBeVisible()
    expect(await api.list()).toEqual([])
  })
})

test.describe('odd but valid text is stored as typed and drawn as text, never run', () => {
  test('Hebrew, emoji and accents round-trip', async ({ page, api }) => {
    await openApp(page)
    await addShotViaForm(page, { player: 'יולי כהן', x: 25, y: 8, made: true, note: 'זריקה יפה 🏀 café' })
    await expect(notice(page)).toContainText('Saved shot')
    expect(await api.list()).toMatchObject([{ player: 'יולי כהן', note: 'זריקה יפה 🏀 café' }])
    await openDrawer(page, 'list')
    await expect(shotRow(page, 'זריקה יפה')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('combobox', { name: /Shots of: יולי כהן/ })).toBeVisible()
  })

  test('HTML in a name or note is shown as text and does not run', async ({ page, api }) => {
    let dialogs = 0
    page.on('dialog', (d) => {
      dialogs += 1
      void d.dismiss()
    })
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    await openApp(page)
    await addShotViaForm(page, { player: evil.slice(0, 50), x: 25, y: 8, made: true, note: evil })
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
    await addShotViaForm(page, { player: "Robert'); DROP TABLE shot;--", x: 25, y: 8, made: true, note: "' OR 1=1 --" })
    await expect(notice(page)).toContainText('Saved shot')
    await addShotViaForm(page, { player: 'Yuly', x: 20, y: 20, made: false })
    await expect(notice(page)).toContainText('Saved shot')
    expect((await api.list()).map((s) => s.player)).toEqual(["Robert'); DROP TABLE shot;--", 'Yuly'])
  })

  test('spaces around the name are trimmed, and a name of only spaces is refused', async ({ page, api, guard }) => {
    guard.allow(/422/)
    await openApp(page)
    await addShotViaForm(page, { player: '   Yuly   ', x: 25, y: 8, made: true })
    await expect(notice(page)).toContainText('for Yuly.')
    expect((await api.list())[0]!.player).toBe('Yuly')
    await addShotViaForm(page, { player: '     ', x: 25, y: 8, made: true })
    await expect(drawer(page).locator('form.shot-form').first().getByRole('alert')).toBeVisible()
    expect(await api.list()).toHaveLength(1)
  })

  test('two players whose names differ only in capitals are one person in the picker', async ({ page, api }) => {
    // KNOWN GAP (see PROGRESS.md, "case-insensitive names everywhere"): the backend's player filter ignores case
    // but the picker lists "yuly" and "YULY" as two people. This test is expected to fail until that is fixed;
    // when it starts passing Playwright reports it, and the line below should be deleted.
    test.fail(true, 'the picker is still case-sensitive')
    await api.seed([
      { player: 'yuly', x: 25, y: 8, made: true },
      { player: 'YULY', x: 20, y: 20, made: false },
    ])
    await openApp(page)
    await page.getByRole('combobox', { name: /^Shots of:/ }).click()
    // "Every player" plus one person, not two.
    await expect(page.getByRole('option')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(kpi(page, 'SHOTS')).toHaveText('2')
  })
})

test('dates: a shot with a date a week ago is kept as that date', async ({ page, api }) => {
  await openApp(page)
  await addShotViaForm(page, { player: 'Yuly', date: dayString(7), x: 25, y: 8, made: true })
  await expect(notice(page)).toContainText('Saved shot')
  expect((await api.list())[0]!.game_date).toBe(dayString(7))
})
