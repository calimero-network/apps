import CrmCore
import MeroKit
import MeroKitTestSupport
import XCTest

@MainActor
final class ModelTests: XCTestCase {
    private func model(_ script: Script, _ backend: InMemoryAppBackend) -> PipelineModel {
        backend.members = ["ctx"]
        let m = PipelineModel(pipeline: ref, backend: backend)
        m.now = { now }
        m.calendar = utc
        return m
    }

    func testWorkspacesFoundAWorkspaceWithItsFirstPipelineAndCurrency() async throws {
        let backend = backend(Script())
        let store = MemoryStore()
        let model = WorkspacesModel(backend: backend, applicationId: nil, names: LocalNames(store: store))
        let pipelineValue = await model.createWorkspace(name: " Acme Inc ", pipelineName: "Enterprise", currency: "eur")
        let pipeline = try XCTUnwrap(pipelineValue)
        XCTAssertEqual(backend.log.first, "foundNamespace Acme Inc")
        XCTAssertTrue(backend.log.contains { $0.hasPrefix("createContext \(pipeline.namespaceId) \(backend.applicationId) Enterprise") })
        XCTAssertEqual(backend.rootContexts[pipeline.namespaceId], [pipeline.contextId])
        XCTAssertEqual(backend.initArgs[pipeline.contextId], .object([:]))
        let currency = try XCTUnwrap(backend.recording.calls("set_currency").first)
        XCTAssertEqual(currency.path, .execute)
        XCTAssertEqual(currency.contextId, pipeline.contextId)
        XCTAssertEqual(args(currency)["currency"], .string("EUR"))
        XCTAssertEqual(pipeline.name, "Enterprise")

        // A reload names the pipeline from this device's record.
        backend.namespaces = [AppNamespace(id: pipeline.namespaceId, name: "Acme Inc", applicationId: backend.applicationId)]
        await model.load()
        XCTAssertEqual(model.workspaces.map(\.title), ["Acme Inc"])
        XCTAssertEqual(model.workspaces[0].pipelines.map(\.name), ["Enterprise"])

        do { let r = await model.createWorkspace(name: "X", pipelineName: "", currency: "EURO"); XCTAssertNil(r) }
        XCTAssertEqual(model.error, CrmError.invalidCurrency.errorDescription)
    }

    func testUSDPipelinesSkipTheCurrencyWriteAndUnnamedOnesAreNumbered() async throws {
        let backend = backend(Script())
        let model = WorkspacesModel(backend: backend, applicationId: "app", names: LocalNames(store: MemoryStore()))
        backend.namespaces = [AppNamespace(id: "ns1", name: "Team", applicationId: "app")]
        backend.rootContexts = ["ns1": ["c1", "c2"]]
        await model.load()
        XCTAssertEqual(model.workspaces[0].pipelines.map(\.name), ["Pipeline 1", "Pipeline 2"])
        let addedValue = await model.addPipeline(to: model.workspaces[0], name: "", currency: "USD")
        let added = try XCTUnwrap(addedValue)
        XCTAssertEqual(added.name, "Sales")
        XCTAssertTrue(backend.recording.calls("set_currency").isEmpty)
        XCTAssertEqual(model.workspaces[0].pipelines.count, 3)
    }

    func testJoiningRedeemsTheInvitationAndListsTheWorkspace() async throws {
        let backend = backend(Script())
        let store = MemoryStore()
        let model = WorkspacesModel(backend: backend, applicationId: "app", names: LocalNames(store: store))
        let ns = String(repeating: "34", count: 32)
        let invitation = CrmInvitation(invitation: InMemoryAppBackend.invitation(namespaceId: ns), workspaceName: "Globex")
        let joined = await model.join(invitation)
        XCTAssertEqual(joined, ns)
        XCTAssertTrue(backend.log.contains("joinNamespace \(ns)"))
        XCTAssertEqual(model.workspace(ns)?.title, "Globex")

        let link = await model.inviteLink(for: try XCTUnwrap(model.workspace(ns)))
        XCTAssertEqual(CrmInvitation.parse(try XCTUnwrap(link))?.namespaceId, ns)
    }

