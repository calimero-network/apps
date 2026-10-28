package network.calimero.crm

import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import com.calimero.mero.testkit.InMemoryAppBackend
import network.calimero.crm.core.Account
import network.calimero.crm.core.ActivityBucket
import network.calimero.crm.core.ActivityKind
import network.calimero.crm.core.Assistant
import network.calimero.crm.core.CrmInvitation
import network.calimero.crm.core.Days
import network.calimero.crm.core.DealDraft
import network.calimero.crm.core.DealField
import network.calimero.crm.core.DueLabel
import network.calimero.crm.core.DueTone
import network.calimero.crm.core.ForecastMonth
import network.calimero.crm.core.HealthLevel
import network.calimero.crm.core.Insights
import network.calimero.crm.core.Money
import network.calimero.crm.core.SuggestedActivity
import network.calimero.crm.generated.DealDetail
import network.calimero.crm.generated.NoteView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.util.Locale

/** The same cases as the iOS app's LogicTests.swift. */
class LogicTest {
    @Test
    fun `money formats and parses like the web`() {
        assertEquals("$12,400", Money.format(12_400u, "USD"))
        assertEquals("$12.4K", Money.format(12_400u, "usd", compact = true))
        assertEquals("€1.5M", Money.format(1_500_000u, "EUR", compact = true))
        assertEquals("£950", Money.format(950u, "GBP", compact = true))
        assertEquals("12,000 XYZ", Money.format(12_000u, "XYZ"))
        assertEquals(12_000uL, Money.parse("12k"))
        assertEquals(1_500_000uL, Money.parse("1.5m"))
        assertEquals(12_400uL, Money.parse(" $12,400 "))
        assertEquals(0uL, Money.parse(""))
        assertNull(Money.parse("twelve"))
        assertNull(Money.parse("1.2.3"))
        assertNull(Money.parse("-5"))
        assertTrue(Money.isValidCode("eur"))
        assertFalse(Money.isValidCode("EURO"))
    }

    @Test
    fun `due labels`() {
        assertEquals(DueLabel("Overdue 3d", DueTone.OVERDUE), Days.dueLabel(ms(-3.0), now, utc))
        assertEquals("Today", Days.dueLabel(ms(1.0 / 24), now, utc).text)
        assertEquals("Tomorrow", Days.dueLabel(ms(1.0), now, utc).text)
        assertEquals("In 4 days", Days.dueLabel(ms(4.0), now, utc).text)
        assertEquals(DueTone.LATER, Days.dueLabel(ms(10.0), now, utc).tone)
        val due = Days.dueIn(1, now, utc)
        assertEquals(10, Instant.ofEpochMilli(due.toLong()).atZone(utc).hour)
        assertEquals(1, Days.between(now, due, utc))
    }

    @Test
    fun `a healthy deal scores full and a quiet one loses points`() {
        val h = Assistant.health(deal("d1", next = next(2.0)), 14, now, utc)
        assertEquals(100, h.score)
        assertEquals(HealthLevel.HEALTHY, h.level)
        assertEquals(10, h.winLikelihood)

        val bad = deal("d2", contactId = null, owner = null, close = ms(-3.0), next = null, created = ms(-40.0))
        val b = Assistant.health(bad, 14, now, utc)
        assertEquals(0, b.score)
        assertEquals(HealthLevel.CRITICAL, b.level)
        assertTrue(b.rotting)
        assertEquals(40, b.idleDays)
        assertEquals(
            listOf(
                "No next step scheduled",
                "No activity in 40 days",
                "In this stage for 40 days",
                "Expected close date has passed",
                "No contact person linked",
                "Nobody owns this deal",
            ),
            b.reasons,
        )
        val late = Assistant.health(deal("d3", next = next(-2.0)), 14, now, utc)
        assertEquals(75, late.score)
        assertEquals(listOf("Next step overdue by 2 days"), late.reasons)
        assertEquals(100, Assistant.health(deal("d4", status = "won", probability = 100u), 14, now, utc).score)
    }

