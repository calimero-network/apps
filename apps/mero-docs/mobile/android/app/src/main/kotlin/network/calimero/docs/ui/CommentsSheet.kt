@file:Suppress("MatchingDeclarationName")

package network.calimero.docs.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import network.calimero.docs.app.DocumentModel
import network.calimero.docs.app.personName
import network.calimero.docs.core.CommentThread
import network.calimero.docs.core.DocComment
import network.calimero.docs.core.DocsFormat
import kotlin.coroutines.cancellation.CancellationException

/** What the comments sheet shows: every thread, or one block's. (Swift `CommentFocus`.) */
sealed class CommentFocus {
    object All : CommentFocus()

    data class Block(
        val id: String,
    ) : CommentFocus()
}

/**
 * A document's comment threads, or one block's, with a composer that comments on the document, on
 * the block, or replies. (Swift `CommentsSheet`.)
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommentsSheet(
    model: DocumentModel,
    initialFocus: CommentFocus,
    onDismiss: () -> Unit,
) {
    val threads by model.threads.collectAsState()
    var focus by remember { mutableStateOf(initialFocus) }
    var replyTo by remember { mutableStateOf<DocComment?>(null) }
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val composer = remember { FocusRequester() }
    val blockId = (focus as? CommentFocus.Block)?.id
    val shown = if (blockId == null) threads else threads.filter { it.root.blockId == blockId }
    val canSend = !sending && draft.isNotBlank()

    val send = {
        val text = draft
        val target = replyTo
        sending = true
        error = null
        scope.launch {
            try {
                if (target != null) model.reply(target.id, text) else model.addComment(text, blockId)
                draft = ""
                replyTo = null
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = DocsFormat.errorText(e)
            }
            sending = false
        }
        Unit
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(), containerColor = DocsTheme.ground) {
        Column(Modifier.fillMaxWidth().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (blockId == null) "Comments" else "Comments on block", style = DocsTheme.heading(17), modifier = Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("Done", style = DocsTheme.body(15, FontWeight.SemiBold, DocsTheme.ink)) }
            }
            LazyColumn(Modifier.weight(1f, fill = false), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (blockId != null) {
                    item { BlockQuote(model.block(blockId)?.plainText.orEmpty(), large = true) }
                    if (threads.size > shown.size) {
                        item {
                            Row(Modifier.clickable { focus = CommentFocus.All }, verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.AutoMirrored.Outlined.List, contentDescription = null, tint = DocsTheme.ink2, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Show all comments", style = DocsTheme.body(14, FontWeight.Medium))
                            }
                        }
                    }
                }
                if (shown.isEmpty()) {
                    item {
                        EmptyState(
                            Icons.Outlined.ChatBubbleOutline,
                            "No comments yet",
                            if (blockId == null) "Start the conversation on this document." else "Be the first to comment on this block.",
                        )
                    }
                }
                items(shown, key = { it.id }) { thread ->
                    ThreadCard(
                        thread = thread,
                        model = model,
                        showQuote = blockId == null,
                        onReply = {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            replyTo = it
                            runCatching { composer.requestFocus() }
                        },
                        onOpenBlock = { focus = CommentFocus.Block(it) },
                    )
                }
            }
            Column(
                Modifier.fillMaxWidth().background(DocsTheme.surface).padding(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                replyTo?.let { target ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.AutoMirrored.Outlined.Reply, contentDescription = null, tint = DocsTheme.ink2, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Replying to ${personName(target.author, model.account)}", style = DocsTheme.body(13, FontWeight.Medium), modifier = Modifier.weight(1f))
                        IconButton(onClick = { replyTo = null }, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Outlined.Close, contentDescription = "Cancel reply", tint = DocsTheme.faint, modifier = Modifier.size(16.dp))
                        }
                    }
                }
                error?.let { Text(it, style = DocsTheme.body(13, color = DocsTheme.danger)) }
                Row(verticalAlignment = Alignment.Bottom) {
                    Box(
                        Modifier
                            .weight(1f)
                            .background(DocsTheme.surface, RoundedCornerShape(20.dp))
                            .border(DocsTheme.hairline, DocsTheme.lineStrong, RoundedCornerShape(20.dp))
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    ) {
                        if (draft.isEmpty()) {
                            Text(
                                when {
                                    replyTo != null -> "Write a reply"
                                    blockId == null -> "Comment on this document"
                                    else -> "Comment on this block"
                                },
                                style = DocsTheme.body(16, color = DocsTheme.faint),
                            )
                        }
                        BasicTextField(
                            value = draft,
                            onValueChange = { draft = it },
                            textStyle = DocsTheme.body(16, color = DocsTheme.ink),
                            cursorBrush = SolidColor(DocsTheme.ink),
                            maxLines = 5,
                            modifier = Modifier.fillMaxWidth().focusRequester(composer),
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Box(
                        Modifier
                            .size(40.dp)
                            .background(DocsTheme.lime.copy(alpha = if (canSend) 1f else 0.45f), CircleShape)
                            .clickable(enabled = canSend, onClick = send)
                            .semantics { contentDescription = "Send" },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (sending) {
                            CircularProgressIndicator(color = DocsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                        } else {
                            Icon(Icons.Outlined.ArrowUpward, contentDescription = null, tint = DocsTheme.ink, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
        }
    }
}

/** The block a thread is about, quoted. */
@Composable
private fun BlockQuote(
    text: String,
    modifier: Modifier = Modifier,
    large: Boolean = false,
) {
    Row(modifier.height(IntrinsicSize.Min)) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(DocsTheme.lime, RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(10.dp))
        Text(
            text.ifEmpty { "A block that is no longer in the document" },
            style = DocsTheme.body(if (large) 15 else 13, color = if (text.isEmpty()) DocsTheme.faint else DocsTheme.ink2),
            maxLines = if (large) 6 else 2,
        )
    }
}

@Composable
private fun ThreadCard(
    thread: CommentThread,
    model: DocumentModel,
    showQuote: Boolean,
    onReply: (DocComment) -> Unit,
    onOpenBlock: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().card(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val block = thread.root.blockId
        if (showQuote && block != null) {
            BlockQuote(model.block(block)?.plainText.orEmpty(), modifier = Modifier.clickable { onOpenBlock(block) })
        }
        CommentView(thread.root, model.account)
        thread.replies.forEach { CommentView(it, model.account, Modifier.padding(start = 40.dp)) }
        Row(
            Modifier.padding(start = 40.dp).clickable { onReply(thread.replies.lastOrNull() ?: thread.root) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Outlined.Reply, contentDescription = null, tint = DocsTheme.ink2, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Reply", style = DocsTheme.body(14, FontWeight.Medium))
        }
    }
}

@Composable
private fun CommentView(
    comment: DocComment,
    me: String,
    modifier: Modifier = Modifier,
) {
    val name = personName(comment.author, me)
    Row(modifier, verticalAlignment = Alignment.Top) {
        Avatar(comment.author, if (name == "You") "You" else comment.author, 30.dp)
        Spacer(Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, style = DocsTheme.body(14, FontWeight.SemiBold, DocsTheme.ink))
                Spacer(Modifier.width(6.dp))
                Text(DocsFormat.relativeTime(comment.createdAt), style = DocsTheme.body(12, color = DocsTheme.faint))
            }
            Text(comment.text, style = DocsTheme.body(15))
        }
    }
}
