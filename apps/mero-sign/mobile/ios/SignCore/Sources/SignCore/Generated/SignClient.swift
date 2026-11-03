// The contract, as Mero Sign's component ABI (`logic/res/abi.json`) declares it:
// methods, arguments and answer fields in camelCase, every u64 a decimal string in
// arguments (answers may carry either), accounts as account-id strings, blob ids
// as 64 lowercase hex digits, timestamps in milliseconds, and a refusal as
// `422 APP_ERROR {code, fields}` (`NotFound`, `Forbidden`, `Invalid`, `Conflict`).
// Written from the ABI (no codegen targets a component ABI yet);
// `ContractSurfaceTests` pins the method list and parameter names to it.

import Foundation
import MeroKit

/// Typed calls to the contract. Views go through `query`, calls through `execute`.
public struct SignClient: Sendable {
    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    /// The contract's views, by ABI name.
    public static let views: Set<String> = [
        "getContextDetails", "getContextId", "getDocumentSignatures", "getIdentityMapping",
        "getSharedIdentity", "getUserPermission", "hasConsented", "isDefaultPrivateContext", "listDocuments",
        "listJoinedContexts", "listParticipants", "listSignatures", "resolvePrivateIdentity",
        "searchDocumentByEmbedding", "whoami",
    ]
    /// The contract's calls, by ABI name.
    public static let calls: Set<String> = [
        "addParticipant", "createSignature", "deleteDocument", "deleteSignature", "joinSharedContext",
        "leaveSharedContext", "markParticipantSigned", "registerSelfAsParticipant", "removeParticipant",
        "setConsent", "setParticipantPermission", "setup", "signDocument", "uploadDocument",
    ]

    /// Add participant to shared context (admin only)
    ///
    /// `addParticipant`: a call, sent with `execute`.
    public func addParticipant(userIdStr: String, permission: PermissionLevel) async throws {
        _ = try await call("addParticipant", ["userIdStr": .string(userIdStr), "permission": try .encoded(permission)], as: JSONValue.self)
    }

    /// Create a new signature and store its blob ID
    ///
    /// `createSignature`: a call, sent with `execute`.
    @discardableResult
    public func createSignature(name: String, blobIdStr: String, dataSize: UInt64) async throws -> UInt64 {
        try await call("createSignature", ["name": .string(name), "blobIdStr": .string(blobIdStr), "dataSize": .u64(dataSize)], as: WireU64.self).value
    }

    /// Delete a document by ID. Admins only: they are the documents'
    /// moderators, and every node refuses anyone else's removal.
    ///
    /// Every account's document at the id, each by name (`remove_by`): keys
    /// are per owner, and a key-only `remove` removes only the caller's own.
    ///
    /// `deleteDocument`: a call, sent with `execute`.
    public func deleteDocument(documentId: String) async throws {
        _ = try await call("deleteDocument", ["documentId": .string(documentId)], as: JSONValue.self)
    }

    /// Delete a signature by ID
    ///
    /// `deleteSignature`: a call, sent with `execute`.
    public func deleteSignature(signatureId: UInt64) async throws {
        _ = try await call("deleteSignature", ["signatureId": .u64(signatureId)], as: JSONValue.self)
    }

    /// Get detailed information about the shared context
    ///
    /// `getContextDetails`: a view, sent with `query`.
    public func getContextDetails(contextIdStr: String) async throws -> ContextDetails {
        try await view("getContextDetails", ["contextIdStr": .string(contextIdStr)], as: ContextDetails.self)
    }

    /// Get current context ID
    ///
    /// `getContextId`: a view, sent with `query`.
    public func getContextId() async throws -> ContractBytes {
        try await view("getContextId", [:], as: ContractBytes.self)
    }

    /// The signatures on a document, in the order they were applied.
    ///
    /// `getDocumentSignatures`: a view, sent with `query`.
    public func getDocumentSignatures(documentId: String) async throws -> [DocumentSignature] {
        try await view("getDocumentSignatures", ["documentId": .string(documentId)], as: [DocumentSignature].self)
    }

