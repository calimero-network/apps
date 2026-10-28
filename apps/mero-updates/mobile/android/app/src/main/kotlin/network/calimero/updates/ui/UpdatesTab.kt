package network.calimero.updates.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.FeedModel
import network.calimero.updates.core.ComposerStart
import network.calimero.updates.core.Format
import network.calimero.updates.core.People
import network.calimero.updates.core.UpdateTemplate
import network.calimero.updates.generated.CategoryView
import network.calimero.updates.generated.DraftView
import network.calimero.updates.generated.PostCard

/**
 * The home tab. The team sees what is due, templates, drafts and the setup checklist above the feed;
 * an investor sees the feed, unread first.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdatesTab(
    audience: AudienceModel,
    nav: AudienceNav,
) {
    val model = remember(audience) { FeedModel(audience) }
    val version by audience.version.collectAsState()
    val me by audience.me.collectAsState()
    val overview by audience.overview.collectAsState()
    val categories by audience.categories.collectAsState()
    val posts by model.posts.collectAsState()
    val drafts by model.drafts.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val loading by model.isLoading.collectAsState()
    val category by model.category.collectAsState()
    val error by model.error.collectAsState()
    val audienceError by audience.error.collectAsState()
    val audienceLoaded by audience.hasLoaded.collectAsState()
    model.investorCount.collectAsState().value
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf(false) }
    val isTeam = me?.isTeam == true

    LaunchedEffect(model, version) { model.load() }

    fun run(step: FeedModel.SetupStep) {
        when (step.target) {
            FeedModel.SetupStep.Target.SETTINGS -> nav.openSettings()
            FeedModel.SetupStep.Target.COMPOSE -> nav.compose(ComposerStart.Template("monthly"))
            FeedModel.SetupStep.Target.INVITE ->
                scope.launch {
                    runCatching { audience.invitation() }.onSuccess {
                        nav.invite(
                            InviteShare(
                                it,
                                "Opening the link puts your investors straight into ${audience.audience.title}. Anyone with the link joins as a reader.",
                            ),
                        )
                    }
                }
        }
    }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            AudienceTopBar(audience, nav) {
                if (isTeam) {
                    IconButton(onClick = { nav.compose(ComposerStart.Template("monthly")) }) {
                        Icon(Icons.Outlined.EditNote, contentDescription = "New update")
                    }
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading && loaded,
            onRefresh = {
                scope.launch {
                    audience.bump()
                    audience.load()
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                if (audience.needsProfile) item { ProfilePrompt(isTeam) { profile = true } }
                if (audienceError != null && !audienceLoaded) item { UpdatesCard { ErrorLine(audienceError) } }
                item {
                    PageHeader(
                        "Updates",
                        if (isTeam) {
                            "What you have sent this audience, and what is due next."
                        } else {
                            "Everything ${if (overview?.companyName.isNullOrEmpty()) "the team" else audience.companyTitle} has shared with you, newest first."
                        },
                    )
                }
                if (isTeam) {
                    item {
                        PrimaryButton(
                            "New update",
                            onClick = { nav.compose(ComposerStart.Template("monthly")) },
                            icon = Icons.Outlined.EditNote,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    overview?.let { o ->
                        if (o.nextDueAt > 0uL) item { DueCard(o.nextDueAt, o.cadenceDays, o.lastUpdateAt) }
                    }
                    item { SectionLabel("Start from a template") }
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if ((overview?.updatesTotal ?: 0uL) > 0uL) {
                                item {
                                    TemplateCard(Icons.Outlined.Repeat, true, "Reuse the last one", "Same sections and KPIs, fresh numbers.") {
                                        nav.compose(ComposerStart.ReuseLatest)
                                    }
                                }
                            }
                            items(UpdateTemplate.all.take(4), key = { it.id }) { t ->
                                TemplateCard(Icons.AutoMirrored.Outlined.Article, false, t.name, t.description) {
                                    nav.compose(ComposerStart.Template(t.id))
                                }
                            }
                        }
                    }
                    if (drafts.isNotEmpty()) {
                        item { SectionLabel("Drafts", trailing = "Private until you publish") }
                        item {
                            UpdatesCard(padding = 4.dp) {
                                drafts.forEach { draft ->
                                    DraftRow(draft, onOpen = { nav.compose(ComposerStart.Draft(draft.id)) }) {
                                        scope.launch { model.discard(draft) }
                                    }
                                }
                            }
                        }
                    }
                    if (loaded && !model.setupDone) item { Checklist(model.setupSteps, ::run) }
                    item { SectionLabel("Published") }
                }
                if (categories.isNotEmpty()) {
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            item { Chip("All", selected = category == null, onClick = { scope.launch { model.select(null) } }) }
                            items(categories, key = { it.id }) { c ->
                                CategoryChip(c, selected = category == c.id, count = if (c.muted) 0uL else c.unreadCount) {
                                    scope.launch { model.select(c.id) }
                                }
                            }
                        }
                    }
                }
                if (error != null) item { UpdatesCard { ErrorLine(error) } }
                when {
                    !loaded -> {
                        item { SkeletonCard() }
                        item { SkeletonCard() }
                    }
                    posts.isEmpty() ->
                        item {
                            UpdatesCard {
                                EmptyState(
                                    Icons.AutoMirrored.Outlined.Article,
                                    if (category == null) "No updates yet." else "Nothing in this category yet.",
                                    if (isTeam) {
                                        "Pick a template above — your investors see it the moment their node syncs."
                                    } else {
                                        "When the team publishes, it shows up here. You can ask them something under Q&A in the meantime."
                                    },
                                )
                            }
                        }
                    else -> items(posts, key = { it.id }) { post -> UpdateRow(post, audience.category(post.categoryId)) { nav.openPost(post.id) } }
                }
            }
        }
    }
    if (profile) ProfileSheet(audience, onDismiss = { profile = false })
}

@Composable
private fun ProfilePrompt(
    isTeam: Boolean,
    onAdd: () -> Unit,
) {
    UpdatesCard {
        Row(verticalAlignment = Alignment.Top) {
            IconTile(Icons.Outlined.PersonAdd, accent = true, size = 36.dp)
            Spacer(Modifier.width(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (isTeam) "Tell your investors who you are." else "Tell the team who you are.", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(
                    if (isTeam) "Your name goes on every update you publish." else "The team sees who read, reacted and offered to help — as a name, not an account id.",
                    color = Palette.ink2,
                    fontSize = 13.sp,
                )
            }
        }
        PrimaryButton("Add your name", onClick = onAdd, compact = true)
    }
}

@Composable
private fun DueCard(
    nextDueAt: ULong,
    cadenceDays: UInt,
    lastUpdateAt: ULong,
) {
    val overdue = Format.isOverdue(nextDueAt)
    UpdatesCard(padding = 14.dp, background = if (overdue) Palette.dangerSoft else Palette.surface) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(Icons.Outlined.CalendarMonth, accent = !overdue, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(Format.dueLabel(nextDueAt), fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = if (overdue) Palette.danger else Palette.ink)
                Text("Every $cadenceDays days · last sent ${Format.timeAgo(lastUpdateAt)}", color = Palette.ink2, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun TemplateCard(
    icon: ImageVector,
    accent: Boolean,
    title: String,
    detail: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = Palette.surface,
        border = BorderStroke(1.dp, Palette.hairline),
        modifier = Modifier.width(176.dp).height(150.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            IconTile(icon, accent = accent, size = 32.dp)
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(detail, color = Palette.ink2, fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun DraftRow(
    draft: DraftView,
    onOpen: () -> Unit,
    onDiscard: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onOpen)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Badge("Draft", BadgeTone.MUTED)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(draft.title.ifEmpty { "Untitled draft" }, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Edited ${Format.timeAgo(draft.updatedAt)}", color = Palette.ink3, fontSize = 12.sp)
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, contentDescription = "Draft actions", tint = Palette.ink2) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text("Continue") },
                    leadingIcon = { Icon(Icons.Outlined.EditNote, contentDescription = null) },
                    onClick = {
                        menu = false
                        onOpen()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Discard", color = Palette.danger) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = Palette.danger) },
                    onClick = {
                        menu = false
                        onDiscard()
                    },
                )
            }
        }
    }
}

@Composable
private fun Checklist(
    steps: List<FeedModel.SetupStep>,
    onStep: (FeedModel.SetupStep) -> Unit,
) {
    UpdatesCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Getting started", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.weight(1f))
            Text("${steps.count { it.done }} of ${steps.size} done", color = Palette.ink2, fontSize = 13.sp)
        }
        steps.forEach { step ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(enabled = !step.done) { onStep(step) }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (step.done) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                    contentDescription = null,
                    tint = if (step.done) Palette.good else Palette.ink3,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    step.label,
                    fontSize = 15.sp,
                    color = if (step.done) Palette.ink2 else Palette.ink,
                    textDecoration = if (step.done) TextDecoration.LineThrough else null,
                    modifier = Modifier.weight(1f),
                )
                if (!step.done) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.ink3)
            }
        }
    }
}

/** One update in the feed. */
@Composable
fun UpdateRow(
    post: PostCard,
    category: CategoryView?,
    onOpen: () -> Unit,
) {
    Surface(
        onClick = onOpen,
        shape = RoundedCornerShape(14.dp),
        color = Palette.surface,
        border = BorderStroke(1.dp, if (post.readByMe) Palette.hairline else Palette.ink.copy(alpha = 0.25f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(post.author, post.authorName, team = post.authorIsTeam, size = 24.dp)
                Spacer(Modifier.width(8.dp))
                Text(People.label(post.authorName, post.author), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(" · ${Format.formatDate(post.createdAt)}", color = Palette.ink3, fontSize = 13.sp, maxLines = 1, modifier = Modifier.weight(1f))
                if (!post.readByMe) Badge("New")
            }
            if (category != null) CategoryChip(category)
            Text(post.title, style = displayStyle(20.sp))
            if (post.summary.isNotEmpty()) Text(post.summary, color = Palette.ink2, fontSize = 15.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                if (post.metricCount > 0uL) Stat(Icons.Outlined.BarChart, post.metricCount, "KPIs")
                if (post.openAskCount > 0uL) Stat(Icons.Outlined.PanTool, post.openAskCount, "open asks")
                if (post.commentCount > 0uL) Stat(Icons.Outlined.ChatBubbleOutline, post.commentCount, "replies")
                post.reactions.filter { it.count > 0uL }.take(3).forEach { r ->
                    Text("${r.emoji} ${r.count}", color = Palette.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
                Spacer(Modifier.weight(1f))
                Text("Read update", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
private fun Stat(
    icon: ImageVector,
    n: ULong,
    label: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = "$n $label", tint = Palette.ink2, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        Text("$n", color = Palette.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}
