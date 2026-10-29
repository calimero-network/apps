import CoreGraphics
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import SignCore

@MainActor
final class PrivateStoreTests: XCTestCase {
    func testCreatesTheStoreAsTheWebDoes() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        let admin = FakeSignAdmin()
        let script = Script()
        script.on("is_default_private_context", json: "true")
        script.install(on: backend.recording)
        let store = PrivateStore(backend: backend, admin: admin, applicationId: backend.applicationId)

        let id = try await store.ensure()

        // A namespace named "Personal", marked by metadata, a RESTRICTED
        // "Private" subgroup, and a context initialised private + "default".
        let founded = try XCTUnwrap(backend.namespaces.first)
        XCTAssertEqual(founded.name, "Personal")
        XCTAssertEqual(admin.metadata[founded.id]?.data["kind"], "mero-sign:personal")
        XCTAssertEqual(admin.metadata[founded.id]?.name, "Personal")
        XCTAssertTrue(backend.log.contains { $0.hasPrefix("createSubgroup \(founded.id) Private restricted") })
        XCTAssertEqual(
            backend.initArgs[id], .object(["is_private": .bool(true), "context_name": .string("default")]))
        // Found again without creating a second one.
        let again = try await store.ensure()
        XCTAssertEqual(again, id)
        XCTAssertEqual(backend.log.filter { $0.hasPrefix("foundNamespace") }.count, 1)
    }

    func testFindsAnExistingStoreByItsMarkerAndContract() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        backend.namespaces = [
            AppNamespace(id: IDs.workspace, name: "Personal", applicationId: "app"),  // a workspace named alike
            AppNamespace(id: IDs.personal, name: "Personal", applicationId: "app"),
        ]
        backend.subgroups = [
            IDs.personal: [AppSubgroup(groupId: IDs.privateGroup, name: "Private", contextIds: [IDs.privateContext])]
        ]
        let admin = FakeSignAdmin()
        admin.metadata[IDs.personal] = ("Personal", ["kind": "mero-sign:personal"])
        let script = Script()
        script.on("is_default_private_context", in: IDs.privateContext, json: "true")
        script.install(on: backend.recording)
        let store = PrivateStore(backend: backend, admin: admin, applicationId: nil)

        let found = try await store.find()
        XCTAssertEqual(found, IDs.privateContext)
        XCTAssertFalse(backend.log.contains { $0.hasPrefix("foundNamespace") })
        let personal = await store.isPersonal(IDs.workspace)
        XCTAssertFalse(personal)
    }

    func testLibrarySavesThePNGIntoThePrivateContext() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        let admin = FakeSignAdmin()
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("is_default_private_context", json: "true")
        script.on("create_signature", json: "42")
        script.install(on: backend.recording)
        let store = PrivateStore(backend: backend, admin: admin, applicationId: "app", cache: cache)
        let png = samplePNG()

        let saved = try await store.saveSignature(png: png, name: "Signature 1")

        XCTAssertEqual(saved.id, 42)
        XCTAssertEqual(admin.uploads.first?.contextId, IDs.privateContext)
        let call = try XCTUnwrap(backend.recording.calls("create_signature").first)
        XCTAssertEqual(call.contextId, IDs.privateContext)
        XCTAssertEqual(call.args["name"], .string("Signature 1"))
        XCTAssertEqual(call.args["blob_id_str"], .string(saved.blobId))
        XCTAssertEqual(call.args["data_size"], .number(Double(png.count)))

        script.on(
            "list_signatures",
            json: "[{\"id\":42,\"name\":\"Signature 1\",\"blob_id\":\(bytes(saved.blobId)),\"size\":\(png.count),\"created_at\":5}]")
        let listed = try await store.signatures()
        XCTAssertEqual(listed.first?.png, png)
    }
}

