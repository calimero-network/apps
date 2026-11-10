// @vitest-environment jsdom
/**
 * The space's people, and Remove for its owners and admins: asked first,
 * never offered on your own row or the owner's, and in an org that keeps its
 * apps apart the prompt says the organization stays theirs.
 */
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SpacePeople, { type SpacePerson } from "./SpacePeople";

const people: SpacePerson[] = [
  { account: "acct-me", role: "admin", name: "Me" },
  { account: "acct-own", role: "owner", name: "Olga" },
  { account: "acct-bob", role: "member", name: "Bob" },
];

const rowOf = (account: string) => {
  const row = screen.getAllByTestId("space-person").find((r) => r.dataset.account === account);
  if (!row) throw new Error(`no row for ${account}`);
  return row;
};

afterEach(() => cleanup());

describe("SpacePeople", () => {
  it("an admin removes a member, only after confirming", () => {
    const onRemove = vi.fn();
    render(createElement(SpacePeople, { people, me: "acct-me", canRemove: true, appOnly: true, busy: null, onRemove }));
    fireEvent.click(within(rowOf("acct-bob")).getByTestId("remove-person"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(within(rowOf("acct-bob")).getByRole("alertdialog").textContent).toMatch(
      /stay in the organization and its other apps/,
    );
    fireEvent.click(within(rowOf("acct-bob")).getByTestId("confirm-remove-person"));
    expect(onRemove).toHaveBeenCalledWith(people[2]);
  });

  it("never offers Remove on your own row or the owner's", () => {
    render(createElement(SpacePeople, { people, me: "acct-me", canRemove: true, appOnly: false, busy: null, onRemove: vi.fn() }));
    expect(within(rowOf("acct-me")).queryByTestId("remove-person")).toBeNull();
    expect(within(rowOf("acct-own")).queryByTestId("remove-person")).toBeNull();
  });

  it("a member sees the list without Remove", () => {
    render(createElement(SpacePeople, { people, me: "acct-bob", canRemove: false, appOnly: false, busy: null, onRemove: vi.fn() }));
    expect(screen.getAllByTestId("space-person")).toHaveLength(3);
    expect(screen.queryByTestId("remove-person")).toBeNull();
  });
});
