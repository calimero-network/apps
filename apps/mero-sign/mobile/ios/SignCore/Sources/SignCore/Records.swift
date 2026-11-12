import Foundation
import MeroKit

// The contract's answers, as Mero Sign's component ABI (`logic/res/abi.json`) declares them:
// camelCase fields, u64s as decimal strings, ids as account-id strings. The calls and the answer
// types are the generated `SignClient` (`Generated/`, `scripts/mobile-codegen.sh` at the repo root).

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

// MARK: - Answers

// The answer types are the generated client's (`Generated/SignClient.swift`, from the ABI): ids are
// the strings the contract writes (read them through ``ContractBytes/text(_:)`` to compare or turn
// them into hex), u64s are `UInt64`.

/// Detailed information about a shared context.
public typealias ContextDetails = SignClient.ContextDetails
public typealias ContextMetadata = SignClient.ContextMetadata
public typealias DocumentChunk = SignClient.DocumentChunk
public typealias DocumentInfo = SignClient.DocumentInfo
public typealias DocumentSignature = SignClient.DocumentSignature
public typealias DocumentStatus = SignClient.DocumentStatus
/// Identity mapping for tracking user identities across contexts.
public typealias IdentityMapping = SignClient.IdentityMapping
/// Participant information with permission level.
public typealias ParticipantInfo = SignClient.ParticipantInfo
/// Participant roles in shared contexts.
public typealias ParticipantRole = SignClient.ParticipantRole
/// Permission levels for participants.
public typealias PermissionLevel = SignClient.PermissionLevel
/// Signature record - uses LWW based on created_at timestamp.
public typealias SignatureRecord = SignClient.SignatureRecord

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
