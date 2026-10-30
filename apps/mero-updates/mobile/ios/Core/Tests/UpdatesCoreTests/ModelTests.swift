import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import UpdatesCore

@MainActor
final class CompaniesModelTests: XCTestCase {
    func testFoundsACompanyWithoutAnAudience() async throws {
        let fake = FakeAudience()
        let model = CompaniesModel(backend: fake.backend)
        let company = try await XCTUnwrapAsync(await model.create(name: "  Acme "))
        XCTAssertEqual(fake.backend.log, ["foundNamespace Acme"])
        XCTAssertEqual(company.name, "Acme")
        XCTAssertEqual(model.companies, [company])
        XCTAssertNil(model.hostingNote)
    }

    func testReportsAnUnhostedCompany() async {
        let fake = FakeAudience()
        fake.backend.haEnabled = false
        let model = CompaniesModel(backend: fake.backend)
        _ = await model.create(name: "Acme")
        XCTAssertNotNil(model.hostingNote)
    }

    func testListsCompaniesAndNamesUnnamedOnes() async {
        let fake = FakeAudience()
        fake.backend.namespaces = [
            AppNamespace(id: "ffeedd00", name: nil, applicationId: "app"),
            AppNamespace(id: "ns-2", name: "Acme", applicationId: "app"),
        ]
        let model = CompaniesModel(backend: fake.backend)
        await model.load()
        XCTAssertEqual(model.companies.map(\.title), ["Acme", "Company ffeedd"])
    }

    func testRelaylessAccountHasNoCompaniesAndNoError() async {
        let fake = FakeAudience()
        fake.backend.hasRelay = false
        let model = CompaniesModel(backend: fake.backend)
        await model.load()
        XCTAssertTrue(model.companies.isEmpty)
        XCTAssertTrue(model.hasLoaded)
        XCTAssertNil(model.error)
    }

    func testJoinLandsInTheAudienceTheLinkNames() async throws {
        let fake = FakeAudience()
        let ns = String(repeating: "cd", count: 32)
        let invitation = UpdatesInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: ns), kind: .audience, namespaceId: ns,
            companyName: "Acme", audienceId: "grp", contextId: "ctx-9", audienceName: "Angels")
        let model = CompaniesModel(backend: fake.backend)
        let landing = await model.join(invitation)
        XCTAssertTrue(fake.backend.log.contains("joinNamespace \(ns)"))
        guard case .audience(let audience) = landing else { return XCTFail("expected an audience") }
        XCTAssertEqual(audience.contextId, "ctx-9")
        XCTAssertEqual(audience.title, "Angels")

        let companyOnly = UpdatesInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: ns), kind: .namespace, namespaceId: ns)
        guard case .company(let company) = await model.join(companyOnly) else { return XCTFail("expected a company") }
        XCTAssertEqual(company.id, ns)
    }

    func testFailureIsReported() async {
        let fake = FakeAudience()
        fake.backend.failure = URLError(.notConnectedToInternet)
        let model = CompaniesModel(backend: fake.backend)
        let company = await model.create(name: "X")
        XCTAssertNil(company)
        XCTAssertEqual(model.error?.hasPrefix("The cluster can't be reached"), true)
    }
}

@MainActor
final class CompanyModelTests: XCTestCase {
    func testCreatesAnOpenAudienceWithItsContext() async throws {
        let fake = FakeAudience()
        let founded = try await fake.backend.foundNamespace(name: "Acme")
        let company = CompanySummary(id: founded.namespaceId, name: "Acme")
        let model = CompanyModel(company: company, backend: fake.backend, applicationId: nil)
        let audience = try await XCTUnwrapAsync(await model.create(name: " All investors "))
        XCTAssertTrue(fake.backend.publicSubgroups.contains(audience.audienceId))
        XCTAssertEqual(fake.backend.initArgs[try XCTUnwrap(audience.contextId)], .object([:]))
        XCTAssertTrue(fake.backend.log.contains { $0.hasPrefix("createContext \(audience.audienceId) \(fake.backend.applicationId)") })
        await model.load()
        XCTAssertEqual(model.audiences.map(\.title), ["All investors"])
    }

