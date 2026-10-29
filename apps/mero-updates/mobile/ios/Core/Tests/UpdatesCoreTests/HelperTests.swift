import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import UpdatesCore

final class FormatTests: XCTestCase {
    func testTimeAgo() {
        XCTAssertEqual(Format.timeAgo(0, now: fixedNow), "never")
        XCTAssertEqual(Format.timeAgo(nowMs - 10_000, now: fixedNow), "just now")
        XCTAssertEqual(Format.timeAgo(nowMs - 5 * 60_000, now: fixedNow), "5m ago")
        XCTAssertEqual(Format.timeAgo(nowMs - 3 * 3_600_000, now: fixedNow), "3h ago")
        XCTAssertEqual(Format.timeAgo(nowMs - 12 * 86_400_000, now: fixedNow), "12d ago")
        XCTAssertEqual(Format.timeAgo(nowMs - 40 * 86_400_000, now: fixedNow, calendar: utc), "Sep 18, 2026")
    }

    func testDueLabel() {
        XCTAssertEqual(Format.dueLabel(nowMs, now: fixedNow), "Due today")
        XCTAssertEqual(Format.dueLabel(nowMs + 86_400_000, now: fixedNow), "Due in 1 day")
        XCTAssertEqual(Format.dueLabel(nowMs + 3 * 86_400_000, now: fixedNow), "Due in 3 days")
        XCTAssertEqual(Format.dueLabel(nowMs - 2 * 86_400_000, now: fixedNow), "2 days overdue")
        XCTAssertTrue(Format.isOverdue(nowMs - 1, now: fixedNow))
    }

    func testMonthTitle() {
        XCTAssertEqual(Format.monthTitle(now: fixedNow, calendar: utc), "October 2026 update")
    }

    func testPeopleLabels() {
        XCTAssertEqual(People.label("  Ana ", ana), "Ana")
        XCTAssertEqual(People.label("", ana), "b2b2b2…b2b2")
        XCTAssertEqual(People.initials("Ana Lopez", ana), "AL")
        XCTAssertEqual(People.avatarHue(ana), 101)  // FNV-1a, the same on Android
    }

    func testMetricParsingAndDeltas() {
        XCTAssertEqual(Metrics.parse("$1.2M"), 1_200_000)
        XCTAssertEqual(Metrics.parse("42k"), 42_000)
        XCTAssertEqual(Metrics.parse("1,500"), 1500)
        XCTAssertEqual(Metrics.parse("38%"), 38)
        XCTAssertNil(Metrics.parse("n/a"))
        XCTAssertEqual(Metrics.delta("$40k", "$42k"), "+5%")
        XCTAssertEqual(Metrics.delta("100", "88"), "−12%")
        XCTAssertEqual(Metrics.delta("10", "10"), "±0%")
        XCTAssertEqual(Metrics.delta("1000", "1045"), "+4.5%")
        XCTAssertNil(Metrics.delta("0", "5"))
        XCTAssertEqual(Metrics.direction("+5%"), .up)
        XCTAssertEqual(Metrics.direction("−5%"), .down)
        XCTAssertEqual(Metrics.direction("±0%"), .flat)
    }

    func testPreviousAndLastMetric() {
        let series = [
            MetricSeries(
                name: "MRR", unit: "",
                points: [
                    MetricPoint(postId: "p1", postTitle: "Sep", at: 1, value: "$40k"),
                    MetricPoint(postId: "p2", postTitle: "Oct", at: 2, value: "$42k"),
                ])
        ]
        XCTAssertEqual(Metrics.previous(of: "mrr", before: "p2", in: series)?.value, "$40k")
        XCTAssertNil(Metrics.previous(of: "MRR", before: "p1", in: series))
        XCTAssertEqual(Metrics.last(of: " mrr ", in: series), "$42k")
        XCTAssertEqual(MetricsModel.latestDelta(series[0]), "+5%")
    }

    func testAskKindsAndCatalog() {
        XCTAssertEqual(AskKind.of("hire").label, "Hiring")
        XCTAssertEqual(AskKind.of("nope").id, "other")
        XCTAssertEqual(Catalog.rgb("#2563eb"), 0x2563EB)
        XCTAssertNil(Catalog.rgb("blue"))
        XCTAssertEqual(Catalog.cadences.map(\.days), [0, 7, 14, 30, 91])
    }
}

final class ComposerTests: XCTestCase {
    let series = [MetricSeries(name: "MRR", unit: "$", points: [MetricPoint(postId: "p", postTitle: "", at: 1, value: "1")])]

    func testMonthlyTemplateCarriesKpisAndSuggestsAnAsk() {
        let state = Composer.fromTemplate(.of("monthly"), metrics: series, now: fixedNow, calendar: utc)
        XCTAssertEqual(state.title, "October 2026 update")
        XCTAssertEqual(state.sections.map(\.title), ["Highlights", "Lowlights", "Product", "Team"])
        XCTAssertEqual(state.metrics, [.init(name: "MRR", value: "", unit: "$")])
        XCTAssertEqual(state.asks.count, 1)
        let blank = Composer.fromTemplate(.of("blank"), metrics: series)
        XCTAssertEqual(blank.title, "")
        XCTAssertTrue(blank.metrics.isEmpty)
        XCTAssertTrue(blank.asks.isEmpty)
    }

