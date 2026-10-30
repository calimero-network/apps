import CrmCore
import MeroKit
import MeroKitTestSupport
import XCTest

final class LogicTests: XCTestCase {
    func testMoneyFormatsAndParsesLikeTheWeb() {
        XCTAssertEqual(Money.format(12_400, currency: "USD"), "$12,400")
        XCTAssertEqual(Money.format(12_400, currency: "usd", compact: true), "$12.4K")
        XCTAssertEqual(Money.format(1_500_000, currency: "EUR", compact: true), "€1.5M")
        XCTAssertEqual(Money.format(950, currency: "GBP", compact: true), "£950")
        XCTAssertEqual(Money.format(12_000, currency: "XYZ"), "12,000 XYZ")
        XCTAssertEqual(Money.parse("12k"), 12_000)
        XCTAssertEqual(Money.parse("1.5m"), 1_500_000)
        XCTAssertEqual(Money.parse(" $12,400 "), 12_400)
        XCTAssertEqual(Money.parse(""), 0)
        XCTAssertNil(Money.parse("twelve"))
        XCTAssertNil(Money.parse("1.2.3"))
        XCTAssertNil(Money.parse("-5"))
        XCTAssertTrue(Money.isValidCode("eur"))
        XCTAssertFalse(Money.isValidCode("EURO"))
    }

    func testDueLabels() {
        XCTAssertEqual(Days.dueLabel(now.addingTimeInterval(-3 * 86_400), now: now, utc), DueLabel(text: "Overdue 3d", tone: .overdue))
        XCTAssertEqual(Days.dueLabel(now.addingTimeInterval(3600), now: now, utc).text, "Today")
        XCTAssertEqual(Days.dueLabel(now.addingTimeInterval(86_400), now: now, utc).text, "Tomorrow")
        XCTAssertEqual(Days.dueLabel(now.addingTimeInterval(4 * 86_400), now: now, utc).text, "In 4 days")
        XCTAssertEqual(Days.dueLabel(now.addingTimeInterval(10 * 86_400), now: now, utc).tone, .later)
        let due = Days.dueIn(1, now: now, utc)
        XCTAssertEqual(utc.component(.hour, from: due), 10)
        XCTAssertEqual(Days.between(now, due, utc), 1)
    }

    func testAHealthyDealScoresFullAndAQuietOneLosesPoints() {
        let good = deal("d1", next: next(2))
        let h = Assistant.health(good, rottingDays: 14, now: now, utc)
        XCTAssertEqual(h.score, 100)
        XCTAssertEqual(h.level, .healthy)
        XCTAssertEqual(h.winLikelihood, 10)

        let bad = deal(
            "d2", contactId: nil, owner: nil, close: ms(daysFromNow: -3), next: nil, created: ms(daysFromNow: -40))
        let b = Assistant.health(bad, rottingDays: 14, now: now, utc)
        // -30 no step, -30 rotting, -10 long in stage, -20 slipped close, -10 no contact, -5 no owner
        XCTAssertEqual(b.score, 0)
        XCTAssertEqual(b.level, .critical)
        XCTAssertTrue(b.rotting)
        XCTAssertEqual(b.idleDays, 40)
        XCTAssertEqual(
            b.reasons,
            [
                "No next step scheduled", "No activity in 40 days", "In this stage for 40 days",
                "Expected close date has passed", "No contact person linked", "Nobody owns this deal",
            ])

        let late = Assistant.health(deal("d3", next: next(-2)), rottingDays: 14, now: now, utc)
        XCTAssertEqual(late.score, 75)
        XCTAssertEqual(late.reasons, ["Next step overdue by 2 days"])

        let won = Assistant.health(deal("d4", status: "won", probability: 100, next: nil), rottingDays: 14, now: now, utc)
        XCTAssertEqual(won.score, 100)
    }

