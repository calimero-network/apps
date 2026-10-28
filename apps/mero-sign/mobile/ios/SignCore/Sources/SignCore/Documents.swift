import CryptoKit
import Foundation
import MeroKit

/// Which inbox list a document belongs in, for the signed-in account.
public enum InboxBucket: String, CaseIterable, Identifiable, Sendable {
    /// Not complete, and waiting on you.
    case toSign
    /// Not complete, and not waiting on you: you signed, or you only read it.
    case waiting
    /// Every required signer has signed (`FullySigned`, which is terminal).
    case completed

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .toSign: return "To sign"
        case .waiting: return "Waiting"
        case .completed: return "Completed"
        }
    }
}

/// One document as the signed-in account sees it.
public struct DocumentEntry: Identifiable, Equatable, Sendable {
    public let agreement: AgreementRef
    public let document: DocumentInfo
    /// The signatures so far, in the order applied (`get_document_signatures`).
    /// Empty for a completed document read from a listing.
    public let signatures: [DocumentSignature]
    /// The caller's ACCOUNT, from the contract's `whoami` (never a device key).
    public let me: String
    /// Your permission in the agreement, nil when you are not a participant.
    public let myLevel: PermissionLevel?

    public var id: String { "\(agreement.contextId)/\(document.id)" }

    public init(
        agreement: AgreementRef, document: DocumentInfo, signatures: [DocumentSignature], me: String,
        myLevel: PermissionLevel?
    ) {
        self.agreement = agreement
        self.document = document
        self.signatures = signatures
        self.me = me
        self.myLevel = myLevel
    }

    public var isComplete: Bool { document.status == .fullySigned }

    /// Whether you have signed it.
    public var iSigned: Bool { signatures.contains { SignIds.same($0.signer, me) } }

    /// Whether the contract would take your signature: Sign or Admin, and the
    /// document not complete and not already signed by you.
    public var canSign: Bool {
        guard let myLevel, myLevel != .read else { return false }
        return !isComplete && !iSigned
    }

    /// Whether the document was waiting on you when it was uploaded.
    public var iAmRequired: Bool { document.requiredSigners.contains { SignIds.same($0, me) } }

    public var bucket: InboxBucket {
        if isComplete { return .completed }
        return canSign ? .toSign : .waiting
    }

    /// Required signers who have signed, of all required signers.
    public var progress: (signed: Int, required: Int) {
        let required = document.requiredSigners
        let signed = required.filter { r in signatures.contains { SignIds.same($0.signer, r) } }.count
        return (isComplete ? required.count : signed, required.count)
    }
}

/// One agreement's state as the account sees it.
public struct AgreementSnapshot: Equatable, Sendable {
    public let agreement: AgreementRef
    public let details: ContextDetails
    public let me: String
    public let documents: [DocumentEntry]

    public var myLevel: PermissionLevel? {
        details.participants.first { SignIds.same($0.userId, me) }?.permissionLevel
    }

    public var isParticipant: Bool { myLevel != nil }
}

extension AgreementDirectory {
    /// Read one agreement: its details, who you are in it, its documents and,
    /// for each document still open, its signatures.
    public func snapshot(_ agreement: AgreementRef, signaturesForCompleted: Bool = false) async throws
        -> AgreementSnapshot
    {
        let sign = client(agreement.contextId)
        async let detailsCall = sign.getContextDetails(contextIdStr: agreement.contextId)
        async let meCall = sign.whoami()
        async let documentsCall = sign.listDocuments()
        let (details, rawMe, documents) = try await (detailsCall, meCall, documentsCall)
        let me = SignIds.hex(rawMe)
        let level = details.participants.first { SignIds.same($0.userId, me) }?.permissionLevel
        let entries = try await withThrowingTaskGroup(of: (Int, DocumentEntry).self) { group in
            for (index, document) in documents.enumerated() {
                group.addTask {
                    let needs = document.status != .fullySigned || signaturesForCompleted
                    let signatures = needs ? try await sign.getDocumentSignatures(documentId: document.id) : []
                    return (
                        index,
                        DocumentEntry(
                            agreement: agreement, document: document, signatures: signatures, me: me, myLevel: level)
                    )
                }
            }
            var out: [(Int, DocumentEntry)] = []
            for try await item in group { out.append(item) }
            return out.sorted { $0.0 < $1.0 }.map(\.1)
        }
        let name = details.contextName.trimmingCharacters(in: .whitespacesAndNewlines)
        let named =
            name.isEmpty || name == agreement.name
            ? agreement
            : AgreementRef(
                namespaceId: agreement.namespaceId, workspaceName: agreement.workspaceName,
                agreementId: agreement.agreementId, name: name, contextId: agreement.contextId)
        return AgreementSnapshot(
            agreement: named, details: details, me: me,
            documents: entries.map {
                DocumentEntry(
                    agreement: named, document: $0.document, signatures: $0.signatures, me: me, myLevel: level)
            })
    }
}

/// People by the name they set for the workspace (namespace member metadata,
/// shared by every app on it), else a short id. Cached per session.
public actor NameDirectory {
    private let admin: any SignAdmin
    private var names: [String: String?] = [:]

    public init(admin: any SignAdmin) { self.admin = admin }

    public func name(of account: String, in namespaceId: String) async -> String? {
        let key = "\(namespaceId)/\(SignIds.hex(account))"
        if let cached = names[key] { return cached }
        let fetched = try? await admin.memberName(namespaceId: namespaceId, account: account)
        let clean = fetched?.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = (clean?.isEmpty ?? true) ? nil : clean
        names[key] = .some(value)
        return value
    }
}

/// SHA-256 as lowercase hex: the document hash the contract records
/// (`calculateFileHash` / `sha256Hex` on the web).
public enum DocumentHash {
    public static func sha256Hex(_ data: Data) -> String {
        Hex.encode(SHA256.hash(data: data))
    }

    /// The web's integrity check: a warning when the bytes don't match the
    /// recorded hash, nil when they do or when no hash was recorded.
    public static func integrityWarning(bytes: Data, recordedHash: String) -> String? {
        let expected = recordedHash.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !expected.isEmpty else { return nil }
        let actual = sha256Hex(bytes)
        guard actual != expected else { return nil }
        return "The file your relay returned doesn't match the fingerprint recorded for this document "
            + "(recorded \(expected.prefix(12))…, got \(actual.prefix(12))…). Don't rely on what's shown "
            + "without checking with the other parties."
    }
}
