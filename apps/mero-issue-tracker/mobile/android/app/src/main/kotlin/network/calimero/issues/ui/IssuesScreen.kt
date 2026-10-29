package network.calimero.issues.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
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
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import network.calimero.issues.core.IssueFilters
import network.calimero.issues.core.IssuesModel
import network.calimero.issues.core.LoadPhase
import network.calimero.issues.core.Tracker
import network.calimero.issues.core.TrackerFormat
import network.calimero.issues.generated.IssueView

/** The list: issues grouped by status, searchable, filtered by chips; swipe to close or reopen, long-press to move. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssueList(
    model: IssuesModel,
    openSheet: (TrackerSheet) -> Unit,
    open: (String) -> Unit,
) {
    val state by model.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        SearchField(state.query, model::setQuery)
        FilterBar(state.filters, state.visible.size, onOpen = { openSheet(TrackerSheet.FILTERS) }, onChange = model::setFilters)
        NoticeBanner(state.notice, model::dismissNotice)
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            val phase = state.phase
            when {
                phase is LoadPhase.Failed ->
                    EmptyState(Icons.Outlined.WifiOff, "Could not load issues", phase.message, "Try again" to { scope.launch { model.load() } })
                phase != LoadPhase.Loaded -> CenteredProgress()
                state.issues.isEmpty() ->
                    EmptyState(
                        Icons.Outlined.Inbox,
                        "No issues yet",
                        "File the first one: what is broken, who it hurts, how to reproduce it, and what fixed means.",
                        "New issue" to { openSheet(TrackerSheet.NEW_ISSUE) },
                    )
                state.sections.isEmpty() -> {
                    val q = state.query.trim()
                    EmptyState(Icons.Outlined.Search, "Nothing here", if (q.isEmpty()) "No issues match these filters." else "No issues match \"$q\".")
                }
                else ->
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = Palette.gutter, end = Palette.gutter, bottom = 24.dp)) {
                        state.sections.forEach { section ->
                            item(key = "h-${section.status}") { SectionHeader(section.status, section.issues.size) }
                            items(section.issues, key = { it.id }) { issue ->
                                SwipeRow(model, issue, open)
                                Spacer(Modifier.height(8.dp))
                            }
                        }
                    }
            }
        }
    }
}

@Composable
private fun SectionHeader(
    status: String,
    count: Int,
) {
    Row(
        Modifier.padding(top = 16.dp, bottom = 8.dp, start = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StatusDot(status)
        Text(status, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
        Text(
            "$count",
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = Palette.status(status),
            modifier = Modifier.clip(CircleShape).background(Palette.status(status).copy(alpha = 0.14f)).padding(horizontal = 7.dp, vertical = 2.dp),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
private fun SwipeRow(
    model: IssuesModel,
    issue: IssueView,
    open: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val done = issue.status == "Done"
    var menu by remember { mutableStateOf(false) }
    val swipe =
        rememberSwipeToDismissBoxState(confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                scope.launch { model.move(issue.id, if (done) "Open" else "Done") }
            }
            false
        })
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            val tint = Palette.status(if (done) "Open" else "Done")
            Row(
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(Palette.radius))
                    .background(tint)
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (done) Icons.AutoMirrored.Filled.Undo else Icons.Filled.Check, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White)
                Spacer(Modifier.width(6.dp))
                Text(if (done) "Reopen" else "Done", color = androidx.compose.ui.graphics.Color.White, fontWeight = FontWeight.SemiBold)
            }
        },
    ) {
        Box {
            Box(
                Modifier
                    .clip(RoundedCornerShape(Palette.radius))
                    .combinedClickable(onClick = { open(issue.id) }, onLongClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        menu = true
                    }),
            ) { IssueRow(issue) }
            MoveMenu(menu, issue, onDismiss = { menu = false }) { status -> scope.launch { model.move(issue.id, status) } }
        }
    }
}

/** "Move to…": every other status. */
@Composable
fun MoveMenu(
    expanded: Boolean,
    issue: IssueView,
    onDismiss: () -> Unit,
    move: (String) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Text("Move to…", fontSize = 12.sp, color = Palette.text3, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        Tracker.statuses.filter { it != issue.status }.forEach { status ->
            DropdownMenuItem(
                text = { Text(status) },
                leadingIcon = { Icon(statusIcon(status), contentDescription = null, tint = Palette.status(status)) },
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onDismiss()
                    move(status)
                },
            )
        }
    }
}