    @Test
    fun `next actions follow the playbook`() {
        val fresh = deal("d1", stage = "proposal", contactId = null, close = null, next = null)
        val actions = Assistant.nextActions(fresh, stages, 14, now, utc)
        assertEquals(listOf("playbook", "contact", "close-date"), actions.map { it.id })
        assertEquals(SuggestedActivity(ActivityKind.CALL, "Follow up on the proposal", 2), actions[0].activity)
        assertEquals("Schedule in 2d", actions[0].buttonTitle)
        assertEquals(DealField.CONTACT, actions[1].field)
        assertEquals("Fix", actions[1].buttonTitle)
        assertEquals(listOf("decision-maker"), Assistant.nextActions(deal("d2", stage = "negotiation", next = next(1.0)), stages, 14, now, utc).map { it.id })
        assertEquals(ActivityKind.CALL, Assistant.playbookStep(0, 5).kind)
        assertEquals(ActivityKind.MEETING, Assistant.playbookStep(1, 5).kind)
        assertEquals(ActivityKind.EMAIL, Assistant.playbookStep(2, 5).kind)
        assertTrue(Assistant.nextActions(deal("d3", status = "won"), stages, 14, now, utc).isEmpty())
    }

    @Test
    fun `email draft and coaching prompt`() {
        val d = deal("d1", stage = "meeting", next = next(1.0))
        val email = Assistant.followUpEmail(d, stages, contact("c1", "Ana Diaz"), "Fran")
        assertEquals("Proposal for Acme", email.subject)
        assertTrue(email.body.startsWith("Hi Ana,\n\n"))
        assertTrue(email.body.endsWith("Best,\nFran"))
        val detail =
            DealDetail(
                d,
                contact("c1", "Ana Diaz"),
                listOf(activity("a1", ms(1.0))),
                listOf(NoteView("n1", "d1", "me", "Budget\n approved", ms(-1.0))),
            )
        val prompt = Assistant.coachingPrompt(detail, stages, "USD", 14, now, utc)
        assertTrue(prompt.contains("- Value: $12,000"))
        assertTrue(prompt.contains("- Stage: Meeting (10% stage probability) of Lead in → Qualified → Meeting → Proposal → Negotiation"))
        assertTrue(prompt.contains("- Ana Diaz, Head of Ops at Acme"))
        assertTrue(prompt.contains("- [open] Call: Subject a1 (due Thu Oct 29 2026)"))
        assertTrue(prompt.contains("- Tue Oct 27 2026: Budget approved"))
        assertFalse(prompt.contains("d1"))
    }

    @Test
    fun `stats match the web's computeStats`() {
        val deals =
            listOf(
                deal("o1", value = 10_000u, stage = "lead", probability = 10u, close = ms(1.0)),
                deal("o2", value = 20_000u, stage = "proposal", probability = 60u, owner = "bob", close = null),
                deal("w1", value = 5_000u, status = "won", probability = 100u, created = ms(-12.0), closedAt = ms(-2.0)),
                deal("l1", value = 7_000u, status = "lost", probability = 0u, closedAt = ms(-1.0), lostReason = "Price"),
                deal("l2", value = 1_000u, status = "lost", probability = 0u, closedAt = ms(-1.0)),
            )
        val s = Insights.stats(deals, stages, now, utc, Locale.US)
        assertEquals(2, s.openCount)
        assertEquals(30_000uL, s.openValue)
        assertEquals(13_000uL, s.weightedValue)
        assertEquals(5_000uL, s.wonValue)
        assertEquals(33, s.winRate)
        assertEquals(5_000uL, s.avgWonValue)
        assertEquals(10, s.avgCycleDays)
        assertEquals(5_000uL, s.wonThisMonth)
        assertEquals(listOf(1, 0, 0, 1, 0), s.perStage.map { it.count })
        assertEquals(listOf("Price", "No reason given"), s.lostReasons.map { it.reason })
        assertEquals(listOf("alice", "bob"), s.byOwner.map { it.owner })
        assertEquals(7, s.forecast.size)
        assertEquals("Oct 26", s.forecast[0].label)
        assertEquals(10_000uL, s.forecast[0].value)
        assertEquals("Nov", s.forecast[1].label)
        assertEquals(ForecastMonth("No date", 20_000u, 12_000u), s.forecast.last())
    }

