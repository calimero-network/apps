package network.calimero.updates

import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.updates.core.AskKind
import network.calimero.updates.core.Catalog
import network.calimero.updates.core.Composer
import network.calimero.updates.core.ComposerState
import network.calimero.updates.core.Format
import network.calimero.updates.core.Metrics
import network.calimero.updates.core.People
import network.calimero.updates.core.UpdateTemplate
import network.calimero.updates.core.UpdatesInvitation
import network.calimero.updates.generated.AskInput
import network.calimero.updates.generated.ContributionView
import network.calimero.updates.generated.Metric
import network.calimero.updates.generated.MetricPoint
import network.calimero.updates.generated.MetricSeries
import network.calimero.updates.generated.Section
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FormatTest {
    @Test
    fun `time ago`() {
        assertEquals("never", Format.timeAgo(0uL, clock))
        assertEquals("just now", Format.timeAgo(NOW_MS - 10_000uL, clock))
        assertEquals("5m ago", Format.timeAgo(NOW_MS - 300_000uL, clock))
        assertEquals("3h ago", Format.timeAgo(NOW_MS - 3uL * 3_600_000uL, clock))
        assertEquals("12d ago", Format.timeAgo(NOW_MS - 12uL * 86_400_000uL, clock))
        assertEquals("Sep 18, 2026", Format.timeAgo(NOW_MS - 40uL * 86_400_000uL, clock))
    }

    @Test
    fun `due label`() {
        assertEquals("Due today", Format.dueLabel(NOW_MS, clock))
        assertEquals("Due in 1 day", Format.dueLabel(NOW_MS + 86_400_000uL, clock))
        assertEquals("Due in 3 days", Format.dueLabel(NOW_MS + 3uL * 86_400_000uL, clock))
        assertEquals("2 days overdue", Format.dueLabel(NOW_MS - 2uL * 86_400_000uL, clock))
        assertTrue(Format.isOverdue(NOW_MS - 1uL, clock))
    }

    @Test
    fun `month title`() = assertEquals("October 2026 update", Format.monthTitle(clock))

    @Test
    fun `people labels match the iOS app`() {
        assertEquals("Ana", People.label("  Ana ", ANA))
        assertEquals("b2b2b2…b2b2", People.label("", ANA))
        assertEquals("AL", People.initials("Ana Lopez", ANA))
        // Same FNV-1a hue on both platforms.
        assertEquals(101, People.avatarHue(ANA))
        assertTrue(People.avatarHue(ANA) in 0 until 360)
    }

    @Test
    fun `metric parsing and deltas`() {
        assertEquals(1_200_000.0, Metrics.parse("$1.2M")!!, 0.001)
        assertEquals(42_000.0, Metrics.parse("42k")!!, 0.001)
        assertEquals(1500.0, Metrics.parse("1,500")!!, 0.001)
        assertNull(Metrics.parse("n/a"))
        assertEquals("+5%", Metrics.delta("$40k", "$42k"))
        assertEquals("−12%", Metrics.delta("100", "88"))
        assertEquals("±0%", Metrics.delta("10", "10"))
        assertEquals("+4.5%", Metrics.delta("1000", "1045"))
        assertNull(Metrics.delta("0", "5"))
        assertEquals(Metrics.Direction.UP, Metrics.direction("+5%"))
        assertEquals(Metrics.Direction.DOWN, Metrics.direction("−5%"))
        assertEquals(Metrics.Direction.FLAT, Metrics.direction("±0%"))
    }

    @Test
    fun `previous and last metric`() {
        val series =
            listOf(MetricSeries("MRR", "", listOf(MetricPoint("p1", "Sep", 1uL, "$40k"), MetricPoint("p2", "Oct", 2uL, "$42k"))))
        assertEquals("$40k", Metrics.previous("mrr", "p2", series)?.value)
        assertNull(Metrics.previous("MRR", "p1", series))
        assertEquals("$42k", Metrics.last(" mrr ", series))
        assertEquals("+5%", Metrics.latestDelta(series[0]))
    }

    @Test
    fun `ask kinds and catalog`() {
        assertEquals("Hiring", AskKind.of("hire").label)
        assertEquals("other", AskKind.of("nope").id)
        assertEquals(0x2563EBL, Catalog.rgb("#2563eb"))
        assertNull(Catalog.rgb("blue"))
        assertEquals(listOf(0u, 7u, 14u, 30u, 91u), Catalog.cadences.map { it.days })
    }
}

class ComposerTest {
    private val series = listOf(MetricSeries("MRR", "$", listOf(MetricPoint("p", "", 1uL, "1"))))

    @Test
    fun `monthly template carries KPIs and suggests an ask`() {
        val state = Composer.fromTemplate(UpdateTemplate.of("monthly"), series, clock = clock)
        assertEquals("October 2026 update", state.title)
        assertEquals(listOf("Highlights", "Lowlights", "Product", "Team"), state.sections.map { it.title })
        assertEquals(listOf(ComposerState.MetricDraft("MRR", "", "$")), state.metrics)
        assertEquals(1, state.asks.size)
        val blank = Composer.fromTemplate(UpdateTemplate.of("blank"), series, clock = clock)
        assertEquals("", blank.title)
        assertTrue(blank.metrics.isEmpty() && blank.asks.isEmpty())
    }

