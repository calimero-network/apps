package network.calimero.sheets.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.FormatAlignLeft
import androidx.compose.material.icons.automirrored.outlined.FormatAlignRight
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.ChatBubble
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FormatAlignCenter
import androidx.compose.material.icons.outlined.FormatBold
import androidx.compose.material.icons.outlined.FormatColorFill
import androidx.compose.material.icons.outlined.FormatColorText
import androidx.compose.material.icons.outlined.FormatItalic
import androidx.compose.material.icons.outlined.FormatStrikethrough
import androidx.compose.material.icons.outlined.FormatUnderlined
import androidx.compose.material.icons.outlined.Functions
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import network.calimero.sheets.core.A1
import network.calimero.sheets.core.CellFormat
import network.calimero.sheets.core.CellLook
import network.calimero.sheets.core.GridCell
import network.calimero.sheets.core.GridPos
import network.calimero.sheets.core.LiveUpdates
import network.calimero.sheets.core.LoadPhase
import network.calimero.sheets.core.SpreadsheetModel
import network.calimero.sheets.core.SpreadsheetState
import network.calimero.sheets.core.WorkspaceModel
import network.calimero.sheets.core.WorkspaceState

private const val COLOR_MASK = 0xFFFFFF
private const val OPAQUE = 0xFF000000.toInt()

private sealed interface Panel {
    data class Cell(
        val pos: GridPos,
    ) : Panel

    data class Edit(
        val pos: GridPos,
    ) : Panel

    data object Charts : Panel

    data object Comments : Panel

    data object About : Panel
}

/** One spreadsheet: its tabs, the grid, the selected cell's bar, charts and comments. */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@Composable
fun SpreadsheetScreen(
    workspace: WorkspaceModel,
    ws: WorkspaceState,
    contextId: String,
    onBack: () -> Unit,
    invite: () -> Unit,
) {
    val model = remember(contextId) { SpreadsheetModel(workspace.client(contextId), contextId) }
    val state by model.state.collectAsStateWithLifecycle()
    var panel by remember { mutableStateOf<Panel?>(null) }
    var menu by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current

    LaunchedEffect(model) {
        workspace.ensureMember(contextId)
        model.load()
        LiveUpdates.follow(workspace.backend, contextId) { model.load() }
    }

    val title = state.projectName.trim().ifEmpty { ws.spreadsheet(contextId)?.name ?: "Spreadsheet" }
    val charts = if (state.grid != null) model.sheetCharts() else emptyList()
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(56.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Palette.ink) }
            OneLine(title, size = 17, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (charts.isNotEmpty()) {
                IconButton(onClick = { panel = Panel.Charts }) { Icon(Icons.Outlined.BarChart, contentDescription = "Charts", tint = Palette.ink) }
            }
            IconButton(onClick = { panel = Panel.Comments }) {
                Icon(
                    if (model.openThreads().isEmpty()) Icons.Outlined.ChatBubbleOutline else Icons.Outlined.ChatBubble,
                    contentDescription = "Comments",
                    tint = Palette.ink,
                )
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More", tint = Palette.ink) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.surface) {
                    DropdownMenuItem(
                        text = { Text("Charts") },
                        leadingIcon = { Icon(Icons.Outlined.BarChart, contentDescription = null) },
                        onClick = {
                            menu = false
                            panel = Panel.Charts
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Invite people") },
                        leadingIcon = { Icon(Icons.Outlined.PersonAdd, contentDescription = null) },
                        onClick = {
                            menu = false
                            invite()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("About this spreadsheet") },
                        leadingIcon = { Icon(Icons.Outlined.Info, contentDescription = null) },
                        onClick = {
                            menu = false
                            panel = Panel.About
                        },
                    )
                }
            }
        }
        when (val phase = state.phase) {
            is LoadPhase.Failed ->
                EmptyState(Icons.Outlined.WifiOff, "Could not open this spreadsheet", phase.message, "Try again" to { scope.launch { model.load() } })
            LoadPhase.Idle, LoadPhase.Loading -> CenteredProgress()
            LoadPhase.Loaded ->
                if (state.sheets.isEmpty()) {
                    EmptyState(
                        Icons.Outlined.Sync,
                        "No sheets yet",
                        "This spreadsheet has no tabs yet. They appear as soon as a member’s device sends them.",
                    )
                } else {
                    NoticeBanner(state.notice) { model.dismissNotice() }
                    SheetTabs(model, state)
                    HorizontalDivider(color = Palette.line, thickness = 0.5.dp)
                    val grid = state.grid
                    if (grid != null) {
                        SheetGridView(
                            grid = grid,
                            selected = state.selected,
                            onSelect = { model.select(it) },
                            onDoubleTap = { pos ->
                                model.select(pos)
                                if (model.editBlock(pos) == null) {
                                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    panel = Panel.Edit(pos)
                                } else {
                                    panel = Panel.Cell(pos)
                                }
                            },
                            modifier = Modifier.weight(1f).fillMaxWidth(),
                        )
                    }
                    state.selected?.let { pos ->
                        CellBar(model, pos, open = { panel = Panel.Cell(pos) }) { panel = Panel.Edit(pos) }
                    }
                }
        }
    }

    when (val p = panel) {
        is Panel.Cell -> CellSheet(model, state, p.pos, onDismiss = { panel = null }) { panel = Panel.Edit(p.pos) }
        is Panel.Edit -> EditValueSheet(model, p.pos) { panel = null }
        Panel.Charts -> ChartsSheet(model, state) { panel = null }
        Panel.Comments -> CommentsSheet(model, state) { panel = null }
        Panel.About -> AboutSheet(ws, model, state) { panel = null }
        null -> Unit
    }
}

