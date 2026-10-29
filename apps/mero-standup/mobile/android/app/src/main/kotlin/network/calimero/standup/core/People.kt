package network.calimero.standup.core

import network.calimero.standup.generated.MemberView
import network.calimero.standup.generated.UpdateView

/** Names, initials and avatar colours (the web app's `lib/people.ts`). */
object People {
    /** A long account id shortened for a byline: `a1b2c3…7890`. */
    fun shortAccount(account: String): String = if (account.length > 12) "${account.take(6)}…${account.takeLast(4)}" else account

    /** The name someone chose on this team, else a short id. Never blank. */
    fun displayName(
        account: String,
        name: String?,
    ): String = name?.trim()?.ifEmpty { null } ?: shortAccount(account)

    /** Up to two letters: "Ana Lee" -> "AL", unnamed -> from the id. */
    fun initials(
        account: String,
        name: String?,
    ): String {
        val words = (name ?: "").split(Regex("\\s+")).filter { it.isNotEmpty() }
        return when {
            words.size >= 2 -> "${words[0].first()}${words[1].first()}".uppercase()
            words.size == 1 -> words[0].take(2).uppercase()
            else -> account.take(2).uppercase()
        }
    }

    /** A hue (0–359) from the ACCOUNT, so renaming yourself keeps your colour. */
    fun avatarHue(account: String): Int {
        var h = 0u
        for (c in account) h = h * 31u + c.code.toUInt()
        return (h % 360u).toInt()
    }

    /**
     * Who has taken part but has not posted among [posted], by name. Shown for today only: for a
     * past day the contract cannot tell "skipped" from "had not joined yet".
     */
    fun notYetPosted(
        members: List<MemberView>,
        posted: List<UpdateView>,
    ): List<MemberView> {
        val done = posted.map { it.author }.toSet()
        return members.filter { it.account !in done }.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { displayName(it.account, it.name) })
    }
}
