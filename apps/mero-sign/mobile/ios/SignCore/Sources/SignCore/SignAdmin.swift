import Foundation
import MeroKit

/// What Mero Sign needs from the account's admin surface beyond
/// ``MeroAppBackend``: blobs (a document's PDF and every signed version, the
/// signature images), group metadata (the marker that says which namespace
/// holds the private store) and member names.
///
/// The app uses ``BackendSignAdmin``; tests use a fake.
public protocol SignAdmin: Sendable {
    /// Store bytes against a context the account is a member of; the relay
    /// announces the blob to that context. Returns the blob id.
    func uploadBlob(_ data: Data, contextId: String) async throws -> String
    /// A blob's bytes, read through the context that holds it.
    func getBlob(_ blobId: String, contextId: String) async throws -> Data
    /// A group's metadata record: its name and data map, or nil if never set.
    func groupMetadata(_ groupId: String) async throws -> (name: String?, data: [String: String])?
    /// Replace a group's metadata record (name and data together).
    func setGroupMetadata(_ groupId: String, name: String?, data: [String: String]) async throws
    /// The name a member set for themselves in a namespace (shared by every app on it).
    func memberName(namespaceId: String, account: String) async throws -> String?
}

/// ``SignAdmin`` over the account's ``MeroAppBackend`` (blobs, metadata reads,
/// member names) and, for the one write the backend has no call for — a group
/// metadata record WITH a data map, the private store's marker — the
/// session's admin surface (`session.client.admin`).
public struct BackendSignAdmin: SignAdmin {
    public let backend: any MeroAppBackend
    public let admin: (any AdminSurface)?

    public init(backend: any MeroAppBackend, admin: (any AdminSurface)?) {
        self.backend = backend
        self.admin = admin
    }

    public func uploadBlob(_ data: Data, contextId: String) async throws -> String {
        try await backend.uploadBlob(contextId: contextId, data: data).blobId
    }

    public func getBlob(_ blobId: String, contextId: String) async throws -> Data {
        try await backend.getBlob(blobId: blobId, contextId: contextId)
    }

    public func groupMetadata(_ groupId: String) async throws -> (name: String?, data: [String: String])? {
        guard let record = try await backend.groupMetadata(groupId: groupId) else { return nil }
        return (record.name, record.data)
    }

    public func setGroupMetadata(_ groupId: String, name: String?, data: [String: String]) async throws {
        guard let admin else { throw SignModelError.message("You're signed out. Sign in again and retry.") }
        try await admin.setGroupMetadata(groupId, request: SetGroupMetadataRequest(name: name, data: data))
    }

    public func memberName(namespaceId: String, account: String) async throws -> String? {
        try await backend.listMembers(groupId: namespaceId).first { SignIds.same($0.identity, account) }?.name
    }
}