    func testEnterJoinsTheContextOnlyWhenNeeded() async throws {
        let fake = FakeAudience()
        let company = CompanySummary(id: "ns", name: "Acme")
        fake.backend.subgroups = ["ns": [AppSubgroup(groupId: "g1", name: "Angels", contextIds: ["ctx-a"])]]
        let model = CompanyModel(company: company, backend: fake.backend, applicationId: "app")
        await model.load()
        let audience = try XCTUnwrap(model.audiences.first)
        _ = await model.enter(audience)
        XCTAssertTrue(fake.backend.log.contains("joinContext ctx-a"))
        _ = await model.enter(audience)
        XCTAssertEqual(fake.backend.log.filter { $0 == "joinContext ctx-a" }.count, 1)
    }

    func testAnAudienceWithoutAContextSaysItIsSyncing() async {
        let fake = FakeAudience()
        let model = CompanyModel(company: CompanySummary(id: "ns", name: ""), backend: fake.backend, applicationId: "app")
        let entered = await model.enter(
            AudienceSummary(companyId: "ns", audienceId: "g", contextId: nil, name: "Board", companyName: ""))
        XCTAssertNil(entered)
        XCTAssertEqual(model.error?.contains("syncing"), true)
    }

    func testInvitationsCarryTheLanding() async throws {
        let fake = FakeAudience()
        let ns = String(repeating: "ef", count: 32)
        let model = CompanyModel(company: CompanySummary(id: ns, name: "Acme"), backend: fake.backend, applicationId: "app")
        let whole = try await XCTUnwrapAsync(await model.companyInvitation())
        XCTAssertEqual(whole.kind, .namespace)
        let audience = AudienceSummary(companyId: ns, audienceId: "g", contextId: "c", name: "Angels", companyName: "Acme")
        let one = try await XCTUnwrapAsync(await model.audienceInvitation(audience))
        let parsed = try XCTUnwrap(UpdatesInvitation.parse(try one.link()))
        XCTAssertEqual(parsed.audienceId, "g")
        XCTAssertEqual(parsed.namespaceId, ns)
        XCTAssertEqual(fake.backend.log.filter { $0 == "createInvitation \(ns)" }.count, 2)
    }

    func testJustJoinedEmptyCompanyIsSyncing() async {
        let fake = FakeAudience()
        let model = CompanyModel(company: CompanySummary(id: "ns", name: ""), backend: fake.backend, applicationId: "a", justJoined: true)
        await model.load()
        XCTAssertTrue(model.isSyncing)
    }
}

@MainActor
final class AudienceModelTests: XCTestCase {
    func testLoadsRoleOverviewAndCategories() async {
        let fake = FakeAudience()
        fake.categories = [CategoryView(id: "c1", name: "Monthly", emoji: "📅", color: "#2563eb", updateCount: 1, unreadCount: 0, muted: false)]
        let model = await fake.audienceModel()
        XCTAssertEqual(model.roleLabel, "Admin")
        XCTAssertEqual(model.companyTitle, "Acme")
        XCTAssertEqual(model.category("c1")?.name, "Monthly")
        XCTAssertFalse(model.needsProfile)
        fake.meView = MeView(account: me, name: "", firm: "", isAdmin: false, isTeam: false, muted: [])
        await model.load()
        XCTAssertEqual(model.roleLabel, "Investor")
        XCTAssertTrue(model.needsProfile)
    }

    func testWritesGoThroughExecuteAndBumpTheVersion() async throws {
        let fake = FakeAudience()
        let model = await fake.audienceModel()
        let before = model.version
        try await model.setProfile(name: " Ana ", firm: " Fund ")
        let call = try XCTUnwrap(fake.recording.calls("set_profile").first)
        XCTAssertEqual(call.path, .execute)
        XCTAssertEqual(call.contextId, "ctx-1")
        XCTAssertEqual(call.args["name"]?.stringValue, "Ana")
        XCTAssertEqual(call.args["firm"]?.stringValue, "Fund")
        XCTAssertGreaterThan(model.version, before)
        XCTAssertEqual(fake.recording.calls("get_me").first?.path, .query)
    }

    func testMutingSendsTheWholeMutedSet() async throws {
        let fake = FakeAudience()
        fake.categories = [
            CategoryView(id: "a", name: "A", emoji: "", color: "", updateCount: 0, unreadCount: 0, muted: true),
            CategoryView(id: "b", name: "B", emoji: "", color: "", updateCount: 0, unreadCount: 0, muted: false),
        ]
        let model = await fake.audienceModel()
        try await model.toggleMuted(fake.categories[1])
        XCTAssertEqual(fake.recording.calls("set_muted_categories").last?.args["category_ids"], ["a", "b"])
        try await model.toggleMuted(fake.categories[0])
        XCTAssertEqual(fake.recording.calls("set_muted_categories").last?.args["category_ids"], [])
    }

