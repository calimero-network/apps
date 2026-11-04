import Foundation
import MeroKit
import MeroKitUI
@testable import MeroTag

/// Records every call and answers reads from a canned table: the cluster,
/// without a network.
final class FakeTransport: ContextTransport, @unchecked Sendable {
    struct Call: Equatable {
        let kind: String
        let appId: String
        let method: String
        let args: JSONValue
    }

    private let lock = NSLock()
    private var _calls: [Call] = []
    var responses: [String: JSONValue] = [:]
    var failures: [String: Error] = [:]
    var frames: AsyncThrowingStream<CloudEvent, Error>?

    var calls: [Call] { lock.withLock { _calls } }
    var writes: [Call] { calls.filter { $0.kind == "execute" } }

    func query(appId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try record("query", appId, method, args)
    }

    func execute(appId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try record("execute", appId, method, args)
    }

    func events(appId: String) -> AsyncThrowingStream<CloudEvent, Error>? { frames }

    private func record(_ kind: String, _ app: String, _ method: String, _ args: JSONValue) throws -> JSONValue? {
        lock.withLock { _calls.append(Call(kind: kind, appId: app, method: method, args: args)) }
        if let error = failures[method] { throw error }
        return responses[method]
    }
}

/// A client that talks to no cluster (nothing in its session store).
@MainActor
func makeClient() -> MeroClient {
    MeroClient(config: MeroProviderConfig(packageName: SpaceInvite.appSlug), store: MemoryCloudSessionStore())
}

/// An app acting as ``Fixtures/account`` without a cluster.
@MainActor
func signedInApp(
    transport: FakeTransport = Fixtures.transport(), directory: FakeDirectory = FakeDirectory(),
    defaults: UserDefaults = isolatedDefaults()
) -> AppState {
    let app = AppState(
        client: makeClient(), preferences: SpacePreferences(defaults: defaults),
        makeTransport: { _ in transport }, makeDirectory: { _ in directory })
    app.syncDelay = 0
    app.signInForTesting(account: Fixtures.account)
    return app
}

/// Records what the app asked of the organization layer.
final class FakeDirectory: SpaceDirectory, @unchecked Sendable {
    private let lock = NSLock()
    private var _created: [String] = []
    private var _invited: [String] = []
    private var _joined: [String] = []
    var failure: Error?

    var created: [String] { lock.withLock { _created } }
    var invited: [String] { lock.withLock { _invited } }
    var joined: [String] { lock.withLock { _joined } }

    func createSpace(named name: String) async throws -> CreatedSpace {
        if let failure { throw failure }
        lock.withLock { _created.append(name) }
        return CreatedSpace(orgId: Fixtures.org, appId: "app-new")
    }

    func invite(appId: String, spaceName: String) async throws -> SpaceInvite {
        if let failure { throw failure }
        lock.withLock { _invited.append(appId) }
        return Fixtures.invite()
    }

    func join(_ invite: SpaceInvite) async throws {
        if let failure { throw failure }
        lock.withLock { _joined.append(invite.token) }
    }
}

func isolatedDefaults() -> UserDefaults {
    let name = "merotag.tests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

enum Fixtures {
    static let account = String(repeating: "ab", count: 32)
    static let app = "app-1"
    static let org = "org-9a"

    static func invite() -> SpaceInvite {
        SpaceInvite(orgId: org, appId: app, spaceName: "Family", token: "inv_5f3c2a")
    }

    static let trackers: JSONValue = [
        [
            "id": "t2", "name": "Bike", "ownerId": .string(account), "viewers": [],
            "latest": nil, "createdAt": 1, "updatedAt": 1,
        ],
        [
            "id": "t1", "name": "Alpha", "ownerId": "someone", "viewers": [.string(account)],
            "latest": [
                "latitude": 45.8, "longitude": 15.97, "altitude": 120, "speed": 1.5, "heading": 90,
                "battery": 76, "timestamp": 1_700_000_000_000,
            ],
            "createdAt": 1, "updatedAt": 2,
        ],
    ]
    static let space: JSONValue = ["name": "Family", "trackerCount": 2, "memberCount": 1, "groupCount": 0]
    static let members: JSONValue = [["id": "someone", "username": "Ana", "joinedAt": 1]]
    static let presence: JSONValue = [["userId": "someone", "online": true, "lastSeen": 5]]
    static let me: JSONValue = ["memberId": .string(account), "org": .string(org), "orgRole": "member"]

    static func transport() -> FakeTransport {
        let t = FakeTransport()
        t.responses = [
            "get_trackers": trackers, "get_space": space, "get_members": members, "get_presence": presence,
            "whoami": me,
        ]
        return t
    }
}
