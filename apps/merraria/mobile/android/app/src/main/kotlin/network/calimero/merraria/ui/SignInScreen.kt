package network.calimero.merraria.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import network.calimero.merraria.app.ClusterChoice
import network.calimero.merraria.app.ClusterKind
import network.calimero.merraria.app.MerrariaAppViewModel
import java.net.URI

/**
 * Signed out: what the game is, where to sign in (a Calimero Cloud cluster by name or URL, or a
 * development node for `merod local`), then a passkey on it. Laid out for landscape: the pitch on the
 * left, signing in on the right. (iOS `SignInView`.)
 */
@Suppress("LongParameterList", "LongMethod")
@Composable
fun SignInScreen(
    cluster: ClusterChoice?,
    busy: Boolean,
    error: String?,
    invited: Boolean,
    onChoose: (ClusterChoice) -> Unit,
    onSignIn: () -> Unit,
    onSignUp: (String) -> Unit,
    onCancel: () -> Unit,
    onDismissError: () -> Unit,
) {
    var sheet by remember { mutableStateOf<ClusterKind?>(null) }
    var creating by remember { mutableStateOf(false) }

    Row(
        modifier =
            Modifier
                .fillMaxSize()
                .background(MerrariaColors.Ground)
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 32.dp, vertical = 28.dp),
        horizontalArrangement = Arrangement.spacedBy(32.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(60.dp)
            Text("Merraria", style = Type.heading(34))
            Text(
                "Mine and build together in a 2D world with no game server. Every dig is shared state on your attested Calimero cluster.",
                style = Type.body(16, color = MerrariaColors.Ink2),
            )
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Point(Icons.Outlined.Dns, "No game server")
                Point(Icons.Outlined.Group, "Play with friends by invitation")
                Point(Icons.Outlined.Key, "Your Calimero account, with a passkey")
            }
        }
        Card(Modifier.widthIn(max = 380.dp), padding = 20.dp) {
            if (invited) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(ButtonShape)
                        .background(MerrariaColors.LimeSoft)
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Drafts, contentDescription = null, tint = MerrariaColors.Ink)
                    Text("You've been invited to a world. Sign in to join it.", style = Type.body(14))
                }
            }
            error?.let { ErrorBanner(it, onDismissError) }
            if (cluster == null) {
                PrimaryButton(onClick = { sheet = ClusterKind.CLOUD }, enabled = !busy) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Ink, strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Outlined.Cloud, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    ButtonLabel(if (busy) "Finding your cluster…" else "Sign in with Calimero Cloud")
                }
                SecondaryButton(onClick = { sheet = ClusterKind.DEVELOPMENT }, enabled = !busy) {
                    Icon(Icons.Outlined.Build, contentDescription = null, modifier = Modifier.size(18.dp))
                    ButtonLabel("Development node")
                }
            } else {
                PrimaryButton(onClick = onSignIn, enabled = !busy) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Ink, strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    ButtonLabel(if (busy) "Waiting for your passkey…" else "Sign in with a passkey")
                }
                if (busy) {
                    TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Text("Cancel", style = Type.body(14, FontWeight.SemiBold))
                    }
                } else {
                    SecondaryButton(onClick = { creating = true }) { ButtonLabel("Create an account") }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(clusterLine(cluster), style = Type.body(13, color = MerrariaColors.Muted), modifier = Modifier.weight(1f))
                if (cluster != null) {
                    TextButton(onClick = { sheet = cluster.kind }, enabled = !busy) {
                        Text("Change", style = Type.body(13, FontWeight.SemiBold))
                    }
                }
            }
        }
    }

    sheet?.let { kind ->
        ClusterSheet(
            kind = kind,
            current = cluster?.takeIf { it.kind == kind }?.entry.orEmpty(),
            onSubmit = { entry ->
                sheet = null
                onChoose(ClusterChoice(kind, entry))
            },
            onDismiss = { sheet = null },
        )
    }
    if (creating) {
        CreateAccountSheet(
            onSubmit = { name ->
                creating = false
                onSignUp(name)
            },
            onDismiss = { creating = false },
        )
    }
}

private fun clusterLine(cluster: ClusterChoice?): String {
    if (cluster == null) return "Sign in on the Calimero cluster your worlds run on."
    val host = if (cluster.isUrl) runCatching { URI(cluster.entry).host }.getOrNull() ?: cluster.entry else cluster.entry
    return when (cluster.kind) {
        ClusterKind.DEVELOPMENT -> "Development node at $host (mock attestation)."
        ClusterKind.CLOUD -> "Signing in to $host."
    }
}

/**
 * Where to sign in: a Calimero Cloud cluster, by name (`acme`) or a node's URL, or a development node
 * (`merod local`) whose mock attestation is trusted. (iOS `ClusterSheet`.)
 */
@Composable
private fun ClusterSheet(
    kind: ClusterKind,
    current: String,
    onSubmit: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val cloud = kind == ClusterKind.CLOUD
    var entry by remember { mutableStateOf(current.ifEmpty { if (cloud) "" else MerrariaAppViewModel.DEFAULT_DEV_NODE }) }
    val trimmed = entry.trim()
    val valid =
        if (cloud) {
            trimmed.isNotEmpty() && (!trimmed.contains("://") || runCatching { URI(trimmed).host }.getOrNull() != null)
        } else {
            runCatching { URI(trimmed).scheme }.getOrNull() != null
        }

    MerrariaSheet(if (cloud) "Calimero Cloud" else "Development node", onDismiss = onDismiss) {
        Text(
            if (cloud) {
                "Enter your cluster's name from Calimero Cloud, or the address of one of its nodes. The app checks each node's attestation before it sends anything."
            } else {
                "Enter the address `merod local` printed. The app trusts its mock attestation, so use this only for a cluster on your own machine."
            },
            style = Type.body(15, color = MerrariaColors.Muted),
        )
        OutlinedTextField(
            value = entry,
            onValueChange = { entry = it },
            label = { Text(if (cloud) "Cluster name or URL" else "Node URL") },
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = if (cloud) KeyboardType.Text else KeyboardType.Uri,
                    imeAction = ImeAction.Done,
                ),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton(onClick = { onSubmit(trimmed) }, enabled = valid) { ButtonLabel(if (cloud) "Continue" else "Use this node") }
    }
}

/** A name for a new account, then a new passkey. (iOS `CreateAccountSheet`.) */
@Composable
private fun CreateAccountSheet(
    onSubmit: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    MerrariaSheet("Create an account", onDismiss = onDismiss) {
        Text(
            "Your name is what other players see. A new passkey on this phone signs you in from now on.",
            style = Type.body(15, color = MerrariaColors.Muted),
        )
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(64) },
            label = { Text("Your name") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton(onClick = { onSubmit(name.trim()) }, enabled = name.isNotBlank()) { ButtonLabel("Create the passkey") }
    }
}

@Composable
private fun Point(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MerrariaColors.Ink, modifier = Modifier.size(22.dp))
        Text(text, style = Type.body(15, FontWeight.Medium))
    }
}
