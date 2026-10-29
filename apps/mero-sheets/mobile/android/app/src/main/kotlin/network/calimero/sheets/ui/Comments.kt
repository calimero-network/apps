package network.calimero.sheets.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.sheets.core.CommentThread
import network.calimero.sheets.core.GridPos
import network.calimero.sheets.core.SheetsFormat
import network.calimero.sheets.core.SpreadsheetModel
import network.calimero.sheets.core.SpreadsheetState
import network.calimero.sheets.generated.Comment
import kotlin.coroutines.cancellation.CancellationException

private const val RESOLVED_ALPHA = 0.75f

/**
 * One thread: the comment, its replies, resolve or reopen, reply, and edit or delete your own
 * (`app/src/components/CommentsPanel.tsx`).
 */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@Composable
fun ThreadCard(
    model: SpreadsheetModel,
    state: SpreadsheetState,
    thread: CommentThread,
    location: String? = null,
    onOpenCell: (() -> Unit)? = null,
) {
    var reply by remember(thread.id) { mutableStateOf("") }
    var replying by remember(thread.id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Comment?>(null) }
    var editText by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf<Comment?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current

    fun run(work: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                work()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = SheetsFormat.errorText(e)
            }
            busy = false
        }
    }

    Column(
        Modifier.card(14.dp).alpha(if (thread.root.resolved) RESOLVED_ALPHA else 1f),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (location != null) {
                Row(
                    Modifier
                        .clip(CircleShape)
                        .background(Palette.sunken)
                        .clickable(enabled = onOpenCell != null) { onOpenCell?.invoke() }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Outlined.TableChart, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(14.dp))
                    Text(location, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, color = Palette.ink)
                }
            }
            if (thread.root.resolved) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(14.dp))
                    Text("Resolved", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.text3)
                }
            }
            Spacer(Modifier.weight(1f))
            if (state.canComment) {
                Text(
                    if (thread.root.resolved) "Reopen" else "Resolve",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.ink,
                    modifier =
                        Modifier
                            .clip(CircleShape)
                            .background(if (thread.root.resolved) Palette.sunken else Palette.lime)
                            .clickable(enabled = !busy) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                run { model.setResolved(thread, !thread.root.resolved) }
                            }.padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
        }
        CommentRow(model, thread.root, {
            editText = it.text
            editing = it
        }) { confirmDelete = it }
        thread.replies.forEach { r ->
            Box(Modifier.padding(start = 30.dp)) {
                CommentRow(model, r, {
                    editText = it.text
                    editing = it
                }) { confirmDelete = it }
            }
        }
        if (state.canComment) {
            if (replying) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { Field(reply, { reply = it }, "Reply…", singleLine = false, textSize = 15) }
                    SendButton(enabled = !busy && reply.isNotBlank(), busy = false, description = "Send reply") {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        val text = reply
                        run {
                            model.reply(thread, text)
                            reply = ""
                            replying = false
                        }
                    }
                }
            } else {
                Row(
                    Modifier.clickable { replying = true },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Reply, contentDescription = null, tint = Palette.text2, modifier = Modifier.size(16.dp))
                    Text("Reply", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2)
                }
            }
        }
        ErrorLine(error)
    }

    editing?.let { c ->
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Edit comment") },
            text = { Field(editText, { editText = it }, "Comment", singleLine = false) },
            confirmButton = {
                TextButton(onClick = {
                    editing = null
                    val text = editText
                    run { model.editComment(c, text) }
                }) { Text("Save", color = Palette.ink) }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel", color = Palette.ink) } },
            containerColor = Palette.surface,
        )
    }
    confirmDelete?.let { c ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete this comment?") },
            text = { Text(if (c.parent.isEmpty()) "Its replies are deleted with it." else "This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = null
                    run { model.deleteComment(c) }
                }) { Text("Delete", color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Cancel", color = Palette.ink) } },
            containerColor = Palette.surface,
        )
    }
}

@Composable
private fun CommentRow(
    model: SpreadsheetModel,
    c: Comment,
    onEdit: (Comment) -> Unit,
    onDelete: (Comment) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.Top) {
        Avatar(model.nameOf(c.author), 24.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(model.nameOf(c.author), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                Text(SheetsFormat.ago(c.createdAt.toLong()), fontSize = 12.sp, color = Palette.text3)
                if (c.updatedAt > c.createdAt) Text("edited", fontSize = 12.sp, color = Palette.text3)
            }
            SelectionContainer { Text(c.text, fontSize = 15.sp, color = Palette.ink) }
        }
        if (model.isMine(c)) {
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Outlined.MoreHoriz, contentDescription = "Comment actions", tint = Palette.text3)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.surface) {
                    DropdownMenuItem(
                        text = { Text("Edit") },
                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                        onClick = {
                            menu = false
                            onEdit(c)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Delete", color = Palette.danger) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = Palette.danger) },
                        onClick = {
                            menu = false
                            onDelete(c)
                        },
                    )
                }
            }
        }
    }
}

/** The lime round send button of every composer. */
@Composable
fun SendButton(
    enabled: Boolean,
    busy: Boolean,
    description: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(if (enabled) Palette.lime else Palette.lime.copy(alpha = 0.45f))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
        } else {
            Icon(Icons.Filled.ArrowUpward, contentDescription = description, tint = Palette.ink, modifier = Modifier.size(20.dp))
        }
    }
}

/** A composer for a new thread on a cell. */
@Composable
fun NewCommentField(
    model: SpreadsheetModel,
    pos: GridPos,
) {
    var text by remember(pos) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { Field(text, { text = it }, "Comment on ${pos.label}…", singleLine = false, textSize = 15) }
            SendButton(enabled = !busy && text.isNotBlank(), busy = busy, description = "Post comment") {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                busy = true
                error = null
                val body = text
                scope.launch {
                    try {
                        model.addComment(body, pos)
                        text = ""
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        error = SheetsFormat.errorText(e)
                    }
                    busy = false
                }
            }
        }
        ErrorLine(error)
    }
}

/** Every open thread in the workbook, each with a jump to its cell. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommentsSheet(
    model: SpreadsheetModel,
    state: SpreadsheetState,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState()
    val threads = model.openThreads()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Palette.ground) {
        SheetTitle("Comments", onDismiss)
        if (threads.isEmpty()) {
            Box(Modifier.fillMaxWidth().height(340.dp)) {
                EmptyState(Icons.Outlined.Forum, "No open comments", "Select a cell and comment on it. Resolved threads stay on their cell.")
            }
        } else {
            LazyColumn(
                Modifier.fillMaxWidth().navigationBarsPadding(),
                contentPadding = PaddingValues(Palette.gutter),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(threads, key = { it.id }) { thread ->
                    ThreadCard(model, state, thread, model.location(thread.root)) {
                        model.reveal(thread.root)
                        onDismiss()
                    }
                }
            }
        }
    }
}
