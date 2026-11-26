import { addShotViaForm, closeDrawer, dayString, drawer, drawerToggle, expect, kpi, makeShots, notice, openApp, openDrawer, shotRow, test } from './support'

test('an empty log says so, and the first shot gets its zone and type from the backend', async ({ page, api }) => {
  await openApp(page)
  await expect(kpi(page, 'SHOTS')).toHaveText('0')
  await expect(page.getByText('Nothing to break down yet.')).toBeVisible()
  await openDrawer(page, 'list')
  await expect(drawer(page).getByText('No shots yet. Open "Add a shot" to log your first one, or try the demo to see a full court.')).toBeVisible()

  await addShotViaForm(page, { date: dayString(0), x: 2, y: 5, made: true, note: 'first one' })
  await expect(notice(page)).toContainText(/Saved shot #\d+\./)

  // What the browser stored is what the backend says it stored, with the zone and type computed there.
  const rows = await api.list()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ x: 2, y: 5, made: true, note: 'first one', zone: 'left_corner_3', shot_type: '3PT' })

  await openDrawer(page, 'list')
  const row = shotRow(page, 'first one')
  await expect(row).toContainText(/MADE/i)
  await expect(row).toContainText('3PT')
  await expect(row).toContainText('Left corner 3')
  await expect(drawerToggle(page)).toContainText('1')
  await closeDrawer(page)
  await expect(kpi(page, 'SHOTS')).toHaveText('1')
  await expect(kpi(page, 'FIELD GOAL')).toHaveText('100%')
  await expect(kpi(page, 'THREE POINT')).toHaveText('100%')
  // One shot is too few to call a zone hot (areas need 5 shots), so the tile stays empty rather than guess.
  await expect(kpi(page, 'HOTTEST ZONE')).toHaveText('–')
})