    /// Get identity mapping for a specific context
    ///
    /// `getIdentityMapping`: a view, sent with `query`.
    public func getIdentityMapping(contextIdStr: String) async throws -> IdentityMapping {
        try await view("getIdentityMapping", ["contextIdStr": .string(contextIdStr)], as: IdentityMapping.self)
    }

    /// Get shared identity for a specific context
    ///
    /// `getSharedIdentity`: a view, sent with `query`.
    public func getSharedIdentity(contextIdStr: String) async throws -> ContractBytes {
        try await view("getSharedIdentity", ["contextIdStr": .string(contextIdStr)], as: ContractBytes.self)
    }

    /// Get user permission level
    ///
    /// `getUserPermission`: a view, sent with `query`.
    public func getUserPermission(userIdStr: String) async throws -> PermissionLevel {
        try await view("getUserPermission", ["userIdStr": .string(userIdStr)], as: PermissionLevel.self)
    }

    /// Check if user has given consent for a document (public API)
    ///
    /// `hasConsented`: a view, sent with `query`.
    public func hasConsented(userIdStr: String, documentId: String) async throws -> Bool {
        try await view("hasConsented", ["userIdStr": .string(userIdStr), "documentId": .string(documentId)], as: Bool.self)
    }

    /// `isDefaultPrivateContext`: a view, sent with `query`.
    public func isDefaultPrivateContext() async throws -> Bool {
        try await view("isDefaultPrivateContext", [:], as: Bool.self)
    }

    /// Join a shared context with identity mapping
    ///
    /// `joinSharedContext`: a call, sent with `execute`.
    public func joinSharedContext(contextIdStr: String, sharedIdentityStr: String, contextName: String) async throws {
        _ = try await call("joinSharedContext", ["contextIdStr": .string(contextIdStr), "sharedIdentityStr": .string(sharedIdentityStr), "contextName": .string(contextName)], as: JSONValue.self)
    }

    /// Leave a shared context
    ///
    /// `leaveSharedContext`: a call, sent with `execute`.
    public func leaveSharedContext(contextIdStr: String) async throws {
        _ = try await call("leaveSharedContext", ["contextIdStr": .string(contextIdStr)], as: JSONValue.self)
    }

    /// List all documents, without their search content (see [`DocumentInfo`]).
    ///
    /// `listDocuments`: a view, sent with `query`.
    public func listDocuments() async throws -> [DocumentInfo] {
        try await view("listDocuments", [:], as: [DocumentInfo].self)
    }

    /// List all joined contexts
    ///
    /// `listJoinedContexts`: a view, sent with `query`.
    public func listJoinedContexts() async throws -> [ContextMetadata] {
        try await view("listJoinedContexts", [:], as: [ContextMetadata].self)
    }

    /// List all participants
    ///
    /// `listParticipants`: a view, sent with `query`.
    public func listParticipants() async throws -> [ContractBytes] {
        try await view("listParticipants", [:], as: [ContractBytes].self)
    }

    /// Get all signatures
    ///
    /// `listSignatures`: a view, sent with `query`.
    public func listSignatures() async throws -> [SignatureRecord] {
        try await view("listSignatures", [:], as: [SignatureRecord].self)
    }

    /// Confirm the CALLER's signature is on a document.
    ///
    /// The status is derived from the signatures on every read, so there is
    /// nothing left to recompute; this stays so a client can ask, after
    /// signing, whether its signature is the one on the document.
    ///
    /// `markParticipantSigned`: a call, sent with `execute`.
    public func markParticipantSigned(documentId: String) async throws {
        _ = try await call("markParticipantSigned", ["documentId": .string(documentId)], as: JSONValue.self)
    }

    /// Register self as participant (for users who joined via open invitation)
    ///
    /// `registerSelfAsParticipant`: a call, sent with `execute`.
    public func registerSelfAsParticipant() async throws {
        _ = try await call("registerSelfAsParticipant", [:], as: JSONValue.self)
    }

