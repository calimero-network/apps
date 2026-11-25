import { DEPLOY_NOT_GRANTED_MESSAGE } from "@calimero-apps/connect";
import { CalimeroError } from "@calimero-network/mero-js";
import { describe, expect, it } from "vitest";

import { extractErrorMessage } from "./errorMessage";

describe("extractErrorMessage", () => {
  it("says an app this cluster does not offer is not available yet", () => {
    expect(extractErrorMessage(new CalimeroError(403, "DEPLOY_NOT_GRANTED", "This cluster only lets Calimero Cloud deployers install apps"))).toBe(DEPLOY_NOT_GRANTED_MESSAGE);
  });
});