test('the form keeps the date for the next shot and clears the rest, and has no player to type', async ({ page }) => {
  await openApp(page)
  await addShotViaForm(page, { date: dayString(2), x: 25, y: 6, made: false, note: 'rim out' })
  await expect(notice(page)).toContainText('Saved shot')
  const form = drawer(page).locator('form.shot-form').first()
  await expect(form.getByLabel('Player')).toHaveCount(0) // the shot is always the account's own
  await expect(form.getByLabel('Game date')).toHaveValue(dayString(2))
  await expect(form.getByLabel(/^X \(/)).toHaveValue('')
  await expect(form.getByLabel(/^Y \(/)).toHaveValue('')
  await expect(form.getByLabel('Note (optional)')).toHaveValue('')
})

test('a saved shot is still there after a reload, and a shot added elsewhere shows up on reload', async ({ page, api }) => {
  await openApp(page)
  await addShotViaForm(page, { x: 20, y: 12, made: true, note: 'persisted' })
  await expect(notice(page)).toContainText('Saved shot')
  await page.reload()
  await expect(kpi(page, 'SHOTS')).toHaveText('1')
  await api.add({ x: 30, y: 30, made: false, note: 'from another client' })
  await page.reload()
  await expect(kpi(page, 'SHOTS')).toHaveText('2')
  await openDrawer(page, 'list')
  await expect(shotRow(page, 'persisted')).toBeVisible()
  await expect(shotRow(page, 'from another client')).toBeVisible()
})

test('edit a shot: the change is saved in the backend and the zone is recomputed', async ({ page, api }) => {
  const [shot] = await api.seed([{ x: 25, y: 6, made: true, note: 'to edit' }])
  await openApp(page)
  await openDrawer(page, 'list')
  await shotRow(page, 'to edit').getByRole('button', { name: /^Edit/ }).click()
  // The row's text is now inputs, so find the form itself (only one shot is edited at a time).
  const form = drawer(page).locator('li form.shot-form')
  await form.getByLabel(/^X \(/).fill('48')
  await form.getByLabel(/^Y \(/).fill('4')
  await form.getByRole('radio', { name: 'Missed' }).check()
  await form.getByLabel('Note (optional)').fill('edited')
  await form.getByRole('button', { name: 'Save changes' }).click()
  await expect(notice(page)).toContainText(`Updated shot #${shot!.id}.`)
  expect(await api.list()).toMatchObject([{ id: shot!.id, x: 48, y: 4, made: false, note: 'edited', zone: 'right_corner_3', shot_type: '3PT' }])
  await expect(shotRow(page, 'edited')).toContainText('Right corner 3')
})

test('cancelling an edit changes nothing', async ({ page, api }) => {
  await api.seed([{ x: 25, y: 6, made: true, note: 'leave me' }])
  await openApp(page)
  await openDrawer(page, 'list')
  await shotRow(page, 'leave me').getByRole('button', { name: /^Edit/ }).click()
  const form = drawer(page).locator('li form.shot-form')
  await form.getByLabel('Note (optional)').fill('changed my mind')
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(shotRow(page, 'leave me')).toBeVisible()
  expect((await api.list())[0]!.note).toBe('leave me')
})

test('delete asks first: Keep keeps it, Confirm removes it from the backend and the screen', async ({ page, api }) => {
  const [shot] = await api.seed([
    { x: 25, y: 6, made: true, note: 'keep this' },
    { x: 10, y: 10, made: false, note: 'delete this' },
  ])
  await openApp(page)
  await openDrawer(page, 'list')
  const row = shotRow(page, 'delete this')
  await row.getByRole('button', { name: /^Delete/ }).click()
  await row.getByRole('button', { name: 'Keep' }).click()
  await expect(row).toBeVisible()
  expect(await api.list()).toHaveLength(2)

  await row.getByRole('button', { name: /^Delete/ }).click()
  await row.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(notice(page)).toContainText(/Deleted shot #\d+\./)
  await expect(shotRow(page, 'delete this')).toHaveCount(0)
  expect((await api.list()).map((s) => s.id)).toEqual([shot!.id])
  await closeDrawer(page)
  await expect(kpi(page, 'SHOTS')).toHaveText('1')
})

test('"Show on map" closes the drawer and selects the shot; clearing the selection (or the row\'s Unselect) lets it go', async ({ page, api }) => {
  await api.seed([{ x: 25, y: 6, made: true, note: 'find me' }, ...makeShots(4, { seed: 2 })])
  await openApp(page)
  await openDrawer(page, 'list')
  await shotRow(page, 'find me').getByRole('button', { name: /^Show on map/ }).click()
  // The drawer steps aside so the court is in view, with a way to clear the selection on it.
  await expect(drawerToggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.stage-clear')).toBeVisible()
  await page.locator('.stage-clear').click()
  await expect(page.locator('.stage-clear')).toHaveCount(0)
  // Selected again from the list, the row offers Unselect.
  await openDrawer(page, 'list')
  await shotRow(page, 'find me').getByRole('button', { name: /^Show on map/ }).click()
  await openDrawer(page, 'list')
  await shotRow(page, 'find me').getByRole('button', { name: /^Unselect/ }).click()
  await expect(page.locator('.stage-clear')).toHaveCount(0)
})

test('XP grows with each saved shot', async ({ page }) => {
  await openApp(page)
  const xp = page.getByRole('progressbar', { name: 'XP to next level' })
  const level = () => page.getByRole('group', { name: /: level \d+/ }).getAttribute('aria-label')
  await expect(page.getByRole('group', { name: /level 1 rookie/i })).toBeVisible()
  let before = Number(await xp.getAttribute('aria-valuenow'))
  expect(before).toBe(0)
  for (let i = 0; i < 3; i++) {
    await addShotViaForm(page, { x: 25, y: 6 + i, made: true })
    await expect(notice(page)).toContainText(`Saved shot`)
    // Each saved shot adds XP (a few points for logging it, more for a make), and three of them stay in level 1.
    await expect.poll(async () => Number(await xp.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
    before = Number(await xp.getAttribute('aria-valuenow'))
  }
  expect(await level()).toMatch(/level 1 rookie/i)
})
