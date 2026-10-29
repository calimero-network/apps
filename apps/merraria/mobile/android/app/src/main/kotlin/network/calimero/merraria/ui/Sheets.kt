package network.calimero.merraria.ui

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
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
import network.calimero.merraria.app.MerrariaConstants
import network.calimero.merraria.app.MerrariaException
import network.calimero.merraria.app.MerrariaText
import network.calimero.merraria.app.PlayerSettings
import network.calimero.merraria.app.WorldInvitation
import java.util.Locale

@Composable
fun fieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MerrariaColors.Ink,
        unfocusedBorderColor = MerrariaColors.Line,
        focusedContainerColor = MerrariaColors.Surface,
        unfocusedContainerColor = MerrariaColors.Surface,
        cursorColor = MerrariaColors.Ink,
        focusedLabelColor = MerrariaColors.Ink,
    )

/** A bottom sheet with the app's ground and a title row. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MerrariaSheet(
    title: String,
    onDismiss: () -> Unit,
    dismissible: Boolean = true,
    content: @Composable () -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { dismissible })
    ModalBottomSheet(onDismissRequest = { if (dismissible) onDismiss() }, sheetState = state, containerColor = MerrariaColors.Ground) {
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
    } catch (e: Exception) {
        setError(MerrariaText.error(e))
    }
    setBusy(false)
}

/** Create world: a name and a seed, as the web app's "Create world" asks. (iOS `NewWorldSheet`.) */
@Composable
fun NewWorldSheet(
    onCreate: suspend (String, ULong) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(MerrariaConstants.DEFAULT_WORLD_NAME) }
    var seed by remember { mutableStateOf(MerrariaConstants.randomSeed().toString()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    MerrariaSheet("Create world", onDismiss = onDismiss, dismissible = !busy) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(MerrariaConstants.MAX_WORLD_NAME) },
            label = { Text("World name") },
            placeholder = { Text(MerrariaConstants.DEFAULT_WORLD_NAME) },
            supportingText = { Text("Friends you invite see this name.") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, imeAction = ImeAction.Next),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = seed,
            onValueChange = { seed = it.filter(Char::isDigit).take(10) },
            label = { Text("Seed") },
            supportingText = { Text("The terrain grows from the seed: the same seed makes the same world.") },
            singleLine = true,
            textStyle = Type.mono,
            trailingIcon = {
                IconButton(onClick = { seed = MerrariaConstants.randomSeed().toString() }) {
                    Icon(Icons.Filled.Casino, contentDescription = "Random seed", tint = MerrariaColors.Ink)
                }
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                scope.launch {
                    attempt({ busy = it }, { error = it }) {
                        onCreate(name, MerrariaConstants.seed(seed, MerrariaConstants.randomSeed()))
                        onDismiss()
                    }
                }
            },
            enabled = !busy,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (busy) "Creating…" else "Create world")
        }
    }
}

/** Join with a link pasted from a message. (iOS `PasteLinkSheet`.) */
@Composable
fun PasteLinkSheet(
    onInvitation: (WorldInvitation) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboardManager.current

    MerrariaSheet("Join with a link", onDismiss = onDismiss) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            label = { Text("Invitation link") },
            placeholder = { Text("https://links.calimero.network/…") },
            minLines = 2,
            maxLines = 4,
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
            style = Type.body(13, color = MerrariaColors.Muted),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                val invitation = WorldInvitation.parse(text)
                if (invitation != null) onInvitation(invitation) else error = MerrariaException.Kind.NOT_AN_INVITATION.message
            },
            enabled = text.isNotBlank(),
        ) { ButtonLabel("Continue") }
    }
}

/**
 * "Join this world?", asked before an invitation acts on the player's behalf: joining binds their
 * account to a world someone else chose. (iOS `JoinSheet`.)
 */
