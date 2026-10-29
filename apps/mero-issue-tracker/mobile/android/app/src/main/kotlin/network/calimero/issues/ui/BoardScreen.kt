package network.calimero.issues.ui

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleRight
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import network.calimero.issues.core.IssuesModel
import network.calimero.issues.core.IssuesState
import network.calimero.issues.core.LoadPhase
import network.calimero.issues.core.Tracker
import network.calimero.issues.core.TrackerFormat
import network.calimero.issues.generated.IssueView

/** The board: one column per status, swiped sideways one at a time. Cards move with "Move to…" (no dragging). */
@Composable
fun BoardView(
    model: IssuesModel,
    open: (String) -> Unit,
) {
    val state by model.state.collectAsStateWithLifecycle()
    val pager = rememberPagerState { Tracker.statuses.size }
    val chips = rememberLazyListState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(pager.currentPage) { chips.animateScrollToItem(pager.currentPage) }
    Column(Modifier.fillMaxSize()) {
        SearchField(state.query, model::setQuery)
        LazyRow(
            state = chips,
            contentPadding = PaddingValues(horizontal = Palette.gutter, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            itemsIndexed(Tracker.statuses) { index, status ->
                val selected = pager.currentPage == index
                Row(
                    Modifier
                        .height(34.dp)
                        .clip(CircleShape)
                        .background(if (selected) Palette.lime else Palette.surface)
                        .border(1.dp, if (selected) Palette.lime else Palette.line, CircleShape)
                        .clickable { scope.launch { pager.animateScrollToPage(index) } }
                        .semantics { this.selected = selected }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    StatusDot(status, 8.dp)
                    Text(status, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                    Text("${state.column(status).size}", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.text3)
                }
            }
        }
        NoticeBanner(state.notice, model::dismissNotice)
        val phase = state.phase
        when {
            phase is LoadPhase.Failed ->
                EmptyState(Icons.Outlined.WifiOff, "Could not load issues", phase.message, "Try again" to { scope.launch { model.load() } })
            phase != LoadPhase.Loaded -> CenteredProgress()
            else ->
                HorizontalPager(pager, Modifier.fillMaxSize()) { page ->
                    BoardColumn(model, state, Tracker.statuses[page], open)
                }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BoardColumn(
    model: IssuesModel,
    state: IssuesState,
    status: String,
    open: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val cards = state.column(status)
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
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = Palette.gutter, end = Palette.gutter, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (cards.isEmpty()) {
                item {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .border(1.dp, Palette.lineStrong, RoundedCornerShape(Palette.radius))
                            .padding(vertical = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(statusIcon(status), contentDescription = null, tint = Palette.text3, modifier = Modifier.size(24.dp))
                        Spacer(Modifier.height(8.dp))
                        Text("No issues", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.text3)
                    }
                }
            }
            items(cards, key = { it.id }) { issue -> BoardCard(model, issue, open) }
        }
    }
}

@Composable
private fun BoardCard(
    model: IssuesModel,
    issue: IssueView,
    open: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    Column(
        Modifier.clip(RoundedCornerShape(Palette.radius)).clickable { open(issue.id) }.card(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PriorityGlyph(issue.priority)
            Pill(TrackerFormat.shortIssueId(issue.id), mono = true)
            Text(TrackerFormat.relativeTime(issue.createdAt.toLong()), fontSize = 12.sp, color = Palette.text3)
            Spacer(Modifier.weight(1f))
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Outlined.ArrowCircleRight, contentDescription = "Move to…", tint = Palette.text2)
                }
                MoveMenu(menu, issue, onDismiss = { menu = false }) { status -> scope.launch { model.move(issue.id, status) } }
            }
        }
        Text(issue.title, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.ink, maxLines = 3)
        if (issue.labels.isNotEmpty() || !issue.assignee.isNullOrEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                issue.labels.take(2).forEach { LabelChip(it) }
                Spacer(Modifier.weight(1f))
                issue.assignee?.takeIf { it.isNotEmpty() }?.let { Avatar(it, 22.dp) }
            }
        }
    }
}