    func testReuseKeepsShapeNotWords() {
        let post = postView(
            card("p1", category: "cat"), metrics: [Metric(name: "MRR", value: "$42k", unit: "")],
            sections: [Section(kind: "highlights", title: "Highlights", body: "Shipped")])
        let state = Composer.fromPrevious(post, now: fixedNow, calendar: utc)
        XCTAssertEqual(state.categoryId, "cat")
        XCTAssertEqual(state.sections, [.init(kind: "highlights", title: "Highlights", body: "")])
        XCTAssertEqual(state.metrics, [.init(name: "MRR", value: "", unit: "")])
    }

    func testToInputDropsBlanksAndBlockerExplains() {
        var state = ComposerState(title: "  ")
        XCTAssertEqual(state.publishBlocker, "Give the update a title.")
        state.title = " June "
        state.sections = [.init(kind: "text", title: " Hi ", body: "  "), .init(kind: "text", title: "", body: " Body ")]
        state.metrics = [.init(name: "MRR", value: "", unit: ""), .init(name: " Runway ", value: " 18 ", unit: "mo")]
        state.asks = [.init(id: nil, kind: "intro", title: "", detail: ""), .init(id: "a1", kind: "hire", title: " CTO ", detail: "")]
        let input = state.toInput()
        XCTAssertEqual(input.title, "June")
        XCTAssertEqual(input.sections, [Section(kind: "text", title: "", body: "Body")])
        XCTAssertEqual(input.metrics, [Metric(name: "Runway", value: "18", unit: "mo")])
        XCTAssertEqual(input.asks, [AskInput(id: "a1", kind: "hire", title: "CTO", detail: "")])
        XCTAssertNil(state.publishBlocker)
        XCTAssertEqual(ComposerState(title: "T").publishBlocker, "Write at least one section, KPI or summary.")
    }

    func testDraftPayloadIsTheWebsShape() throws {
        let state = ComposerState(
            title: "T", summary: "S", categoryId: "c", sections: [.init(kind: "text", title: "", body: "b")],
            metrics: [.init(name: "MRR", value: "1", unit: "")], asks: [.init(id: nil, kind: "intro", title: "x", detail: "")])
        let payload = state.payload()
        XCTAssertTrue(payload.contains("\"categoryId\":\"c\""))
        XCTAssertTrue(payload.contains("\"id\":null"))
        XCTAssertEqual(ComposerState.parse(payload), state)
        // A web draft with fields missing still opens.
        XCTAssertEqual(ComposerState.parse(#"{"title":"Only"}"#)?.title, "Only")
        XCTAssertNil(ComposerState.parse("not json"))
    }

    func testThanksSection() {
        let c = ContributionView(
            askId: "a", askTitle: "Intro to Stripe", askKind: "intro", account: ana, name: "Ana", firm: "Seed Co",
            note: "", acceptedAt: 1)
        let section = Composer.thanksSection([c])
        XCTAssertEqual(section?.title, "Thank you")
        XCTAssertEqual(section?.body, "• Ana (Seed Co) — intro: Intro to Stripe")
        XCTAssertNil(Composer.thanksSection([]))
    }
}

final class InvitationTests: XCTestCase {
    let ns = String(repeating: "cd", count: 32)

    func testRoundTripsAnAudienceLink() throws {
        let invitation = UpdatesInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: ns), kind: .audience, namespaceId: ns,
            companyName: "Acme", audienceId: "grp", contextId: "ctx", audienceName: "Angels")
        let link = try invitation.link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-updates/join?invitation="))
        let parsed = try XCTUnwrap(UpdatesInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, ns)
        XCTAssertEqual(parsed.kind, .audience)
        XCTAssertEqual(parsed.contextId, "ctx")
        XCTAssertEqual(parsed.audienceName, "Angels")
        XCTAssertEqual(parsed.companyName, "Acme")
        XCTAssertEqual(parsed.scope, "Opens Angels")
    }

    func testReadsTheWebPayloadAndTakesTheNamespaceFromTheSignature() throws {
        let signed = json(InMemoryAppBackend.invitation(namespaceId: ns))
        let payload: JSONValue = ["invitation": signed, "kind": "namespace", "groupId": "tampered", "groupAlias": "Acme"]
        let text = String(data: try JSONEncoder().encode(payload), encoding: .utf8)!
        let token = try XCTUnwrap(InviteCodec.encode(json: text))
        let parsed = try XCTUnwrap(UpdatesInvitation.parse(token))
        XCTAssertEqual(parsed.namespaceId, ns)
        XCTAssertEqual(parsed.kind, .namespace)
        XCTAssertEqual(parsed.scope, "Whole company · Acme")
        // The older `?invite=` link form.
        XCTAssertNotNil(UpdatesInvitation.parse("https://updates.example.com/spaces?invite=\(token)"))
    }

    func testRejectsAnotherAppsLinkAndGarbage() throws {
        let invitation = UpdatesInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: ns), kind: .namespace, namespaceId: ns)
        let link = try invitation.link().replacingOccurrences(of: "com.calimero.mero-updates", with: "com.calimero.chat")
        XCTAssertNil(UpdatesInvitation.parse(link))
        XCTAssertNil(UpdatesInvitation.parse("hello"))
        XCTAssertNil(UpdatesInvitation.parse(""))
    }
}