    /// Remove participant from shared context. The removal outranks the
    /// participant's own registration, and is refused for the last admin.
    ///
    /// `removeParticipant`: a call, sent with `execute`.
    public func removeParticipant(userIdStr: String) async throws {
        _ = try await call("removeParticipant", ["userIdStr": .string(userIdStr)], as: JSONValue.self)
    }

    /// Resolve private identity from shared identity
    ///
    /// `resolvePrivateIdentity`: a view, sent with `query`.
    public func resolvePrivateIdentity(sharedIdentityStr: String) async throws -> ContractBytes? {
        try await view("resolvePrivateIdentity", ["sharedIdentityStr": .string(sharedIdentityStr)], as: ContractBytes?.self)
    }

    /// `searchDocumentByEmbedding`: a view, sent with `query`.
    public func searchDocumentByEmbedding(queryEmbedding: [Float], documentId: String) async throws -> String {
        try await view("searchDocumentByEmbedding", ["queryEmbedding": try .encoded(queryEmbedding), "documentId": .string(documentId)], as: String.self)
    }

    /// Record the CALLER's consent to sign a document, in their own slot.
    ///
    /// Consent is a personal act. Nobody can give it for you, so there is no
    /// parameter to give — and the slot is yours alone on every node.
    ///
    /// `setConsent`: a call, sent with `execute`.
    public func setConsent(documentId: String) async throws {
        _ = try await call("setConsent", ["documentId": .string(documentId)], as: JSONValue.self)
    }

    /// Change an EXISTING participant's permission level, up or down.
    ///
    /// `add_participant` cannot do this: it refuses a user who is already a
    /// participant. Levels live in `AccessControl`, whose grants merge
    /// last-writer-wins, so a demotion converges like a promotion. The last
    /// admin cannot step down.
    ///
    /// `setParticipantPermission`: a call, sent with `execute`.
    public func setParticipantPermission(userIdStr: String, permission: PermissionLevel) async throws {
        _ = try await call("setParticipantPermission", ["userIdStr": .string(userIdStr), "permission": try .encoded(permission)], as: JSONValue.self)
    }

    /// Set the instance up, once, by its owner: `isPrivate` for the account's
    /// signature library (`contextName` "default"), else an agreement named
    /// `contextName`. Until then every method but `isDefaultPrivateContext` answers `Invalid`.
    ///
    /// `setup`: a call, sent with `execute`.
    public func setup(isPrivate: Bool, contextName: String) async throws {
        _ = try await call("setup", ["isPrivate": .bool(isPrivate), "contextName": .string(contextName)], as: JSONValue.self)
    }

    /// Record the CALLER's signature on a document.
    ///
    /// The signer is the caller's ACCOUNT — a document is signed by a PERSON,
    /// and one signer on two machines must not read as two signatories — and on
    /// every other node it is the signature entry's owner stamp. There is no
    /// signer parameter.
    ///
    /// A signature is not a field value, it is a whole new PDF: the signer
    /// downloads the current version, flattens their mark into it in the
    /// browser, uploads the result as a NEW blob, and records it here as a
    /// write-once [`SignedVersion`] from `base_hash` to `new_hash`. Nothing is
    /// overwritten: the uploaded document and every signature stay on record,
    /// and the document's current version is the last one in the chain.
    ///
    /// `base_hash` is the hash the signer actually had in front of them. If it
    /// is not the current version, somebody else signed in the meantime and
    /// this PDF lacks their mark — refused, so the signer re-fetches and
    /// re-signs.
    ///
    /// ⚠️ `pdf_blob_id_str` must name a blob THIS node holds. The announce below
    /// fails the whole call otherwise, with
    /// `blob operations not supported (NodeClient not available)` — a message
    /// about the host, not about the blob, which reads like a misconfigured node.
    ///
    /// `signDocument`: a call, sent with `execute`.
    public func signDocument(documentId: String, baseHash: String, pdfBlobIdStr: String, fileSize: UInt64, newHash: String) async throws {
        _ = try await call("signDocument", ["documentId": .string(documentId), "baseHash": .string(baseHash), "pdfBlobIdStr": .string(pdfBlobIdStr), "fileSize": .u64(fileSize), "newHash": .string(newHash)], as: JSONValue.self)
    }

