/**
 * Landing page contract for Mero Pass.
 *
 * Hand-owned, like the page (src/pages/landing): Mero Pass left the fleet's
 * generated landing to be built in the calimero.network language. Needs no
 * node and no auth — the landing is the unauthenticated front door, so a plain
 * vite server is the whole harness.
 */
import { expect, test } from '@playwright/test';

const CHAPTERS = ['difference', 'how', 'inside', 'security', 'compare', 'faq'];

test.describe('Mero Pass landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the hero says what it is and offers the way in', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Your team’s passwords.',
    );
    await expect(
      page.getByRole('button', { name: 'Connect to node' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Get Calimero Desktop' }).first(),
    ).toHaveAttribute('href', 'https://calimero.network/download');
  });

  test('every chapter is on the page, numbered in order', async ({ page }) => {
    for (const id of CHAPTERS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    const numbers = await page.locator('.mp-ld-marker__n').allTextContents();
    expect(numbers).toEqual(['01', '02', '03', '04', '05', '06']);
  });

  test('the header links to chapters that exist', async ({ page }) => {
    const hrefs = await page
      .locator('.mp-ld-header__nav a')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      await expect(page.locator(href as string)).toHaveCount(1);
    }
  });

  test('is charcoal even when the app is set to light', async ({ page }) => {
    // The marketing surfaces are dark only, like calimero.network and the
    // Cloud site; the app's light choice must not leak onto the front door.
    await page.evaluate(() => localStorage.setItem('mero-pass:theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('landing')).toHaveCSS(
      'background-color',
      'rgb(19, 18, 21)',
    );
  });

  test('the Cloud band links to Calimero Cloud', async ({ page }) => {
    await expect(
      page.getByRole('link', { name: 'Explore Calimero Cloud' }),
    ).toHaveAttribute('href', 'https://cloud.calimero.network');
  });

  test('the comparison is honest about autofill', async ({ page }) => {
    const row = page.locator('.mp-ld-table tr', {
      hasText: 'Browser autofill',
    });
    await expect(row.locator('td').first()).toHaveText('Not yet');
  });

  test('FAQ answers open', async ({ page }) => {
    const first = page.locator('.mp-ld-faq__item').first();
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');
  });

  test('Connect to node opens the node picker', async ({ page }) => {
    await page.getByRole('button', { name: 'Connect to node' }).first().click();
    // mero-react's LoginModal, rendered over the page rather than on a second
    // page — the dialog is what matters, not its exact copy.
    await expect(page.getByText('Connect to Calimero')).toBeVisible();
  });

  test('/docs and /preview land on the page, at their chapter', async ({
    page,
  }) => {
    for (const [path, id] of [
      ['/docs', 'how'],
      ['/preview', 'inside'],
    ]) {
      await page.goto(path);
      await expect(page.getByTestId('landing')).toBeVisible();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
  });

  for (const width of [390, 320]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
