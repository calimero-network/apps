// Images in a document: an upload shows, a file that is not an allowed image
// or is over the cap is refused with a reason, and a pasted address never
// becomes an image.

import { test, expect } from '../fixtures/single-user';
import { oversizedPng, pngFile, svgAsPng } from '../fixtures/images';

test.describe('Images (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Images WS ${Date.now()}`);
    await alice.createFolder({ name: 'Notes', visibility: 'Open' });
    await alice.tree.openFolder('Notes');
    await alice.createDoc('Pictures');
    await alice.openDoc('Pictures');
    await alice.editor.type('Intro');
    await alice.page.keyboard.press('Enter');
  });

  test('adds an uploaded image, and it is there after reopening', async ({
    alice,
  }) => {
    await alice.editor.addImages([pngFile('diagram.png')]);
    const image = alice.editor.image('diagram.png');
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty('naturalWidth', 160);
    await expect(image).toHaveAttribute('src', /^blob:http/);

    await alice.editor.close();
    await alice.openDoc('Pictures');
    await expect(alice.editor.image('diagram.png')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('refuses a file that only claims to be an image', async ({ alice }) => {
    await alice.editor.addImages([svgAsPng()]);
    const toast = alice.page.locator('[data-sonner-toast]', {
      hasText: "Couldn't add logo.png",
    });
    await expect(toast).toContainText(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
    await expect(
      alice.page.locator('.bn-editor [data-content-type="image"]'),
    ).toHaveCount(0);
  });

  test('refuses an image over 10 MB', async ({ alice }) => {
    await alice.editor.addImages([oversizedPng()]);
    const toast = alice.page.locator('[data-sonner-toast]', {
      hasText: "Couldn't add poster.png",
    });
    await expect(toast).toContainText('Images can be up to 10 MB.');
    await expect(
      alice.page.locator('.bn-editor [data-content-type="image"]'),
    ).toHaveCount(0);
  });

  test("never turns a pasted web page's image into an image block", async ({
    alice,
  }) => {
    await alice.page
      .locator('.ProseMirror')
      .first()
      .evaluate((el) => {
        const data = new DataTransfer();
        data.setData(
          'text/html',
          '<p>Pasted</p><img src="https://example.com/pixel.png" alt="pixel">',
        );
        data.setData('text/plain', 'Pasted');
        el.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    await alice.editor.expectContent('Pasted');
    await expect(
      alice.page.locator('.bn-editor [data-content-type="image"]'),
    ).toHaveCount(0);
  });
});
