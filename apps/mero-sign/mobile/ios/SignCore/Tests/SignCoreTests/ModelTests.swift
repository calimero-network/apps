import CoreGraphics
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import SignCore

@MainActor
final class PrivateStoreTests: XCTestCase {
    func testCreatesTheLibraryAsTheWebDoes() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        let admin = FakeSignAdmin()
        let script = Script()
        var setUp = false
        script.on("isDefaultPrivateContext") { _ in setUp ? "true" : "false" }
        script.on("setup") { _ in
            setUp = true
            return "null"
        }
        script.install(on: backend.recording)
        let store = PrivateStore(backend: backend, admin: admin)

        let id = try await store.ensure()

        // An instance named "mero-sign:library" in no organization, set up private + "default".
        XCTAssertEqual(admin.created.map(\.name), ["mero-sign:library"])
        XCTAssertNil(admin.created.first?.org ?? nil)
        let setup = try XCTUnwrap(backend.recording.calls("setup").first)
        XCTAssertEqual(setup.contextId, id)
        XCTAssertEqual(setup.args, .object(["isPrivate": .bool(true), "contextName": .string("default")]))
        // Found again without creating a second one.
        let again = try await store.ensure()
        XCTAssertEqual(again, id)
        XCTAssertEqual(admin.created.count, 1)
    }

    func testFindsTheAccountsOwnLibraryOnly() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        let admin = FakeSignAdmin()
        admin.instanceList = [
            SignInstance(appId: IDs.agreementContext, name: "mero-sign:library", owner: IDs.me, org: IDs.workspace),
            SignInstance(appId: IDs.personal, name: "mero-sign:library", owner: IDs.alice, org: nil),
            SignInstance(appId: IDs.privateContext, name: "mero-sign:library", owner: IDs.me, org: nil),
        ]
        let script = Script()
        script.on("isDefaultPrivateContext", json: "true")
        script.install(on: backend.recording)
        let store = PrivateStore(backend: backend, admin: admin)

        let found = try await store.find()
        XCTAssertEqual(found, IDs.privateContext)
        XCTAssertTrue(admin.created.isEmpty)
    }

    func testAnInstanceWhoseSetupNeverRanIsSetUp() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        let admin = FakeSignAdmin()
        admin.instanceList = [SignInstance(appId: IDs.privateContext, name: "mero-sign:library", owner: IDs.me, org: nil)]
        let script = Script()
        script.on("isDefaultPrivateContext", json: "false")
        script.install(on: backend.recording)
        let id = try await PrivateStore(backend: backend, admin: admin).ensure()
        XCTAssertEqual(id, IDs.privateContext)
        XCTAssertTrue(admin.created.isEmpty)
        XCTAssertEqual(backend.recording.calls("setup").first?.contextId, IDs.privateContext)
    }

    func testLibrarySavesThePNGIntoThePrivateLibrary() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        let admin = FakeSignAdmin()
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("isDefaultPrivateContext", json: "true")
        script.on("createSignature", json: "\"42\"")
        script.install(on: backend.recording)
        let store = PrivateStore(backend: backend, admin: admin, cache: cache)
        let png = samplePNG()

        let saved = try await store.saveSignature(png: png, name: "Signature 1")

        XCTAssertEqual(saved.id, 42)
        XCTAssertEqual(admin.uploads.first?.contextId, IDs.privateContext)
        XCTAssertEqual(admin.uploads.first?.contentType, "image/png")
        let call = try XCTUnwrap(backend.recording.calls("createSignature").first)
        XCTAssertEqual(call.contextId, IDs.privateContext)
        XCTAssertEqual(call.args["name"], .string("Signature 1"))
        XCTAssertEqual(call.args["blobIdStr"], .string(saved.blobId))
        XCTAssertEqual(call.args["dataSize"], .string(String(png.count)), "a u64 goes as a decimal string")

        script.on(
            "listSignatures",
            json: "[{\"id\":\"42\",\"name\":\"Signature 1\",\"blobId\":\"\(saved.blobId)\",\"size\":\"\(png.count)\",\"createdAt\":\"5\"}]")
        let listed = try await store.signatures()
        XCTAssertEqual(listed.first?.png, png)
        XCTAssertEqual(listed.first?.createdAt, 5)
    }
}