    func testNextActionsFollowThePlaybook() {
        let fresh = deal("d1", stage: "proposal", contactId: nil, close: nil, next: nil)
        let actions = Assistant.nextActions(fresh, stages: stages, rottingDays: 14, now: now, utc)
        XCTAssertEqual(actions.map(\.id), ["playbook", "contact", "close-date"])
        XCTAssertEqual(actions[0].activity, SuggestedActivity(kind: .call, subject: "Follow up on the proposal", dueInDays: 2))
        XCTAssertEqual(actions[0].buttonTitle, "Schedule in 2d")
        XCTAssertEqual(actions[1].field, .contact)
        XCTAssertEqual(actions[1].buttonTitle, "Fix")

        let lateStage = deal("d2", stage: "negotiation", next: next(1))
        XCTAssertEqual(
            Assistant.nextActions(lateStage, stages: stages, rottingDays: 14, now: now, utc).map(\.id), ["decision-maker"])
        XCTAssertEqual(Assistant.playbookStep(stageIndex: 0, stageCount: 5).kind, .call)
        XCTAssertEqual(Assistant.playbookStep(stageIndex: 1, stageCount: 5).kind, .meeting)
        XCTAssertEqual(Assistant.playbookStep(stageIndex: 2, stageCount: 5).kind, .email)
        XCTAssertTrue(Assistant.nextActions(deal("d3", status: "won"), stages: stages, rottingDays: 14, now: now, utc).isEmpty)
    }

    func testEmailDraftAndCoachingPrompt() {
        let d = deal("d1", stage: "meeting", next: next(1))
        let email = Assistant.followUpEmail(d, stages: stages, contact: contact("c1", name: "Ana Diaz"), sender: "Fran")
        XCTAssertEqual(email.subject, "Proposal for Acme")
        XCTAssertTrue(email.body.hasPrefix("Hi Ana,\n\n"))
        XCTAssertTrue(email.body.hasSuffix("Best,\nFran"))

        let detail = DealDetail(
            deal: d, contact: contact("c1", name: "Ana Diaz"),
            activities: [activity("a1", due: ms(daysFromNow: 1))],
            notes: [NoteView(id: "n1", dealId: "d1", author: "me", body: "Budget\n approved", createdAt: ms(daysFromNow: -1))])
        let prompt = Assistant.coachingPrompt(detail, stages: stages, currency: "USD", rottingDays: 14, now: now, utc)
        XCTAssertTrue(prompt.contains("- Value: $12,000"))
        XCTAssertTrue(prompt.contains("- Stage: Meeting (10% stage probability) of Lead in → Qualified → Meeting → Proposal → Negotiation"))
        XCTAssertTrue(prompt.contains("- Ana Diaz, Head of Ops at Acme"))
        XCTAssertTrue(prompt.contains("- [open] Call: Subject a1 (due Thu Oct 29 2026)"))
        XCTAssertTrue(prompt.contains("- Tue Oct 27 2026: Budget approved"))
        XCTAssertFalse(prompt.contains("d1"))
    }

    func testStatsMatchTheWebsComputeStats() {
        let deals = [
            deal("o1", value: 10_000, stage: "lead", probability: 10, close: ms(daysFromNow: 1)),
            deal("o2", value: 20_000, stage: "proposal", probability: 60, owner: "bob", close: nil),
            deal(
                "w1", value: 5_000, status: "won", probability: 100, created: ms(daysFromNow: -12),
                closedAt: ms(daysFromNow: -2)),
            deal("l1", value: 7_000, status: "lost", probability: 0, closedAt: ms(daysFromNow: -1), lostReason: "Price"),
            deal("l2", value: 1_000, status: "lost", probability: 0, closedAt: ms(daysFromNow: -1)),
        ]
        let s = Insights.stats(deals: deals, stages: stages, now: now, utc)
        XCTAssertEqual(s.openCount, 2)
        XCTAssertEqual(s.openValue, 30_000)
        XCTAssertEqual(s.weightedValue, 13_000)
        XCTAssertEqual(s.wonValue, 5_000)
        XCTAssertEqual(s.winRate, 33)
        XCTAssertEqual(s.avgWonValue, 5_000)
        XCTAssertEqual(s.avgCycleDays, 10)
        XCTAssertEqual(s.wonThisMonth, 5_000)
        XCTAssertEqual(s.perStage.map(\.count), [1, 0, 0, 1, 0])
        XCTAssertEqual(s.lostReasons.map(\.reason), ["Price", "No reason given"])
        XCTAssertEqual(s.byOwner.map(\.owner), ["alice", "bob"])
        XCTAssertEqual(s.forecast.count, 7)
        XCTAssertEqual(s.forecast[0].label, "Oct 26")
        XCTAssertEqual(s.forecast[0].value, 10_000)
        XCTAssertEqual(s.forecast[1].label, "Nov")
        XCTAssertEqual(s.forecast.last, ForecastMonth(label: "No date", value: 20_000, weighted: 12_000))
    }

