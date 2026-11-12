import Foundation
import MeroKit
import XCTest

@testable import SignCore

/// The client against the contract's component ABI (`logic/res/abi.json`): every
/// method by its camelCase name, sent the right way (view or call), with exactly
/// the ABI's parameters, `none` as an explicit null and a u64 as a decimal string.
final class ContractSurfaceTests: XCTestCase {
    /// `methods` of the ABI, without `init`: name → parameter names.
    static let abi: [String: [String]] = [
        "addParticipant": ["userIdStr", "permission"],
        "createSignature": ["name", "blobIdStr", "dataSize"],
        "deleteDocument": ["documentId"],
        "deleteSignature": ["signatureId"],
        "getContextDetails": ["contextIdStr"],
        "getContextId": [],
        "getDocumentSignatures": ["documentId"],
        "getIdentityMapping": ["contextIdStr"],
        "getSharedIdentity": ["contextIdStr"],
        "getUserPermission": ["userIdStr"],
        "hasConsented": ["userIdStr", "documentId"],
        "isDefaultPrivateContext": [],
        "joinSharedContext": ["contextIdStr", "sharedIdentityStr", "contextName"],
        "leaveSharedContext": ["contextIdStr"],
        "listDocuments": [],
        "listJoinedContexts": [],
        "listParticipants": [],
        "listSignatures": [],
        "markParticipantSigned": ["documentId"],
        "registerSelfAsParticipant": [],
        "removeParticipant": ["userIdStr"],
        "resolvePrivateIdentity": ["sharedIdentityStr"],
        "searchDocumentByEmbedding": ["queryEmbedding", "documentId"],
        "setConsent": ["documentId"],
        "setParticipantPermission": ["userIdStr", "permission"],
        "setup": ["isPrivate", "contextName"],
        "signDocument": ["documentId", "baseHash", "pdfBlobIdStr", "fileSize", "newHash"],
        "uploadDocument": ["name", "hash", "pdfBlobIdStr", "fileSize", "embeddings", "extractedText", "chunks"],
        "whoami": [],
    ]

    static let viewNames: Set<String> = [
        "getContextDetails", "getContextId", "getDocumentSignatures", "getIdentityMapping", "getSharedIdentity",
        "getUserPermission", "hasConsented", "isDefaultPrivateContext", "listDocuments", "listJoinedContexts",
        "listParticipants", "listSignatures", "resolvePrivateIdentity", "searchDocumentByEmbedding", "whoami",
    ]

    /// Records each request and answers with a canned result.
    final class Recorder: MeroKit.ContextContractCalling, @unchecked Sendable {
        var sent: [(method: String, view: Bool, args: [String: Any])] = []

        func query(method: String, argsJSON: Data) async throws -> Data {
            record(method, argsJSON, view: true)
            return Data(Self.answers[method, default: "null"].utf8)
        }

        func execute(method: String, argsJSON: Data) async throws -> Data {
            record(method, argsJSON, view: false)
            return Data(Self.answers[method, default: "null"].utf8)
        }

        private func record(_ method: String, _ args: Data, view: Bool) {
            sent.append((method, view, (try? JSONSerialization.jsonObject(with: args)) as? [String: Any] ?? [:]))
        }

        static let answers: [String: String] = [
            "createSignature": #""7""#,
            "getContextDetails": detailsJSON(),
            "getContextId": quoted(IDs.agreementContext),
            "getDocumentSignatures": "[]",
            "getIdentityMapping":
                #"{"privateIdentity":"a","sharedIdentity":"a","contextId":"c","createdAt":"1"}"#,
            "getSharedIdentity": quoted(IDs.me),
            "getUserPermission": #""Sign""#,
            "hasConsented": "false",
            "isDefaultPrivateContext": "true",
            "listDocuments": "[\(documentJSON(hash: "h"))]",
            "listJoinedContexts": "[]",
            "listParticipants": "[\(quoted(IDs.me))]",
            "listSignatures": "[]",
            "resolvePrivateIdentity": "null",
            "searchDocumentByEmbedding": #""""#,
            "uploadDocument": #""doc_9""#,
            "whoami": quoted(IDs.me),
        ]
    }

