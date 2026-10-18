import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

/// Requests a ``MockURLProtocol`` handler saw.
final class DelegatedPathRequestLog: @unchecked Sendable {
    struct Seen: Sendable {
        let method: String
        let path: String
        let authorization: String?
        let body: Data

        var json: JSONValue? { try? JSONDecoder().decode(JSONValue.self, from: body) }
    }

    private let lock = NSLock()
    private var seen: [Seen] = []

    func record(_ request: URLRequest) -> Seen {
        let entry = Seen(
            method: request.httpMethod ?? "GET", path: request.url?.path ?? "",
            authorization: request.value(forHTTPHeaderField: "Authorization"), body: FakeNode.body(request))
        lock.lock()
        seen.append(entry)
        lock.unlock()
        return entry
    }

    var all: [Seen] {
        lock.lock()
        defer { lock.unlock() }
        return seen
    }
}

/// Governance and creation calls ``AccountAdmin`` handed to its deps.
final class DelegatedPathDepsLog: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String] = []
    private var created: [CreateDelegatedContextRequest] = []

    func note(_ entry: String) {
        lock.lock()
        entries.append(entry)
        lock.unlock()
    }

    func noteCreate(_ request: CreateDelegatedContextRequest) {
        lock.lock()
        created.append(request)
        lock.unlock()
    }

    var notes: [String] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }

    var creates: [CreateDelegatedContextRequest] {
        lock.lock()
        defer { lock.unlock() }
        return created
    }
}

/// The delegated path end to end through the SDK's own types, over
/// ``MockURLProtocol``: contract calls through a real ``RelayClient``, and
/// listings, channel creation and joins through a real ``AccountAdmin``.
final class DelegatedPathTests: XCTestCase {
    private let ctx = ChatFixtures.channelId
    private let namespace = String(repeating: "dd", count: 32)
    private let channelGroup = String(repeating: "aa", count: 32)
    private let newGroup = String(repeating: "c1", count: 32)
    private let account = ChatFixtures.account
    private let keys = DeviceKeys.generate()
    private let log = DelegatedPathRequestLog()

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    private static func stub(_ status: Int, _ json: String) -> MockURLProtocol.Stub {
        MockURLProtocol.Stub(status: status, headers: ["Content-Type": "application/json"], body: Data(json.utf8))
    }

    private func relayClient(_ relayURL: String) -> RelayClient {
        RelayClient(
            relayURL: relayURL, authorAccount: account, authorProof: String(repeating: "ef", count: 48), keys: keys,
            nonces: MemoryWarrantNonceStore(), tokenProvider: { "relay-access" },
            session: MockURLProtocol.makeSession())
    }

    private func describeJSON() -> String {
        """
        {"data":{"executorAccount":"\(String(repeating: "33", count: 32))",\
        "executorKey":"\(String(repeating: "77", count: 32))","canAuthorOnBehalf":true,\
        "groupId":"\(channelGroup)","releaseBytecodeId":"\(String(repeating: "44", count: 32))",\
        "releaseVersion":"1.0.0"}}
        """
    }

    // MARK: - Contract calls through RelayClient

