package network.calimero.stream.core

/** One row of a call's roster (`app/src/lib/people.ts`). */
data class Person(
    val memberId: String,
    val name: String,
    /** Sending video right now. */
    val live: Boolean,
    val isSelf: Boolean,
)

object People {
    /** Up to two initials: first and last word, or the first two letters of one word. */
    fun initials(name: String): String {
        val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return "??"
        if (words.size == 1) return words[0].take(2).uppercase()
        return (words.first().take(1) + words.last().take(1)).uppercase()
    }

    /** `abcdef12…` */
    fun shortId(id: String): String = "${id.take(8)}…"

    /** The roster: the contract's members plus anyone sending. You first, then whoever is live, then by name. */
    fun roster(
        members: List<Pair<String, String>>,
        liveIds: Set<String>,
        me: String,
        selfName: String,
        selfLive: Boolean,
    ): List<Person> {
        val rows =
            members
                .map { (id, name) ->
                    Person(
                        memberId = id,
                        name =
                            if (id == me) {
                                selfName
                            } else if (name.isBlank()) {
                                shortId(id)
                            } else {
                                name
                            },
                        live = if (id == me) selfLive else id in liveIds,
                        isSelf = id == me,
                    )
                }.toMutableList()
        val known = rows.map { it.memberId }.toSet()
        for (id in liveIds.sorted()) if (id !in known) rows += Person(id, shortId(id), live = true, isSelf = false)
        if (rows.none { it.isSelf }) rows += Person(me, selfName, selfLive, isSelf = true)
        return rows.sortedWith(
            compareBy<Person> { !it.isSelf }
                .thenBy { !it.live }
                .thenBy(String.CASE_INSENSITIVE_ORDER) { it.name }
                .thenBy { it.memberId },
        )
    }
}
