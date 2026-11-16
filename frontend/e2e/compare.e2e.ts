import type { Page } from '@playwright/test'
import { expect, makeShots, openApp, test } from './support'

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Pages' })

test.describe('vs NBA', () => {
  test('with no shots it asks for some instead of inventing a result', async ({ page }) => {
    await openApp(page, 'vs NBA')
    await expect(page.getByText(/vs NBA average/i).first()).toBeVisible()
    await expect(page.locator('.vs-score, [aria-label^="Areas led"]')).toHaveCount(0)
  })

  test('choose a player to compare with: the page, the header and the verdict follow', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 22 }))
    await openApp(page, 'vs NBA')
    await page.locator('.filters').getByRole('combobox').click()
    await page.getByRole('option', { name: /Kevin Durant/ }).click()
    await expect(page.getByText('Yuly vs Kevin Durant')).toBeVisible()
    await expect(page.getByRole('img', { name: /Areas led: Yuly \d+, Kevin Durant \d+/ })).toBeVisible()
  })

  test('the face-off plays by itself once for a pair, closes with its button, and can be replayed', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 23 }))
    await openApp(page, 'vs NBA')
    await page.locator('.filters').getByRole('combobox').click()
    await page.getByRole('option', { name: /Devin Booker/ }).click()
    const faceoff = page.getByRole('dialog', { name: /^Face-off: Yuly against Devin Booker/ })
    await expect(faceoff).toBeVisible()
    await faceoff.getByRole('button').last().click()
    await expect(faceoff).toHaveCount(0)
    // Away and back to the same pair: it does not play again on its own...
    await tabs(page).getByRole('button', { name: 'My log' }).click()
    await tabs(page).getByRole('button', { name: 'vs NBA' }).click()
    await expect(faceoff).toHaveCount(0)
    // ...but the button brings it back, and Escape closes it.
    await page.getByRole('button', { name: /Face-off/ }).click()
    await expect(faceoff).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(faceoff).toHaveCount(0)
  })

  test('the face-off closes by itself after a few seconds', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 24 }))
    await openApp(page, 'vs NBA')
    await page.locator('.filters').getByRole('combobox').click()
    await page.getByRole('option', { name: /LeBron James/ }).click()
    const faceoff = page.getByRole('dialog', { name: /^Face-off:/ })
    await expect(faceoff).toBeVisible()
    await expect(faceoff).toHaveCount(0, { timeout: 15_000 })
  })
})