    func testAskAndOfferWrites() async throws {
        let fake = FakeAudience()
        let model = await fake.audienceModel()
        try await model.offerHelp(askId: "ask", note: "  I know them ")
        try await model.withdrawOffer(askId: "ask")
        try await model.setOfferStatus(askId: "ask", account: ana, status: "accepted")
        try await model.setAskStatus(askId: "ask", resolved: true)
        try await model.setTeammate(ana, on: true)
        try await model.setTeammate(ana, on: false)
        XCTAssertEqual(fake.recording.calls("offer_help").first?.args["note"]?.stringValue, "I know them")
        XCTAssertEqual(fake.recording.calls("set_offer_status").first?.args["status"]?.stringValue, "accepted")
        XCTAssertEqual(fake.recording.calls("set_ask_status").first?.args["status"]?.stringValue, "resolved")
        XCTAssertEqual(fake.recording.calls("withdraw_offer").count, 1)
        XCTAssertEqual(fake.recording.calls("add_teammate").count, 1)
        XCTAssertEqual(fake.recording.calls("remove_teammate").count, 1)
    }

    func testEventsBumpTheVersion() async throws {
        let fake = FakeAudience()
        let model = await fake.audienceModel()
        let follow = Task { await model.follow() }
        defer { follow.cancel() }
        let start = model.version
        // Let the subscription open, then one event; the bump is coalesced (250 ms).
        try await Task.sleep(for: .milliseconds(100))
        fake.backend.emit(AppContextEvent(contextId: "ctx-1", kind: "StateMutation"))
        for _ in 0..<40 where model.version == start { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertGreaterThan(model.version, start)
    }
}

@MainActor
final class FeedModelTests: XCTestCase {
    func testTeamSeesDraftsAndTheChecklist() async {
        let fake = FakeAudience()
        fake.posts = [card("p1", category: "c1"), card("p2")]
        fake.drafts = [DraftView(id: "d1", title: "Draft", payload: "{}", updatedAt: 1)]
        fake.people = [person(me, name: "Me", team: true, admin: true)]
        let audience = await fake.audienceModel()
        let model = FeedModel(audience: audience)
        await model.load()
        XCTAssertEqual(model.posts.map(\.id), ["p1", "p2"])
        XCTAssertEqual(model.drafts.map(\.id), ["d1"])
        XCTAssertEqual(model.setupSteps.map(\.done), [true, false, false, false])
        XCTAssertEqual(fake.recording.calls("list_posts").last?.args["kind"]?.stringValue, "update")
        XCTAssertEqual(fake.recording.calls("list_posts").last?.args["limit"]?.intValue, 100)

        await model.select(category: "c1")
        XCTAssertEqual(fake.recording.calls("list_posts").last?.args["category_id"]?.stringValue, "c1")
        XCTAssertEqual(model.posts.map(\.id), ["p1"])
        await model.select(category: "c1")
        XCTAssertNil(model.category)

        await model.discard(model.drafts[0])
        XCTAssertTrue(model.drafts.isEmpty)
        XCTAssertEqual(fake.recording.calls("delete_draft").first?.args["draft_id"]?.stringValue, "d1")
    }

    func testInvestorsDoNotReadDrafts() async {
        let fake = FakeAudience()
        fake.meView = MeView(account: ana, name: "Ana", firm: "", isAdmin: false, isTeam: false, muted: [])
        let model = FeedModel(audience: await fake.audienceModel())
        await model.load()
        XCTAssertTrue(fake.recording.calls("list_drafts").isEmpty)
    }
}

@MainActor
final class PostModelTests: XCTestCase {
    func testOpeningAnUnreadPostRecordsOneRead() async {
        let fake = FakeAudience()
        fake.postViews["p1"] = postView(card("p1", readByMe: false))
        let model = PostModel(postId: "p1", audience: await fake.audienceModel())
        await model.load()
        await model.load()
        XCTAssertEqual(fake.recording.calls("mark_read").count, 1)
        XCTAssertEqual(fake.recording.calls("mark_read").first?.path, .execute)
    }

