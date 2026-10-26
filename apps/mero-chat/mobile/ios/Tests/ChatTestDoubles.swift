import Foundation
import MeroKit
import XCTest

/// One contract call a test double saw.
struct RecordedContractCall: Equatable, Sendable {
    enum Path: String, Sendable {
        case query
        case execute
    }

    let path: Path
    let contextId: String
    let method: String
    let args: JSONValue
}

/// A ``ChatContract`` that records every call and answers from a handler.
final class RecordingChatContract: ChatContract, @unchecked Sendable {
    typealias Handler = @Sendable (RecordedContractCall) throws -> JSONValue?

    private let lock = NSLock()
    private var recorded: [RecordedContractCall] = []
    private var handler: Handler

    init(handler: @escaping Handler = { _ in .null }) {
        self.handler = handler
    }

    var calls: [RecordedContractCall] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func setHandler(_ handler: @escaping Handler) {
        lock.lock()
        defer { lock.unlock() }
        self.handler = handler
    }

    func calls(_ method: String) -> [RecordedContractCall] {
        calls.filter { $0.method == method }
    }

    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try record(RecordedContractCall(path: .query, contextId: contextId, method: method, args: args))
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try record(RecordedContractCall(path: .execute, contextId: contextId, method: method, args: args))
    }

    private func record(_ call: RecordedContractCall) throws -> JSONValue? {
        lock.lock()
        recorded.append(call)
        let current = handler
        lock.unlock()
        return try current(call)
    }
}

/// A ``ChatBackend`` whose admin side is scripted and whose contract is a
/// ``RecordingChatContract``.
final class FakeChatBackend: ChatBackend, @unchecked Sendable {
    let account: String
    let recording: RecordingChatContract
    var contract: any ChatContract { recording }
    var hasRelay = true
    var canSubscribe = false

    var workspaces: [Workspace] = []
    var groups: [String: [ChannelGroupListing]] = [:]
    var members: Set<String> = []
    var founded = FoundedWorkspace(namespaceId: String(repeating: "ab", count: 32), haEnabled: true, haError: nil)
    var joinResult = JoinedWorkspace(published: true, relayURL: "https://relay.test")
    var failure: Error?
    var liveEvents: [ChatLiveEvent] = []

    private(set) var log: [String] = []
    private(set) var createdContextInitArgs: [JSONValue] = []
    private(set) var joinedNamespaces: [String] = []
    /// Blobs uploaded, by id, and the context each went to.
    private(set) var blobs: [String: (contextId: String, data: Data)] = [:]
    var blobFailure: Error?
    private var nextGroup = 0

    init(account: String = ChatFixtures.account, contract: RecordingChatContract = RecordingChatContract()) {
        self.account = account
        self.recording = contract
    }

    private func check(_ entry: String) throws {
        log.append(entry)
        if let failure { throw failure }
    }

    func listWorkspaces() async throws -> [Workspace] {
        try check("listWorkspaces")
        return workspaces
    }

    func listChannelGroups(namespaceId: String) async throws -> [ChannelGroupListing] {
        try check("listChannelGroups \(namespaceId)")
        return groups[namespaceId] ?? []
    }

    func isMember(contextId: String) async throws -> Bool {
        members.contains(contextId)
    }

    func joinChannel(contextId: String) async throws {
        try check("joinChannel \(contextId)")
        members.insert(contextId)
    }

    func foundWorkspace(name: String) async throws -> FoundedWorkspace {
        try check("foundWorkspace \(name)")
        return founded
    }

    func createChannelGroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String {
        try check("createChannelGroup \(namespaceId) \(name) \(isPublic ? "open" : "restricted")")
        nextGroup += 1
        return "group-\(nextGroup)"
    }

    func createContext(
        groupId: String, applicationId: String, name: String, initArgs: JSONValue
    ) async throws -> String {
        try check("createContext \(groupId) \(applicationId) \(name)")
        createdContextInitArgs.append(initArgs)
        return "ctx-\(groupId)"
    }

    func createInvitation(namespaceId: String) async throws -> SignedGroupOpenInvitation {
        try check("createInvitation \(namespaceId)")
        return try ChatFixtures.signedInvitation()
    }

    func joinWorkspace(namespaceId: String, invitation: SignedGroupOpenInvitation) async throws -> JoinedWorkspace {
        try check("joinWorkspace \(namespaceId)")
        joinedNamespaces.append(namespaceId)
        return joinResult
    }

    func uploadBlob(contextId: String, data: Data) async throws -> String {
        try check("uploadBlob \(contextId) \(data.count)")
        if let blobFailure { throw blobFailure }
        let id = String(format: "%064x", blobs.count + 1)
        blobs[id] = (contextId, data)
        return id
    }

    func downloadBlob(blobId: String, contextId: String) async throws -> Data {
        try check("downloadBlob \(blobId) \(contextId)")
        guard let stored = blobs[blobId] else { throw ChatError.invalidInput("no blob \(blobId)") }
        return stored.data
    }

    func events(contextId: String) -> AsyncThrowingStream<ChatLiveEvent, Error> {
        let events = liveEvents
        return AsyncThrowingStream { continuation in
            for event in events { continuation.yield(event) }
            continuation.finish()
        }
    }
}

extension JSONValue {
    /// Parse a JSON literal in a test.
    static func parse(_ json: String, file: StaticString = #filePath, line: UInt = #line) -> JSONValue {
        do {
            return try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        } catch {
            XCTFail("bad JSON fixture: \(error)", file: file, line: line)
            return .null
        }
    }
}
