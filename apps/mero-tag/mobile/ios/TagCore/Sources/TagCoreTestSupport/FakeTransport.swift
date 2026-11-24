import Foundation
import MeroKit
import TagCore

/// Records every call and answers reads from a canned table: the cluster,
/// without a network. Shared by TagCore's tests and the app's.
public final class FakeTransport: ContextTransport, @unchecked Sendable {
    public struct Call: Equatable {
        public let kind: String
        public let appId: String
        public let method: String
        public let args: JSONValue

        public init(kind: String, appId: String, method: String, args: JSONValue) {
            self.kind = kind
            self.appId = appId
            self.method = method
            self.args = args
        }
    }

    private let lock = NSLock()
    private var _calls: [Call] = []
    public var responses: [String: JSONValue] = [:]
    public var failures: [String: Error] = [:]
    public var frames: AsyncThrowingStream<CloudEvent, Error>?

    public init() {}

    public var calls: [Call] { lock.withLock { _calls } }
    public var writes: [Call] { calls.filter { $0.kind == "execute" } }

    public func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try record("query", contextId, method, args)
    }

    public func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try record("execute", contextId, method, args)
    }

    public func events(appId: String) -> AsyncThrowingStream<CloudEvent, Error>? { frames }

    private func record(_ kind: String, _ app: String, _ method: String, _ args: JSONValue) throws -> JSONValue? {
        lock.withLock { _calls.append(Call(kind: kind, appId: app, method: method, args: args)) }
        if let error = failures[method] { throw error }
        return responses[method]
    }
}

/// A space as the fakes answer it.
public enum Fixtures {
    public static let account = String(repeating: "ab", count: 32)
    public static let app = "app-1"
    public static let org = "org-9a"

    public static func invite() -> SpaceInvite {
        SpaceInvite(orgId: org, appId: app, spaceName: "Family", token: "inv_5f3c2a")
    }

    public static let trackers: JSONValue = [
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
    public static let space: JSONValue = ["name": "Family", "trackerCount": 2, "memberCount": 1, "groupCount": 0]
    public static let members: JSONValue = [["id": "someone", "username": "Ana", "joinedAt": 1]]
    public static let presence: JSONValue = [["userId": "someone", "online": true, "lastSeen": 5]]
    public static let me: JSONValue = ["memberId": .string(account), "org": .string(org), "orgRole": "member"]

    public static func transport() -> FakeTransport {
        let t = FakeTransport()
        t.responses = [
            "getTrackers": trackers, "getSpace": space, "getMembers": members, "getPresence": presence,
            "whoami": me, "createTracker": "t-new",
        ]
        return t
    }
}
