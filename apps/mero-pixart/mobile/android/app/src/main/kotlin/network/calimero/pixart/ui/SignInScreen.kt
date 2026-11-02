package network.calimero.pixart.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import network.calimero.pixart.app.PixartAppViewModel

/**
 * Sign in to the team's Calimero cluster with a passkey, or create an account. The cluster is
 * chosen first: by name, by one of its nodes, or a development cluster (`merod local`) with mock
 * attestation. (Swift `SignInView`.)
 */
@Composable
fun SignInScreen(vm: PixartAppViewModel) {
    val context = LocalContext.current
    val session by vm.session.collectAsState()
    val busy by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    val nodeUrl by vm.nodeUrl.collectAsState()
    val allowMock by vm.allowMock.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var showNode by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(PixartTheme.ground).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize().padding(start = 24.dp, end = 24.dp, bottom = 16.dp)) {
            Spacer(Modifier.weight(1f))
            AppMark(64.dp)
            Text("Mero PixArt", style = PixartTheme.heading(34), modifier = Modifier.padding(top = 24.dp))
            Text(
                "Your team's artwork, on your phone. Look closely, check layers and share the image.",
                style = PixartTheme.body(17, color = PixartTheme.muted),
                modifier = Modifier.padding(top = 10.dp),
            )
            Column(Modifier.padding(top = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Feature(Icons.Outlined.PhotoLibrary, "Every project in your teams, at a glance")
                Feature(Icons.Outlined.Layers, "Pinch into the artwork and peek at its layers")
                Feature(Icons.Outlined.IosShare, "Export the image as PNG")
            }
            Spacer(Modifier.weight(1f))
            error?.let {
                Text(it, style = PixartTheme.body(14, color = PixartTheme.danger), modifier = Modifier.padding(bottom = 12.dp))
            }
            if (session == null) {
                PrimaryButton(onClick = { showNode = true }, enabled = !busy) {
                    if (busy) {
                        CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    } else {
                        Icon(Icons.Outlined.Dns, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Text("Choose your cluster", style = PixartTheme.body(16, FontWeight.SemiBold, PixartTheme.ink))
                }
            } else {
                PrimaryButton(onClick = { vm.signIn(context) }, enabled = !busy) {
                    if (busy) {
                        CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    } else {
                        Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        if (busy) "Waiting for your passkey…" else "Sign in with a passkey",
                        style = PixartTheme.body(16, FontWeight.SemiBold, PixartTheme.ink),
                    )
                }
                SecondaryButton(onClick = { showCreate = true }, modifier = Modifier.padding(top = 10.dp)) { Text("Create an account") }
            }
            Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(nodeLine(session != null, nodeUrl, allowMock), style = PixartTheme.body(12, color = PixartTheme.faint), maxLines = 2, modifier = Modifier.weight(1f))
                if (session != null) {
                    TextButton(onClick = { showNode = true }) { Text("Change", style = PixartTheme.body(12, FontWeight.Medium)) }
                }
            }
        }
    }

    if (showCreate) {
        CreateAccountSheet(onDismiss = { showCreate = false }) { name ->
            showCreate = false
            vm.signUp(context, name)
        }
    }
    if (showNode) {
        NodeSheet(current = nodeUrl.orEmpty(), allowMock = allowMock, devDefault = vm.devNodeDefault, onDismiss = { showNode = false }) { target, mock ->
            showNode = false
            vm.chooseCluster(target, mock)
        }
    }
}

private fun nodeLine(
    chosen: Boolean,
    url: String?,
    allowMock: Boolean,
): String {
    if (!chosen || url == null) return "Your work lives on your team's Calimero cluster. Choose it to sign in."
    val host = runCatching { java.net.URI(url).host }.getOrNull() ?: url
    return if (allowMock) "Development cluster at $host (mock attestation)." else "Signing in to $host, an attested Calimero cluster."
}

/** A name for a new account, then a new passkey. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateAccountSheet(
    onDismiss: () -> Unit,
    submit: (String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PixartTheme.ground) {
        Column(Modifier.padding(16.dp).navigationBarsPadding().imePadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Create an account", style = PixartTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Text(
                "Your name is what your studio sees. A new passkey on this phone signs you in from now on.",
                style = PixartTheme.body(15, color = PixartTheme.muted),
            )
            OutlinedTextField(name, { name = it }, placeholder = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            PrimaryButton(onClick = { submit(name.trim()) }, enabled = name.isNotBlank()) {
                Text("Create the passkey", style = PixartTheme.body(16, FontWeight.SemiBold, PixartTheme.ink))
            }
        }
    }
}

/**
 * The cluster to talk to: its name (`eu-shared-1`, looked up in the node directory), one of its
 * nodes from Calimero Cloud's console, or a development cluster (`merod local`) with mock attestation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NodeSheet(
    current: String,
    allowMock: Boolean,
    devDefault: String,
    onDismiss: () -> Unit,
    submit: (String, Boolean) -> Unit,
) {
    var url by remember { mutableStateOf(current) }
    var mock by remember { mutableStateOf(allowMock) }
    val trimmed = url.trim()
    val valid = trimmed.isNotEmpty() && (!mock || "://" in trimmed)
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PixartTheme.ground) {
        Column(Modifier.padding(16.dp).navigationBarsPadding().imePadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Your cluster", style = PixartTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Text(
                "Enter your team's cluster name, or paste the address of one of its nodes. The app checks the node's attestation before it sends anything.",
                style = PixartTheme.body(15, color = PixartTheme.muted),
            )
            OutlinedTextField(
                url,
                { url = it },
                placeholder = { Text("Cluster name or node URL") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(Modifier.fillMaxWidth().card(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Development cluster", style = PixartTheme.body(15, FontWeight.Medium))
                    Text("Trust mock attestation, as `merod local` serves. Never for a real cluster.", style = PixartTheme.body(13, color = PixartTheme.muted))
                }
                Switch(
                    checked = mock,
                    onCheckedChange = {
                        mock = it
                        if (it && url.isBlank()) url = devDefault
                    },
                    colors = SwitchDefaults.colors(checkedTrackColor = PixartTheme.ink),
                )
            }
            PrimaryButton(onClick = { submit(trimmed, mock) }, enabled = valid) {
                Text("Use this cluster", style = PixartTheme.body(16, FontWeight.SemiBold, PixartTheme.ink))
            }
        }
    }
}

@Composable
private fun Feature(
    icon: ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(36.dp)
                .background(PixartTheme.surface, RoundedCornerShape(10.dp))
                .border(PixartTheme.hairline, PixartTheme.line, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = PixartTheme.ink, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = PixartTheme.body(15))
    }
}
