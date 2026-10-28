package network.calimero.calendar.data

import java.time.Instant

/** The app's package on the registry; invitation links and founding name it. */
object CalendarConstants {
    const val PACKAGE_NAME = "com.calimero.mero-calendar"

    /** The web app's palette (`color-picker/colors.ts`). */
    val PALETTE =
        listOf(
            "#3b6fe0",
            "#2aa775",
            "#c8472b",
            "#9b4dca",
            "#0f7c8c",
            "#d98324",
            "#c2356f",
            "#5566c4",
            "#6b7280",
            "#1f9e54",
        )
    val DEFAULT_COLOR = PALETTE.first()

    const val TYPE_TIMED = "event"
    const val TYPE_ALL_DAY = "long-event"
    const val LOCAL_PREFIX = "local-"
}

/** One event as the screens draw it: shared (from the contract) or private (on this device). */
data class CalEvent(
    val id: String,
    val title: String,
    val description: String,
    /** The owner's account, 64 hex. */
    val owner: String,
    val start: Instant,
    val end: Instant,
    val allDay: Boolean,
    val color: String,
    /** Invited accounts, 64 hex. */
    val peers: List<String>,
    val isPrivate: Boolean,
) {
    /** Kept on this device ([PrivateEventStore]), never sent anywhere. */
    val isLocal: Boolean get() = id.startsWith(CalendarConstants.LOCAL_PREFIX)

    fun isOwnedBy(account: String?): Boolean = isLocal || (account != null && owner.equals(account, ignoreCase = true))
}

/** A team member with the name they set in this calendar. */
data class CalMember(
    val id: String,
    val name: String,
)

/** A short form of an account id, for someone with no name yet. */
fun shortId(id: String): String = if (id.length > 8) id.take(6) + "…" else id
