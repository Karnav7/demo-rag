import { expect, test } from '@playwright/test'

/**
 * Visual check, not an assertion suite: full-page shots of the chat after a suggested question,
 * light and dark, desktop and phone. Runs only when SHOTS_DIR is set, e.g.
 *   SHOTS_DIR=/tmp/shots npm run e2e -- screenshots
 */
const dir = process.env.SHOTS_DIR

const sizes = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
]

for (const theme of ['light', 'dark'] as const) {
  for (const size of sizes) {
    test(`chat after a suggested question (${theme}, ${size.name})`, async ({ page }) => {
      test.skip(!dir, 'set SHOTS_DIR to capture screenshots')
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.addInitScript((t) => localStorage.setItem('dummy-rag.theme', t), theme)
      await page.goto('./')
      await page.getByRole('group', { name: 'Suggested questions' }).getByRole('button').first().click()
      await expect(page.getByRole('meter', { name: 'Grounding confidence' })).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(1200) // let the meter, chips and graph settle
      await page.screenshot({ path: `${dir}/chat-${theme}-${size.name}.png`, fullPage: true })
    })
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`mid-answer and mid-scroll (${theme}, 1440x900)`, async ({ page }) => {
    test.skip(!dir, 'set SHOTS_DIR to capture screenshots')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript((t) => localStorage.setItem('dummy-rag.theme', t), theme)
    await page.goto('./')
    await page.getByRole('group', { name: 'Suggested questions' }).getByRole('button').nth(1).click()
    await expect(page.getByRole('list', { name: 'Finished stages' })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: `${dir}/busy-${theme}.png` })
    await expect(page.getByRole('meter', { name: 'Grounding confidence' })).toBeVisible({ timeout: 15_000 })
    const box = page.getByRole('textbox', { name: 'Ask a question' })
    await box.fill('Who ultimately owns Meridian Trade LLC?')
    await box.press('Enter')
    await expect(page.getByRole('meter', { name: 'Grounding confidence' }).nth(1)).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(800)
    await page.locator('.chat__scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight / 3 }))
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${dir}/scrolled-${theme}.png` })
  })
}
