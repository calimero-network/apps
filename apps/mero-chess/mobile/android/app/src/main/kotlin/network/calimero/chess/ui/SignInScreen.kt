package network.calimero.chess.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import network.calimero.chess.app.SignInMode
import network.calimero.chess.app.SignInState

/** The sign-in screen's three forms. */
private enum class SignInForm { SIGN_IN, CREATE, DEVELOPMENT }

/**
 * Signed out: what the app is, then sign-in to a Calimero 1.0 cluster. (iOS `SignInView`.)
 *
 * - Calimero Cloud: the cluster by name (`eu-shared-1`, its nodes read from the Cloud directory) or
 *   by a node URL from the console, then the device's passkey. "Create an account" registers a new
 *   passkey under a name.
 * - Development node: a `merod local` node URL with mock attestation allowed; a software passkey is
 *   kept on the device for that node.
 */
@Composable
fun SignInScreen(
    state: SignInState,
    invited: Boolean,
    initialMode: SignInMode,
    initialCluster: String,
    initialDevNode: String,
    onCloud: (cluster: String, create: Boolean, name: String) -> Unit,
    onDevelopment: (url: String, name: String) -> Unit,
    onDismissError: () -> Unit,
) {
    var form by rememberSaveable { mutableStateOf(if (initialMode == SignInMode.DEV) SignInForm.DEVELOPMENT else SignInForm.SIGN_IN) }
    var cluster by rememberSaveable { mutableStateOf(initialCluster) }
    var devNode by rememberSaveable { mutableStateOf(initialDevNode) }
    var name by rememberSaveable { mutableStateOf("") }

    val canSubmit =
        when (form) {
            SignInForm.SIGN_IN -> cluster.isNotBlank()
            SignInForm.CREATE -> cluster.isNotBlank() && name.isNotBlank()
            SignInForm.DEVELOPMENT -> devNode.isNotBlank()
        }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(ChessColors.Ground)
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Column(Modifier.padding(top = 48.dp)) { AppMark(64.dp) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Mero Chess", style = Type.heading(34))
            Text(
                "Two-player chess where the rules run in the contract, on your Calimero cluster, not on a game server.",
                style = Type.body(16, color = ChessColors.Ink2),
            )
        }
        Card {
            Point(Icons.Outlined.Dns, "No game server")
            Point(Icons.Outlined.VerifiedUser, "Rules run in the contract")
            Point(Icons.Outlined.Key, "Sign in with a passkey")
        }
        if (invited) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(ButtonShape)
                    .background(ChessColors.LimeSoft)
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Drafts, contentDescription = null, tint = ChessColors.Ink)
                Text("You've been invited to a table. Sign in to join it.", style = Type.body(14))
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (form == SignInForm.DEVELOPMENT) {
                Field("Development node URL", devNode, { devNode = it.trim() }, url = true, tag = "signin.devNode")
                Field("Your name", name, { name = it.take(40) }, url = false, tag = "signin.name")
                Text(
                    "For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.",
                    style = Type.body(13, color = ChessColors.Muted),
                )
            } else {
                Field("Cluster name or node URL", cluster, { cluster = it.trim() }, url = true, tag = "signin.cluster")
                if (form == SignInForm.CREATE) Field("Your name", name, { name = it.take(40) }, url = false, tag = "signin.name")
            }

            if (!state.busy) state.error?.let { ErrorBanner(it, onDismissError) }

            PrimaryButton(
                onClick = {
                    when (form) {
                        SignInForm.SIGN_IN -> onCloud(cluster, false, name)
                        SignInForm.CREATE -> onCloud(cluster, true, name)
                        SignInForm.DEVELOPMENT -> onDevelopment(devNode, name)
                    }
                },
                enabled = !state.busy && canSubmit,
                modifier = Modifier.testTag("signin.primary"),
            ) {
                if (state.busy) CircularProgressIndicator(Modifier.size(18.dp), color = ChessColors.Ink, strokeWidth = 2.dp)
                ButtonLabel(
                    when {
                        state.busy -> "Signing in…"
                        form == SignInForm.SIGN_IN -> "Sign in with passkey"
                        form == SignInForm.CREATE -> "Create account"
                        else -> "Connect"
                    },
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                when (form) {
                    SignInForm.SIGN_IN -> Link("Create an account", !state.busy) { form = SignInForm.CREATE }
                    SignInForm.CREATE -> Link("I have an account", !state.busy) { form = SignInForm.SIGN_IN }
                    SignInForm.DEVELOPMENT -> Link("Use Calimero Cloud", !state.busy) { form = SignInForm.SIGN_IN }
                }
                Spacer(Modifier.weight(1f))
                if (form != SignInForm.DEVELOPMENT) {
                    Link("Development node", !state.busy, Modifier.testTag("signin.development")) { form = SignInForm.DEVELOPMENT }
                }
            }
        }
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    url: Boolean,
    tag: String,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        keyboardOptions =
            KeyboardOptions(
                keyboardType = if (url) KeyboardType.Uri else KeyboardType.Text,
                capitalization = if (url) KeyboardCapitalization.None else KeyboardCapitalization.Words,
                autoCorrectEnabled = !url,
            ),
        colors = fieldColors(),
        modifier = Modifier.fillMaxWidth().testTag(tag),
    )
}

@Composable
private fun Link(
    text: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, enabled = enabled, modifier = modifier) {
        Text(text, style = Type.body(14, FontWeight.SemiBold))
    }
}

@Composable
private fun Point(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = ChessColors.Ink, modifier = Modifier.size(22.dp))
        Text(text, style = Type.body(15, FontWeight.Medium))
    }
}