    func testReactionsAreOptimistic() async {
        let fake = FakeAudience()
        fake.postViews["p1"] = postView(card("p1", reactions: [ReactionCount(emoji: "🎉", count: 1, mine: false)]))
        let model = PostModel(postId: "p1", audience: await fake.audienceModel())
        await model.load()
        await model.toggle("🎉")
        XCTAssertEqual(model.usedReactions.first?.count, 2)
        XCTAssertTrue(model.mine("🎉"))
        let call = fake.recording.calls("react").first
        XCTAssertEqual(call?.args["emoji"]?.stringValue, "🎉")
        XCTAssertEqual(call?.args["on"], .bool(true))
        await model.toggle("🚀")
        XCTAssertTrue(model.mine("🚀"))
    }

    func testRepliesThreadOneLevelAndPermissions() async throws {
        let fake = FakeAudience()
        fake.meView = MeView(account: ana, name: "Ana", firm: "", isAdmin: false, isTeam: false, muted: [])
        fake.postViews["q1"] = postView(card("q1", kind: "question", author: ana, status: "open"))
        fake.comments = [
            CommentView(id: "c1", postId: "q1", parentId: "", author: me, authorName: "Me", authorIsTeam: true, body: "Hi", createdAt: 1, editedAt: 1),
            CommentView(id: "c2", postId: "q1", parentId: "c1", author: ana, authorName: "Ana", authorIsTeam: false, body: "Yo", createdAt: 2, editedAt: 2),
        ]
        let model = PostModel(postId: "q1", audience: await fake.audienceModel())
        await model.load()
        XCTAssertTrue(model.isQuestion)
        XCTAssertTrue(model.canDelete)
        XCTAssertFalse(model.canEdit)
        XCTAssertEqual(model.topLevel.map(\.id), ["c1"])
        XCTAssertEqual(model.replies(to: "c1").map(\.id), ["c2"])
        XCTAssertFalse(model.canDelete(fake.comments[0]))
        XCTAssertTrue(model.canDelete(fake.comments[1]))
        XCTAssertEqual(model.replyPlaceholder, "Add to the question…")

        try await model.reply(" Thanks ", to: "c1")
        let call = try XCTUnwrap(fake.recording.calls("add_comment").first)
        XCTAssertEqual(call.args["parent_id"]?.stringValue, "c1")
        XCTAssertEqual(call.args["body"]?.stringValue, "Thanks")
        try await model.edit(fake.comments[1], body: "Edited")
        XCTAssertEqual(fake.recording.calls("edit_comment").first?.args["comment_id"]?.stringValue, "c2")
        await model.delete(fake.comments[1])
        XCTAssertEqual(fake.recording.calls("delete_comment").first?.args["comment_id"]?.stringValue, "c2")
    }

    func testTeamAnswersAndDeletes() async {
        let fake = FakeAudience()
        fake.postViews["q1"] = postView(card("q1", kind: "question", author: ana, status: "open"))
        let model = PostModel(postId: "q1", audience: await fake.audienceModel())
        await model.load()
        await model.toggleAnswered()
        XCTAssertEqual(fake.recording.calls("set_question_status").first?.args["status"]?.stringValue, "answered")
        let ok = await model.delete()
        XCTAssertTrue(ok)
        XCTAssertTrue(model.deleted)
        XCTAssertEqual(fake.recording.calls("delete_post").first?.args["post_id"]?.stringValue, "q1")
    }

