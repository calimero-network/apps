package network.calimero.standup.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.standup.app.DecisionsModel
import network.calimero.standup.app.TeamModel
import network.calimero.standup.core.Days
import network.calimero.standup.core.DecisionDraft
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.Limits
import network.calimero.standup.generated.DecisionView

/** The Decisions tab: search, filters, the log as a list or a timeline. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DecisionsTab(
    team: TeamModel,
    model: DecisionsModel,
    onNew: (DecisionDraft) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val version by team.version.collectAsState()
    val search by model.search.collectAsState()
    val tag by model.tag.collectAsState()
    val standingOnly by model.standingOnly.collectAsState()
    val items by model.items.collectAsState()
    val tags by model.tags.collectAsState()
    val hasMore by model.hasMore.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val loading by model.isLoading.collectAsState()
    val error by model.error.collectAsState()
    var timeline by rememberSaveable { mutableStateOf(false) }
    var detail by remember { mutableStateOf<DecisionView?>(null) }

    LaunchedEffect(model, version) { model.load() }
    LaunchedEffect(search) {
        delay(300)
        model.refilter()
    }

    fun open(id: String) {
        scope.launch { model.decision(id)?.let { detail = it } }
    }

    Scaffold(
        containerColor = Palette.background,
        topBar = { TabBar(team.title) },
        floatingActionButton = {
            FloatingActionButton(onClick = { onNew(DecisionDraft.start()) }, containerColor = Palette.lime, contentColor = Palette.ink) {
                Icon(Icons.Filled.Add, contentDescription = "Log a decision")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading && loaded,
            onRefresh = { scope.launch { model.load() } },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                item {
                    OutlinedTextField(
                        value = search,
                        onValueChange = { model.search.value = it },
                        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                        placeholder = { Text("Search titles, decisions, reasons and tags", color = Palette.ink3) },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        colors =
                            OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = Palette.surface,
                                unfocusedContainerColor = Palette.surface,
                                focusedBorderColor = Palette.ink,
                                unfocusedBorderColor = Palette.hairline,
                            ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                            listOf("List", "Timeline").forEachIndexed { i, label ->
                                SegmentedButton(
                                    selected = timeline == (i == 1),
                                    onClick = { timeline = i == 1 },
                                    shape = SegmentedButtonDefaults.itemShape(i, 2),
                                    colors =
                                        SegmentedButtonDefaults.colors(
                                            activeContainerColor = Palette.lime,
                                            activeContentColor = Palette.ink,
                                            inactiveContainerColor = Palette.surface,
                                            activeBorderColor = Palette.hairline,
                                            inactiveBorderColor = Palette.hairline,
                                        ),
                                ) { Text(label) }
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        Chip("Standing only", selected = standingOnly, onClick = {
                            model.standingOnly.value = !standingOnly
                            scope.launch { model.refilter() }
                        })
                    }
                }
                if (tags.isNotEmpty()) {
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(tags, key = { it.tag }) { t ->
                                Chip("#${t.tag}", selected = tag == t.tag, trailing = t.count.toString(), onClick = { scope.launch { model.toggleTag(t.tag) } })
                            }
                        }
                    }
                }
                if (error != null) item { ErrorLine(error) }
                if (!loaded && loading) item { Muted("Loading…") }
                if (loaded && items.isEmpty()) {
                    item {
                        if (model.isFiltered) {
                            EmptyState(Icons.Outlined.Search, "No decision matches that.")
                        } else {
                            EmptyState(
                                Icons.Outlined.Verified,
                                "No decisions yet.",
                                "Log the first one. Six months from now, “why did we do it this way?” will have an answer.",
                            )
                        }
                    }
                }
                if (timeline) {
                    for (month in model.months) {
                        item(key = "m:" + month.title) { SectionLabel(month.title) }
                        items(month.items, key = { "t:" + it.id }) { d -> TimelineEntry(team, d) { detail = d } }
                    }
                } else {
                    items(items, key = { it.id }) { d ->
                        DecisionCard(
                            team,
                            model,
                            d,
                            onOpen = { detail = d },
                            onJump = ::open,
                            onTag = { t -> scope.launch { model.toggleTag(t) } },
                            onSupersede = { onNew(DecisionDraft.start(supersedes = d)) },
                        )
                    }
                }
                if (hasMore) {
                    item { SecondaryButton("Show older", onClick = { scope.launch { model.showOlder() } }, modifier = Modifier.fillMaxWidth()) }
                }
            }
        }
    }

    detail?.let { d ->
        DecisionDetail(team, model, d, onDismiss = { detail = null }, onJump = ::open, onSupersede = {
            detail = null
            onNew(DecisionDraft.start(supersedes = d))
        })
    }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
private fun DecisionCard(
    team: TeamModel,
    model: DecisionsModel,
    d: DecisionView,
    onOpen: () -> Unit,
    onJump: (String) -> Unit,
    onTag: (String) -> Unit,
    onSupersede: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val replaced = d.supersededBy.isNotEmpty()
    Box {
        StandupCard(Modifier.clip(RoundedCornerShape(14.dp)).combinedClickable(onClick = onOpen, onLongClick = { if (!replaced) menu = true })) {
            DecisionBody(team, model, d, onJump, onTag)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text("Supersede") },
                leadingIcon = { Icon(Icons.Outlined.Sync, contentDescription = null) },
                onClick = {
                    menu = false
                    onSupersede()
                },
            )
        }
    }
}

/** Title, badge, decision, why, tags, people, meta and the supersede links. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DecisionBody(
    team: TeamModel,
    model: DecisionsModel,
    d: DecisionView,
    onJump: (String) -> Unit,
    onTag: ((String) -> Unit)?,
) {
    val replaced = d.supersededBy.isNotEmpty()
    Row(verticalAlignment = Alignment.Top) {
        Text(d.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Badge(if (replaced) "Superseded" else "Standing", lime = !replaced)
    }
    RichTextView(d.decision)
    if (d.rationale.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Why", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
            RichTextView(d.rationale)
        }
    }
    if (d.tags.isNotEmpty() || d.with.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (t in d.tags) Chip("#$t", onClick = onTag?.let { { it(t) } })
            if (d.with.isNotEmpty()) {
                Text("with", color = Palette.ink2, fontSize = 14.sp, modifier = Modifier.align(Alignment.CenterVertically))
                for (p in d.with) Chip(team.name(p.account, p.name), leading = { Avatar(p.account, p.name, 18.dp) })
            }
        }
    }
    val meta =
        buildString {
            append(team.name(d.author, d.authorName))
            append(" · ")
            append(Days.relative(d.createdAt))
            if (d.fromDay.isNotEmpty()) append(" · from the ${Days.describe(d.fromDay).lowercase()} standup")
        }
    Text(meta, fontSize = 13.sp, color = Palette.ink3)
    if (d.supersedes.isNotEmpty()) {
        LinkButton("Replaces “${model.title(d.supersedes) ?: "an earlier decision"}”", onClick = { onJump(d.supersedes) })
    }
    if (replaced) {
        LinkButton("Replaced by “${model.title(d.supersededBy) ?: "a later decision"}”", onClick = { onJump(d.supersededBy) })
    }
}

@Composable
private fun TimelineEntry(
    team: TeamModel,
    d: DecisionView,
    onOpen: () -> Unit,
) {
    val replaced = d.supersededBy.isNotEmpty()
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 4.dp)) {
        Box(
            Modifier
                .padding(top = 6.dp)
                .size(10.dp)
                .clip(CircleShape)
                .background(if (replaced) Palette.ink3 else Palette.lime),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(d.title, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f, fill = false))
                if (replaced) {
                    Spacer(Modifier.width(6.dp))
                    Badge("Superseded", lime = false)
                }
            }
            Text("${Days.shortDate(d.createdAt)} · ${team.name(d.author, d.authorName)}", fontSize = 13.sp, color = Palette.ink3)
            Text(d.decision.lineSequence().first(), fontSize = 14.sp, color = Palette.ink2)
        }
    }
}

/** One decision, full screen, with Supersede and its Details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DecisionDetail(
    team: TeamModel,
    model: DecisionsModel,
    d: DecisionView,
    onDismiss: () -> Unit,
    onJump: (String) -> Unit,
    onSupersede: () -> Unit,
) {
    var details by remember(d.id) { mutableStateOf(false) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(
            containerColor = Palette.background,
            topBar = {
                TopAppBar(
                    title = { Text("Decision", fontWeight = FontWeight.SemiBold) },
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
                )
            },
        ) { padding ->
            LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item { StandupCard { DecisionBody(team, model, d, onJump, onTag = null) } }
                if (d.supersededBy.isEmpty()) {
                    item { PrimaryButton("Supersede", onClick = onSupersede, icon = Icons.Outlined.Sync, modifier = Modifier.fillMaxWidth()) }
                }
                item {
                    Row(Modifier.clickable { details = !details }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Details", color = Palette.ink2, fontWeight = FontWeight.Medium)
                    }
                    if (details) {
                        Text("Decision id", fontSize = 12.sp, color = Palette.ink3)
                        Text(d.id, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                        Text("Author", fontSize = 12.sp, color = Palette.ink3)
                        Text(d.author, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

/** Log a decision, or supersede one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DecisionSheet(
    team: TeamModel,
    model: DecisionsModel,
    start: DecisionDraft,
    onDismiss: () -> Unit,
    onLogged: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val members by team.members.collectAsState()
    var draft by remember(start) { mutableStateOf(start) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val superseding = draft.supersedes
    StandupSheet(if (superseding != null) "Supersede a decision" else "Log a decision", onDismiss) {
        if (superseding != null) {
            Muted("Replacing “${superseding.title}”. The original stays in the log, marked superseded.")
        }
        draft.fromDay?.let { day ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("From the ${Days.describe(day).lowercase()} standup", color = Palette.ink2, modifier = Modifier.weight(1f))
                LinkButton("Remove", onClick = { draft = draft.copy(fromDay = null) })
            }
        }
        LabeledField("Title", draft.title, { draft = draft.copy(title = it) }, "Release every two weeks", Limits.TITLE, singleLine = true)
        LabeledField("Decision", draft.decision, { draft = draft.copy(decision = it) }, "What exactly was decided", Limits.BODY, minLines = 2)
        LabeledField("Why", draft.rationale, { draft = draft.copy(rationale = it) }, "Context, options considered, why this one", Limits.BODY, minLines = 2)
        LabeledField("Tags", draft.tagsInput, { draft = draft.copy(tagsInput = it) }, "infra, release process", 400, singleLine = true)
        if (draft.tags.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (t in draft.tags) Chip("#$t")
            }
        }
        if (members.isNotEmpty()) {
            Text("Decided with", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (m in members) {
                    val on = m.account in draft.with
                    Chip(team.name(m.account, m.name), selected = on, leading = { Avatar(m.account, m.name, 18.dp) }, onClick = {
                        draft = draft.copy(with = if (on) draft.with - m.account else draft.with + m.account)
                    })
                }
            }
        }
        Text("Decisions can't be edited once logged. Supersede one to change course.", fontSize = 13.sp, color = Palette.ink3)
        ErrorLine(error)
        PrimaryButton(
            if (busy) {
                "Logging…"
            } else if (superseding != null) {
                "Log replacement"
            } else {
                "Log decision"
            },
            busy = busy,
            enabled = draft.isReady,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                busy = true
                scope.launch {
                    try {
                        model.log(draft)
                        onLogged()
                    } catch (e: Exception) {
                        error = ErrorText.describe(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
        LinkButton("Cancel", onClick = onDismiss, modifier = Modifier.fillMaxWidth())
    }
}
