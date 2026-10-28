package network.calimero.issues.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import network.calimero.issues.app.IssuesAppViewModel
import network.calimero.issues.core.IssueDraft
import network.calimero.issues.core.IssuesModel
import network.calimero.issues.core.SectionsDraft
import network.calimero.issues.core.Tracker
import network.calimero.issues.core.TrackerFormat
import network.calimero.issues.core.TrackerInvitation
import network.calimero.issues.core.WorkspaceModel
import network.calimero.issues.generated.IssueView
import kotlin.coroutines.cancellation.CancellationException

/** Sheet chrome: title bar with Cancel, a scrolling body, a pinned primary button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SheetScaffold(
    title: String,
    action: String,
    canSubmit: Boolean,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    submit: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy })
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = state, containerColor = Palette.ground) {
        Column(Modifier.imePadding()) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.align(Alignment.CenterStart)) { Text("Cancel", color = Palette.ink) }
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.align(Alignment.Center))
            }
            Column(
                Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(Palette.gutter),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                content()
                ErrorLine(error)
            }
            Box(Modifier.padding(horizontal = Palette.gutter, vertical = 10.dp).navigationBarsPadding()) {
                PrimaryButton(action, submit, enabled = canSubmit, busy = busy)
            }
        }
    }
}

@Composable
private fun SectionField(
    n: Int,
    title: String,
    placeholder: String,
    value: String,
    onChange: (String) -> Unit,
    mono: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(title, n)
        Field(value, onChange, placeholder, singleLine = false, minLines = 3, mono = mono, textSize = if (mono) 14 else 15)
    }
}

@Composable
fun NewIssueSheet(
    issues: IssuesModel,
    repoName: String?,
    onDismiss: () -> Unit,
) {
    var draft by remember { mutableStateOf(IssueDraft()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    SheetScaffold("New issue", "Create issue", draft.isValid, busy, error, onDismiss, submit = {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        busy = true
        error = null
        scope.launch {
            try {
                issues.create(draft)
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = TrackerFormat.errorText(e)
            }
            busy = false
        }
    }) {
        if (repoName != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.Code, contentDescription = null, tint = Palette.text2, modifier = Modifier.size(16.dp))
                Text(repoName, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2)
            }
        }
        Field(draft.title, { draft = draft.copy(title = it) }, "Issue title", singleLine = false, textSize = 20, bold = true)
        SectionDraftFields(
            SectionsDraft(draft.summary, draft.impact, draft.repro, draft.resolution),
        ) { s -> draft = draft.copy(summary = s.summary, impact = s.impact, repro = s.repro, resolution = s.resolution) }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Eyebrow("Priority")
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                Tracker.priorities.forEachIndexed { i, p ->
                    SegmentedButton(
                        selected = draft.priority == p,
                        onClick = { draft = draft.copy(priority = p) },
                        shape = SegmentedButtonDefaults.itemShape(i, Tracker.priorities.size),
                        colors = SegmentedButtonDefaults.colors(activeContainerColor = Palette.lime, activeContentColor = Palette.ink),
                        icon = {},
                    ) { Text(p.replaceFirstChar { it.uppercase() }) }
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Eyebrow("Labels")
            Field(draft.labels, { draft = draft.copy(labels = it) }, "sync, crdt…")
        }
        Text("All four sections are required. Issues filed through MCP follow the same format.", fontSize = 13.sp, color = Palette.text3)
    }
}

@Composable
private fun SectionDraftFields(
    draft: SectionsDraft,
    onChange: (SectionsDraft) -> Unit,
) {
    SectionField(1, "Summary", "What is broken, in one paragraph", draft.summary, { onChange(draft.copy(summary = it)) })
    SectionField(2, "Impact", "Who/what does it affect, why does severity matter", draft.impact, { onChange(draft.copy(impact = it)) })
    SectionField(3, "Repro", "Numbered steps and/or paste logs", draft.repro, { onChange(draft.copy(repro = it)) }, mono = true)
    SectionField(4, "Resolution criteria", "What does fixed mean? The agent will validate against this", draft.resolution, {
        onChange(draft.copy(resolution = it))
    })
}

/** Edit the four sections (the contract keeps the title as filed). */
@Composable
fun EditSectionsSheet(
    issue: IssueView,
    onDismiss: () -> Unit,
    save: suspend (SectionsDraft) -> String?,
) {
    var draft by remember { mutableStateOf(SectionsDraft(issue)) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    SheetScaffold("Edit issue", "Save", draft.isValid, busy, error, onDismiss, submit = {
        busy = true
        scope.launch {
            val failure = save(draft)
            busy = false
            if (failure == null) onDismiss() else error = failure
        }
    }) {
        SectionDraftFields(draft) { draft = it }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilterSheet(
    issues: IssuesModel,
    onDismiss: () -> Unit,
) {
    val state by issues.state.collectAsStateWithLifecycle()
    val f = state.filters
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.ground) {
        Column(Modifier.imePadding().navigationBarsPadding()) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                TextButton(onClick = issues::clearFilters, enabled = f.isActive, modifier = Modifier.align(Alignment.CenterStart)) { Text("Clear", color = Palette.ink) }
                Text("Filters", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.align(Alignment.Center))
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterEnd)) { Text("Done", color = Palette.ink, fontWeight = FontWeight.SemiBold) }
            }
            Column(Modifier.verticalScroll(rememberScrollState()).padding(Palette.gutter), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                ChoiceRow("Status", listOf("" to "All statuses") + Tracker.statuses.map { it to it }, f.status) { issues.setFilters(f.copy(status = it)) }
                ChoiceRow("Priority", listOf("" to "All priorities") + Tracker.priorities.map { it to it.replaceFirstChar { c -> c.uppercase() } }, f.priority) {
                    issues.setFilters(f.copy(priority = it))
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Eyebrow("Assignee")
                    Field(f.assignee, { issues.setFilters(f.copy(assignee = it)) }, "Filter by assignee…")
                    Suggestions(state.knownAssignees, f.assignee) { issues.setFilters(f.copy(assignee = it)) }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Eyebrow("Label")
                    Field(f.label, { issues.setFilters(f.copy(label = it)) }, "Filter by label…")
                    Suggestions(state.knownLabels, f.label) { issues.setFilters(f.copy(label = it)) }
                }
            }
        }
    }
}

