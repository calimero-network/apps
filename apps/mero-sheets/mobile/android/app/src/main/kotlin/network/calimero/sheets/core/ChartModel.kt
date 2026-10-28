package network.calimero.sheets.core

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow

/** One plotted column. [values] has one entry per label; null where the cell is not a number. */
data class ChartSeries(
    val name: String,
    val values: List<Double?>,
)

/**
 * What a chart plots, read from its range (`app/src/spreadsheet/chart.ts`): the first column labels
 * the points, each other column is a series (named by the first row when that row is text), up to
 * eight series. A one-column range is a single series labelled by row number.
 */
data class ChartModel(
    val labels: List<String>,
    val series: List<ChartSeries>,
    /** Columns past the eighth, left out. */
    val dropped: Int = 0,
) {
    val allValues: List<Double> get() = series.flatMap { it.values.filterNotNull() }

    companion object {
        const val MAX_SERIES = 8
        private const val BILLION = 1e9
        private const val MILLION = 1e6
        private const val EPSILON = 1e-9

        /** Rows `top..bottom`, columns `left..right` (positions), read through [valueAt]. */
        fun of(
            top: Int,
            left: Int,
            bottom: Int,
            right: Int,
            valueAt: (Int, Int) -> String,
        ): ChartModel {
            val single = left == right
            val seriesCols = if (single) listOf(left) else ((left + 1)..maxOf(left + 1, right)).toList()
            val header =
                bottom > top &&
                    seriesCols.all { c ->
                        val v = valueAt(top, c).trim()
                        v.isNotEmpty() && CellFormat.number(v) == null
                    }
            val first = top + if (header) 1 else 0
            val rows = if (first <= bottom) (first..bottom).toList() else emptyList()
            val kept = seriesCols.take(MAX_SERIES)
            return ChartModel(
                labels = rows.map { r -> if (single) (r + 1).toString() else valueAt(r, left).trim().ifEmpty { (r + 1).toString() } },
                series =
                    kept.map { c ->
                        ChartSeries(
                            name = if (header) valueAt(top, c).trim() else A1.column(c),
                            values = rows.map { CellFormat.number(valueAt(it, c)) },
                        )
                    },
                dropped = seriesCols.size - kept.size,
            )
        }

        /** Round tick values covering `[min, max]`, always including 0. */
        fun niceTicks(
            min: Double,
            max: Double,
            count: Int = 5,
        ): List<Double> {
            val lo = minOf(0.0, min)
            val hi = maxOf(0.0, max)
            if (lo == hi) return listOf(0.0, 1.0)
            val raw = (hi - lo) / count
            val mag = 10.0.pow(floor(log10(raw)))
            val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.firstOrNull { it >= raw } ?: (10 * mag)
            var t = floor(lo / step) * step
            val ticks = mutableListOf<Double>()
            while (t <= hi + step * EPSILON) {
                ticks += round12(t)
                t += step
            }
            if (ticks.last() < hi) ticks += round12(ticks.last() + step)
            return ticks
        }

        private fun round12(v: Double): Double = BigDecimal(v).round(java.math.MathContext(12)).toDouble()

        /** A tick or value as shown: thousands separated, compact past a million. */
        fun formatTick(n: Double): String {
            fun short(v: Double): String = BigDecimal(v).setScale(1, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
            val a = abs(n)
            if (a >= BILLION) return "${short(n / BILLION)}B"
            if (a >= MILLION) return "${short(n / MILLION)}M"
            val f = DecimalFormat("#,##0.##", DecimalFormatSymbols(Locale.US))
            f.roundingMode = RoundingMode.HALF_UP
            return f.format(n)
        }
    }
}
