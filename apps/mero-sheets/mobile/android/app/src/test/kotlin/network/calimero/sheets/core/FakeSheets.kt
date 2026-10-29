package network.calimero.sheets.core

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import network.calimero.sheets.generated.Cell
import network.calimero.sheets.generated.CellStyle
import network.calimero.sheets.generated.Chart
import network.calimero.sheets.generated.Comment
import network.calimero.sheets.generated.Member
import network.calimero.sheets.generated.Project
import network.calimero.sheets.generated.Protection
import network.calimero.sheets.generated.Sheet
import network.calimero.sheets.generated.SheetLayout
import network.calimero.sheets.generated.SheetView

/**
 * The sheets contract in memory, behind `InMemoryAppBackend`'s recording contract. `computed` is
 * what the node's recalc would return; a plain value computes to itself.
 */
class FakeSheets(
    account: String = "ab".repeat(32),
) {
    val backend = InMemoryAppBackend(account = account)
    private val projects = mutableMapOf<String, String>()
    private val sheets = mutableMapOf<String, MutableList<Sheet>>()
    private val cells = mutableMapOf<String, MutableList<Cell>>()
    private val comments = mutableMapOf<String, MutableList<Comment>>()
    val charts = mutableMapOf<String, List<Chart>>()
    val styles = mutableMapOf<String, List<CellStyle>>()
    val views = mutableMapOf<String, List<SheetView>>()
    val layouts = mutableMapOf<String, List<SheetLayout>>()
    val members = mutableMapOf<String, List<Member>>()
    val protections = mutableMapOf<String, List<Protection>>()
    private var next = 0

    @Volatile var failWrites: Exception? = null

    init {
        backend.recording.handler = { call -> synchronized(this) { handle(call) } }
    }

    val account: String get() = backend.account

    @Synchronized fun seedSheet(
        id: String,
        name: String,
        position: Int = 0,
        linkedFrom: String = "",
        ctx: String,
    ) {
        sheets.getOrPut(ctx) { mutableListOf() } += Sheet(id, name, position.toUInt(), 1uL, linkedFrom)
    }

    @Synchronized fun seedCell(
        sheet: String,
        row: String,
        col: String,
        raw: String,
        computed: String = raw,
        format: String = "",
        ctx: String,
    ) {
        cells.getOrPut(ctx) { mutableListOf() } += Cell("$sheet|$row|$col", sheet, row, col, raw, computed, format, 1uL, account, 1uL)
    }

    @Synchronized fun seedProject(
        name: String,
        ctx: String,
    ) {
        projects[ctx] = name
    }

    @Synchronized fun cell(
        sheet: String,
        row: String,
        col: String,
        ctx: String,
    ): Cell? = cells[ctx]?.firstOrNull { it.sheetId == sheet && it.rowId == row && it.colId == col }

    @Synchronized fun sheetNames(ctx: String): List<String> = sheets[ctx].orEmpty().map { it.name }

    @Synchronized fun project(ctx: String): String? = projects[ctx]

    @Suppress("CyclomaticComplexMethod", "LongMethod", "ReturnCount")
    private fun handle(call: RecordedContractCall): JsonElement? {
        val args = call.args as? JsonObject ?: JsonObject(emptyMap())

        fun s(key: String): String = (args[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

        val ctx = call.contextId
        if (call.path == RecordedContractCall.Path.EXECUTE) failWrites?.let { throw it }

        fun same(c: Cell) = c.sheetId == s("sheet_id") && c.rowId == s("row_id") && c.colId == s("col_id")
        when (call.method) {
            "list_sheets" -> return json.encodeToJsonElement(sheets[ctx].orEmpty())
            "get_all_cells" -> return json.encodeToJsonElement(cells[ctx].orEmpty())
            "get_layouts" -> return json.encodeToJsonElement(layouts[ctx].orEmpty())
            "get_sheet_views" -> return json.encodeToJsonElement(views[ctx].orEmpty())
            "get_styles" -> return json.encodeToJsonElement(styles[ctx].orEmpty())
            "get_charts" -> return json.encodeToJsonElement(charts[ctx].orEmpty())
            "get_comments" -> return json.encodeToJsonElement(comments[ctx].orEmpty())
            "get_members" -> return json.encodeToJsonElement(members[ctx].orEmpty())
            "get_protections" -> return json.encodeToJsonElement(protections[ctx].orEmpty())
            "get_project" -> return json.encodeToJsonElement(Project("p-$ctx", projects[ctx].orEmpty(), 1uL))
            "whoami" -> return JsonPrimitive(account)
            "init_project" -> {
                projects[ctx] = s("name")
                return JsonPrimitive("p-$ctx")
            }
            "create_sheet" -> {
                next += 1
                val list = sheets.getOrPut(ctx) { mutableListOf() }
                list += Sheet("sheet-$next", s("name"), list.size.toUInt(), 1uL, "")
                return JsonPrimitive("sheet-$next")
            }
            "set_cell" -> {
                val list = cells.getOrPut(ctx) { mutableListOf() }
                list.removeAll(::same)
                list +=
                    Cell(
                        "${s("sheet_id")}|${s("row_id")}|${s("col_id")}", s("sheet_id"), s("row_id"), s("col_id"),
                        s("raw_value"), s("raw_value"), "", 2uL, account, 2uL,
                    )
                return JsonPrimitive("ok")
            }
            "clear_cell" -> cells[ctx]?.removeAll(::same)
            "add_comment" -> {
                next += 1
                val id = "comment-$next"
                comments.getOrPut(ctx) { mutableListOf() } +=
                    Comment(id, s("sheet_id"), s("row_id"), s("col_id"), account, s("text"), emptyList(), s("parent"), false, next.toULong(), next.toULong())
                return JsonPrimitive(id)
            }
            "set_comment_resolved" ->
                comments[ctx]?.replaceAll {
                    if (it.id == s("id")) it.copy(resolved = (args["resolved"] as? JsonPrimitive)?.booleanOrNull == true) else it
                }
            "edit_comment" -> comments[ctx]?.replaceAll { if (it.id == s("id")) it.copy(text = s("text")) else it }
            "delete_comment" -> comments[ctx]?.removeAll { it.id == s("id") || it.parent == s("id") }
        }
        return JsonNull
    }

    companion object {
        private val json = Json { encodeDefaults = true }
    }
}