    func testLoadReadsTheWholePipelineAndJoinsTheContextFirst() async {
        let script = Script()
        script.deals = [deal("d1", stage: "qualified"), deal("d2", status: "won")]
        script.contacts = [contact("c2", name: "Bo"), contact("c1", name: "Ana")]
        script.stages = stages.reversed()
        let backend = backend(script)
        let m = PipelineModel(pipeline: ref, backend: backend)
        await m.load()
        XCTAssertTrue(backend.log.contains("joinContext ctx"))
        XCTAssertTrue(m.hasLoaded)
        XCTAssertEqual(m.stages.map(\.id), stages.map(\.id))
        XCTAssertEqual(m.contacts.map(\.name), ["Ana", "Bo"])
        XCTAssertEqual(m.currency, "EUR")
        XCTAssertEqual(m.openDeals(in: "qualified").map(\.id), ["d1"])
        XCTAssertEqual(m.version, 1)
        XCTAssertEqual(
            Set(backend.recording.calls.map(\.method)),
            ["list_stages", "list_deals", "list_contacts", "list_activities", "list_automations", "get_settings"])
        XCTAssertTrue(backend.recording.calls.allSatisfy { $0.path == .query && $0.contextId == "ctx" })
    }

    func testAContextStillSyncingIsWarmingUpNotAnError() async {
        let script = Script()
        script.failRead = AppError("Context state not initialized, awaiting state sync")
        let m = model(script, backend(script))
        await m.load()
        XCTAssertTrue(m.warmingUp)
        XCTAssertNil(m.error)
        script.failRead = URLError(.notConnectedToInternet)
        await m.load()
        XCTAssertFalse(m.warmingUp)
        XCTAssertNotNil(m.error)
        script.failRead = nil
        await m.load()
        XCTAssertNil(m.error)
        XCTAssertTrue(m.hasLoaded)
    }

    func testCreatingADealSendsTheContractsArgumentsAndCanCreateItsPerson() async throws {
        let script = Script()
        let backend = backend(script)
        let m = model(script, backend)
        await m.load()
        var draft = DealDraft()
        draft.title = "  Acme — 50 seats "
        draft.value = "12.5k"
        draft.organization = "Acme"
        draft.stageId = "qualified"
        draft.owner = m.me
        draft.hasClose = true
        draft.expectedClose = now
        draft.creatingContact = true
        draft.newContactName = "Ana Diaz"
        draft.newContactEmail = "ana@acme.test"
        let id = await m.createDeal(draft)
        XCTAssertEqual(id, "new-create_deal")
        let person = args(try XCTUnwrap(backend.recording.calls("create_contact").first))
        XCTAssertEqual(person["name"], .string("Ana Diaz"))
        XCTAssertEqual(person["organization"], .string("Acme"))
        let call = try XCTUnwrap(backend.recording.calls("create_deal").first)
        let sent = args(call)
        XCTAssertEqual(call.path, .execute)
        XCTAssertEqual(sent["title"], .string("Acme — 50 seats"))
        XCTAssertEqual(sent["value"], .number(12_500))
        XCTAssertEqual(sent["contact_id"], .string("new-create_contact"))
        XCTAssertEqual(sent["stage_id"], .string("qualified"))
        XCTAssertEqual(sent["owner"], .string(m.me))
        XCTAssertEqual(sent["expected_close"], .number(Double(Days.ms(Days.noon(now, utc)))))
        XCTAssertEqual(m.notice?.text, "Deal added")
        // The write is followed by a fresh read.
        XCTAssertEqual(backend.recording.calls("list_deals").count, 2)
    }

    func testMovingClosingAndReopeningDeals() async throws {
        let script = Script()
        let d = deal("d1")
        script.deals = [d]
        let backend = backend(script)
        let m = model(script, backend)
        await m.load()
        do { let r = await m.move(d, to: "meeting"); XCTAssertTrue(r) }
        XCTAssertEqual(args(try XCTUnwrap(backend.recording.calls("move_deal").first))["stage_id"], .string("meeting"))
        XCTAssertEqual(m.notice?.text, "Moved to Meeting")
        do { let r = await m.move(d, to: "lead"); XCTAssertTrue(r) }
        XCTAssertEqual(backend.recording.calls("move_deal").count, 1)
        do { let r = await m.markWon(d); XCTAssertTrue(r) }
        XCTAssertEqual(m.notice?.text, "Won “Acme — 50 seats” — €12,000")
        do { let r = await m.markLost(d, reason: " Price "); XCTAssertTrue(r) }
        XCTAssertEqual(args(try XCTUnwrap(backend.recording.calls("mark_lost").first))["reason"], .string("Price"))
        do { let r = await m.reopen(d); XCTAssertTrue(r) }
        XCTAssertEqual(backend.recording.calls("reopen_deal").count, 1)
    }