    func testActivitiesBucketByDueDay() {
        let list = [
            activity("late", due: ms(daysFromNow: -2)),
            activity("today", due: ms(daysFromNow: 0.2)),
            activity("soon", due: ms(daysFromNow: 3)),
            activity("old", due: 1, done: true, doneAt: 5),
            activity("new", due: 1, done: true, doneAt: 9),
        ]
        let b = Insights.buckets(list, now: now, utc)
        XCTAssertEqual(b[.overdue]?.map(\.id), ["late"])
        XCTAssertEqual(b[.today]?.map(\.id), ["today"])
        XCTAssertEqual(b[.upcoming]?.map(\.id), ["soon"])
        XCTAssertEqual(b[.done]?.map(\.id), ["new", "old"])
    }

    func testCompaniesGatherPeopleAndDealsByOrganization() {
        let companies = Insights.companies(
            contacts: [contact("c1", name: "Ana", org: "Acme"), contact("c2", name: "Bo", org: " acme "), contact("c3", name: "Cy", org: "")],
            deals: [deal("d1", organization: "ACME"), deal("d2", status: "won", organization: "Globex")])
        XCTAssertEqual(companies.map(\.name), ["Acme", "Globex"])
        XCTAssertEqual(companies[0].people.map(\.name), ["Ana", "Bo"])
        XCTAssertEqual(companies[0].openValue, 12_000)
        XCTAssertEqual(companies[1].wonValue, 12_000)
        XCTAssertTrue(Insights.contactMatches(contact("c1", name: "Ana Diaz"), "diaz"))
        XCTAssertTrue(Insights.dealMatches(deal("d1"), "referral"))
        XCTAssertFalse(Insights.dealMatches(deal("d1"), "globex"))
    }

    func testAccountsCompareAcrossHexAndBase58() {
        let hex = String(repeating: "ab", count: 32)
        let b58 = InviteCodec.base58Encode(Data(repeating: 0xab, count: 32))
        XCTAssertEqual(Account.canonical(b58), hex)
        XCTAssertTrue(Account.same(hex.uppercased(), b58))
        XCTAssertFalse(Account.same("alice", "alice"))
        XCTAssertEqual(Account.short(hex), "ababab…abab")
    }

    func testInvitationRoundTripsInTheSDKLinkShapeAndRefusesOtherApps() throws {
        let ns = String(repeating: "12", count: 32)
        let signed = InMemoryAppBackend.invitation(namespaceId: ns)
        let link = try CrmInvitation(invitation: signed, workspaceName: "Acme Inc").link()
        XCTAssertTrue(link.contains("/com.calimero.mero-crm/join?invitation="))
        let parsed = try XCTUnwrap(CrmInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, ns)
        XCTAssertEqual(parsed.workspaceName, "Acme Inc")
        let token = try XCTUnwrap(InviteLink.token(fromPasted: link))
        XCTAssertNotNil(CrmInvitation.parse(token))
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(value["invitation"]?["orgId"]?.stringValue, ns)
        XCTAssertEqual(value["invitation"]?["token"]?.stringValue, signed.token)
        XCTAssertEqual(value["namespaceId"]?.stringValue, ns)
        XCTAssertEqual(value["groupAlias"]?.stringValue, "Acme Inc")
        XCTAssertEqual(parsed.invitation, signed)
        let pre10 = #"{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"ff"},"groupId":"12"}"#
        XCTAssertNil(CrmInvitation.parse(json: pre10), "a 1.0 cluster cannot redeem a signed group invitation")
        XCTAssertNil(CrmInvitation.parse(link.replacingOccurrences(of: "com.calimero.mero-crm", with: "com.calimero.chat")))
        XCTAssertNil(CrmInvitation.parse("not a link"))
    }

    func testDraftsValidate() {
        var d = DealDraft()
        d.title = "Acme"
        d.value = "12k"
        XCTAssertFalse(d.isValid)
        d.stageId = "lead"
        XCTAssertTrue(d.isValid)
        d.value = "abc"
        XCTAssertFalse(d.isValid)
        d.value = "1"
        d.creatingContact = true
        XCTAssertFalse(d.isValid)
        d.newContactName = "Ana"
        XCTAssertTrue(d.isValid)
        XCTAssertNil(d.closeMs(utc))
        d.hasClose = true
        d.expectedClose = now
        XCTAssertEqual(utc.component(.hour, from: Days.date(d.closeMs(utc)!)), 12)
    }
}
