// DOM matchers (`toBeInTheDocument`, …) for every test file.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only unmounts on its own when vitest globals are on; they are
// off here, so a render from one test would otherwise leak into the next.
afterEach(cleanup);