@MainActor
final class SettleTests: XCTestCase {
    func testSettlingRegistersAndRecordsTheIdentityMapping() async throws {
        let backend = seededBackend()
        let admin = FakeSignAdmin()
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("is_default_private_context", json: "true")
        script.on("get_context_details", json: detailsJSON(name: "Lease (final)"))
        script.fail("register_self_as_participant", "Already registered as participant")
        script.install(on: backend.recording)
        let directory = AgreementDirectory(
            backend: backend, store: PrivateStore(backend: backend, admin: admin, applicationId: "app", cache: cache),
            timing: .immediate)

        let name = await directory.settle(contextId: IDs.agreementContext, nameHint: "Lease")

        XCTAssertEqual(name, "Lease (final)")  // the contract's name wins
        let register = try XCTUnwrap(backend.recording.calls("register_self_as_participant").first)
        XCTAssertEqual(register.contextId, IDs.agreementContext)
        // Recorded in the PRIVATE context with the account as the shared identity.
        let join = try XCTUnwrap(backend.recording.calls("join_shared_context").first)
        XCTAssertEqual(join.contextId, IDs.privateContext)
        XCTAssertEqual(join.path, .execute)
        XCTAssertEqual(join.args["context_id_str"], .string(IDs.agreementContext))
        XCTAssertEqual(join.args["shared_identity_str"], .string(IDs.me))
        XCTAssertEqual(join.args["context_name"], .string("Lease (final)"))
    }

    func testWaitsWhileTheAgreementSyncs() async throws {
        let backend = seededBackend()
        let script = Script()
        var asked = 0
        script.on("get_context_details") { _ in
            asked += 1
            if asked < 3 { throw ContractFailure(text: "Uninitialized") }
            return detailsJSON()
        }
        script.install(on: backend.recording)
        let directory = AgreementDirectory(
            backend: backend, store: PrivateStore(backend: backend, admin: FakeSignAdmin(), applicationId: "app"),
            timing: .immediate)
        let name = await directory.waitForState(IDs.agreementContext)
        XCTAssertEqual(name, "Lease")
        XCTAssertEqual(asked, 3)
    }

    func testEnteringJoinsTheOpenSubgroupWhenNotAMember() async throws {
        let backend = seededBackend()
        backend.members = []
        let directory = AgreementDirectory(
            backend: backend, store: PrivateStore(backend: backend, admin: FakeSignAdmin(), applicationId: "app"),
            timing: .immediate)
        try await directory.enter(IDs.agreementContext)
        XCTAssertTrue(backend.members.contains(IDs.agreementContext))
    }
}

@MainActor
final class InboxTests: XCTestCase {
    func testSortsDocumentsIntoBuckets() async throws {
        let backend = seededBackend()
        backend.subgroups[IDs.workspace]?.append(
            AppSubgroup(groupId: IDs.privateGroup, name: "Not yet opened", contextIds: [IDs.privateContext]))
        let script = Script()
        script.on("get_context_details", json: detailsJSON())
        script.on("whoami", json: bytes(IDs.me))
        script.on(
            "list_documents",
            json: "[\(documentJSON(id: "doc_a", hash: "h1")),\(documentJSON(id: "doc_b", hash: "h2", status: "PartiallySigned")),\(documentJSON(id: "doc_c", hash: "h3", status: "FullySigned"))]"
        )
        script.on("get_document_signatures") { call in
            if call.args["document_id"] == .string("doc_b") {
                return "[{\"signer\":\(bytes(IDs.me)),\"signed_at\":7}]"
            }
            return "[]"
        }
        script.install(on: backend.recording)
        let model = InboxModel(
            directory: AgreementDirectory(
                backend: backend, store: PrivateStore(backend: backend, admin: FakeSignAdmin(), applicationId: "app"),
                timing: .immediate))

        await model.load()

        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.entries(in: .toSign).map(\.document.id), ["doc_a"])
        XCTAssertEqual(model.entries(in: .waiting).map(\.document.id), ["doc_b"])
        XCTAssertEqual(model.entries(in: .completed).map(\.document.id), ["doc_c"])
        XCTAssertEqual(model.unopened.map(\.name), ["Not yet opened"])
        let waiting = try XCTUnwrap(model.entries(in: .waiting).first)
        XCTAssertEqual(SignFormat.progress(waiting), "1 of 2 signed")
        XCTAssertEqual(waiting.document.uploadedAt, 1_788_952_411_519_000_000)
        // Completed documents are not asked for their signatures in a listing.
        XCTAssertFalse(backend.recording.calls("get_document_signatures").contains { $0.args["document_id"] == .string("doc_c") })
    }

    func testAViewerOnlyWaits() async throws {
        let backend = seededBackend()
        let script = Script()
        script.on("get_context_details", json: detailsJSON(participants: [(IDs.me, "Read"), (IDs.alice, "Admin")]))
        script.on("whoami", json: "\"\(IDs.me)\"")
        script.on("list_documents", json: "[\(documentJSON(hash: "h", required: [IDs.alice]))]")
        script.on("get_document_signatures", json: "[]")
        script.install(on: backend.recording)
        let model = InboxModel(
            directory: AgreementDirectory(
                backend: backend, store: PrivateStore(backend: backend, admin: FakeSignAdmin(), applicationId: "app"),
                timing: .immediate))
        await model.load()
        XCTAssertEqual(model.count(.toSign), 0)
        XCTAssertEqual(model.count(.waiting), 1)
    }
}

