package network.calimero.forum.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.forum.core.FeedModel
import network.calimero.forum.core.ForumErrorText
import network.calimero.forum.core.ForumFormat
import network.calimero.forum.core.LoadPhase
import network.calimero.forum.core.ThreadModel
import network.calimero.forum.generated.CommentView
import network.calimero.forum.generated.PostView

/** One post, its replies, and a reply box that stays above the keyboard. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostScreen(
    model: ThreadModel,
    feed: FeedModel,
    back: () -> Unit,
) {
    val post by model.post.collectAsState()
    val comments by model.comments.collectAsState()
    val phase by model.phase.collectAsState()
    val hasMore by model.hasMore.collectAsState()
    val loadingMore by model.isLoadingMore.collectAsState()
    val sending by model.isSending.collectAsState()
    val gone by model.isGone.collectAsState()
    val notice by model.notice.collectAsState()
    val name by feed.displayName.collectAsState()
    feed.moderators.collectAsState().value
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    var replyError by remember { mutableStateOf<String?>(null) }
    var replying by remember { mutableStateOf(false) }
    var editingPost by remember { mutableStateOf(false) }
    var editingComment by remember { mutableStateOf<CommentView?>(null) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    val replyFocus = remember { FocusRequester() }

    LaunchedEffect(model) { model.load() }
    LaunchedEffect(model) { model.watch() }
    LaunchedEffect(post) { post?.let(feed::update) }
    LaunchedEffect(gone) {
        if (gone) {
            feed.forget(model.postId)
            back()
        }
    }

    fun askComment(
        comment: CommentView,
        mine: Boolean,
    ) {
        confirm =
            if (mine) {
                Confirm("Delete this reply?", "This can't be undone.", "Delete") { model.deleteComment(comment) }
            } else {
                Confirm("Remove this reply?", "As a moderator you can remove anyone's reply. It's removed for everyone.", "Remove") {
                    model.moderateComment(comment)
                }
            }
    }

    Scaffold(
        containerColor = Palette.Surface,
        topBar = { ForumTopBar(title = "Post", navigation = { BackButton(back) }) },
        bottomBar = {
            Column(Modifier.background(Palette.Surface).navigationBarsPadding().imePadding()) {
                Hairline()
                replyError?.let { Text(it, fontSize = 13.sp, color = Palette.Danger, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.Bottom) {
                    Avatar(name.ifEmpty { "You" }, seed = feed.account, size = 32.dp)
                    Spacer(Modifier.width(10.dp))
                    TextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = { Text("Post your reply") },
                        textStyle = TextStyle(fontSize = 16.sp),
                        maxLines = 5,
                        colors = filledFieldColors(),
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.weight(1f).focusRequester(replyFocus).onFocusChanged { replying = it.isFocused },
                    )
                    Spacer(Modifier.width(10.dp))
                    PrimaryButton("Reply", {
                        val text = draft
                        replyError = null
                        scope.launch {
                            runCatching { model.reply(text) }
                                .onSuccess { draft = "" }
                                .onFailure { replyError = ForumErrorText.describe(it) }
                        }
                    }, enabled = draft.isNotBlank(), busy = sending, compact = true)
                }
                if (replying) {
                    Text(
                        if (name.isEmpty()) "Replying with your account id. Pick a name in About this forum." else "Replying as $name",
                        fontSize = 12.sp,
                        color = Palette.Muted,
                        modifier = Modifier.padding(start = 54.dp, bottom = 8.dp),
                    )
                }
            }
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
            LazyColumn(Modifier.fillMaxSize()) {
                item { NoticeBanner(notice) { model.dismissNotice() } }
                val current = post
                when {
                    phase is LoadPhase.Failed && current == null ->
                        item { ErrorState((phase as LoadPhase.Failed).message) { scope.launch { model.load() } } }
                    current == null -> item { SkeletonPost() }
                    else -> {
                        item {
                            PostDetail(
                                current,
                                isMine = model.isMine(current.author),
                                isModerator = feed.isModerator,
                                vote = { scope.launch { model.votePost(it) } },
                                reply = { replyFocus.requestFocus() },
                                edit = { editingPost = true },
                                delete = { confirm = Confirm("Delete this post?", "Its replies go with it.", "Delete") { model.deletePost() } },
                                moderate = {
                                    confirm =
                                        Confirm("Remove this post?", "As a moderator you can remove anyone's post. It's removed for everyone.", "Remove") {
                                            model.moderatePost()
                                        }
                                },
                            )
                            Hairline()
                        }
                        if (comments.isEmpty() && phase == LoadPhase.Loaded) {
                            item {
                                Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text("No replies yet", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                                    Text("Be the first to reply.", fontSize = 15.sp, color = Palette.Muted)
                                }
                            }
                        }
                        items(comments, key = { it.id }) { comment ->
                            val mine = model.isMine(comment.author)
                            Swipeable(enabled = mine || feed.isModerator, mine = mine, onSwipe = { askComment(comment, mine) }) {
                                ReplyRow(
                                    comment,
                                    current,
                                    isMine = mine,
                                    isModerator = feed.isModerator,
                                    vote = { value -> scope.launch { model.voteComment(comment, value) } },
                                    edit = { editingComment = comment },
                                    delete = { askComment(comment, true) },
                                    moderate = { askComment(comment, false) },
                                )
                            }
                            Hairline()
                        }
                        if (hasMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(14.dp), contentAlignment = Alignment.Center) {
                                    SecondaryButton(if (loadingMore) "Loading…" else "Show more replies", { scope.launch { model.loadMore() } }, compact = true)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (editingPost) {
        post?.let {
            ComposeSheet("Edit post", "Save", name, feed.account, it.title, it.body, dismiss = { editingPost = false }) { title, body ->
                model.editPost(title, body)
            }
        }
    }
    editingComment?.let { comment ->
        EditTextSheet("Edit reply", comment.body, dismiss = { editingComment = null }) { model.editComment(comment, it) }
    }
    ConfirmDialog(confirm) { confirm = null }
}

/** The opened post, large: who, the post, when, its numbers and its actions. */
@Composable
private fun PostDetail(
    post: PostView,
    isMine: Boolean,
    isModerator: Boolean,
    vote: (Int) -> Unit,
    reply: () -> Unit,
    edit: () -> Unit,
    delete: () -> Unit,
    moderate: () -> Unit,
) {
    val context = LocalContext.current
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(ForumFormat.displayName(post.authorName, post.author), seed = post.author, size = 48.dp)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(ForumFormat.displayName(post.authorName, post.author), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Palette.Ink, maxLines = 1)
                    if (isMine) {
                        Spacer(Modifier.width(6.dp))
                        Badge("You", strong = false)
                    }
                }
                Text(ForumFormat.handle(post.author), fontSize = 15.sp, color = Palette.Muted)
            }
            ItemMenu(isMine, isModerator, "post", "${post.title}\n\n${post.body}", edit, delete, moderate)
        }
        Text(post.title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 23.sp, color = Palette.Ink)
        SelectionContainer { Text(post.body, fontSize = 17.sp, color = Palette.Ink) }
        Text(
            ForumFormat.fullStamp(post.createdAt) + if (post.editedAt > post.createdAt) " · Edited" else "",
            fontSize = 15.sp,
            color = Palette.Muted,
        )
        Hairline()
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Stat(post.commentCount.toLong(), if (post.commentCount == 1uL) "Reply" else "Replies")
            Stat(post.score, "Score")
        }
        Hairline()
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            ActionCount(Icons.Outlined.ChatBubbleOutline, null, "Reply", reply)
            VoteControl(post.score, post.myVote, size = 19.dp, vote = vote)
            ActionCount(Icons.Outlined.Share, null, "Share") { share(context, "${post.title}\n\n${post.body}") }
        }
    }
}

