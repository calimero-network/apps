import bs58 from "bs58";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupApiDataSource } from "./groupApiDataSource";

const { mockAxiosGet, mockAxiosPost, mockAxiosPut } = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
  mockAxiosPost: vi.fn(),
  mockAxiosPut: vi.fn(),
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

vi.mock("../meroJsClient", () => ({
  getAuthConfig: () => ({ jwtToken: "token" }),
}));

describe("GroupApiDataSource", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockAxiosPost.mockReset();
    mockAxiosPut.mockReset();
  });

  it("passes the optional alias when creating a namespace (workspace)", async () => {
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data: {
        data: {
          namespaceId: "group-1",
        },
      },
      statusText: "OK",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.createGroup({
      applicationId: "app-1",
      upgradePolicy: "LazyOnAccess",
      alias: "Product Team",
    });

    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://localhost:2428/admin-api/namespaces",
      {
        applicationId: "app-1",
        upgradePolicy: "LazyOnAccess",
        alias: "Product Team",
        // Post-054a784f the server field is `name`; createGroup now sends
        // both for transition compat.
        name: "Product Team",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
      },
    );
    expect(response).toEqual({
      data: {
        groupId: "group-1",
      },
      error: null,
    });
  });

  it("also accepts groupId in namespace creation response for backward compatibility", async () => {
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data: { data: { groupId: "group-2" } },
      statusText: "OK",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.createGroup({
      applicationId: "app-1",
      upgradePolicy: "Automatic",
    });

    expect(response).toEqual({ data: { groupId: "group-2" }, error: null });
  });

  it("returns the invitation group alias when the backend wraps the payload", async () => {
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data: {
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
      },
      statusText: "OK",
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
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data: {
        data: {
          namespaceId: "group-1",
          memberIdentity: "member-1",
        },
      },
      statusText: "OK",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.joinGroup({
      invitation,
      groupAlias: "Product Team",
    });

    // namespace ID is extracted from invitation.invitation.group_id = "group-1"
    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://localhost:2428/admin-api/namespaces/group-1/join",
      { invitation },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
      },
    );
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
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data: { data: { namespaceId: "abcdef", memberIdentity: "member-1" } },
      statusText: "OK",
    });

    const dataSource = new GroupApiDataSource();
    await dataSource.joinGroup({ invitation: invitation as never, groupAlias: "Team" });

    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://localhost:2428/admin-api/namespaces/abcdef/join",
      { invitation },
      expect.any(Object),
    );
  });

  it("joins a context by POSTing to /contexts/{contextId}/join without a group ID in URL", async () => {
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data: { data: { contextId: "ctx-1", memberPublicKey: "pk-1" } },
      statusText: "OK",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.joinGroupContext("ignored-group-id", {
      contextId: "ctx-1",
    });

    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://localhost:2428/admin-api/contexts/ctx-1/join",
      {},
      expect.any(Object),
    );
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

    mockAxiosGet.mockResolvedValue({
      status: 200,
      data: {
        data: [
          {
            contextId: hexContextId,
            alias: "Project Alpha",
          },
        ],
      },
    });

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
    mockAxiosPut.mockResolvedValue({
      status: 200,
      data: {
        data: undefined,
      },
      statusText: "OK",
    });

    const dataSource = new GroupApiDataSource();
    const response = await dataSource.setMemberMetadata("group-1", "member-1", {
      name: "Taylor",
    });

    expect(mockAxiosPut).toHaveBeenCalledWith(
      "http://localhost:2428/admin-api/groups/group-1/members/member-1/metadata",
      { name: "Taylor" },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
      },
    );
    expect(response).toEqual({
      data: undefined,
      error: null,
    });
  });
});