    func testKpiDeltasComeFromTheSeries() async {
        let fake = FakeAudience()
        fake.postViews["p2"] = postView(card("p2"), metrics: [Metric(name: "MRR", value: "$42k", unit: "")])
        fake.series = [
            MetricSeries(
                name: "MRR", unit: "",
                points: [
                    MetricPoint(postId: "p1", postTitle: "Sep", at: 1, value: "$40k"),
                    MetricPoint(postId: "p2", postTitle: "Oct", at: 2, value: "$42k"),
                ])
        ]
        let model = PostModel(postId: "p2", audience: await fake.audienceModel())
        await model.load()
        XCTAssertEqual(model.previous(Metric(name: "MRR", value: "$42k", unit: ""))?.value, "$40k")
    }
}

@MainActor
final class ComposerModelTests: XCTestCase {
    func testTemplateStartAutosavesADraftAndPublishDeletesIt() async throws {
        let fake = FakeAudience()
        fake.series = [MetricSeries(name: "MRR", unit: "", points: [MetricPoint(postId: "p", postTitle: "", at: 1, value: "1")])]
        let model = ComposerModel(audience: await fake.audienceModel(), start: .template("monthly"))
        model.autosaveDelay = .milliseconds(20)
        await model.load()
        XCTAssertEqual(model.state?.metrics.map(\.name), ["MRR"])
        model.update { $0.title = "Oct"; $0.sections[0].body = "Shipped" }
        for _ in 0..<50 where model.draftId == nil { try await Task.sleep(for: .milliseconds(20)) }
        let save = try XCTUnwrap(fake.recording.calls("save_draft").first)
        XCTAssertEqual(save.path, .execute)
        XCTAssertNil(save.args["draft_id"]?.stringValue)
        XCTAssertEqual(ComposerState.parse(save.args["payload"]?.stringValue ?? "")?.title, "Oct")
        XCTAssertEqual(model.draftId, "draft-1")

        let id = await model.publish()
        XCTAssertEqual(id, "post-new")
        let input = try XCTUnwrap(fake.recording.calls("publish_update").first?.args["input"])
        XCTAssertEqual(input["title"]?.stringValue, "Oct")
        XCTAssertEqual(input["sections"]?.arrayValue?.count, 1)
        XCTAssertEqual(input["metrics"]?.arrayValue?.count, 0)
        XCTAssertEqual(fake.recording.calls("delete_draft").first?.args["draft_id"]?.stringValue, "draft-1")
    }

    func testResumesADraft() async {
        let fake = FakeAudience()
        let state = ComposerState(title: "Half done", sections: [.init(kind: "text", title: "", body: "x")])
        fake.drafts = [DraftView(id: "d9", title: "Half done", payload: state.payload(), updatedAt: 7)]
        let model = ComposerModel(audience: await fake.audienceModel(), start: .draft("d9"))
        await model.load()
        XCTAssertEqual(model.state, state)
        XCTAssertEqual(model.savedAt, 7)
        XCTAssertEqual(model.draftId, "d9")
    }

    func testEditingAPublishedUpdateNeverSavesADraft() async throws {
        let fake = FakeAudience()
        fake.postViews["p1"] = postView(
            card("p1", title: "Sept"), asks: [],
            sections: [Section(kind: "highlights", title: "Highlights", body: "Good")])
        let model = ComposerModel(audience: await fake.audienceModel(), start: .edit("p1"))
        model.autosaveDelay = .milliseconds(5)
        await model.load()
        XCTAssertEqual(model.state?.title, "Sept")
        model.update { $0.title = "September" }
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(fake.recording.calls("save_draft").isEmpty)
        XCTAssertNil(model.draftStatus())
        let id = await model.publish()
        XCTAssertEqual(id, "p1")
        XCTAssertEqual(fake.recording.calls("edit_update").first?.args["post_id"]?.stringValue, "p1")
    }

    func testReuseLatestAndThanks() async {
        let fake = FakeAudience()
        fake.posts = [card("p1")]
        fake.postViews["p1"] = postView(card("p1"), metrics: [Metric(name: "MRR", value: "1", unit: "")], sections: [Section(kind: "product", title: "Product", body: "x")])
        fake.contributions = [ContributionView(askId: "a", askTitle: "Intro", askKind: "intro", account: ana, name: "Ana", firm: "", note: "", acceptedAt: 1)]
        let model = ComposerModel(audience: await fake.audienceModel(), start: .reuseLatest)
        await model.load()
        XCTAssertEqual(model.state?.sections.map(\.body), [""])
        XCTAssertEqual(model.state?.metrics.map(\.value), [""])
        XCTAssertNotNil(model.thanks)
        model.insertThanks()
        XCTAssertTrue(model.hasThanks)
        model.insertThanks()
        XCTAssertEqual(model.state?.sections.filter { $0.kind == "thanks" }.count, 1)
        XCTAssertFalse(model.sectionSuggestions.contains { $0.kind == "product" })
    }

