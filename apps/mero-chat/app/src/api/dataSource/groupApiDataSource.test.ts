import bs58 from "bs58";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupApiDataSource } from "./groupApiDataSource";

const {
  mockAxiosGet,
  mockAxiosPost,
  mockAxiosPut,
  mockCreateNamespace,
  mockCreateNamespaceInvitation,
  mockJoinNamespace,
  mockJoinContext,
  mockListGroupContexts,
  mockSetMemberMetadata,
  mockCreateGroupInNamespace,
} = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
  mockAxiosPost: vi.fn(),
  mockAxiosPut: vi.fn(),
  mockCreateNamespace: vi.fn(),
  mockCreateNamespaceInvitation: vi.fn(),
  mockJoinNamespace: vi.fn(),
  mockJoinContext: vi.fn(),
  mockListGroupContexts: vi.fn(),
  mockSetMemberMetadata: vi.fn(),
  mockCreateGroupInNamespace: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: mockAxiosGet,
    post: mockAxiosPost,
    put: mockAxiosPut,
  },
  isAxiosError: () => false,
}));

vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: () => "http://localhost:2428",
}));

// The data source now issues its admin calls through mero-js rather than
// axios, so the assertions below check the SDK method and its arguments. The
// SDK unwraps core's `{ data: ... }` envelope, so mocks resolve the inner
// payload directly.
vi.mock("../meroJsClient", () => ({
  getAuthConfig: () => ({ jwtToken: "token" }),
  getMeroJs: () => ({
    admin: {
      createNamespace: mockCreateNamespace,
      listGroupContexts: mockListGroupContexts,
      setMemberMetadata: mockSetMemberMetadata,
      createNamespaceInvitation: mockCreateNamespaceInvitation,
      joinNamespace: mockJoinNamespace,
      joinContext: mockJoinContext,
      createGroupInNamespace: mockCreateGroupInNamespace,
    },
  }),
}));