@MainActor
final class SettleTests: XCTestCase {
    func testSettlingRegistersAndRecordsTheIdentityMapping() async throws {
        let backend = seededBackend()
        let admin = seededAdmin()
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("isDefaultPrivateContext", json: "true")
        script.on("getContextDetails", json: detailsJSON(name: "Lease (final)"))
        script.on("listParticipants", json: "[\(quoted(IDs.alice))]")
        script.on("registerSelfAsParticipant") { _ in throw appError("Conflict", "already registered") }
        script.install(on: backend.recording)
        let directory = AgreementDirectory(
            backend: backend, admin: admin, store: PrivateStore(backend: backend, admin: admin, cache: cache),
            timing: .immediate)

        let name = await directory.settle(contextId: IDs.agreementContext, nameHint: "Lease")

        XCTAssertEqual(name, "Lease (final)")  // the contract's name wins
        let register = try XCTUnwrap(backend.recording.calls("registerSelfAsParticipant").first)
        XCTAssertEqual(register.contextId, IDs.agreementContext)
        XCTAssertEqual(backend.recording.calls("registerSelfAsParticipant").count, 1, "a Conflict is not retried")
        // Recorded in the PRIVATE library with the account as the shared identity.
        let join = try XCTUnwrap(backend.recording.calls("joinSharedContext").first)
        XCTAssertEqual(join.contextId, IDs.privateContext)
        XCTAssertEqual(join.path, .execute)
        XCTAssertEqual(join.args["contextIdStr"], .string(IDs.agreementContext))
        XCTAssertEqual(join.args["sharedIdentityStr"], .string(IDs.me))
        XCTAssertEqual(join.args["contextName"], .string("Lease (final)"))
    }

    func testOnTheRosterAlreadyDoesNotRegisterAgain() async throws {
        let backend = seededBackend()
        let script = Script()
        script.on("listParticipants", json: "[\(quoted(IDs.me))]")
        script.install(on: backend.recording)
        let admin = seededAdmin()
        let directory = AgreementDirectory(
            backend: backend, admin: admin, store: PrivateStore(backend: backend, admin: admin), timing: .immediate)
        await directory.registerSelf(IDs.agreementContext)
        XCTAssertTrue(backend.recording.calls("registerSelfAsParticipant").isEmpty)
        let joined = await directory.isJoined(IDs.agreementContext)
        XCTAssertTrue(joined)
    }

    func testAgreementsAreTheWorkspacesInstances() async throws {
        let backend = seededBackend()
        let admin = seededAdmin()
        admin.instanceList.append(SignInstance(appId: IDs.privateContext, name: "mero-sign:library", owner: IDs.me, org: nil))
        let directory = AgreementDirectory(
            backend: backend, admin: admin, store: PrivateStore(backend: backend, admin: admin), timing: .immediate)
        let all = try await directory.allAgreements()
        XCTAssertEqual(all, [agreementRef])
    }

    func testEnteringNeedsTheAgreementToBeReachable() async throws {
        let backend = seededBackend()
        backend.members = []
        let admin = seededAdmin()
        let directory = AgreementDirectory(
            backend: backend, admin: admin, store: PrivateStore(backend: backend, admin: admin), timing: .immediate)
        do {
            try await directory.enter(IDs.agreementContext)
            XCTFail("an agreement the account can't reach")
        } catch {}
        backend.members = [IDs.agreementContext]
        try await directory.enter(IDs.agreementContext)
    }
}