    /// Upload a document
    ///
    /// `uploadDocument`: a call, sent with `execute`.
    @discardableResult
    public func uploadDocument(name: String, hash: String, pdfBlobIdStr: String, fileSize: UInt64, embeddings: [Float]? = nil, extractedText: String? = nil, chunks: [DocumentChunk]? = nil) async throws -> String {
        try await call("uploadDocument", ["name": .string(name), "hash": .string(hash), "pdfBlobIdStr": .string(pdfBlobIdStr), "fileSize": .u64(fileSize), "embeddings": try .encoded(embeddings), "extractedText": .optional(extractedText), "chunks": try .encoded(chunks)], as: String.self)
    }

    /// The caller's ACCOUNT id, as this contract sees it.
    ///
    /// Exists because the frontend cannot work it out. A device key and an
    /// account id have both been 32 raw bytes — 64 hex characters — since core
    /// 0.11.0-rc.27, so the two are indistinguishable by inspection, and this
    /// app holds a DEVICE key in `localStorage` (`agreementContextUserID`, the
    /// context member public key from the join response) while participants
    /// are keyed by ACCOUNT. Comparing the two type-checks and silently matches
    /// nothing, which is how a UI ends up unable to tell an admin that they
    /// are one.
    ///
    /// One call removes the guess: the contract is the only thing that knows.
    ///
    /// `whoami`: a view, sent with `query`.
    public func whoami() async throws -> ContractBytes {
        try await view("whoami", [:], as: ContractBytes.self)
    }

    private func view<T: Decodable>(_ method: String, _ args: [String: JSONValue], as: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await transport.query(method: method, argsJSON: Self.encode(args)))
    }

    private func call<T: Decodable>(_ method: String, _ args: [String: JSONValue], as: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await transport.execute(method: method, argsJSON: Self.encode(args)))
    }

    static func encode(_ args: [String: JSONValue]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try encoder.encode(JSONValue.object(args))
    }
}

extension JSONValue {
    /// A u64 argument: a decimal string. `nil` is an explicit `null`.
    static func u64(_ value: UInt64?) -> JSONValue { value.map { .string(String($0)) } ?? .null }
    /// An `option<string>` argument: `nil` is an explicit `null`.
    static func optional(_ value: String?) -> JSONValue { value.map { .string($0) } ?? .null }

    /// Any argument through its `Encodable` form (enums, chunks, embeddings); `nil` is `null`.
    static func encoded<T: Encodable>(_ value: T?) throws -> JSONValue {
        guard let value else { return .null }
        return try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }
}

/// A u64 answer: a decimal string (a number is taken too).
struct WireU64: Decodable {
    let value: UInt64

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self) {
            guard let value = UInt64(text) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a u64: \(text)")
            }
            self.value = value
        } else {
            value = try c.decode(UInt64.self)
        }
    }
}

extension KeyedDecodingContainer {
    func decodeU64(_ key: Key) throws -> UInt64 {
        try decode(WireU64.self, forKey: key).value
    }
}

extension KeyedEncodingContainer {
    /// A u64 field as the contract writes it: a decimal string.
    mutating func encodeU64(_ value: UInt64, _ key: Key) throws { try encode(String(value), forKey: key) }
}

// MARK: - Answers

/// Detailed information about a shared context
public struct ContextDetails: Codable, Sendable, Equatable {
    public var contextId: ContractBytes
    public var contextName: String
    public var owner: ContractBytes
    public var isPrivate: Bool
    public var participantCount: UInt64
    public var participants: [ParticipantInfo]
    public var documentCount: UInt64
    public var createdAt: UInt64