    func testEveryMethodIsTheABIsNameWithItsParameters() async throws {
        let r = Recorder()
        let c = SignClient(contract: r)
        try await c.addParticipant(userIdStr: IDs.bob, permission: .sign)
        _ = try await c.createSignature(name: "S", blobIdStr: IDs.blob, dataSize: 3)
        try await c.deleteDocument(documentId: "d")
        try await c.deleteSignature(signatureId: 7)
        _ = try await c.getContextDetails(contextIdStr: "c")
        _ = try await c.getContextId()
        _ = try await c.getDocumentSignatures(documentId: "d")
        _ = try await c.getIdentityMapping(contextIdStr: "c")
        _ = try await c.getSharedIdentity(contextIdStr: "c")
        _ = try await c.getUserPermission(userIdStr: IDs.me)
        _ = try await c.hasConsented(userIdStr: IDs.me, documentId: "d")
        _ = try await c.isDefaultPrivateContext()
        try await c.joinSharedContext(contextIdStr: "c", sharedIdentityStr: IDs.me, contextName: "n")
        try await c.leaveSharedContext(contextIdStr: "c")
        _ = try await c.listDocuments()
        _ = try await c.listJoinedContexts()
        _ = try await c.listParticipants()
        _ = try await c.listSignatures()
        try await c.markParticipantSigned(documentId: "d")
        try await c.registerSelfAsParticipant()
        try await c.removeParticipant(userIdStr: IDs.bob)
        _ = try await c.resolvePrivateIdentity(sharedIdentityStr: IDs.me)
        _ = try await c.searchDocumentByEmbedding(queryEmbedding: [0.5], documentId: "d")
        try await c.setConsent(documentId: "d")
        try await c.setParticipantPermission(userIdStr: IDs.bob, permission: .read)
        try await c.setup(isPrivate: false, contextName: "Lease")
        try await c.signDocument(documentId: "d", baseHash: "a", pdfBlobIdStr: IDs.blob, fileSize: 9, newHash: "b")
        _ = try await c.uploadDocument(name: "n", hash: "h", pdfBlobIdStr: IDs.blob, fileSize: 9)
        _ = try await c.whoami()

        XCTAssertEqual(Set(r.sent.map(\.method)), Set(Self.abi.keys), "every ABI method, and only those")
        XCTAssertEqual(SignClient.views, Self.viewNames)
        XCTAssertEqual(SignClient.calls, Set(Self.abi.keys).subtracting(Self.viewNames))
        for request in r.sent {
            XCTAssertEqual(Set(request.args.keys), Set(Self.abi[request.method] ?? []), request.method)
            XCTAssertEqual(request.view, Self.viewNames.contains(request.method), request.method)
        }
        let sign = try XCTUnwrap(r.sent.first { $0.method == "signDocument" }?.args)
        XCTAssertEqual(sign["fileSize"] as? String, "9", "a u64 goes as a decimal string")
        let upload = try XCTUnwrap(r.sent.first { $0.method == "uploadDocument" }?.args)
        XCTAssertTrue(upload["embeddings"] is NSNull, "a none is an explicit null")
        XCTAssertEqual(r.sent.first { $0.method == "deleteSignature" }?.args["signatureId"] as? String, "7")
        XCTAssertEqual(r.sent.first { $0.method == "addParticipant" }?.args["permission"] as? String, "Sign")
    }

    func testAnswersReadTheComponentWire() async throws {
        let c = SignClient(contract: Recorder())
        let documents = try await c.listDocuments()
        let document = try XCTUnwrap(documents.first)
        XCTAssertEqual(document.size, 1234)
        XCTAssertEqual(document.uploadedAt, 1_788_952_411_519)
        XCTAssertEqual(ContractBytes.text(document.pdfBlobId).hex, IDs.blob)
        XCTAssertEqual(document.requiredSigners.map { ContractBytes.text($0).hex }, [IDs.me, IDs.alice])
        let details = try await c.getContextDetails(contextIdStr: "c")
        XCTAssertEqual(details.participantCount, 2)
        XCTAssertEqual(details.participants.first?.permissionLevel, .sign)
        let created = try await c.createSignature(name: "S", blobIdStr: IDs.blob, dataSize: 3)
        XCTAssertEqual(created, 7)
        let resolved = try await c.resolvePrivateIdentity(sharedIdentityStr: IDs.me)
        XCTAssertNil(resolved)
    }
}
