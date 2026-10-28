package network.calimero.forum.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.outlined.Create
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.RemoveModerator
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.forum.core.FeedModel
import network.calimero.forum.core.FeedSort
import network.calimero.forum.core.ForumErrorText
import network.calimero.forum.core.ForumFormat
import network.calimero.forum.core.ForumsModel
import network.calimero.forum.core.LoadPhase
import network.calimero.forum.generated.PostView

/** A destructive action waiting for a yes. */
data class Confirm(
    val title: String,
    val message: String,
    val action: String,
    val run: suspend () -> Unit,
)

/** One forum's timeline: Latest or Top, a compose button, and every post's actions. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun FeedScreen(
    model: FeedModel,
    back: () -> Unit,
    open: (String) -> Unit,
) {
    val posts by model.posts.collectAsState()
    val phase by model.phase.collectAsState()
    val sort by model.sort.collectAsState()
    val hasMore by model.hasMore.collectAsState()
    val notice by model.notice.collectAsState()
    val name by model.displayName.collectAsState()
    model.moderators.collectAsState().value
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    var refreshing by remember { mutableStateOf(false) }
    var composing by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<PostView?>(null) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    var showInfo by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.start() }
    LaunchedEffect(model) { model.watch() }

    fun askDelete(post: PostView) {
        confirm = Confirm("Delete this post?", "Its replies go with it.", "Delete") { model.delete(post) }
    }

    fun askRemove(post: PostView) {
        confirm =
            Confirm("Remove this post?", "As a moderator you can remove anyone's post. It's removed for everyone.", "Remove") {
                model.moderate(post)
            }
    }

    Scaffold(
        containerColor = Palette.Surface,
        topBar = {
            ForumTopBar(
                title = model.forum.forumName,
                subtitle = model.forum.spaceName,
                navigation = { BackButton(back) },
                actions = { IconButton(onClick = { showInfo = true }) { Icon(Icons.Outlined.Info, contentDescription = "About this forum") } },
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { composing = true },
                shape = CircleShape,
                containerColor = Palette.Lime,
                contentColor = Palette.Ink,
                elevation = FloatingActionButtonDefaults.elevation(defaultElevation = 6.dp),
            ) { Icon(Icons.Outlined.Create, contentDescription = "New post") }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.refresh()
                    refreshing = false
                }
            },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                stickyHeader { SortTabs(sort) { scope.launch { model.setSort(it) } } }
                item { NoticeBanner(notice) { model.dismissNotice() } }
                when (val p = phase) {
                    LoadPhase.Loading -> items(4) { SkeletonPost() }
                    is LoadPhase.Failed -> item { ErrorState(p.message) { scope.launch { model.refresh() } } }
                    LoadPhase.Loaded ->
                        if (posts.isEmpty()) {
                            item {
                                EmptyState(Icons.Outlined.Forum, "No discussions yet", "Start the first discussion.", "New post") { composing = true }
                            }
                        } else {
                            items(posts, key = { it.id }) { post ->
                                val mine = model.isMine(post)
                                Swipeable(
                                    enabled = mine || model.isModerator,
                                    mine = mine,
                                    onSwipe = { if (mine) askDelete(post) else askRemove(post) },
                                ) {
                                    PostRow(
                                        post = post,
                                        isMine = mine,
                                        isModerator = model.isModerator,
                                        open = { open(post.id) },
                                        vote = { value -> scope.launch { model.vote(post, value) } },
                                        edit = { editing = post },
                                        delete = { askDelete(post) },
                                        moderate = { askRemove(post) },
                                    )
                                }
                                Hairline()
                            }
                            if (hasMore) {
                                item {
                                    Box(Modifier.fillMaxWidth().padding(18.dp), contentAlignment = Alignment.Center) {
                                        CircularProgressIndicator(color = Palette.Muted, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                                    }
                                    LaunchedEffect(posts.size) { model.loadMore() }
                                }
                            }
                        }
                }
            }
        }
    }

    if (composing) {
        ComposeSheet("New post", "Post", name, model.account, dismiss = { composing = false }) { title, body ->
            model.createPost(title, body)
            list.scrollToItem(0)
        }
    }
    editing?.let { post ->
        ComposeSheet("Edit post", "Save", name, model.account, post.title, post.body, dismiss = { editing = null }) { title, body ->
            model.editPost(post, title, body)
        }
    }
    if (showInfo) ForumInfoSheet(model) { showInfo = false }
    ConfirmDialog(confirm) { confirm = null }
}

/** A row that reveals Delete (yours) or Remove (as moderator) when swiped from the end. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Swipeable(
    enabled: Boolean,
    mine: Boolean,
    onSwipe: () -> Unit,
    content: @Composable () -> Unit,
) {
    if (!enabled) {
        content()
        return
    }
    val state =
        rememberSwipeToDismissBoxState(
            confirmValueChange = {
                if (it == SwipeToDismissBoxValue.EndToStart) onSwipe()
                false
            },
        )
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Row(
                Modifier.fillMaxSize().background(Palette.Danger).padding(horizontal = 24.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (mine) Icons.Outlined.Delete else Icons.Outlined.RemoveModerator, contentDescription = null, tint = Color.White)
                Spacer(Modifier.width(8.dp))
                Text(if (mine) "Delete" else "Remove", color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        },
    ) { content() }
}

@Composable
fun ConfirmDialog(
    confirm: Confirm?,
    dismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    confirm ?: return
    AlertDialog(
        onDismissRequest = dismiss,
        containerColor = Palette.Surface,
        title = { Text(confirm.title, fontWeight = FontWeight.Bold) },
        text = { Text(confirm.message, color = Palette.Muted) },
        confirmButton = {
            TextButton(onClick = {
                dismiss()
                scope.launch { confirm.run() }
            }) { Text(confirm.action, color = Palette.Danger, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = dismiss) { Text("Cancel", color = Palette.Ink) } },
    )
}

/** Latest / Top, as a timeline's tabs: the selected one bold with a lime bar. */
@Composable
fun SortTabs(
    sort: FeedSort,
    select: (FeedSort) -> Unit,
) {
    Column(Modifier.background(Palette.Surface)) {
        Row(Modifier.fillMaxWidth()) {
            FeedSort.entries.forEach { option ->
                Column(
                    Modifier.weight(1f).clickable { select(option) }.padding(top = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        option.label,
                        fontSize = 15.sp,
                        fontWeight = if (option == sort) FontWeight.Bold else FontWeight.Medium,
                        color = if (option == sort) Palette.Ink else Palette.Muted,
                    )
                    Spacer(Modifier.height(10.dp))
                    Box(
                        Modifier
                            .width(56.dp)
                            .height(4.dp)
                            .clip(CircleShape)
                            .background(if (option == sort) Palette.Lime else Color.Transparent),
                    )
                }
            }
        }
        Hairline()
    }
}

