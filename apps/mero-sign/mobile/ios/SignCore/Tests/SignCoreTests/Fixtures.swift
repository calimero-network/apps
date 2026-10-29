import CoreGraphics
import Foundation
import MeroKit
import MeroKitTestSupport
import SignCore

/// Ids that look like the real thing (64 hex).
enum IDs {
    static let me = String(repeating: "ab", count: 32)
    static let alice = String(repeating: "a1", count: 32)
    static let bob = String(repeating: "b0", count: 32)
    static let workspace = String(repeating: "11", count: 32)
    static let personal = String(repeating: "22", count: 32)
    static let agreementGroup = String(repeating: "33", count: 32)
    static let agreementContext = String(repeating: "44", count: 32)
    static let privateGroup = String(repeating: "55", count: 32)
    static let privateContext = String(repeating: "66", count: 32)
    static let blob = String(repeating: "77", count: 32)
}

/// A contract error the way the relay reports one.
struct ContractFailure: Error, LocalizedError {
    let text: String
    var errorDescription: String? { text }
}

/// Scripted contract answers by method, optionally per context, as raw JSON
/// text (so byte arrays and big numbers reach the client untouched).
final class Script: @unchecked Sendable {
    private var answers: [String: (RecordedContractCall) throws -> String] = [:]
    private let lock = NSLock()

    func on(_ method: String, in contextId: String? = nil, _ answer: @escaping (RecordedContractCall) throws -> String) {
        lock.lock()
        answers[key(method, contextId)] = answer
        lock.unlock()
    }

    func on(_ method: String, in contextId: String? = nil, json: String) {
        on(method, in: contextId) { _ in json }
    }

    func fail(_ method: String, in contextId: String? = nil, _ text: String) {
        on(method, in: contextId) { _ in throw ContractFailure(text: text) }
    }

    func install(on recording: RecordingContextContract) {
        recording.setRawHandler { [self] call in
            lock.lock()
            let answer = answers[key(call.method, call.contextId)] ?? answers[key(call.method, nil)]
            lock.unlock()
            guard let answer else { return Data("null".utf8) }
            return Data(try answer(call).utf8)
        }
    }

    private func key(_ method: String, _ contextId: String?) -> String { "\(contextId ?? "*")|\(method)" }
}

/// ``SignAdmin`` in memory: blobs by id, group metadata, member names.
final class FakeSignAdmin: SignAdmin, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var blobs: [String: (data: Data, contextId: String)] = [:]
    var metadata: [String: (name: String?, data: [String: String])] = [:]
    var names: [String: String] = [:]
    private(set) var uploads: [(contextId: String, size: Int)] = []
    private var next = 0

    func uploadBlob(_ data: Data, contextId: String) async throws -> String {
        lock.lock()
        defer { lock.unlock() }
        next += 1
        let id = String(format: "%064x", next + 0xB10B)
        blobs[id] = (data, contextId)
        uploads.append((contextId, data.count))
        return id
    }

    func getBlob(_ blobId: String, contextId: String) async throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        guard let blob = blobs[blobId] else { throw ContractFailure(text: "blob not found") }
        return blob.data
    }

    func put(_ data: Data, id: String, contextId: String) {
        lock.lock()
        blobs[id] = (data, contextId)
        lock.unlock()
    }

    func groupMetadata(_ groupId: String) async throws -> (name: String?, data: [String: String])? {
        lock.lock()
        defer { lock.unlock() }
        return metadata[groupId]
    }

    func setGroupMetadata(_ groupId: String, name: String?, data: [String: String]) async throws {
        lock.lock()
        metadata[groupId] = (name, data)
        lock.unlock()
    }

    func memberName(namespaceId: String, account: String) async throws -> String? {
        names[account]
    }
}

/// A one-page PDF, made with Core Graphics.
func samplePDF(pages: Int = 1, size: CGSize = CGSize(width: 612, height: 792)) -> Data {
    let out = NSMutableData()
    var box = CGRect(origin: .zero, size: size)
    let consumer = CGDataConsumer(data: out as CFMutableData)!
    let context = CGContext(consumer: consumer, mediaBox: &box, nil)!
    for _ in 0..<pages {
        context.beginPDFPage(nil)
        context.setFillColor(CGColor(red: 0.2, green: 0.2, blue: 0.2, alpha: 1))
        context.fill(CGRect(x: 72, y: 700, width: 300, height: 12))
        context.endPDFPage()
    }
    context.closePDF()
    return out as Data
}

/// A drawn signature as a PNG.
func samplePNG() -> Data {
    var ink = SignatureInk()
    ink.begin(.init(x: 10, y: 50, time: 0))
    for i in 1..<30 { ink.add(.init(x: 10 + CGFloat(i) * 8, y: 50 + sin(CGFloat(i)) * 20, time: Double(i) * 0.016)) }
    return ink.renderPNG(size: CGSize(width: 300, height: 100), scale: 2)!
}

/// The JSON `list_documents` answers with, ids as byte arrays like a node.
func documentJSON(
    id: String = "doc_1", name: String = "NDA.pdf", hash: String, status: String = "Pending",
    blob: String = IDs.blob, required: [String] = [IDs.me, IDs.alice], uploadedAt: UInt64 = 1_788_952_411_519_000_000
) -> String {
    """
    {"id":"\(id)","name":"\(name)","hash":"\(hash)","uploaded_by":\(bytes(IDs.alice)),"uploaded_at":\(uploadedAt),\
    "status":"\(status)","pdf_blob_id":\(bytes(blob)),"size":1234,\
    "required_signers":[\(required.map(bytes).joined(separator: ","))],"embeddings":null,"extracted_text":null,"chunks":null}
    """
}

/// An id as the byte array a node may answer with.
func bytes(_ hex: String) -> String {
    let data = try! Hex.decode(hex, label: "id", bytes: 32)
    return "[" + data.map(String.init).joined(separator: ",") + "]"
}

func detailsJSON(participants: [(String, String)] = [(IDs.me, "Sign"), (IDs.alice, "Admin")], name: String = "Lease")
    -> String
{
    let rows = participants.map { "{\"user_id\":\(bytes($0.0)),\"permission_level\":\"\($0.1)\"}" }
    return """
        {"context_id":\(bytes(IDs.agreementContext)),"context_name":"\(name)","owner":\(bytes(IDs.alice)),\
        "is_private":false,"participant_count":\(participants.count),"participants":[\(rows.joined(separator: ","))],\
        "document_count":1,"created_at":1}
        """
}

/// A backend with one workspace holding one agreement the account is in.
func seededBackend() -> InMemoryAppBackend {
    let backend = InMemoryAppBackend(account: IDs.me)
    backend.namespaces = [AppNamespace(id: IDs.workspace, name: "Acme", applicationId: backend.applicationId)]
    backend.subgroups = [
        IDs.workspace: [AppSubgroup(groupId: IDs.agreementGroup, name: "Lease", contextIds: [IDs.agreementContext])]
    ]
    backend.members = [IDs.agreementContext]
    return backend
}

let agreementRef = AgreementRef(
    namespaceId: IDs.workspace, workspaceName: "Acme", agreementId: IDs.agreementGroup, name: "Lease",
    contextId: IDs.agreementContext)
