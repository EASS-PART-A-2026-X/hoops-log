import type { Page } from '@playwright/test'
import { closeDrawer, drawer, drawerToggle, expect, kpi, makeShots, notice, openApp, openDrawer, test } from './support'

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)

test.describe('a desktop window', () => {
  test('the My log page fits the window: no page scroll, the court and the tiles are in view', async ({ page, api }) => {
    await api.seed(makeShots(30, { seed: 71 }))
    await page.setViewportSize({ width: 1366, height: 800 })
    await openApp(page)
    await expect(kpi(page, 'SHOTS')).toBeVisible()
    expect(await noPageScroll(page)).toBe(true)
    expect(await noSideScroll(page)).toBe(true)
    const court = await page.locator('.stage-canvas').boundingBox()
    expect(court!.width).toBeGreaterThan(500)
    expect(court!.height).toBeGreaterThan(250)
  })

  test('a short window (680 high) still fits with no page scroll: compact mode', async ({ page, api }) => {
    await api.seed(makeShots(30, { seed: 72 }))
    await page.setViewportSize({ width: 1280, height: 680 })
    await openApp(page)
    await expect(kpi(page, 'SHOTS')).toBeVisible()
    expect(await noPageScroll(page)).toBe(true)
    expect(await noSideScroll(page)).toBe(true)
  })

  test('a very short window (600 high) falls back to a normal scrolling page, never sideways', async ({ page, api }) => {
    await api.seed(makeShots(30, { seed: 78 }))
    await page.setViewportSize({ width: 1280, height: 600 })
    await openApp(page)
    await expect(kpi(page, 'SHOTS')).toBeVisible()
    expect(await noSideScroll(page)).toBe(true)
    // It scrolls down to the rest of the page instead of squeezing everything in.
    expect(await noPageScroll(page)).toBe(false)
  })

  test('the shot list drawer slides over the page and closes with Escape and with its button', async ({ page, api }) => {
    await api.seed(makeShots(10, { seed: 73 }))
    await openApp(page)
    await drawerToggle(page).click()
    await expect(drawer(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await openDrawer(page, 'list')
    await closeDrawer(page)
  })

  test('the drawer lists 20 shots at a time and "Show 20 more" adds the next page', async ({ page, api }) => {
    await api.seed(makeShots(55, { seed: 74 }))
    await openApp(page)
    await openDrawer(page, 'list')
    await expect(drawer(page).locator('ul.shots > li')).toHaveCount(20)
    await drawer(page).getByRole('button', { name: 'Show 20 more (35 not shown)' }).click()
    await expect(drawer(page).locator('ul.shots > li')).toHaveCount(40)
    await drawer(page).getByRole('button', { name: 'Show 15 more (15 not shown)' }).click()
    await expect(drawer(page).locator('ul.shots > li')).toHaveCount(55)
    await expect(drawer(page).getByRole('button', { name: /more \(/ })).toHaveCount(0)
  })
})

test.describe('a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('every page fits the width with no sideways scroll', async ({ page, api }) => {
    await api.seed(makeShots(30, { seed: 75 }))
    await openApp(page)
    expect(await noSideScroll(page)).toBe(true)
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'vs NBA' }).click()
    await expect(page.getByText('e2e-runner vs NBA average')).toBeVisible()
    expect(await noSideScroll(page)).toBe(true)
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Players' }).click()
    await expect(page.getByText(/e2e-runner shoots most like/)).toBeVisible()
    expect(await noSideScroll(page)).toBe(true)
  })

  test('adding a shot works by touch, and the drawer is a dialog that keeps focus inside', async ({ page }) => {
    await openApp(page)
    await drawerToggle(page).tap()
    await expect(page.getByRole('dialog', { name: 'Shots' })).toBeVisible()
    await page.getByRole('button', { name: /Add a shot/ }).tap()
    await drawer(page).getByLabel(/^X \(/).fill('25')
    await drawer(page).getByLabel(/^Y \(/).fill('20')
    await drawer(page).getByRole('button', { name: 'Add shot' }).tap()
    await expect(notice(page)).toContainText('Saved shot')
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('#shots-drawer'))).toBe(true)
    }
  })

  test('Deni’s dialog fits the screen and can be closed', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Open Deni, the coach' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Deni Avdija' })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(391)
    await dialog.getByRole('button', { name: /Close the coach/ }).tap()
    await expect(dialog).toHaveCount(0)
  })
})

test.describe('the keyboard alone', () => {
  test('a person can log a shot without a mouse: Tab to Shots, open, fill, submit, close', async ({ page, api }) => {
    await openApp(page)
    await drawerToggle(page).focus()
    await page.keyboard.press('Enter')
    await expect(drawer(page)).toBeVisible()
    await page.getByRole('button', { name: /Add a shot/ }).focus()
    await page.keyboard.press('Enter')
    // (The date field is three segments to Tab through, so jump to the fields with typing in them.)
    await drawer(page).getByLabel(/^X \(/).focus()
    await page.keyboard.type('30')
    await page.keyboard.press('Tab')
    await page.keyboard.type('12')
    await page.keyboard.press('Enter') // submits the form
    await expect(notice(page)).toContainText('Saved shot')
    expect(await api.list()).toMatchObject([{ player: 'e2e-runner', x: 30, y: 12 }])
    await page.keyboard.press('Escape')
    await expect(drawerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(drawerToggle(page)).toBeFocused()
  })
})
