package network.calimero.forum.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.RemoveModerator
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.forum.core.ForumConstants
import network.calimero.forum.core.ForumErrorText
import network.calimero.forum.core.ForumFormat
import network.calimero.forum.generated.PostView

/** Name, handle and age on one line, the timeline way. */
@Composable
fun AuthorLine(
    name: String,
    account: String,
    stamp: ULong?,
    isSelf: Boolean,
    modifier: Modifier = Modifier,
    edited: Boolean = false,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            ForumFormat.displayName(name, account),
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            color = Palette.Ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (isSelf) Badge("You", strong = false)
        if (name.isNotBlank()) {
            Text(ForumFormat.handle(account), fontSize = 15.sp, color = Palette.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        }
        if (stamp != null) {
            Text("· ${ForumFormat.age(stamp)}${if (edited) " · edited" else ""}", fontSize = 15.sp, color = Palette.Muted, maxLines = 1)
        }
    }
}

/** Up, score, down. Tapping your current vote takes it back. */
@Composable
fun VoteControl(
    score: Long,
    myVote: Int,
    size: Dp = 17.dp,
    vote: (Int) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        VoteArrow(up = true, active = myVote == 1, size = size) { vote(if (myVote == 1) 0 else 1) }
        Text(
            ForumFormat.compact(score),
            fontSize = 14.sp,
            fontWeight = if (myVote == 0) FontWeight.Normal else FontWeight.SemiBold,
            color = if (myVote == -1) Palette.Danger else Palette.InkSoft,
            modifier = Modifier.defaultMinSize(minWidth = 18.dp).semantics { contentDescription = "Score $score" },
        )
        VoteArrow(up = false, active = myVote == -1, size = size) { vote(if (myVote == -1) 0 else -1) }
    }
}

@Composable
private fun VoteArrow(
    up: Boolean,
    active: Boolean,
    size: Dp,
    onClick: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    Box(
        Modifier
            .size(size + 13.dp)
            .clip(CircleShape)
            .background(if (active) (if (up) Palette.Lime else Palette.DangerSoft) else Palette.Surface.copy(alpha = 0f))
            .clickable {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            }.semantics { contentDescription = if (up) "Upvote" else "Downvote" },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (up) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
            contentDescription = null,
            tint = if (active) (if (up) Palette.Ink else Palette.Danger) else Palette.Muted,
            modifier = Modifier.size(size - 1.dp),
        )
    }
}

/** An icon and a count, for the action row. */
@Composable
fun ActionCount(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    count: String?,
    label: String,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 6.dp)
            .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(17.dp))
        if (count != null) {
            Spacer(Modifier.width(6.dp))
            Text(count, fontSize = 14.sp, color = Palette.Muted)
        }
    }
}

/** What can be done to a post or a reply, by whom. */
@Composable
fun ItemMenu(
    isMine: Boolean,
    isModerator: Boolean,
    noun: String,
    copyText: String,
    edit: () -> Unit,
    delete: () -> Unit,
    moderate: () -> Unit,
) {
    val context = LocalContext.current
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(30.dp)) {
            Icon(Icons.Filled.MoreHoriz, contentDescription = "More", tint = Palette.Muted, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Palette.Surface) {
            if (isMine) {
                DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = {
                    open = false
                    edit()
                })
                DropdownMenuItem(
                    text = { Text("Delete", color = Palette.Danger) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = Palette.Danger) },
                    onClick = {
                        open = false
                        delete()
                    },
                )
            } else if (isModerator) {
                DropdownMenuItem(
                    text = { Text("Remove $noun as moderator", color = Palette.Danger) },
                    leadingIcon = { Icon(Icons.Outlined.RemoveModerator, null, tint = Palette.Danger) },
                    onClick = {
                        open = false
                        moderate()
                    },
                )
            }
            DropdownMenuItem(text = { Text("Copy text") }, leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) }, onClick = {
                open = false
                copy(context, "Text", copyText)
            })
        }
    }
}