@Composable
private fun Stat(
    value: Long,
    label: String,
) {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Palette.Ink)) { append(ForumFormat.compact(value)) }
            withStyle(SpanStyle(color = Palette.Muted)) { append(" $label") }
        },
        fontSize = 15.sp,
    )
}

/** A reply in the thread: who, to whom, the text, and its vote. */
@Composable
private fun ReplyRow(
    comment: CommentView,
    replyingTo: PostView,
    isMine: Boolean,
    isModerator: Boolean,
    vote: (Int) -> Unit,
    edit: () -> Unit,
    delete: () -> Unit,
    moderate: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().background(Palette.Surface).padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 6.dp)) {
        Avatar(ForumFormat.displayName(comment.authorName, comment.author), seed = comment.author, size = 40.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AuthorLine(comment.authorName, comment.author, comment.createdAt, isMine, Modifier.weight(1f), edited = comment.editedAt > comment.createdAt)
                ItemMenu(isMine, isModerator, "reply", comment.body, edit, delete, moderate)
            }
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = Palette.Muted)) { append("Replying to ") }
                    withStyle(SpanStyle(color = Palette.InkSoft)) { append(ForumFormat.handle(replyingTo.author)) }
                },
                fontSize = 14.sp,
            )
            SelectionContainer { Text(comment.body, fontSize = 15.sp, color = Palette.Ink) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                VoteControl(comment.score, comment.myVote, size = 15.dp, vote = vote)
            }
        }
    }
}