@Composable
private fun ChoiceRow(
    title: String,
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(title)
        Suggestions(options.map { it.second }, options.firstOrNull { it.first == selected }?.second.orEmpty()) { label ->
            onSelect(options.first { it.second == label }.first)
        }
    }
}

@Composable
private fun Suggestions(
    values: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    if (values.isEmpty()) return
    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        items(values) { value ->
            Text(
                value,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = Palette.ink,
                modifier =
                    Modifier
                        .clip(CircleShape)
                        .background(if (value == selected) Palette.lime else Palette.sunken)
                        .clickable { onSelect(value) }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
    }
}

/** One text field and a primary action: New workspace, Repository URL. */
@Composable
fun NameSheet(
    title: String,
    message: String,
    field: String,
    placeholder: String,
    action: String,
    onDismiss: () -> Unit,
    initial: String = "",
    allowsEmpty: Boolean = false,
    url: Boolean = false,
    submit: suspend (String) -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    SheetScaffold(title, action, allowsEmpty || text.isNotBlank(), busy, error, onDismiss, submit = {
        busy = true
        error = null
        scope.launch {
            try {
                submit(text)
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = TrackerFormat.errorText(e)
            }
            busy = false
        }
    }) {
        Text(message, fontSize = 15.sp, color = Palette.text2)
        LabeledField(field, text, { text = it }, placeholder, if (url) KeyboardType.Uri else KeyboardType.Text)
    }
}

@Composable
fun AddRepoSheet(
    workspace: WorkspaceModel,
    onDismiss: () -> Unit,
    done: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    SheetScaffold("Add a repository", "Add repository", name.isNotBlank(), busy, error, onDismiss, submit = {
        busy = true
        error = null
        scope.launch {
            try {
                workspace.addRepo(name, url)
                done()
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = TrackerFormat.errorText(e)
            }
            busy = false
        }
    }) {
        Text("Repos are tracked separately. Give it a name and its GitHub URL.", fontSize = 15.sp, color = Palette.text2)
        LabeledField("Repo name", name, { name = it }, "e.g. core")
        LabeledField("GitHub URL", url, { url = it }, "https://github.com/owner/repo", KeyboardType.Uri)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteSheet(
    workspace: WorkspaceModel,
    onShare: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var link by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.ground) {
        Column(Modifier.padding(Palette.gutter).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Box(Modifier.fillMaxWidth()) {
                Text("Invite to workspace", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.align(Alignment.Center))
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterEnd)) { Text("Done", color = Palette.ink) }
            }
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Palette.lime.copy(alpha = 0.4f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.PersonAdd, contentDescription = null, tint = Palette.ink)
            }
            Text("Generate an invite link and share it with anyone you want to join this workspace.", fontSize = 15.sp, color = Palette.text2)
            val current = link
            if (current != null) {
                Text(current, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Palette.text2, maxLines = 4, modifier = Modifier.card(12.dp))
                PrimaryButton("Share invite link", { onShare(current) }, icon = Icons.Outlined.Share)
                SecondaryButton(if (copied) "Copied" else "Copy invite link", {
                    clipboard.setText(AnnotatedString(current))
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    copied = true
                }, icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy)
                Text("Whoever opens the link is asked to join this workspace.", fontSize = 13.sp, color = Palette.text3)
            } else {
                PrimaryButton("Generate invite link", {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            link = workspace.inviteLink()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = TrackerFormat.errorText(e)
                        }
                        busy = false
                    }
                }, busy = busy)
            }
            ErrorLine(error)
        }
    }
}

/** An invitation link arrived: say which workspace, and join on confirmation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JoinInvitationSheet(
    link: String,
    vm: IssuesAppViewModel,
) {
    val invitation = remember(link) { TrackerInvitation.parse(link) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy })
    ModalBottomSheet(onDismissRequest = { if (!busy) vm.session.dismissPendingInvitation() }, sheetState = state, containerColor = Palette.ground) {
        Column(
            Modifier.padding(Palette.gutter).navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Box(Modifier.size(60.dp).clip(RoundedCornerShape(18.dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Group, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(28.dp))
            }
            if (invitation != null) {
                Text(
                    "Join ${invitation.workspaceName ?: "this workspace"}?",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.ink,
                    textAlign = TextAlign.Center,
                )
                Text(
                    "You were invited to a workspace on Mero Issue Tracker. Joining lets you see and triage its issues.",
                    fontSize = 15.sp,
                    color = Palette.text2,
                    textAlign = TextAlign.Center,
                )
            } else {
                Text("This invitation cannot be read", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                Text("Ask for a new invite link.", fontSize = 15.sp, color = Palette.text2)
            }
            error?.let { Text(it, fontSize = 14.sp, color = Palette.danger, textAlign = TextAlign.Center) }
            if (invitation != null) {
                PrimaryButton(if (busy) "Joining…" else "Join workspace", {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            vm.join(invitation)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = TrackerFormat.errorText(e)
                        }
                        busy = false
                    }
                }, busy = busy)
            }
            SecondaryButton("Not now", { vm.session.dismissPendingInvitation() }, enabled = !busy)
        }
    }
}
