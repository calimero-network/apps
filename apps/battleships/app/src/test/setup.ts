// `@testing-library/jest-dom` adds the DOM matchers the component tests use
// (`toBeVisible`, `toBeDisabled`, …). Imported here rather than per file so a
// new test file cannot forget it and get a confusing "not a function".
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount whatever a test rendered. Without `globals: true` testing-library
// cannot register its own afterEach, so every renderHook stayed mounted into
// the next test and reacted to its state.
afterEach(() => cleanup());
