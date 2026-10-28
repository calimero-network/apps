package network.calimero.sheets.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import network.calimero.sheets.core.A1
import network.calimero.sheets.core.CellLook
import network.calimero.sheets.core.GridPos
import network.calimero.sheets.core.SheetGrid
import kotlin.math.max

private const val MIN_SCALE = 0.5f
private const val MAX_SCALE = 3f
private const val HEADER_TINT = 0.45f
private const val RGB_MASK = 0xFFFFFF
private const val OPAQUE = 0xFF000000.toInt()
private const val CELL_PAD = 4f
private const val MARKER = 7f
private const val CELL_TEXT = 13f
private const val HEADER_TEXT = 11.5f
private const val REVEAL_MARGIN = 8f

/**
 * The spreadsheet grid: drag to scroll with a fling, pinch to zoom, frozen header row and column,
 * the sheet's frozen panes, column widths and row heights, and each cell's format and style. Only
 * the visible cells are drawn. Offsets and sizes are in unscaled dp, as on iOS (points).
 */
@Suppress("CyclomaticComplexMethod", "LongMethod")
@Composable
fun SheetGridView(
    grid: SheetGrid,
    selected: GridPos?,
    onSelect: (GridPos) -> Unit,
    onDoubleTap: (GridPos) -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current.density
    val haptics = LocalHapticFeedback.current
    val measurer = rememberTextMeasurer(cacheSize = 512)
    val scope = rememberCoroutineScope()
    var size by remember { mutableStateOf(IntSize.Zero) }
    var ox by remember(grid.sheetId) { mutableFloatStateOf(0f) }
    var oy by remember(grid.sheetId) { mutableFloatStateOf(0f) }
    var scale by remember { mutableFloatStateOf(1f) }
    var tapped by remember { mutableStateOf<GridPos?>(null) }
    var fling by remember { mutableStateOf<Job?>(null) }
    val hw = SheetGrid.ROW_HEADER_WIDTH.toFloat()
    val hh = SheetGrid.HEADER_HEIGHT.toFloat()

    fun maxX() = max(0f, hw + grid.totalWidth.toFloat() - size.width / density / scale)

    fun maxY() = max(0f, hh + grid.totalHeight.toFloat() - size.height / density / scale)

    fun clamp() {
        ox = ox.coerceIn(0f, maxX())
        oy = oy.coerceIn(0f, maxY())
    }

    /** The cell under a point (px), or null over the headers. */
    fun hit(p: Offset): GridPos? {
        val x = p.x / density / scale
        val y = p.y / density / scale
        if (x <= hw || y <= hh) return null
        val fx = (x - hw).toDouble()
        val fy = (y - hh).toDouble()
        val col = if (fx < grid.frozenWidth) grid.colAt(fx) else grid.colAt(fx + ox)
        val row = if (fy < grid.frozenHeight) grid.rowAt(fy) else grid.rowAt(fy + oy)
        return GridPos(row, col)
    }

    LaunchedEffect(selected, grid.sheetId) {
        val pos = selected ?: return@LaunchedEffect
        if (pos == tapped || pos.row >= grid.rowCount || pos.col >= grid.colCount) return@LaunchedEffect
        val viewW = size.width / density / scale
        val viewH = size.height / density / scale
        if (pos.col >= grid.frozenCols) {
            val left = grid.colOffsets[pos.col].toFloat()
            val right = grid.colOffsets[pos.col + 1].toFloat()
            val fixed = hw + grid.frozenWidth.toFloat()
            if (hw + left - ox < fixed) ox = left + hw - fixed
            if (hw + right - ox > viewW) ox = hw + right - viewW
        }
        if (pos.row >= grid.frozenRows) {
            val top = grid.rowOffsets[pos.row].toFloat()
            val bottom = grid.rowOffsets[pos.row + 1].toFloat()
            val fixed = hh + grid.frozenHeight.toFloat()
            if (hh + top - oy < fixed) oy = top + hh - fixed
            if (hh + bottom - oy > viewH - REVEAL_MARGIN) oy = hh + bottom - viewH + REVEAL_MARGIN
        }
        clamp()
    }

    Canvas(
        modifier
            .onSizeChanged {
                size = it
                clamp()
            }.semantics { contentDescription = "Spreadsheet grid. Tap a cell to see its value, double-tap to edit it." }
            .pointerInput(grid.sheetId) {
                detectTapGestures(
                    onTap = { p ->
                        hit(p)?.let {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            tapped = it
                            onSelect(it)
                        }
                    },
                    onDoubleTap = { p -> hit(p)?.let(onDoubleTap) },
                )
            }.pointerInput(grid.sheetId) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    fling?.cancel()
                    val tracker = VelocityTracker()
                    var moved = false
                    while (true) {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.isEmpty()) break
                        val zoom = event.calculateZoom()
                        val pan = event.calculatePan()
                        val centroid = event.calculateCentroid()
                        if (zoom != 1f) {
                            val next = (scale * zoom).coerceIn(MIN_SCALE, MAX_SCALE)
                            // Keep the content under the fingers where it is.
                            val cx = centroid.x / density
                            val cy = centroid.y / density
                            ox = (ox + cx / scale) - cx / next
                            oy = (oy + cy / scale) - cy / next
                            scale = next
                        }
                        if (pan != Offset.Zero) {
                            ox -= pan.x / density / scale
                            oy -= pan.y / density / scale
                        }
                        clamp()
                        if (pressed.size == 1) {
                            tracker.addPosition(pressed[0].uptimeMillis, pressed[0].position)
                        } else {
                            tracker.resetTracking()
                        }
                        if (pressed.any { it.positionChange() != Offset.Zero }) moved = true
                        if (moved) event.changes.forEach { if (it.positionChange() != Offset.Zero) it.consume() }
                    }
                    if (moved) {
                        val v = tracker.calculateVelocity()
                        fling =
                            scope.launch {
                                launch {
                                    Animatable(ox).animateDecay(-v.x / density / scale, exponentialDecay()) {
                                        ox = value.coerceIn(0f, maxX())
                                    }
                                }
                                launch {
                                    Animatable(oy).animateDecay(-v.y / density / scale, exponentialDecay()) {
                                        oy = value.coerceIn(0f, maxY())
                                    }
                                }
                            }
                    }
                }
            },
    ) {
        val k = density * scale
        drawRect(Palette.surface)
        val w = size.width / k
        val h = size.height / k
        val fw = grid.frozenWidth.toFloat()
        val fh = grid.frozenHeight.toFloat()

        fun cellRect(
            row: Int,
            col: Int,
        ): Rect {
            val x = hw + grid.colOffsets[col].toFloat() - if (col < grid.frozenCols) 0f else ox
            val y = hh + grid.rowOffsets[row].toFloat() - if (row < grid.frozenRows) 0f else oy
            return Rect(x * k, y * k, (x + grid.width(col).toFloat()) * k, (y + grid.height(row).toFloat()) * k)
        }

        val firstCol = grid.colAt((fw + ox).toDouble())
        val lastCol = grid.colAt((ox + w - hw).toDouble())
        val firstRow = grid.rowAt((fh + oy).toDouble())
        val lastRow = grid.rowAt((oy + h - hh).toDouble())
        val scrollCols = (firstCol..lastCol).filter { it >= grid.frozenCols }
        val scrollRows = (firstRow..lastRow).filter { it >= grid.frozenRows }
        val frozenCols = (0 until grid.frozenCols).toList()
        val frozenRows = (0 until grid.frozenRows).toList()

        fun region(
            left: Float,
            top: Float,
            width: Float,
            height: Float,
            rows: List<Int>,
            cols: List<Int>,
        ) {
            clipRect(left * k, top * k, (left + width) * k, (top + height) * k) {
                for (r in rows) for (c in cols) drawCell(grid, GridPos(r, c), cellRect(r, c), k, measurer)
            }
        }
        region(hw + fw, hh + fh, w, h, scrollRows, scrollCols)
        region(hw + fw, hh, w, fh, frozenRows, scrollCols)
        region(hw, hh + fh, fw, h, scrollRows, frozenCols)
        region(hw, hh, fw, fh, frozenRows, frozenCols)

        // Selection, clipped to its pane.
        selected?.takeIf { it.row < grid.rowCount && it.col < grid.colCount }?.let { sel ->
            val clipX = if (sel.col < grid.frozenCols) hw else hw + fw
            val clipY = if (sel.row < grid.frozenRows) hh else hh + fh
            clipRect(clipX * k, clipY * k, size.width.toFloat(), size.height.toFloat()) {
                val r = cellRect(sel.row, sel.col)
                val inset = k
                drawRect(
                    Palette.ink,
                    topLeft = Offset(r.left + inset, r.top + inset),
                    size = Size(r.width - 2 * inset, r.height - 2 * inset),
                    style = Stroke(width = 2 * k),
                )
            }
        }

        val headerStyle = TextStyle(fontSize = (HEADER_TEXT * scale).sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)

        fun colHeader(c: Int) {
            val cr = cellRect(0, c)
            val r = Rect(cr.left, 0f, cr.right, hh * k)
            val on = selected?.col == c
            drawRect(if (on) Palette.lime.copy(alpha = HEADER_TINT) else Palette.header, r.topLeft, r.size)
            gridLines(r, k)
            label(measurer, A1.column(c), r, headerStyle.copy(color = if (on) Palette.ink else Palette.text3))
        }

        fun rowHeader(rw: Int) {
            val cr = cellRect(rw, 0)
            val r = Rect(0f, cr.top, hw * k, cr.bottom)
            val on = selected?.row == rw
            drawRect(if (on) Palette.lime.copy(alpha = HEADER_TINT) else Palette.header, r.topLeft, r.size)
            gridLines(r, k)
            label(measurer, "${rw + 1}", r, headerStyle.copy(color = if (on) Palette.ink else Palette.text3))
        }
        clipRect((hw + fw) * k, 0f, size.width.toFloat(), hh * k) { scrollCols.forEach(::colHeader) }
        frozenCols.forEach(::colHeader)
        clipRect(0f, (hh + fh) * k, hw * k, size.height.toFloat()) { scrollRows.forEach(::rowHeader) }
        frozenRows.forEach(::rowHeader)

        // Corner, and the frozen-pane edges.
        val corner = Rect(0f, 0f, hw * k, hh * k)
        drawRect(Palette.header, corner.topLeft, corner.size)
        gridLines(corner, k)
        if (grid.frozenRows > 0) {
            drawLine(Palette.lineStrong, Offset(0f, (hh + fh) * k), Offset(size.width.toFloat(), (hh + fh) * k), 1.5f * k)
        }
        if (grid.frozenCols > 0) {
            drawLine(Palette.lineStrong, Offset((hw + fw) * k, 0f), Offset((hw + fw) * k, size.height.toFloat()), 1.5f * k)
        }
    }
}

