import Foundation
import MeroKit

// The contract's answers, as Mero Sign's component ABI (`logic/res/abi.json`) declares them:
// camelCase fields, u64s as decimal strings or numbers, ids as account-id strings or byte arrays.
// The calls are the generated `SignClient` (`Generated/`, `scripts/mobile-codegen.sh` at the repo
// root); until the logic derives `AbiType` the ABI names these types without their shape, so the
// client takes and answers their JSON and they read and write it (`JSONValue.decoded(as:)`,
// `JSONValue(encoding:)`).

extension SignClient {
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
}

extension JSONValue {
    /// This answer as the app type `T` (one of the types below).
    public func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
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