    func testReadsUseTheRelaysQueryRouteWithTheSessionToken() async throws {
        let ctx = self.ctx
        let log = self.log
        let page = ChatFixtures.windowJSON(total: 3, limit: 20, offset: 0)
        MockURLProtocol.setHandler { request in
            let seen = log.record(request)
            if seen.method == "POST", seen.path == "/admin-api/contexts/\(ctx)/query" {
                return Self.stub(200, #"{"data":{"returns":\#(page)}}"#)
            }
            return Self.stub(404, #"{"error":"unexpected"}"#)
        }
        let api = ChatAPI(contract: RelayChatContract(relay: relayClient("https://relay-read.test")))

        let result = try await api.getMessages(ctx, limit: 20, offset: 0)

        XCTAssertEqual(result.messages.map(\.index), [0, 1, 2])
        let requests = log.all
        XCTAssertEqual(requests.count, 1, "a read is one query, no warrant: \(requests.map(\.path))")
        let query = try XCTUnwrap(requests.first)
        XCTAssertEqual(query.authorization, "Bearer relay-access")
        XCTAssertEqual(query.json?["method"], "get_messages")
        XCTAssertEqual(query.json?["argsJson"], ["limit": 20, "offset": 0])
        XCTAssertFalse(requests.contains { $0.path.hasSuffix("/intents") })
        XCTAssertFalse(requests.contains { $0.path.contains("jsonrpc") })
    }

    func testWritesAreSignedWarrantsPostedToTheIntentsRoute() async throws {
        let ctx = self.ctx
        let log = self.log
        let describe = describeJSON()
        let sent = ChatFixtures.sentMessageJSON
        MockURLProtocol.setHandler { request in
            let seen = log.record(request)
            switch (seen.method, seen.path) {
            case ("GET", "/admin-api/contexts/\(ctx)/intents"):
                return Self.stub(200, describe)
            case ("POST", "/admin-api/contexts/\(ctx)/intents"):
                return Self.stub(200, #"{"data":{"rootHash":"rh","returns":\#(sent)}}"#)
            default:
                return Self.stub(404, #"{"error":"unexpected"}"#)
            }
        }
        let now = Date(timeIntervalSince1970: 1_760_000_100)
        let api = ChatAPI(contract: RelayChatContract(relay: relayClient("https://relay-write.test")), now: { now })

        let message = try await api.sendMessage(ctx, text: "hello")

        XCTAssertEqual(message.text, "hello")
        let posts = log.all.filter { $0.method == "POST" }
        XCTAssertEqual(posts.map(\.path), ["/admin-api/contexts/\(ctx)/intents"])
        let body = try XCTUnwrap(posts.first?.json)
        XCTAssertEqual(body["method"], "send_message")
        let expectedArgs: JSONValue = [
            "message": "hello", "mentions": [], "mentions_usernames": [], "timestamp": 1_760_000_100,
        ]
        XCTAssertEqual(body["argsJson"], expectedArgs)
        let warrant = try XCTUnwrap(body["warrant"]?.stringValue)
        XCTAssertFalse(warrant.isEmpty, "the device key signs a warrant")
        XCTAssertNotNil(body["authorProof"]?.stringValue)
        XCTAssertNil(posts.first?.authorization, "a warrant needs no session token")
        XCTAssertFalse(log.all.contains { $0.path.hasSuffix("/query") }, "a write is never sent as a query")
    }

    func testARefusedIntentSurfacesTheRelaysReason() async {
        let ctx = self.ctx
        let describe = describeJSON()
        MockURLProtocol.setHandler { request in
            if request.httpMethod == "GET" { return Self.stub(200, describe) }
            return Self.stub(403, #"{"error":"the author is banned in this context"}"#)
        }
        let api = ChatAPI(contract: RelayChatContract(relay: relayClient("https://relay-refuse.test")))
        do {
            try await api.updateReaction(ctx, messageId: "m_1", emoji: "👍", add: true)
            XCTFail("expected a refusal")
        } catch {
            let text = ChatErrorText.describe(error)
            XCTAssertTrue(text.contains("the author is banned in this context"), text)
            XCTAssertTrue(text.contains("403"), text)
        }
    }

    // MARK: - Listings, channels and joins through AccountAdmin

    private func makeBackend(deps depsLog: DelegatedPathDepsLog) -> DelegatedChatBackend {
        let session = DelegatedSession(
            account: account, credential: String(repeating: "ef", count: 48), keys: keys,
            relayUrl: "https://relay-admin.test")
        let http = URLSessionHttpClient(
            baseURL: URL(string: "https://relay-admin.test")!, session: MockURLProtocol.makeSession())
        let newGroup = self.newGroup
        let deps = AccountAdminDeps(
            governGroup: { _, groupId, op in
                depsLog.note("group \(groupId) kind=\(op.kind) tag=\(op.bytes.first ?? 0)")
                return groupId
            },
            governRoot: { _, groupId, op in
                depsLog.note("root \(groupId) kind=\(op.kind) tag=\(op.bytes.first ?? 0)")
                return newGroup
            },
            createContext: { _, request in
                depsLog.noteCreate(request)
                // What the relay's context-intents route answers (`data` of the POST).
                let answer = #"{"contextId":"ctx-new","groupId":"\#(request.groupId ?? "")","memberPublicKey":""}"#
                return try JSONDecoder().decode(CreatedRelayContext.self, from: Data(answer.utf8))
            },
            found: { _, _, _ in throw ChatError.invalidInput("not in this test") },
            latestVersion: { _, _ in "1.0.0" },
            signInvitation: { _ in try ChatFixtures.signedInvitation() })
        let env = DelegatedEnvironment(
            store: .memory(), nonces: MemoryWarrantNonceStore(), urlSession: MockURLProtocol.makeSession())
        let admin = AccountAdmin(
            session: session, read: AdminApi(http: http), app: AdminAppConfig(packageName: ChatConstants.packageName),
            env: env, deps: deps)
        let connection = CloudConnection(
            session: CloudSession(
                account: account, device: String(repeating: "0d", count: 32),
                credential: session.credential, relayUrl: "https://relay-admin.test"),
            relay: relayClient("https://relay-admin.test"), mero: nil, nodeKey: nil, readNote: nil)
        let signIn = CloudSignIn(
            keyStore: .memory(keys), sessionStore: .memory(), urlSession: MockURLProtocol.makeSession(),
            delegatedStore: .memory())
        return DelegatedChatBackend(connection: connection, admin: admin, signIn: signIn)
    }

    private func serveRelayAdmin() {
        let log = self.log
        let namespace = self.namespace
        let channelGroup = self.channelGroup
        let account = self.account
        let ctx = self.ctx
        MockURLProtocol.setHandler { request in
            let seen = log.record(request)
            guard seen.method == "GET" else { return Self.stub(405, #"{"error":"no node admin writes"}"#) }
            switch seen.path {
            case "/admin-api/groups/\(namespace)/subgroups":
                return Self.stub(
                    200,
                    #"{"subgroups":[{"groupId":"\#(channelGroup)","name":"general"},"#
                        + #"{"groupId":"\#(String(repeating: "bb", count: 32))","name":"DM_CONTEXT_x"}]}"#)
            case "/admin-api/groups/\(channelGroup)/contexts":
                return Self.stub(200, #"{"data":[{"contextId":"\#(ctx)","name":"general"}]}"#)
            case "/admin-api/contexts/\(ctx)/group":
                return Self.stub(200, #"{"data":"\#(channelGroup)"}"#)
            case "/admin-api/groups/\(channelGroup)/members":
                return Self.stub(200, #"{"members":[{"identity":"\#(account)","role":"Member"}],"selfIdentity":null}"#)
            default:
                if seen.path.hasPrefix("/admin-api/groups/"), seen.path.split(separator: "/").count == 3 {
                    // getGroupInfo: core's own wire fixture (rc83 group_info.res.json), in this namespace.
                    let id = String(seen.path.split(separator: "/")[2])
                    return Self.stub(
                        200,
                        #"{"data":{"appKey":"\#(String(repeating: "bb", count: 32))","contextCount":1,"#
                            + #""defaultCapabilities":0,"groupId":"\#(id)","memberCount":1,"#
                            + #""namespaceId":"\#(namespace)","subgroupVisibility":"open","#
                            + #""targetApplicationId":"\#(String(repeating: "ee", count: 32))"}}"#)
                }
                return Self.stub(200, #"{"data":[]}"#)
            }
        }
    }

    func testChannelGroupsAreTheNamespacesSubgroupsWithTheirContexts() async throws {
        serveRelayAdmin()
        let backend = makeBackend(deps: DelegatedPathDepsLog())

        let groups = try await backend.listChannelGroups(namespaceId: namespace)

        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups.first, ChannelGroupListing(groupId: channelGroup, name: "general", contextIds: [ctx]))
        XCTAssertEqual(groups.last?.name, "DM_CONTEXT_x")
        let member = try await backend.isMember(contextId: ctx)
        XCTAssertTrue(member)
    }

    func testCreatingAChannelIsARootOpAndAContextIntentNeverANodeAdminWrite() async throws {
        serveRelayAdmin()
        let deps = DelegatedPathDepsLog()
        let backend = makeBackend(deps: deps)
        let workspace = Workspace(id: namespace, name: "Team", applicationId: String(repeating: "ee", count: 32))
        let contract = RecordingChatContract { _ in JSONValue.string("Profile set") }
        let creator = ChannelCreator(backend: DelegatedPathContractOverride(base: backend, contract: contract))

        let contextId = try await creator.create(
            in: workspace, name: "random", isPublic: false, username: "alice",
            now: Date(timeIntervalSince1970: 1_760_000_000))

        XCTAssertEqual(contextId, "ctx-new")
        let notes = deps.notes
        // GroupCreated (RootOp 0) on the namespace, then the name (GroupMetadataSet, 11)
        // and the visibility (SubgroupVisibilitySet, 10) on the new subgroup.
        XCTAssertEqual(notes.first, "root \(namespace) kind=root tag=0")
        XCTAssertTrue(notes.contains("group \(newGroup) kind=group tag=11"), "\(notes)")
        XCTAssertTrue(notes.contains("group \(newGroup) kind=group tag=10"), "\(notes)")

        let create = try XCTUnwrap(deps.creates.first)
        XCTAssertEqual(create.namespaceId, namespace)
        XCTAssertEqual(create.groupId, newGroup)
        XCTAssertEqual(create.name, "random")
        XCTAssertEqual(
            create.initializationParams,
            ChatJSON.bytes(ChatAPI.channelInitArgs(name: "random", createdAt: 1_760_000_000)))

        // The creator's name, as a warrant in the new context.
        XCTAssertEqual(contract.calls.map(\.method), ["set_profile"])
        XCTAssertEqual(contract.calls.first?.path, .execute)
        XCTAssertEqual(contract.calls.first?.contextId, "ctx-new")

        XCTAssertTrue(log.all.allSatisfy { $0.method == "GET" }, "only reads reach the relay's admin API")
    }

    func testJoiningAnOpenChannelIsMemberJoinedOpenOnItsGroup() async throws {
        serveRelayAdmin()
        let deps = DelegatedPathDepsLog()
        let backend = makeBackend(deps: deps)

        try await backend.joinChannel(contextId: ctx)

        // RootOp 7 = MemberJoinedOpen, posted to the namespace for the channel's group.
        XCTAssertEqual(deps.notes, ["root \(channelGroup) kind=root tag=7"])
    }
}

/// A backend that forwards everything but answers contract calls from `contract`.
struct DelegatedPathContractOverride: ChatBackend {
    let base: DelegatedChatBackend
    let contract: any ChatContract

    var account: String { base.account }
    var hasRelay: Bool { base.hasRelay }
    var canSubscribe: Bool { base.canSubscribe }

    func listWorkspaces() async throws -> [Workspace] { try await base.listWorkspaces() }
    func listChannelGroups(namespaceId: String) async throws -> [ChannelGroupListing] {
        try await base.listChannelGroups(namespaceId: namespaceId)
    }
    func isMember(contextId: String) async throws -> Bool { try await base.isMember(contextId: contextId) }
    func joinChannel(contextId: String) async throws { try await base.joinChannel(contextId: contextId) }
    func foundWorkspace(name: String) async throws -> FoundedWorkspace { try await base.foundWorkspace(name: name) }
    func createChannelGroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String {
        try await base.createChannelGroup(namespaceId: namespaceId, name: name, isPublic: isPublic)
    }
    func createContext(
        groupId: String, applicationId: String, name: String, initArgs: JSONValue
    ) async throws -> String {
        try await base.createContext(groupId: groupId, applicationId: applicationId, name: name, initArgs: initArgs)
    }
    func createInvitation(namespaceId: String) async throws -> SignedGroupOpenInvitation {
        try await base.createInvitation(namespaceId: namespaceId)
    }
    func joinWorkspace(namespaceId: String, invitation: SignedGroupOpenInvitation) async throws -> JoinedWorkspace {
        try await base.joinWorkspace(namespaceId: namespaceId, invitation: invitation)
    }
    func events(contextId: String) -> AsyncThrowingStream<ChatLiveEvent, Error> { base.events(contextId: contextId) }
}
