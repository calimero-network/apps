import { test, expect } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * IMPORTANT.md item 11 — "Images are not being embedded into html exports in code
 * exports in prototype tag".
 *
 * The reported fault was `src=""`, hardcoded. Reading the function turned up three
 * more: text took its colour from `fill`, which `base` also puts in `background`
 * (so exported text was always invisible); lines exported as filled divs; and the
 * wrapper had no size, so negative coordinates rendered off-screen.
 */
async function protoHtml(page: import("@playwright/test").Page) {
  await page.getByText("Proto", { exact: true }).click();
  const pre = page.locator("pre").first();
  await expect(pre).toBeVisible();
  return (await pre.textContent()) ?? "";
}

test.describe("item 11: the code export", () => {
  test("text gets a colour that differs from its background", async ({ page }) => {
    await openBoard(page, {
      elements: [element({
        id: "t", data: { kind: "text", content: "Hello", fontSize: 24, fontFamily: "sans-serif", bold: false, italic: false },
        x: 40, y: 40, width: 200, height: 34, fill: "#898FCE",
      })],
    });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.click(box.x + 60, box.y + 50);
    const html = await protoHtml(page);
    expect(html).toContain("color: #898FCE");
    expect(html).not.toContain("background: #898FCE");
  });

  test("a line exports as svg, not a filled div", async ({ page }) => {
    await openBoard(page, {
      elements: [element({
        id: "l", data: { kind: "line", points: "0,0 200,100" }, x: 60, y: 60,
        width: 200, height: 100, fill: "transparent", stroke: "#FF0000", strokeWidth: 3,
      })],
    });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.click(box.x + 160, box.y + 110);
    const html = await protoHtml(page);
    expect(html).toContain("<svg");
    expect(html).toContain("<line");
  });

  test("a rect exports its corner radius", async ({ page }) => {
    await openBoard(page, {
      elements: [element({ id: "r", x: 50, y: 50, width: 120, height: 80, fill: "#FF00FF", cornerRadius: 16 })],
    });
    const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
    await page.mouse.click(box.x + 110, box.y + 90);
    const html = await protoHtml(page);
    expect(html).toContain("border-radius: 16px");
  });
});
