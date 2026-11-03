package network.calimero.blocks.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import network.calimero.blocks.app.BlocksAppViewModel
import network.calimero.blocks.app.ClusterChoice

/**
 * Signed out: what the app is, and a passkey on the cluster. The cluster is a Calimero Cloud
 * cluster (by name or a node's URL) or a development node (`merod local`, mock attestation).
 * (iOS `SignInView`.)
 */
@Composable
fun SignInScreen(
    vm: BlocksAppViewModel,
    invited: Boolean,
    onSignIn: () -> Unit,
    onSignUp: (String) -> Unit,
) {
    val busy by vm.busy.collectAsState()
    val choice by vm.choice.collectAsState()
    val session by vm.sessionFlow.collectAsState()
    val error by vm.signInError.collectAsState()
    var choosing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(BlocksColors.Ground)
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Column(Modifier.padding(top = 48.dp)) { AppMark(64.dp) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Mero Blocks", style = Type.heading(34))
            Text(
                "Build together in real time. The world is a Calimero app instance: every block you place is shared state, on your attested cluster, with no game server.",
                style = Type.body(16, color = BlocksColors.Ink2),
            )
        }
        Card {
            Point(Icons.Outlined.Dns, "No game server")
            Point(Icons.Outlined.Group, "Play with friends from a link")
            Point(Icons.Outlined.Key, "Your Calimero account, with a passkey")
        }
        if (invited) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(ButtonShape)
                    .background(BlocksColors.LimeSoft)
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Drafts, contentDescription = null, tint = BlocksColors.Ink)
                Text("You've been invited to a world. Sign in to join it.", style = Type.body(14))
            }
        }
        if (!busy) error?.let { ErrorBanner(it) { vm.signInError.value = null } }
        val current = choice
        if (current == null || session == null) {
            PrimaryButton(onClick = { choosing = true }, enabled = !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = BlocksColors.Ink, strokeWidth = 2.dp)
                ButtonLabel("Choose your cluster")
            }
        } else {
            PrimaryButton(onClick = onSignIn, enabled = !busy) {
                if (busy) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = BlocksColors.Ink, strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                }
                ButtonLabel(if (busy) "Waiting for your passkey…" else "Sign in with a passkey")
            }
            SecondaryButton(onClick = { creating = true }, enabled = !busy) { ButtonLabel("Create an account") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(clusterLine(current), style = Type.body(13, color = BlocksColors.Muted), maxLines = 2, modifier = Modifier.weight(1f))
            if (current != null) {
                TextButton(onClick = { choosing = true }) { Text("Change", style = Type.body(13, FontWeight.SemiBold)) }
            }
        }
    }
    if (creating) {
        CreateAccountSheet(onDismiss = { creating = false }) { name ->
            creating = false
            onSignUp(name)
        }
    }
    if (choosing) {
        ClusterSheet(vm, current = choice, onDismiss = { choosing = false })
    }
}

private fun clusterLine(choice: ClusterChoice?): String =
    when (choice) {
        null -> "Choose the cluster your worlds run on to sign in."
        is ClusterChoice.Development -> "Development node at ${host(choice.value)} (mock attestation)."
        is ClusterChoice.Cloud ->
            if (ClusterChoice.isUrl(choice.value)) "Calimero Cloud, node ${host(choice.value)}." else "Calimero Cloud, cluster ${choice.value}."
    }

private fun host(url: String): String = url.substringAfter("://").substringBefore('/')

@Composable
private fun Point(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = BlocksColors.Ink, modifier = Modifier.size(22.dp))
        Text(text, style = Type.body(15, FontWeight.Medium))
    }
}

/** A name for a new account, then a new passkey. (iOS `CreateAccountSheet`.) */
@Composable
private fun CreateAccountSheet(
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    BlocksSheet("Create an account", onDismiss = onDismiss) {
        Text(
            "Your name is what other players see. A new passkey on this phone signs you in from now on.",
            style = Type.body(15, color = BlocksColors.Muted),
        )
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Your name") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton(onClick = { onCreate(name.trim()) }, enabled = name.isNotBlank()) { ButtonLabel("Create the passkey") }
    }
}

/** Where to sign in: a Calimero Cloud cluster (by name or a node's URL), or a development node. (iOS `NodeSheet`.) */
@Composable
private fun ClusterSheet(
    vm: BlocksAppViewModel,
    current: ClusterChoice?,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var development by remember { mutableStateOf(current is ClusterChoice.Development) }
    var cloud by remember { mutableStateOf((current as? ClusterChoice.Cloud)?.value.orEmpty()) }
    var local by remember { mutableStateOf((current as? ClusterChoice.Development)?.value ?: BlocksAppViewModel.DEFAULT_DEV_NODE) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val value = (if (development) local else cloud).trim()
    val canUse = if (development) ClusterChoice.isUrl(value) else value.isNotEmpty()
    BlocksSheet("Your cluster", onDismiss = onDismiss, dismissible = !busy) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(selected = !development, onClick = { development = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) {
                Text("Calimero Cloud")
            }
            SegmentedButton(selected = development, onClick = { development = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) {
                Text("Development node")
            }
        }
        Text(
            if (development) {
                "A node you run with `merod local`. Its attestation is a mock, so use this only for development."
            } else {
                "Your cluster's name from Calimero Cloud, or the address of one of its nodes. The app checks each node's attestation before it sends anything."
            },
            style = Type.body(15, color = BlocksColors.Muted),
        )
        OutlinedTextField(
            value = if (development) local else cloud,
            onValueChange = { if (development) local = it else cloud = it },
            placeholder = { Text(if (development) BlocksAppViewModel.DEFAULT_DEV_NODE else "eu-shared-1") },
            singleLine = true,
            textStyle = Type.mono,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { ErrorBanner(it) { error = null } }
        PrimaryButton(
            onClick = {
                busy = true
                error = null
                scope.launch {
                    val failure = vm.choose(if (development) ClusterChoice.Development(value) else ClusterChoice.Cloud(value))
                    busy = false
                    if (failure == null) onDismiss() else error = failure
                }
            },
            enabled = canUse && !busy,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = BlocksColors.Ink, strokeWidth = 2.dp)
            ButtonLabel("Use")
        }
    }
}