@MainActor
final class SigningTests: XCTestCase {
    private func setUp(consented: Bool) -> (InMemoryAppBackend, FakeSignAdmin, Script, DocumentModel, Data) {
        let backend = seededBackend()
        let admin = FakeSignAdmin()
        let pdf = samplePDF()
        let hash = DocumentHash.sha256Hex(pdf)
        admin.put(pdf, id: IDs.blob, contextId: IDs.agreementContext)
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("is_default_private_context", json: "true")
        script.on("get_context_details", json: detailsJSON())
        script.on("whoami", json: bytes(IDs.me))
        script.on("list_documents", json: "[\(documentJSON(hash: hash))]")
        script.on("get_document_signatures", json: "[]")
        script.on("has_consented", json: consented ? "true" : "false")
        script.on("list_signatures", json: "[]")
        script.on("create_signature", json: "9")
        script.install(on: backend.recording)
        let directory = AgreementDirectory(
            backend: backend, store: PrivateStore(backend: backend, admin: admin, applicationId: "app", cache: cache),
            timing: .immediate)
        let model = DocumentModel(
            directory: directory, names: NameDirectory(admin: admin), agreement: agreementRef, documentId: "doc_1")
        return (backend, admin, script, model, pdf)
    }

    func testConsentThenSignRecordsEverythingTheWebRecords() async throws {
        let (backend, admin, _, model, pdf) = setUp(consented: false)
        admin.names[IDs.alice] = "Alice"
        await model.load()
        XCTAssertEqual(model.signers.map(\.displayName), [SignIds.short(IDs.me), "Alice"])
        XCTAssertTrue(model.signers[0].isMe)
        await model.loadPDF()
        XCTAssertEqual(model.pdf, pdf)
        XCTAssertNil(model.integrityWarning)

        await model.beginSigning()
        XCTAssertEqual(model.step, .consent)
        let consentCheck = try XCTUnwrap(backend.recording.calls("has_consented").first)
        XCTAssertEqual(consentCheck.args["user_id_str"], .string(IDs.me))  // the ACCOUNT, from whoami
        await model.giveConsent()
        XCTAssertEqual(model.step, .choose)
        XCTAssertEqual(backend.recording.calls("set_consent").first?.args, .object(["document_id": .string("doc_1")]))

        let png = samplePNG()
        model.choose(png: png, isNew: true)
        XCTAssertEqual(model.step, .placing)
        await model.submit(
            placement: SignaturePlacement(pageIndex: 0, rect: CGRect(x: 380, y: 680, width: 150, height: 50)),
            saveToLibrary: true)

        XCTAssertNil(model.error)
        XCTAssertEqual(model.step, .done)
        // The signed PDF went into the AGREEMENT's context; the signature PNG into the private one.
        XCTAssertEqual(admin.uploads.map(\.contextId), [IDs.agreementContext, IDs.privateContext])
        let sign = try XCTUnwrap(backend.recording.calls("sign_document").first)
        XCTAssertEqual(sign.path, .execute)
        XCTAssertEqual(sign.args["document_id"], .string("doc_1"))
        XCTAssertEqual(sign.args["base_hash"], .string(DocumentHash.sha256Hex(pdf)))
        let blobId = try XCTUnwrap(sign.args["pdf_blob_id_str"]?.stringValue)
        let signed = try await admin.getBlob(blobId, contextId: IDs.agreementContext)
        XCTAssertEqual(sign.args["new_hash"], .string(DocumentHash.sha256Hex(signed)))
        XCTAssertEqual(sign.args["file_size"], .number(Double(signed.count)))
        XCTAssertNil(sign.args["signer"])  // the contract derives the signer
        XCTAssertEqual(backend.recording.calls("mark_participant_signed").count, 1)
        let saved = try XCTUnwrap(backend.recording.calls("create_signature").first)
        XCTAssertEqual(saved.args["name"], .string("Signature 1"))
    }

