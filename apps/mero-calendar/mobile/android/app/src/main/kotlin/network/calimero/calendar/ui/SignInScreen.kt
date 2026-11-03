package network.calimero.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

private enum class SignInForm { SIGN_IN, CREATE, DEVELOPMENT }

/**
 * Signed out: what the app is, then sign-in to a Calimero 1.0 cluster (iOS `SignInView`):
 *
 * - Calimero Cloud: the cluster by name (its nodes come from the node directory) or a node URL,
 *   then the device's passkey. "Create an account" registers a new passkey under a name.
 * - Development node: a `merod local` URL with mock attestation allowed; a software passkey is kept
 *   on the device for that node.
 */
@Composable
fun SignInScreen(
    busy: Boolean,
    error: String?,
    initialCluster: String,
    initialDevNode: String,
    onCloud: (cluster: String, create: Boolean, name: String) -> Unit,
    onDevelopment: (url: String, name: String) -> Unit,
) {
    var form by rememberSaveable { mutableStateOf(SignInForm.SIGN_IN) }
    var cluster by rememberSaveable { mutableStateOf(initialCluster) }
    var devNode by rememberSaveable { mutableStateOf(initialDevNode) }
    var name by rememberSaveable { mutableStateOf("") }
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.ground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 24.dp),
    ) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(56.dp))
            IconTile(size = 64.dp)
            Spacer(Modifier.height(20.dp))
            Text("Mero Calendar", style = Tokens.title)
            Spacer(Modifier.height(8.dp))
            Text(
                "Shared team calendars and truly private events.",
                style = Tokens.body.copy(color = Tokens.muted),
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(28.dp))
            Card {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Feature(Icons.Filled.Groups, "Teams share calendars", "Everyone in a team sees the same calendars, kept on your Calimero cluster.")
                    Feature(Icons.Filled.Lock, "Private events stay private", "Only you can read a private event, on any device you sign in on.")
                    Feature(Icons.Filled.Key, "Sign in with a passkey", "No password: your device's passkey opens your account.")
                }
            }
            Spacer(Modifier.height(24.dp))
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (form == SignInForm.DEVELOPMENT) {
                    TextInput(devNode, { devNode = it }, "http://10.0.2.2:2501", label = "Development node URL")
                    TextInput(name, { name = it }, "e.g. Ada", label = "Your name")
                    Text(
                        "For a merod local cluster: mock attestation is allowed and a passkey is kept on this device for that node.",
                        style = Tokens.caption,
                    )
                } else {
                    TextInput(cluster, { cluster = it }, "Cluster name or node URL", label = "Cluster")
                    Text("Your cluster's name from Calimero Cloud, or one of its node URLs.", style = Tokens.caption)
                    if (form == SignInForm.CREATE) TextInput(name, { name = it }, "e.g. Ada Lovelace", label = "Your name")
                }
            }
        }
        if (error != null) {
            Text(error, style = Tokens.caption.copy(color = Tokens.danger), modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
        }
        val canSubmit =
            when (form) {
                SignInForm.SIGN_IN -> cluster.isNotBlank()
                SignInForm.CREATE -> cluster.isNotBlank() && name.isNotBlank()
                SignInForm.DEVELOPMENT -> devNode.isNotBlank()
            }
        PrimaryButton(
            when (form) {
                SignInForm.SIGN_IN -> "Sign in with passkey"
                SignInForm.CREATE -> "Create account"
                SignInForm.DEVELOPMENT -> "Connect"
            },
            onClick = {
                when (form) {
                    SignInForm.SIGN_IN -> onCloud(cluster, false, name)
                    SignInForm.CREATE -> onCloud(cluster, true, name)
                    SignInForm.DEVELOPMENT -> onDevelopment(devNode, name)
                }
            },
            busy = busy,
            enabled = canSubmit,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            when (form) {
                SignInForm.SIGN_IN -> LinkButton("Create an account", !busy) { form = SignInForm.CREATE }
                SignInForm.CREATE -> LinkButton("I have an account", !busy) { form = SignInForm.SIGN_IN }
                SignInForm.DEVELOPMENT -> LinkButton("Use Calimero Cloud", !busy) { form = SignInForm.SIGN_IN }
            }
            Spacer(Modifier.weight(1f))
            if (form != SignInForm.DEVELOPMENT) LinkButton("Development node", !busy) { form = SignInForm.DEVELOPMENT }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun LinkButton(
    text: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, enabled = enabled) { Text(text, color = Tokens.ink, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun Feature(
    icon: ImageVector,
    title: String,
    body: String,
) {
    Row(verticalAlignment = Alignment.Top) {
        Box(
            Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.sunken),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = Tokens.ink, modifier = Modifier.size(20.dp)) }
        Spacer(Modifier.width(14.dp))
        Column {
            Text(title, style = Tokens.heading.copy(fontSize = Tokens.body.fontSize))
            Spacer(Modifier.height(2.dp))
            Text(body, style = Tokens.caption)
        }
    }
}

/** A full-screen spinner with a line of text, and an optional action under it. */
@Composable
fun StatusScreen(
    text: String,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.ground),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        IconTile(size = 48.dp)
        Loading(text)
        action?.invoke()
    }
}