/** The workbook's tabs, as chips; the open one in lime. */
@Composable
private fun SheetTabs(
    model: SpreadsheetModel,
    state: SpreadsheetState,
) {
    val list = rememberLazyListState()
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(state.activeSheetId) {
        val i = state.sheets.indexOfFirst { it.id == state.activeSheetId }
        if (i >= 0) list.animateScrollToItem(i)
    }
    LazyRow(
        state = list,
        contentPadding = PaddingValues(horizontal = Palette.gutter, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(state.sheets, key = { it.id }) { s ->
            val on = s.id == state.activeSheetId
            Row(
                Modifier
                    .height(32.dp)
                    .clip(CircleShape)
                    .background(if (on) Palette.lime else Palette.surface)
                    .border(1.dp, if (on) Color.Transparent else Palette.line, CircleShape)
                    .clickable {
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        model.selectSheet(s.id)
                    }.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                if (s.linkedFrom.isNotEmpty()) Icon(Icons.Outlined.Link, contentDescription = "Linked", tint = Palette.text2, modifier = Modifier.size(14.dp))
                Text(
                    s.name,
                    fontSize = 14.sp,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (on) Palette.ink else Palette.text2,
                    maxLines = 1,
                )
            }
        }
    }
}

/** The selected cell, like a formula bar: its reference, value, formula, and actions. */
@Composable
private fun CellBar(
    model: SpreadsheetModel,
    pos: GridPos,
    open: () -> Unit,
    edit: () -> Unit,
) {
    val cell = model.cellAt(pos)
    val threads = model.threadsAt(pos).count { !it.root.resolved }
    val haptics = LocalHapticFeedback.current
    Column(Modifier.fillMaxWidth().background(Palette.surface)) {
        HorizontalDivider(color = Palette.line, thickness = 0.5.dp)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Palette.gutter, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(Modifier.weight(1f).clickable(onClick = open), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    pos.label,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    color = Palette.ink,
                    modifier = Modifier.clip(RoundedCornerShape(7.dp)).background(Palette.lime.copy(alpha = 0.55f)).padding(horizontal = 8.dp, vertical = 4.dp),
                )
                Spacer(Modifier.width(10.dp))
                Column {
                    val text = cell?.text.orEmpty()
                    Text(
                        text.ifEmpty { "Empty" },
                        fontSize = 15.sp,
                        fontFamily = FontFamily.Monospace,
                        color = if (text.isEmpty()) Palette.text3 else Palette.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (cell?.isFormula == true) {
                        Text(cell.raw, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = Palette.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            Row(
                Modifier
                    .heightIn(min = 36.dp)
                    .clip(CircleShape)
                    .clickable(onClick = open)
                    .padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Icon(
                    if (threads > 0) Icons.Outlined.ChatBubble else Icons.Outlined.ChatBubbleOutline,
                    contentDescription = if (threads > 0) "$threads comments" else "Comments",
                    tint = Palette.text2,
                )
                if (threads > 0) Text("$threads", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2)
            }
            if (model.editBlock(pos) == null) {
                Box(
                    Modifier.size(36.dp).clip(CircleShape).background(Palette.lime).clickable {
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        edit()
                    },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Edit, contentDescription = "Edit value", tint = Palette.ink, modifier = Modifier.size(18.dp)) }
            }
        }
        Spacer(Modifier.navigationBarsPadding())
    }
}

/** Everything about one cell: value, formula, format, style, who edited it, and its comments. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CellSheet(
    model: SpreadsheetModel,
    state: SpreadsheetState,
    pos: GridPos,
    onDismiss: () -> Unit,
    edit: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState()
    val cell = model.cellAt(pos)
    val canEdit = model.editBlock(pos) == null
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Palette.ground) {
        SheetTitle(state.activeSheet?.let { A1.sheetPrefix(it.name) + pos.label } ?: pos.label, onDismiss)
        Column(
            Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(Palette.gutter),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (cell != null) ValueCard(model, cell)
            Text("Comments", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.padding(top = 4.dp))
            val threads = model.threadsAt(pos)
            if (threads.isEmpty()) {
                Text(
                    if (state.canComment) "No comments on this cell yet." else "No comments on this cell.",
                    fontSize = 14.sp,
                    color = Palette.text3,
                )
            }
            threads.forEach { ThreadCard(model, state, it) }
            if (state.canComment) NewCommentField(model, pos)
        }
        if (canEdit) {
            Box(Modifier.padding(horizontal = Palette.gutter, vertical = 10.dp).navigationBarsPadding()) {
                PrimaryButton("Edit value", edit, icon = Icons.Outlined.Edit)
            }
        } else {
            Spacer(Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun ValueCard(
    model: SpreadsheetModel,
    cell: GridCell,
) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Labeled("Value") {
            SelectionContainer {
                Text(
                    cell.text.ifEmpty { "Empty" },
                    fontSize = 22.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = if (cell.look.bold) FontWeight.Bold else FontWeight.Medium,
                    color = if (cell.text.isEmpty()) Palette.text3 else Palette.ink,
                )
            }
        }
        if (cell.isFormula) {
            Labeled("Formula") { SelectionContainer { Text(cell.raw, fontSize = 15.sp, fontFamily = FontFamily.Monospace, color = Palette.ink) } }
            Text("Computed by the workbook on your team’s nodes. Formulas are written in the web app.", fontSize = 13.sp, color = Palette.text3)
        } else if (cell.raw.isNotEmpty() && cell.raw != cell.text) {
            Labeled("Entered as") { SelectionContainer { Text(cell.raw, fontSize = 15.sp, fontFamily = FontFamily.Monospace, color = Palette.text2) } }
        }
        HorizontalDivider(color = Palette.line)
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.weight(1f)) { Labeled("Format") { Text(CellFormat.describe(cell.format), fontSize = 15.sp, color = Palette.ink) } }
            if (!cell.look.isPlain) StyleChips(cell.look)
        }
        model.editedBy(cell)?.let { IconLine(Icons.Outlined.Schedule, it) }
        val block = model.editBlock(cell.pos)
        if (block != null && !cell.isFormula) IconLine(Icons.Outlined.Lock, block)
    }
}

@Composable
private fun Labeled(
    label: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, color = Palette.text3)
        content()
    }
}

@Composable
private fun IconLine(
    icon: ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(16.dp))
        Text(text, fontSize = 13.sp, color = Palette.text3)
    }
}

@Composable
private fun StyleChips(look: CellLook) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (look.bold) Chip(Icons.Outlined.FormatBold, "Bold")
        if (look.italic) Chip(Icons.Outlined.FormatItalic, "Italic")
        if (look.underline) Chip(Icons.Outlined.FormatUnderlined, "Underline")
        if (look.strike) Chip(Icons.Outlined.FormatStrikethrough, "Strikethrough")
        when (look.align) {
            "center" -> Chip(Icons.Outlined.FormatAlignCenter, "Centered")
            "right" -> Chip(Icons.AutoMirrored.Outlined.FormatAlignRight, "Right-aligned")
            "left" -> Chip(Icons.AutoMirrored.Outlined.FormatAlignLeft, "Left-aligned")
        }
        look.color?.let { Chip(Icons.Outlined.FormatColorText, "Text colour", it) }
        look.fill?.let { Chip(Icons.Outlined.FormatColorFill, "Fill colour", it) }
    }
}

@Composable
private fun Chip(
    icon: ImageVector,
    description: String,
    swatch: Int? = null,
) {
    Box(Modifier.size(26.dp).clip(RoundedCornerShape(7.dp)).background(Palette.sunken), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = description, tint = Palette.text2, modifier = Modifier.size(15.dp))
        if (swatch != null) {
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 3.dp)
                    .size(16.dp, 3.dp)
                    .clip(RoundedCornerShape(1.5.dp))
                    .background(Color(OPAQUE or (swatch and COLOR_MASK))),
            )
        }
    }
}

/** The spreadsheet's facts, where its values come from, and the technical ids. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AboutSheet(
    ws: WorkspaceState,
    model: SpreadsheetModel,
    state: SpreadsheetState,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Palette.ground) {
        SheetTitle("About this spreadsheet", onDismiss)
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(Palette.gutter).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.card(0.dp).padding(horizontal = 16.dp)) {
                Fact("Name", state.projectName.ifEmpty { "Untitled" })
                HorizontalDivider(color = Palette.line)
                Fact("Sheets", "${state.sheets.size}")
                HorizontalDivider(color = Palette.line)
                Fact("Your role", state.role.replaceFirstChar { it.uppercase() })
                HorizontalDivider(color = Palette.line)
                Fact("Collaborators", "${state.members.size}")
            }
            Text("ON THIS PHONE", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.text3, modifier = Modifier.padding(start = 4.dp))
            Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Explain(
                    Icons.Outlined.Functions,
                    "Values are computed by the workbook on your team’s nodes and read here as they are. The phone does not recalculate: " +
                        "after you change a value, the new results arrive from the relay.",
                )
                Explain(Icons.Outlined.Laptop, "Formulas, formatting, charts and sheet structure are edited in the web app.")
            }
            val rows =
                buildList {
                    add("Spreadsheet (context)" to model.contextId)
                    ws.activeWorkspaceId?.let { add("Workspace (namespace)" to it) }
                    state.activeSheetId?.let { add("Sheet" to it) }
                    state.selfId?.let { add("You (member)" to it) }
                }
            DetailsDisclosure(rows)
        }
    }
}

@Composable
private fun Fact(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth().heightIn(min = 46.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 16.sp, color = Palette.text2, modifier = Modifier.weight(1f))
        Text(value, fontSize = 16.sp, color = Palette.ink)
    }
}

@Composable
private fun Explain(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(20.dp))
        Text(text, fontSize = 14.sp, color = Palette.text2)
    }
}