    func testSchedulingUsesTheDealsOwnerElseYouAndSuggestionsDueAtTen() async throws {
        let script = Script()
        script.deals = [deal("d1", owner: nil), deal("d2", owner: "bob")]
        let backend = backend(script)
        let m = model(script, backend)
        await m.load()
        let scheduled = await m.schedule(SuggestedActivity(kind: .meeting, subject: "Book a demo", dueInDays: 3), on: m.deal("d1")!)
        XCTAssertTrue(scheduled)
        let first = args(try XCTUnwrap(backend.recording.calls("add_activity").first))
        XCTAssertEqual(first["owner"], .string(m.me))
        XCTAssertEqual(first["deal_id"], .string("d1"))
        XCTAssertEqual(first["contact_id"], .string("c1"))
        XCTAssertEqual(first["kind"], .string("meeting"))
        XCTAssertEqual(first["due_at"], .number(Double(Days.ms(Days.dueIn(3, now: now, utc)))))
        var draft = ActivityDraft(due: now, dealId: "d2")
        draft.subject = "Call"
        do { let r = await m.schedule(draft); XCTAssertTrue(r) }
        XCTAssertEqual(args(backend.recording.calls("add_activity")[1])["owner"], .string("bob"))

        let a = activity("a1", due: ms(daysFromNow: -1))
        do { let r = await m.snooze(a); XCTAssertTrue(r) }
        XCTAssertEqual(
            args(try XCTUnwrap(backend.recording.calls("reschedule_activity").first))["due_at"],
            .number(Double(Days.ms(Days.dueIn(1, now: now, utc)))))
        do { let r = await m.setDone(a, true); XCTAssertTrue(r) }
        XCTAssertEqual(args(try XCTUnwrap(backend.recording.calls("set_activity_done").first))["done"], .bool(true))
    }

    func testAFailedWriteIsReportedNotThrown() async {
        let script = Script()
        let backend = backend(script)
        let m = model(script, backend)
        await m.load()
        backend.recording.setRawHandler { call in
            if call.path == .execute { throw SignedOutError(method: call.method) }
            return try script.answer(call)
        }
        do { let r = await m.deleteDeal(deal("d1")); XCTAssertFalse(r) }
        XCTAssertEqual(m.notice?.isError, true)
        XCTAssertEqual(m.notice?.text, ErrorText.describe(SignedOutError(method: "delete_deal")))
    }

    func testStagesReorderAndSettingsValidate() async throws {
        let script = Script()
        let backend = backend(script)
        let m = model(script, backend)
        await m.load()
        do { let r = await m.moveStage(m.stages[1], by: -1); XCTAssertTrue(r) }
        XCTAssertEqual(
            args(try XCTUnwrap(backend.recording.calls("reorder_stages").first))["stage_ids"],
            .array(["qualified", "lead", "meeting", "proposal", "negotiation"].map(JSONValue.string)))
        do { let r = await m.moveStage(m.stages[0], by: -1); XCTAssertFalse(r) }
        do { let r = await m.setCurrency("dollars"); XCTAssertFalse(r) }
        XCTAssertTrue(backend.recording.calls("set_currency").isEmpty)
        do { let r = await m.setCurrency("gbp"); XCTAssertTrue(r) }
        XCTAssertEqual(args(try XCTUnwrap(backend.recording.calls("set_currency").first))["currency"], .string("GBP"))
        do { let r = await m.setRottingDays(21); XCTAssertTrue(r) }
        XCTAssertEqual(args(try XCTUnwrap(backend.recording.calls("set_rotting_days").first))["days"], .number(21))
    }

    func testOwnersAreLabelledAndOfferedOnce() async {
        let script = Script()
        let backend = backend(script)
        let bob = String(repeating: "cd", count: 32)
        let bobB58 = InviteCodec.base58Encode(Data(repeating: 0xcd, count: 32))
        script.deals = [deal("d1", owner: bob), deal("d2", owner: bobB58), deal("d3", owner: "Carol"), deal("d4", owner: backend.account)]
        let m = model(script, backend)
        await m.load()
        XCTAssertEqual(m.ownerOptions, [m.me, bob, "Carol"])
        XCTAssertEqual(m.ownerLabel(backend.account), "You")
        XCTAssertEqual(m.ownerLabel(bobB58), Account.short(bobB58))
        XCTAssertEqual(m.ownerLabel("Carol"), "Carol")
        XCTAssertEqual(m.ownerLabel(nil), "Unassigned")
        XCTAssertTrue(m.isMe(InviteCodec.base58Encode(Data(repeating: 0xab, count: 32))))
    }

    func testAnEventFromTheContextReReadsThePipeline() async throws {
        let script = Script()
        let backend = backend(script)
        let m = model(script, backend)
        m.coalesce = .milliseconds(10)
        m.pollInterval = .seconds(60)
        let task = Task { await m.run() }
        for _ in 0..<100 where m.version < 1 { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(m.version, 1)
        script.deals = [deal("d9")]
        backend.emit(AppContextEvent(contextId: "ctx", kind: "StateMutation"))
        for _ in 0..<100 where m.version < 2 { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(m.deals.map(\.id), ["d9"])
        task.cancel()
    }
}
