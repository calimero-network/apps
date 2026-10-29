package network.calimero.sign.core

import network.calimero.sign.generated.DocumentStatus
import network.calimero.sign.generated.PermissionLevel
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/** Words and numbers as the screens show them. (Swift `SignFormat`.) */
object SignFormat {
    /** A contract timestamp (nanoseconds) as epoch milliseconds. */
    fun millis(nanos: ULong): Long = (nanos / 1_000_000uL).toLong()

    /** "Today, 14:05", "Yesterday", or "12 Mar 2026". */
    fun whenText(
        nanos: ULong,
        now: Long = System.currentTimeMillis(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val date = Date(millis(nanos))
        val day = Calendar.getInstance().apply { time = date }
        val today = Calendar.getInstance().apply { timeInMillis = now }

        fun sameDay(
            a: Calendar,
            b: Calendar,
        ) = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
        if (sameDay(day, today)) return "Today, ${DateFormat.getTimeInstance(DateFormat.SHORT, locale).format(date)}"
        val yesterday = (today.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -1) }
        if (sameDay(day, yesterday)) return "Yesterday"
        return DateFormat.getDateInstance(DateFormat.MEDIUM, locale).format(date)
    }

    fun status(status: DocumentStatus): String =
        when (status) {
            DocumentStatus.FullySigned -> "Signed"
            DocumentStatus.PartiallySigned -> "In progress"
            DocumentStatus.Pending -> "Awaiting signatures"
        }

    fun size(bytes: ULong): String {
        val b = bytes.toDouble()
        return when {
            b < 1024 -> "$bytes bytes"
            b < 1024 * 1024 -> String.format(Locale.US, "%.0f KB", b / 1024)
            else -> String.format(Locale.US, "%.1f MB", b / (1024 * 1024))
        }
    }

    fun progress(entry: DocumentEntry): String {
        val (signed, required) = entry.progress
        return if (required == 0) status(entry.document.status) else "$signed of $required signed"
    }

    fun level(level: PermissionLevel): Pair<String, String> =
        when (level) {
            PermissionLevel.Admin -> "Admin" to "Everything a signer can do, plus managing documents and people."
            PermissionLevel.Sign -> "Signer" to "Can sign the documents in this agreement."
            PermissionLevel.Read -> "Viewer" to "Can open the agreement and read its documents."
        }

    fun initials(
        name: String?,
        id: String,
    ): String {
        val clean = name?.trim().orEmpty()
        if (clean.isNotEmpty()) {
            val letters =
                clean
                    .split(' ', '-', '_')
                    .filter { it.isNotEmpty() }
                    .take(2)
                    .joinToString("") { it.first().uppercase() }
            return letters.ifEmpty { clean.take(1).uppercase() }
        }
        return SignIds.hex(id).take(2).uppercase()
    }

    /** A stable index into the avatar tones (FNV-1a, as on iOS). */
    fun tone(
        seed: String,
        tones: Int = 6,
    ): Int {
        var hash = 2_166_136_261u
        for (byte in seed.encodeToByteArray()) {
            hash = hash xor (byte.toUByte().toUInt())
            hash *= 16_777_619u
        }
        return abs((hash % tones.toUInt()).toInt())
    }

    fun fileName(
        name: String,
        signed: Boolean,
    ): String {
        var base = name.trim().ifEmpty { "document" }.replace("/", "-")
        if (!base.lowercase().endsWith(".pdf")) base += ".pdf"
        return if (signed) "signed-$base" else base
    }
}
