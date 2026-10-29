package network.calimero.sheets.core

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.sheets.generated.Cell
import network.calimero.sheets.generated.Chart
import network.calimero.sheets.generated.Comment
import network.calimero.sheets.generated.Member
import network.calimero.sheets.generated.Protection
import network.calimero.sheets.generated.Sheet
import network.calimero.sheets.generated.SheetLayout
import network.calimero.sheets.generated.SheetView
import network.calimero.sheets.generated.SheetsClient
import kotlin.coroutines.cancellation.CancellationException

/** A comment thread on a cell: the root comment and its replies, oldest first. */
data class CommentThread(
    val root: Comment,
    val replies: List<Comment>,
) {
    val id: String get() = root.id
}

/** A chart placed on the open sheet. */
data class PlacedChart(
    val id: String,
    val title: String,
    /** `bar` or `line`. */
    val kind: String,
    /** `A1:C6`. */
    val range: String,
    val model: ChartModel,
)

/** Everything the spreadsheet screen shows. */
data class SpreadsheetState(
    val phase: LoadPhase = LoadPhase.Idle,
    val projectName: String = "",
    val sheets: List<Sheet> = emptyList(),
    val activeSheetId: String? = null,
    val grid: SheetGrid? = null,
    val comments: List<Comment> = emptyList(),
    val charts: List<Chart> = emptyList(),
    val members: List<Member> = emptyList(),
    val selfId: String? = null,
    val selected: GridPos? = null,
    /** A failure while the content stayed on screen. */
    val notice: String? = null,
) {
    val activeSheet: Sheet? get() = sheets.firstOrNull { it.id == activeSheetId }

    /** The person's role (`owner`, `editor`, `commenter`, `viewer`); not yet on the roster edits, as on the web. */
    val role: String get() = members.firstOrNull { it.id == selfId }?.role?.ifEmpty { null } ?: "editor"

    val canComment: Boolean get() = role in setOf("owner", "editor", "commenter")
}

/**
 * One spreadsheet (workbook): its tabs, the open tab's grid, charts and comments, and the one edit
 * the phone makes, a cell's plain value.
 *
 * Values come from the contract: `get_all_cells` returns each cell's computed value, evaluated on
 * the node by the same Rust engine the web compiles to WASM (`recalc-wasm`). The web uses that WASM
 * copy only to echo an edit before the node answers; the phone shows the node's values and re-reads
 * after a write, so nothing is recalculated on the phone.
 */
