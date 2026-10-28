package network.calimero.standup.core

import network.calimero.standup.generated.DayView
import network.calimero.standup.generated.UpdateView
import java.util.Locale

/** One person's week: their updates in day order, only days they posted. */
data class PersonWeek(
    val account: String,
    val name: String,
    val updates: List<UpdateView>,
)

/** The week digest (the web's `lib/digest.ts`). */
object Digest {
    /** A week regrouped by person, people in name order. The latest name wins. */
    fun byPerson(week: List<DayView>): List<PersonWeek> {
        val people = LinkedHashMap<String, PersonWeek>()
        for (day in week) {
            for (u in day.updates) {
                val p = people[u.author] ?: PersonWeek(u.author, u.authorName, emptyList())
                people[u.author] = p.copy(name = u.authorName.ifEmpty { p.name }, updates = p.updates + u)
            }
        }
        return people.values.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { People.displayName(it.account, it.name) })
    }

    /** The week as Markdown, for a weekly report. Leaves the app only when the person shares or copies it. */
    fun markdown(
        teamName: String,
        start: String,
        week: List<DayView>,
        locale: Locale = Locale.getDefault(),
    ): String {
        val lines = mutableListOf("# ${teamName.ifEmpty { "Team" }} — week of ${Days.describeWeek(start, locale)}", "")
        val people = byPerson(week)
        if (people.isEmpty()) lines += "_No updates this week._"
        for (p in people) {
            lines += listOf("## ${People.displayName(p.account, p.name)}", "")
            for (u in p.updates) {
                lines += "**${Days.weekdayShort(u.day, locale)}**"
                if (u.done.isNotEmpty()) lines += "- Done: ${oneLine(u.done)}"
                if (u.next.isNotEmpty()) lines += "- Next: ${oneLine(u.next)}"
                if (u.blockers.isNotEmpty()) lines += "- Blocked: ${oneLine(u.blockers)}"
                lines += ""
            }
        }
        return lines.joinToString("\n").trimEnd() + "\n"
    }

    internal fun oneLine(text: String): String = text.split("\n").filter { it.isNotEmpty() }.joinToString("; ")
}