    public init(contextId: ContractBytes, contextName: String, owner: ContractBytes, isPrivate: Bool, participantCount: UInt64, participants: [ParticipantInfo], documentCount: UInt64, createdAt: UInt64) {
        self.contextId = contextId
        self.contextName = contextName
        self.owner = owner
        self.isPrivate = isPrivate
        self.participantCount = participantCount
        self.participants = participants
        self.documentCount = documentCount
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case contextId
        case contextName
        case owner
        case isPrivate
        case participantCount
        case participants
        case documentCount
        case createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contextId = try c.decode(ContractBytes.self, forKey: .contextId)
        contextName = try c.decode(String.self, forKey: .contextName)
        owner = try c.decode(ContractBytes.self, forKey: .owner)
        isPrivate = try c.decode(Bool.self, forKey: .isPrivate)
        participantCount = try c.decodeU64(.participantCount)
        participants = try c.decode([ParticipantInfo].self, forKey: .participants)
        documentCount = try c.decodeU64(.documentCount)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(contextId, forKey: .contextId)
        try c.encode(contextName, forKey: .contextName)
        try c.encode(owner, forKey: .owner)
        try c.encode(isPrivate, forKey: .isPrivate)
        try c.encodeU64(participantCount, .participantCount)
        try c.encode(participants, forKey: .participants)
        try c.encodeU64(documentCount, .documentCount)
        try c.encodeU64(createdAt, .createdAt)
    }
}

/// Metadata for tracking joined shared contexts
public struct ContextMetadata: Codable, Sendable, Equatable {
    public var contextId: ContractBytes
    public var contextName: String
    public var role: ParticipantRole
    public var joinedAt: UInt64
    public var privateIdentity: ContractBytes
    public var sharedIdentity: ContractBytes

    public init(contextId: ContractBytes, contextName: String, role: ParticipantRole, joinedAt: UInt64, privateIdentity: ContractBytes, sharedIdentity: ContractBytes) {
        self.contextId = contextId
        self.contextName = contextName
        self.role = role
        self.joinedAt = joinedAt
        self.privateIdentity = privateIdentity
        self.sharedIdentity = sharedIdentity
    }

    enum CodingKeys: String, CodingKey {
        case contextId
        case contextName
        case role
        case joinedAt
        case privateIdentity
        case sharedIdentity
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contextId = try c.decode(ContractBytes.self, forKey: .contextId)
        contextName = try c.decode(String.self, forKey: .contextName)
        role = try c.decode(ParticipantRole.self, forKey: .role)
        joinedAt = try c.decodeU64(.joinedAt)
        privateIdentity = try c.decode(ContractBytes.self, forKey: .privateIdentity)
        sharedIdentity = try c.decode(ContractBytes.self, forKey: .sharedIdentity)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(contextId, forKey: .contextId)
        try c.encode(contextName, forKey: .contextName)
        try c.encode(role, forKey: .role)
        try c.encodeU64(joinedAt, .joinedAt)
        try c.encode(privateIdentity, forKey: .privateIdentity)
        try c.encode(sharedIdentity, forKey: .sharedIdentity)
    }
}

/// Document chunk with its embedding
public struct DocumentChunk: Codable, Sendable, Equatable {
    public var text: String
    public var embedding: [Float]
    public var startPosition: UInt32
    public var endPosition: UInt32

    public init(text: String, embedding: [Float], startPosition: UInt32, endPosition: UInt32) {
        self.text = text
        self.embedding = embedding
        self.startPosition = startPosition
        self.endPosition = endPosition
    }

    enum CodingKeys: String, CodingKey {
        case text
        case embedding
        case startPosition
        case endPosition
    }
}