private fun DrawScope.drawCell(
    grid: SheetGrid,
    pos: GridPos,
    r: Rect,
    k: Float,
    measurer: TextMeasurer,
) {
    val cell = grid.cells[pos]
    val look = cell?.look ?: CellLook()
    drawRect(look.fill?.let(::rgb) ?: Palette.surface, r.topLeft, r.size)
    gridLines(r, k)
    if (cell != null && cell.text.isNotEmpty()) {
        val decoration =
            listOfNotNull(
                TextDecoration.Underline.takeIf { look.underline },
                TextDecoration.LineThrough.takeIf { look.strike },
            )
        val style =
            TextStyle(
                fontFamily = FontFamily.Monospace,
                fontSize = (CELL_TEXT * k / density).sp,
                fontWeight = if (look.bold) FontWeight.Bold else FontWeight.Normal,
                fontStyle = if (look.italic) FontStyle.Italic else FontStyle.Normal,
                color = look.color?.let(::rgb) ?: Palette.ink,
                textDecoration = if (decoration.isEmpty()) null else TextDecoration.combine(decoration),
                textAlign =
                    when (look.align) {
                        "center" -> TextAlign.Center
                        "right" -> TextAlign.Right
                        else -> TextAlign.Left
                    },
            )
        val pad = CELL_PAD * k
        val inner = Rect(r.left + pad, r.top, r.right - pad, r.bottom)
        if (inner.width > 1 && inner.height > 1) {
            val text = if (look.wrap) cell.text else cell.text.replace('\n', ' ')
            val layout =
                measurer.measure(
                    AnnotatedString(text),
                    style,
                    overflow = TextOverflow.Ellipsis,
                    softWrap = look.wrap,
                    maxLines = if (look.wrap) Int.MAX_VALUE else 1,
                    constraints = Constraints(maxWidth = inner.width.toInt()),
                )
            val y = if (look.wrap) inner.top + 3 * k else inner.top + (inner.height - layout.size.height) / 2
            clipRect(inner.left, inner.top, inner.right, inner.bottom) { drawText(layout, topLeft = Offset(inner.left, y)) }
        }
    }
    if (pos in grid.commented) {
        val m = MARKER * k
        val path =
            Path().apply {
                moveTo(r.right - m, r.top)
                lineTo(r.right, r.top)
                lineTo(r.right, r.top + m)
                close()
            }
        drawPath(path, Palette.marker)
    }
}

private fun DrawScope.gridLines(
    r: Rect,
    k: Float,
) {
    val stroke = 0.5f * k
    drawLine(Palette.line, Offset(r.right, r.top), Offset(r.right, r.bottom), stroke)
    drawLine(Palette.line, Offset(r.left, r.bottom), Offset(r.right, r.bottom), stroke)
}

private fun DrawScope.label(
    measurer: TextMeasurer,
    text: String,
    r: Rect,
    style: TextStyle,
) {
    val layout = measurer.measure(AnnotatedString(text), style, maxLines = 1, constraints = Constraints(maxWidth = max(1, r.width.toInt())))
    drawText(layout, topLeft = Offset(r.left + (r.width - layout.size.width) / 2, r.top + (r.height - layout.size.height) / 2))
}

private fun rgb(hex: Int): Color = Color(OPAQUE or (hex and RGB_MASK))
