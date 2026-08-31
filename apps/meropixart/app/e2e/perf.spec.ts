import { test } from "@playwright/test";

// Reads the perf bench (scripts/perf-bench.html) and prints its table. Not a
// gate — timings on a shared CI runner are too noisy to assert on. It exists so
// a perf claim in a PR can be reproduced with one command:
//
//   pnpm exec playwright test e2e/perf.spec.ts --project=mocked
test("perf bench", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("console", (m) => { if (m.text().startsWith("PERFMARK")) console.log(m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERROR " + String(e)));
  await page.goto("/scripts/perf-bench.html");
  await page.waitForFunction(
    () => (window as unknown as { __PERF_READY__?: boolean }).__PERF_READY__ === true,
    undefined,
    { timeout: 120_000 },
  );
  const perf = await page.evaluate(
    () => (window as unknown as { __PERF__: Record<string, unknown> }).__PERF__,
  );
  console.log(JSON.stringify(perf, null, 2));
});

// Cost as a document accumulates elements — see scripts/perf-scale.html.
test("scale bench", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("console", (m) => console.log("CONSOLE[" + m.type() + "] " + m.text()));
  page.on("pageerror", (e) => console.log("PAGEERROR " + String(e)));
  await page.goto("/scripts/perf-scale.html");
  await page.waitForFunction(
    () => (window as unknown as { __SCALE_READY__?: boolean }).__SCALE_READY__ === true,
    undefined,
    { timeout: 120_000 },
  );
  console.log(JSON.stringify(
    await page.evaluate(() => (window as unknown as { __SCALE__: unknown }).__SCALE__), null, 2));
});
