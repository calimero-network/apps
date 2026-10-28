package network.calimero.chess.ui

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
import network.calimero.chess.app.ChessConstants
import network.calimero.chess.app.ChessException
import network.calimero.chess.app.ChessInvitation
import network.calimero.chess.app.ChessText

@Composable
fun fieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = ChessColors.Ink,
        unfocusedBorderColor = ChessColors.Line,
        focusedContainerColor = ChessColors.Surface,
        unfocusedContainerColor = ChessColors.Surface,
        cursorColor = ChessColors.Ink,
        focusedLabelColor = ChessColors.Ink,
    )

/** A bottom sheet with the app's ground and a title row. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChessSheet(
    title: String,
    onDismiss: () -> Unit,
    dismissible: Boolean = true,
    content: @Composable () -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { dismissible })
    ModalBottomSheet(onDismissRequest = { if (dismissible) onDismiss() }, sheetState = state, containerColor = ChessColors.Ground) {
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
        setError(ChessText.error(e))
    }
    setBusy(false)
}

/** New table: a title, and the club it goes in (a new one by default). (iOS `NewTableSheet`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewTableSheet(
    clubs: List<AppNamespace>,
    onCreate: suspend (String, String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var clubId by remember { mutableStateOf<String?>(null) }
    var clubMenu by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun clubLabel(id: String?) = id?.let { clubs.firstOrNull { c -> c.id == it }?.name ?: ChessText.shortId(it) } ?: "New club"

    ChessSheet("New table", onDismiss = onDismiss, dismissible = !busy) {
        OutlinedTextField(
            value = title,
            onValueChange = { title = it.take(64) },
            label = { Text("Title") },
            placeholder = { Text(ChessConstants.DEFAULT_TITLE) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        ExposedDropdownMenuBox(expanded = clubMenu, onExpandedChange = { clubMenu = it }) {
            OutlinedTextField(
                value = clubLabel(clubId),
                onValueChange = {},
                readOnly = true,
                label = { Text("Club") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = clubMenu) },
                colors = fieldColors(),
                modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(expanded = clubMenu, onDismissRequest = { clubMenu = false }) {
                DropdownMenuItem(text = { Text("New club") }, onClick = {
                    clubId = null
                    clubMenu = false
                })
                clubs.forEach { club ->
                    DropdownMenuItem(text = { Text(clubLabel(club.id)) }, onClick = {
                        clubId = club.id
                        clubMenu = false
                    })
                }
            }
        }
        Text(
            "A club is who can sit at its tables: one invitation lets someone into every table in it.",
            style = Type.body(13, color = ChessColors.Muted),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                scope.launch {
                    attempt({ busy = it }, { error = it }) {
                        onCreate(title, clubId)
                        onDismiss()
                    }
                }
            },
            enabled = !busy,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = ChessColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (busy) "Creating…" else "Create table")
        }
    }
}

/** Join with a link pasted from a message. (iOS `PasteLinkSheet`.) */
@Composable
fun PasteLinkSheet(
    onInvitation: (ChessInvitation) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboardManager.current

    ChessSheet("Join with a link", onDismiss = onDismiss) {
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
            style = Type.body(13, color = ChessColors.Muted),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                val invitation = ChessInvitation.parse(text)
                if (invitation != null) onInvitation(invitation) else error = ChessException.Kind.NOT_AN_INVITATION.message
            },
            enabled = text.isNotBlank(),
        ) { ButtonLabel("Continue") }
    }
}

/**
 * "Join this table?", asked before following a link acts on the player's behalf: joining binds
 * their account to a club someone else chose. (iOS `JoinSheet`.)
 */
@Composable
fun JoinSheet(
    invitation: ChessInvitation,
    onJoin: suspend () -> Unit,
    onDismiss: () -> Unit,
) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    ChessSheet("Join this table?", onDismiss = onDismiss, dismissible = !busy) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            AppMark(48.dp)
            Text("You've been invited to play Mero Chess.", style = Type.body(14, color = ChessColors.Muted))
        }
        Text(
            "Joining adds your account to the club this table belongs to, and opens the table. You can sit down or watch.",
            style = Type.body(15, color = ChessColors.Ink2),
        )
        Disclosure("Details") {
            DetailRow("Club (namespace)", invitation.namespaceId)
            DetailRow("Table (context)", invitation.contextId)
        }
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(onClick = { scope.launch { attempt({ busy = it }, { error = it }) { onJoin() } } }, enabled = !busy) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = ChessColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (busy) "Joining…" else "Join table")
        }
        SecondaryButton(onClick = onDismiss, enabled = !busy) { ButtonLabel("Not now") }
    }
}

/** The account: who is signed in (behind Details), sign out, and the artwork's credit. (iOS `AccountSheet`.) */
@Composable
fun AccountSheet(
    account: String,
    onSignOut: () -> Unit,
    onDismiss: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }

    ChessSheet("Account", onDismiss = onDismiss) {
        Card {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                AppMark(44.dp)
                Column {
                    Text("Signed in", style = Type.heading(17))
                    Text("with your Calimero account", style = Type.body(13, color = ChessColors.Muted))
                }
            }
            HorizontalDivider(color = ChessColors.Line)
            Disclosure("Details") { DetailRow("Account", account) }
        }
        SecondaryButton(onClick = { confirming = true }, destructive = true) {
            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
            ButtonLabel("Sign out")
        }
        Text("Acknowledgements", style = Type.body(13, FontWeight.SemiBold, ChessColors.Muted))
        Text("Chess pieces: Chessnut, © 2015 Alexis Luengas, Apache License 2.0.", style = Type.body(13, color = ChessColors.Muted))
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Sign out of Mero Chess?") },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onDismiss()
                    onSignOut()
                }) { Text("Sign out", color = ChessColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel", color = ChessColors.Ink) } },
            containerColor = ChessColors.Surface,
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
            Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = ChessColors.Muted)
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
        }
    }
}