@Suppress("TooManyFunctions")
class SpreadsheetModel(
    private val client: SheetsClient,
    val contextId: String,
) {
    private val _state = MutableStateFlow(SpreadsheetState())
    val state: StateFlow<SpreadsheetState> = _state.asStateFlow()

    private var cells: List<Cell> = emptyList()
    private var layouts: Map<String, SheetLayout> = emptyMap()
    private var views: Map<String, SheetView> = emptyMap()
    private var styles: Map<String, Map<String, String>> = emptyMap()
    private var protections: List<Protection> = emptyList()
    private val orders = mutableMapOf<String, SheetOrder>()

    // ---- loading ---------------------------------------------------------------------------------

    suspend fun load() {
        val s = _state.value
        if (s.sheets.isEmpty() && cells.isEmpty()) update { copy(phase = LoadPhase.Loading) }
        try {
            coroutineScope {
                val sheets = async { client.listSheets() }
                val all = async { client.getAllCells() }
                val l = async { client.getLayouts() }
                val v = async { client.getSheetViews() }
                val st = async { client.getStyles() }
                val ch = async { client.getCharts() }
                val co = async { client.getComments() }
                val m = async { client.getMembers() }
                val p = async { client.getProject() }
                val me = async { client.whoami() }
                val pr = async { client.getProtections() }
                cells = all.await()
                layouts = l.await().associateBy { it.sheetId }
                orders.clear()
                views = v.await().associateBy { it.sheetId }
                styles = st.await().associate { key(it.sheetId, it.rowId, it.colId) to it.style }
                protections = pr.await()
                val sorted = sheets.await().sortedBy { it.position }
                val charts = ch.await()
                val comments = co.await()
                val members = m.await()
                val project = p.await()
                val self = me.await()
                update {
                    copy(
                        sheets = sorted,
                        charts = charts,
                        comments = comments,
                        members = members,
                        projectName = project.name,
                        selfId = self,
                        activeSheetId = activeSheetId?.takeIf { id -> sorted.any { it.id == id } } ?: sorted.firstOrNull()?.id,
                    )
                }
            }
            rebuild()
            update { copy(phase = LoadPhase.Loaded) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val text = errorText(e)
            update { if (sheets.isEmpty() && cells.isEmpty()) copy(phase = LoadPhase.Failed(text)) else copy(notice = text) }
        }
    }

    fun selectSheet(id: String) {
        val s = _state.value
        if (id == s.activeSheetId || s.sheets.none { it.id == id }) return
        update { copy(activeSheetId = id, selected = null) }
        rebuild()
    }

    fun select(pos: GridPos?) = update { copy(selected = pos) }

    fun dismissNotice() = update { copy(notice = null) }

    /** A sheet's row and column order. */
    fun order(sheetId: String): SheetOrder = orders.getOrPut(sheetId) { SheetOrder(layouts[sheetId]) }

    @Suppress("CyclomaticComplexMethod", "LoopWithTooManyJumpStatements")
    private fun rebuild() {
        val s = _state.value
        val sheetId =
            s.activeSheetId ?: run {
                update { copy(grid = null) }
                return
            }
        val order = order(sheetId)
        val placed = mutableMapOf<GridPos, GridCell>()
        for (c in cells) {
            if (c.sheetId != sheetId) continue
            val row = order.rows.position(c.rowId) ?: continue
            val col = order.cols.position(c.colId) ?: continue
            val pos = GridPos(row, col)
            placed[pos] = gridCell(pos, c.rowId, c.colId, c, sheetId)
        }
        // A styled cell with no value still draws (a fill, a colour).
        for ((k, style) in styles) {
            val parts = k.split('|')
            if (parts.size != 3 || parts[0] != sheetId) continue
            val row = order.rows.position(parts[1]) ?: continue
            val col = order.cols.position(parts[2]) ?: continue
            val pos = GridPos(row, col)
            if (pos !in placed && !CellLook.of(style).isPlain) placed[pos] = gridCell(pos, parts[1], parts[2], null, sheetId)
        }
        val commented = mutableSetOf<GridPos>()
        for (c in s.comments) {
            if (c.sheetId != sheetId || c.parent.isNotEmpty() || c.resolved) continue
            val row = order.rows.position(c.rowId) ?: continue
            val col = order.cols.position(c.colId) ?: continue
            commented += GridPos(row, col)
        }
        val view = views[sheetId]
        val grid =
            SheetGrid(
                sheetId,
                order,
                placed,
                view?.sizes.orEmpty(),
                view?.frozenRows?.toInt() ?: 0,
                view?.frozenCols?.toInt() ?: 0,
                commented,
            )
        update { copy(grid = grid) }
    }

    private fun gridCell(
        pos: GridPos,
        rowId: String,
        colId: String,
        cell: Cell?,
        sheetId: String,
    ): GridCell {
        val raw = cell?.rawValue.orEmpty()
        val computed = cell?.computedValue.orEmpty()
        val format = cell?.format.orEmpty()
        return GridCell(
            pos = pos,
            rowId = rowId,
            colId = colId,
            raw = displayRaw(raw, sheetId),
            computed = computed,
            format = format,
            text = CellFormat.display(computed, format),
            look = CellLook.of(styles[key(sheetId, rowId, colId)].orEmpty()),
            lastEditor = cell?.lastEditor.orEmpty(),
            lastEditedAt = cell?.lastEditedAt?.toLong() ?: 0L,
        )
    }

    /** A stored raw value as the formula bar shows it. */
    fun displayRaw(
        raw: String,
        sheetId: String,
    ): String {
        if (!raw.startsWith("=")) return raw
        val sheets = _state.value.sheets
        return FormulaDisplay.display(raw, sheetId, { order(it) }, { id -> sheets.firstOrNull { it.id == id }?.name })
    }

    // ---- cells -----------------------------------------------------------------------------------

    /** The cell at a position (an empty one when nothing is stored there). */
    fun cellAt(pos: GridPos): GridCell? {
        val grid = _state.value.grid ?: return null
        grid.cells[pos]?.let { return it }
        val rowId = grid.order.rows.idAt(pos.row) ?: return null
        val colId = grid.order.cols.idAt(pos.col) ?: return null
        return gridCell(pos, rowId, colId, null, grid.sheetId)
    }

    /** Why the person cannot change this cell's value here, or null when they can. */
    @Suppress("ReturnCount")
    fun editBlock(pos: GridPos): String? {
        val s = _state.value
        val sheet = s.activeSheet ?: return "Open a sheet first."
        val cell = cellAt(pos) ?: return "Open a sheet first."
        if (sheet.linkedFrom.isNotEmpty()) return "This sheet is linked from ${sheet.linkedFrom}, so it is read-only here."
        if (s.role == "viewer") return "You are a viewer in this workbook."
        if (s.role == "commenter") return "You are a commenter in this workbook."
        if (cell.isFormula) return "This cell is a formula. Formulas are written in the web app."
        val p = protectionAt(pos, sheet.id) ?: return null
        return if (p.description.isEmpty()) "This range is protected." else "Protected: ${p.description}"
    }

    private fun protectionAt(
        pos: GridPos,
        sheetId: String,
    ): Protection? {
        val s = _state.value
        val o = order(sheetId)
        return protections.firstOrNull { p ->
            if (p.sheetId != sheetId || s.role == "owner" || (s.selfId != null && s.selfId in p.editors)) return@firstOrNull false
            if (p.topRowId.isEmpty() && p.leftColId.isEmpty() && p.bottomRowId.isEmpty() && p.rightColId.isEmpty()) {
                return@firstOrNull true
            }
            val t = o.rows.position(p.topRowId) ?: return@firstOrNull false
            val l = o.cols.position(p.leftColId) ?: return@firstOrNull false
            val b = o.rows.position(p.bottomRowId) ?: return@firstOrNull false
            val r = o.cols.position(p.rightColId) ?: return@firstOrNull false
            pos.row in minOf(t, b)..maxOf(t, b) && pos.col in minOf(l, r)..maxOf(l, r)
        }
    }

    /**
     * Set a cell's plain value (empty clears it). The node recalculates; the grid shows the typed
     * value until the re-read brings the result back.
     */
    suspend fun setValue(
        text: String,
        pos: GridPos,
    ) {
        editBlock(pos)?.let { throw SheetsException(it) }
        val value = text.trim('\n', '\r')
        if (value.startsWith("=")) throw SheetsException("Formulas are written in the web app. Enter a plain value here.")
        val sheetId = _state.value.activeSheetId ?: return
        val cell = cellAt(pos) ?: return

        fun same(c: Cell) = c.sheetId == sheetId && c.rowId == cell.rowId && c.colId == cell.colId
        if (value.isEmpty()) {
            client.clearCell(sheetId, cell.rowId, cell.colId)
            cells = cells.filterNot(::same)
        } else {
            client.setCell(sheetId, cell.rowId, cell.colId, value)
            val previous = cells.firstOrNull(::same)
            cells = cells.filterNot(::same) +
                Cell(
                    id = previous?.id ?: key(sheetId, cell.rowId, cell.colId),
                    sheetId = sheetId,
                    rowId = cell.rowId,
                    colId = cell.colId,
                    rawValue = value,
                    computedValue = value,
                    format = previous?.format.orEmpty(),
                    updatedAt = previous?.updatedAt ?: 0uL,
                    lastEditor = _state.value.selfId.orEmpty(),
                    lastEditedAt = previous?.lastEditedAt ?: 0uL,
                )
        }
        rebuild()
        load()
    }

    // ---- charts ----------------------------------------------------------------------------------

    /** The open sheet's charts, read from the grid's values. */
    fun sheetCharts(): List<PlacedChart> {
        val s = _state.value
        val sheetId = s.activeSheetId ?: return emptyList()
        val grid = s.grid ?: return emptyList()
        val o = order(sheetId)
        return s.charts.mapNotNull { chart ->
            val c = chart.chart
            if (c.sheetId != sheetId) return@mapNotNull null
            val t = o.rows.position(c.topRowId) ?: return@mapNotNull null
            val l = o.cols.position(c.leftColId) ?: return@mapNotNull null
            val b = o.rows.position(c.bottomRowId) ?: return@mapNotNull null
            val r = o.cols.position(c.rightColId) ?: return@mapNotNull null
            val top = minOf(t, b)
            val bottom = maxOf(t, b)
            val left = minOf(l, r)
            val right = maxOf(l, r)
            val model = ChartModel.of(top, left, bottom, right) { row, col -> grid.cells[GridPos(row, col)]?.computed.orEmpty() }
            PlacedChart(
                id = chart.id,
                title = c.title.trim().ifEmpty { model.series.joinToString(", ") { it.name } },
                kind = if (c.kind == "line") "line" else "bar",
                range = "${A1.cell(top, left)}:${A1.cell(bottom, right)}",
                model = model,
            )
        }
    }

    // ---- comments --------------------------------------------------------------------------------

    /** Threads on one cell of the open sheet, open ones first. */
    fun threadsAt(pos: GridPos): List<CommentThread> {
        val sheetId = _state.value.activeSheetId ?: return emptyList()
        val cell = cellAt(pos) ?: return emptyList()
        return threads { it.sheetId == sheetId && it.rowId == cell.rowId && it.colId == cell.colId }
    }

    /** Every unresolved thread in the workbook. */
    fun openThreads(): List<CommentThread> = threads { !it.resolved }

    private fun threads(include: (Comment) -> Boolean): List<CommentThread> {
        val all = _state.value.comments
        return all
            .filter { it.parent.isEmpty() && include(it) }
            .sortedWith(compareBy<Comment> { if (it.resolved) 1 else 0 }.thenBy { it.createdAt })
            .map { root -> CommentThread(root, all.filter { it.parent == root.id }.sortedBy { it.createdAt }) }
    }

    /** Where a comment sits: `B3`, or `Sheet 2!B3` on another tab; null when its cell is gone. */
    fun location(comment: Comment): String? {
        val s = _state.value
        val o = order(comment.sheetId)
        val row = o.rows.position(comment.rowId) ?: return null
        val col = o.cols.position(comment.colId) ?: return null
        val ref = A1.cell(row, col)
        if (comment.sheetId == s.activeSheetId) return ref
        val name = s.sheets.firstOrNull { it.id == comment.sheetId }?.name ?: return null
        return A1.sheetPrefix(name) + ref
    }

    /** Open a comment's cell: its tab, then the cell. */
    fun reveal(comment: Comment) {
        selectSheet(comment.sheetId)
        val o = order(comment.sheetId)
        val row = o.rows.position(comment.rowId) ?: return
        val col = o.cols.position(comment.colId) ?: return
        select(GridPos(row, col))
    }

    suspend fun addComment(
        text: String,
        pos: GridPos,
    ) {
        val body = text.trim()
        val sheetId = _state.value.activeSheetId
        val cell = cellAt(pos)
        if (body.isEmpty() || sheetId == null || cell == null) return
        client.addComment(sheetId, cell.rowId, cell.colId, body, "")
        load()
    }

    suspend fun reply(
        thread: CommentThread,
        text: String,
    ) {
        val body = text.trim()
        if (body.isEmpty()) return
        val r = thread.root
        client.addComment(r.sheetId, r.rowId, r.colId, body, r.id)
        load()
    }

    suspend fun setResolved(
        thread: CommentThread,
        resolved: Boolean,
    ) {
        client.setCommentResolved(thread.root.id, resolved)
        load()
    }

    suspend fun editComment(
        comment: Comment,
        text: String,
    ) {
        val body = text.trim()
        if (body.isEmpty()) return
        client.editComment(comment.id, body)
        load()
    }

    suspend fun deleteComment(comment: Comment) {
        client.deleteComment(comment.id)
        load()
    }

    fun isMine(comment: Comment): Boolean = comment.author == _state.value.selfId

    // ---- people ----------------------------------------------------------------------------------

    /** "You", a member's nickname, else a short key. */
    fun nameOf(memberId: String): String {
        val s = _state.value
        if (memberId == s.selfId) return "You"
        val nick =
            s.members
                .firstOrNull { it.id == memberId }
                ?.nickname
                ?.trim()
                .orEmpty()
        return nick.ifEmpty { SheetsFormat.truncateKey(memberId) }
    }

    /** "Edited by Ana, 5 min ago", or null when nobody is recorded. */
    fun editedBy(cell: GridCell): String? {
        if (cell.lastEditor.isEmpty()) return null
        val whenText = SheetsFormat.ago(cell.lastEditedAt)
        return if (whenText.isEmpty()) "Edited by ${nameOf(cell.lastEditor)}" else "Edited by ${nameOf(cell.lastEditor)}, $whenText"
    }

    private inline fun update(change: SpreadsheetState.() -> SpreadsheetState) {
        _state.value = _state.value.change()
    }

    companion object {
        fun key(
            sheetId: String,
            rowId: String,
            colId: String,
        ): String = "$sheetId|$rowId|$colId"

        /** A contract refusal in plain words. */
        fun errorText(e: Throwable): String {
            val text = SheetsFormat.errorText(e)
            return if (text.contains("uninitiali", ignoreCase = true)) {
                "This spreadsheet has not reached the relay yet. It syncs from a member who is online."
            } else {
                text
            }
        }
    }
}