    func testAlreadyConsentedGoesStraightToChoosing() async {
        let (backend, _, _, model, _) = setUp(consented: true)
        await model.load()
        await model.beginSigning()
        XCTAssertEqual(model.step, .choose)
        XCTAssertTrue(backend.recording.calls("set_consent").isEmpty)
    }

    func testAStaleVersionIsReloadedNotLost() async throws {
        let (backend, _, script, model, _) = setUp(consented: true)
        script.fail(
            "sign_document",
            "This document changed while you were signing it: you started from a, but it is now at b.")
        await model.load()
        await model.loadPDF()
        await model.beginSigning()
        model.choose(png: samplePNG(), isNew: false)
        await model.submit(placement: SignaturePlacement(pageIndex: 0, rect: CGRect(x: 0, y: 0, width: 90, height: 30)), saveToLibrary: true)
        XCTAssertEqual(model.step, .idle)
        XCTAssertTrue(model.error?.contains("sign again") == true)
        XCTAssertTrue(backend.recording.calls("mark_participant_signed").isEmpty)
        XCTAssertTrue(backend.recording.calls("create_signature").isEmpty)
    }
}

@MainActor
final class InvitationFlowTests: XCTestCase {
    func testJoinsTheWorkspaceEntersTheAgreementAndSettles() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        backend.subgroups = [
            IDs.workspace: [AppSubgroup(groupId: IDs.agreementGroup, name: "Lease", contextIds: [IDs.agreementContext])]
        ]
        let admin = FakeSignAdmin()
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("is_default_private_context", json: "true")
        script.on("get_context_details", json: detailsJSON())
        script.install(on: backend.recording)
        let directory = AgreementDirectory(
            backend: backend, store: PrivateStore(backend: backend, admin: admin, applicationId: "app", cache: cache),
            timing: .immediate)
        let invite = SignInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: IDs.workspace), contextId: IDs.agreementContext,
            contextName: "Lease", workspaceName: "Acme")
        let model = InvitationModel(findAttempts: 2, findDelay: .zero)
        XCTAssertTrue(model.open(try invite.link()))
        XCTAssertEqual(model.stage, .confirm(title: "Lease"))

        var didJoin = false
        await model.accept(directory: { directory }, didJoin: { didJoin = true })

        XCTAssertTrue(didJoin)
        XCTAssertTrue(backend.log.contains("joinNamespace \(IDs.workspace)"))
        XCTAssertTrue(backend.members.contains(IDs.agreementContext))
        XCTAssertEqual(backend.recording.calls("register_self_as_participant").count, 1)
        XCTAssertEqual(backend.recording.calls("join_shared_context").first?.contextId, IDs.privateContext)
        guard case .joined(let destination) = model.stage else { return XCTFail("not joined: \(model.stage)") }
        XCTAssertEqual(destination.agreement?.contextId, IDs.agreementContext)
        XCTAssertEqual(destination.workspaceName, "Acme")
    }
}