    @Test
    fun `activities bucket by due day`() {
        val list =
            listOf(
                activity("late", ms(-2.0)),
                activity("today", ms(0.2)),
                activity("soon", ms(3.0)),
                activity("old", 1u, done = true, doneAt = 5u),
                activity("new", 1u, done = true, doneAt = 9u),
            )
        val b = Insights.buckets(list, now, utc)
        assertEquals(listOf("late"), b.getValue(ActivityBucket.OVERDUE).map { it.id })
        assertEquals(listOf("today"), b.getValue(ActivityBucket.TODAY).map { it.id })
        assertEquals(listOf("soon"), b.getValue(ActivityBucket.UPCOMING).map { it.id })
        assertEquals(listOf("new", "old"), b.getValue(ActivityBucket.DONE).map { it.id })
    }

    @Test
    fun `companies gather people and deals by organization`() {
        val companies =
            Insights.companies(
                listOf(contact("c1", "Ana", "Acme"), contact("c2", "Bo", " acme "), contact("c3", "Cy", "")),
                listOf(deal("d1", organization = "ACME"), deal("d2", status = "won", organization = "Globex")),
            )
        assertEquals(listOf("Acme", "Globex"), companies.map { it.name })
        assertEquals(listOf("Ana", "Bo"), companies[0].people.map { it.name })
        assertEquals(12_000uL, companies[0].openValue)
        assertEquals(12_000uL, companies[1].wonValue)
        assertTrue(Insights.contactMatches(contact("c1", "Ana Diaz"), "diaz"))
        assertTrue(Insights.dealMatches(deal("d1"), "referral"))
        assertFalse(Insights.dealMatches(deal("d1"), "globex"))
    }

    @Test
    fun `accounts compare across hex and base58`() {
        val hex = "ab".repeat(32)
        val b58 = InviteCodec.base58Encode(ByteArray(32) { 0xab.toByte() })
        assertEquals(hex, Account.canonical(b58))
        assertTrue(Account.same(hex.uppercase(), b58))
        assertFalse(Account.same("alice", "alice"))
        assertEquals("ababab…abab", Account.short(hex))
    }

    @Test
    fun `invitation round-trips in the web format and refuses other apps`() {
        val ns = "12".repeat(32)
        val signed = InMemoryAppBackend.invitation(ns)
        val link = CrmInvitation(signed, "Acme Inc").link()
        assertTrue(link.contains("/com.calimero.mero-crm/join?invitation="))
        val parsed = CrmInvitation.parse(link)!!
        assertEquals(ns, parsed.namespaceId)
        assertEquals("Acme Inc", parsed.workspaceName)
        val token = InviteLink.tokenFromPasted(link)!!
        assertNotNull(CrmInvitation.parse(token))
        val json = InviteCodec.decode(token)!!
        assertTrue(json.contains("\"kind\":\"namespace\""))
        assertTrue(json.contains("\"groupAlias\":\"Acme Inc\""))
        assertNull(CrmInvitation.parse(link.replace("com.calimero.mero-crm", "com.calimero.chat")))
        assertNull(CrmInvitation.parse("not a link"))
    }

    @Test
    fun `drafts validate`() {
        var d = DealDraft(title = "Acme", value = "12k")
        assertFalse(d.isValid)
        d = d.copy(stageId = "lead")
        assertTrue(d.isValid)
        assertFalse(d.copy(value = "abc").isValid)
        d = d.copy(value = "1", creatingContact = true)
        assertFalse(d.isValid)
        assertTrue(d.copy(newContactName = "Ana").isValid)
        assertNull(d.closeMs(utc))
        val close = d.copy(expectedClose = LocalDate.of(2026, 10, 28)).closeMs(utc)!!
        assertEquals(12, Instant.ofEpochMilli(close.toLong()).atZone(utc).hour)
    }
}
