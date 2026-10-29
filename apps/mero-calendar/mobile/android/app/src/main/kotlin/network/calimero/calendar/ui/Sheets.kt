package network.calimero.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/** A bottom sheet with a title, used for every create / join / invite flow. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppSheet(
    title: String,
    onDismiss: () -> Unit,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Tokens.surface,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = Tokens.heading.copy(fontSize = 20.sp), modifier = Modifier.weight(1f))
                trailing?.invoke()
            }
            content()
        }
    }
}

/** One text field and one action: "New team", "New calendar", "Join a team". */
@Composable
fun FormSheet(
    title: String,
    body: String? = null,
    label: String?,
    placeholder: String,
    action: String,
    busyAction: String,
    allowEmpty: Boolean = false,
    initial: String = "",
    paste: Boolean = false,
    onDismiss: () -> Unit,
    onSubmit: suspend (String) -> String?,
) {
    var value by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val pasteAction: (@Composable () -> Unit)? =
        if (paste) {
            {
                TextButton(onClick = { clipboard.getText()?.text?.let { value = it.trim() } }) {
                    Icon(Icons.Filled.ContentPaste, contentDescription = null, tint = Tokens.ink, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Paste", color = Tokens.ink)
                }
            }
        } else {
            null
        }
    AppSheet(title, onDismiss, trailing = pasteAction) {
        if (body != null) Text(body, style = Tokens.caption)
        TextInput(value, {
            value = it
            error = null
        }, placeholder, label = label)
        error?.let { Text(it, style = Tokens.caption.copy(color = Tokens.danger)) }
        PrimaryButton(
            if (busy) busyAction else action,
            enabled = allowEmpty || value.isNotBlank(),
            busy = busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                busy = true
                scope.launch {
                    error = onSubmit(value)
                    busy = false
                }
            },
        )
    }
}

/** "Invite to <team>": the link, copy and share. */
@Composable
fun InviteSheet(
    teamName: String,
    makeLink: suspend () -> String,
    onShare: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var link by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    LaunchedEffect(Unit) {
        try {
            link = makeLink()
        } catch (e: Exception) {
            error =
                network.calimero.calendar.data.ErrorText
                    .of(e, "make an invitation")
        }
    }
    AppSheet("Invite to $teamName", onDismiss, trailing = { TextButton(onClick = onDismiss) { Text("Done", color = Tokens.ink) } }) {
        Text("Anyone with this link can join the team for 24 hours.", style = Tokens.caption)
        val current = link
        when {
            error != null -> ErrorBanner(error!!)
            current == null -> Loading()
            else -> {
                Text(
                    middleEllipsis(current),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    color = Tokens.ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(Tokens.fieldRadius))
                            .background(Tokens.sunken)
                            .padding(12.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton(
                        if (copied) "Copied" else "Copy link",
                        icon = if (copied) Icons.Filled.Check else Icons.Filled.ContentCopy,
                        onClick = {
                            clipboard.setText(AnnotatedString(current))
                            copied = true
                        },
                        modifier = Modifier.weight(1f),
                    )
                    SecondaryButton("Share…", onClick = { onShare("Join $teamName on Mero Calendar", current) }, icon = Icons.Filled.Share, modifier = Modifier.weight(1f))
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

private fun middleEllipsis(text: String): String = if (text.length <= 64) text else text.take(44) + "…" + text.takeLast(12)
