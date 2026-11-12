// Every app's vitest lists this module first in `test.setupFiles`, so it runs
// before the app's own setup and before any test file imports Testing Library.
//
// Testing Library's async utilities (`findBy*`, `waitFor`,
// `waitForElementToBeRemoved`) give up after `asyncUtilTimeout`, 1000 ms by
// default. On a busy CI runner a render that takes 50 ms on a workstation can
// take over a second, and a correct test fails on the wait rather than on its
// assertion: mero-stream's `findByTestId("signup-passkey")` and battleships'
// `waitFor` on the invitation prompt leaving (1021 ms) both did, and both
// passed on re-run. On CI the wait is 5 s. Locally it stays 1 s, so a test
// that only passes because the wait is long still shows up as slow here.
//
// Only the wait moves: every assertion is the same, and a test that never
// reaches its expected state still fails, just later.
import { configure, getConfig } from "@testing-library/dom";

/** Testing Library's own default, kept when not on CI. */
export const LOCAL_ASYNC_UTIL_TIMEOUT_MS = 1000;
/** The wait on CI (GitHub Actions sets `CI=true`). */
export const CI_ASYNC_UTIL_TIMEOUT_MS = 5000;

type Env = Record<string, string | undefined>;

/** Whether `env` says this is a CI run: `CI` set to anything but "", "0" or "false". */
export function isCi(env: Env): boolean {
  const ci = env.CI?.trim().toLowerCase();
  return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false";
}

/** The async-utility wait for `env`. */
export function asyncUtilTimeoutFor(env: Env): number {
  return isCi(env) ? CI_ASYNC_UTIL_TIMEOUT_MS : LOCAL_ASYNC_UTIL_TIMEOUT_MS;
}

// Read through globalThis so the module needs no Node types: vitest always
// runs it under Node, jsdom environment or not.
const env: Env =
  (globalThis as { process?: { env?: Env } }).process?.env ?? {};

configure({ asyncUtilTimeout: asyncUtilTimeoutFor(env) });

/** The wait now configured; what a test asserts to prove the setup ran. */
export function configuredAsyncUtilTimeout(): number {
  return getConfig().asyncUtilTimeout;
}