/** A timeline row: avatar, who and when, the post, and its actions. */
@Composable
fun PostRow(
    post: PostView,
    isMine: Boolean,
    isModerator: Boolean,
    open: () -> Unit,
    vote: (Int) -> Unit,
    edit: () -> Unit,
    delete: () -> Unit,
    moderate: () -> Unit,
) {
    val context = LocalContext.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.Surface)
            .clickable(onClick = open)
            .padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 6.dp),
    ) {
        Avatar(ForumFormat.displayName(post.authorName, post.author), seed = post.author, size = 44.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AuthorLine(post.authorName, post.author, post.createdAt, isMine, Modifier.weight(1f))
                ItemMenu(isMine, isModerator, "post", "${post.title}\n\n${post.body}", edit, delete, moderate)
            }
            Text(post.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            if (post.body.isNotEmpty()) {
                Text(post.body, fontSize = 15.sp, color = Palette.InkSoft, maxLines = 6, overflow = TextOverflow.Ellipsis)
            }
            Row(
                Modifier.fillMaxWidth().padding(end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                ActionCount(
                    Icons.Outlined.ChatBubbleOutline,
                    if (post.commentCount > 0u) ForumFormat.compact(post.commentCount.toLong()) else null,
                    ForumFormat.count(post.commentCount.toInt(), "reply", "replies"),
                    open,
                )
                VoteControl(post.score, post.myVote, vote = vote)
                ActionCount(Icons.Outlined.Share, null, "Share") { share(context, "${post.title}\n\n${post.body}") }
            }
        }
    }
}

/** Write or edit a post: a title and some text, under your name. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposeSheet(
    heading: String,
    action: String,
    author: String,
    account: String,
    initialTitle: String = "",
    initialBody: String = "",
    dismiss: () -> Unit,
    submit: suspend (String, String) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { true })
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf(initialTitle) }
    var text by remember { mutableStateOf(initialBody) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    val canPost = title.isNotBlank() && text.isNotBlank() && title.length <= ForumConstants.MAX_TITLE && text.length <= ForumConstants.MAX_BODY

    fun run() {
        if (!canPost || busy) return
        busy = true
        error = null
        scope.launch {
            runCatching { submit(title, text) }
                .onSuccess {
                    state.hide()
                    dismiss()
                }.onFailure { error = ForumErrorText.describe(it) }
            busy = false
        }
    }
    ModalBottomSheet(onDismissRequest = { if (!busy) dismiss() }, sheetState = state, containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar(heading, action, canAct = canPost, busy = busy, cancel = dismiss, act = ::run)
            Row(Modifier.padding(16.dp).height(320.dp).verticalScroll(rememberScrollState())) {
                Avatar(author.ifEmpty { "You" }, seed = account, size = 40.dp)
                Column(Modifier.weight(1f).padding(start = 4.dp)) {
                    TextField(
                        value = title,
                        onValueChange = { title = it },
                        placeholder = { Text("Title", fontFamily = Display, fontSize = 20.sp, color = Palette.Muted) },
                        textStyle = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Palette.Ink),
                        maxLines = 4,
                        colors = plainFieldColors(),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    )
                    TextField(
                        value = text,
                        onValueChange = { text = it },
                        placeholder = { Text("What do you want to talk about?", fontSize = 17.sp, color = Palette.Muted) },
                        textStyle = TextStyle(fontSize = 17.sp, color = Palette.Ink),
                        minLines = 6,
                        colors = plainFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger, modifier = Modifier.padding(horizontal = 16.dp)) }
                }
            }
            Hairline()
            Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.AccountCircle, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    if (author.isEmpty()) "You haven't picked a name. This will be signed with your account id." else "Posting as $author",
                    fontSize = 13.sp,
                    color = Palette.Muted,
                    maxLines = 2,
                    modifier = Modifier.weight(1f),
                )
                if (title.length > ForumConstants.MAX_TITLE - 40) {
                    Text(
                        "${ForumConstants.MAX_TITLE - title.length}",
                        fontSize = 13.sp,
                        color = if (title.length > ForumConstants.MAX_TITLE) Palette.Danger else Palette.Muted,
                    )
                }
            }
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

/** Edit one block of text: a reply. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditTextSheet(
    heading: String,
    initial: String,
    dismiss: () -> Unit,
    submit: suspend (String) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = state, containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar(heading, "Save", canAct = text.isNotBlank(), busy = busy, cancel = dismiss, act = {
                busy = true
                scope.launch {
                    runCatching { submit(text) }
                        .onSuccess {
                            state.hide()
                            dismiss()
                        }.onFailure { error = ForumErrorText.describe(it) }
                    busy = false
                }
            })
            TextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("Your reply") },
                textStyle = TextStyle(fontSize = 17.sp, color = Palette.Ink),
                minLines = 4,
                colors = plainFieldColors(),
                modifier = Modifier.fillMaxWidth().padding(8.dp).focusRequester(focus),
            )
            error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger, modifier = Modifier.padding(horizontal = 16.dp)) }
            Spacer(Modifier.height(24.dp))
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}
