// The create-world dialog's seed field: shown with the launcher's default, checked, and handed on.

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountCreateWorld } from "../src/ui/createWorld";

type Props = { fields: ReactElement<{ children: ReactElement<{ onChange: (e: unknown) => void }>[] }>; fieldsValid: boolean; onCreated: (c: unknown) => void };
const seen = vi.hoisted(() => ({ props: null as unknown }));
vi.mock("@calimero-network/mero-react", () => ({
  ConsentPopupReturn: () => null,
  CreateWorkspaceDialog: (p: unknown) => {
    seen.props = p;
    return null;
  },
}));
vi.mock("@calimero-apps/connect", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveSource: async (_c: unknown, base: unknown) => base,
}));

const props = () => seen.props as Props;
const flush = () => new Promise((r) => setTimeout(r, 0));
const typeSeed = async (value: string) => {
  props().fields.props.children[1]!.props.onChange({ target: { value } });
  await flush();
};

describe("the seed field", () => {
  let onCreated: ReturnType<typeof vi.fn<(c: unknown, seed: number) => void>>;
  beforeEach(async () => {
    onCreated = vi.fn<(c: unknown, seed: number) => void>();
    mountCreateWorld({} as never, {} as never, { package: "p" }, 1337, onCreated);
    await flush();
  });

  it("starts at the launcher's default seed", () => {
    expect(renderToStaticMarkup(props().fields)).toContain('value="1337"');
    expect(props().fieldsValid).toBe(true);
  });

  it("holds Continue back until the seed is a number", async () => {
    await typeSeed("abc");
    expect(props().fieldsValid).toBe(false);
    await typeSeed("");
    expect(props().fieldsValid).toBe(false);
    await typeSeed("42");
    expect(props().fieldsValid).toBe(true);
  });

  it("hands the typed seed on with the created world, as the contract takes it", async () => {
    await typeSeed("-42");
    props().onCreated({ orgId: "o", name: "n", selfName: "s" });
    expect(onCreated).toHaveBeenCalledWith({ orgId: "o", name: "n", selfName: "s" }, 42);
  });
});