/// Document information as read: the uploaded document, its current version
/// (the last signature's, or the upload's) and its status, derived every read
/// from the write-once entries.
///
/// `embeddings`, `extracted_text` and `chunks` are always `None` in
/// `list_documents`, which returns every document; they stay in storage for
/// `search_document_by_embedding`.
public struct DocumentInfo: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var hash: String
    public var uploadedBy: ContractBytes
    public var uploadedAt: UInt64
    public var status: DocumentStatus
    public var pdfBlobId: ContractBytes
    public var size: UInt64
    public var requiredSigners: [ContractBytes]
    public var embeddings: [Float]?
    public var extractedText: String?
    public var chunks: [DocumentChunk]?

    public init(id: String, name: String, hash: String, uploadedBy: ContractBytes, uploadedAt: UInt64, status: DocumentStatus, pdfBlobId: ContractBytes, size: UInt64, requiredSigners: [ContractBytes], embeddings: [Float]? = nil, extractedText: String? = nil, chunks: [DocumentChunk]? = nil) {
        self.id = id
        self.name = name
        self.hash = hash
        self.uploadedBy = uploadedBy
        self.uploadedAt = uploadedAt
        self.status = status
        self.pdfBlobId = pdfBlobId
        self.size = size
        self.requiredSigners = requiredSigners
        self.embeddings = embeddings
        self.extractedText = extractedText
        self.chunks = chunks
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case hash
        case uploadedBy
        case uploadedAt
        case status
        case pdfBlobId
        case size
        case requiredSigners
        case embeddings
        case extractedText
        case chunks
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        hash = try c.decode(String.self, forKey: .hash)
        uploadedBy = try c.decode(ContractBytes.self, forKey: .uploadedBy)
        uploadedAt = try c.decodeU64(.uploadedAt)
        status = try c.decode(DocumentStatus.self, forKey: .status)
        pdfBlobId = try c.decode(ContractBytes.self, forKey: .pdfBlobId)
        size = try c.decodeU64(.size)
        requiredSigners = try c.decode([ContractBytes].self, forKey: .requiredSigners)
        embeddings = try c.decodeIfPresent([Float].self, forKey: .embeddings)
        extractedText = try c.decodeIfPresent(String.self, forKey: .extractedText)
        chunks = try c.decodeIfPresent([DocumentChunk].self, forKey: .chunks)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(hash, forKey: .hash)
        try c.encode(uploadedBy, forKey: .uploadedBy)
        try c.encodeU64(uploadedAt, .uploadedAt)
        try c.encode(status, forKey: .status)
        try c.encode(pdfBlobId, forKey: .pdfBlobId)
        try c.encodeU64(size, .size)
        try c.encode(requiredSigners, forKey: .requiredSigners)
        try c.encodeIfPresent(embeddings, forKey: .embeddings)
        try c.encodeIfPresent(extractedText, forKey: .extractedText)
        try c.encodeIfPresent(chunks, forKey: .chunks)
    }
}

/// A signature on a document, as read. `signer` is the entry's owner stamp.
public struct DocumentSignature: Codable, Sendable, Equatable {
    public var signer: ContractBytes
    public var signedAt: UInt64

    public init(signer: ContractBytes, signedAt: UInt64) {
        self.signer = signer
        self.signedAt = signedAt
    }

    enum CodingKeys: String, CodingKey {
        case signer
        case signedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        signer = try c.decode(ContractBytes.self, forKey: .signer)
        signedAt = try c.decodeU64(.signedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(signer, forKey: .signer)
        try c.encodeU64(signedAt, .signedAt)
    }
}

/// Document status, derived from the document's signatures.
///
/// `FullySigned` IS TERMINAL. Completion is a fact about the past: the
/// signers a document waits for are fixed when it is uploaded, its signatures
/// are written once, and a completed document refuses further signatures. A
/// participant added later was not party to it; if they need to be, that is a
/// new document.
public enum DocumentStatus: String, Codable, Sendable, Equatable, CaseIterable {
    case pending = "Pending"
    case partiallySigned = "PartiallySigned"
    case fullySigned = "FullySigned"
}

/// Identity mapping for tracking user identities across contexts
public struct IdentityMapping: Codable, Sendable, Equatable {
    public var privateIdentity: ContractBytes
    public var sharedIdentity: ContractBytes
    public var contextId: ContractBytes
    public var createdAt: UInt64

