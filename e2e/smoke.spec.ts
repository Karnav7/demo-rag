import { expect, test, type Page } from '@playwright/test'

/** Click the first suggested question and wait for the finished answer. */
async function askSuggested(page: Page) {
  const chip = page.getByRole('group', { name: 'Suggested questions' }).getByRole('button').first()
  await chip.click()
  await expect(page.getByRole('article', { name: 'Answer' }).getByRole('meter', { name: 'Grounding confidence' })).toBeVisible({
    timeout: 15_000,
  })
}

function evidenceTab(page: Page, name: string) {
  return page.getByRole('complementary', { name: 'Evidence' }).getByRole('tab', { name: new RegExp(`^${name}`) })
}

test('ask a suggested question; every evidence tab populates', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./')
  await askSuggested(page)
  const panel = page.getByRole('tabpanel')

  await evidenceTab(page, 'Subgraph').click()
  await expect(panel.locator('.g-node').first()).toBeVisible()
  expect(await panel.locator('.g-node').count()).toBeGreaterThanOrEqual(1)

  await evidenceTab(page, 'Facts').click()
  await expect(panel.locator('tbody tr').first()).toBeVisible()

  await evidenceTab(page, 'Sources').click()
  await expect(panel.locator('article.sec').first()).toBeVisible()

  await evidenceTab(page, 'Cypher').click()
  await expect(panel.locator('pre code').first()).toBeVisible()

  await evidenceTab(page, 'Trace').click()
  await expect(panel.getByRole('list', { name: 'Pipeline stages' }).getByRole('listitem').first()).toBeVisible()
})

test('theme toggle persists across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('./')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('dummy-rag.theme'))).toBe('dark')
})

test('reduced motion zeroes transitions', async ({ page }) => {
  const bodyDuration = () => page.evaluate(() => getComputedStyle(document.body).transitionDuration)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('./')
  expect(await bodyDuration()).not.toBe('0s') // the theme cross-fade is normally on
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  expect(await bodyDuration()).toBe('0s')
})

test('narrow viewport 390px: no horizontal scroll, sidebar opens as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./')
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(await overflow()).toBeLessThanOrEqual(0)

  const opener = page.getByRole('button', { name: 'Open conversations' })
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
  await opener.click()
  await expect(opener).toHaveAttribute('aria-expanded', 'true')
  const drawer = page.getByRole('dialog', { name: 'Conversations menu' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'New conversation' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(opener).toHaveAttribute('aria-expanded', 'false')

  // Still no horizontal scroll once an answer (with its tables and code) is on screen.
  await askSuggested(page)
  expect(await overflow()).toBeLessThanOrEqual(0)
})

test('blocked storage: the app still answers a question', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage is blocked', 'SecurityError')
      },
    })
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./')
  await askSuggested(page)
  await expect(page.getByRole('article', { name: 'Answer' }).locator('.msg__body')).not.toBeEmpty()
  expect(errors).toEqual([])
})

test('guide and architecture pages load on demand from the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./')
  await page.getByRole('link', { name: /Guide/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Every feature explained' })).toBeVisible()
  await page.getByRole('link', { name: 'Architecture' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Hybrid Graph-RAG, end to end' })).toBeVisible()
  await page.goto('./#/no-such-page')
  await expect(page.getByRole('group', { name: 'Suggested questions' })).toBeVisible()
})
