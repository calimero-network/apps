import { act, render, screen, waitFor } from "@testing-library/react";
import bs58 from "bs58";

import {
  canonicalAccount,
  fetchGroupName,
  invalidateGroupName,
  memberNames,
  MemberNameDirectory,
  placeholderName,
  publishMemberName,
  resolveGroupName,
  sameAccount,
  shortAccount,
  useGroupName,
  useMemberNames,
  useMyName,
  type NamesAdmin,
} from "./index";

const HEX = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const B58 = bs58.encode(Uint8Array.from(HEX.match(/../g)!.map((b) => parseInt(b, 16))));
const NS = "fb884a129317b49731f488f64ba0f1064e39a2a6a763dc36738250366eb41da1";

function adminWith(members: unknown, extra: Partial<NamesAdmin> = {}): NamesAdmin {
  return { listGroupMembers: vi.fn().mockResolvedValue(members), ...extra };
}

beforeEach(() => {
  memberNames.clear();
  invalidateGroupName();
});

describe("account ids", () => {
  it("treats hex and base58 of the same key as one account", () => {
    expect(canonicalAccount(B58)).toBe(HEX);
    expect(canonicalAccount(HEX.toUpperCase())).toBe(HEX);
    expect(sameAccount(B58, HEX)).toBe(true);
    expect(canonicalAccount("not-an-id")).toBeUndefined();
  });

  it("shortens an id for the no-name fallback", () => {
    expect(shortAccount(HEX)).toBe("5926f2…1334");
    expect(shortAccount("")).toBe("unknown");
  });
});

describe("MemberNameDirectory", () => {
  it("indexes the namespace listing by canonical account", async () => {
    const dir = new MemberNameDirectory();
    await dir.load(adminWith({ members: [{ identity: HEX, role: "Admin", name: " Ana " }] }), NS);
    // The contract stamps base58; the listing reports hex.
    expect(dir.peek(NS, B58)).toBe("Ana");
  });

  it("accepts the older `alias` field and bare-array listings", async () => {
    const dir = new MemberNameDirectory();
    await dir.load(adminWith([{ identity: HEX, alias: "Ana" }]), NS);
    expect(dir.peek(NS, HEX)).toBe("Ana");
  });

  it("shares one request between concurrent readers and caches it", async () => {
    const dir = new MemberNameDirectory();
    const admin = adminWith({ members: [] });
    await Promise.all([dir.load(admin, NS), dir.load(admin, NS)]);
    await dir.load(admin, NS);
    expect(admin.listGroupMembers).toHaveBeenCalledTimes(1);
  });

  it("keeps a just-published name until the listing agrees", async () => {
    const dir = new MemberNameDirectory();
    dir.remember(NS, HEX, "Ana");
    await dir.load(adminWith({ members: [{ identity: HEX }] }), NS, { force: true });
    expect(dir.peek(NS, HEX)).toBe("Ana");

    await dir.load(adminWith({ members: [{ identity: HEX, name: "Ana" }] }), NS, { force: true });
    // Agreed, so the listing is authoritative again: a later rename elsewhere shows.
    await dir.load(adminWith({ members: [{ identity: HEX, name: "Ana B" }] }), NS, { force: true });
    expect(dir.peek(NS, HEX)).toBe("Ana B");
  });

  it("keeps known names when a refresh fails", async () => {
    const dir = new MemberNameDirectory();
    await dir.load(adminWith({ members: [{ identity: HEX, name: "Ana" }] }), NS);
    const failing: NamesAdmin = { listGroupMembers: vi.fn().mockRejectedValue(new Error("down")) };
    await dir.load(failing, NS, { force: true });
    expect(dir.peek(NS, HEX)).toBe("Ana");
  });
});

describe("publishMemberName", () => {
  it("writes to the namespace, keeps the record's data, and shows at once", async () => {
    const setMemberMetadata = vi.fn().mockResolvedValue(undefined);
    const admin = adminWith(
      { members: [] },
      {
        setMemberMetadata,
        getMemberMetadata: vi.fn().mockResolvedValue({ name: "old", data: { avatar: "x" } }),
      },
    );
    await publishMemberName(admin, NS, B58, " Ana ");
    expect(setMemberMetadata).toHaveBeenCalledWith(NS, HEX, { name: "Ana", data: { avatar: "x" } });
    expect(memberNames.peek(NS, HEX)).toBe("Ana");
  });
});

describe("group names", () => {
  it("prefers the replicated name, then listing, then local, then a placeholder", () => {
    const fallback = placeholderName("Team", NS);
    expect(fallback).toBe("Team fb884a");
    expect(resolveGroupName({ metadataName: "Design", localName: "x", fallback })).toBe("Design");
    expect(resolveGroupName({ listedName: " ", localName: "Mine", fallback })).toBe("Mine");
    expect(resolveGroupName({ fallback })).toBe("Team fb884a");
  });

  it("reads context metadata when a context is named", async () => {
    const getContextMetadata = vi.fn().mockResolvedValue({ name: "Board" });
    const admin = adminWith([], { getContextMetadata });
    expect(await fetchGroupName(admin, NS, "ctx")).toBe("Board");
    expect(getContextMetadata).toHaveBeenCalledWith(NS, "ctx");
  });
});

