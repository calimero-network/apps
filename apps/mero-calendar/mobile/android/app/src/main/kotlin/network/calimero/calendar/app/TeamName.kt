package network.calimero.calendar.app

import com.calimero.mero.app.MeroAppBackend

// Your name in a team (the web app's `@calimero-apps/names` `decideSelfName`): asked once, when
// you create the team or join it, and used by every calendar in it. The org's member metadata
// `{ name }` is the one record of it; a calendar copies it into its own roster (`setUsername`)
// without asking.

/** Your name in [org]: "" when it has none, null when it could not be read (asking now would re-ask). */
suspend fun MeroAppBackend.myTeamName(org: String): String? {
    val members = runCatching { listMembers(org) }.getOrNull() ?: return null
    return members
        .firstOrNull { it.identity == account }
        ?.name
        ?.trim()
        .orEmpty()
}

/** What to do about your name when a calendar in a team opens. */
sealed interface SelfName {
    /** The team's names could not be read: do nothing yet. */
    data object Wait : SelfName

    /** The team has your name: use it. */
    data class Use(
        val name: String,
    ) : SelfName

    /** No name on the team, but one from before (the calendar's roster, an older key): publish it, no prompt. */
    data class Adopt(
        val name: String,
    ) : SelfName

    /** No name anywhere: ask once, for the team. */
    data class Ask(
        val suggestion: String,
    ) : SelfName
}

/** Never asks when the team already has your name ([teamName] null: not read). */
fun decideSelfName(
    teamName: String?,
    fallbacks: List<String?>,
    suggestion: String,
): SelfName {
    val named = teamName?.trim().orEmpty()
    if (named.isNotEmpty()) return SelfName.Use(named)
    if (teamName == null) return SelfName.Wait
    val known = fallbacks.map { it?.trim().orEmpty() }.firstOrNull { it.isNotEmpty() }
    return if (known != null) SelfName.Adopt(known) else SelfName.Ask(suggestion)
}