@Composable
fun JoinSheet(
    invitation: WorldInvitation,
    onJoin: suspend () -> Unit,
    onDismiss: () -> Unit,
) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    MerrariaSheet("Join ${invitation.worldName ?: "this world"}?", onDismiss = onDismiss, dismissible = !busy) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            AppMark(48.dp)
            Text("You've been invited to play Merraria.", style = Type.body(14, color = MerrariaColors.Muted))
        }
        Text(
            "Joining adds your account to this world, and opens it. Everyone in it sees your digging and building.",
            style = Type.body(15, color = MerrariaColors.Ink2),
        )
        Disclosure("Details") {
            DetailRow("Namespace", invitation.namespaceId)
            invitation.contextId?.let { DetailRow("World (context)", it) }
            invitation.groupId?.let { DetailRow("Group", it) }
        }
        error?.let { ErrorBanner(it) { error = null } }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.weight(1f)) { ButtonLabel("Not now") }
            PrimaryButton(onClick = { scope.launch { attempt({ busy = it }, { error = it }) { onJoin() } } }, enabled = !busy, modifier = Modifier.weight(1f)) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Ink, strokeWidth = 2.dp)
                ButtonLabel(if (busy) "Joining…" else "Join world")
            }
        }
    }
}

/** Settings: the name others see, the game's zoom, the account (behind Details) and sign out. (iOS `SettingsSheet`.) */
@Composable
fun SettingsSheet(
    account: String,
    settings: PlayerSettings,
    onSignOut: () -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(settings.name) }
    var zoom by remember { mutableDoubleStateOf(settings.zoom) }
    var confirming by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        onDispose {
            settings.name = name
            settings.zoom = zoom
        }
    }

    MerrariaSheet("Settings", onDismiss = onDismiss) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(MerrariaConstants.MAX_PLAYER_NAME) },
            label = { Text("Player name") },
            placeholder = { Text(MerrariaConstants.DEFAULT_PLAYER_NAME) },
            supportingText = { Text("Shown above your miner and in the player list.") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        ZoomRow(zoom) { zoom = it }
        Text("Zoom out to see more of the world at once.", style = Type.body(13, color = MerrariaColors.Muted))
        Card {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                AppMark(40.dp)
                Column {
                    Text("Signed in", style = Type.heading(17))
                    Text("with your Calimero account", style = Type.body(13, color = MerrariaColors.Muted))
                }
            }
            HorizontalDivider(color = MerrariaColors.Line)
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
            title = { Text("Sign out of Merraria?") },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onDismiss()
                    onSignOut()
                }) { Text("Sign out", color = MerrariaColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel", color = MerrariaColors.Ink) } },
            containerColor = MerrariaColors.Surface,
        )
    }
}

/** The zoom slider with its magnifier icons and value. */
@Composable
fun ZoomRow(
    zoom: Double,
    onChange: (Double) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.ZoomOut, contentDescription = "Zoom out", tint = MerrariaColors.Muted)
        Slider(
            value = zoom.toFloat(),
            onValueChange = { onChange(Math.round(it * 10) / 10.0) },
            valueRange = MerrariaConstants.MIN_ZOOM.toFloat()..MerrariaConstants.MAX_ZOOM.toFloat(),
            steps = 9,
            colors =
                SliderDefaults.colors(
                    thumbColor = MerrariaColors.Ink,
                    activeTrackColor = MerrariaColors.Ink,
                    inactiveTrackColor = MerrariaColors.Line,
                    activeTickColor = MerrariaColors.Surface,
                    inactiveTickColor = MerrariaColors.Muted,
                ),
            modifier = Modifier.weight(1f),
        )
        Icon(Icons.Filled.ZoomIn, contentDescription = "Zoom in", tint = MerrariaColors.Muted)
        Text(String.format(Locale.US, "%.1f×", zoom), style = Type.mono, modifier = Modifier.width(40.dp))
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
            Icon(if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = MerrariaColors.Muted)
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
        }
    }
}
