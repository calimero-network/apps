package network.calimero.updates.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AddReaction
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.PostModel
import network.calimero.updates.core.Catalog
import network.calimero.updates.core.ComposerStart
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.Format
import network.calimero.updates.core.Metrics
import network.calimero.updates.core.People
import network.calimero.updates.generated.CommentView
import network.calimero.updates.generated.Metric
import network.calimero.updates.generated.PostCard

/** One update or question: the post, its KPIs and asks, reactions, and the replies with a keyboard-safe reply bar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostScreen(
    audience: AudienceModel,
    postId: String,
    nav: AudienceNav,
    onBack: () -> Unit,
) {
    val model = remember(postId) { PostModel(postId, audience) }
    val version by audience.version.collectAsState()
    val post by model.post.collectAsState()
    val comments by model.comments.collectAsState()
    model.series.collectAsState().value
    val error by model.error.collectAsState()
    val me by audience.me.collectAsState()
    val scope = rememberCoroutineScope()
    var tools by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var deleteComment by remember { mutableStateOf<CommentView?>(null) }
    var draft by remember { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<CommentView?>(null) }
    var editing by remember { mutableStateOf<CommentView?>(null) }
    var sending by remember { mutableStateOf(false) }
    var sendError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val isTeam = me?.isTeam == true
    val hasTools = model.canEdit || model.canDelete || (isTeam && model.isQuestion)

    LaunchedEffect(model, version) { model.load() }

    fun send() {
        val body = draft
        sending = true
        sendError = null
        scope.launch {
            try {
                val target = editing
                if (target != null) model.edit(target, body) else model.reply(body, replyTo?.id)
                draft = ""
                replyTo = null
                editing = null
            } catch (e: Exception) {
                sendError = ErrorText.describe(e)
            } finally {
                sending = false
            }
        }
    }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            TopAppBar(
                title = { Text(if (model.isQuestion) "Q&A" else "Update", fontWeight = FontWeight.SemiBold, fontSize = 17.sp) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (post != null && hasTools) {
                        Box {
                            IconButton(onClick = { tools = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "Post actions") }
                            DropdownMenu(expanded = tools, onDismissRequest = { tools = false }) {
                                if (model.canEdit) {
                                    DropdownMenuItem(
                                        text = { Text("Edit") },
                                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                        onClick = {
                                            tools = false
                                            nav.compose(ComposerStart.Edit(postId))
                                        },
                                    )
                                }
                                if (isTeam && model.isQuestion) {
                                    val answered = post?.card?.status == "answered"
                                    DropdownMenuItem(
                                        text = { Text(if (answered) "Re-open" else "Mark answered") },
                                        leadingIcon = {
                                            Icon(if (answered) Icons.AutoMirrored.Outlined.Undo else Icons.Outlined.CheckCircle, contentDescription = null)
                                        },
                                        onClick = {
                                            tools = false
                                            scope.launch { model.toggleAnswered() }
                                        },
                                    )
                                }
                                if (model.canDelete) {
                                    DropdownMenuItem(
                                        text = { Text("Delete", color = Palette.danger) },
                                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = Palette.danger) },
                                        onClick = {
                                            tools = false
                                            confirmDelete = true
                                        },
                                    )
                                }
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
            )
        },
        bottomBar = {
            if (post != null) {
                ReplyBar(
                    draft = draft,
                    onDraft = { draft = it },
                    placeholder = if (replyTo != null) "Write a reply…" else model.replyPlaceholder,
                    context =
                        when {
                            editing != null -> "Editing your reply"
                            replyTo != null -> "Replying to ${People.label(replyTo!!.authorName, replyTo!!.author)}"
                            else -> null
                        },
                    onCancelContext = {
                        replyTo = null
                        if (editing != null) draft = ""
                        editing = null
                    },
                    sending = sending,
                    error = sendError,
                    sendLabel = if (editing != null) "Save" else "Send",
                    onSend = ::send,
                )
            }
        },
    ) { padding ->
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
            val current = post
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp), modifier = Modifier.fillMaxSize()) {
                if (current == null) {
                    if (error != null) {
                        item { UpdatesCard { ErrorLine(error) } }
                    } else {
                        item { SkeletonCard(40.dp) }
                        item { SkeletonCard(220.dp) }
                    }
                } else {
                    item { Header(current.card, audience, isTeam, model.isQuestion) }
                    if (current.card.summary.isNotEmpty()) item { Tldr(current.card.summary) }
                    if (current.metrics.isNotEmpty()) item { KpiGrid(current.metrics) { model.previous(it)?.value } }
                    items(current.sections.size) { i ->
                        val section = current.sections[i]
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (section.title.isNotEmpty()) Text(section.title, style = displayStyle(19.sp))
                            SelectionContainer { Text(section.body, fontSize = 16.sp, lineHeight = 23.sp) }
                        }
                    }
                    if (current.asks.isNotEmpty()) {
                        item {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.PanTool, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("How you can help", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                            }
                        }
                        items(current.asks, key = { it.id }) { AskCard(it, audience, isTeam) }
                    }
                    item { Reactions(model) { emoji -> scope.launch { model.toggle(emoji) } } }
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                if (comments.isEmpty()) "Replies" else "${comments.size} repl${if (comments.size == 1) "y" else "ies"}",
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 17.sp,
                            )
                        }
                    }
                    if (comments.isEmpty()) item { Text("No replies yet. Be the first.", color = Palette.ink3, fontSize = 15.sp) }
                    items(model.topLevel, key = { it.id }) { comment ->
                        UpdatesCard(padding = 12.dp) {
                            CommentItem(comment, model, onReply = {
                                editing = null
                                replyTo = comment
                            }, onEdit = {
                                replyTo = null
                                editing = comment
                                draft = comment.body
                            }, onDelete = { deleteComment = comment })
                            model.replies(comment.id).forEach { reply ->
                                Box(Modifier.padding(start = 36.dp)) {
                                    CommentItem(reply, model, onReply = {
                                        editing = null
                                        replyTo = comment
                                    }, onEdit = {
                                        replyTo = null
                                        editing = reply
                                        draft = reply.body
                                    }, onDelete = { deleteComment = reply })
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete for everyone?") },
            confirmButton = {
                LinkButton("Delete", color = Palette.danger, onClick = {
                    confirmDelete = false
                    scope.launch { if (model.delete()) onBack() }
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { confirmDelete = false }) },
            containerColor = Palette.surface,
        )
    }
    deleteComment?.let { comment ->
        AlertDialog(
            onDismissRequest = { deleteComment = null },
            title = { Text("Delete this reply?") },
            confirmButton = {
                LinkButton("Delete", color = Palette.danger, onClick = {
                    deleteComment = null
                    scope.launch { model.delete(comment) }
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { deleteComment = null }) },
            containerColor = Palette.surface,
        )
    }
}

@Composable
private fun Header(
    card: PostCard,
    audience: AudienceModel,
    isTeam: Boolean,
    isQuestion: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (isQuestion) {
                Badge(
                    if (card.status == "answered") "Answered" else "Open question",
                    if (card.status == "answered") BadgeTone.GOOD else BadgeTone.WARN,
                )
            }
            audience.category(card.categoryId)?.let { CategoryChip(it) }
        }
        Text(card.title, style = displayStyle(28.sp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(card.author, card.authorName, team = card.authorIsTeam, size = 34.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(People.label(card.authorName, card.author), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(
                    Format.formatDate(card.createdAt) + if (card.editedAt > card.createdAt + 1000uL) " · edited" else "",
                    color = Palette.ink2,
                    fontSize = 13.sp,
                )
            }
            if (isTeam && !isQuestion) {
                Icon(Icons.Outlined.Visibility, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("${card.readCount} read", color = Palette.ink2, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
fun Tldr(summary: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.limeSoft)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("TL;DR", fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 0.6.sp)
        SelectionContainer { Text(summary, fontSize = 16.sp) }
    }
}

/** KPIs as tiles, two per row, each with its change since the previous report. */
@Composable
fun KpiGrid(
    metrics: List<Metric>,
    previous: (Metric) -> String?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        metrics.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { KpiTile(it, previous(it), Modifier.weight(1f)) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun KpiTile(
    metric: Metric,
    previous: String?,
    modifier: Modifier,
) {
    Surface(modifier = modifier, shape = RoundedCornerShape(14.dp), color = Palette.surface, border = BorderStroke(1.dp, Palette.hairline)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(metric.name.uppercase(), color = Palette.ink2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp, maxLines = 1)
            Row(verticalAlignment = Alignment.Bottom) {
                Text(metric.value, style = displayStyle(22.sp), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (metric.unit.isNotEmpty()) {
                    Spacer(Modifier.width(3.dp))
                    Text(metric.unit, color = Palette.ink2, fontSize = 12.sp, modifier = Modifier.padding(bottom = 3.dp))
                }
            }
            val delta = previous?.let { Metrics.delta(it, metric.value) }
            if (previous != null && delta != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    DeltaLabel(delta)
                    Spacer(Modifier.width(6.dp))
                    Text("vs $previous", color = Palette.ink3, fontSize = 12.sp, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun Reactions(
    model: PostModel,
    onToggle: (String) -> Unit,
) {
    var picker by remember { mutableStateOf(false) }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        items(model.usedReactions, key = { it.emoji }) { r ->
            Surface(
                onClick = { onToggle(r.emoji) },
                shape = RoundedCornerShape(999.dp),
                color = if (r.mine) Palette.lime else Palette.sunken,
                modifier = Modifier.height(34.dp),
            ) {
                Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(r.emoji)
                    Spacer(Modifier.width(4.dp))
                    Text("${r.count}", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                }
            }
        }
        item {
            Box {
                Surface(onClick = { picker = true }, shape = RoundedCornerShape(999.dp), color = Palette.sunken, modifier = Modifier.height(34.dp).width(44.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.AddReaction, contentDescription = "Add a reaction", tint = Palette.ink, modifier = Modifier.size(18.dp))
                    }
                }
                DropdownMenu(expanded = picker, onDismissRequest = { picker = false }) {
                    Catalog.reactions.forEach { emoji ->
                        DropdownMenuItem(
                            text = { Text(if (model.mine(emoji)) "$emoji  Remove" else emoji) },
                            onClick = {
                                picker = false
                                onToggle(emoji)
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CommentItem(
    comment: CommentView,
    model: PostModel,
    onReply: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(verticalAlignment = Alignment.Top) {
        Avatar(comment.author, comment.authorName, team = comment.authorIsTeam, size = 28.dp)
        Spacer(Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(People.label(comment.authorName, comment.author), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                if (comment.authorIsTeam) Badge("Team")
                Text(
                    Format.timeAgo(comment.createdAt) + if (comment.editedAt > comment.createdAt + 1000uL) " · edited" else "",
                    color = Palette.ink3,
                    fontSize = 12.sp,
                )
            }
            SelectionContainer { Text(comment.body, fontSize = 15.sp) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LinkButton("Reply", onClick = onReply)
                if (model.canEdit(comment)) LinkButton("Edit", onClick = onEdit)
                if (model.canDelete(comment)) LinkButton("Delete", color = Palette.danger, onClick = onDelete)
            }
        }
    }
}

@Composable
private fun ReplyBar(
    draft: String,
    onDraft: (String) -> Unit,
    placeholder: String,
    context: String?,
    onCancelContext: () -> Unit,
    sending: Boolean,
    error: String?,
    sendLabel: String,
    onSend: () -> Unit,
) {
    Surface(color = Palette.surface, shadowElevation = 4.dp, modifier = Modifier.imePadding()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (context != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(context, color = Palette.ink2, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    IconButton(onClick = onCancelContext, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Outlined.Close, contentDescription = "Cancel", tint = Palette.ink3, modifier = Modifier.size(18.dp))
                    }
                }
            }
            ErrorLine(error)
            Row(verticalAlignment = Alignment.Bottom) {
                TextField(
                    value = draft,
                    onValueChange = onDraft,
                    placeholder = { Text(placeholder, color = Palette.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    maxLines = 5,
                    shape = RoundedCornerShape(18.dp),
                    colors =
                        TextFieldDefaults.colors(
                            focusedContainerColor = Palette.sunken,
                            unfocusedContainerColor = Palette.sunken,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            cursorColor = Palette.ink,
                        ),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(
                    onClick = onSend,
                    enabled = !sending && draft.isNotBlank(),
                    shape = CircleShape,
                    colors =
                        IconButtonDefaults.filledIconButtonColors(
                            containerColor = Palette.lime,
                            contentColor = Palette.ink,
                            disabledContainerColor = Palette.lime.copy(alpha = 0.45f),
                            disabledContentColor = Palette.ink.copy(alpha = 0.5f),
                        ),
                    modifier = Modifier.size(48.dp),
                ) {
                    if (sending) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Outlined.ArrowUpward, contentDescription = sendLabel)
                    }
                }
            }
        }
    }
}