test.describe('Players', () => {
  test('ranks NBA players by how alike you are, with the closest first and a percentage on each', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 31 }))
    await openApp(page, 'Players')
    await expect(page.getByText(/Yuly shoots most like/)).toBeVisible()
    const cards = page.locator('li').filter({ has: page.getByRole('button', { name: /^Compare my shots|^Comparing now/ }) })
    const texts = await cards.allInnerTexts()
    const matches = texts.slice(0, 8).map((t) => Number(/^(\d{1,3})%$/m.exec(t)?.[1]))
    expect(matches.every((n) => Number.isFinite(n))).toBe(true)
    expect(matches).toEqual([...matches].sort((a, b) => b - a))
    // The sentence at the top names the same player as the first card.
    const first = (await cards.first().locator('h3').innerText()).trim()
    await expect(page.getByText(new RegExp(`Yuly shoots most like ${first}`))).toBeVisible()
    await expect(cards.first()).toContainText(/closest to you/i)
  })

  test('the team filter narrows the grid and "All teams" brings it back', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 32 }))
    await openApp(page, 'Players')
    const team = page.getByRole('group', { name: 'Team' })
    const all = await page.getByRole('button', { name: /^Compare my shots/ }).count()
    await team.getByRole('button', { name: 'Lakers' }).click()
    const lakers = await page.getByRole('button', { name: /^Compare my shots/ }).count()
    expect(lakers).toBeGreaterThan(0)
    expect(lakers).toBeLessThan(all)
    await team.getByRole('button', { name: 'All teams' }).click()
    await expect(page.getByRole('button', { name: /^Compare my shots/ })).toHaveCount(all)
  })

  test('"Compare my shots" sets the baseline: it is pressed here and used on the vs NBA page', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 33 }))
    await openApp(page, 'Players')
    const button = page.getByRole('button', { name: 'Compare my shots with Kevin Durant' })
    await button.click()
    // It takes you to the vs NBA page, set against that player.
    await expect(page.getByText('Yuly vs Kevin Durant')).toBeVisible()
    await expect(tabs(page).getByRole('button', { name: 'vs NBA' })).toHaveAttribute('aria-current', 'page')
    // Back on Players, that player's button says it is the one in use.
    await tabs(page).getByRole('button', { name: 'Players' }).click()
    await expect(page.getByRole('button', { name: 'Comparing now with Kevin Durant' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('your shot card opens full size, downloads as a real PNG, and closes with Escape', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 34 }))
    await openApp(page, 'Players')
    // A mouse clicks the card itself; the button over it is for the keyboard.
    await page.locator('li.player-you').click()
    const dialog = page.getByRole('dialog', { name: 'Shot card of Yuly' })
    await expect(dialog).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download card' }).click()])
    expect(download.suggestedFilename()).toMatch(/\.png$/i)
    const path = await download.path()
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(path)
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(bytes.length).toBeGreaterThan(10_000)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('the card also opens from the keyboard (Tab to its button, Enter), and focus returns when it closes', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 40, { seed: 38 }))
    await openApp(page, 'Players')
    const open = page.getByRole('button', { name: /Open Yuly's shot card at full size/ })
    await open.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Shot card of Yuly' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Shot card of Yuly' })).toHaveCount(0)
    await expect(open).toBeFocused()
  })

  test('a card for a player with a Hebrew name downloads with a usable file name', async ({ page, api }) => {
    await api.seed(makeShots('יולי', 20, { seed: 35 }))
    await openApp(page, 'Players')
    await page.locator('li.player-you').click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download card' }).click()])
    expect(download.suggestedFilename()).toMatch(/\.png$/i)
    expect(download.suggestedFilename().length).toBeGreaterThan(5)
  })
})

test.describe('trophies and levels', () => {
  test('the first made shot unlocks a trophy, and the trophy drawer lists them and closes with Escape', async ({ page, api }) => {
    await openApp(page)
    const badge = page.getByRole('button', { name: /^Trophies: \d+ of \d+ unlocked/ })
    await expect(badge).toHaveAttribute('aria-label', /^Trophies: 0 of/)
    await api.add({ player: 'Yuly', x: 25, y: 6, made: true })
    await page.reload()
    await expect(page.getByRole('button', { name: /^Trophies: [1-9]\d* of/ })).toBeVisible()
    await page.getByRole('button', { name: /^Trophies: / }).click()
    const drawer = page.getByRole('complementary', { name: /Trophies/i }).or(page.locator('[aria-labelledby="trophies-title"]'))
    await expect(drawer.first()).toBeVisible()
    await expect(page.locator('#trophies-title')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#trophies-title')).toBeHidden()
  })

  test('only one drawer is open at a time: the trophy drawer replaces the shot list, and covers its button until it is closed', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 8, { seed: 36 }))
    await openApp(page)
    await page.locator('button.drawer-toggle').click()
    await expect(page.locator('#shots-drawer')).toBeVisible()
    await page.getByRole('button', { name: /^Trophies: / }).click()
    await expect(page.locator('button.drawer-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#trophies-title')).toBeVisible()
    // Escape closes the trophies (and only them), and then the shot list opens as usual.
    await page.keyboard.press('Escape')
    await expect(page.locator('#trophies-title')).toBeHidden()
    await page.locator('button.drawer-toggle').click()
    await expect(page.locator('#shots-drawer')).toBeVisible()
    await expect(page.locator('#trophies-title')).toBeHidden()
  })

  test('a big batch of shots lifts the level', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 60, { seed: 37 }))
    await openApp(page)
    const label = await page.getByRole('group', { name: /: level \d+/ }).getAttribute('aria-label')
    expect(Number(/level (\d+)/.exec(label ?? '')![1])).toBeGreaterThanOrEqual(3)
  })
})
