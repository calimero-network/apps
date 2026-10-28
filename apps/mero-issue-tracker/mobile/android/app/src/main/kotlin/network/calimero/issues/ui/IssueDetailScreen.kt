package network.calimero.issues.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.issues.core.IssueDetailModel
import network.calimero.issues.core.LiveUpdates
import network.calimero.issues.core.LoadPhase
import network.calimero.issues.core.Tracker
import network.calimero.issues.core.TrackerFormat
import network.calimero.issues.core.WorkspaceModel
import network.calimero.issues.core.WorkspaceState
import network.calimero.issues.generated.CommentView
import network.calimero.issues.generated.IssueView

private sealed interface DetailDialog {
    data object Assignee : DetailDialog

    data object Label : DetailDialog

    data class EditComment(
        val comment: CommentView,
    ) : DetailDialog

    data object Delete : DetailDialog
}

/** One issue: header, properties, the four sections, the fix prompt, the activity thread, and a composer above the keyboard. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssueDetailScreen(
    workspace: WorkspaceModel,
    ws: WorkspaceState,
    route: IssueRoute,
    seed: IssueView?,
    onBack: () -> Unit,
    onChange: suspend () -> Unit,
) {
    val model = remember(route) { IssueDetailModel(workspace.client(route.repoId), route.issueId, workspace.account, seed) }
    val state by model.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current
    var dialog by remember { mutableStateOf<DetailDialog?>(null) }
    var editing by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }

    LaunchedEffect(route) {
        model.load()
        LiveUpdates.follow(workspace.backend, route.repoId) { model.load() }
    }
    LaunchedEffect(state.isGone) { if (state.isGone) onBack() }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2_000)
            copied = false
        }
    }

    fun run(work: suspend () -> Unit) {
        scope.launch {
            work()
            onChange()
        }
    }

    fun copyPrompt() {
        val prompt = model.fixPrompt(ws.activeRepo?.url) ?: return
        clipboard.setText(AnnotatedString(prompt))
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        copied = true
    }

    Scaffold(
        containerColor = Palette.ground,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(state.issue?.let { TrackerFormat.shortIssueId(it.id) } ?: "Issue", fontWeight = FontWeight.SemiBold, fontSize = 16.sp) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Palette.ink) } },
                actions = {
                    if (state.issue != null) {
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, contentDescription = "More", tint = Palette.ink) }
                            DropdownMenu(menu, onDismissRequest = { menu = false }, containerColor = Palette.surface) {
                                DropdownMenuItem(
                                    text = { Text("Edit sections") },
                                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                    onClick = {
                                        menu = false
                                        editing = true
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Copy fix prompt") },
                                    leadingIcon = { Icon(Icons.Outlined.ContentCopy, contentDescription = null) },
                                    onClick = {
                                        menu = false
                                        copyPrompt()
                                    },
                                )
                                if (model.isCreator) {
                                    HorizontalDivider(color = Palette.line)
                                    DropdownMenuItem(
                                        text = { Text("Delete issue", color = Palette.danger) },
                                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = Palette.danger) },
                                        onClick = {
                                            menu = false
                                            dialog = DetailDialog.Delete
                                        },
                                    )
                                }
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Palette.ground),
            )
        },
        bottomBar = {
            if (state.issue != null && !state.isGone) Composer(enabled = !state.isWorking) { body -> model.addComment(body).also { if (it) onChange() } }
        },
    ) { padding ->
        val issue = state.issue
        val phase = state.phase
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                issue != null && !state.isGone ->
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = Palette.gutter, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item { NoticeBanner(state.notice, model::dismissNotice) }
                        item { Header(issue, workspace.account) }
                        item {
                            Properties(
                                issue,
                                onStatus = { s ->
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    run { model.setStatus(s) }
                                },
                                onPriority = { p ->
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    run { model.setPriority(p) }
                                },
                                onAssignee = { dialog = DetailDialog.Assignee },
                                onAddLabel = { dialog = DetailDialog.Label },
                                onRemoveLabel = { l -> run { model.removeLabel(l) } },
                            )
                        }
                        item { Sections(issue) }
                        item { AgentCard(copied, ::copyPrompt) }
                        item {
                            Activity(issue, state.comments, model::isMine, workspace.account, onEdit = { dialog = DetailDialog.EditComment(it) }) { c ->
                                run { model.deleteComment(c.id) }
                            }
                        }
                        item {
                            DetailsDisclosure(listOf("Issue id" to issue.id, "Created by" to issue.createdBy, "Repository context" to route.repoId))
                        }
                    }
                phase is LoadPhase.Failed -> EmptyState(MissingIcon, "Issue not available", phase.message)
                else -> CenteredProgress()
            }
        }
    }

    val issue = state.issue
    if (editing && issue != null) {
        EditSectionsSheet(issue, onDismiss = { editing = false }) { draft ->
            val ok = model.saveSections(draft)
            if (ok) onChange()
            if (ok) null else model.state.value.notice
        }
    }
    when (val d = dialog) {
        DetailDialog.Assignee ->
            TextDialog("Assignee", "Who is on it. Leave empty to unassign.", "Unassigned", issue?.assignee.orEmpty(), "Save", { dialog = null }) {
                run { model.setAssignee(it) }
            }
        DetailDialog.Label -> TextDialog("Add label", null, "Label name", "", "Add", { dialog = null }) { run { model.addLabel(it) } }
        is DetailDialog.EditComment ->
            TextDialog("Edit comment", null, "Comment", d.comment.body, "Save", { dialog = null }) { run { model.editComment(d.comment.id, it) } }
        DetailDialog.Delete ->
            AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text("Delete issue") },
                text = { Text("Delete \"${issue?.title.orEmpty()}\"? This also removes its comments and cannot be undone.") },
                confirmButton = {
                    TextButton(onClick = {
                        dialog = null
                        scope.launch { if (model.delete()) onChange() }
                    }) { Text("Delete", color = Palette.danger) }
                },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text("Cancel", color = Palette.ink) } },
                containerColor = Palette.surface,
            )
        null -> Unit
    }
}

private fun person(
    account: String,
    me: String,
): String = if (account.equals(me, ignoreCase = true)) "You" else TrackerFormat.truncateKey(account)

@Composable
private fun TextDialog(
    title: String,
    message: String?,
    placeholder: String,
    initial: String,
    action: String,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (message != null) Text(message, color = Palette.text2)
                Field(text, { text = it }, placeholder)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onDismiss()
                onSubmit(text)
            }) { Text(action, color = Palette.ink, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = Palette.ink) } },
        containerColor = Palette.surface,
    )
}

@Composable
private fun Header(
    issue: IssueView,
    me: String,
) {
    CardColumn(18.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Pill(TrackerFormat.shortIssueId(issue.id), mono = true)
            Row(
                Modifier.clip(CircleShape).background(Palette.status(issue.status).copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                StatusDot(issue.status, 8.dp)
                Text(issue.status, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
            }
            Row(
                Modifier.clip(CircleShape).background(Palette.sunken).padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                PriorityGlyph(issue.priority, 13.dp)
                Text(issue.priority.replaceFirstChar { it.uppercase() }, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2)
            }
        }
        Spacer(Modifier.size(12.dp))
        SelectionContainer { Text(issue.title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink) }
        Spacer(Modifier.size(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Avatar(issue.createdBy, 22.dp)
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Palette.ink)) { append(person(issue.createdBy, me)) }
                    withStyle(SpanStyle(color = Palette.text2)) { append(" opened this ${TrackerFormat.ago(issue.createdAt.toLong())}") }
                },
                fontSize = 13.sp,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Properties(
    issue: IssueView,
    onStatus: (String) -> Unit,
    onPriority: (String) -> Unit,
    onAssignee: () -> Unit,
    onAddLabel: () -> Unit,
    onRemoveLabel: (String) -> Unit,
) {
    var statusMenu by remember { mutableStateOf(false) }
    var priorityMenu by remember { mutableStateOf(false) }
    CardColumn(14.dp) {
        PropertyRow("Status") {
            Box {
                Row(Modifier.clickable { statusMenu = true }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusDot(issue.status)
                    Text(issue.status, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.ink)
                    Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(16.dp))
                }
                DropdownMenu(statusMenu, onDismissRequest = { statusMenu = false }, containerColor = Palette.surface) {
                    Tracker.statuses.forEach { s ->
                        DropdownMenuItem(
                            text = { Text(s) },
                            leadingIcon = { Icon(if (s == issue.status) Icons.Filled.Check else statusIcon(s), contentDescription = null) },
                            onClick = {
                                statusMenu = false
                                onStatus(s)
                            },
                        )
                    }
                }
            }
        }
        HorizontalDivider(color = Palette.line)
        PropertyRow("Priority") {
            Box {
                Row(Modifier.clickable { priorityMenu = true }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PriorityGlyph(issue.priority, 13.dp)
                    Text(issue.priority.replaceFirstChar { it.uppercase() }, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.ink)
                    Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(16.dp))
                }
                DropdownMenu(priorityMenu, onDismissRequest = { priorityMenu = false }, containerColor = Palette.surface) {
                    Tracker.priorities.forEach { p ->
                        DropdownMenuItem(
                            text = { Text(p.replaceFirstChar { it.uppercase() }) },
                            trailingIcon = { if (p == issue.priority) Icon(Icons.Filled.Check, contentDescription = null) },
                            onClick = {
                                priorityMenu = false
                                onPriority(p)
                            },
                        )
                    }
                }
            }
        }
        HorizontalDivider(color = Palette.line)
        PropertyRow("Assignee") {
            Row(Modifier.clickable(onClick = onAssignee), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val who = issue.assignee
                if (!who.isNullOrEmpty()) {
                    Avatar(who, 20.dp)
                    OneLine(who, weight = FontWeight.Medium)
                } else {
                    Icon(Icons.Outlined.AccountCircle, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(20.dp))
                    Text("Unassigned", fontSize = 14.sp, color = Palette.text3)
                }
            }
        }
        HorizontalDivider(color = Palette.line)
        Column(Modifier.padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Labels", fontSize = 14.sp, color = Palette.text2)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                issue.labels.forEach { l -> LabelChip(l) { onRemoveLabel(l) } }
                Row(
                    Modifier
                        .clip(CircleShape)
                        .border(1.dp, Palette.lineStrong, CircleShape)
                        .clickable(onClick = onAddLabel)
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Outlined.Sell, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(14.dp))
                    Text("Add", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                }
            }
        }
    }
}

@Composable
private fun PropertyRow(
    name: String,
    value: @Composable () -> Unit,
) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(name, fontSize = 14.sp, color = Palette.text2, modifier = Modifier.weight(1f))
        value()
    }
}

@Composable
private fun Sections(issue: IssueView) {
    CardColumn {
        Section(1, "Summary", issue.summary)
        HorizontalDivider(color = Palette.line)
        Section(2, "Impact", issue.impact)
        HorizontalDivider(color = Palette.line)
        Section(3, "Repro", issue.repro, mono = true)
        HorizontalDivider(color = Palette.line)
        Section(4, "Resolution criteria", issue.resolutionCriteria)
    }
}

@Composable
private fun Section(
    n: Int,
    title: String,
    text: String,
    mono: Boolean = false,
) {
    Column(Modifier.padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(title, n)
        SelectionContainer {
            if (mono) {
                Text(
                    text,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    color = Palette.ink,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Palette.sunken)
                            .padding(12.dp),
                )
            } else {
                Text(text, fontSize = 15.sp, color = Palette.ink)
            }
        }
    }
}

@Composable
private fun AgentCard(
    copied: Boolean,
    copy: () -> Unit,
) {
    CardColumn {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = Palette.text2, modifier = Modifier.size(16.dp))
            Text("Local agent", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Palette.text2)
        }
        Spacer(Modifier.size(10.dp))
        Text("A ready-to-paste prompt with all four sections, for a coding agent to fix this.", fontSize = 14.sp, color = Palette.ink)
        Spacer(Modifier.size(10.dp))
        PrimaryButton(if (copied) "Prompt copied" else "Copy fix prompt", copy, icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy)
    }
}

@Composable
private fun Activity(
    issue: IssueView,
    comments: List<CommentView>,
    isMine: (CommentView) -> Boolean,
    me: String,
    onEdit: (CommentView) -> Unit,
    onDelete: (CommentView) -> Unit,
) {
    CardColumn {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Activity", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
            Pill("${comments.size + 1}")
        }
        Spacer(Modifier.size(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(issue.createdBy, 26.dp)
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Palette.ink)) { append(person(issue.createdBy, me)) }
                    withStyle(SpanStyle(color = Palette.text3)) { append(" created this issue · ${TrackerFormat.ago(issue.createdAt.toLong())}") }
                },
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        comments.forEach { c ->
            Spacer(Modifier.size(14.dp))
            CommentItem(c, isMine(c), person(c.author, me), onEdit, onDelete)
        }
    }
}

@Composable
private fun CommentItem(
    c: CommentView,
    mine: Boolean,
    name: String,
    onEdit: (CommentView) -> Unit,
    onDelete: (CommentView) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Avatar(c.author, 26.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                Text(" · ${TrackerFormat.ago(c.createdAt.toLong())}", fontSize = 13.sp, color = Palette.text3, modifier = Modifier.weight(1f))
                if (mine) {
                    Box {
                        Icon(
                            Icons.Outlined.MoreHoriz,
                            contentDescription = "Comment actions",
                            tint = Palette.text3,
                            modifier = Modifier.clip(CircleShape).clickable { menu = true }.padding(4.dp),
                        )
                        DropdownMenu(menu, onDismissRequest = { menu = false }, containerColor = Palette.surface) {
                            DropdownMenuItem(
                                text = { Text("Edit") },
                                leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    onEdit(c)
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Delete", color = Palette.danger) },
                                leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = Palette.danger) },
                                onClick = {
                                    menu = false
                                    onDelete(c)
                                },
                            )
                        }
                    }
                }
            }
            SelectionContainer {
                Text(
                    buildAnnotatedString {
                        append(c.body)
                        if (c.editedAt != null) withStyle(SpanStyle(color = Palette.text3, fontSize = 12.sp)) { append("  (edited)") }
                    },
                    fontSize = 14.sp,
                    color = Palette.ink,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(topStart = 0.dp, topEnd = 14.dp, bottomEnd = 14.dp, bottomStart = 14.dp))
                            .background(Palette.sunken)
                            .padding(horizontal = 12.dp, vertical = 9.dp),
                )
            }
        }
    }
}

/** The comment composer, above the keyboard. */
@Composable
private fun Composer(
    enabled: Boolean,
    send: suspend (String) -> Boolean,
) {
    var text by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val canSend = enabled && text.isNotBlank()
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.surface)
            .imePadding()
            .padding(horizontal = Palette.gutter, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Field(text, { text = it }, "Leave a comment…", modifier = Modifier.weight(1f), singleLine = false, textSize = 15)
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(Palette.lime.copy(alpha = if (canSend) 1f else 0.4f))
                .clickable(enabled = canSend) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    val body = text
                    scope.launch { if (send(body)) text = "" }
                },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.ArrowUpward, contentDescription = "Comment", tint = Palette.ink) }
    }
}
