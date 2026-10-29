package network.calimero.blocks.ui

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
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import network.calimero.blocks.app.BlocksConstants
import network.calimero.blocks.app.BlocksException
import network.calimero.blocks.app.BlocksInvitation
import network.calimero.blocks.app.BlocksText

@Composable
fun fieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = BlocksColors.Ink,
        unfocusedBorderColor = BlocksColors.Line,
        focusedContainerColor = BlocksColors.Surface,
        unfocusedContainerColor = BlocksColors.Surface,
        cursorColor = BlocksColors.Ink,
        focusedLabelColor = BlocksColors.Ink,
    )

/** A bottom sheet with the app's ground and a title row. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlocksSheet(
    title: String,
    onDismiss: () -> Unit,
    dismissible: Boolean = true,
    content: @Composable () -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { dismissible })
    ModalBottomSheet(onDismissRequest = { if (dismissible) onDismiss() }, sheetState = state, containerColor = BlocksColors.Ground) {
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
suspend fun attempt(
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
        setError(BlocksText.error(e))
    }
    setBusy(false)
}

/** Create world: a name and, optionally, a seed (the web app's "Create world" dialog). (iOS `NewWorldSheet`.) */
@Composable
fun NewWorldSheet(
    onCreate: suspend (String, ULong?) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(BlocksConstants.DEFAULT_WORLD_NAME) }
    var seed by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    BlocksSheet("Create world", onDismiss = onDismiss, dismissible = !busy) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(BlocksConstants.WORLD_NAME_MAX) },
            label = { Text("World name") },
            placeholder = { Text(BlocksConstants.DEFAULT_WORLD_NAME) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, imeAction = ImeAction.Next),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = seed,
            onValueChange = { value -> seed = value.filter(Char::isDigit).take(SEED_DIGITS) },
            label = { Text("Seed") },
            placeholder = { Text("Random") },
            singleLine = true,
            textStyle = Type.mono,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            trailingIcon = {
                IconButton(onClick = { seed = BlocksConstants.SEED_RANGE.random().toString() }) {
                    Icon(Icons.Filled.Casino, contentDescription = "Random seed", tint = BlocksColors.Ink)
                }
            },
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "The same seed always grows the same terrain. Leave it empty for a new one.",
            style = Type.body(13, color = BlocksColors.Muted),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                scope.launch {
                    attempt({ busy = it }, { error = it }) {
                        onCreate(name, BlocksText.seed(seed))
                        onDismiss()
                    }
                }
            },
            enabled = !busy,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = BlocksColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (busy) "Creating…" else "Create world")
        }
    }
}

private const val SEED_DIGITS = 10

/** Join with a link pasted from a message. (iOS `PasteLinkSheet`.) */
@Composable
fun PasteLinkSheet(
    onInvitation: (BlocksInvitation) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboardManager.current

    BlocksSheet("Join with a link", onDismiss = onDismiss) {
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
            "Paste the link a friend shared with you. You'll be asked before anything is joined.",
            style = Type.body(13, color = BlocksColors.Muted),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                val invitation = BlocksInvitation.parse(text)
                if (invitation != null) onInvitation(invitation) else error = BlocksException.Kind.NOT_AN_INVITATION.message
            },
            enabled = text.isNotBlank(),
        ) { ButtonLabel("Continue") }
    }
}

/** "Join this world?", asked before following a link acts on the player's behalf. (iOS `JoinSheet`.) */
@Composable
fun JoinSheet(
    invitation: BlocksInvitation,
    onJoin: suspend () -> Unit,
    onDismiss: () -> Unit,
) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    BlocksSheet("Join ${invitation.name ?: "this world"}?", onDismiss = onDismiss, dismissible = !busy) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            AppMark(48.dp)
            Text("You've been invited to build in Mero Blocks.", style = Type.body(14, color = BlocksColors.Muted))
        }
        Text(
            "Joining adds your account to this world and opens it. Everyone in it sees what you build.",
            style = Type.body(15, color = BlocksColors.Ink2),
        )
        Disclosure("Details") {
            DetailRow("Namespace", invitation.namespaceId)
            invitation.contextId?.let { DetailRow("World (context)", it) }
        }
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(onClick = { scope.launch { attempt({ busy = it }, { error = it }) { onJoin() } } }, enabled = !busy) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = BlocksColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (busy) "Joining…" else "Join world")
        }
        SecondaryButton(onClick = onDismiss, enabled = !busy) { ButtonLabel("Not now") }
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
            Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = BlocksColors.Muted)
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
        }
    }
}