@Composable
fun IssueRow(issue: IssueView) {
    Row(Modifier.card(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.padding(top = 2.dp)) { PriorityGlyph(issue.priority) }
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(issue.title, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.ink, maxLines = 2)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Pill(TrackerFormat.shortIssueId(issue.id), mono = true)
                issue.labels.take(2).forEach { LabelChip(it) }
                Spacer(Modifier.weight(1f))
                issue.assignee?.takeIf { it.isNotEmpty() }?.let { Avatar(it, 20.dp) }
                Text(TrackerFormat.relativeTime(issue.createdAt.toLong()), fontSize = 12.sp, color = Palette.text3)
            }
        }
    }
}

@Composable
fun SearchField(
    query: String,
    onChange: (String) -> Unit,
) {
    Row(
        Modifier
            .padding(horizontal = Palette.gutter, vertical = 4.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.sunken)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(20.dp))
        Box(Modifier.weight(1f)) {
            if (query.isEmpty()) Text("Search issues", color = Palette.text3, fontSize = 16.sp)
            BasicTextField(query, onChange, singleLine = true, textStyle = TextStyle(fontSize = 16.sp, color = Palette.ink), modifier = Modifier.fillMaxWidth())
        }
        if (query.isNotEmpty()) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Clear search",
                tint = Palette.text3,
                modifier = Modifier.size(18.dp).clip(CircleShape).clickable { onChange("") },
            )
        }
    }
}

/** Filters button, the active filters as removable chips, Clear, and the count. */
@Composable
fun FilterBar(
    filters: IssueFilters,
    shown: Int,
    onOpen: () -> Unit,
    onChange: (IssueFilters) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = Palette.gutter, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item {
            Row(
                Modifier
                    .height(32.dp)
                    .clip(CircleShape)
                    .background(Palette.surface)
                    .border(1.dp, Palette.line, CircleShape)
                    .clickable(onClick = onOpen)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Icons.Outlined.FilterList, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(18.dp))
                Text("Filters", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                if (filters.activeCount > 0) {
                    Text(
                        "${filters.activeCount}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Palette.ink,
                        modifier = Modifier.clip(CircleShape).background(Palette.lime).padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
        }
        val chips =
            listOf(
                Triple("Status", filters.status, filters.copy(status = "")),
                Triple("Priority", filters.priority.replaceFirstChar { it.uppercase() }, filters.copy(priority = "")),
                Triple("Assignee", filters.assignee, filters.copy(assignee = "")),
                Triple("Label", filters.label, filters.copy(label = "")),
            ).filter { it.second.isNotEmpty() }
        items(chips, key = { it.first }) { (name, value, cleared) ->
            Row(
                Modifier
                    .height(32.dp)
                    .clip(CircleShape)
                    .background(Palette.lime.copy(alpha = 0.45f))
                    .padding(start = 12.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("$name: $value", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Remove $name filter",
                    tint = Palette.ink,
                    modifier =
                        Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .clickable { onChange(cleared) }
                            .padding(3.dp),
                )
            }
        }
        if (filters.isActive) {
            item {
                Text(
                    "Clear",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.text2,
                    modifier = Modifier.clip(CircleShape).clickable { onChange(IssueFilters()) }.padding(horizontal = 8.dp, vertical = 6.dp),
                )
            }
        }
        item { Text(if (shown == 1) "1 issue" else "$shown issues", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Palette.text3) }
    }
}
