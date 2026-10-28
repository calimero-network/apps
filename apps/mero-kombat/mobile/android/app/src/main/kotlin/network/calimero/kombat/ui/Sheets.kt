package network.calimero.kombat.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import network.calimero.kombat.app.KombatConstants
import network.calimero.kombat.app.KombatException
import network.calimero.kombat.app.KombatInvitation
import network.calimero.kombat.app.KombatText

@Composable
fun fieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = KombatColors.Ink,
        unfocusedBorderColor = KombatColors.Line,
        focusedContainerColor = KombatColors.Surface,
        unfocusedContainerColor = KombatColors.Surface,
        cursorColor = KombatColors.Ink,
        focusedLabelColor = KombatColors.Ink,
    )

/** A bottom sheet with the app's ground and a title row. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KombatSheet(
    title: String,
    onDismiss: () -> Unit,
    dismissible: Boolean = true,
    content: @Composable () -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { dismissible })
    ModalBottomSheet(onDismissRequest = { if (dismissible) onDismiss() }, sheetState = state, containerColor = KombatColors.Ground) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp)
                .imePadding()
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title, style = Type.heading(22))
            content()
        }
    }
}

/** Run [action] with a busy flag and an error sentence. */
private suspend fun attempt(
    setBusy: (Boolean) -> Unit,
    setError: (String?) -> Unit,
    action: suspend () -> Unit,
) {
    setBusy(true)
    setError(null)
    try {
        action()
    } catch (e: CancellationException) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        setError(KombatText.error(e))
    }
    setBusy(false)
}

/** New arena: a title, and the namespace it goes in (a new one by default). (iOS `NewArenaSheet`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewArenaSheet(
    namespaces: List<AppNamespace>,
    onCreate: suspend (String, String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var namespaceId by remember { mutableStateOf<String?>(null) }
    var namespaceMenu by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun namespaceLabel(id: String?) = id?.let { namespaces.firstOrNull { c -> c.id == it }?.name ?: KombatText.shortId(it) } ?: "New namespace"

    KombatSheet("New arena", onDismiss = onDismiss, dismissible = !busy) {
        OutlinedTextField(
            value = title,
            onValueChange = { title = it.take(64) },
            label = { Text("Title") },
            placeholder = { Text(KombatConstants.DEFAULT_TITLE) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        ExposedDropdownMenuBox(expanded = namespaceMenu, onExpandedChange = { namespaceMenu = it }) {
            OutlinedTextField(
                value = namespaceLabel(namespaceId),
                onValueChange = {},
                readOnly = true,
                label = { Text("Namespace") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = namespaceMenu) },
                colors = fieldColors(),
                modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(expanded = namespaceMenu, onDismissRequest = { namespaceMenu = false }) {
                DropdownMenuItem(text = { Text("New namespace") }, onClick = {
                    namespaceId = null
                    namespaceMenu = false
                })
                namespaces.forEach { namespace ->
                    DropdownMenuItem(text = { Text(namespaceLabel(namespace.id)) }, onClick = {
                        namespaceId = namespace.id
                        namespaceMenu = false
                    })
                }
            }
        }
        Text(
            "A namespace is who can fight in its arenas: one invitation lets someone into every arena in it.",
            style = Type.body(13, color = KombatColors.Muted),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                scope.launch {
                    attempt({ busy = it }, { error = it }) {
                        onCreate(title, namespaceId)
                        onDismiss()
                    }
                }
            },
            enabled = !busy,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = KombatColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (busy) "Creating…" else "Create arena")
        }
    }
}

/** Join with a link pasted from a message. (iOS `PasteLinkSheet`.) */
@Composable
fun PasteLinkSheet(
    onInvitation: (KombatInvitation) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboardManager.current

    KombatSheet("Join with a link", onDismiss = onDismiss) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            label = { Text("Invitation link") },
            placeholder = { Text("https://links.calimero.network/…") },
            minLines = 3,
            maxLines = 6,
            textStyle = Type.mono,
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        SecondaryButton(onClick = { clipboard.getText()?.text?.let { text = it } }) {
            Icon(Icons.Filled.ContentPaste, contentDescription = null, modifier = Modifier.size(18.dp))
            ButtonLabel("Paste")
        }
        Text(
            "Paste the link someone shared with you. You'll be asked before anything is joined.",
            style = Type.body(13, color = KombatColors.Muted),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                val invitation = KombatInvitation.parse(text)
                if (invitation != null) onInvitation(invitation) else error = KombatException.Kind.NOT_AN_INVITATION.message
            },
            enabled = text.isNotBlank(),
        ) { ButtonLabel("Continue") }
    }
}

/**
 * "Join this arena?", asked before following a link acts on the player's behalf: joining binds
 * their account to a namespace someone else chose. (iOS `JoinSheet`.)
 */
@Composable
fun JoinSheet(
    invitation: KombatInvitation,
    onJoin: suspend () -> Unit,
    onDismiss: () -> Unit,
) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    KombatSheet("Join this arena?", onDismiss = onDismiss, dismissible = !busy) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            AppMark(48.dp)
            Text("You've been invited to fight in Mero Kombat.", style = Type.body(14, color = KombatColors.Muted))
        }
        Text(
            "Joining adds your account to the namespace this arena belongs to, and opens the arena. You can take a corner or watch.",
            style = Type.body(15, color = KombatColors.Ink2),
        )
        Disclosure("Details") {
            DetailRow("Namespace", invitation.namespaceId)
            DetailRow("Arena (context)", invitation.contextId)
        }
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(onClick = { scope.launch { attempt({ busy = it }, { error = it }) { onJoin() } } }, enabled = !busy) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = KombatColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (busy) "Joining…" else "Join arena")
        }
        SecondaryButton(onClick = onDismiss, enabled = !busy) { ButtonLabel("Not now") }
    }
}

/** The account: who is signed in (behind Details), and sign out. (iOS `AccountSheet`.) */
@Composable
fun AccountSheet(
    account: String,
    onSignOut: () -> Unit,
    onDismiss: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }

    KombatSheet("Account", onDismiss = onDismiss) {
        Card {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                AppMark(44.dp)
                Column {
                    Text("Signed in", style = Type.heading(17))
                    Text("with your Calimero account", style = Type.body(13, color = KombatColors.Muted))
                }
            }
            HorizontalDivider(color = KombatColors.Line)
            Disclosure("Details") { DetailRow("Account", account) }
        }
        SecondaryButton(onClick = { confirming = true }, destructive = true) {
            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
            ButtonLabel("Sign out")
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Sign out of Mero Kombat?") },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onDismiss()
                    onSignOut()
                }) { Text("Sign out", color = KombatColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel", color = KombatColors.Ink) } },
            containerColor = KombatColors.Surface,
        )
    }
}

/** A "Details" row that opens to show technical values. */
@Composable
fun Disclosure(
    title: String,
    content: @Composable () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, style = Type.body(14, FontWeight.SemiBold), modifier = Modifier.weight(1f))
            Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = KombatColors.Muted)
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
        }
    }
}
