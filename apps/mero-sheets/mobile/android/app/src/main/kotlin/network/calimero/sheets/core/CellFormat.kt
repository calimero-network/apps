package network.calimero.sheets.core

import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale

/**
 * A cell's computed value as shown, by its format keyword. The twin of
 * `app/src/spreadsheet/format.ts`: `number[:dp]`, `currency[:CODE[:dp]]`, `percent[:dp]`,
 * `date[:us|eu|long]`, `text`. Anything that is not a number (or a date, for `date`) is shown
 * unchanged, so `#REF!` passes through.
 */
object CellFormat {
    private const val MAX_DECIMALS = 10
    private const val CODE_LENGTH = 3
    private const val ISO_DATE_LENGTH = 10

    data class Parts(
        val kind: String,
        val code: String,
        val decimals: Int,
        val style: String,
    )

    fun parse(format: String): Parts {
        val bits = format.trim().split(':')
        val kind = bits.getOrElse(0) { "" }
        val a = bits.getOrElse(1) { "" }
        val b = bits.getOrElse(2) { "" }

        fun digits(
            s: String,
            fallback: Int,
        ) = s.toIntOrNull()?.takeIf { it in 0..MAX_DECIMALS } ?: fallback
        return when (kind) {
            "number" -> Parts(kind, "", digits(a, 2), "")
            "currency" -> Parts(kind, a.ifEmpty { "USD" }.uppercase(), digits(b, 2), "")
            "percent" -> Parts(kind, "", digits(a, 0), "")
            "date" -> Parts(kind, "", 0, a)
            else -> Parts(kind, "", 0, "")
        }
    }

    @Suppress("ReturnCount")
    fun display(
        computed: String,
        format: String,
    ): String {
        val p = parse(format)
        when (p.kind) {
            "", "general", "text" -> return computed
            "date" -> {
                val d = parseDate(computed) ?: return computed
                return when (p.style) {
                    "us" -> d.format(DateTimeFormatter.ofPattern("MM/dd/yyyy"))
                    "eu" -> d.format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
                    "long" -> d.format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.UK))
                    else -> d.format(DateTimeFormatter.ISO_LOCAL_DATE)
                }
            }
        }
        val n = number(computed) ?: return computed
        val f = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US))
        f.minimumFractionDigits = p.decimals
        f.maximumFractionDigits = p.decimals
        f.roundingMode = RoundingMode.HALF_UP
        return when (p.kind) {
            "number" -> f.format(n)
            "percent" -> f.format(n * 100) + "%"
            "currency" -> currency(n, p)
            else -> computed
        }
    }

    private fun currency(
        n: Double,
        p: Parts,
    ): String {
        val plain = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US))
        plain.minimumFractionDigits = p.decimals
        plain.maximumFractionDigits = p.decimals
        plain.roundingMode = RoundingMode.HALF_UP
        val known = p.code.length == CODE_LENGTH && runCatching { Currency.getInstance(p.code) }.isSuccess
        if (!known) return "${plain.format(n)} ${p.code}"
        val f = NumberFormat.getCurrencyInstance(Locale.US) as DecimalFormat
        f.currency = Currency.getInstance(p.code)
        val symbols = f.decimalFormatSymbols
        symbols.currencySymbol = Currency.getInstance(p.code).getSymbol(Locale.US)
        f.decimalFormatSymbols = symbols
        f.minimumFractionDigits = p.decimals
        f.maximumFractionDigits = p.decimals
        f.roundingMode = RoundingMode.HALF_UP
        return f.format(n)
    }

    /** The format in words, for the cell sheet ("Currency (EUR, 2 decimals)"). */
    fun describe(format: String): String {
        val p = parse(format)

        fun places(n: Int) = if (n == 1) "1 decimal" else "$n decimals"
        return when (p.kind) {
            "", "general" -> "Automatic"
            "text" -> "Plain text"
            "number" -> "Number (${places(p.decimals)})"
            "currency" -> "Currency (${p.code}, ${places(p.decimals)})"
            "percent" -> "Percent (${places(p.decimals)})"
            "date" ->
                when (p.style) {
                    "us" -> "Date (MM/DD/YYYY)"
                    "eu" -> "Date (DD/MM/YYYY)"
                    "long" -> "Date (long)"
                    else -> "Date (YYYY-MM-DD)"
                }
            else -> format
        }
    }

    /** ISO dates and date-times (`2024-03-05`, `2024-03-05T10:00:00Z`), as `Date.parse` reads them. */
    fun parseDate(text: String): LocalDate? {
        val s = text.trim()
        if (s.length < ISO_DATE_LENGTH) return null
        if (s.length == ISO_DATE_LENGTH) return runCatching { LocalDate.parse(s) }.getOrNull()
        return runCatching { OffsetDateTime.parse(s).withOffsetSameInstant(ZoneOffset.UTC).toLocalDate() }.getOrNull()
            ?: runCatching { Instant.parse(s).atOffset(ZoneOffset.UTC).toLocalDate() }.getOrNull()
    }

    /** Whether a value reads as a number (for alignment and charts). */
    fun number(text: String): Double? {
        val t = text.trim()
        if (t.isEmpty()) return null
        if (t.any { it.isLetter() && it != 'e' && it != 'E' }) return null
        return t.toDoubleOrNull()?.takeIf { it.isFinite() }
    }
}

/**
 * A cell's own style, as the contract stores it (one value per field) and the web grid draws it
 * (`app/src/spreadsheet/styling.ts`).
 */
data class CellLook(
    val bold: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val strike: Boolean = false,
    /** `#rrggbb` text colour, as 0xRRGGBB. */
    val color: Int? = null,
    /** `#rrggbb` fill, as 0xRRGGBB. */
    val fill: Int? = null,
    /** `left`, `center` or `right`; null is the default (left). */
    val align: String? = null,
    val wrap: Boolean = false,
) {
    val isPlain: Boolean get() = this == CellLook()

    companion object {
        private const val SHORT_HEX = 3
        private const val LONG_HEX = 6

        fun of(style: Map<String, String>): CellLook =
            CellLook(
                bold = !style["bold"].isNullOrEmpty(),
                italic = !style["italic"].isNullOrEmpty(),
                underline = !style["underline"].isNullOrEmpty(),
                strike = !style["strike"].isNullOrEmpty(),
                wrap = !style["wrap"].isNullOrEmpty(),
                color = style["color"]?.let(::hex),
                fill = style["fill"]?.let(::hex),
                align = style["align"]?.takeIf { it in setOf("left", "center", "right") },
            )

        /** `#rgb` or `#rrggbb` → 0xRRGGBB. */
        fun hex(text: String): Int? {
            var s = text.trim()
            if (!s.startsWith("#")) return null
            s = s.substring(1)
            if (s.length == SHORT_HEX) s = s.map { "$it$it" }.joinToString("")
            if (s.length != LONG_HEX) return null
            return s.toIntOrNull(16)
        }
    }
}