    func testAsksAreCappedAtTen() async {
        let fake = FakeAudience()
        let model = ComposerModel(audience: await fake.audienceModel(), start: .template("blank"))
        await model.load()
        for _ in 0..<12 { model.addAsk() }
        XCTAssertEqual(model.state?.asks.count, 10)
        XCTAssertFalse(model.canAddAsk)
    }
}

@MainActor
final class TabModelTests: XCTestCase {
    func testAsksByStatus() async {
        let fake = FakeAudience()
        fake.asks = [
            AskView(id: "a1", postId: "p", postTitle: "Oct", kind: "intro", title: "Intro", detail: "", status: "open", createdAt: 1, offerCount: 0, offers: [], myOffer: nil),
            AskView(id: "a2", postId: "p", postTitle: "Oct", kind: "hire", title: "CTO", detail: "", status: "resolved", createdAt: 1, offerCount: 0, offers: [], myOffer: nil),
        ]
        let model = AsksModel(audience: await fake.audienceModel())
        await model.load()
        XCTAssertEqual(model.asks.map(\.id), ["a1"])
        await model.show(status: "resolved")
        XCTAssertEqual(model.asks.map(\.id), ["a2"])
        XCTAssertEqual(fake.recording.calls("list_contributions").last?.args["since"]?.intValue, 0)
    }

    func testQuestionsAskAndFilter() async {
        let fake = FakeAudience()
        fake.questions = [card("q1", kind: "question", status: "open"), card("q2", kind: "question", status: "answered")]
        let model = QuestionsModel(audience: await fake.audienceModel())
        await model.load()
        model.openOnly = true
        XCTAssertEqual(model.shown.map(\.id), ["q1"])
        let id = await model.ask(title: " Runway? ", body: " after hires ")
        XCTAssertEqual(id, "q-new")
        let call = fake.recording.calls("ask_question").first
        XCTAssertEqual(call?.args["title"]?.stringValue, "Runway?")
        XCTAssertNil(call?.args["category_id"]?.stringValue)
        let none = await model.ask(title: "  ", body: "")
        XCTAssertNil(none)
    }

    func testPeopleSplitsTeamAndInvestors() async {
        let fake = FakeAudience()
        fake.people = [person(me, name: "Me", team: true, admin: true), person(ana, name: "Ana")]
        let model = PeopleModel(audience: await fake.audienceModel())
        await model.load()
        XCTAssertEqual(model.team.map(\.account), [me])
        XCTAssertEqual(model.investors.map(\.account), [ana])
        XCTAssertEqual(fake.recording.calls("get_engagement").count, 1)
        await model.toggleTeam(model.investors[0])
        XCTAssertEqual(fake.recording.calls("add_teammate").first?.args["account"]?.stringValue, ana)
        XCTAssertEqual(
            PeopleModel.engagementLine(fake.people[1], now: fixedNow),
            "Read 1/2 (50%) · last read Jan 1, 1970 · 0 replies · 0 offers")
    }

    func testSettingsSeedSaveAndStarters() async {
        let fake = FakeAudience()
        fake.categories = [CategoryView(id: "c", name: "Product", emoji: "", color: "", updateCount: 0, unreadCount: 0, muted: false)]
        let model = SettingsModel(audience: await fake.audienceModel())
        await model.load()
        XCTAssertEqual(model.companyName, "Acme")
        XCTAssertEqual(model.cadenceDays, 14)
        model.companyName = " Acme Inc "
        let saved = await model.save()
        XCTAssertTrue(saved)
        XCTAssertEqual(fake.recording.calls("set_settings").first?.args["company_name"]?.stringValue, "Acme Inc")
        XCTAssertEqual(fake.recording.calls("set_settings").first?.args["cadence_days"]?.intValue, 14)
        _ = await model.addStarters()
        XCTAssertEqual(fake.recording.calls("create_category").count, 4)
        _ = await model.archiveCategory("c")
        XCTAssertEqual(fake.recording.calls("archive_category").first?.args["category_id"]?.stringValue, "c")
    }

    func testNeverSavedSettingsOfferMonthly() async {
        let fake = FakeAudience()
        fake.settings = Settings(companyName: "", cadenceDays: 0, updatedAt: 0)
        let model = SettingsModel(audience: await fake.audienceModel())
        await model.load()
        XCTAssertEqual(model.cadenceDays, 30)
    }
}

func XCTUnwrapAsync<T>(_ value: @autoclosure () async throws -> T?, file: StaticString = #filePath, line: UInt = #line)
    async throws -> T
{
    let v = try await value()
    return try XCTUnwrap(v, file: file, line: line)
}
