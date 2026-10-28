package network.calimero.design.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.design.app.BoardModel
import network.calimero.design.core.DesignFormat
import network.calimero.design.core.Point

/**
 * The board's comments, oldest first; tap one for its thread. A new comment is pinned where the
 * board view is centred. (iOS `CommentsSheet`.)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommentsSheet(
    model: BoardModel,
    newCommentAt: Point,
    openThread: String?,
    onDismiss: () -> Unit,
) {
    var thread by remember { mutableStateOf(openThread) }
    val comments by model.comments.collectAsState()
    model.role.collectAsState().value
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = false)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = DesignTheme.ground) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (thread != null) {
                    IconButton(onClick = { thread = null }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Comments") }
                } else {
                    Spacer(Modifier.size(48.dp))
                }
                Text(
                    if (thread == null) "Comments" else "Thread",
                    style = DesignTheme.heading(17),
                    modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                Spacer(Modifier.size(48.dp))
            }
            val current = thread
            if (current == null) {
                LazyColumn(
                    Modifier.weight(1f).fillMaxWidth(),
                    contentPadding =
                        androidx.compose.foundation.layout
                            .PaddingValues(16.dp),
                ) {
                    if (comments.isEmpty()) {
                        item {
                            EmptyState(
                                Icons.Outlined.Forum,
                                "No comments yet",
                                if (model.canComment) "Comments are pinned to the middle of what you're looking at." else "Comments people leave on this board show up here.",
                            )
                        }
                    } else {
                        itemsIndexed(comments, key = { _, c -> c.id }) { index, c ->
                            CommentRow(model, index + 1, c.author, c.content, c.createdAt, c.replies.size, Modifier.padding(vertical = 6.dp).clickable { thread = c.id })
                        }
                    }
                }
                CommentComposer(model, "Add a comment") { text, name -> model.addComment(text, newCommentAt, name) }
            } else {
                val comment = comments.firstOrNull { it.id == current }
                LazyColumn(
                    Modifier.weight(1f).fillMaxWidth(),
                    contentPadding =
                        androidx.compose.foundation.layout
                            .PaddingValues(16.dp),
                ) {
                    if (comment == null) {
                        item { EmptyState(Icons.Outlined.ChatBubbleOutline, "Comment removed", "Someone deleted this comment.") }
                    } else {
                        item { CommentRow(model, null, comment.author, comment.content, comment.createdAt, 0, Modifier.padding(vertical = 6.dp)) }
                        if (comment.replies.isNotEmpty()) {
                            item { SectionLabel(if (comment.replies.size == 1) "1 reply" else "${comment.replies.size} replies") }
                            itemsIndexed(comment.replies, key = { _, r -> r.id }) { _, r ->
                                CommentRow(model, null, r.author, r.content, r.createdAt, 0, Modifier.padding(vertical = 6.dp))
                            }
                        }
                    }
                }
                if (comment != null) CommentComposer(model, "Reply") { text, name -> model.reply(current, text, name) }
            }
        }
    }
}

@Composable
private fun CommentRow(
    model: BoardModel,
    number: Int?,
    author: String,
    content: String,
    createdAt: ULong,
    replies: Int,
    modifier: Modifier = Modifier,
) {
    val name = model.nameFor(author)
    Row(modifier.fillMaxWidth().card(14.dp)) {
        Avatar(author, name, 32.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, style = DesignTheme.body(15, FontWeight.SemiBold, DesignTheme.ink))
                Spacer(Modifier.width(6.dp))
                Text(DesignFormat.relativeTime(createdAt), style = DesignTheme.body(13, color = DesignTheme.faint))
                Spacer(Modifier.weight(1f))
                if (number != null) Text("#$number", style = DesignTheme.body(12, FontWeight.SemiBold, DesignTheme.muted))
            }
            Text(content, style = DesignTheme.body(15))
            if (replies > 0) {
                Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Outlined.Reply, contentDescription = null, tint = DesignTheme.muted, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(if (replies == 1) "1 reply" else "$replies replies", style = DesignTheme.body(13, FontWeight.Medium, DesignTheme.muted))
                }
            }
        }
    }
}

/**
 * A text field and a send button. Viewers get a note instead; someone not on the board's roster
 * yet is asked their name before the first post.
 */
@Suppress("LongMethod")
@Composable
private fun CommentComposer(
    model: BoardModel,
    placeholder: String,
    send: suspend (String, String?) -> Unit,
) {
    val role by model.role.collectAsState()
    model.members.collectAsState().value
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var askName by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    val canSend = !sending && text.isNotBlank()

    fun post(joinAs: String?) {
        val body = text
        sending = true
        error = null
        scope.launch {
            runCatching { send(body, joinAs) }
                .onSuccess {
                    text = ""
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                }.onFailure { error = DesignFormat.errorText(it) }
            sending = false
        }
    }

    Column(Modifier.fillMaxWidth().background(DesignTheme.surface).navigationBarsPadding()) {
        HorizontalDivider(thickness = DesignTheme.hairline, color = DesignTheme.line)
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            error?.let { Text(it, style = DesignTheme.body(13, color = DesignTheme.danger)) }
            when {
                role == null -> Unit
                !model.canComment ->
                    Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Lock, contentDescription = null, tint = DesignTheme.muted, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("View-only access. Ask a board admin for edit access to comment.", style = DesignTheme.body(14, color = DesignTheme.muted))
                    }
                else ->
                    Row(verticalAlignment = Alignment.Bottom) {
                        val shape = RoundedCornerShape(20.dp)
                        BasicTextField(
                            value = text,
                            onValueChange = { text = it },
                            textStyle = TextStyle(fontSize = 16.sp, color = DesignTheme.ink),
                            cursorBrush = SolidColor(DesignTheme.ink),
                            maxLines = 5,
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .background(DesignTheme.surface, shape)
                                    .border(DesignTheme.hairline, DesignTheme.lineStrong, shape)
                                    .padding(horizontal = 14.dp, vertical = 11.dp),
                            decorationBox = { inner ->
                                Box {
                                    if (text.isEmpty()) Text(placeholder, style = DesignTheme.body(16, color = DesignTheme.faint))
                                    inner()
                                }
                            },
                        )
                        Spacer(Modifier.width(8.dp))
                        Box(
                            Modifier
                                .size(42.dp)
                                .background(DesignTheme.lime.copy(alpha = if (canSend) 1f else 0.45f), CircleShape)
                                .clickable(enabled = canSend) { if (model.myName == null) askName = true else post(null) }
                                .semantics { contentDescription = "Send" },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (sending) {
                                CircularProgressIndicator(color = DesignTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                            } else {
                                Icon(Icons.Filled.ArrowUpward, contentDescription = null, tint = DesignTheme.ink)
                            }
                        }
                    }
            }
        }
    }

    if (askName) {
        AlertDialog(
            onDismissRequest = { askName = false },
            title = { Text("Your name on this board") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Others see this next to your comments.")
                    OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true, placeholder = { Text("Name") })
                }
            },
            confirmButton = {
                TextButton(enabled = name.isNotBlank(), onClick = {
                    askName = false
                    post(name)
                }) { Text("Post") }
            },
            dismissButton = { TextButton(onClick = { askName = false }) { Text("Cancel") } },
        )
    }
}