@MainActor
final class InboxTests: XCTestCase {
    func testSortsDocumentsIntoBuckets() async throws {
        let backend = seededBackend()
        let admin = seededAdmin()
        admin.instanceList.append(
            SignInstance(appId: IDs.privateContext, name: "Not yet opened", owner: IDs.alice, org: IDs.workspace))
        let script = Script()
        script.on("listParticipants", in: IDs.agreementContext, json: "[\(quoted(IDs.me))]")
        script.on("listParticipants", in: IDs.privateContext, json: "[\(quoted(IDs.alice))]")
        script.on("getContextDetails", json: detailsJSON())
        script.on("whoami", json: quoted(IDs.me))
        script.on(
            "listDocuments",
            json: "[\(documentJSON(id: "doc_a", hash: "h1")),\(documentJSON(id: "doc_b", hash: "h2", status: "PartiallySigned")),\(documentJSON(id: "doc_c", hash: "h3", status: "FullySigned"))]"
        )
        script.on("getDocumentSignatures") { call in
            if call.args["documentId"] == .string("doc_b") {
                return "[{\"signer\":\(quoted(IDs.me)),\"signedAt\":\"7\"}]"
            }
            return "[]"
        }
        script.install(on: backend.recording)
        let model = InboxModel(
            directory: AgreementDirectory(
                backend: backend, admin: admin, store: PrivateStore(backend: backend, admin: FakeSignAdmin()),
                timing: .immediate))

        await model.load()

        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.entries(in: .toSign).map(\.document.id), ["doc_a"])
        XCTAssertEqual(model.entries(in: .waiting).map(\.document.id), ["doc_b"])
        XCTAssertEqual(model.entries(in: .completed).map(\.document.id), ["doc_c"])
        XCTAssertEqual(model.unopened.map(\.name), ["Not yet opened"])
        let waiting = try XCTUnwrap(model.entries(in: .waiting).first)
        XCTAssertEqual(SignFormat.progress(waiting), "1 of 2 signed")
        XCTAssertEqual(waiting.document.uploadedAt, 1_788_952_411_519)
        // Completed documents are not asked for their signatures in a listing.
        XCTAssertFalse(backend.recording.calls("getDocumentSignatures").contains { $0.args["documentId"] == .string("doc_c") })
    }

    func testAViewerOnlyWaits() async throws {
        let backend = seededBackend()
        let script = Script()
        script.on("getContextDetails", json: detailsJSON(participants: [(IDs.me, "Read"), (IDs.alice, "Admin")]))
        script.on("whoami", json: "\"\(IDs.me)\"")
        script.on("listParticipants", json: "[\(quoted(IDs.me))]")
        script.on("listDocuments", json: "[\(documentJSON(hash: "h", required: [IDs.alice]))]")
        script.on("getDocumentSignatures", json: "[]")
        script.install(on: backend.recording)
        let model = InboxModel(
            directory: AgreementDirectory(
                backend: backend, admin: seededAdmin(), store: PrivateStore(backend: backend, admin: FakeSignAdmin()),
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
        let admin = seededAdmin()
        let pdf = samplePDF()
        let hash = DocumentHash.sha256Hex(pdf)
        admin.put(pdf, id: IDs.blob, contextId: IDs.agreementContext)
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("isDefaultPrivateContext", json: "true")
        script.on("getContextDetails", json: detailsJSON())
        script.on("whoami", json: quoted(IDs.me))
        script.on("listDocuments", json: "[\(documentJSON(hash: hash))]")
        script.on("getDocumentSignatures", json: "[]")
        script.on("hasConsented", json: consented ? "true" : "false")
        script.on("listSignatures", json: "[]")
        script.on("createSignature", json: "\"9\"")
        script.on("listParticipants", json: "[\(quoted(IDs.me))]")
        script.install(on: backend.recording)
        let directory = AgreementDirectory(
            backend: backend, admin: admin, store: PrivateStore(backend: backend, admin: admin, cache: cache),
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
        let consentCheck = try XCTUnwrap(backend.recording.calls("hasConsented").first)
        XCTAssertEqual(consentCheck.args["userIdStr"], .string(IDs.me))  // the ACCOUNT, from whoami
        await model.giveConsent()
        XCTAssertEqual(model.step, .choose)
        XCTAssertEqual(backend.recording.calls("setConsent").first?.args, .object(["documentId": .string("doc_1")]))

        let png = samplePNG()
        model.choose(png: png, isNew: true)
        XCTAssertEqual(model.step, .placing)
        await model.submit(
            placement: SignaturePlacement(pageIndex: 0, rect: CGRect(x: 380, y: 680, width: 150, height: 50)),
            saveToLibrary: true)

        XCTAssertNil(model.error)
        XCTAssertEqual(model.step, .done)
        // The signed PDF went into the AGREEMENT's instance; the signature PNG into the library.
        XCTAssertEqual(admin.uploads.map(\.contextId), [IDs.agreementContext, IDs.privateContext])
        let sign = try XCTUnwrap(backend.recording.calls("signDocument").first)
        XCTAssertEqual(sign.path, .execute)
        XCTAssertEqual(sign.args["documentId"], .string("doc_1"))
        XCTAssertEqual(sign.args["baseHash"], .string(DocumentHash.sha256Hex(pdf)))
        let blobId = try XCTUnwrap(sign.args["pdfBlobIdStr"]?.stringValue)
        let signed = try await admin.getBlob(blobId, contextId: IDs.agreementContext)
        XCTAssertEqual(sign.args["newHash"], .string(DocumentHash.sha256Hex(signed)))
        XCTAssertEqual(sign.args["fileSize"], .string(String(signed.count)))
        XCTAssertEqual(admin.uploads.map(\.contentType), ["application/pdf", "image/png"])
        XCTAssertNil(sign.args["signer"])  // the contract derives the signer
        XCTAssertEqual(backend.recording.calls("markParticipantSigned").count, 1)
        let saved = try XCTUnwrap(backend.recording.calls("createSignature").first)
        XCTAssertEqual(saved.args["name"], .string("Signature 1"))
    }

    func testAlreadyConsentedGoesStraightToChoosing() async {
        let (backend, _, _, model, _) = setUp(consented: true)
        await model.load()
        await model.beginSigning()
        XCTAssertEqual(model.step, .choose)
        XCTAssertTrue(backend.recording.calls("setConsent").isEmpty)
    }

    func testAStaleVersionIsReloadedNotLost() async throws {
        let (backend, _, script, model, _) = setUp(consented: true)
        script.on("signDocument") { _ in
            throw appError("Conflict", "this document changed while you were signing it")
        }
        await model.load()
        await model.loadPDF()
        await model.beginSigning()
        model.choose(png: samplePNG(), isNew: false)
        await model.submit(placement: SignaturePlacement(pageIndex: 0, rect: CGRect(x: 0, y: 0, width: 90, height: 30)), saveToLibrary: true)
        XCTAssertEqual(model.step, .idle)
        XCTAssertTrue(model.error?.contains("sign again") == true)
        XCTAssertTrue(backend.recording.calls("markParticipantSigned").isEmpty)
        XCTAssertTrue(backend.recording.calls("createSignature").isEmpty)
    }
}

@MainActor
final class InvitationFlowTests: XCTestCase {
    func testJoinsTheWorkspaceEntersTheAgreementAndSettles() async throws {
        let backend = InMemoryAppBackend(account: IDs.me)
        backend.members = [IDs.agreementContext]
        let admin = seededAdmin()
        let cache = MemoryPrivateContextCache()
        cache.save(IDs.privateContext, account: IDs.me)
        let script = Script()
        script.on("isDefaultPrivateContext", json: "true")
        script.on("getContextDetails", json: detailsJSON())
        script.on("listParticipants", json: "[\(quoted(IDs.alice))]")
        script.install(on: backend.recording)
        let directory = AgreementDirectory(
            backend: backend, admin: admin, store: PrivateStore(backend: backend, admin: admin, cache: cache),
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
        XCTAssertEqual(backend.recording.calls("registerSelfAsParticipant").count, 1)
        XCTAssertEqual(backend.recording.calls("joinSharedContext").first?.contextId, IDs.privateContext)
        guard case .joined(let destination) = model.stage else { return XCTFail("not joined: \(model.stage)") }
        XCTAssertEqual(destination.agreement?.contextId, IDs.agreementContext)
        XCTAssertEqual(destination.workspaceName, "Acme")
    }

    func testReadsTheWebAppsInviteLink() throws {
        let parsed = try XCTUnwrap(
            SignInvitation.parse("https://sign.example.com/?invite=inv_abc123&agreement=\(IDs.agreementContext)"))
        XCTAssertEqual(parsed.invitation.token, "inv_abc123")
        XCTAssertEqual(parsed.contextId, IDs.agreementContext)
        XCTAssertEqual(parsed.namespaceId, "", "the node answers the workspace when it is redeemed")
        XCTAssertEqual(SignInvitation.parse("inv_abc123")?.invitation.token, "inv_abc123")
    }
}
