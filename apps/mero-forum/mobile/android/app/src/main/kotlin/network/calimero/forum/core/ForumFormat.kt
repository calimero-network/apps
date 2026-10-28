package network.calimero.forum.core

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** How posts, people and times are written. Swift `ForumFormat` says the same. */
object ForumFormat {
    private const val NANOS_THRESHOLD = 100_000_000_000_000uL
    private const val NANOS_PER_MILLI = 1_000_000uL
    private const val MINUTE = 60L
    private const val HOUR = 60L
    private const val DAY = 24L
    private const val WEEK = 7L
    private const val SHORT_LIMIT = 10
    private const val HEAD = 6
    private const val TAIL = 4
    private const val THOUSAND = 1_000L
    private const val MILLION = 1_000_000L
    private const val TENTHS = 10L
    private const val HASH_MULTIPLIER = 31u
    private const val ACCOUNT_LENGTH = 64

    /** The contract stamps nanoseconds; anything past 10^14 cannot be milliseconds (the web's `toMs`). */
    fun epochMillis(stamp: ULong): Long = (if (stamp > NANOS_THRESHOLD) stamp / NANOS_PER_MILLI else stamp).toLong()

    /** The timeline's age: "now", "5m", "3h", "2d", then "Mar 4" (and the year once it is not this one). */
    fun age(
        stamp: ULong,
        nowMillis: Long = System.currentTimeMillis(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val then = epochMillis(stamp)
        val seconds = maxOf(0L, (nowMillis - then) / THOUSAND)
        val minutes = seconds / MINUTE
        val hours = minutes / HOUR
        val days = hours / DAY
        return when {
            seconds < MINUTE -> "now"
            minutes < HOUR -> "${minutes}m"
            hours < DAY -> "${hours}h"
            days < WEEK -> "${days}d"
            else -> {
                val date = Instant.ofEpochMilli(then).atZone(zone)
                val sameYear = date.year == Instant.ofEpochMilli(nowMillis).atZone(zone).year
                date.format(formatter(if (sameYear) "MMM d" else "MMM d, yyyy"))
            }
        }
    }

    /** The post page's stamp: "3:04 PM · Mar 4, 2026". */
    fun fullStamp(
        stamp: ULong,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val date = Instant.ofEpochMilli(epochMillis(stamp)).atZone(zone)
        return "${date.format(formatter("h:mm a"))} · ${date.format(formatter("MMM d, yyyy"))}"
    }

    private fun formatter(pattern: String): DateTimeFormatter = DateTimeFormatter.ofPattern(pattern, Locale.US)

    /** `3f9a1c…b2e0`: the account, short. Never instead of a name, always beside it. */
    fun shortAccount(account: String): String = if (account.length > SHORT_LIMIT) "${account.take(HEAD)}…${account.takeLast(TAIL)}" else account

    /** The handle under a name: `@3f9a1c…b2e0`. */
    fun handle(account: String): String = "@" + shortAccount(account)

    /** The name to show for an author: their chosen name, or the short id. */
    fun displayName(
        name: String,
        account: String,
    ): String = name.trim().ifEmpty { shortAccount(account) }

    /** One or two letters for an avatar. */
    fun initials(label: String): String {
        val words = label.split(' ', '\n', '\t').filter { it.isNotEmpty() }
        if (words.isEmpty()) return "?"
        return words.take(2).joinToString("") { it.first().toString() }.uppercase()
    }

    /** Which avatar tone a seed takes: the same stable hash as on iOS, so a person keeps one colour. */
    fun tone(
        seed: String,
        tones: Int = 6,
    ): Int {
        var hash = 0u
        for (byte in seed.toByteArray(Charsets.UTF_8)) hash = hash * HASH_MULTIPLIER + (byte.toInt() and 0xff).toUInt()
        return (hash % tones.toUInt()).toInt()
    }

    /** "1 reply" / "3 replies", and the like. */
    fun count(
        value: Int,
        singular: String,
        plural: String,
    ): String = "$value ${if (value == 1) singular else plural}"

    /** Counts the way a timeline shows them: 999, 1.2K, 12K, 1.3M. */
    fun compact(value: Long): String {
        val magnitude = kotlin.math.abs(value)
        val sign = if (value < 0) "-" else ""

        fun scaled(
            divisor: Long,
            suffix: String,
        ): String {
            val tenths = magnitude * TENTHS / divisor
            val text = if (tenths < TENTHS * TENTHS && tenths % TENTHS != 0L) "${tenths / TENTHS}.${tenths % TENTHS}" else "${tenths / TENTHS}"
            return sign + text + suffix
        }
        return when {
            magnitude >= MILLION -> scaled(MILLION, "M")
            magnitude >= THOUSAND -> scaled(THOUSAND, "K")
            else -> value.toString()
        }
    }

    /** Whether [text] looks like an account id (64 hex). */
    fun isAccountId(text: String): Boolean {
        val trimmed = text.trim().lowercase()
        return trimmed.length == ACCOUNT_LENGTH && trimmed.all { it in '0'..'9' || it in 'a'..'f' }
    }
}