describe("hooks", () => {
  function Byline({ admin, account }: { admin: NamesAdmin; account: string }) {
    const { displayName } = useMemberNames(admin, NS);
    return <span data-testid="who">{displayName(account)}</span>;
  }

  it("renders the short id, then the namespace name once loaded", async () => {
    const admin = adminWith({ members: [{ identity: HEX, name: "Ana" }] });
    render(<Byline admin={admin} account={B58} />);
    await waitFor(() => expect(screen.getByTestId("who").textContent).toBe("Ana"));
  });

  it("re-renders every reader when this session renames", async () => {
    const admin = adminWith({ members: [] });
    render(<Byline admin={admin} account={HEX} />);
    await waitFor(() => expect(admin.listGroupMembers).toHaveBeenCalled());
    expect(screen.getByTestId("who").textContent).toBe("5926f2…1334");
    act(() => memberNames.remember(NS, HEX, "Ana"));
    expect(screen.getByTestId("who").textContent).toBe("Ana");
  });

  function Title({ admin }: { admin: NamesAdmin }) {
    const name = useGroupName(admin, NS, { localName: "", fallback: placeholderName("Team", NS) });
    return <h1>{name}</h1>;
  }

  it("titles a group from its metadata instead of its id", async () => {
    const admin = adminWith([], { getGroupMetadata: vi.fn().mockResolvedValue({ name: "Calimero" }) });
    render(<Title admin={admin} />);
    expect(screen.getByRole("heading").textContent).toBe("Team fb884a");
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Calimero"));
  });
});

describe("group name backfill", () => {
  function Title({ admin }: { admin: NamesAdmin }) {
    const name = useGroupName(
      admin,
      NS,
      { localName: "Calimero", fallback: placeholderName("Team", NS) },
      { backfillLocal: true },
    );
    return <h1>{name}</h1>;
  }

  it("promotes a local-only name into the record, keeping its data", async () => {
    const setGroupMetadata = vi.fn().mockResolvedValue(undefined);
    const admin = adminWith([], {
      getGroupMetadata: vi.fn().mockResolvedValue({ name: null, data: { theme: "dark" } }),
      setGroupMetadata,
    });
    render(<Title admin={admin} />);
    expect(screen.getByRole("heading").textContent).toBe("Calimero");
    await waitFor(() =>
      expect(setGroupMetadata).toHaveBeenCalledWith(NS, { name: "Calimero", data: { theme: "dark" } }),
    );
  });

  it("never writes when the record could not be read", async () => {
    const setGroupMetadata = vi.fn().mockResolvedValue(undefined);
    const admin = adminWith([], {
      getGroupMetadata: vi.fn().mockRejectedValue(new Error("403")),
      setGroupMetadata,
    });
    render(<Title admin={admin} />);
    await waitFor(() => expect(admin.getGroupMetadata).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(setGroupMetadata).not.toHaveBeenCalled();
  });
});

describe("useMyName", () => {
  function Me({ admin, self = HEX }: { admin: NamesAdmin; self?: string }) {
    const me = useMyName(admin, NS, self);
    return (
      <div>
        <span data-testid="name">{me.name}</span>
        <span data-testid="ready">{String(me.ready)}</span>
        <button onClick={() => void me.setName("Ana")}>set</button>
      </div>
    );
  }

  beforeEach(() => localStorage.clear());

  it("is not ready until the team's names have loaded", async () => {
    let resolve!: (v: unknown) => void;
    const admin: NamesAdmin = { listGroupMembers: vi.fn(() => new Promise((r) => (resolve = r))) };
    render(<Me admin={admin} />);
    expect(screen.getByTestId("ready").textContent).toBe("false");
    await act(async () => resolve({ members: [{ identity: HEX, name: "Ana" }] }));
    expect(screen.getByTestId("ready").textContent).toBe("true");
    expect(screen.getByTestId("name").textContent).toBe("Ana");
  });

  it("is ready with no name when the team has none for you", async () => {
    render(<Me admin={adminWith({ members: [] })} />);
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.getByTestId("name").textContent).toBe("");
  });

  it("uses this browser's copy at once, and republishes it when the record lacks it", async () => {
    localStorage.setItem(`calimero-names:me:${NS}`, "Ana");
    const setMemberMetadata = vi.fn().mockResolvedValue(undefined);
    render(<Me admin={adminWith({ members: [] }, { setMemberMetadata })} />);
    expect(screen.getByTestId("name").textContent).toBe("Ana");
    expect(screen.getByTestId("ready").textContent).toBe("true");
    await waitFor(() => expect(setMemberMetadata).toHaveBeenCalledWith(NS, HEX, { name: "Ana" }));
  });

  it("sets the name for the whole team", async () => {
    const setMemberMetadata = vi.fn().mockResolvedValue(undefined);
    render(<Me admin={adminWith({ members: [] }, { setMemberMetadata })} />);
    await act(async () => screen.getByText("set").click());
    expect(setMemberMetadata).toHaveBeenCalledWith(NS, HEX, { name: "Ana" });
    expect(screen.getByTestId("name").textContent).toBe("Ana");
    expect(localStorage.getItem(`calimero-names:me:${NS}`)).toBe("Ana");
  });
});
