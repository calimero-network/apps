package network.calimero.updates.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AsksModel
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.MetricsModel
import network.calimero.updates.app.QuestionsModel
import network.calimero.updates.core.AskKind
import network.calimero.updates.core.Format
import network.calimero.updates.core.Limits
import network.calimero.updates.core.Metrics
import network.calimero.updates.core.People
import network.calimero.updates.generated.MetricSeries
import network.calimero.updates.generated.PostCard

/** A two-way segmented control, lime when selected. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Segments(
    labels: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        labels.forEachIndexed { i, label ->
            SegmentedButton(
                selected = selected == i,
                onClick = { onSelect(i) },
                shape = SegmentedButtonDefaults.itemShape(i, labels.size),
                colors = SegmentedButtonDefaults.colors(activeContainerColor = Palette.lime, activeContentColor = Palette.ink),
            ) { Text(label) }
        }
    }
}

/** Every ask across the updates, and the ledger of accepted offers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AsksTab(
    audience: AudienceModel,
    nav: AudienceNav,
) {
    val model = remember(audience) { AsksModel(audience) }
    val version by audience.version.collectAsState()
    val me by audience.me.collectAsState()
    val asks by model.asks.collectAsState()
    val contributions by model.contributions.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val status by model.status.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val isTeam = me?.isTeam == true

    LaunchedEffect(model, version) { model.load() }

    Scaffold(containerColor = Palette.background, topBar = { AudienceTopBar(audience, nav) }) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch {
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                item {
                    PageHeader(
                        "Asks",
                        if (isTeam) "Every request for help across your updates, and the offers that came in." else "Specific ways you can help the team right now.",
                    )
                }
                item { Segments(listOf("Open", "Resolved"), if (status == "open") 0 else 1) { scope.launch { model.show(if (it == 0) "open" else "resolved") } } }
                if (error != null) item { UpdatesCard { ErrorLine(error) } }
                when {
                    !loaded -> item { SkeletonCard() }
                    asks.isEmpty() ->
                        item {
                            UpdatesCard {
                                EmptyState(
                                    Icons.Outlined.PanTool,
                                    if (status == "open") "No open asks." else "Nothing resolved yet.",
                                    if (isTeam) {
                                        "Add asks to an update — intros, hires, customers, advice. They collect here."
                                    } else {
                                        "When the team asks for help, it shows up here."
                                    },
                                )
                            }
                        }
                    else -> items(asks, key = { it.id }) { AskCard(it, audience, isTeam, onOpenPost = nav.openPost) }
                }
                if (contributions.isNotEmpty()) {
                    item { SectionLabel("Contributions") }
                    item {
                        Text(
                            "Accepted offers of help. The composer can thank everyone since the last update in one tap.",
                            color = Palette.ink2,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(horizontal = 4.dp),
                        )
                    }
                    item {
                        UpdatesCard(padding = 12.dp) {
                            contributions.forEach { c ->
                                Row(verticalAlignment = Alignment.Top) {
                                    Avatar(c.account, c.name, size = 32.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Row {
                                            Text(People.label(c.name, c.account), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                                            if (c.firm.isNotEmpty()) Text(" · ${c.firm}", color = Palette.ink2, fontSize = 13.sp)
                                        }
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Glyphs.askKind(c.askKind), contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(13.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text("${AskKind.of(c.askKind).label} · ${c.askTitle}", color = Palette.ink2, fontSize = 13.sp, maxLines = 2)
                                        }
                                    }
                                    Text(Format.formatDate(c.acceptedAt), color = Palette.ink3, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Questions and answers everyone in this audience can read. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuestionsTab(
    audience: AudienceModel,
    nav: AudienceNav,
) {
    val model = remember(audience) { QuestionsModel(audience) }
    val version by audience.version.collectAsState()
    val me by audience.me.collectAsState()
    val questions by model.questions.collectAsState()
    val openOnly by model.openOnly.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    var asking by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val isTeam = me?.isTeam == true
    val shown = model.shown(questions, openOnly)

    LaunchedEffect(model, version) { model.load() }

    Scaffold(containerColor = Palette.background, topBar = { AudienceTopBar(audience, nav) }) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch {
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                item { PageHeader("Q&A", "Questions and answers everyone in this audience can read.") }
                item {
                    PrimaryButton(
                        if (isTeam) "Start a thread" else "Ask the team",
                        onClick = { asking = true },
                        icon = Icons.Outlined.QuestionAnswer,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item { Segments(listOf("All", "Unanswered"), if (openOnly) 1 else 0) { model.openOnly.value = it == 1 } }
                if (error != null) item { UpdatesCard { ErrorLine(error) } }
                when {
                    !loaded -> item { SkeletonCard(72.dp) }
                    shown.isEmpty() ->
                        item {
                            UpdatesCard {
                                EmptyState(
                                    Icons.Outlined.QuestionAnswer,
                                    if (openOnly) "Nothing waiting on an answer." else "No questions yet.",
                                    "Questions and answers are visible to everyone in this audience.",
                                )
                            }
                        }
                    else ->
                        item {
                            UpdatesCard(padding = 4.dp) {
                                shown.forEachIndexed { i, q ->
                                    QuestionRow(q) { nav.openPost(q.id) }
                                    if (i < shown.size - 1) HorizontalDivider(color = Palette.hairline, modifier = Modifier.padding(start = 56.dp))
                                }
                            }
                        }
                }
            }
        }
    }

    if (asking) {
        AskQuestionSheet(model, isTeam, onDismiss = { asking = false }) { id ->
            asking = false
            nav.openPost(id)
        }
    }
}

@Composable
private fun QuestionRow(
    question: PostCard,
    onOpen: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onOpen)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(question.author, question.authorName, team = question.authorIsTeam, size = 34.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(question.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("${People.label(question.authorName, question.author)} · ${Format.timeAgo(question.createdAt)}", color = Palette.ink2, fontSize = 12.sp)
        }
        Spacer(Modifier.width(4.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Badge(if (question.status == "answered") "Answered" else "Open", if (question.status == "answered") BadgeTone.GOOD else BadgeTone.WARN)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(3.dp))
                Text("${question.commentCount}", color = Palette.ink2, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun AskQuestionSheet(
    model: QuestionsModel,
    isTeam: Boolean,
    onDismiss: () -> Unit,
    onPosted: (String) -> Unit,
) {
    val posting by model.isPosting.collectAsState()
    val error by model.error.collectAsState()
    var title by remember { mutableStateOf("") }
    var details by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { model.error.value = null }
    UpdatesSheet(if (isTeam) "Start a thread" else "Ask the team", onDismiss) {
        InputField(
            title,
            { title = it },
            if (isTeam) "e.g. “Office hours this Friday — bring questions”" else "e.g. “What's the runway after the new hires?”",
            maxLength = Limits.TITLE,
            singleLine = false,
            maxLines = 3,
        )
        InputField(details, { details = it }, "Details (optional)", singleLine = false, minLines = 3, maxLines = 8)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Visibility, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Everyone in this audience can read the thread.", color = Palette.ink2, fontSize = 13.sp)
        }
        ErrorLine(error)
        PrimaryButton(
            if (posting) "Posting…" else "Post",
            onClick = { scope.launch { model.ask(title, details)?.let(onPosted) } },
            enabled = title.isNotBlank(),
            busy = posting,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Every metric reported in an update, as a series. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KpisTab(
    audience: AudienceModel,
    nav: AudienceNav,
) {
    val model = remember(audience) { MetricsModel(audience) }
    val version by audience.version.collectAsState()
    val series by model.series.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model, version) { model.load() }

    Scaffold(containerColor = Palette.background, topBar = { AudienceTopBar(audience, nav) }) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch {
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                item { PageHeader("KPIs", "Every metric reported in an update, as a series. Nothing is typed twice.") }
                if (error != null) item { UpdatesCard { ErrorLine(error) } }
                when {
                    !loaded -> item { SkeletonCard(160.dp) }
                    series.isEmpty() ->
                        item {
                            UpdatesCard {
                                EmptyState(Icons.Outlined.BarChart, "No KPIs reported yet.", "KPIs added to an update show up here as a trend, one line per metric.")
                            }
                        }
                    else -> items(series, key = { it.name.lowercase() }) { MetricCard(it, nav.openPost) }
                }
            }
        }
    }
}

@Composable
private fun MetricCard(
    series: MetricSeries,
    openPost: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val last = series.points.last()
    UpdatesCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(series.name.uppercase(), color = Palette.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp, modifier = Modifier.weight(1f))
            Text("as of ${Format.formatDate(last.at)}", color = Palette.ink3, fontSize = 12.sp)
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(last.value, style = displayStyle(30.sp))
            if (series.unit.isNotEmpty()) {
                Spacer(Modifier.width(4.dp))
                Text(series.unit, color = Palette.ink2, fontSize = 15.sp, modifier = Modifier.padding(bottom = 4.dp))
            }
        }
        val delta = Metrics.latestDelta(series)
        if (delta != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                DeltaLabel(delta)
                Spacer(Modifier.width(6.dp))
                Text("since last report", color = Palette.ink3, fontSize = 12.sp)
            }
        } else {
            Text("First report", color = Palette.ink3, fontSize = 12.sp)
        }
        Sparkline(series.points.map { it.value })
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .clickable { expanded = !expanded }
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "${series.points.size} report${if (series.points.size == 1) "" else "s"}",
                color = Palette.ink2,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null, tint = Palette.ink2)
        }
        AnimatedVisibility(expanded) {
            Column {
                series.points.reversed().forEach { point ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { openPost(point.postId) }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(Format.formatDate(point.at), color = Palette.ink2, fontSize = 13.sp, modifier = Modifier.width(100.dp))
                        Text(point.postTitle, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(point.value, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
