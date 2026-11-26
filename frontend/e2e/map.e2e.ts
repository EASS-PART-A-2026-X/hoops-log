import type { Page } from '@playwright/test'
import { expect, kpi, makeShots, openApp, test } from './support'
import type { ShotRow } from './support'

const stage = (page: Page) => page.locator('.stage-canvas')
const chip = (page: Page, group: 'Shot area' | 'Result', name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true })

async function waitForCourt(page: Page): Promise<void> {
  await expect(stage(page).locator('canvas')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Loading the court…')).toHaveCount(0)
}

/** The same numbers the page should show, worked out from what the backend holds. */
function expected(rows: ShotRow[]) {
  const made = rows.filter((r) => r.made).length
  const threes = rows.filter((r) => r.shot_type === '3PT')
  const threesMade = threes.filter((r) => r.made).length
  return {
    attempts: rows.length,
    fg: Math.round((made / rows.length) * 100),
    three: threes.length === 0 ? null : Math.round((threesMade / threes.length) * 100),
  }
}

test.describe('the 3D court', () => {
  test('the stat tiles match what the backend holds', async ({ page, api }) => {
    const rows = await api.seed(makeShots(37, { seed: 12, makeRate: 0.55 }))
    const want = expected(rows)
    await openApp(page)
    await expect(kpi(page, 'SHOTS')).toHaveText(String(want.attempts))
    await expect(kpi(page, 'FIELD GOAL')).toHaveText(`${want.fg}%`)
    // The data set has threes (checked, so a change to makeShots cannot turn this into a silent no-op).
    expect(want.three).not.toBeNull()
    await expect(kpi(page, 'THREE POINT')).toHaveText(`${want.three}%`)
  })

  test('the zone list adds up to the shots on the court', async ({ page, api }) => {
    const rows = await api.seed(makeShots(45, { seed: 13 }))
    await openApp(page)
    const zones = page.getByRole('complementary', { name: 'Zone breakdown' })
    await expect(zones).toBeVisible()
    const texts = await zones.getByText(/^\d+\/\d+ · \d+%$/).allInnerTexts()
    const attempts = texts.map((t) => Number(t.split('/')[1]!.split(' ')[0])).reduce((a, b) => a + b, 0)
    const made = texts.map((t) => Number(t.split('/')[0])).reduce((a, b) => a + b, 0)
    expect(attempts).toBe(rows.length)
    expect(made).toBe(rows.filter((r) => r.made).length)
  })

  test('the Area and Result filters change the tiles, and "All shots / Made + missed" brings everything back', async ({ page, api }) => {
    const rows = await api.seed(makeShots(50, { seed: 14 }))
    const threes = rows.filter((r) => r.shot_type === '3PT')
    const paint = rows.filter((r) => r.zone === 'paint' || r.zone === 'restricted_area')
    await openApp(page)

    await chip(page, 'Shot area', 'Threes').click()
    await expect(chip(page, 'Shot area', 'Threes')).toHaveAttribute('aria-pressed', 'true')
    await expect(kpi(page, 'SHOTS')).toHaveText(String(threes.length))

    await chip(page, 'Shot area', 'Paint').click()
    await expect(kpi(page, 'SHOTS')).toHaveText(String(paint.length))

    await chip(page, 'Shot area', 'All shots').click()
    await chip(page, 'Result', 'Made').click()
    await expect(kpi(page, 'SHOTS')).toHaveText(String(rows.filter((r) => r.made).length))
    await expect(kpi(page, 'FIELD GOAL')).toHaveText('100%')

    await chip(page, 'Result', 'Missed').click()
    await expect(kpi(page, 'SHOTS')).toHaveText(String(rows.filter((r) => !r.made).length))
    await expect(kpi(page, 'FIELD GOAL')).toHaveText('0%')

    await chip(page, 'Result', 'Made + missed').click()
    await expect(kpi(page, 'SHOTS')).toHaveText(String(rows.length))
  })

  test('a filter with nothing in it says so instead of showing a broken court', async ({ page, api }) => {
    await api.seed([{ x: 25, y: 6, made: true }])
    await openApp(page)
    await chip(page, 'Result', 'Missed').click()
    await expect(kpi(page, 'SHOTS')).toHaveText('0')
    await expect(page.getByRole('button', { name: /Watch/ })).toBeDisabled()
  })

  test('the three map styles each draw something and the choice sticks while the page is open', async ({ page, api }) => {
    await api.seed(makeShots(30, { seed: 15 }))
    await openApp(page)
    await waitForCourt(page)
    const style = page.getByRole('combobox', { name: /Map style/ })
    for (const name of [/Heat map/, /Flight paths/, /3D beams/]) {
      await style.click()
      await page.getByRole('option', { name }).click()
      await expect(style).toContainText(name)
      await page.waitForTimeout(600)
      expect((await stage(page).screenshot()).length).toBeGreaterThan(20_000)
    }
  })

  test('Replay and Watch session play and can be closed with Escape', async ({ page, api }) => {
    await api.seed(makeShots(12, { seed: 16 }))
    await openApp(page)
    await waitForCourt(page)
    await page.getByRole('button', { name: /Replay/ }).click()
    await page.getByRole('button', { name: /Watch session/ }).click()
    const film = page.getByRole('toolbar', { name: 'Film controls' })
    await expect(film).toBeVisible()
    await expect(page.getByRole('region', { name: /^Shot 1 of \d+:/ })).toBeVisible()
    // Space pauses and resumes; the arrows change shot.
    await page.keyboard.press('Space')
    await expect(film.getByRole('button', { name: 'Play' })).toBeVisible()
    await page.keyboard.press('Space')
    await expect(film.getByRole('button', { name: 'Pause' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('region', { name: /^Shot 2 of \d+:/ })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('region', { name: /^Shot 1 of \d+:/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(film).toHaveCount(0)
  })

  test('the film can be watched to the end and ends on a summary with Watch again and Close', async ({ page, api }) => {
    await api.seed(makeShots(3, { seed: 17 }))
    await openApp(page)
    await waitForCourt(page)
    await page.getByRole('button', { name: /Watch session/ }).click()
    const summary = page.getByRole('dialog', { name: 'Film summary' })
    await expect(summary).toBeVisible({ timeout: 40_000 })
    await summary.getByRole('button', { name: /again/i }).click()
    await expect(page.getByRole('toolbar', { name: 'Film controls' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('toolbar', { name: 'Film controls' })).toHaveCount(0)
  })
})

test.describe('without WebGL', () => {
  test('the flat chart from the backend is shown instead, and the filters that need 3D are switched off', async ({ page, api, guard }) => {
    guard.allow(/Error creating WebGL context/)
    await api.seed(makeShots(10, { seed: 18 }))
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest) as RenderingContext | null
      } as typeof original
    })
    await openApp(page)
    await expect(page.getByText(/flat chart instead/i)).toBeVisible({ timeout: 20_000 })
    // The chart is fetched with the login token and shown from memory (an <img> cannot send the token).
    await expect(page.locator('img[alt^="Shot chart"][src^="blob:"]')).toBeVisible()
    await expect(chip(page, 'Result', 'Made')).toBeDisabled()
  })
})
