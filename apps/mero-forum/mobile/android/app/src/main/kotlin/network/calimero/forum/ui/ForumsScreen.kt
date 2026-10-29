package network.calimero.forum.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.launch
import network.calimero.forum.core.ForumErrorText
import network.calimero.forum.core.ForumFormat
import network.calimero.forum.core.ForumRef
import network.calimero.forum.core.ForumRow
import network.calimero.forum.core.ForumsModel
import network.calimero.forum.core.LoadPhase

/** What an invitation is for. */
sealed interface InviteRequest {
    data object Space : InviteRequest

    data class Forum(
        val forum: ForumRow,
    ) : InviteRequest
}

/** The forums in one space. Open ones you are not in yet are joined on the way in. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ForumsScreen(
    model: ForumsModel,
    space: AppNamespace,
    back: () -> Unit,
    open: (ForumRef) -> Unit,
) {
    val forums by model.forums.collectAsState()
    val phase by model.phase.collectAsState()
    val entering by model.entering.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showNew by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf<InviteRequest?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(model) { model.load() }

    fun enter(forum: ForumRow) {
        scope.launch {
            runCatching { model.enter(forum) }
                .onSuccess(open)
                .onFailure { notice = ForumErrorText.describe(it) }
        }
    }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            ForumTopBar(
                title = model.spaceName,
                navigation = { BackButton(back) },
                actions = {
                    IconButton(onClick = { invite = InviteRequest.Space }) { Icon(Icons.Outlined.PersonAdd, contentDescription = "Invite people") }
                    IconButton(onClick = { showNew = true }) { Icon(Icons.Filled.Add, contentDescription = "New forum") }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            Column {
                NoticeBanner(notice) { notice = null }
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                            Avatar(model.spaceName, seed = space.id, size = 52.dp, square = true)
                            Column(Modifier.padding(start = 14.dp)) {
                                Text(model.spaceName, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Palette.Ink, maxLines = 2)
                                Text("Space · ${ForumFormat.count(forums.size, "forum", "forums")}", fontSize = 14.sp, color = Palette.Muted)
                            }
                        }
                    }
                    when (val p = phase) {
                        LoadPhase.Loading -> items(3) { SkeletonCard() }
                        is LoadPhase.Failed -> item { ErrorState(p.message) { scope.launch { model.load() } } }
                        LoadPhase.Loaded ->
                            if (forums.isEmpty()) {
                                item { EmptyState(Icons.Filled.Tag, "No forums yet", "Start the first forum in this space.", "New forum") { showNew = true } }
                            } else {
                                items(forums, key = { it.id }) { forum ->
                                    Box {
                                        ForumCard(
                                            forum,
                                            entering = entering == forum.id,
                                            modifier = Modifier.combinedClickable(onClick = { enter(forum) }, onLongClick = { menuFor = forum.id }),
                                        )
                                        DropdownMenu(expanded = menuFor == forum.id, onDismissRequest = { menuFor = null }, containerColor = Palette.Surface) {
                                            DropdownMenuItem(
                                                text = { Text("Invite to this forum") },
                                                leadingIcon = { Icon(Icons.Outlined.PersonAdd, null) },
                                                onClick = {
                                                    menuFor = null
                                                    invite = InviteRequest.Forum(forum)
                                                },
                                            )
                                        }
                                    }
                                }
                            }
                    }
                }
            }
        }
    }

    if (showNew) {
        NameSheet(
            title = "New forum",
            placeholder = "Forum name",
            action = "Create",
            note = "Everyone in ${model.spaceName} can join it.",
            dismiss = { showNew = false },
        ) { name -> open(model.create(name)) }
    }
    invite?.let { request ->
        val (title, subtitle) =
            when (request) {
                InviteRequest.Space -> "Invite people to ${model.spaceName}" to "Anyone with this link can join ${model.spaceName} and every forum in it."
                is InviteRequest.Forum ->
                    "Invite people to ${request.forum.name}" to "The link joins ${model.spaceName} and opens ${request.forum.name} straight away."
            }
        InviteSheet(title, subtitle, dismiss = { invite = null }) {
            when (request) {
                InviteRequest.Space -> model.spaceInvite()
                is InviteRequest.Forum -> model.forumInvite(request.forum)
            }
        }
    }
}

@Composable
private fun ForumCard(
    forum: ForumRow,
    entering: Boolean,
    modifier: Modifier,
) {
    Card(modifier = modifier) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(forum.name, seed = forum.id, size = 46.dp, square = true, icon = Icons.Filled.Tag)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(forum.name, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                when {
                    forum.contextId == null -> Text("Syncing…", fontSize = 14.sp, color = Palette.Muted)
                    forum.joined -> Badge("Joined")
                    else -> Text("Open · tap to join", fontSize = 14.sp, color = Palette.Muted)
                }
            }
            if (entering) {
                CircularProgressIndicator(color = Palette.Ink, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            } else {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
            }
        }
    }
}

/** "Invitation ready": the link, to copy or share. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteSheet(
    title: String,
    subtitle: String,
    dismiss: () -> Unit,
    mint: suspend () -> String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var link by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }

    suspend fun run() {
        error = null
        runCatching { mint() }.onSuccess { link = it }.onFailure { error = ForumErrorText.describe(it) }
    }
    LaunchedEffect(Unit) { run() }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            IconCircle(Icons.Outlined.PersonAdd, Palette.Lime)
            SheetTitle(title)
            Text(subtitle, fontSize = 15.sp, color = Palette.Muted, textAlign = TextAlign.Center)
            val current = link
            when {
                current != null -> {
                    Text(
                        current,
                        fontSize = 13.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Palette.InkSoft,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(Palette.Sunken)
                                .padding(12.dp),
                    )
                    PrimaryButton("Share link", { share(context, current) }, icon = Icons.Outlined.Share)
                    SecondaryButton(if (copied) "Copied" else "Copy link", {
                        copy(context, "Invitation link", current)
                        copied = true
                    }, icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy)
                }
                error != null -> {
                    Text(error.orEmpty(), fontSize = 15.sp, color = Palette.Danger, textAlign = TextAlign.Center)
                    PrimaryButton("Try again", { scope.launch { run() } })
                }
                else -> {
                    CircularProgressIndicator(color = Palette.Ink)
                    Text("Creating link…", fontSize = 15.sp, color = Palette.Muted)
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}
