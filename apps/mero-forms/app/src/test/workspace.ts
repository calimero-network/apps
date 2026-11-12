import { vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

import { formsClient } from "../formsApi";
import type { Workspace } from "../useWorkspace";

/** A contract method's fake: its ABI arguments in, its wire answer out (or a throw). */
export type Handler = (args: Record<string, unknown>) => unknown;

/**
 * A workspace over the real `MeroFormsClient`, on a fake transport that
 * answers each contract method from `handlers` (by its ABI name). Every call
 * and view is recorded in `sent`, with the ABI's arguments. A refusal a
 * handler throws reaches the screens through `formsTransport`, as a node's
 * would.
 */
export function fakeWorkspace(handlers: Record<string, Handler>, app = "app-forms-1") {
  const sent: { method: string; args: Record<string, unknown> }[] = [];
  const answer = async (_app: string, method: string, args: Record<string, unknown> = {}) => {
    sent.push({ method, args });
    const handler = handlers[method];
    if (!handler) throw new Error(`no fake for ${method}`);
    return { index: 1, result: await handler(args), events: [] };
  };
  const call = vi.fn(answer);
  const view = vi.fn(answer);
  const client = formsClient(withRoutes({ call, view }), app);
  const workspace: Workspace = {
    client,
    version: 0,
    act: async (fn) => fn(client),
  };
  return { workspace, sent, call, view };
}