describe("GroupApiDataSource", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockAxiosPost.mockReset();
    mockAxiosPut.mockReset();
    mockCreateNamespace.mockReset();
    mockCreateNamespaceInvitation.mockReset();
    mockJoinNamespace.mockReset();
    mockJoinContext.mockReset();
    mockListGroupContexts.mockReset();
    mockSetMemberMetadata.mockReset();
  });

  it("passes the optional alias when creating a namespace (workspace)", async () => {
    mockCreateNamespace.mockResolvedValue({ namespaceId: "group-1" });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.createGroup({
      applicationId: "app-1",
      upgradePolicy: "LazyOnAccess",
      alias: "Product Team",
    });

    expect(mockCreateNamespace).toHaveBeenCalledWith({
      applicationId: "app-1",
      upgradePolicy: "LazyOnAccess",
      alias: "Product Team",
      // Post-054a784f the server field is `name`; createGroup now sends
      // both for transition compat.
      name: "Product Team",
    });
    expect(response).toEqual({
      data: {
        groupId: "group-1",
      },
      error: null,
    });
  });

  it("also accepts groupId in namespace creation response for backward compatibility", async () => {
    mockCreateNamespace.mockResolvedValue({ groupId: "group-2" });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.createGroup({
      applicationId: "app-1",
      upgradePolicy: "Automatic",
    });

    expect(response).toEqual({ data: { groupId: "group-2" }, error: null });
  });

  it("returns the invitation group alias when the backend wraps the payload", async () => {
    mockCreateNamespaceInvitation.mockResolvedValue({
          invitation: {
            invitation: {
              inviter_identity: "admin",
              group_id: "group-1",
              expiration_height: 42,
              secret_salt: [1, 2, 3],
              protocol: "near",
              network: "testnet",
              contract_id: "contract.testnet",
            },
            inviter_signature: "signature",
          },
          groupAlias: "Product Team",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.createInvitation("group-1");

    expect(response).toEqual({
      data: {
        invitation: {
          invitation: {
            inviter_identity: "admin",
            group_id: "group-1",
            expiration_height: 42,
            secret_salt: [1, 2, 3],
            protocol: "near",
            network: "testnet",
            contract_id: "contract.testnet",
          },
          inviter_signature: "signature",
        },
        groupAlias: "Product Team",
      },
      error: null,
    });
  });

  it("joins a namespace by POSTing to /namespaces/{id}/join with only the invitation in the body", async () => {
    const invitation = {
      invitation: {
        inviter_identity: "admin",
        group_id: "group-1",
        expiration_height: 42,
        secret_salt: [1, 2, 3],
        protocol: "near",
        network: "testnet",
        contract_id: "contract.testnet",
      },
      inviter_signature: "signature",
    };
    mockJoinNamespace.mockResolvedValue({
      namespaceId: "group-1",
      memberIdentity: "member-1",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.joinGroup({
      invitation,
      groupAlias: "Product Team",
    });

    // namespace ID is extracted from invitation.invitation.group_id = "group-1"
    expect(mockJoinNamespace).toHaveBeenCalledWith("group-1", { invitation });
    expect(response).toEqual({
      data: {
        groupId: "group-1",
        memberIdentity: "member-1",
      },
      error: null,
    });
  });

  it("converts byte-array group_id in invitation to hex namespace ID in the join URL", async () => {
    const invitation = {
      invitation: {
        inviter_identity: "admin",
        group_id: [0xab, 0xcd, 0xef],
        expiration_height: 42,
        secret_salt: [1, 2, 3],
        protocol: "near",
        network: "testnet",
        contract_id: "contract.testnet",
      },
      inviter_signature: "signature",
    };
    mockJoinNamespace.mockResolvedValue({
      namespaceId: "abcdef",
      memberIdentity: "member-1",
    });

    const dataSource = new GroupApiDataSource();
    await dataSource.joinGroup({ invitation: invitation as never, groupAlias: "Team" });

    expect(mockJoinNamespace).toHaveBeenCalledWith("abcdef", { invitation });
  });

  it("joins a context by POSTing to /contexts/{contextId}/join without a group ID in URL", async () => {
    mockJoinContext.mockResolvedValue({
      contextId: "ctx-1",
      memberPublicKey: "pk-1",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.joinGroupContext("ignored-group-id", {
      contextId: "ctx-1",
    });

    expect(mockJoinContext).toHaveBeenCalledWith("ctx-1");
    expect(response).toEqual({
      data: { contextId: "ctx-1", memberPublicKey: "pk-1" },
      error: null,
    });
  });

  it("preserves optional aliases when listing group contexts", async () => {
    const hexContextId = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    const contextBytes = Uint8Array.from(
      hexContextId.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
    );
    const expectedContextId = bs58.encode(
      contextBytes,
    );

    mockListGroupContexts.mockResolvedValue([
      {
        contextId: hexContextId,
        alias: "Project Alpha",
      },
    ]);

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.listGroupContexts("group-1");

    expect(response).toEqual({
      data: [
        {
          contextId: expectedContextId,
          alias: "Project Alpha",
        },
      ],
      error: null,
    });
  });

  it("updates a member alias through the admin member alias endpoint", async () => {
    mockSetMemberMetadata.mockResolvedValue(undefined);

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.setMemberMetadata("group-1", "member-1", {
      name: "Taylor",
    });

    expect(mockSetMemberMetadata).toHaveBeenCalledWith("group-1", "member-1", {
      name: "Taylor",
    });
    expect(response).toEqual({
      data: undefined,
      error: null,
    });
  });

  // ── The 64-byte name cap ─────────────────────────────────────────────────
  //
  // Over the cap the server keeps the group and DROPS the name, returning 200.
  // Nothing downstream can tell that apart from "the user chose no name", which
  // is how every DM ever created ended up nameless: a 140-byte alias written to
  // a 64-byte field, silently, on every single write.

  it("refuses a subgroup name the server would silently drop", async () => {
    mockCreateGroupInNamespace.mockResolvedValue({ groupId: "g-1" });
    const dataSource = new GroupApiDataSource();

    const response = await dataSource.createSubgroup("ns-1", {
      groupName: "a".repeat(65),
    });

    expect(response.error?.message).toMatch(/too long/i);
    expect(mockCreateGroupInNamespace).not.toHaveBeenCalled();
  });

  it("refuses a name that is short in characters but over the byte cap", async () => {
    mockCreateGroupInNamespace.mockResolvedValue({ groupId: "g-1" });
    const dataSource = new GroupApiDataSource();

    // 20 emoji: well under any character limit, 80 bytes on the wire.
    const response = await dataSource.createSubgroup("ns-1", {
      groupName: "🎉".repeat(20),
    });

    expect(response.error).not.toBeNull();
    expect(mockCreateGroupInNamespace).not.toHaveBeenCalled();
  });

  it("still creates a subgroup with an acceptable name", async () => {
    mockCreateGroupInNamespace.mockResolvedValue({ groupId: "g-1" });
    const dataSource = new GroupApiDataSource();

    const response = await dataSource.createSubgroup("ns-1", {
      groupName: "general",
    });

    expect(response.data).toEqual({ groupId: "g-1" });
    expect(mockCreateGroupInNamespace).toHaveBeenCalledWith("ns-1", {
      groupName: "general",
    });
  });

  it("refuses an over-long namespace name too", async () => {
    const dataSource = new GroupApiDataSource();

    const response = await dataSource.createGroup({
      applicationId: "app-1",
      upgradePolicy: "Automatic",
      alias: "n".repeat(80),
    });

    expect(response.error).not.toBeNull();
    expect(mockCreateNamespace).not.toHaveBeenCalled();
  });
});