    public init(privateIdentity: ContractBytes, sharedIdentity: ContractBytes, contextId: ContractBytes, createdAt: UInt64) {
        self.privateIdentity = privateIdentity
        self.sharedIdentity = sharedIdentity
        self.contextId = contextId
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case privateIdentity
        case sharedIdentity
        case contextId
        case createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        privateIdentity = try c.decode(ContractBytes.self, forKey: .privateIdentity)
        sharedIdentity = try c.decode(ContractBytes.self, forKey: .sharedIdentity)
        contextId = try c.decode(ContractBytes.self, forKey: .contextId)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(privateIdentity, forKey: .privateIdentity)
        try c.encode(sharedIdentity, forKey: .sharedIdentity)
        try c.encode(contextId, forKey: .contextId)
        try c.encodeU64(createdAt, .createdAt)
    }
}

/// Participant information with permission level
public struct ParticipantInfo: Codable, Sendable, Equatable {
    public var userId: ContractBytes
    public var permissionLevel: PermissionLevel

    public init(userId: ContractBytes, permissionLevel: PermissionLevel) {
        self.userId = userId
        self.permissionLevel = permissionLevel
    }

    enum CodingKeys: String, CodingKey {
        case userId
        case permissionLevel
    }
}

/// Participant roles in shared contexts
public enum ParticipantRole: String, Codable, Sendable, Equatable, CaseIterable {
    case owner = "Owner"
    case signer = "Signer"
    case viewer = "Viewer"
    case unknown = "Unknown"
}

/// Permission levels for participants
public enum PermissionLevel: String, Codable, Sendable, Equatable, CaseIterable {
    case read = "Read"
    case sign = "Sign"
    case admin = "Admin"
}

/// Signature record - uses LWW based on created_at timestamp
public struct SignatureRecord: Codable, Sendable, Equatable {
    public var id: UInt64
    public var name: String
    public var blobId: ContractBytes
    public var size: UInt64
    public var createdAt: UInt64

    public init(id: UInt64, name: String, blobId: ContractBytes, size: UInt64, createdAt: UInt64) {
        self.id = id
        self.name = name
        self.blobId = blobId
        self.size = size
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case blobId
        case size
        case createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeU64(.id)
        name = try c.decode(String.self, forKey: .name)
        blobId = try c.decode(ContractBytes.self, forKey: .blobId)
        size = try c.decodeU64(.size)
        createdAt = try c.decodeU64(.createdAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeU64(id, .id)
        try c.encode(name, forKey: .name)
        try c.encode(blobId, forKey: .blobId)
        try c.encodeU64(size, .size)
        try c.encodeU64(createdAt, .createdAt)
    }
}

// MARK: - Wire helpers

/// Fixed-size bytes. An id with its own spelling (`UserId`, `BlobId`) is
/// ``text`` — base58 or hex, exactly as the contract writes it — and a plain
/// `[u8; N]` is ``raw``, an array of numbers. Decoding takes whichever arrives;
/// encoding writes the form this value holds.
public enum ContractBytes: Codable, Sendable, Equatable, Hashable, ExpressibleByStringLiteral {
    case text(String)
    case raw([UInt8])

    public init(stringLiteral value: String) { self = .text(value) }

    /// The text form, if that is what this holds.
    public var text: String? { if case .text(let value) = self { value } else { nil } }
    /// The array form, if that is what this holds.
    public var raw: [UInt8]? { if case .raw(let value) = self { value } else { nil } }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self) {
            self = .text(value)
        } else {
            self = .raw(try container.decode([UInt8].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let value): try container.encode(value)
        case .raw(let value): try container.encode(value)
        }
    }
}
