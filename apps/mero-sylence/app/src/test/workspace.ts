import { vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

import type { AppEvent } from "../generated/client";
import { sylenceClient } from "../sylenceApi";
import type { EventListener, Workspace } from "../useWorkspace";

/** A contract method's fake: its ABI arguments in, its wire answer out (or a throw). */
export type Handler = (args: Record<string, unknown>) => unknown;

/**
 * A workspace over the real `MeroSylenceClient`, on a fake transport that
 * answers each contract method from `handlers` (by its ABI name). Every call
 * and view is recorded in `sent`. `emit` delivers an app event to whatever
 * subscribed, as the node's stream would.
 */
export function fakeWorkspace(handlers: Record<string, Handler>, app = "app-sylence-1") {
  const sent: { method: string; args: Record<string, unknown> }[] = [];
  const answer = async (_app: string, method: string, args: Record<string, unknown> = {}) => {
    sent.push({ method, args });
    const handler = handlers[method];
    if (!handler) throw new Error(`no fake for ${method}`);
    return { index: 1, result: await handler(args), events: [] };
  };
  const call = vi.fn(answer);
  const view = vi.fn(answer);
  const client = sylenceClient(withRoutes({ call, view }), app);
  const listeners = new Set<EventListener>();
  const workspace: Workspace = {
    client,
    version: 0,
    act: async (fn) => fn(client),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const emit = (event: AppEvent) => {
    for (const fn of listeners) fn(event);
  };
  return { workspace, sent, call, view, emit };
}

/** A meeting as the contract answers it, with `over` laid on top. */
export function meeting(over: Partial<import("../sylenceApi").MeetingView> = {}): import("../sylenceApi").MeetingView {
  return {
    id: "aa11",
    title: "Weekly sync",
    platform: "meet",
    url: "https://meet.google.com/abc-defg-hij",
    model: "whisper-large-v3-turbo",
    language: "en",
    recorder: "bob",
    startedAt: String(Date.UTC(2026, 10, 23, 13, 5)),
    endedAt: String(Date.UTC(2026, 10, 23, 13, 35)),
    durationMs: 1_800_000,
    summary: "",
    segments: 2,
    words: 9,
    nextSeq: 2,
    live: false,
    openActions: 1,
    ...over,
  };
}
