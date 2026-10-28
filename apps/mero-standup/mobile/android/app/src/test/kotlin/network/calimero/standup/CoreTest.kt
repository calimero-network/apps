package network.calimero.standup

import com.calimero.mero.testkit.InMemoryAppBackend
import network.calimero.standup.core.Days
import network.calimero.standup.core.DecisionDraft
import network.calimero.standup.core.Digest
import network.calimero.standup.core.People
import network.calimero.standup.core.RichText
import network.calimero.standup.core.RichText.Block
import network.calimero.standup.core.RichText.Inline
import network.calimero.standup.core.StandupInvitation
import network.calimero.standup.core.Tags
import network.calimero.standup.core.UpdateDraft
import network.calimero.standup.generated.DayView
import network.calimero.standup.generated.MemberView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class CoreTest {
    @Test
    fun `days parse, shift and describe like the web`() {
        assertEquals("2026-10-28", Days.today(clock))
        assertNull(Days.parse("2026-02-30"))
        assertNull(Days.parse("26-1-1"))
        assertEquals("2026-11-01", Days.shift("2026-10-31", 1))
        assertEquals("junk", Days.shift("junk", 1))
        assertEquals("Today", Days.describe("2026-10-28", clock))
        assertEquals("Yesterday", Days.describe("2026-10-27", clock))
        assertEquals("Tomorrow", Days.describe("2026-10-29", clock))
        assertEquals("Mon, Oct 26", Days.describe("2026-10-26", clock, Locale.US))
        assertEquals("2026-10-26", Days.weekStart("2026-10-28"))
        assertEquals("2026-10-26", Days.weekStart("2026-11-01"))
        assertEquals(7, Days.weekDays("2026-10-26").size)
        assertEquals("Oct 26 – Nov 1", Days.describeWeek("2026-10-26", Locale.US))
        assertEquals("Oct 5 – 11", Days.describeWeek("2026-10-05", Locale.US))
        assertEquals("8", Days.dayNumber("2026-10-08"))
    }

    @Test
    fun `relative times`() {
        val now = clock.instant().toEpochMilli().toULong() * 1_000_000uL
        assertEquals("just now", Days.relative(now - 10_000_000_000uL, clock))
        assertEquals("5m ago", Days.relative(now - 300_000_000_000uL, clock))
        assertEquals("3h ago", Days.relative(now - 3uL * 3_600_000_000_000uL, clock))
        assertEquals("yesterday", Days.relative(now - 24uL * 3_600_000_000_000uL, clock))
        assertEquals("", Days.relative(0uL, clock))
    }

    @Test
    fun `people names, initials, hue and not yet posted`() {
        assertEquals("abcdef…7890", People.shortAccount("abcdef1234567890"))
        assertEquals("Ana", People.displayName("x", " Ana "))
        assertEquals("AL", People.initials("x", "Ana Lee"))
        assertEquals("AN", People.initials("x", "ana"))
        assertEquals("AB", People.initials("abc", ""))
        assertEquals(People.avatarHue("acc"), People.avatarHue("acc"))
        assertTrue(People.avatarHue("acc") in 0..359)
        val members = listOf(MemberView("z", "Zed", ""), MemberView("a", "Ann", ""), MemberView("p", "Posted", ""))
        assertEquals(listOf("a", "z"), People.notYetPosted(members, listOf(update("p", "2026-10-28"))).map { it.account })
    }

    @Test
    fun `tags normalize like the contract`() {
        assertEquals(listOf("infra", "release-process"), Tags.parse("Infra,  release   process , infra,"))
        assertEquals(emptyList<String>(), Tags.parse(" , "))
    }

    @Test
    fun `rich text bullets, code and links`() {
        val blocks = RichText.parse("intro `x` see https://a.b/c.\n- one\n* two\n\n1. three")
        assertEquals(2, blocks.size)
        val para = blocks[0] as Block.Paragraph
        assertEquals(listOf(Inline.Text("intro "), Inline.Code("x"), Inline.Text(" see "), Inline.Link("https://a.b/c"), Inline.Text(".")), para.inlines)
        assertEquals(3, (blocks[1] as Block.ListBlock).items.size)
        assertTrue(RichText.parse("-not a bullet")[0] is Block.Paragraph)
    }

    @Test
    fun `carry forward makes yesterday's next today's done`() {
        val draft = UpdateDraft.carryForward(update(ME, "2026-10-27", next = "ship it", blockers = "CI"))
        assertEquals(UpdateDraft(done = "ship it", next = "", blockers = "CI"), draft)
        assertTrue(UpdateDraft.carryForward(null).isEmpty)
        assertFalse(draft.isEmpty)
        val superseding = DecisionDraft.start(supersedes = decision("d1", "Old").copy(tags = listOf("a", "b")))
        assertEquals("a, b", superseding.tagsInput)
        assertFalse(superseding.isReady)
    }

    @Test
    fun `digest groups by person and writes markdown`() {
        val week =
            listOf(
                DayView("2026-10-26", listOf(update(BO, "2026-10-26", name = "Bo", blockers = "a\nb"))),
                DayView("2026-10-27", listOf(update(ANA, "2026-10-27", name = "Ana"), update(BO, "2026-10-27", name = "Bobby"))),
            )
        val people = Digest.byPerson(week)
        assertEquals(listOf("Ana", "Bobby"), people.map { it.name })
        assertEquals(2, people[1].updates.size)
        val md = Digest.markdown("Platform", "2026-10-26", week, Locale.US)
        assertTrue(md.startsWith("# Platform — week of Oct 26 – Nov 1\n"))
        assertTrue(md.contains("## Bobby\n\n**Mon**\n- Done: did 2026-10-26\n- Next: next 2026-10-26\n- Blocked: a; b\n"))
        assertTrue(md.endsWith("\n") && !md.endsWith("\n\n"))
        assertTrue(Digest.markdown("", "2026-10-26", emptyList(), Locale.US).contains("_No updates this week._"))
    }

    @Test
    fun `invitation links round trip and refuse other apps`() {
        val ns = "ab".repeat(32)
        val invitation = StandupInvitation(InMemoryAppBackend.invitation(ns), ns, "ctx-1")
        val link = invitation.link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-standup/join?invitation="))
        val back = StandupInvitation.parse(link)!!
        assertEquals(ns, back.namespaceId)
        assertEquals("ctx-1", back.contextId)
        assertEquals(invitation.invitation.raw, back.invitation.raw)
        val token = link.substringAfter("invitation=")
        assertNotNull(StandupInvitation.parse("calimero://com.calimero.mero-standup/join?invitation=$token"))
        assertNotNull(StandupInvitation.parse(token))
        assertNull(StandupInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$token"))
        assertNull(StandupInvitation.parse("not a link"))
        assertNull(StandupInvitation.parseJson("""{"namespaceId":"n","contextId":"c","invitation":{"invitation":{}}}"""))
    }
}