@Composable
fun SkeletonPost() {
    Row(Modifier.padding(16.dp)) {
        Skeleton(44.dp, 44.dp, CircleShape)
        Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Skeleton(160.dp, 12.dp)
            Skeleton(null, 14.dp)
            Skeleton(220.dp, 12.dp)
        }
    }
}

/** About this forum: your name here, its moderators, inviting people, and its ids. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ForumInfoSheet(
    model: FeedModel,
    dismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val moderators by model.moderators.collectAsState()
    val displayName by model.displayName.collectAsState()
    var name by remember { mutableStateOf(displayName) }
    var savingName by remember { mutableStateOf(false) }
    var nameError by remember { mutableStateOf<String?>(null) }
    var newModerator by remember { mutableStateOf("") }
    var moderatorError by remember { mutableStateOf<String?>(null) }
    var inviting by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    LaunchedEffect(model) { model.loadModerators() }

    fun change(run: suspend () -> Unit) {
        moderatorError = null
        scope.launch { runCatching { run() }.onFailure { moderatorError = ForumErrorText.describe(it) } }
    }

    ModalBottomSheet(onDismissRequest = dismiss, containerColor = Palette.Surface) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(model.forum.forumName, seed = model.forum.forumId, size = 52.dp, square = true, icon = Icons.Filled.Tag)
                Column(Modifier.padding(start = 14.dp)) {
                    Text(model.forum.forumName, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Palette.Ink)
                    Text("in ${model.forum.spaceName}", fontSize = 14.sp, color = Palette.Muted)
                }
            }
            Text(
                "${model.forum.forumName} lives on the members' own nodes. Posts replicate peer to peer, with no server in between.",
                fontSize = 15.sp,
                color = Palette.InkSoft,
            )
            SecondaryButton("Invite people to this forum", { inviting = true }, icon = Icons.Outlined.PersonAdd)

            SectionHeader("Your name")
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = { Text("Pick a name") },
                    singleLine = true,
                    colors = filledFieldColors(),
                    shape =
                        androidx.compose.foundation.shape
                            .RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    modifier = Modifier.weight(1f),
                )
                if (name.trim() != displayName) {
                    Spacer(Modifier.width(10.dp))
                    PrimaryButton("Save", {
                        savingName = true
                        nameError = null
                        scope.launch {
                            runCatching { model.rename(name) }.onFailure { nameError = ForumErrorText.describe(it) }
                            savingName = false
                        }
                    }, compact = true, busy = savingName)
                }
            }
            nameError?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
            Footnote("Shown on your posts and replies here. Names aren't unique, so your account id is always shown beside it.")

            SectionHeader("Moderators")
            moderators.forEach { account ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(ForumFormat.shortAccount(account), seed = account, size = 32.dp)
                    Text(ForumFormat.shortAccount(account), fontSize = 15.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(start = 12.dp).weight(1f))
                    if (account.equals(model.account, ignoreCase = true)) Badge("You")
                    if (model.isModerator && moderators.size > 1) {
                        IconButton(onClick = {
                            confirm =
                                Confirm("Remove this moderator?", "They will no longer be able to remove posts and replies.", "Remove") {
                                    change { model.removeModerator(account) }
                                }
                        }) { Icon(Icons.Outlined.RemoveModerator, contentDescription = "Remove moderator", tint = Palette.Danger) }
                    }
                }
            }
            if (model.isModerator) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextField(
                        value = newModerator,
                        onValueChange = { newModerator = it },
                        placeholder = { Text("Account id to add") },
                        singleLine = true,
                        textStyle =
                            androidx.compose.ui.text
                                .TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp),
                        colors = filledFieldColors(),
                        shape =
                            androidx.compose.foundation.shape
                                .RoundedCornerShape(12.dp),
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(10.dp))
                    PrimaryButton("Add", {
                        change {
                            model.addModerator(newModerator)
                            newModerator = ""
                        }
                    }, enabled = newModerator.isNotBlank(), compact = true)
                }
            }
            moderatorError?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
            Footnote(
                if (model.isModerator) {
                    "You're a moderator. Moderators can remove anyone's posts and replies, and choose who else moderates."
                } else {
                    "Moderators can remove anyone's posts and replies."
                },
            )
            Hairline()
            DetailsDisclosure(
                listOf(
                    "Context ID" to model.forum.contextId,
                    "Forum ID" to model.forum.forumId,
                    "Space ID" to model.forum.namespaceId,
                    "Your account" to model.account,
                ),
            )
        }
    }
    if (inviting) {
        InviteSheet(
            "Invite people to ${model.forum.forumName}",
            "The link joins ${model.forum.spaceName} and opens ${model.forum.forumName} straight away.",
            dismiss = { inviting = false },
        ) { ForumsModel.forumInvite(model.backend, model.forum) }
    }
    ConfirmDialog(confirm) { confirm = null }
}

@Composable
private fun SectionHeader(text: String) = Text(text.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted, modifier = Modifier.padding(top = 8.dp))

@Composable
private fun Footnote(text: String) = Text(text, fontSize = 13.sp, color = Palette.Muted)