    @Test
    fun `reuse keeps the shape not the words`() {
        val post =
            postView(card("p1", category = "cat"), metrics = listOf(Metric("MRR", "$42k", "")), sections = listOf(Section("highlights", "Highlights", "Shipped")))
        val state = Composer.fromPrevious(post, clock)
        assertEquals("cat", state.categoryId)
        assertEquals(listOf(ComposerState.SectionDraft("highlights", "Highlights", "")), state.sections)
        assertEquals(listOf(ComposerState.MetricDraft("MRR", "", "")), state.metrics)
    }

    @Test
    fun `to input drops blanks and the blocker explains`() {
        assertEquals("Give the update a title.", ComposerState(title = "  ").publishBlocker)
        val state =
            ComposerState(
                title = " June ",
                sections = listOf(ComposerState.SectionDraft("text", " Hi ", "  "), ComposerState.SectionDraft("text", "", " Body ")),
                metrics = listOf(ComposerState.MetricDraft("MRR", "", ""), ComposerState.MetricDraft(" Runway ", " 18 ", "mo")),
                asks = listOf(ComposerState.AskDraft(null, "intro", "", ""), ComposerState.AskDraft("a1", "hire", " CTO ", "")),
            )
        val input = state.toInput()
        assertEquals("June", input.title)
        assertEquals(listOf(Section("text", "", "Body")), input.sections)
        assertEquals(listOf(Metric("Runway", "18", "mo")), input.metrics)
        assertEquals(listOf(AskInput("a1", "hire", "CTO", "")), input.asks)
        assertNull(state.publishBlocker)
        assertEquals("Write at least one section, KPI or summary.", ComposerState(title = "T").publishBlocker)
    }

    @Test
    fun `draft payload is the web's shape`() {
        val state =
            ComposerState(
                "T",
                "S",
                "c",
                listOf(ComposerState.SectionDraft("text", "", "b")),
                listOf(ComposerState.MetricDraft("MRR", "1", "")),
                listOf(ComposerState.AskDraft(null, "intro", "x", "")),
            )
        val payload = state.payload()
        assertTrue(payload.contains("\"categoryId\":\"c\""))
        assertTrue(payload.contains("\"id\":null"))
        assertEquals(state, ComposerState.parse(payload))
        assertEquals("Only", ComposerState.parse("""{"title":"Only"}""")?.title)
        assertNull(ComposerState.parse("not json"))
    }

    @Test
    fun `thanks section`() {
        val c = ContributionView("a", "Intro to Stripe", "intro", ANA, "Ana", "Seed Co", "", 1uL)
        val section = Composer.thanksSection(listOf(c))
        assertEquals("Thank you", section?.title)
        assertEquals("• Ana (Seed Co) — intro: Intro to Stripe", section?.body)
        assertNull(Composer.thanksSection(emptyList()))
    }
}

class InvitationTest {
    private val ns = "cd".repeat(32)

    @Test
    fun `round trips an audience link`() {
        val invitation =
            UpdatesInvitation(
                InMemoryAppBackend.invitation(ns),
                UpdatesInvitation.Kind.AUDIENCE,
                ns,
                companyName = "Acme",
                audienceId = "grp",
                contextId = "ctx",
                audienceName = "Angels",
            )
        val link = invitation.link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-updates/join?invitation="))
        val parsed = UpdatesInvitation.parse(link)!!
        assertEquals(ns, parsed.namespaceId)
        assertEquals(UpdatesInvitation.Kind.AUDIENCE, parsed.kind)
        assertEquals("ctx", parsed.contextId)
        assertEquals("Angels", parsed.audienceName)
        assertEquals("Acme", parsed.companyName)
        assertEquals("Opens Angels", parsed.scope)
    }

    @Test
    fun `reads the web payload and takes the namespace from the signature`() {
        val payload =
            buildJsonObject {
                put("invitation", InMemoryAppBackend.invitation(ns).raw)
                put("kind", "namespace")
                put("groupId", "tampered")
                put("groupAlias", "Acme")
            }.toString()
        val token = InviteCodec.encode(payload)
        val parsed = UpdatesInvitation.parse(token)!!
        assertEquals(ns, parsed.namespaceId)
        assertEquals(UpdatesInvitation.Kind.NAMESPACE, parsed.kind)
        assertEquals("Whole company · Acme", parsed.scope)
        assertNotNull(UpdatesInvitation.parse("https://updates.example.com/spaces?invite=$token"))
    }

    @Test
    fun `rejects another app's link and garbage`() {
        val link =
            UpdatesInvitation(InMemoryAppBackend.invitation(ns), UpdatesInvitation.Kind.NAMESPACE, ns)
                .link()
                .replace("com.calimero.mero-updates", "com.calimero.chat")
        assertNull(UpdatesInvitation.parse(link))
        assertNull(UpdatesInvitation.parse("hello"))
        assertNull(UpdatesInvitation.parse(""))
    }
}
