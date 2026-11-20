import { addShotViaForm, dayString, drawer, expect, kpi, notice, openApp, openDrawer, shotRow, test } from './support'
import type { Page } from '@playwright/test'

// "Paste notes": an AI reads the notes and PROPOSES shots; only Save writes them. The AI service here is a
// stand-in (e2e/fake-ai.mjs) whose answer depends on a word in the notes, so the whole chain is real: browser,
// frontend, backend, and the backend's HTTP call to "the AI service".

const NOTES = 'hit one from the right corner, missed one from the left elbow, 2 free throws'

async function findShots(page: Page, text: string, player = 'Yuly'): Promise<void> {
  await openDrawer(page, 'notes')
  await drawer(page).getByLabel('Your notes').fill(text)
  await drawer(page).getByLabel('Save the shots for').fill(player)
  await drawer(page).getByRole('button', { name: 'Find shots' }).click()
}

test.describe('paste notes', () => {
  test('the notes become proposed shots, and nothing is saved until Save is pressed', async ({ page, api }) => {
    await openApp(page)
    await findShots(page, NOTES)
    const panel = drawer(page)
    await expect(panel.getByText('Right corner 3 · 3PT · made')).toBeVisible()
    await expect(panel.getByText('Left elbow · 2PT · missed')).toBeVisible()
    await expect(panel.getByText('caught and shot')).toBeVisible()
    await expect(panel.getByText('hit one from the right corner', { exact: true })).toBeVisible()
    await expect(panel.getByText('Not logged')).toBeVisible()
    await expect(panel.getByText('2 free throws', { exact: true })).toBeVisible()
    await expect(panel.getByText('Read by e2e-fake')).toBeVisible()
    // Looking is not saving.
    expect(await api.list()).toEqual([])

    await panel.getByRole('button', { name: 'Save shot 1' }).click()
    await expect(panel.getByText('Saved ✓')).toBeVisible()
    await expect(notice(page)).toContainText('Saved shot #')
    const saved = await api.list()
    expect(saved).toHaveLength(1)
    // The backend worked out the zone and the shot type itself, from the coordinates.
    expect(saved[0]).toMatchObject({ player: 'Yuly', x: 47.5, y: 3, made: true, note: 'caught and shot', zone: 'right_corner_3', shot_type: '3PT' })
    await expect(kpi(page, 'SHOTS')).toHaveText('1')
    // The second proposal is still waiting, unsaved.
    await expect(panel.getByRole('button', { name: 'Save shot 2' })).toBeVisible()
  })

  test('Save all keeps every open shot, in the order of the notes', async ({ page, api }) => {
    await openApp(page)
    await findShots(page, NOTES)
    await drawer(page).getByRole('button', { name: 'Save all (2)' }).click()
    await expect(drawer(page).getByText('Saved ✓')).toHaveCount(2)
    // One notice for the whole batch, not one per shot.
    await expect(notice(page)).toContainText('Saved 2 shots for Yuly.')
    const saved = await api.list()
    expect(saved.map((s) => [s.x, s.y, s.made, s.zone])).toEqual([
      [47.5, 3, true, 'right_corner_3'],
      [17, 19, false, 'left_elbow'],
    ])
    // The list shows them too.
    await openDrawer(page, 'list')
    await expect(shotRow(page, 'caught and shot')).toBeVisible()
  })

  test('a discarded proposal is never saved', async ({ page, api }) => {
    await openApp(page)
    await findShots(page, NOTES)
    await drawer(page).getByRole('button', { name: 'Discard shot 1' }).click()
    await drawer(page).getByRole('button', { name: 'Save shot 2' }).click()
    await expect(drawer(page).getByText('Saved ✓')).toBeVisible()
    expect((await api.list()).map((s) => s.x)).toEqual([17])
  })

  test('"yesterday" means the players yesterday', async ({ page, api }) => {
    await openApp(page)
    await findShots(page, 'made a layup yesterday')
    await expect(drawer(page).getByText(`Restricted area · 2PT · made · ${dayString(1)}`)).toBeVisible()
    await drawer(page).getByRole('button', { name: 'Save shot 1' }).click()
    await expect(drawer(page).getByText('Saved ✓')).toBeVisible()
    expect((await api.list())[0]?.game_date).toBe(dayString(1))
  })

  test('when the AI needs to know more it asks, and proposes nothing', async ({ page, api }) => {
    await openApp(page)
    await findShots(page, 'played well today, vague session')
    const panel = drawer(page)
    await expect(panel.getByText('Where was each shot taken, and did it go in?')).toBeVisible()
    await expect(panel.getByText(/press Find shots again/)).toBeVisible()
    await expect(panel.getByText('Proposed shots')).toHaveCount(0)
    expect(await api.list()).toEqual([])
  })
})

test.describe('when the AI side fails, the rest of the app does not notice', () => {
  test('the AI service is not available: a plain sentence, the notes stay, and shots can still be added by hand', async ({ page, api, guard }) => {
    guard.allow(/^http 503 POST \S+\/notes\/extract$/)
    await openApp(page)
    await findShots(page, 'simulate down please')
    await expect(drawer(page).getByRole('alert')).toContainText('The AI helper is not available right now. You can still add shots with the form.')
    await expect(drawer(page).getByLabel('Your notes')).toHaveValue('simulate down please')
    // The normal form is untouched.
    await addShotViaForm(page, { player: 'Yuly', x: 25, y: 6, made: true })
    expect(await api.list()).toHaveLength(1)
  })

  test('a busy model says so', async ({ page, guard }) => {
    guard.allow(/^http 429 POST \S+\/notes\/extract$/)
    await openApp(page)
    await findShots(page, 'simulate busy')
    await expect(drawer(page).getByRole('alert')).toContainText('The AI helper is busy. Try again in a minute.')
  })

  test('an answer that breaks the rules is refused, not shown or saved', async ({ page, api, guard }) => {
    guard.allow(/^http 502 POST \S+\/notes\/extract$/)
    await openApp(page)
    await findShots(page, 'simulate garbage')
    await expect(drawer(page).getByRole('alert')).toContainText('The AI helper could not give a usable answer.')
    await expect(drawer(page).getByText('Proposed shots')).toHaveCount(0)
    expect(await api.list()).toEqual([])
  })
})
