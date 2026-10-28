package network.calimero.sheets.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.sheets.core.ChartModel
import network.calimero.sheets.core.PlacedChart
import network.calimero.sheets.core.SpreadsheetModel
import network.calimero.sheets.core.SpreadsheetState

private const val PLOT_LEFT = 44f
private const val PLOT_BOTTOM = 28f
private const val PLOT_TOP = 12f
private const val PLOT_RIGHT = 12f
private const val BAR_MAX = 24f
private const val BAR_GAP = 2f
private const val BAR_SHARE = 0.8f
private const val LABEL_SPACE = 44f
private const val LABEL_CHARS = 8

/** The open sheet's charts, drawn natively from the grid's values. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChartsSheet(
    model: SpreadsheetModel,
    state: SpreadsheetState,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val charts = model.sheetCharts()
    val sheetName = state.activeSheet?.name
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Palette.ground) {
        SheetTitle(if (sheetName != null) "Charts · $sheetName" else "Charts", onDismiss)
        if (charts.isEmpty()) {
            Box(Modifier.fillMaxWidth().height(360.dp)) {
                EmptyState(
                    Icons.Outlined.BarChart,
                    "No charts on this sheet",
                    "Charts are made in the web app from a range of cells. They show here as the numbers change.",
                )
            }
        } else {
            LazyColumn(
                Modifier.fillMaxWidth().navigationBarsPadding(),
                contentPadding = PaddingValues(Palette.gutter),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                items(charts, key = { it.id }) { ChartCard(it) }
            }
        }
    }
}

/** A sheet's title bar: the title, and Done. */
@Composable
fun SheetTitle(
    title: String,
    onDone: () -> Unit,
) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Text(
            title,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            color = Palette.ink,
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 72.dp),
            maxLines = 1,
        )
        TextButton(onClick = onDone, modifier = Modifier.align(Alignment.CenterEnd)) { Text("Done", color = Palette.ink) }
    }
}

/** One chart: title, legend, the plot (bars or lines from zero), and its numbers on demand. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChartCard(chart: PlacedChart) {
    var showData by remember { mutableStateOf(false) }
    val m = chart.model
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(chart.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                Text("${if (chart.kind == "line") "Line" else "Bar"} chart · ${chart.range}", fontSize = 12.sp, color = Palette.text3)
            }
            TextButton(onClick = { showData = !showData }) {
                Text(if (showData) "Chart" else "Show data", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2)
            }
        }
        if (m.series.size >= 2 && !showData) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                m.series.forEachIndexed { i, s ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(Palette.series[i % Palette.series.size]))
                        Text(s.name, fontSize = 12.sp, color = Palette.text2)
                    }
                }
            }
        }
        if (showData) DataTable(m) else Plot(chart)
        if (m.dropped > 0) {
            Text(
                "${m.dropped} more column${if (m.dropped == 1) "" else "s"} not shown (a chart shows eight series).",
                fontSize = 12.sp,
                color = Palette.text3,
            )
        }
    }
}

@Suppress("LongMethod")
@Composable
private fun Plot(chart: PlacedChart) {
    val m = chart.model
    val measurer = rememberTextMeasurer()
    val values = m.allValues
    val ticks = ChartModel.niceTicks(values.minOrNull() ?: 0.0, values.maxOrNull() ?: 1.0)
    val lo = ticks.first()
    val hi = ticks.last()
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(220.dp)
            .semantics { contentDescription = "${if (chart.kind == "line") "Line" else "Bar"} chart: ${chart.title}" },
    ) {
        val d = density
        val left = PLOT_LEFT * d
        val top = PLOT_TOP * d
        val plotW = size.width - left - PLOT_RIGHT * d
        val plotH = size.height - top - PLOT_BOTTOM * d

        fun y(v: Double) = top + plotH - ((v - lo) / (hi - lo)).toFloat() * plotH
        val n = maxOf(m.labels.size, 1)
        val band = plotW / n

        fun x(i: Int) = left + band * i + band / 2
        val tickStyle = TextStyle(fontSize = 10.sp, fontFamily = FontFamily.Monospace, color = Palette.text3)
        for (t in ticks) {
            drawLine(if (t == 0.0) Palette.text3 else Palette.line, Offset(left, y(t)), Offset(left + plotW, y(t)), 1f * d)
            val layout = measurer.measure(AnnotatedString(ChartModel.formatTick(t)), tickStyle)
            drawText(layout, topLeft = Offset(left - 6 * d - layout.size.width, y(t) - layout.size.height / 2))
        }
        val every = maxOf(1, Math.ceil(n / maxOf(1.0, Math.floor((plotW / d / LABEL_SPACE).toDouble()))).toInt())
        m.labels.forEachIndexed { i, l ->
            if (i % every != 0) return@forEachIndexed
            val text = if (l.length > LABEL_CHARS) l.take(LABEL_CHARS - 1) + "…" else l
            val layout = measurer.measure(AnnotatedString(text), tickStyle.copy(fontFamily = FontFamily.Default))
            drawText(layout, topLeft = Offset(x(i) - layout.size.width / 2, top + plotH + 8 * d))
        }
        val zero = y(0.0)
        if (chart.kind == "line") {
            m.series.forEachIndexed { si, s ->
                val color = Palette.series[si % Palette.series.size]
                var path: Path? = null
                var count = 0

                fun flush() {
                    val p = path
                    if (p != null && count > 1) {
                        drawPath(p, color, style = Stroke(width = 2 * d, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                    path = null
                    count = 0
                }
                s.values.forEachIndexed { i, v ->
                    if (v == null) {
                        flush()
                    } else {
                        val p = path ?: Path().also { path = it }
                        if (count == 0) p.moveTo(x(i), y(v)) else p.lineTo(x(i), y(v))
                        count += 1
                    }
                }
                flush()
                s.values.indices.lastOrNull { s.values[it] != null }?.let { i ->
                    drawCircle(Palette.surface, 6 * d, Offset(x(i), y(s.values[i]!!)))
                    drawCircle(color, 4 * d, Offset(x(i), y(s.values[i]!!)))
                }
            }
        } else {
            val count = maxOf(m.series.size, 1)
            val barW = maxOf(2 * d, minOf(BAR_MAX * d, (band * BAR_SHARE) / count - BAR_GAP * d))
            m.series.forEachIndexed { si, s ->
                val color = Palette.series[si % Palette.series.size]
                s.values.forEachIndexed { i, v ->
                    if (v == null) return@forEachIndexed
                    val cx = x(i) + (si - (count - 1) / 2f) * (barW + BAR_GAP * d)
                    val yv = y(v)
                    val topY = minOf(yv, zero)
                    val h = kotlin.math.abs(zero - yv)
                    drawRoundRect(color, Offset(cx - barW / 2, topY), Size(barW, h), CornerRadius(minOf(4 * d, barW / 2, h)))
                }
            }
        }
    }
}

@Composable
private fun DataTable(m: ChartModel) {
    Row(Modifier.horizontalScroll(rememberScrollState())) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("", fontSize = 12.sp)
            HorizontalDivider(Modifier.width(1.dp), color = Palette.line)
            m.labels.forEach { Text(it, fontSize = 12.sp, color = Palette.text3) }
        }
        m.series.forEach { s ->
            Column(Modifier.padding(start = 14.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(s.name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.text3)
                HorizontalDivider(Modifier.width(1.dp), color = Palette.line)
                s.values.forEach { v ->
                    Text(v?.let(ChartModel::formatTick) ?: "—", fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = Palette.ink)
                }
            }
        }
    }
}
